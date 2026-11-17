import { and, eq } from 'drizzle-orm'
import { canOpenItem } from '../../lib/availability'
import { grader } from '../../lib/code-grading'
import { codeStore, getCodeItem } from '../../lib/code-items'
import { getCourseAccess, getCourseAccessFor, isVisibleItem, type CourseAccess } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { completions, items, users } from '../../lib/schema'
import type { Completion, User } from '../../lib/types'
import type { CodeBackend } from './handlers'

const REF_PREFIX = 'code-'

const findUser = (userId: number): User | undefined =>
  db
    .select({ id: users.id, email: users.email, name: users.name, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()

/** user がアイテムを開けるなら、設定と置き場所。access を渡さなければ、ここでコースの権限を確かめる */
async function openable(user: User, itemId: number, access?: CourseAccess | null) {
  const item = db
    .select({ courseId: items.courseId, title: items.title, body: items.body, completion: items.completion })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.type, 'code')))
    .get()
  const code = item && getCodeItem(itemId)
  if (!item || !code) return null
  const granted = access ?? (await getCourseAccessFor(user, item.courseId))
  if (!granted || granted.course.id !== item.courseId || !canOpenItem(user, granted, itemId, isVisibleItem(itemId))) return null
  return {
    access: granted,
    completion: item.completion,
    settings: { title: item.title, body: item.body, ...code, solutionPublic: code.solutionPublic === 1 },
    stage: code.stage,
    period: { opensAt: code.opensAt, closesAt: code.closesAt },
    store: codeStore(item.courseId, itemId),
  }
}

/** 学生に見せる完了の状態。完了を数えないコースやアイテムなら undefined */
function completionOf(userId: number, itemId: number, access: CourseAccess, completion: Completion) {
  if (access.role !== 'student' || !access.course.completionEnabled || completion === 'none') return undefined
  const done = !!db
    .select({ itemId: completions.itemId })
    .from(completions)
    .where(and(eq(completions.userId, userId), eq(completions.itemId, itemId)))
    .get()
  return { completion, done }
}

/** 通常モード: 設定・書きかけのコード・提出を step-learn.db に置き、権限をコースの参加者とアイテムのアクセス制限から確かめる */
export const backend: CodeBackend = {
  grader,
  pageUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/code`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    const found = access && (await openable(c.var.user!, itemId, access))
    if (!found) return null
    const { completion, ...rest } = found
    return { ...rest, itemId, ref: `${REF_PREFIX}${itemId}`, completion: completionOf(c.var.user!.id, itemId, found.access, completion) }
  },
  async targetOf(ref, userId) {
    const itemId = Number(ref.slice(REF_PREFIX.length))
    const user = ref.startsWith(REF_PREFIX) && Number.isSafeInteger(itemId) && findUser(userId)
    const found = user && (await openable(user, itemId))
    if (!found) return null
    const { access, settings, stage, period, store } = found
    return {
      settings,
      stage,
      period,
      store,
      course: access.course.title,
      isStudent: access.role === 'student',
      courseId: access.course.id,
      itemId,
    }
  },
}
