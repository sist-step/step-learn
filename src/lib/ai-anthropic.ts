import Anthropic from '@anthropic-ai/sdk'
import {
  AI_STREAM_TIMEOUT,
  AI_TIMEOUT,
  AiError,
  type AiMessage,
  type AiReply,
  type AiRequest,
  type AiStop,
  type AiTool,
  type AiUsage,
  type AnthropicModel,
} from './ai-models'
import { config } from './config'

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Haiku 5.5 は、入力がこのトークン数を超えると LONG_PROMPT_PRICES の料金になる */
const LONG_PROMPT_TOKENS = 100_000

// 応答に請求額が入らないので、1 トークンあたりの料金（USD）から計算する
const PRICES: Record<AnthropicModel, Price> = {
  'claude-haiku-5-5': { input: 0.1e-6, output: 0.5e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6 },
  'claude-sonnet-5-5': { input: 2e-6, output: 10e-6, cacheRead: 0.1e-6, cacheWrite: 2.5e-6 },
}

const LONG_PROMPT_PRICES: Partial<Record<AnthropicModel, Price>> = {
  'claude-haiku-5-5': { input: 0.5e-6, output: 2.5e-6, cacheRead: 0.05e-6, cacheWrite: 0.625e-6 },
}

// Sonnet を Haiku と同じ深さにしないのは、Sonnet に任せるのは難しい依頼だけで、そこで考える量を減らすと任せる意味が薄れるため
const EFFORT: Record<AnthropicModel, 'medium' | 'high'> = { 'claude-haiku-5-5': 'medium', 'claude-sonnet-5-5': 'high' }

const STOPS: Partial<Record<string, AiStop>> = {
  tool_use: 'tools',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  refusal: 'refusal',
}

let client: Anthropic | null = null

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function assistantContent(m: Extract<AiMessage, { role: 'assistant' }>): Anthropic.Beta.BetaContentBlockParam[] {
  // 本文とツール呼び出しから組み立て直さないのは、考えた内容のブロックを書き換えずに送り返さないと、続きの要求が弾かれるため
  if (Array.isArray(m.native)) return m.native as Anthropic.Beta.BetaContentBlockParam[]
  return [
    ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
    ...(m.toolCalls ?? []).map((t) => ({ type: 'tool_use' as const, id: t.id, name: t.name, input: parseJson(t.arguments) ?? {} })),
  ]
}

function toWire(all: AiMessage[]) {
  const first = all.findIndex((m) => m.role !== 'system')
  const head = all.slice(0, first === -1 ? all.length : first)
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of all.slice(head.length)) {
    if (m.role === 'assistant') {
      const content = assistantContent(m)
      if (content.length > 0) messages.push({ role: 'assistant', content })
    } else if (m.role === 'tool') {
      const result: Anthropic.Beta.BetaToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        is_error: m.isError || undefined,
      }
      const last = messages.at(-1)
      // 1 件ずつ別のメッセージにしないのは、同時に呼ばれたツールの結果を 1 つの user メッセージにまとめないと、モデルが同時に呼ばなくなるため
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(result)
      } else {
        messages.push({ role: 'user', content: [result] })
      }
    } else {
      messages.push({ role: m.role, content: m.content })
    }
  }
  return { system: head.map((m) => m.content).join('\n\n') || undefined, messages }
}

const toWireTool = (t: AiTool, stream: boolean): Anthropic.Beta.BetaTool => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
  eager_input_streaming: stream || undefined,
})

function toUsage(model: AnthropicModel, usage: Anthropic.Beta.BetaUsage): AiUsage {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite
  // 応答の model で料金を選ばないのは、Sonnet 5.5 が断られたときに代わりに応答する Claude Sonnet 5 も、キャッシュの読み取り以外は同じ料金のため
  const price = (promptTokens > LONG_PROMPT_TOKENS ? LONG_PROMPT_PRICES[model] : undefined) ?? PRICES[model]
  return {
    promptTokens,
    completionTokens: usage.output_tokens,
    cost:
      usage.input_tokens * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + usage.output_tokens * price.output,
  }
}

