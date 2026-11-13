import { AiError, isProviderEnabled, type AiMessage, type DecisionModel } from './ai'
import { decide } from './ai-decisions'
import type { AiLedger } from './ai-ledger'

// Jev を使わないのは、日本語の例で試したとき、教材と関係のないコードの作成の依頼を関係があると判定することが多かったため
/** 前から順に試し、判定できなかったら次のモデルに頼む。Span-01 Lite は無料なので先に使う */
const MODELS: readonly DecisionModel[] = ['respan/span-01-lite', 'respan/span-02']

// 確からしさを高めにしないのは、例で試したとき、関係のない依頼でも 0.6〜0.7 台にとどまるものがあったため
/** 教材と関係のない依頼だと判定する確からしさの下限 */
const OFF_TOPIC_THRESHOLD = 0.5

const MAX_MESSAGE_LENGTH = 4000
const MAX_HISTORY_LENGTH = 1000
const HISTORY_COUNT = 4

const BEHAVIOR =
  '利用者（教師）の最後の発言が、STEP Learn での教材の作業（コースの内容の確認・追加・変更、教材に載せる問題文や最初のコードやサンプルコードの作成、教材の構成の相談、STEP Learn の使い方）ではなく、教材と関係のないコードの作成・修正・デバッグ、翻訳、文章の代筆、雑談、一般的な質問を頼んでいる'

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

function describeHistory(messages: readonly AiMessage[]) {
  const lines = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-HISTORY_COUNT)
    .map((m) => `${m.role === 'user' ? '利用者' : 'AI'}: ${clip(m.content, MAX_HISTORY_LENGTH)}`)
  return lines.length > 0 ? lines.join('\n\n') : '（なし）'
}

/** 教材と関係のない依頼なら true。判定できないときは false にして、システムプロンプトでの断りに任せる */
export async function judgeOffTopic({
  message,
  history,
  page,
  ledger,
}: {
  message: string
  history: readonly AiMessage[]
  /** 利用者が開いている画面の説明 */
  page: string
  ledger: Pick<AiLedger, 'recordUsage' | 'withinMonthlyLimit'>
}) {
  // 判定できないときに弾かないのは、OpenRouter のキーがない・上限に達しただけで、教材の作業まで頼めなくなるため
  if (!isProviderEnabled('openrouter') || !ledger.withinMonthlyLimit('openrouter')) return false
  const state = [
    `【利用者が開いている画面】\n${page}`,
    `【これまでの会話】\n${describeHistory(history)}`,
    `【利用者の最後の発言】\n${clip(message, MAX_MESSAGE_LENGTH)}`,
  ].join('\n\n')
  for (const model of MODELS) {
    try {
      const { answers, usage } = await decide({ model, state, questions: { offTopic: { type: 'noul', instructions: BEHAVIOR } } })
      // 利用者に数えないのは、Claude で話している人まで OpenRouter の利用者に数え、週の枠を割る人数が増えるため
      ledger.recordUsage(null, model, usage)
      const answer = answers.offTopic
      if (answer?.type === 'noul') return answer.noul >= OFF_TOPIC_THRESHOLD
    } catch (e) {
      if (!(e instanceof AiError)) console.error('[ai]', e)
    }
  }
  return false
}
