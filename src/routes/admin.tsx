import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../components/course'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { Avatar, EmptyState, PageHeader, formatDate } from '../components/ui'
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

const AdminShell = ({ tab, children }: { tab: Tab; children: Child }) => (
  <AppShell>
    <PageHeader title="管理" description="ユーザーとコースをまとめて管理します。" />
    <nav class="tabs" aria-label="管理メニュー">
      {TABS.map((t) => (
        <a href={t.href} class={tab === t.tab ? 'tab active' : 'tab'} aria-current={tab === t.tab ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
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
      <div class="stats">
        {(['admin', 'teacher', 'student'] as Role[]).map((r) => (
          <div class="stat">
            <span class="stat-label">{ROLE_LABELS[r]}</span>
            <span class="stat-value">{byRole[r] ?? 0}</span>
          </div>
        ))}
      </div>

      <form method="get" class="toolbar">
        <label class="search">
          <Icon name="search" />
          <input type="search" name="q" value={q} placeholder="名前・メールで検索" data-search aria-label="ユーザーを検索" />
          <kbd>/</kbd>
        </label>
      </form>

      {users.length === 0 ? (
        <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
      ) : (
        <div class="table-card">
          <table class="table">
            <thead>
              <tr>
                <th>ユーザー</th>
                <th class="hide-sm">登録日</th>
                <th class="hide-sm">コース</th>
                <th>ロール</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr>
                  <td>
                    <div class="person">
                      <Avatar name={u.name} />
                      <div class="person-meta">
                        <span class="strong truncate">
                          {u.name}
                          {u.id === me.id && <span class="muted small">（あなた）</span>}
                        </span>
                        <span class="muted small truncate">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td class="hide-sm muted">{formatDate(u.created_at)}</td>
                  <td class="hide-sm muted">{u.courses}</td>
                  <td>
                    <form method="post" action={`/admin/users/${u.id}/role`} data-autosubmit>
                      <select name="role" class="select-sm" aria-label={`${u.name} のロール`} disabled={u.id === me.id}>
                        {(['student', 'teacher', 'admin'] as Role[]).map((r) => (
                          <option value={r} selected={u.role === r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <label class="search">
            <Icon name="search" />
            <input type="search" name="q" value={q} placeholder="コース名・コードで検索" data-search aria-label="コースを検索" />
            <kbd>/</kbd>
          </label>
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
        <div class="table-card">
          <table class="table">
            <thead>
              <tr>
                <th>コース</th>
                <th class="hide-sm">教師</th>
                <th class="hide-sm">学生</th>
                <th class="hide-sm">アイテム</th>
                <th class="hide-sm">作成日</th>
                <th>
                  <span class="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr>
                  <td>
                    <a href={`/courses/${course.id}`} class="person">
                      <span class={`dot tone-${course.color}`}>{[...course.title][0]}</span>
                      <span class="person-meta">
                        <span class="strong truncate">{course.title}</span>
                        {course.code && <span class="muted small truncate">{course.code}</span>}
                      </span>
                    </a>
                  </td>
                  <td class="hide-sm muted">{course.teachers ?? '未設定'}</td>
                  <td class="hide-sm muted">{course.students}</td>
                  <td class="hide-sm muted">{course.items}</td>
                  <td class="hide-sm muted">{formatDate(course.created_at)}</td>
                  <td>
                    <div class="row-actions">
                      <a href={`/courses/${course.id}/participants`} class="icon-btn" aria-label={`${course.title} の参加者`} title="参加者">
                        <Icon name="users" size={16} />
                      </a>
                      <a href={`/courses/${course.id}/settings`} class="icon-btn" aria-label={`${course.title} の設定`} title="設定">
                        <Icon name="sliders" size={16} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>,
    { title: 'コース - 管理' },
  )
})

export default app
