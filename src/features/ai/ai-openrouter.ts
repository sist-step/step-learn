import {
  AI_STREAM_TIMEOUT,
  AI_TIMEOUT,
  AiError,
  type AiMessage,
  type AiReply,
  type AiRequestFor,
  type AiStop,
  type AiTool,
  type AiToolCall,
  type AiUsage,
  type OpenRouterModel,
  type OpenRouterModelInfo,
} from './ai-models'
import { config } from '../../lib/config'
import { parseJson } from '../../lib/json'

const API = 'https://openrouter.ai/api/v1'

/** 1 トークンあたりの料金（USD） */
type OpenRouterPrice = { prompt: number; completion: number }

// usage.cost だけに頼らないのは、cost のない応答を 0 として数えると、上限の計算から漏れるため。
// 提供元ごとに料金が違うので、OpenRouter のモデル一覧に載っている額で見積もる
const FALLBACK_PRICES: Record<OpenRouterModel, OpenRouterPrice> = {
  'deepseek/deepseek-v4.1-flash-1017': { prompt: 0.006e-6, completion: 0.5e-6 },
}

type ReasoningDetail = { type?: string; index?: number; text?: string; summary?: string; data?: string; signature?: string | null }
type WireToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } }
type WirePart = { content?: string | null; tool_calls?: WireToolCall[]; reasoning_details?: ReasoningDetail[] }
type WireUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number }
type WireError = { code?: number | string; message?: string }
type Completion = { choices?: { message?: WirePart; finish_reason?: string | null }[]; usage?: WireUsage; error?: WireError }
type Chunk = { choices?: { delta?: WirePart; finish_reason?: string | null }[]; usage?: WireUsage; error?: WireError }

/** AiReply の native。考えた内容（reasoning_details）を、同じモデルで会話を続けるときにそのまま送り返す */
type OpenRouterNative = { openrouter: string; reasoningDetails: ReasoningDetail[] }

const STOPS: Partial<Record<string, AiStop>> = { tool_calls: 'tools', length: 'length', content_filter: 'refusal' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 会話の assistant の native が、model で作った OpenRouter の考えた内容なら、その中身 */
function reasoningFor(native: unknown, model: string) {
  if (!isRecord(native) || native.openrouter !== model || !Array.isArray(native.reasoningDetails)) return undefined
  return native.reasoningDetails as ReasoningDetail[]
}

// 止めて本文が届かなかった発言を送らないのは、中身のない assistant のメッセージを弾く提供元があるため
const isEmptyReply = (m: AiMessage) => m.role === 'assistant' && !m.content && !m.toolCalls?.length

// ほかのモデルの考えた内容を送らないのは、モデルごとに形式や署名が違い、別のモデルでは読めずに弾かれることがあるため
const toWireMessage = (model: string) => (m: AiMessage) => {
  if (m.role === 'tool') return { role: m.role, tool_call_id: m.toolCallId, content: m.content }
  if (m.role !== 'assistant') return { role: m.role, content: m.content }
  const reasoning = reasoningFor(m.native, model)
  return {
    role: m.role,
    content: m.content,
    tool_calls: m.toolCalls?.length
      ? m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } }))
      : undefined,
    reasoning_details: reasoning,
  }
}

const toWireTool = (t: AiTool) => ({ type: 'function', function: t })

function toUsage(price: OpenRouterPrice, usage: WireUsage | undefined): AiUsage {
  const promptTokens = usage?.prompt_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  return { promptTokens, completionTokens, cost: usage?.cost ?? promptTokens * price.prompt + completionTokens * price.completion }
}

