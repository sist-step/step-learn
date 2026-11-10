import { and, count, desc, eq, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { AI_PROVIDERS, type AiProvider } from '../../lib/ai'
import { aiOverview, setMonthlyLimits, usageByUser } from '../../lib/ai-usage'
import { teacherNames } from '../../lib/courses'
import { contains, db } from '../../lib/db'
import { validate, type FieldErrors } from '../../lib/forms'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { courses, enrollments, items, users } from '../../lib/schema'
import { ROLE_LABELS, type AppEnv, type Role } from '../../lib/types'
import { AiPage, CoursesPage, UsersPage, aiLimitField, type CourseRow, type UserRow } from './views'

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

// ---------------------------------------------------------------- AI

const perProvider = <T,>(value: (provider: AiProvider) => T) =>
  Object.fromEntries(AI_PROVIDERS.map((p) => [p, value(p)])) as Record<AiProvider, T>

const renderAi = (c: Context<AppEnv>, form?: { values: Record<AiProvider, string>; errors: FieldErrors }) => {
  const overviews = AI_PROVIDERS.map((p) => aiOverview(p))
  const saved = Object.fromEntries(overviews.map((o) => [o.provider, String(o.monthlyLimit)])) as Record<AiProvider, string>
  return c.render(<AiPage overviews={overviews} list={usageByUser()} values={form?.values ?? saved} errors={form?.errors} />, {
    title: 'AI - 管理',
  })
}

export async function showAi(c: Context<AppEnv>) {
  return renderAi(c)
}

export async function updateAi(c: Context<AppEnv>) {
  const form = await readForm(c)
  const result = validate('aiSettings', form)
  if (!result.ok) {
    c.status(422)
    return renderAi(c, { values: perProvider((p) => field(form, aiLimitField(p), 20)), errors: result.errors })
  }
  setMonthlyLimits(perProvider((p) => result.values[aiLimitField(p)]))
  return redirectWith(c, '/admin/ai', '月の上限を保存しました。')
}
