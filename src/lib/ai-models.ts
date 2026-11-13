// lib/ai.ts に置かないのは、提供元ごとの実装（ai-openrouter.ts・ai-anthropic.ts）と lib/ai.ts が互いを読み込む循環になるため

export const OPENROUTER_MODELS = ['deepseek/deepseek-v4.1-flash-1017'] as const
export const ANTHROPIC_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const

export const AI_MODELS = [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS] as const

// AI_MODELS に入れないのは、文章を作らず、決めた選択肢から答えを選ぶだけで、会話（AI エージェントやアシスタント）には使えないため
/** 判定だけを返すモデル（OpenRouter の Decisions API）。使用量は OpenRouter の月の上限に数える */
export const OPENROUTER_DECISION_MODELS = ['typesafe/jev-1.14', 'respan/span-01-lite', 'respan/span-02'] as const

export type DecisionModel = (typeof OPENROUTER_DECISION_MODELS)[number]

export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number]
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]
export type AiModel = (typeof AI_MODELS)[number]

export const isAiModel = (model: string): model is AiModel => (AI_MODELS as readonly string[]).includes(model)

export const isAnthropicModel = (model: AiModel): model is AnthropicModel => (ANTHROPIC_MODELS as readonly string[]).includes(model)

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  'deepseek/deepseek-v4.1-flash-1017': 'DeepSeek V4.1 Flash 1017',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
}

// Sonnet を選択肢に出さないのは、簡単な依頼にまで高いモデルを使わず、難しい依頼だけを AI_HARD_TASK_MODELS で任せるため
/** チャットを始めるときに選べるモデル */
export const AI_CHAT_MODELS: readonly AiModel[] = ['deepseek/deepseek-v4.1-flash-1017', 'claude-haiku-5-5']

/** チャットのモデルが、利用者がパネルで「難しい依頼」を選んだ発言だけを任せるモデル */
export const AI_HARD_TASK_MODELS: Partial<Record<AiModel, AiModel>> = { 'claude-haiku-5-5': 'claude-sonnet-5-5' }

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

// 一覧から消さないのは、再開するときにここから外すだけで戻せて、止める前にそのモデルで使った今月の額も月の上限に数え続けるため
/** 一時的に止めているモデル。会話の選択肢に出さず、呼び出しても断る */
export const AI_PAUSED_MODELS: readonly (AiModel | DecisionModel)[] = ['typesafe/jev-1.14']

export const isModelPaused = (model: AiModel | DecisionModel) => AI_PAUSED_MODELS.includes(model)

// 利用者ごとの週の枠で切り替えないのは、守りたいのは全体の予算で、一人が枠を使い切っただけで予備を出す必要はないため
/** Claude を使えないか、Anthropic の今月の使用量が月の上限の AI_RESERVE_THRESHOLD を超えたときだけ使う予備のモデル */
export const AI_RESERVE_MODELS: readonly AiModel[] = ['deepseek/deepseek-v4.1-flash-1017']

export const AI_RESERVE_THRESHOLD = 0.6

export const isReserveModel = (model: AiModel | DecisionModel) => (AI_RESERVE_MODELS as readonly string[]).includes(model)

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
