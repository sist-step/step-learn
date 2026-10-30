import { and, count, desc, eq, or } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../components/course'
import { IconButton } from '../components/button'
import { SearchBox, Select } from '../components/form'
import { AppShell } from '../components/layout'
import { Stat, Stats, Table } from '../components/card'
import { Avatar, EmptyState, PageHeader, Person, Tabs, formatDate } from '../components/ui'
import { requireAuth, requireRole } from '../lib/auth'
import { teacherNames } from '../lib/courses'
import { field, intParam, readForm, redirectWith } from '../lib/http'
import { ROLE_LABELS, type AppEnv, type Role } from '../lib/types'
import { contains, db } from '../lib/db'
import { courses, enrollments, items, users } from '../lib/schema'

const app = new Hono<AppEnv>()
app.use(requireAuth, requireRole('admin'))

type Tab = 'users' | 'courses'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'users', href: '/admin', label: 'ユーザー' },
  { tab: 'courses', href: '/admin/courses', label: 'コース' },
]

const ROLE_OPTIONS = (['student', 'teacher', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

const AdminShell = ({ tab, children }: { tab: Tab; children: Child }) => (
  <AppShell>
    <PageHeader title="管理" description="ユーザーとコースをまとめて管理します。" />
    <Tabs label="管理メニュー" items={TABS.map((t) => ({ href: t.href, label: t.label, active: tab === t.tab }))} />
    {children}
  </AppShell>
)

// ---------------------------------------------------------------- ユーザー

app.get('/users', (c) => c.redirect('/admin', 301))

app.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const list = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      courses: db.$count(enrollments, eq(enrollments.userId, users.id)),
    })
    .from(users)
    .where(q ? or(contains(users.name, q), contains(users.email, q)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(200)
    .all()
  const counts = db.select({ role: users.role, n: count() }).from(users).groupBy(users.role).all()
  const byRole = Object.fromEntries(counts.map((r) => [r.role, r.n]))
  const me = c.var.user!

  return c.render(
    <AdminShell tab="users">
      <Stats>
        {(['admin', 'teacher', 'student'] as Role[]).map((r) => (
          <Stat label={ROLE_LABELS[r]} value={byRole[r] ?? 0} />
        ))}
      </Stats>

      <form method="get" class="toolbar">
        <SearchBox label="ユーザーを検索" value={q} placeholder="名前・メールで検索" />
      </form>

      {list.length === 0 ? (
        <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
      ) : (
        <Table columns={[{ label: 'ユーザー' }, { label: '登録日', class: 'hide-sm' }, { label: 'コース', class: 'hide-sm' }, { label: 'ロール' }]}>
          {list.map((u) => (
            <tr>
              <td>
                <Person
                  avatar={<Avatar name={u.name} />}
                  name={
                    <>
                      {u.name}
                      {u.id === me.id && <span class="muted small">（あなた）</span>}
                    </>
                  }
                  meta={u.email}
                />
              </td>
              <td class="hide-sm muted">{formatDate(u.createdAt)}</td>
              <td class="hide-sm muted">{u.courses}</td>
              <td>
                <form method="post" action={`/admin/users/${u.id}/role`} data-autosubmit>
                  <Select
                    name="role"
                    compact
                    options={ROLE_OPTIONS}
                    value={u.role}
                    aria-label={`${u.name} のロール`}
                    disabled={u.id === me.id}
                  />
                </form>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>,
    { title: 'ユーザー - 管理' },
  )
})

app.post('/users/:id/role', async (c) => {
  const id = intParam(c, 'id')
  const role = field(await readForm(c), 'role') as Role
  if (!id || !['admin', 'teacher', 'student'].includes(role)) return c.notFound()
  if (id === c.var.user!.id) return redirectWith(c, '/admin', '自分自身のロールは変更できません。', 'error')

  const row = db.update(users).set({ role }).where(eq(users.id, id)).returning({ name: users.name }).get()
  if (!row) return c.notFound()
  return redirectWith(c, '/admin', `${row.name} さんを${ROLE_LABELS[role]}に変更しました。`)
})

// ---------------------------------------------------------------- コース

app.get('/courses', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const list = db
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

  return c.render(
    <AdminShell tab="courses">
      <div class="toolbar">
        <form method="get" class="toolbar-grow">
          <SearchBox label="コースを検索" value={q} placeholder="コース名・コードで検索" />
        </form>
        <CreateCourseButton />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="book"
          title={q ? `「${q}」に一致するコースはありません` : 'まだコースがありません'}
          text={q ? '別のキーワードで検索してみてください。' : '「コースを作成」から最初のコースを作りましょう。'}
        />
      ) : (
        <Table
          columns={[
            { label: 'コース' },
            { label: '教師', class: 'hide-sm' },
            { label: '学生', class: 'hide-sm' },
            { label: 'アイテム', class: 'hide-sm' },
            { label: '作成日', class: 'hide-sm' },
            { label: '操作', srOnly: true },
          ]}
        >
          {list.map((course) => (
            <tr>
              <td>
                <Person
                  href={`/courses/${course.id}`}
                  avatar={<span class={`dot tone-${course.color}`}>{[...course.title][0]}</span>}
                  name={course.title}
                  meta={course.code}
                />
              </td>
              <td class="hide-sm muted">{course.teachers ?? '未設定'}</td>
              <td class="hide-sm muted">{course.students}</td>
              <td class="hide-sm muted">{course.items}</td>
              <td class="hide-sm muted">{formatDate(course.createdAt)}</td>
              <td>
                <div class="row-actions">
                  <IconButton href={`/courses/${course.id}/participants`} icon="users" label={`${course.title} の参加者`} title="参加者" />
                  <IconButton href={`/courses/${course.id}/settings`} icon="sliders" label={`${course.title} の設定`} title="設定" />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>,
    { title: 'コース - 管理' },
  )
})

export default app