// ストリーミングの断片を 1 件ずつ残さないのは、1 つの考えた内容が何百もの断片に分かれて届き、送り返す会話が膨らむため
/** 届いた考えた内容の断片を、同じ種類・同じ index の直前の要素につなげる */
function mergeReasoning(into: ReasoningDetail[], parts: ReasoningDetail[]) {
  for (const part of parts) {
    const last = into.at(-1)
    if (!last || last.type !== part.type || last.index !== part.index) {
      into.push({ ...part })
      continue
    }
    if (part.text) last.text = (last.text ?? '') + part.text
    if (part.summary) last.summary = (last.summary ?? '') + part.summary
    if (part.data) last.data = (last.data ?? '') + part.data
    if (part.signature) last.signature = part.signature
  }
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

// OpenRouter のメッセージを AiError に入れないのは、画面に出す文言に外部の英語のエラーを混ぜないため
function statusError(status: number) {
  if (status === 401 || status === 403) return new AiError('AI の API キーが使えません')
  if (status === 402) return new AiError('OpenRouter のクレジットが足りません')
  if (status === 429) return new AiError('AI が混み合っています。しばらくしてからお試しください')
  return new AiError('AI が応答を返せませんでした')
}

/** AiRequest で OpenRouter のモデルを呼ぶ。apiKey と price は、呼ぶ人が決めたキーと、usage.cost がないときに使う料金 */
async function requestOpenRouter(
  { model, messages, maxTokens, temperature, tools, onText, signal }: AiRequestFor<string>,
  apiKey: string,
  price: OpenRouterPrice,
): Promise<AiReply> {
  const stream = !!onText
  const body = JSON.stringify({
    model,
    messages: messages.filter((m) => !isEmptyReply(m)).map(toWireMessage(model)),
    max_tokens: maxTokens,
    temperature,
    tools: tools?.length ? tools.map(toWireTool) : undefined,
    stream: stream || undefined,
  })
  // 止めたときの入力のトークン数を推測で数えるのは、止めると usage が届かず、届いた数のままだと入力の分が上限の計算から漏れるため。
  // 3 文字を 1 トークンとみなすのは、英語やコードでは多めに、日本語では少なめになり、ならすとおおむね合うため
  const stoppedUsage = (completion: number) => toUsage(price, { prompt_tokens: Math.ceil(body.length / 3), completion_tokens: completion })
  let res: Response
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.any([AbortSignal.timeout(stream ? AI_STREAM_TIMEOUT : AI_TIMEOUT), ...(signal ? [signal] : [])]),
    })
  } catch (e) {
    if (signal?.aborted) return { text: '', toolCalls: [], stop: 'stopped', usage: toUsage(price, undefined) }
    console.error('[ai]', e)
    throw new AiError('AI に接続できません')
  }

  let text = ''
  let usage: WireUsage | undefined
  let finish: string | null | undefined
  const toolCalls: AiToolCall[] = []
  const reasoning: ReasoningDetail[] = []
  const collect = (choice: { message?: WirePart; delta?: WirePart; finish_reason?: string | null } | undefined) => {
    const part = choice?.message ?? choice?.delta
    finish = choice?.finish_reason ?? finish
    if (part?.content) {
      text += part.content
      onText?.(part.content)
    }
    if (part?.reasoning_details?.length) mergeReasoning(reasoning, part.reasoning_details)
    part?.tool_calls?.forEach((t, i) => {
      const call = (toolCalls[t.index ?? i] ??= { id: '', name: '', arguments: '' })
      call.id ||= t.id ?? ''
      call.name ||= t.function?.name ?? ''
      call.arguments += t.function?.arguments ?? ''
    })
  }
  const fail = (error: WireError | undefined): never => {
    console.error('[ai]', model, res.status, error)
    throw res.ok ? new AiError('AI が応答を返せませんでした') : statusError(res.status)
  }

  if (stream && res.ok && res.body) {
    try {
      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break
        const chunk = parseJson(data) as Chunk | null
        if (!chunk) continue
        if (chunk.error) fail(chunk.error)
        collect(chunk.choices?.[0])
        usage = chunk.usage ?? usage
      }
    } catch (e) {
      if (e instanceof AiError) throw e
      if (signal?.aborted) return { text, toolCalls: [], stop: 'stopped', usage: stoppedUsage(text.length) }
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
  const native: OpenRouterNative | undefined = reasoning.length ? { openrouter: model, reasoningDetails: reasoning } : undefined
  return { text, toolCalls: calls, stop, usage: toUsage(price, usage), native }
}

