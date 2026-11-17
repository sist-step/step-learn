// extra-kinds.tsx からも読み込むので、extra-kinds.tsx を読み込むモジュール（./code.ts など）を import しない
import { and, desc, eq, sql } from 'drizzle-orm'
import { CODE_STAGES, isCodeLanguage, type CodeConstraint, type CodeFiles, type CodeStage, type SubmitPeriod } from '../lib/code'
import { createGrader, createPreparer } from '../lib/code-grader'
import type { CodeSettings, CodeStore } from '../lib/code-store'
import { aiLedger } from './ai-usage'
import { db, type MoodleDB } from './db'
import { codeDrafts, codeSubmissions, extraItems, users } from './schema'

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * extra_items の data（extra-kinds.tsx の code の toData が作る）を、コードのアイテムの設定として読む。
 * title を渡さなければ、保存したときのタイトルを使う（採点は画面を開いた人のトークンなしで動くので、Moodle から今のタイトルを取れない）
 */
export function codeSettingsOf(data: Record<string, unknown>, title = text(data.title)): CodeSettings | null {
  const language = text(data.language)
  if (!isCodeLanguage(language)) return null
  return {
    title,
    body: text(data.body),
    language,
    starter: typeof data.starter === 'object' && data.starter !== null ? (data.starter as CodeFiles) : {},
    stdin: text(data.stdin),
    criteria: text(data.criteria),
    // 制約の欄ができる前に作ったアイテムは constraints を持たず、講評だけを返す
    constraints: Array.isArray(data.constraints) ? (data.constraints as CodeConstraint[]) : [],
    // 解答例の欄ができる前に作ったアイテムは solution を持たない
    solution: typeof data.solution === 'object' && data.solution !== null ? (data.solution as CodeFiles) : {},
    solutionPublic: data.solutionPublic === true,
    // 確定の仕組みより前に作ったアイテムは guides を持たない
    guides: Array.isArray(data.guides) ? data.guides.filter((g): g is string => typeof g === 'string') : [],
  }
}

/** extra_items の data の、問題の確定と準備の段階。確定の仕組みより前に作ったアイテムは持たず、null になる */
export const codeStageOf = (data: Record<string, unknown>): CodeStage =>
  (CODE_STAGES as readonly unknown[]).includes(data.stage) ? (data.stage as NonNullable<CodeStage>) : null

const unix = (v: unknown) => (typeof v === 'number' ? v : null)

/** extra_items の data の、学生が提出できる期間。期間の欄ができる前に作ったアイテムは持たず、決まっていない扱いになる */
export const codePeriodOf = (data: Record<string, unknown>): SubmitPeriod => ({
  opensAt: unix(data.opensAt),
  closesAt: unix(data.closesAt),
})

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

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの書きかけのコードと提出。key は extra_items の key */
export function codeStore(key: string): CodeStore {
  const ofItem = eq(codeSubmissions.key, key)
  const ofUser = (userId: number) => and(ofItem, eq(codeSubmissions.userId, userId))
  const byId = (id: number) => and(ofItem, eq(codeSubmissions.id, id))

  const saveDraft = (userId: number, files: CodeFiles, stdin: string, executor: Pick<MoodleDB, 'insert'> = db) =>
    executor
      .insert(codeDrafts)
      .values({ key, userId, files, stdin })
      // $onUpdate に任せないのは、競合したときの更新には効かないため
      .onConflictDoUpdate({ target: [codeDrafts.key, codeDrafts.userId], set: { files, stdin, updatedAt: sql`(unixepoch())` } })
      .run()

  return {
    getDraft: (userId) =>
      db
        .select({ files: codeDrafts.files, stdin: codeDrafts.stdin })
        .from(codeDrafts)
        .where(and(eq(codeDrafts.key, key), eq(codeDrafts.userId, userId)))
        .get(),
    saveDraft: (userId, files, stdin) => void saveDraft(userId, files, stdin),
    submit: (userId, files, stdin, status) =>
      db.transaction((tx) => {
        const { id } = tx.insert(codeSubmissions).values({ key, userId, files, status }).returning({ id: codeSubmissions.id }).get()
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
    overrideVerdicts: (id, verdicts) => void db.update(codeSubmissions).set({ verdicts }).where(byId(id)).run(),
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
    // コースの学生を並べないのは、参加者が Moodle にあり、STEP Learn は自分にログインした人しか知らないため。提出した人だけを並べる
    listStudents: () =>
      db
        .selectDistinct(STUDENT)
        .from(codeSubmissions)
        .innerJoin(users, eq(users.id, codeSubmissions.userId))
        .where(ofItem)
        .orderBy(users.name)
        .limit(1000)
        .all(),
    findUser: (userId) => db.select(STUDENT).from(users).where(eq(users.id, userId)).get(),
  }
}

/** Moodle モード（moodle-mode.db）の提出を採点する */
export const grader = createGrader({
  load(id) {
    const row = db
      .select({ files: codeSubmissions.files, data: extraItems.data })
      .from(codeSubmissions)
      .innerJoin(extraItems, eq(extraItems.key, codeSubmissions.key))
      .where(eq(codeSubmissions.id, id))
      .get()
    const settings = row && codeSettingsOf(row.data)
    return settings ? { ...settings, files: row.files } : null
  },
  save: (id, result, output) =>
    db
      .update(codeSubmissions)
      .set({ ...result, verdicts: result.status === 'graded' ? result.verdicts : null, output })
      .where(eq(codeSubmissions.id, id))
      .run(),
  pendingIds: () =>
    db
      .select({ id: codeSubmissions.id })
      .from(codeSubmissions)
      .where(eq(codeSubmissions.status, 'pending'))
      .limit(1000)
      .all()
      .map((s) => s.id),
  ledger: aiLedger,
})

const codeDataOf = (key: string) =>
  db
    .select({ data: extraItems.data })
    .from(extraItems)
    .where(and(eq(extraItems.key, key), eq(extraItems.type, 'code')))
    .get()?.data

/** 準備をやり直すために、段階を準備中に戻し、前の判定の基準を消す */
export function restartPreparation(key: string) {
  const data = codeDataOf(key)
  if (data)
    db.update(extraItems)
      .set({ data: { ...data, stage: 'preparing', guides: [] } })
      .where(eq(extraItems.key, key))
      .run()
}

/** Moodle モード（moodle-mode.db）の、確定した問題の準備。段階と判定の基準は extra_items の data の stage と guides に置く */
export const preparer = createPreparer<string>({
  load(key) {
    const data = codeDataOf(key)
    return data && codeStageOf(data) === 'preparing' ? codeSettingsOf(data) : null
  },
  save(key, result) {
    const data = codeDataOf(key)
    if (!data || codeStageOf(data) !== 'preparing') return
    const next = result.stage === 'ready' ? { ...data, stage: 'ready', guides: result.guides } : { ...data, stage: 'failed' }
    db.update(extraItems).set({ data: next }).where(eq(extraItems.key, key)).run()
  },
  pendingKeys: () =>
    db
      .select({ key: extraItems.key })
      .from(extraItems)
      .where(and(eq(extraItems.type, 'code'), sql`json_extract(${extraItems.data}, '$.stage') = 'preparing'`))
      .limit(1000)
      .all()
      .map((r) => r.key),
  ledger: aiLedger,
})

// 開発サーバーで戻さないのは、モジュールを読み込み直すたびに、前のモジュールが採点している提出をもう一度採点してしまうため
if (!import.meta.env.DEV) {
  grader.resume()
  preparer.resume()
}
