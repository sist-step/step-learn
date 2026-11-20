import type { Context } from 'hono'
import { AI_PROVIDERS, hasAiEmail, isProviderEnabled } from '../lib/ai'
import { createAiAgent } from '../lib/ai-agent'
import { createAiChatStore } from '../lib/ai-chat'
import { DOCS_ABILITIES, docsTools } from '../lib/ai-docs'
import { pageTarget } from '../lib/ai-suggestions'
import type { AiToolContext } from '../lib/ai-tool-kit'
import { aiLedger } from './ai-usage'
import { codeKind, kindLabel, MOODLE_AI_TOOLS, readMoodleItemFile } from './ai-tools'
import { moodleAiUploadStore } from './ai-uploads'
import type { MoodleEnv } from './auth'
import { loadCourse, myCourses, outlineOf } from './data'
import { db } from './db'
import { aiChats } from './schema'

/** サイト管理者か、いずれかのコースを管理できる人。通常モードの canUseAi（lib/ai-usage.ts）と同じ条件を、Moodle のロールで確かめる */
export const canUseMoodleAi = async (c: Context<MoodleEnv>) => AI_PROVIDERS.some(isProviderEnabled) && (await isMoodleAiTeacher(c))

/** AI_EMAIL_DOMAIN のメールで、サイト管理者かいずれかのコースを管理できる人。MCP はこれだけで決める（lib/ai-usage.ts の isAiTeacher と同じ） */
export async function isMoodleAiTeacher(c: Context<MoodleEnv>) {
  const user = c.var.user
  if (!user || !hasAiEmail(user.email)) return false
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
    return item ? `${course}の${kindLabel(item)}のアイテム「${item.title}」（item_id: ${item.id}）の画面` : `${course}の画面`
  } catch {
    return `「${page}」の画面`
  }
}

// コースの下の画面をすべて開けることにしないのは、編集の画面のように教師にしか開けない画面があり、学生に開けるのはコースのページとアイテムの画面だけのため
async function canOpenPage(c: AiToolContext, page: string) {
  const target = pageTarget(page)
  if (target.kind === 'admin') return c.var.user!.role === 'admin'
  if (target.kind === 'other') return true
  try {
    const loaded = await loadCourse(c as Context<MoodleEnv>, target.courseId)
    const item = target.itemId === null ? null : loaded.items.find((it) => it.id === target.itemId)
    if (item === undefined) return false
    if (loaded.access.canManage) return true
    if (!target.view) return false
    return !item || (!item.locked && outlineOf(loaded).some((o) => o.id === item.id))
  } catch {
    // 開けないことにするのは、参加していないコースでは Moodle がエラーを返し、つながらないときと見分けられないため
    return false
  }
}

async function focusOf(c: AiToolContext, courseId: number, itemId: number) {
  try {
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = loaded.access.canManage ? loaded.items.find((it) => it.id === itemId && codeKind(it)) : undefined
    return item ? { courseId: loaded.course.id, itemId, title: item.title } : null
  } catch {
    return null
  }
}

/** Moodle モード（moodle-mode.db に会話と使用量、教材は Moodle）の AI アシスタント */
export const moodleAssistant = createAiAgent({
  tools: [...MOODLE_AI_TOOLS, ...docsTools(aiLedger)],
  ledger: aiLedger,
  chats: createAiChatStore({ db, aiChats }),
  pageContext,
  canOpenPage,
  files: moodleAiUploadStore,
  readFile: readMoodleItemFile,
  focusOf,
  abilities: [
    '利用者が管理しているコースの内容を読めます。教材は Moodle にあり、Moodle の活動（課題・小テストなど）は名前と種類だけが分かります。',
    'セクションとアイテム（リンク・ファイル・コーディング問題）の追加と並べ替えは、すぐに実行されます。追加したものは学生に非表示の状態で作られるので、そのことを伝えてください。',
    '既存の内容の変更（update_section・update_item）と、学生への表示・非表示の切り替え（set_visibility）は、確認カードを出し、利用者が承認してから実行されます。変えられるアイテムはリンク・ファイル・コーディング問題だけです。',
    '書き換えるときは、先に get_item などで今の内容を読み、変える欄だけを全文で渡してください。',
    'ファイルのアイテムを追加するときと、ファイルを差し替えるときは、request_file で利用者にファイルを選んでもらい、返ってきた file_id を create_item・update_item に渡してください。受け取る種類は用途に合わせて絞ってください（配る資料なら pdf だけ、など）。受け取ったファイルの中身は読めません。',
    '削除、Moodle の活動の中身、アクセス制限、参加者、コースの設定は扱えません。頼まれたら、できないことを伝え、STEP Learn か Moodle の画面での手順を案内してください。',
    ...DOCS_ABILITIES,
  ],
})