function toAiError(model: AnthropicModel, e: unknown) {
  if (e instanceof Anthropic.RateLimitError) {
    console.error('[ai]', model, e.status, e.message)
    return new AiError('AI が混み合っています。しばらくしてからお試しください')
  }
  if (e instanceof Anthropic.APIConnectionError) {
    console.error('[ai]', model, e.message)
    return new AiError('AI に接続できません')
  }
  // Anthropic のメッセージを AiError に入れないのは、画面に出す文言に外部の英語のエラーを混ぜないため
  if (e instanceof Anthropic.APIError) {
    console.error('[ai]', model, e.status, e.message)
    return new AiError('AI が応答を返せませんでした')
  }
  // 中身を出さないのは、読み取れなかったツールの引数（会話の内容）がエラーに含まれるため
  console.error('[ai]', model, e instanceof Error ? e.name : typeof e)
  return new AiError('AI の応答を読み取れませんでした')
}

// 止めたときの出力のトークン数を推測で数えるのは、出力のトークン数は言い終えたときにしか届かず、届いた数のままだと途中までに作った分が上限の計算から漏れるため。
// 1 文字を 1 トークンとみなすのは、日本語の文章ではおおむねそうなり、英語やコードでは多めに数えて上限を超えにくくなるため
function stoppedUsage(model: AnthropicModel, snapshot: Anthropic.Beta.BetaMessage | undefined): AiUsage {
  if (!snapshot) return { promptTokens: 0, completionTokens: 0, cost: 0 }
  const written = snapshot.content.reduce(
    (n, b) => n + (b.type === 'text' ? b.text.length : b.type === 'thinking' ? b.thinking.length : JSON.stringify(b).length),
    0,
  )
  return toUsage(model, { ...snapshot.usage, output_tokens: Math.max(snapshot.usage.output_tokens, written) })
}

export async function completeAnthropic({
  model,
  messages,
  maxTokens,
  tools,
  onText,
  signal,
}: AiRequest & { model: AnthropicModel }): Promise<AiReply> {
  if (!config.anthropic) throw new AiError('CLAUDE_API_KEY が設定されていないため、このモデルを利用できません')
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 1 })
  const stream = !!onText
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens ?? (stream ? 64_000 : 16_000),
    ...toWire(messages),
    tools: tools?.length ? tools.map((t) => toWireTool(t, stream)) : undefined,
    // drop_block にするのは、保存した会話の途中でシステムプロンプトやツールの定義が変わったときに、要求ごと弾かれるのを避けるため
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: { effort: EFFORT[model] },
    cache_control: { type: 'ephemeral' },
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
  }
  const options = { timeout: stream ? AI_STREAM_TIMEOUT : AI_TIMEOUT, signal }

  let message: Anthropic.Beta.BetaMessage
  let partial: () => Anthropic.Beta.BetaMessage | undefined = () => undefined
  try {
    if (onText) {
      const running = client.beta.messages.stream(params, options)
      partial = () => running.currentMessage
      running.on('text', onText)
      message = await running.finalMessage()
    } else {
      message = await client.beta.messages.create(params, options)
    }
  } catch (e) {
    if (!signal?.aborted) throw toAiError(model, e)
    // 途中の native を返さないのは、署名の届いていない考えた内容のブロックを送り返すと、続きの要求が弾かれるため
    const snapshot = partial()
    const text = (snapshot?.content ?? []).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return { text, toolCalls: [], stop: 'stopped', usage: stoppedUsage(model, snapshot) }
  }

  const dropped = message.input_transformations?.length
  if (dropped) console.warn('[ai]', model, `考えた内容のブロック ${dropped} 件が会話の変更で使われませんでした`)

  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  const toolCalls = message.content.flatMap((b) =>
    b.type === 'tool_use' ? [{ id: b.id, name: b.name, arguments: JSON.stringify(b.input) }] : [],
  )
  const stop = STOPS[message.stop_reason ?? ''] ?? 'end'
  if (!text && toolCalls.length === 0 && stop !== 'refusal') throw new AiError('AI の応答が空でした')
  return { text, toolCalls, stop, usage: toUsage(model, message.usage), native: message.content }
}
