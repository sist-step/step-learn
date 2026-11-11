import type { Context } from 'hono'
import { AI_PROVIDERS, hasAiEmail, isProviderEnabled } from '../lib/ai'
import { createAiAgent } from '../lib/ai-agent'
import { createAiChatStore } from '../lib/ai-chat'
import type { AiToolContext } from '../lib/ai-tool-kit'
import { aiLedger } from './ai-usage'
import { MOODLE_AI_TOOLS } from './ai-tools'
import type { MoodleEnv } from './auth'
import { loadCourse, myCourses } from './data'
import { db } from './db'
import { aiChats } from './schema'

/** サイト管理者か、いずれかのコースを管理できる人。通常モードの canUseAi（lib/ai-usage.ts）と同じ条件を、Moodle のロールで確かめる */
export async function canUseMoodleAi(c: Context<MoodleEnv>) {
  const user = c.var.user
  if (!user || !AI_PROVIDERS.some(isProviderEnabled) || !hasAiEmail(user.email)) return false
  if (user.role === 'admin') return true
  return (await myCourses(c)).some((m) => m.canmanage)
}

async function pageContext(c: AiToolContext, page: string) {
  const match = page.match(/^\/courses\/(\d+)(?:\/items\/(\d+))?/)
  if (!match) return `「${page || '/'}」の画面`
  try {
    const loaded = await loadCourse(c as Context<MoodleEnv>, Number(match[1]))
    if (!loaded.access.canManage) return `「${page}」の画面`
    const course = `コース「${loaded.course.fullname}」（course_id: ${loaded.course.id}）`
    const item = match[2] ? loaded.items.find((it) => it.id === Number(match[2])) : undefined
    return item ? `${course}のアイテム「${item.title}」（item_id: ${item.id}）の画面` : `${course}の画面`
  } catch {
    return `「${page}」の画面`
  }
}

/** Moodle モード（moodle-mode.db に会話と使用量、教材は Moodle）の AI アシスタント */
export const moodleAssistant = createAiAgent({
  tools: MOODLE_AI_TOOLS,
  ledger: aiLedger,
  chats: createAiChatStore({ db, aiChats }),
  pageContext,
  abilities: [
    '利用者が管理しているコースの内容を読めます。教材は Moodle にあり、Moodle の活動（課題・小テストなど）は名前と種類だけが分かります。',
    'セクションとアイテム（リンク・コード）の追加と並べ替えは、すぐに実行されます。追加したものは学生に非表示の状態で作られるので、そのことを伝えてください。',
    '既存の内容の変更（update_section・update_item）と、学生への表示・非表示の切り替え（set_visibility）は、確認カードを出し、利用者が承認してから実行されます。変えられるアイテムはリンクとコードだけです。',
    '書き換えるときは、先に get_item などで今の内容を読み、変える欄だけを全文で渡してください。',
    '削除、ファイルのアップロード、Moodle の活動の中身、アクセス制限、参加者、コースの設定は扱えません。頼まれたら、できないことを伝え、STEP Learn か Moodle の画面での手順を案内してください。',
  ],
})
