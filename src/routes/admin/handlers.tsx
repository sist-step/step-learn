import { and, count, desc, eq, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { teacherNames } from '../../lib/courses'
import { contains, db } from '../../lib/db'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { courses, enrollments, items, users } from '../../lib/schema'
import { ROLE_LABELS, type AppEnv, type Role } from '../../lib/types'
import { CoursesPage, UsersPage, type CourseRow, type UserRow } from './views'

// ---------------------------------------------------------------- ユーザー

export async function listUsers(c: Context<AppEnv>) {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const list: UserRow[] = db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      courses: db.$count(enrollments, eq(enrollments.userId, users.id)),
    })
    .from(users)
    .where(q ? or(contains(users.name, q), contains(users.username, q), contains(users.email, q)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(200)
    .all()
  const counts = db.select({ role: users.role, n: count() }).from(users).groupBy(users.role).all()
  const byRole = Object.fromEntries(counts.map((r) => [r.role, r.n]))

  return c.render(<UsersPage q={q} list={list} byRole={byRole} meId={c.var.user!.id} />, { title: 'ユーザー - 管理' })
}

export async function changeRole(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const role = field(await readForm(c), 'role') as Role
  if (!id || !['admin', 'teacher', 'student'].includes(role)) return c.notFound()
  if (id === c.var.user!.id) return redirectWith(c, '/admin', '自分自身のロールは変更できません。', 'error')

  const row = db.update(users).set({ role }).where(eq(users.id, id)).returning({ name: users.name }).get()
  if (!row) return c.notFound()
  return redirectWith(c, '/admin', `${row.name} さんを${ROLE_LABELS[role]}に変更しました。`)
}

// ---------------------------------------------------------------- コース

export async function listCourses(c: Context<AppEnv>) {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const list: CourseRow[] = db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      color: courses.color,
      createdAt: courses.createdAt,
      teachers: teacherNames(),
      students: db.$count(enrollments, and(eq(enrollments.courseId, courses.id), eq(enrollments.role, 'student'))),
      items: db.$count(items, eq(items.courseId, courses.id)),
    })
    .from(courses)
    .where(q ? or(contains(courses.title, q), contains(courses.code, q)) : undefined)
    .orderBy(desc(courses.createdAt))
    .all()

  return c.render(<CoursesPage q={q} list={list} />, { title: 'コース - 管理' })
}
