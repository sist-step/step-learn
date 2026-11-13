import { eq } from 'drizzle-orm'
import { isModelPaused } from './ai'
import { aiLedger } from './ai-usage'
import { isCleared, isJudge, type Judge } from './code'
import { createGrader } from './code-grader'
import { db } from './db'
import { appSettings, codeItems, codeSubmissions, completions, courses, items } from './schema'

/**
 * 制約ごとの判定をするものを切り替えられるか。開発サーバー（npm run dev）だけで切り替えられ、本番と Jev を止めている間は常に llm で判定する。
 * 環境変数にしないのは、本番の設定に書かれても Jev で採点されないよう、ビルドしたコードから切り替えそのものを消すため
 */
export const judgeSwitchable = import.meta.env.DEV && !isModelPaused('typesafe/jev-1.14')

const JUDGE_KEY = 'dev_code_judge'

/** いま制約ごとの判定をするもの */
export function currentJudge(): Judge {
  if (!judgeSwitchable) return 'llm'
  const value = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, JUDGE_KEY)).get()?.value
  return isJudge(value) ? value : 'llm'
}

export function setJudge(judge: Judge) {
  if (!judgeSwitchable) return
  db.insert(appSettings)
    .values({ key: JUDGE_KEY, value: judge })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: judge } })
    .run()
}

/** 通常モード（step-learn.db）の提出を採点する */
export const grader = createGrader({
  load: (id) =>
    db
      .select({
        files: codeSubmissions.files,
        title: items.title,
        body: items.body,
        language: codeItems.language,
        starter: codeItems.starter,
        stdin: codeItems.stdin,
        criteria: codeItems.criteria,
        constraints: codeItems.constraints,
      })
      .from(codeSubmissions)
      .innerJoin(codeItems, eq(codeItems.itemId, codeSubmissions.itemId))
      .innerJoin(items, eq(items.id, codeSubmissions.itemId))
      .where(eq(codeSubmissions.id, id))
      .get() ?? null,
  save: (id, result, output) =>
    db.transaction((tx) => {
      tx.update(codeSubmissions)
        .set({ ...result, verdicts: result.status === 'graded' ? result.verdicts : null, output })
        .where(eq(codeSubmissions.id, id))
        .run()
      if (result.status !== 'graded' || !isCleared(result.verdicts)) return
      const target = tx
        .select({
          userId: codeSubmissions.userId,
          itemId: items.id,
          courseId: items.courseId,
          completion: items.completion,
          completionEnabled: courses.completionEnabled,
        })
        .from(codeSubmissions)
        .innerJoin(items, eq(items.id, codeSubmissions.itemId))
        .innerJoin(courses, eq(courses.id, items.courseId))
        .where(eq(codeSubmissions.id, id))
        .get()
      // 次の提出で制約を外しても完了を取り消さないのは、ほかの完了の条件と同じく、一度満たしたら完了のままにするため
      if (target?.completion === 'clear' && target.completionEnabled)
        tx.insert(completions)
          .values({ userId: target.userId, itemId: target.itemId, courseId: target.courseId })
          .onConflictDoNothing()
          .run()
    }),
  ledger: aiLedger,
  judgeOf: currentJudge,
})
