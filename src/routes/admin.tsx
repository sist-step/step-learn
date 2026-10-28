import { Hono } from 'hono'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { Avatar, EmptyState, PageHeader, formatDate } from '../components/ui'
import { requireAuth, requireRole } from '../lib/auth'
import { field, intParam, readForm, redirectWith } from '../lib/http'
import { ROLE_LABELS, type AppEnv, type Role } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth, requireRole('admin'))

type UserRow = { id: number; name: string; email: string; role: Role; created_at: number; courses: number }

app.get('/users', async (c) => {
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
    <AppShell>
      <PageHeader title="ユーザー管理" description="ロールを変更すると、教師はコースを作成できるようになります。" />

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
                      <noscript>
                        <button type="submit" class="btn btn-sm">
                          変更
                        </button>
                      </noscript>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>,
    { title: 'ユーザー管理' },
  )
})

app.post('/users/:id/role', async (c) => {
  const id = intParam(c, 'id')
  const role = field(await readForm(c), 'role') as Role
  if (!id || !['admin', 'teacher', 'student'].includes(role)) return c.notFound()
  if (id === c.var.user!.id) return redirectWith(c, '/admin/users', '自分自身のロールは変更できません。', 'error')

  const row = await db.prepare('UPDATE users SET role = ? WHERE id = ? RETURNING name').bind(role, id).first<{ name: string }>()
  if (!row) return c.notFound()
  return redirectWith(c, '/admin/users', `${row.name} さんを${ROLE_LABELS[role]}に変更しました。`)
})

export default app
