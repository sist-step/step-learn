import { and, eq } from 'drizzle-orm'
import { canOpenItem } from '../../lib/availability'
import { grader } from '../../lib/code-grading'
import { codeStore, getCodeItem } from '../../lib/code-items'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { items } from '../../lib/schema'
import type { CodeBackend } from './handlers'

/** 通常モード: 設定・書きかけのコード・提出を step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: CodeBackend = {
  grader,
  pageUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    if (!access) return null
    const item = db
      .select({ title: items.title, body: items.body })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, 'code')))
      .get()
    const code = item && getCodeItem(itemId)
    if (!code || !canOpenItem(c.var.user!, access, itemId, isVisibleItem(itemId))) return null
    const period = { opensAt: code.opensAt, closesAt: code.closesAt }
    return { access, itemId, settings: { ...item, ...code }, period, store: codeStore(courseId, itemId) }
  },
}
