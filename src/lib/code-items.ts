import { and, desc, eq, sql } from 'drizzle-orm'
import { CODE_LANGUAGES, filesFor, type CodeFiles, type CodeLanguage, type GradingStatus } from './code'
import { db, type DB } from './db'
import { sandboxEnabled } from './sandbox'
import { codeDrafts, codeItems, codeSubmissions } from './schema'

/** Python は sandbox が設定されているときだけ選べる */
export const availableCodeLanguages: readonly CodeLanguage[] = CODE_LANGUAGES.filter((l) => l !== 'python' || sandboxEnabled)

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

// ---------------------------------------------------------------- 書きかけのコード

const ownDraft = (itemId: number, userId: number) => and(eq(codeDrafts.itemId, itemId), eq(codeDrafts.userId, userId))

export const getDraft = (itemId: number, userId: number) =>
  db
    .select({ files: codeDrafts.files, stdin: codeDrafts.stdin, updatedAt: codeDrafts.updatedAt })
    .from(codeDrafts)
    .where(ownDraft(itemId, userId))
    .get()

export const saveDraft = (itemId: number, userId: number, files: CodeFiles, stdin: string, executor: Pick<DB, 'insert'> = db) =>
  executor
    .insert(codeDrafts)
    .values({ itemId, userId, files, stdin })
    // $onUpdate に任せないのは、競合したときの更新には効かないため
    .onConflictDoUpdate({ target: [codeDrafts.itemId, codeDrafts.userId], set: { files, stdin, updatedAt: sql`(unixepoch())` } })
    .run()

// ---------------------------------------------------------------- 提出

const submissionOf = (itemId: number, id: number) => and(eq(codeSubmissions.id, id), eq(codeSubmissions.itemId, itemId))

export const getSubmission = (itemId: number, id: number) => db.select().from(codeSubmissions).where(submissionOf(itemId, id)).get()

export const latestSubmission = (itemId: number, userId: number) =>
  db
    .select()
    .from(codeSubmissions)
    .where(and(eq(codeSubmissions.itemId, itemId), eq(codeSubmissions.userId, userId)))
    .orderBy(desc(codeSubmissions.id))
    .limit(1)
    .get()

const SUMMARY = {
  id: codeSubmissions.id,
  userId: codeSubmissions.userId,
  status: codeSubmissions.status,
  score: codeSubmissions.score,
  teacherScore: codeSubmissions.teacherScore,
  createdAt: codeSubmissions.createdAt,
}

/** アイテムのすべての提出（新しい順）。中身のコードは含めない */
export const listSubmissions = (itemId: number) =>
  db.select(SUMMARY).from(codeSubmissions).where(eq(codeSubmissions.itemId, itemId)).orderBy(desc(codeSubmissions.id)).limit(5000).all()

export const listUserSubmissions = (itemId: number, userId: number) =>
  db
    .select(SUMMARY)
    .from(codeSubmissions)
    .where(and(eq(codeSubmissions.itemId, itemId), eq(codeSubmissions.userId, userId)))
    .orderBy(desc(codeSubmissions.id))
    .limit(100)
    .all()

/** 提出を残し、書きかけのコードも同じ内容にそろえる。提出の ID を返す */
export const submitCode = (itemId: number, userId: number, files: CodeFiles, stdin: string, status: GradingStatus) =>
  db.transaction((tx) => {
    const { id } = tx.insert(codeSubmissions).values({ itemId, userId, files, status }).returning({ id: codeSubmissions.id }).get()
    saveDraft(itemId, userId, files, stdin, tx)
    return id
  })

export const reviewSubmission = (itemId: number, id: number, teacherScore: number | null, teacherComment: string) =>
  db.update(codeSubmissions).set({ teacherScore, teacherComment }).where(submissionOf(itemId, id)).run()

export const setGradingStatus = (itemId: number, id: number, status: GradingStatus) =>
  db.update(codeSubmissions).set({ status }).where(submissionOf(itemId, id)).run()
