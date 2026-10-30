import { and, eq, inArray, max, ne, notInArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Context } from 'hono'
import type { AppEnv, Course, CourseRole, User } from './types'
import { db } from './db'
import { imageName } from './images'
import { completions, courses, enrollments, items, sections, users } from './schema'

export type CourseAccess = {
  course: Course
  /** このコースでの自分のロール（未登録なら null） */
  role: CourseRole | null
  /** 教師またはサイト管理者 */
  canManage: boolean
}

export const getCourseAccess = (c: Context<AppEnv>, courseId: number) => getCourseAccessFor(c.var.user!, courseId)

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

export type CourseImageKind = 'hero' | 'icon'

export const courseImageUrl = (courseId: number, kind: CourseImageKind, key: string | null | undefined) =>
  key ? `/courses/${courseId}/${kind}/${imageName(key)}` : null

export const courseImagePrefix = (courseId: number, kind: CourseImageKind) => `courses/${courseId}/${kind}`

/** items を FROM に含むクエリで使う、学生に見えるアイテム（アイテムもセクションも非表示でない）の条件 */
export const visibleItem = () =>
  and(eq(items.hidden, 0), notInArray(items.sectionId, db.select({ id: sections.id }).from(sections).where(eq(sections.hidden, 1))))

export const isVisibleItem = (itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), visibleItem()))
    .get()

/** items を FROM に含むクエリで使う、進捗に数えるアイテム（学生に見えて、完了の条件があり、コースが完了ステータスを使う）の条件 */
export const trackedItem = () =>
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

type Ordered = typeof sections | typeof items

/** 末尾に足すときの position */
export function nextPosition(table: Ordered, scope: SQL) {
  const row = db
    .select({ last: max(table.position) })
    .from(table)
    .where(scope)
    .get()
  return (row?.last ?? 0) + 1
}

/** position を持つ行を1つ上下に動かす。並びを 1..n に正規化し、変化した行だけ更新する */
export function moveRow(table: Ordered, scope: SQL, id: number, dir: 'up' | 'down') {
  const rows = db.select({ id: table.id, position: table.position }).from(table).where(scope).orderBy(table.position, table.id).all()
  const i = rows.findIndex((r) => r.id === id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= rows.length) return
  ;[rows[i], rows[j]] = [rows[j], rows[i]]
  const updates = rows.map((r, idx) => ({ ...r, next: idx + 1 })).filter((r) => r.position !== r.next)
  db.transaction((tx) => {
    for (const r of updates) tx.update(table).set({ position: r.next }).where(eq(table.id, r.id)).run()
  })
}

// DB に持たないのは、画面に変更を知らせるためだけの値で、再起動で失われても開いている画面が一度取り直すだけで済むため
const BOOT_ID = Date.now().toString(36)
const revisions = new Map<number, number>()

export const courseRevision = (courseId: number) => `${BOOT_ID}.${revisions.get(courseId) ?? 0}`

export const touchCourse = (courseId: number) => revisions.set(courseId, (revisions.get(courseId) ?? 0) + 1)
