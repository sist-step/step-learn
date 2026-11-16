import { and, eq } from 'drizzle-orm'
import { createAiAgent } from './ai-agent'
import { createAiChatStore } from './ai-chat'
import { DOCS_ABILITIES, docsTools } from './ai-docs'
import { AI_TOOLS } from './ai-tools'
import { aiUploadStore } from './ai-uploads'
import { pageTarget } from './ai-suggestions'
import { aiLedger } from './ai-usage'
import { courseAvailability } from './availability'
import { getCourseAccessFor, isVisibleItem } from './courses'
import { db } from './db'
import { aiChats, items } from './schema'
import { ITEM_TYPE_LABELS } from './types'
import type { AiToolContext } from './ai-tool-kit'

async function pageContext(c: AiToolContext, page: string) {
  const user = c.var.user!
  const match = page.match(/^\/courses\/(\d+)(?:\/items\/(\d+))?/)
  const access = match && (await getCourseAccessFor(user, Number(match[1])))
  if (!match || !access?.canManage) return `「${page || '/'}」の画面`
  const course = `コース「${access.course.title}」（course_id: ${access.course.id}）`
  const itemId = match[2] ? Number(match[2]) : null
  const item =
    itemId &&
    db
      .select({ title: items.title, type: items.type })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.courseId, access.course.id)))
      .get()
  return item ? `${course}の${ITEM_TYPE_LABELS[item.type]}のアイテム「${item.title}」（item_id: ${itemId}）の画面` : `${course}の画面`
}

const inCourse = (courseId: number, itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId)))
    .get()

// コースの下の画面をすべて開けることにしないのは、参加者や編集の画面のように教師にしか開けない画面があり、学生に開けるのはコースのページとアイテムの画面だけのため
async function canOpenPage(c: AiToolContext, page: string) {
  const user = c.var.user!
  const target = pageTarget(page)
  if (target.kind === 'admin') return user.role === 'admin'
  if (target.kind === 'other') return true
  const access = await getCourseAccessFor(user, target.courseId)
  if (!access) return false
  const { itemId } = target
  if (itemId !== null && !inCourse(access.course.id, itemId)) return false
  if (access.canManage) return true
  if (!target.view) return false
  return itemId === null || (isVisibleItem(itemId) && courseAvailability(user, access).items.get(itemId)?.open !== false)
}

/** 通常モード（step-learn.db）の AI アシスタント */
export const assistant = createAiAgent({
  tools: [...AI_TOOLS, ...docsTools(aiLedger)],
  ledger: aiLedger,
  chats: createAiChatStore({ db, aiChats }),
  pageContext,
  canOpenPage,
  files: aiUploadStore,
  abilities: [
    '利用者が管理しているコースの内容を読めます。',
    'セクションとアイテム（ページ・リンク・ファイル・コード）の追加と並べ替えは、すぐに実行されます。追加したものは学生に非表示の状態で作られるので、そのことを伝えてください。',
    '既存の内容の変更（update_section・update_item）と、学生への表示・非表示の切り替え（set_visibility）は、確認カードを出し、利用者が承認してから実行されます。',
    '書き換えるときは、先に get_item などで今の内容を読み、変える欄だけを全文で渡してください。',
    'ファイルのアイテムを追加するときと、ファイルを差し替えるときは、request_file で利用者にファイルを選んでもらい、返ってきた file_id を create_item・update_item に渡してください。受け取る種類は用途に合わせて絞ってください（配る資料なら pdf だけ、など）。受け取ったファイルの中身は読めません。',
    '削除、画面共有、参加者、コースの設定は扱えません。頼まれたら、できないことを伝え、画面での手順を案内してください。',
    ...DOCS_ABILITIES,
  ],
})
