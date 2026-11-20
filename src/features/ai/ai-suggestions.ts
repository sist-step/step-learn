// DB を読み込まず、使用量と画面の説明を渡して作るのは、通常モードと Moodle モードの AI エージェント（features/ai/ai-agent.ts）で同じ候補の作り方を使うため
import { AiError, complete, isProviderEnabled, type AiMessage } from './ai'
import type { AiLedger } from './ai-ledger'
import type { AiToolContext } from './ai-tool-kit'

const MODEL = 'claude-haiku-5-5'

const COUNT = 3

const MAX_LENGTH = 40

/** 作れなかったときに出す候補。どの画面でも送れるものにする */
const DEFAULT_SUGGESTIONS = [
  'このコースの構成を要約して',
  '開いているページの誤字や分かりにくい表現を直して',
  '新しいセクションを作って、授業の流れを説明するページを追加して',
]

// ずっと使い続けないのは、画面の説明（コースやアイテムの名前）が変わらなくても、中身が変わって候補が合わなくなることがあるため
const TTL = 7 * 24 * 60 * 60 * 1000

// 失敗したら次の要求ですぐ作り直さないのは、API が落ちているあいだ、パネルを開くたびに失敗する要求を送り続けることになるため
const FAILURE_TTL = 10 * 60 * 1000

const MAX_ENTRIES = 1000

const LEADING_MARK = /^\s*(?:[-*・•]|\d+[.)．、）])\s*/

function parse(text: string) {
  const lines = text
    .split('\n')
    .map((line) =>
      line
        .replace(LEADING_MARK, '')
        .trim()
        .replace(/^「(.+)」$/, '$1'),
    )
    .filter((line) => line && line.length <= MAX_LENGTH)
  return [...new Set(lines)].slice(0, COUNT)
}

/**
 * パスが指す画面。course の itemId はアイテムの下の画面のときだけ入り、view はコースのページかアイテムの画面そのもの（学生も開ける画面）のとき true。
 * ID が大きすぎて読めないものは、どのコースにも当たらない 0 にする
 */
type PageTarget = { kind: 'admin' } | { kind: 'course'; courseId: number; itemId: number | null; view: boolean } | { kind: 'other' }

const toId = (s: string) => (Number.isSafeInteger(Number(s)) ? Number(s) : 0)

export function pageTarget(page: string): PageTarget {
  if (/^\/admin(?:\/|$)/.test(page)) return { kind: 'admin' }
  const match = page.match(/^\/courses\/(\d+)(?:\/items\/(\d+))?(\/.*)?$/)
  if (!match) return { kind: 'other' }
  const [, courseId, itemId, rest] = match
  return { kind: 'course', courseId: toId(courseId), itemId: itemId ? toId(itemId) : null, view: !rest }
}

export function createAiSuggester({
  ledger,
  pageContext,
  canOpenPage,
  abilities,
}: {
  ledger: Pick<AiLedger, 'recordUsage' | 'withinMonthlyLimit' | 'isModelAvailable'>
  pageContext: (c: AiToolContext, page: string) => Promise<string>
  canOpenPage: (c: AiToolContext, page: string) => Promise<boolean>
  abilities: readonly string[]
}) {
  // DB に置かないのは、作り直しても Haiku なら 1 回あたりの額がごくわずかで、再起動で消えても困らないため
  const cache = new Map<string, { suggestions: string[]; expires: number }>()
  const running = new Map<string, Promise<string[]>>()

  const usable = () => isProviderEnabled('anthropic') && ledger.withinMonthlyLimit('anthropic') && ledger.isModelAvailable(MODEL)

  const instructions: AiMessage = {
    role: 'system',
    content: [
      '学習管理システム「STEP Learn」で、教師の作業を手伝う AI アシスタントのパネルに出す、依頼の候補を考えてください。',
      'パネルを開いた教師が、ボタンを押すだけでそのまま AI アシスタントに送れる依頼です。',
      '',
      `- 開いている画面でしそうな作業に合わせた依頼を ${COUNT} つ考えてください。`,
      '- 下の「AI アシスタントができること」でできる依頼だけにしてください。',
      `- 1 つ ${MAX_LENGTH} 文字以内の、教師の立場で書いた依頼文（「〜して」など）にしてください。ID は書かず、名前で書いてください。`,
      '- 1 行に 1 つずつ、番号や記号やかぎかっこを付けずに、候補だけを書いてください。',
      '',
      '【AI アシスタントができること】',
      '- STEP Learn でのコースや教材の作業（内容の確認・追加・変更、教材の構成や問題の相談、STEP Learn の使い方）と、STEP の活動のマニュアル（STEP Docs）についての質問',
      ...abilities.map((a) => `- ${a}`),
    ].join('\n'),
  }

  async function generate(page: string, context: string) {
    const reply = await complete({
      model: MODEL,
      maxTokens: 2000,
      messages: [instructions, { role: 'user', content: `開いている画面: ${context}\nURL のパス: ${page || '/'}` }],
    })
    // 利用者に数えないのは、作った候補は同じ画面を開いた人みんなに出すので、最初に開いた人の週の枠だけを減らすことになるため
    ledger.recordUsage(null, MODEL, reply.usage)
    return reply.stop === 'end' ? parse(reply.text) : []
  }

  function remember(key: string, suggestions: string[]) {
    cache.delete(key)
    cache.set(key, { suggestions, expires: Date.now() + (suggestions.length > 0 ? TTL : FAILURE_TTL) })
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }

  /** page を開いている人に出す候補。作れなければ DEFAULT_SUGGESTIONS、その人が page を開けなければ null */
  return async function suggest(c: AiToolContext, page: string) {
    // キャッシュに当たったときも確かめを省かないのは、ほかの人が開いて作った候補を、開けない人にキャッシュから返すことになるため
    if (!(await canOpenPage(c, page))) return null
    const context = await pageContext(c, page)
    // パスだけを鍵にしないのは、同じパスでもコースを管理できる人とできない人で説明が変わり、管理できない人にコースの名前を含む候補を見せることになるため
    const key = `${page}\n${context}`
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.suggestions.length > 0 ? hit.suggestions : DEFAULT_SUGGESTIONS
    if (!usable()) return DEFAULT_SUGGESTIONS
    let task = running.get(key)
    if (!task) {
      task = generate(page, context)
        .catch((e: unknown) => {
          if (!(e instanceof AiError)) console.error('[ai]', e)
          return []
        })
        .then((suggestions) => {
          remember(key, suggestions)
          return suggestions
        })
        .finally(() => running.delete(key))
      running.set(key, task)
    }
    const suggestions = await task
    return suggestions.length > 0 ? suggestions : DEFAULT_SUGGESTIONS
  }
}
