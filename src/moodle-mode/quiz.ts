import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { intParam } from '../lib/http'
import { QUIZ_KIND, isQuizPassed, quizSettingsOf } from '../lib/quiz'
import type { QuizStore } from '../lib/quiz-store'
import type { QuizBackend } from '../routes/quiz/handlers'
import type { MoodleEnv } from './auth'
import { loadCourse, outlineOf } from './data'
import { db } from './db'
import { quizAttempts, users } from './schema'

const SUMMARY = {
  id: quizAttempts.id,
  userId: quizAttempts.userId,
  correct: quizAttempts.correct,
  total: quizAttempts.total,
  passed: quizAttempts.passed,
  // 列を足さずに答えの JSON から数えるのは、採点待ちは記述の問題にしか出ず、点数と同じく教師の採点で変わるため
  pending:
    sql<number>`(SELECT count(*) FROM json_each(${quizAttempts.answers}) WHERE json_extract(json_each.value, '$.correct') IS NULL)`.mapWith(
      Number,
    ),
  createdAt: quizAttempts.createdAt,
}

const ATTEMPT = { ...SUMMARY, answers: quizAttempts.answers }

const STUDENT = { id: users.id, name: users.name, username: users.username, email: users.email }

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの受験の記録。key は extra_items の key */
export function quizStore(key: string): QuizStore {
  const ofItem = eq(quizAttempts.key, key)
  const ofUser = (userId: number) => and(ofItem, eq(quizAttempts.userId, userId))
  return {
    listOf: (userId) => db.select(SUMMARY).from(quizAttempts).where(ofUser(userId)).orderBy(desc(quizAttempts.id)).limit(200).all(),
    get: (userId, id) =>
      db
        .select(ATTEMPT)
        .from(quizAttempts)
        .where(and(ofUser(userId), eq(quizAttempts.id, id)))
        .get(),
    latest: (userId) => db.select(ATTEMPT).from(quizAttempts).where(ofUser(userId)).orderBy(desc(quizAttempts.id)).limit(1).get(),
    listAll: () => db.select(SUMMARY).from(quizAttempts).where(ofItem).orderBy(desc(quizAttempts.id)).limit(5000).all(),
    answersOf: (ids) =>
      ids.length
        ? db
            .select({ answers: quizAttempts.answers })
            .from(quizAttempts)
            .where(and(ofItem, inArray(quizAttempts.id, ids)))
            .all()
        : [],
    // 合格しても完了にしないのは、完了は Moodle の活動が持ち、STEP Learn から付けられるのは「開いたら完了」だけなため
    record(userId, graded, passPercent) {
      const passed = isQuizPassed(graded, passPercent)
      db.insert(quizAttempts)
        .values({ key, userId, answers: graded.records, correct: graded.correct, total: graded.total, passed: passed ? 1 : 0 })
        .run()
      return passed
    },
    regrade(userId, id, graded, passPercent) {
      const passed = isQuizPassed(graded, passPercent)
      db.update(quizAttempts)
        .set({ answers: graded.records, correct: graded.correct, total: graded.total, passed: passed ? 1 : 0 })
        .where(and(ofUser(userId), eq(quizAttempts.id, id)))
        .run()
    },
    // コースの学生を並べないのは、参加者が Moodle にあり、STEP Learn は自分にログインした人しか知らないため。受けた人だけを並べる
    listStudents: () =>
      db
        .selectDistinct(STUDENT)
        .from(quizAttempts)
        .innerJoin(users, eq(users.id, quizAttempts.userId))
        .where(ofItem)
        .orderBy(users.name)
        .limit(1000)
        .all(),
    findUser: (userId) => db.select(STUDENT).from(users).where(eq(users.id, userId)).get(),
  }
}

/** Moodle モード: 設定を extra_items に、受験の記録を moodle-mode.db に置き、権限を Moodle のコースから確かめる */
export const quizBackend: QuizBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = outlineOf(loaded).find((it) => it.id === itemId && !it.locked && it.extra?.type === QUIZ_KIND)
    if (!item?.extraKey || !item.extra) return null
    return {
      access: loaded.access,
      item: { id: itemId, title: item.title },
      settings: quizSettingsOf(item.extra.data),
      store: quizStore(item.extraKey),
    }
  },
}
