import { and, eq } from 'drizzle-orm'
import { credentialStampOf } from '../../lib/auth'
import { grader } from './code-grading'
import { codeStore, getCodeItem } from './code-items'
import type { CourseAccess } from '../../lib/courses'
import { db } from '../../lib/db'
import { findUser, itemIdOfRef, openItem, openItemFor, type OpenedItem } from '../../lib/item-access'
import { completions } from '../../lib/schema'
import type { Completion } from '../../lib/types'
import type { CodeBackend } from './handlers'

const REF_PREFIX = 'code-'

/** 開けたアイテムの、設定と置き場所。コードの設定がまだなければ null */
function codeOf({ access, itemId, item }: OpenedItem) {
  const code = getCodeItem(itemId)
  if (!code) return null
  return {
    access,
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
  stampOf: credentialStampOf,
  pageUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/code`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const opened = await openItem(c, 'code')
    const found = opened && codeOf(opened)
    if (!found) return null
    const { completion, ...rest } = found
    const itemId = opened.itemId
    return { ...rest, itemId, ref: `${REF_PREFIX}${itemId}`, completion: completionOf(c.var.user!.id, itemId, found.access, completion) }
  },
  async targetOf(ref, userId) {
    const itemId = itemIdOfRef(REF_PREFIX, ref)
    const user = itemId && findUser(userId)
    const opened = user && (await openItemFor(user, 'code', itemId))
    const found = opened && codeOf(opened)
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
      itemId: opened.itemId,
    }
  },
}
