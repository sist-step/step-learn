import type { Context } from 'hono'
import type { AppEnv, Course, CourseRole, User } from './types'
import { db } from './db'

export type CourseAccess = {
  course: Course
  /** このコースでの自分のロール（未登録なら null） */
  role: CourseRole | null
  /** 教師またはサイト管理者 */
  canManage: boolean
}

export const getCourseAccess = (c: Context<AppEnv>, courseId: number) => getCourseAccessFor(c.var.user!, courseId)

export async function getCourseAccessFor(user: User, courseId: number): Promise<CourseAccess | null> {
  const row = await db.prepare(
    `SELECT c.*, e.role AS my_role
     FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
     WHERE c.id = ?`,
  )
    .bind(user.id, courseId)
    .first<Course & { my_role: CourseRole | null }>()
  if (!row) return null

  const { my_role, ...course } = row
  const canManage = user.role === 'admin' || my_role === 'teacher'
  // 参加していないコースは存在しないものとして扱う
  if (!canManage && !my_role) return null
  return { course, role: my_role, canManage }
}

/**
 * position を持つ行を1つ上下に動かす。並びを 1..n に正規化し、変化した行だけ更新する。
 * table / scope は呼び出し側の固定文字列のみを渡すこと。
 */
export async function moveRow(
  table: 'sections' | 'items',
  scope: 'course_id' | 'section_id',
  scopeId: number,
  id: number,
  dir: 'up' | 'down',
) {
  const { results } = await db
    .prepare(`SELECT id, position FROM ${table} WHERE ${scope} = ? ORDER BY position, id`)
    .bind(scopeId)
    .all<{ id: number; position: number }>()
  const i = results.findIndex((r) => r.id === id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= results.length) return
  ;[results[i], results[j]] = [results[j], results[i]]
  const updates = results
    .map((r, idx) => ({ ...r, next: idx + 1 }))
    .filter((r) => r.position !== r.next)
    .map((r) => db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(r.next, r.id))
  if (updates.length) await db.batch(updates)
}
