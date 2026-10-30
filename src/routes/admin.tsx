import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../components/course'
import { IconButton } from '../components/button'
import { SearchBox, Select } from '../components/form'
import { AppShell } from '../components/layout'
import { Stat, Stats, Table } from '../components/card'
import { Avatar, EmptyState, PageHeader, Person, Tabs, formatDate } from '../components/ui'
import { requireAuth, requireRole } from '../lib/auth'
import { field, intParam, readForm, redirectWith } from '../lib/http'
import { ROLE_LABELS, type AppEnv, type Role } from '../lib/types'
import { db } from '../lib/db'

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

type UserRow = { id: number; name: string; email: string; role: Role; created_at: number; courses: number }

app.get('/users', (c) => c.redirect('/admin', 301))

app.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const like = `%${q}%`
  const [rows, counts] = await db.batch([
    db.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id) AS courses
       FROM users u
       WHERE ?1 = '' OR u.name LIKE ?2 OR u.email LIKE ?2
       ORDER BY u.created_at DESC LIMIT 200`,
    ).bind(q, like),
    db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role'),
  ])
  const users = rows.results as UserRow[]
  const byRole = Object.fromEntries((counts.results as { role: Role; n: number }[]).map((r) => [r.role, r.n]))
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

      {users.length === 0 ? (
        <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
      ) : (
        <Table columns={[{ label: 'ユーザー' }, { label: '登録日', class: 'hide-sm' }, { label: 'コース', class: 'hide-sm' }, { label: 'ロール' }]}>
          {users.map((u) => (
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
              <td class="hide-sm muted">{formatDate(u.created_at)}</td>
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

  const row = await db.prepare('UPDATE users SET role = ? WHERE id = ? RETURNING name').bind(role, id).first<{ name: string }>()
  if (!row) return c.notFound()
  return redirectWith(c, '/admin', `${row.name} さんを${ROLE_LABELS[role]}に変更しました。`)
})

// ---------------------------------------------------------------- コース

type CourseRow = {
  id: number
  code: string
  title: string
  color: string
  created_at: number
  teachers: string | null
  students: number
  items: number
}

app.get('/courses', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const { results: courses } = await db.prepare(
    `SELECT c.id, c.code, c.title, c.color, c.created_at,
            (SELECT group_concat(u.name, '、') FROM enrollments t JOIN users u ON u.id = t.user_id
              WHERE t.course_id = c.id AND t.role = 'teacher') AS teachers,
            (SELECT COUNT(*) FROM enrollments s WHERE s.course_id = c.id AND s.role = 'student') AS students,
            (SELECT COUNT(*) FROM items i WHERE i.course_id = c.id) AS items
     FROM courses c
     WHERE ?1 = '' OR c.title LIKE ?2 OR c.code LIKE ?2
     ORDER BY c.created_at DESC`,
  )
    .bind(q, `%${q}%`)
    .all<CourseRow>()

  return c.render(
    <AdminShell tab="courses">
      <div class="toolbar">
        <form method="get" class="toolbar-grow">
          <SearchBox label="コースを検索" value={q} placeholder="コース名・コードで検索" />
        </form>
        <CreateCourseButton />
      </div>

      {courses.length === 0 ? (
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
          {courses.map((course) => (
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
              <td class="hide-sm muted">{formatDate(course.created_at)}</td>
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
