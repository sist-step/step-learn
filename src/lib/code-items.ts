import { and, desc, eq, sql } from 'drizzle-orm'
import { filesFor, type CodeFiles, type CodeLanguage } from './code'
import type { CodeStore } from './code-store'
import { db, type DB } from './db'
import { codeDrafts, codeItems, codeSubmissions, enrollments, users } from './schema'

export const getCodeItem = (itemId: number) => db.select().from(codeItems).where(eq(codeItems.itemId, itemId)).get()

export const updateCodeItem = (
  itemId: number,
  language: CodeLanguage,
  { starter, stdin, criteria, maxScore }: { starter: CodeFiles; stdin: string; criteria: string; maxScore: number },
) =>
  db
    .update(codeItems)
    .set({ starter: filesFor(language, starter), stdin: language === 'python' ? stdin : '', criteria, maxScore })
    .where(eq(codeItems.itemId, itemId))
    .run()

const SUMMARY = {
  id: codeSubmissions.id,
  userId: codeSubmissions.userId,
  status: codeSubmissions.status,
  score: codeSubmissions.score,
  teacherScore: codeSubmissions.teacherScore,
  createdAt: codeSubmissions.createdAt,
}

const STUDENT = { id: users.id, name: users.name, username: users.username, email: users.email }

/** 通常モード（step-learn.db）の、アイテム 1 つの書きかけのコードと提出 */
export function codeStore(courseId: number, itemId: number): CodeStore {
  const ofItem = eq(codeSubmissions.itemId, itemId)
  const ofUser = (userId: number) => and(ofItem, eq(codeSubmissions.userId, userId))
  const byId = (id: number) => and(ofItem, eq(codeSubmissions.id, id))

  const saveDraft = (userId: number, files: CodeFiles, stdin: string, executor: Pick<DB, 'insert'> = db) =>
    executor
      .insert(codeDrafts)
      .values({ itemId, userId, files, stdin })
      // $onUpdate に任せないのは、競合したときの更新には効かないため
      .onConflictDoUpdate({ target: [codeDrafts.itemId, codeDrafts.userId], set: { files, stdin, updatedAt: sql`(unixepoch())` } })
      .run()

  return {
    getDraft: (userId) =>
      db
        .select({ files: codeDrafts.files, stdin: codeDrafts.stdin })
        .from(codeDrafts)
        .where(and(eq(codeDrafts.itemId, itemId), eq(codeDrafts.userId, userId)))
        .get(),
    saveDraft: (userId, files, stdin) => void saveDraft(userId, files, stdin),
    submit: (userId, files, stdin, status) =>
      db.transaction((tx) => {
        const { id } = tx.insert(codeSubmissions).values({ itemId, userId, files, status }).returning({ id: codeSubmissions.id }).get()
        saveDraft(userId, files, stdin, tx)
        return id
      }),
    getSubmission: (id) => db.select().from(codeSubmissions).where(byId(id)).get(),
    latestSubmission: (userId) => db.select().from(codeSubmissions).where(ofUser(userId)).orderBy(desc(codeSubmissions.id)).limit(1).get(),
    listSubmissions: () => db.select(SUMMARY).from(codeSubmissions).where(ofItem).orderBy(desc(codeSubmissions.id)).limit(5000).all(),
    listUserSubmissions: (userId) =>
      db.select(SUMMARY).from(codeSubmissions).where(ofUser(userId)).orderBy(desc(codeSubmissions.id)).limit(100).all(),
    review: (id, teacherScore, teacherComment) =>
      void db.update(codeSubmissions).set({ teacherScore, teacherComment }).where(byId(id)).run(),
    setStatus: (id, status) => void db.update(codeSubmissions).set({ status }).where(byId(id)).run(),
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
