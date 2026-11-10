// lib/ai.ts に置かないのは、提供元ごとの実装（ai-openrouter.ts・ai-anthropic.ts）と lib/ai.ts が互いを読み込む循環になるため

export const OPENROUTER_MODELS = ['deepseek/deepseek-v4.1-flash-1017'] as const
export const ANTHROPIC_MODELS = ['claude-sonnet-5-5'] as const

export const AI_MODELS = [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS] as const

export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number]
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]
export type AiModel = (typeof AI_MODELS)[number]

export const isAiModel = (model: string): model is AiModel => (AI_MODELS as readonly string[]).includes(model)

export const isAnthropicModel = (model: AiModel): model is AnthropicModel => (ANTHROPIC_MODELS as readonly string[]).includes(model)

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  'deepseek/deepseek-v4.1-flash-1017': 'DeepSeek V4.1 Flash 1017',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
}

/** 請求先。月の上限と使用量はこの単位で分ける */
export const AI_PROVIDERS = ['openrouter', 'anthropic'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic' }

export const AI_PROVIDER_MODELS: Record<AiProvider, readonly AiModel[]> = { openrouter: OPENROUTER_MODELS, anthropic: ANTHROPIC_MODELS }

// 使わなくなったモデルを消すだけにしないのは、そのモデルで記録した今月の使用量が、月の上限の計算から漏れるため
export const AI_RETIRED_PROVIDER_MODELS: Record<AiProvider, readonly string[]> = {
  openrouter: ['deepseek/deepseek-v4.1-flash'],
  anthropic: [],
}

export const aiProvider = (model: AiModel): AiProvider => (isAnthropicModel(model) ? 'anthropic' : 'openrouter')

/** arguments はモデルが書いた JSON の文字列。壊れていることがあるので、使う側で検証する */
export type AiToolCall = { id: string; name: string; arguments: string }

export type AiMessage =
  | { role: 'system' | 'user'; content: string }
  /** native は AiReply の native。次の要求でもそのまま付けて送る */
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[]; native?: unknown }
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean }

/** parameters は引数の JSON Schema */
export type AiTool = { name: string; description: string; parameters: Record<string, unknown> }

/** cost は提供元に請求される額（USD） */
export type AiUsage = { promptTokens: number; completionTokens: number; cost: number }

export type AiRequest = {
  model: AiModel
  messages: AiMessage[]
  maxTokens?: number
  /** Claude は受け付けないので、OpenRouter のモデルにだけ送る */
  temperature?: number
  tools?: AiTool[]
  /** 渡すとストリーミングで受け取り、本文の断片が届くたびに呼ぶ */
  onText?: (delta: string) => void
}

/**
 * end: 言い終えた / tools: ツールの結果を待っている / length: maxTokens で打ち切られた / refusal: モデルが応答を断った。
 * length のときの toolCalls は引数が途中で切れていることがあるので、実行しない
 */
export type AiStop = 'end' | 'tools' | 'length' | 'refusal'

export type AiReply = {
  text: string
  toolCalls: AiToolCall[]
  stop: AiStop
  usage: AiUsage
  /** 提供元の形式のままの応答。Claude は考えた内容のブロックを書き換えずに送り返す必要があるので、会話を続けるときに使う */
  native?: unknown
}

export const replyMessage = ({ text, toolCalls, native }: AiReply): AiMessage => ({ role: 'assistant', content: text, toolCalls, native })

/** AI を呼べなかった・応答を得られなかった。message はそのまま画面に出せる */
export class AiError extends Error {}

// Moodle の呼び出し（15 秒）より長いのは、文章の生成には数十秒かかることがあるため
export const AI_TIMEOUT = 60_000
// ストリーミングで AI_TIMEOUT を使わないのは、届いた分から画面に出せるので、長い文章を最後まで待てるようにするため
export const AI_STREAM_TIMEOUT = 180_000
