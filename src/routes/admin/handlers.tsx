import { and, count, desc, eq, inArray, lt, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { aiLedger, usageByUser } from '../../lib/ai-usage'
import { teacherNames } from '../../lib/courses'
import { contains, db } from '../../lib/db'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { actionLabel } from '../../lib/operation-log'
import { courses, enrollments, items, operationLogs, users } from '../../lib/schema'
import { LOG_KINDS, ROLE_LABELS, type AppEnv, type LogKind, type Role } from '../../lib/types'
import { createAiAdminHandlers } from './ai'
import { CoursesPage, LogsPage, UsersPage, type CourseRow, type LogRow, type UserRow } from './views'

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

// ---------------------------------------------------------------- 操作ログ

const LOG_PAGE_SIZE = 100

const isLogKind = (k: string | undefined): k is LogKind => LOG_KINDS.includes(k as LogKind)

const positiveInt = (s: string | undefined) => {
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

export async function listLogs(c: Context<AppEnv>) {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const kindParam = c.req.query('kind')
  const kind = isLogKind(kindParam) ? kindParam : undefined
  const userId = positiveInt(c.req.query('user'))
  const before = positiveInt(c.req.query('before'))

  const rows = db
    .select({
      id: operationLogs.id,
      createdAt: operationLogs.createdAt,
      kind: operationLogs.kind,
      action: operationLogs.action,
      path: operationLogs.path,
      target: operationLogs.target,
      ip: operationLogs.ip,
      userAgent: operationLogs.userAgent,
      courseId: operationLogs.courseId,
      courseTitle: courses.title,
      userId: operationLogs.userId,
      name: users.name,
      username: users.username,
      email: users.email,
    })
    .from(operationLogs)
    .leftJoin(users, eq(users.id, operationLogs.userId))
    .leftJoin(courses, eq(courses.id, operationLogs.courseId))
    .where(
      and(
        kind ? eq(operationLogs.kind, kind) : undefined,
        userId ? eq(operationLogs.userId, userId) : undefined,
        q
          ? inArray(
              operationLogs.userId,
              db
                .select({ id: users.id })
                .from(users)
                .where(or(contains(users.name, q), contains(users.username, q), contains(users.email, q))),
            )
          : undefined,
        before ? lt(operationLogs.id, before) : undefined,
      ),
    )
    .orderBy(desc(operationLogs.id))
    .limit(LOG_PAGE_SIZE + 1)
    .all()

  const list: LogRow[] = rows.slice(0, LOG_PAGE_SIZE).map((r) => ({ ...r, label: actionLabel(r.action) }))
  const filterUser = userId ? (db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get() ?? null) : null
  return c.render(
    <LogsPage
      q={q}
      kind={kind}
      user={filterUser}
      before={before}
      list={list}
      nextBefore={rows.length > LOG_PAGE_SIZE ? list.at(-1)!.id : undefined}
    />,
    { title: '操作ログ - 管理' },
  )
}

// ---------------------------------------------------------------- AI

export const { show: showAi, update: updateAi } = createAiAdminHandlers({ ledger: aiLedger, usageByUser })
