import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../lib/db'
import { completions, courses, enrollments, items, surveyItems, surveyResponses, users } from '../../lib/schema'
import { DEFAULT_SURVEY_SETTINGS, summarizeSurvey, surveyPhase, type SurveyAnswer, type SurveySettings, type SurveyView } from './survey'

/** 設定の行がまだないアイテム（追加したばかり）は、問いのない既定の設定を返す */
export function getSurveySettings(itemId: number): SurveySettings {
  const row = db
    .select({
      questions: surveyItems.questions,
      anonymous: surveyItems.anonymous,
      showResults: surveyItems.showResults,
      allowEdit: surveyItems.allowEdit,
      opensAt: surveyItems.opensAt,
      closesAt: surveyItems.closesAt,
    })
    .from(surveyItems)
    .where(eq(surveyItems.itemId, itemId))
    .get()
  return row ?? DEFAULT_SURVEY_SETTINGS
}

export const saveSurveySettings = (itemId: number, settings: SurveySettings) =>
  db
    .insert(surveyItems)
    .values({ itemId, ...settings })
    .onConflictDoUpdate({ target: surveyItems.itemId, set: settings })
    .run()

export const responseCount = (itemId: number) => db.$count(surveyResponses, eq(surveyResponses.itemId, itemId))

export const responseOf = (itemId: number, userId: number) =>
  db
    .select({ answers: surveyResponses.answers, updatedAt: surveyResponses.updatedAt })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.itemId, itemId), eq(surveyResponses.userId, userId)))
    .get()

/** すべての回答。名前は匿名でないアンケートの画面でだけ出す */
export const responsesOf = (itemId: number) =>
  db
    .select({ name: users.name, username: users.username, answers: surveyResponses.answers, updatedAt: surveyResponses.updatedAt })
    .from(surveyResponses)
    .innerJoin(users, eq(users.id, surveyResponses.userId))
    .where(eq(surveyResponses.itemId, itemId))
    .orderBy(asc(surveyResponses.id))
    .all()

export const studentCount = (courseId: number) =>
  db.$count(enrollments, and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'student')))

/**
 * 回答を残す。replace なら前の回答を書き換え、そうでなければ前の回答があるときは残さない。
 * 残したら true。完了の条件が「回答したら完了」なら完了にする
 */
export function saveResponse(courseId: number, itemId: number, userId: number, answers: SurveyAnswer[], replace: boolean) {
  return db.transaction((tx) => {
    const insert = tx.insert(surveyResponses).values({ itemId, userId, answers })
    // 先に回答の有無を確かめるだけにしないのは、同時に 2 回送られたときに、両方が「まだない」とみなして二重に残るため
    const saved = replace
      ? insert.onConflictDoUpdate({ target: [surveyResponses.itemId, surveyResponses.userId], set: { answers } }).run()
      : insert.onConflictDoNothing().run()
    if (!saved.changes) return false
    const target = tx
      .select({ completion: items.completion, completionEnabled: courses.completionEnabled })
      .from(items)
      .innerJoin(courses, eq(courses.id, items.courseId))
      .where(and(eq(items.id, itemId), eq(items.courseId, courseId)))
      .get()
    if (target?.completion === 'answer' && target.completionEnabled)
      tx.insert(completions).values({ userId, itemId, courseId }).onConflictDoNothing().run()
    return true
  })
}

export const surveyItemUrl = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}`

export async function surveyViewOf(
  courseId: number,
  itemId: number,
  viewer: { userId: number; student: boolean; manage: boolean; editing: boolean },
): Promise<SurveyView> {
  const settings = getSurveySettings(itemId)
  const itemUrl = surveyItemUrl(courseId, itemId)
  const view = { itemUrl, base: `${itemUrl}/survey`, settings, phase: surveyPhase(settings, Math.floor(Date.now() / 1000)) }
  const manage = viewer.manage ? { responses: await responseCount(itemId), students: await studentCount(courseId) } : null
  if (!viewer.student) return { ...view, manage, mine: null, results: null }
  const answers = responseOf(itemId, viewer.userId)?.answers ?? null
  const all = answers && settings.showResults ? responsesOf(itemId) : null
  const results = all
    ? {
        total: all.length,
        summaries: summarizeSurvey(
          settings.questions.filter((q) => q.kind !== 'text'),
          all,
        ),
      }
    : null
  return { ...view, manage, mine: { answers, editing: viewer.editing && !!settings.allowEdit }, results }
}
