import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { DEFAULT_QUIZ_SETTINGS, isQuizPassed, quizPercent, type QuizSettings } from './quiz'
import type { QuizStore } from './quiz-store'
import { completions, courses, enrollments, items, quizAttempts, quizItems, users } from './schema'

/** 設定の行がまだないアイテム（追加したばかり）は、問題のない既定の設定を返す */
export const getQuizSettings = (itemId: number): QuizSettings =>
  db
    .select({
      questions: quizItems.questions,
      passPercent: quizItems.passPercent,
      showAnswers: quizItems.showAnswers,
      look: quizItems.look,
    })
    .from(quizItems)
    .where(eq(quizItems.itemId, itemId))
    .get() ?? DEFAULT_QUIZ_SETTINGS

export const saveQuizSettings = (itemId: number, settings: QuizSettings) =>
  db
    .insert(quizItems)
    .values({ itemId, ...settings })
    .onConflictDoUpdate({ target: quizItems.itemId, set: settings })
    .run()

const SUMMARY = {
  id: quizAttempts.id,
  userId: quizAttempts.userId,
  correct: quizAttempts.correct,
  total: quizAttempts.total,
  passed: quizAttempts.passed,
  createdAt: quizAttempts.createdAt,
}

const STUDENT = { id: users.id, name: users.name, username: users.username, email: users.email }

/** 通常モード（step-learn.db）の、アイテム 1 つの受験の記録 */
export function quizStore(courseId: number, itemId: number): QuizStore {
  const ofItem = eq(quizAttempts.itemId, itemId)
  const ofUser = (userId: number) => and(ofItem, eq(quizAttempts.userId, userId))
  return {
    listOf: (userId) => db.select(SUMMARY).from(quizAttempts).where(ofUser(userId)).orderBy(desc(quizAttempts.id)).limit(200).all(),
    get: (userId, id) =>
      db
        .select()
        .from(quizAttempts)
        .where(and(ofUser(userId), eq(quizAttempts.id, id)))
        .get(),
    latest: (userId) => db.select().from(quizAttempts).where(ofUser(userId)).orderBy(desc(quizAttempts.id)).limit(1).get(),
    listAll: () => db.select(SUMMARY).from(quizAttempts).where(ofItem).orderBy(desc(quizAttempts.id)).limit(5000).all(),
    answersOf: (ids) =>
      ids.length
        ? db
            .select({ answers: quizAttempts.answers })
            .from(quizAttempts)
            .where(and(ofItem, inArray(quizAttempts.id, ids)))
            .all()
        : [],
    record: (userId, graded, passPercent) =>
      db.transaction((tx) => {
        const passed = isQuizPassed(graded, passPercent)
        tx.insert(quizAttempts)
          .values({ itemId, userId, answers: graded.records, correct: graded.correct, total: graded.total, passed: passed ? 1 : 0 })
          .run()
        if (!passed) return passed
        const target = tx
          .select({ completion: items.completion, completionEnabled: courses.completionEnabled })
          .from(items)
          .innerJoin(courses, eq(courses.id, items.courseId))
          .where(and(eq(items.id, itemId), eq(items.courseId, courseId)))
          .get()
        // 次の受験で不合格になっても完了を取り消さないのは、ほかの完了の条件と同じく、一度満たしたら完了のままにするため
        if (target?.completion === 'pass' && target.completionEnabled)
          tx.insert(completions).values({ userId, itemId, courseId }).onConflictDoNothing().run()
        return passed
      }),
    listStudents: () =>
      db
        .select(STUDENT)
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'student')))
        .orderBy(users.name)
        .limit(1000)
        .all(),
    findUser: (userId) => db.select(STUDENT).from(users).where(eq(users.id, userId)).get(),
  }
}

/** アクセス制限の判定に使う、学生 1 人の小テストごとの成績。percent はいちばん高い正解の割合 */
export function quizGradesOf(userId: number, itemIds: number[]) {
  const grades = new Map<number, { percent: number; passed: boolean }>()
  if (!itemIds.length) return grades
  const rows = db
    .select({ itemId: quizAttempts.itemId, correct: quizAttempts.correct, total: quizAttempts.total, passed: quizAttempts.passed })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), inArray(quizAttempts.itemId, itemIds)))
    .all()
  for (const row of rows) {
    const prev = grades.get(row.itemId)
    grades.set(row.itemId, { percent: Math.max(quizPercent(row), prev?.percent ?? 0), passed: !!row.passed || !!prev?.passed })
  }
  return grades
}
