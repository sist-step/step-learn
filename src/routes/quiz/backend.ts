import { and, eq } from 'drizzle-orm'
import { canOpenItem } from '../../lib/availability'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { QUIZ_KIND } from '../../lib/quiz'
import { getQuizSettings, quizStore } from '../../lib/quiz-items'
import { items } from '../../lib/schema'
import type { QuizBackend } from './handlers'

/** 通常モード: 設定と受験の記録を step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: QuizBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    if (!access) return null
    const item = db
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, QUIZ_KIND)))
      .get()
    if (!item || !canOpenItem(c.var.user!, access, itemId, isVisibleItem(itemId))) return null
    return { access, item, settings: getQuizSettings(itemId), store: quizStore(courseId, itemId) }
  },
}
