import { and, desc, eq, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { isCodeLanguage, type CodeConstraint, type CodeFiles, type SubmitPeriod } from '../lib/code'
import { createGrader } from '../lib/code-grader'
import type { CodeSettings, CodeStore } from '../lib/code-store'
import { intParam } from '../lib/http'
import type { CodeBackend } from '../routes/code/handlers'
import { aiLedger } from './ai-usage'
import type { MoodleEnv } from './auth'
import { loadCourse, outlineOf } from './data'
import { db, type MoodleDB } from './db'
import { CODE_KIND } from './extra-kinds'
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
  }
}

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
  createdAt: codeSubmissions.createdAt,
}

const STUDENT = { id: users.id, name: users.name, username: users.username, email: users.email }

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの書きかけのコードと提出。key は extra_items の key */
function codeStore(key: string): CodeStore {
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
const grader = createGrader({
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
  ledger: aiLedger,
})

/** Moodle モード: 設定を extra_items に、書きかけのコードと提出を moodle-mode.db に置き、権限を Moodle のコースから確かめる */
export const codeBackend: CodeBackend = {
  grader,
  pageUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/${CODE_KIND}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = outlineOf(loaded).find((it) => it.id === itemId && !it.locked && it.extra?.type === CODE_KIND)
    const data = item?.extra?.data
    const settings = data && codeSettingsOf(data, item.title)
    if (!item?.extraKey || !data || !settings) return null
    return { access: loaded.access, itemId, settings, period: codePeriodOf(data), store: codeStore(item.extraKey) }
  },
}
