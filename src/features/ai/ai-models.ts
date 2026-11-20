// features/ai/ai.ts に置かないのは、提供元ごとの実装（ai-openrouter.ts・ai-anthropic.ts）と features/ai/ai.ts が互いを読み込む循環になるため

export const OPENROUTER_MODELS = ['deepseek/deepseek-v4.1-flash-1017'] as const
export const ANTHROPIC_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const

export const AI_MODELS = [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS] as const

// AI_MODELS に入れないのは、文章を作らず、決めた選択肢から答えを選ぶだけで、会話（AI エージェントやアシスタント）には使えないため
/** 判定だけを返すモデル（OpenRouter の Decisions API）。使用量は OpenRouter の月の上限に数える */
export const OPENROUTER_DECISION_MODELS = [
  'typesafe/jev-1.14',
  'respan/span-01-lite',
  'respan/span-02',
  'perplexity/pplx-decider-v1.2',
] as const

export type DecisionModel = (typeof OPENROUTER_DECISION_MODELS)[number]

// AI_MODELS に入れないのは、文章をベクトルにするだけで、会話には使えないため
/** ドキュメントの検索に使う埋め込みのモデル（features/ai/ai-docs.ts）。使用量は OpenRouter の月の上限に数える */
export const OPENROUTER_EMBEDDING_MODELS = ['qwen/qwen3-embedding-8b'] as const

export type EmbeddingModel = (typeof OPENROUTER_EMBEDDING_MODELS)[number]

// AI_MODELS に入れないのは、音声を文字にするだけで、会話には使えないため
/** パネルの音声入力の文字起こしに使うモデル（features/ai/ai-voice.ts）。使用量は OpenRouter の月の上限に数える */
export const OPENROUTER_TRANSCRIPTION_MODELS = ['openai/whisper-large-v3-turbo'] as const

export type TranscriptionModel = (typeof OPENROUTER_TRANSCRIPTION_MODELS)[number]

export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number]
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]
export type AiModel = (typeof AI_MODELS)[number]

// ANTHROPIC_MODELS に入れないのは、Opus はコーディングエージェントで教師が選んだときだけ使い、AI アシスタントの選択肢や管理画面の一覧に出さないため
/** features/ai/ai-anthropic.ts で呼べる Claude のモデル */
export const CLAUDE_MODELS = [...ANTHROPIC_MODELS, 'claude-opus-5-5'] as const

export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

export const CLAUDE_MODEL_LABELS: Record<ClaudeModel, string> = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
}

/** 1 トークンあたりの料金（USD） */
export type ClaudePrice = { input: number; output: number; cacheRead: number; cacheWrite: number }

// 応答に請求額が入らないので、1 トークンあたりの料金から計算する
export const CLAUDE_PRICES: Record<ClaudeModel, ClaudePrice> = {
  'claude-haiku-5-5': { input: 0.1e-6, output: 0.5e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6 },
  'claude-sonnet-5-5': { input: 2e-6, output: 10e-6, cacheRead: 0.1e-6, cacheWrite: 2.5e-6 },
  'claude-opus-5-5': { input: 4e-6, output: 20e-6, cacheRead: 0.2e-6, cacheWrite: 5e-6 },
}

/** Claude のモデルが 1 回に受け取れる入力と出力のトークン数の合計 */
export const CLAUDE_CONTEXT_WINDOW = 1_000_000

/** OpenRouter のモデル一覧（/api/v1/models）の 1 件。料金は 1 トークンあたりの USD */
export type OpenRouterModelInfo = {
  id: string
  name: string
  contextLength: number
  /** 1 回の応答の出力トークン数の上限。決まっていなければ null */
  maxOutput: number | null
  prompt: number
  completion: number
  tools: boolean
}

export const isAiModel = (model: string): model is AiModel => (AI_MODELS as readonly string[]).includes(model)

export const isAnthropicModel = (model: string): model is AnthropicModel => (ANTHROPIC_MODELS as readonly string[]).includes(model)

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

// display: 'updates' で受け取らないのは、返るのが短い要約だけで、回答の本文の代わりにはならないため
/**
 * ツールを呼ぶ前に書いた 1〜2 文より長い文章を、本文ではなく中身が空の考えた内容のブロックで返すモデル。
 * 回答のあとにツールを呼ばせると、回答が表示されずに消える
 */
export const AI_HIDDEN_PRELUDE_MODELS: readonly ClaudeModel[] = ['claude-sonnet-5-5', 'claude-opus-5-5']

export const hidesPrelude = (model: AiModel) => (AI_HIDDEN_PRELUDE_MODELS as readonly string[]).includes(model)

// 提供元の枠だけにしないのは、難しい依頼だけを任せる高いモデルに提供元の週の枠を使い切られると、基本のモデルでも続けられなくなるため
/** 提供元の週の枠とは別に、本人の週の枠を持つモデル。使った額は提供元の枠にも数える */
export const AI_LIMITED_MODELS = ['claude-sonnet-5-5'] as const satisfies readonly AiModel[]

