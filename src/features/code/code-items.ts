import { and, desc, eq, sql } from 'drizzle-orm'
import { filesFor, isCleared, type CodeConstraint, type CodeFiles, type CodeLanguage, type SubmitPeriod } from './code'
import type { CodeStore } from './code-store'
import { nextPosition } from '../../lib/courses'
import { db, type DB } from '../../lib/db'
import { codeDrafts, codeItems, codeSubmissions, completions, courses, enrollments, items, users } from '../../lib/schema'
import type { CodeItem, Item } from '../../lib/types'

export const getCodeItem = (itemId: number) => db.select().from(codeItems).where(eq(codeItems.itemId, itemId)).get()

export const updateCodeItem = (
  itemId: number,
  language: CodeLanguage,
  {
    starter,
    stdin,
    criteria,
    constraints,
    solution,
    solutionPublic,
    opensAt,
    closesAt,
  }: {
    starter: CodeFiles
    stdin: string
    criteria: string
    constraints: CodeConstraint[]
    solution: CodeFiles
    solutionPublic: number
  } & SubmitPeriod,
) =>
  db
    .update(codeItems)
    .set({
      starter: filesFor(language, starter),
      stdin: language === 'python' ? stdin : '',
      criteria,
      constraints,
      solution: filesFor(language, solution),
      solutionPublic,
      opensAt,
      closesAt,
    })
    .where(eq(codeItems.itemId, itemId))
    .run()

/** 問題の確定と準備の段階を変える。準備をやり直すときは、前の判定の基準を消す */
export const setCodeStage = (itemId: number, stage: 'preparing') =>
  db.update(codeItems).set({ stage, guides: [] }).where(eq(codeItems.itemId, itemId)).run()

/**
 * 確定したコーディング問題を、確定する前（draft）の新しいアイテムとして、同じセクションの末尾に複製する。新しいアイテムの ID を返す。
 * 学生に表示しないのは、直して確定するまで学生は解けず、解けないアイテムが一覧に増えるだけになるため。
 * 提出の期間を写さないのは、直しているあいだに期間が始まり、元の問題と同じ時間に受け付けることになるため
 */
export function duplicateCodeItem(item: Item, code: CodeItem) {
  const position = nextPosition(items, eq(items.sectionId, item.sectionId))
  return db.transaction((tx) => {
    const { id } = tx
      .insert(items)
      .values({
        courseId: item.courseId,
        sectionId: item.sectionId,
        type: 'code',
        title: `${item.title}（コピー）`.slice(0, 200),
        body: item.body,
        hidden: 1,
        completion: item.completion,
        position,
      })
      .returning({ id: items.id })
      .get()
    tx.insert(codeItems)
      .values({
        itemId: id,
        language: code.language,
        starter: code.starter,
        stdin: code.stdin,
        criteria: code.criteria,
        constraints: code.constraints,
        solution: code.solution,
        solutionPublic: code.solutionPublic,
        stage: 'draft',
      })
      .run()
    return id
  })
}

const SUMMARY = {
  id: codeSubmissions.id,
  userId: codeSubmissions.userId,
  status: codeSubmissions.status,
  verdicts: codeSubmissions.verdicts,
  appealedAt: codeSubmissions.appealedAt,
  appealClosedAt: codeSubmissions.appealClosedAt,
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
    review: (id, teacherComment) => void db.update(codeSubmissions).set({ teacherComment }).where(byId(id)).run(),
    setStatus: (id, status) => void db.update(codeSubmissions).set({ status }).where(byId(id)).run(),
    overrideVerdicts: (id, verdicts) =>
      db.transaction((tx) => {
        const changed = tx.update(codeSubmissions).set({ verdicts }).where(byId(id)).returning({ userId: codeSubmissions.userId }).get()
        const target = tx
          .select({ completion: items.completion, completionEnabled: courses.completionEnabled })
          .from(items)
          .innerJoin(courses, eq(courses.id, items.courseId))
          .where(eq(items.id, itemId))
          .get()
        if (!changed || target?.completion !== 'clear' || !target.completionEnabled) return
        const graded = tx
          .select({ verdicts: codeSubmissions.verdicts })
          .from(codeSubmissions)
          .where(and(ofUser(changed.userId), eq(codeSubmissions.status, 'graded')))
          .limit(1000)
          .all()
        // 学生が出し直してクリアを外したときと違って完了を取り消すのは、AI が誤ってクリアにした提出を、教師が直したため
        if (graded.some((g) => isCleared(g.verdicts)))
          tx.insert(completions).values({ userId: changed.userId, itemId, courseId }).onConflictDoNothing().run()
        else
          tx.delete(completions)
            .where(and(eq(completions.userId, changed.userId), eq(completions.itemId, itemId)))
            .run()
      }),
    appeal: (id) =>
      void db
        .update(codeSubmissions)
        .set({ appealedAt: sql`(unixepoch())`, appealClosedAt: null })
        .where(byId(id))
        .run(),
    closeAppeal: (id) =>
      void db
        .update(codeSubmissions)
        .set({ appealClosedAt: sql`(unixepoch())` })
        .where(byId(id))
        .run(),
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
