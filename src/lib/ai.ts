import { config } from './config'

export const AI_MODELS = ['deepseek/deepseek-v4.1-flash'] as const

export type AiModel = (typeof AI_MODELS)[number]

export const isAiModel = (model: string): model is AiModel => (AI_MODELS as readonly string[]).includes(model)

export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type AiRequest = { model: AiModel; messages: AiMessage[]; maxTokens?: number; temperature?: number }

/** AI を呼べなかった・応答を得られなかった。message はそのまま画面に出せる */
export class AiError extends Error {}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

// Moodle の呼び出し（15 秒）より長いのは、文章の生成には数十秒かかることがあるため
const TIMEOUT = 60_000

type Completion = {
  choices?: { message?: { content?: string | null } }[]
  error?: { code?: number | string; message?: string }
}

export const aiEnabled = config.openRouter !== null

export async function generateText({ model, messages, maxTokens, temperature }: AiRequest): Promise<string> {
  // 型だけに任せないのは、as でのキャストや設定・入力から来た文字列が、一覧にないモデルのまま OpenRouter に届くのを防ぐため
  if (!isAiModel(model)) throw new AiError(`利用できないモデルです（${String(model)}）`)
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、AI を利用できません')
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openRouter.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
  } catch (e) {
    console.error('[ai]', e)
    throw new AiError('AI に接続できません')
  }
  const data = (await res.json().catch(() => null)) as Completion | null
  // ステータスだけで判定しないのは、OpenRouter がモデル側の失敗を 200 のまま error に入れて返すことがあるため
  if (!res.ok || !data || data.error) {
    // OpenRouter のメッセージを AiError に入れないのは、画面に出す文言に外部の英語のエラーを混ぜないため
    console.error('[ai]', model, res.status, data?.error)
    throw new AiError('AI が応答を返せませんでした')
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new AiError('AI の応答が空でした')
  return text
}