export type AiLimitedModel = (typeof AI_LIMITED_MODELS)[number]

export const isLimitedModel = (model: string): model is AiLimitedModel => (AI_LIMITED_MODELS as readonly string[]).includes(model)

/** 請求先。月の上限と使用量はこの単位で分ける */
export const AI_PROVIDERS = ['openrouter', 'anthropic'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic' }

/** パネルの利用状況に出す、提供元の週の枠の名前 */
export const AI_PROVIDER_QUOTA_LABELS: Record<AiProvider, string> = { openrouter: 'DeepSeek', anthropic: 'Claude 全体' }

/** パネルの利用状況に出す、モデルだけの週の枠の名前 */
export const AI_LIMITED_MODEL_QUOTA_LABELS: Record<AiLimitedModel, string> = { 'claude-sonnet-5-5': 'Sonnet のみ' }

export const AI_PROVIDER_MODELS: Record<AiProvider, readonly AiModel[]> = { openrouter: OPENROUTER_MODELS, anthropic: ANTHROPIC_MODELS }

// 使わなくなったモデルを消すだけにしないのは、そのモデルで記録した今月の使用量が、月の上限の計算から漏れるため
export const AI_RETIRED_PROVIDER_MODELS: Record<AiProvider, readonly string[]> = {
  openrouter: ['deepseek/deepseek-v4.1-flash'],
  anthropic: [],
}

// AI_PROVIDER_MODELS に入れないのは、会話には使わず、選択肢や管理画面の一覧に出さないため
/** 会話の外の決まった作業だけに使うモデル（コーディング問題を確定したときの準備の Opus）。使用量はその提供元の月の上限に数える */
export const AI_TASK_PROVIDER_MODELS: Record<AiProvider, readonly ClaudeModel[]> = {
  openrouter: [],
  anthropic: ['claude-opus-5-5'],
}

export const aiProvider = (model: AiModel | TranscriptionModel): AiProvider => (isAnthropicModel(model) ? 'anthropic' : 'openrouter')

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

export const AI_FILE_MEDIA_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type AiFileMediaType = (typeof AI_FILE_MEDIA_TYPES)[number]

/** ツールの結果や利用者の発言に添えて AI に見せるファイル。data は base64 */
export type AiFilePart = { mediaType: AiFileMediaType; data: string }

// OpenRouter のモデルに渡さないのは、DeepSeek V4.1 Flash は PDF を受け取れず、OpenAI 互換の API にはツールの結果に画像を添える形がないため
/** ツールの結果や発言に添えたファイル（AiFilePart）を読めるモデル */
export const readsFiles = (model: AiModel) => isAnthropicModel(model)

export type AiMessage =
  | { role: 'system'; content: string }
  /** files は利用者が発言に添えた画像。readsFiles のモデルにだけ送る */
  | { role: 'user'; content: string; files?: AiFilePart[] }
  /** native は AiReply の native。次の要求でもそのまま付けて送る。stopped は利用者が生成を止めたこと（content はそこまでの本文） */
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[]; native?: unknown; stopped?: boolean }
  /** files は結果に添えたファイル。readsFiles のモデルにだけ送る */
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean; files?: AiFilePart[] }

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
  /** 中断すると、そこまでに届いた本文を stop: 'stopped' で返す */
  signal?: AbortSignal
}

/** AiRequest のモデルを、提供元ごとの呼び出しで決まった型にしたもの */
export type AiRequestFor<M extends string> = Omit<AiRequest, 'model'> & { model: M }

/**
 * end: 言い終えた / tools: ツールの結果を待っている / length: maxTokens で打ち切られた / refusal: モデルが応答を断った /
 * stopped: AiRequest の signal で中断した。length のときの toolCalls は引数が途中で切れていることがあるので、実行しない。stopped のときは空
 */
export type AiStop = 'end' | 'tools' | 'length' | 'refusal' | 'stopped'

export type AiReply = {
  text: string
  toolCalls: AiToolCall[]
  stop: AiStop
  usage: AiUsage
  /**
   * 提供元の形式のままの応答。考えた内容を書き換えずに送り返す必要があるので、会話を続けるときに使う。
   * Claude は応答の content の配列、OpenRouter は作ったモデルと reasoning_details（features/ai/ai-openrouter.ts の OpenRouterNative）
   */
  native?: unknown
}

export const replyMessage = ({ text, toolCalls, native }: AiReply): AiMessage => ({ role: 'assistant', content: text, toolCalls, native })

/** AI を呼べなかった・応答を得られなかった。message はそのまま画面に出せる */
export class AiError extends Error {}

// Moodle の呼び出し（15 秒）より長いのは、文章の生成には数十秒かかることがあるため
export const AI_TIMEOUT = 60_000
// ストリーミングで AI_TIMEOUT を使わないのは、届いた分から画面に出せるので、長い文章を最後まで待てるようにするため
export const AI_STREAM_TIMEOUT = 180_000