/** OPENROUTER_API_KEY で、AI アシスタントなどのモデルを呼ぶ */
export function completeOpenRouter(request: AiRequestFor<OpenRouterModel>): Promise<AiReply> {
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、このモデルを利用できません')
  return requestOpenRouter(request, config.openRouter.apiKey, FALLBACK_PRICES[request.model])
}

/** OPENROUTER_API_KEY の代わりに apiKey で、モデル一覧にある任意のモデルを呼ぶ（コーディングエージェントのアイテムごとのキー） */
export const completeOpenRouterWith = (request: AiRequestFor<string>, apiKey: string, price: OpenRouterPrice) =>
  requestOpenRouter(request, apiKey, price)

// ---------------------------------------------------------------- モデル一覧

type WireModel = {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown }
  architecture?: { output_modalities?: unknown }
  supported_parameters?: unknown
}

const positiveInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

/** 料金の文字列（1 トークンあたりの USD）。料金が決まっていない（"-1" など）なら null */
const priceOf = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

function toModelInfo(m: WireModel): OpenRouterModelInfo | null {
  const contextLength = positiveInt(m.top_provider?.context_length) ?? positiveInt(m.context_length)
  const prompt = priceOf(m.pricing?.prompt)
  const completion = priceOf(m.pricing?.completion)
  const outputs = m.architecture?.output_modalities
  if (typeof m.id !== 'string' || !m.id || contextLength === null || prompt === null || completion === null) return null
  if (Array.isArray(outputs) && !outputs.includes('text')) return null
  return {
    id: m.id,
    name: typeof m.name === 'string' && m.name ? m.name : m.id,
    contextLength,
    maxOutput: positiveInt(m.top_provider?.max_completion_tokens),
    prompt,
    completion,
    tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
  }
}

/** 一覧を取り直すまでの秒数 */
const MODELS_TTL = 60 * 60

// 古い一覧を捨てずに返すのは、OpenRouter に届かないあいだも、教師が編集画面でモデルを選び直せるようにするため
let modelCache: { at: number; list: OpenRouterModelInfo[] } | null = null
let modelLoading: Promise<OpenRouterModelInfo[] | null> | null = null

async function fetchModels() {
  try {
    const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(10_000) })
    const body = (await res.json().catch(() => null)) as { data?: WireModel[] } | null
    if (!res.ok || !Array.isArray(body?.data)) {
      console.error('[ai] OpenRouter のモデル一覧', res.status)
      return null
    }
    const list = body.data.flatMap((m) => toModelInfo(m) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    modelCache = { at: Math.floor(Date.now() / 1000), list }
    return list
  } catch (e) {
    console.error('[ai] OpenRouter のモデル一覧', e instanceof Error ? e.message : typeof e)
    return null
  } finally {
    modelLoading = null
  }
}

/**
 * OpenRouter のモデル一覧（名前の順）。MODELS_TTL のあいだはキャッシュを返し、古くなったら裏で取り直す。
 * 一度も取れていないときだけ取り終わるのを待ち、取れなければ null
 */
export async function listOpenRouterModels(): Promise<OpenRouterModelInfo[] | null> {
  const stale = !modelCache || Math.floor(Date.now() / 1000) - modelCache.at >= MODELS_TTL
  if (stale) modelLoading ??= fetchModels()
  return modelCache?.list ?? (await modelLoading)
}

/** すでに取ってあるモデル一覧。同期で描く画面に使う。まだ取っていなければ null */
export const cachedOpenRouterModels = () => modelCache?.list ?? null

/** API キーが使えるか。invalid はキーが使えない、unreachable は OpenRouter に届かなかった */
export async function checkOpenRouterKey(apiKey: string): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) })
    if (res.ok) return 'ok'
    if (res.status === 401 || res.status === 403) return 'invalid'
    console.error('[ai] OpenRouter のキーの確認', res.status)
    return 'unreachable'
  } catch (e) {
    console.error('[ai] OpenRouter のキーの確認', e instanceof Error ? e.message : typeof e)
    return 'unreachable'
  }
}
