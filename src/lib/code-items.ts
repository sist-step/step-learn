import { and, desc, eq, sql } from 'drizzle-orm'
import { CODE_LANGUAGES, filesFor, type CodeFiles, type CodeLanguage } from './code'
import { db, type DB } from './db'
import { sandboxEnabled } from './sandbox'
import { codeDrafts, codeItems, codeSubmissions } from './schema'

/** Python は sandbox が設定されているときだけ選べる */
export const availableCodeLanguages: readonly CodeLanguage[] = CODE_LANGUAGES.filter((l) => l !== 'python' || sandboxEnabled)

export const getCodeItem = (itemId: number) => db.select().from(codeItems).where(eq(codeItems.itemId, itemId)).get()

export const updateCodeItem = (itemId: number, language: CodeLanguage, starter: CodeFiles, stdin: string) =>
  db
    .update(codeItems)
    .set({ starter: filesFor(language, starter), stdin: language === 'python' ? stdin : '' })
    .where(eq(codeItems.itemId, itemId))
    .run()

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

export const latestSubmission = (itemId: number, userId: number) =>
  db
    .select({ id: codeSubmissions.id, files: codeSubmissions.files, createdAt: codeSubmissions.createdAt })
    .from(codeSubmissions)
    .where(and(eq(codeSubmissions.itemId, itemId), eq(codeSubmissions.userId, userId)))
    .orderBy(desc(codeSubmissions.id))
    .limit(1)
    .get()

/** 提出を残し、書きかけのコードも同じ内容にそろえる */
export function submitCode(itemId: number, userId: number, files: CodeFiles, stdin: string) {
  db.transaction((tx) => {
    tx.insert(codeSubmissions).values({ itemId, userId, files }).run()
    saveDraft(itemId, userId, files, stdin, tx)
  })
}
