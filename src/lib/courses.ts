import { and, eq, inArray, isNull, ne, notInArray, or, sql, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Context } from 'hono'
import type { AppEnv, Course, CourseRole, User } from './types'
import { db } from './db'
import { intParam } from './http'
import { completions, courses, enrollments, items, sections, users } from './schema'

export type CourseAccess = {
  course: Course
  /** このコースでの自分のロール（未登録なら null） */
  role: CourseRole | null
  /** 教師またはサイト管理者 */
  canManage: boolean
}

export const getCourseAccess = (c: Context<AppEnv>, courseId: number) => getCourseAccessFor(c.var.user!, courseId)

/** URL の :id のコースを、ログイン中の利用者が管理できる（教師・管理者）なら、その権限 */
export async function manageAccess(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  return access && access.canManage ? access : null
}

export async function getCourseAccessFor(user: User, courseId: number): Promise<CourseAccess | null> {
  const row = db
    .select({ course: courses, role: enrollments.role })
    .from(courses)
    .leftJoin(enrollments, and(eq(enrollments.courseId, courses.id), eq(enrollments.userId, user.id)))
    .where(eq(courses.id, courseId))
    .get()
  if (!row) return null

  const canManage = user.role === 'admin' || row.role === 'teacher'
  // 参加していないコースは存在しないものとして扱う
  if (!canManage && !row.role) return null
  return { course: row.course, role: row.role, canManage }
}

/** 学生に非表示のセクションと、非表示のセクションに入っているサブセクションの ID */
const hiddenSectionIds = () =>
  db
    .select({ id: sections.id })
    .from(sections)
    .where(
      or(eq(sections.hidden, 1), inArray(sections.parentId, db.select({ id: sections.id }).from(sections).where(eq(sections.hidden, 1)))),
    )

/** items を FROM に含むクエリで使う、学生に見えるアイテム（アイテムも、入っているセクションとその親も非表示でない）の条件 */
export const visibleItem = () => and(eq(items.hidden, 0), notInArray(items.sectionId, hiddenSectionIds()))

export const isVisibleItem = (itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), visibleItem()))
    .get()

/** items を FROM に含むクエリで使う、進捗に数えるアイテム（学生に見えて、完了の条件があり、コースが完了ステータスを使う）の条件 */
const trackedItem = () =>
  and(
    visibleItem(),
    ne(items.completion, 'none'),
    inArray(items.courseId, db.select({ id: courses.id }).from(courses).where(eq(courses.completionEnabled, 1))),
  )

/** 進捗の分母。courseId には courses.id などの列も渡せる */
export const trackedItemCount = (courseId: number | SQLWrapper) => db.$count(items, and(eq(items.courseId, courseId), trackedItem()))

// 完了の記録を消さずに数えるときだけ外すのは、表示に戻したり完了の条件を付け直したりしたときに、学生の進捗をそのまま復元するため
export const trackedDoneCount = (userId: number | SQLWrapper, courseId: number | SQLWrapper) =>
  db.$count(
    completions,
    and(
      eq(completions.userId, userId),
      eq(completions.courseId, courseId),
      inArray(completions.itemId, db.select({ id: items.id }).from(items).where(trackedItem())),
    ),
  )

/** courses を FROM に含むクエリで使う、コースの参加者数 */
export const memberCount = () => db.$count(enrollments, eq(enrollments.courseId, courses.id))

/** courses を FROM に含むクエリで使う、コースの教師の名前を「、」でつないだもの */
export function teacherNames() {
  const t = alias(enrollments, 't')
  return sql<string | null>`(${db
    .select({ names: sql`group_concat(${users.name}, '、')` })
    .from(t)
    .innerJoin(users, eq(users.id, t.userId))
    .where(and(eq(t.courseId, courses.id), eq(t.role, 'teacher')))})`
}

/** セクションの中の並びの 1 つ。サブセクションは親のセクションのアイテムと同じ並びに入る */
export type EntryRef = { kind: 'item' | 'section'; id: number }

type PositionRow = EntryRef & { position: number }

const KIND_ORDER: Record<EntryRef['kind'], number> = { item: 0, section: 1 }

const byPosition = (a: PositionRow, b: PositionRow) => a.position - b.position || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id

/** コースの（サブセクションでない）セクションの並び */
export const courseSections = (courseId: number): PositionRow[] =>
  db
    .select({ id: sections.id, position: sections.position })
    .from(sections)
    .where(and(eq(sections.courseId, courseId), isNull(sections.parentId)))
    .all()
    .map((r) => ({ kind: 'section' as const, ...r }))
    .sort(byPosition)

/** セクションの中のアイテムとサブセクションの並び */
export function sectionEntries(sectionId: number): PositionRow[] {
  const itemRows = db.select({ id: items.id, position: items.position }).from(items).where(eq(items.sectionId, sectionId)).all()
  const childRows = db.select({ id: sections.id, position: sections.position }).from(sections).where(eq(sections.parentId, sectionId)).all()
  return [...itemRows.map((r) => ({ kind: 'item' as const, ...r })), ...childRows.map((r) => ({ kind: 'section' as const, ...r }))].sort(
    byPosition,
  )
}

/** 並びの末尾に足すときの position */
export const nextPosition = (rows: PositionRow[]) => Math.max(0, ...rows.map((r) => r.position)) + 1

/** 並べ替えた rows の position を 1..n に正規化し、変化した行だけ更新する */
function renumber(rows: PositionRow[]) {
  const updates = rows.map((r, idx) => ({ ...r, next: idx + 1 })).filter((r) => r.position !== r.next)
  db.transaction((tx) => {
    for (const r of updates) {
      const table = r.kind === 'item' ? items : sections
      tx.update(table).set({ position: r.next }).where(eq(table.id, r.id)).run()
    }
  })
}

const sameEntry = (a: EntryRef) => (b: EntryRef) => a.kind === b.kind && a.id === b.id

/** 並びの中の target を1つ上下に動かす */
export function moveRow(rows: PositionRow[], target: EntryRef, dir: 'up' | 'down') {
  const i = rows.findIndex(sameEntry(target))
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  renumber(rows)
}

/** 並びの中の target を before の直前に移す。before が並びになければ何もしない */
export function placeBefore(rows: PositionRow[], target: EntryRef, before: EntryRef) {
  const moving = rows.find(sameEntry(target))
  const rest = rows.filter((r) => !sameEntry(target)(r))
  const j = rest.findIndex(sameEntry(before))
  if (!moving || j < 0) return
  rest.splice(j, 0, moving)
  renumber(rest)
}

/** 並びを order の順にする。order にない行（サブセクションなど）は、もとの位置のまま残す */
export function reorderRows(rows: PositionRow[], kind: EntryRef['kind'], order: number[]) {
  const queue = order.map((id) => rows.find((r) => r.kind === kind && r.id === id)).filter((r) => r !== undefined)
  renumber(rows.map((r) => (r.kind === kind ? (queue.shift() ?? r) : r)))
}

// DB に持たないのは、画面に変更を知らせるためだけの値で、再起動で失われても開いている画面が一度取り直すだけで済むため
const BOOT_ID = Date.now().toString(36)
const revisions = new Map<number, number>()

export const courseRevision = (courseId: number) => `${BOOT_ID}.${revisions.get(courseId) ?? 0}`

export const touchCourse = (courseId: number) => revisions.set(courseId, (revisions.get(courseId) ?? 0) + 1)
