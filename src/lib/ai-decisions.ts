import { AI_TIMEOUT, AiError, isModelPaused, type AiUsage, type DecisionModel } from './ai-models'
import { config } from './config'

// /api/v1 の下にないのは、OpenRouter の Decisions API がまだ alpha で、別の場所に置かれているため
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'

// usage.cost だけに頼らないのは、cost のない応答を 0 として数えると、上限の計算から漏れるため。
// Jev は料金表が読めなかったので公式の例（入力 476 トークンで 0.00002 ドル）より、Span-02 は料金表（入力 100 万トークンで 0.01 ドル）より高めに見積もる。Span-01 Lite は無料で、出力はどれも無料
const FALLBACK_INPUT_PRICE: Record<DecisionModel, number> = {
  'typesafe/jev-1.14': 0.1e-6,
  'respan/span-01-lite': 0,
  'respan/span-02': 0.05e-6,
}

/** 決めた選択肢（criteria のキー）から 1 つを選ばせる問い。criteria の値は、その選択肢の説明 */
export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }

/** instructions に書いたことが当てはまるかを、はい・いいえで答えさせる問い */
export type NoulQuestion = { type: 'noul'; instructions: string }

export type DecisionQuestion = ChoiceQuestion | NoulQuestion

/** probabilities は選択肢ごとの確からしさ、noul ははいの確からしさ。答えを断られた問いは refusal になる */
export type DecisionAnswer =
  { type: 'choice'; choice: string; probabilities: Record<string, number> } | { type: 'noul'; noul: number } | { type: 'refusal' }

type WireAnswer = { type?: string; choice?: unknown; probabilities?: unknown; noul?: unknown }
type WireDecision = {
  answers?: Record<string, WireAnswer>
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
  error?: { code?: number | string; message?: string }
}

function toAnswer(wire: WireAnswer | undefined): DecisionAnswer {
  if (wire?.type === 'noul' && typeof wire.noul === 'number') return { type: 'noul', noul: wire.noul }
  if (wire?.type !== 'choice' || typeof wire.choice !== 'string') return { type: 'refusal' }
  const probabilities =
    typeof wire.probabilities === 'object' && wire.probabilities !== null
      ? Object.fromEntries(Object.entries(wire.probabilities).filter((e): e is [string, number] => typeof e[1] === 'number'))
      : {}
  return { type: 'choice', choice: wire.choice, probabilities }
}

/**
 * state（判断の材料の文章）について、questions の問いに答えさせる。答えは問いと同じキーで返す。
 * 文章は返らないので、理由が要るときは別のモデルに頼む
 */
export async function decide({
  model,
  state,
  questions,
}: {
  model: DecisionModel
  state: string
  questions: Record<string, DecisionQuestion>
}): Promise<{ answers: Record<string, DecisionAnswer>; usage: AiUsage }> {
  if (isModelPaused(model)) throw new AiError(`${model} は一時的に停止しています`)
  if (!config.openRouter) throw new AiError('OPENROUTER_API_KEY が設定されていないため、このモデルを利用できません')
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openRouter.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(AI_TIMEOUT),
    })
  } catch (e) {
    console.error('[ai]', e)
    throw new AiError('AI に接続できません')
  }
  const data = (await res.json().catch(() => null)) as WireDecision | null
  // OpenRouter のメッセージを AiError に入れないのは、画面に出す文言に外部の英語のエラーを混ぜないため
  if (!res.ok || !data || data.error || !data.answers) {
    console.error('[ai]', model, res.status, data?.error)
    throw new AiError('AI が応答を返せませんでした')
  }
  const promptTokens = data.usage?.input_tokens ?? 0
  return {
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, toAnswer(data.answers?.[key])])),
    usage: {
      promptTokens,
      completionTokens: data.usage?.output_tokens ?? 0,
      cost: data.usage?.cost ?? promptTokens * FALLBACK_INPUT_PRICE[model],
    },
  }
}
