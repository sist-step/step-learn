import { and, eq, max, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Context } from 'hono'
import type { AppEnv, Course, CourseRole, User } from './types'
import { db } from './db'
import { imageName } from './images'
import { courses, enrollments, items, sections, users } from './schema'

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
  const row = db.select({ last: max(table.position) }).from(table).where(scope).get()
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
