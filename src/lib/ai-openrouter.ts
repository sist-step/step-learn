import {
  AI_STREAM_TIMEOUT,
  AI_TIMEOUT,
  AiError,
  type AiMessage,
  type AiReply,
  type AiRequest,
  type AiStop,
  type AiTool,
  type AiToolCall,
  type AiUsage,
  type OpenRouterModel,
} from './ai-models'
import { config } from './config'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

// usage.cost だけに頼らないのは、cost のない応答を 0 として数えると、上限の計算から漏れるため。
// 提供元ごとに料金が違うので、OpenRouter のモデル一覧に載っている額で見積もる
const FALLBACK_PRICES: Record<OpenRouterModel, { prompt: number; completion: number }> = {
  'deepseek/deepseek-v4.1-flash': { prompt: 0.051e-6, completion: 0.567e-6 },
}

type WireToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } }
type WirePart = { content?: string | null; tool_calls?: WireToolCall[] }
type WireUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number }
type WireError = { code?: number | string; message?: string }
type Completion = { choices?: { message?: WirePart; finish_reason?: string | null }[]; usage?: WireUsage; error?: WireError }
type Chunk = { choices?: { delta?: WirePart; finish_reason?: string | null }[]; usage?: WireUsage; error?: WireError }

const STOPS: Partial<Record<string, AiStop>> = { tool_calls: 'tools', length: 'length', content_filter: 'refusal' }

const toWireMessage = (m: AiMessage) => {
  if (m.role === 'tool') return { role: m.role, tool_call_id: m.toolCallId, content: m.content }
  if (m.role !== 'assistant' || !m.toolCalls?.length) return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: m.content,
    tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
  }
}

const toWireTool = (t: AiTool) => ({ type: 'function', function: t })

function toUsage(model: OpenRouterModel, usage: WireUsage | undefined): AiUsage {
  const promptTokens = usage?.prompt_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  const price = FALLBACK_PRICES[model]
  return { promptTokens, completionTokens, cost: usage?.cost ?? promptTokens * price.prompt + completionTokens * price.completion }
}

async function* sseData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.startsWith('data:')) yield line.slice(5).trim()
  }
}

const parseJson = <T>(raw: string) => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function completeOpenRouter({
  model,
  messages,
  maxTokens,
  temperature,
  tools,
  onText,
}: AiRequest & { model: OpenRouterModel }): Promise<AiReply> {
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、このモデルを利用できません')
  const stream = !!onText
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openRouter.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(toWireMessage),
        max_tokens: maxTokens,
        temperature,
        tools: tools?.length ? tools.map(toWireTool) : undefined,
        stream: stream || undefined,
      }),
      signal: AbortSignal.timeout(stream ? AI_STREAM_TIMEOUT : AI_TIMEOUT),
    })
  } catch (e) {
    console.error('[ai]', e)
    throw new AiError('AI に接続できません')
  }

  let text = ''
  let usage: WireUsage | undefined
  let finish: string | null | undefined
  const toolCalls: AiToolCall[] = []
  const collect = (choice: { message?: WirePart; delta?: WirePart; finish_reason?: string | null } | undefined) => {
    const part = choice?.message ?? choice?.delta
    finish = choice?.finish_reason ?? finish
    if (part?.content) {
      text += part.content
      onText?.(part.content)
    }
    part?.tool_calls?.forEach((t, i) => {
      const call = (toolCalls[t.index ?? i] ??= { id: '', name: '', arguments: '' })
      call.id ||= t.id ?? ''
      call.name ||= t.function?.name ?? ''
      call.arguments += t.function?.arguments ?? ''
    })
  }
  // OpenRouter のメッセージを AiError に入れないのは、画面に出す文言に外部の英語のエラーを混ぜないため
  const fail = (error: WireError | undefined): never => {
    console.error('[ai]', model, res.status, error)
    throw new AiError('AI が応答を返せませんでした')
  }

  if (stream && res.ok && res.body) {
    try {
      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break
        const chunk = parseJson<Chunk>(data)
        if (!chunk) continue
        if (chunk.error) fail(chunk.error)
        collect(chunk.choices?.[0])
        usage = chunk.usage ?? usage
      }
    } catch (e) {
      if (e instanceof AiError) throw e
      console.error('[ai]', e)
      throw new AiError('AI の応答が途中で切れました')
    }
  } else {
    const data = (await res.json().catch(() => null)) as Completion | null
    // ステータスだけで判定しないのは、OpenRouter がモデル側の失敗を 200 のまま error に入れて返すことがあるため
    if (!res.ok || !data || data.error) return fail(data?.error)
    collect(data.choices?.[0])
    usage = data.usage
  }

  // 配列をそのまま返さないのは、index が飛んだ応答だと、穴の空いた要素が呼び出しとして残るため
  const calls = toolCalls.filter((t) => t?.name)
  const stop = STOPS[finish ?? ''] ?? (calls.length > 0 ? 'tools' : 'end')
  if (!text && calls.length === 0 && stop !== 'refusal') throw new AiError('AI の応答が空でした')
  return { text, toolCalls: calls, stop, usage: toUsage(model, usage) }
}
