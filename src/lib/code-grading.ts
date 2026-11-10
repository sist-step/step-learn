import { eq } from 'drizzle-orm'
import { createGrader } from './code-grader'
import { db } from './db'
import { codeItems, codeSubmissions, items } from './schema'

/** 通常モード（step-learn.db）の提出を採点する */
export const grader = createGrader({
  load: (id) =>
    db
      .select({
        files: codeSubmissions.files,
        title: items.title,
        body: items.body,
        language: codeItems.language,
        stdin: codeItems.stdin,
        criteria: codeItems.criteria,
        maxScore: codeItems.maxScore,
      })
      .from(codeSubmissions)
      .innerJoin(codeItems, eq(codeItems.itemId, codeSubmissions.itemId))
      .innerJoin(items, eq(items.id, codeSubmissions.itemId))
      .where(eq(codeSubmissions.id, id))
      .get() ?? null,
  save: (id, result, output) =>
    db
      .update(codeSubmissions)
      .set({ ...result, output })
      .where(eq(codeSubmissions.id, id))
      .run(),
})
