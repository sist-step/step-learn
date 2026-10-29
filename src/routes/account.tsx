import { Hono } from 'hono'
import { AppShell } from '../components/layout'
import { Avatar, Field, PageHeader } from '../components/ui'
import { destroyOtherSessions, hashPassword, requireAuth, safeNext, verifyPassword } from '../lib/auth'
import { field, readForm, redirectWith, setSidebarCollapsed } from '../lib/http'
import { checkPassword, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '../lib/password'
import { ROLE_LABELS, type AppEnv, type User } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth)

type Errors = Partial<Record<'name' | 'current' | 'password', string>>

const AccountPage = ({ user, errors = {}, name }: { user: User; errors?: Errors; name?: string }) => (
  <AppShell>
    <PageHeader title="アカウント" description="プロフィールとセキュリティの設定" />
    <div class="settings-grid">
      <section class="card">
        <div class="card-head">
          <h2>プロフィール</h2>
          <p class="muted">コースの参加者一覧などに表示されます。</p>
        </div>
        <div class="profile-row">
          <Avatar name={user.name} size={56} />
          <div>
            <div class="strong">{user.name}</div>
            <div class="muted small">
              {user.email} · {ROLE_LABELS[user.role]}
            </div>
          </div>
        </div>
        <form method="post" action="/account" class="stack" data-loading-form>
          <Field label="氏名" name="name" value={name ?? user.name} error={errors.name} required maxlength={60} />
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>パスワード</h2>
          <p class="muted">変更すると、ほかの端末のセッションはすべてログアウトされます。</p>
        </div>
        <form method="post" action="/account/password" class="stack" data-loading-form>
          <Field label="現在のパスワード" name="current" type="password" error={errors.current} autocomplete="current-password" required />
          <Field
            label="新しいパスワード"
            name="password"
            type="password"
            error={errors.password}
            hint={PASSWORD_HINT}
            autocomplete="new-password"
            required
            minlength={PASSWORD_MIN_LENGTH}
          />
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              パスワードを変更
            </button>
          </div>
        </form>
      </section>
    </div>
  </AppShell>
)

app.get('/', (c) => c.render(<AccountPage user={c.var.user!} />, { title: 'アカウント' }))

app.post('/', async (c) => {
  const user = c.var.user!
  const name = field(await readForm(c), 'name', 60)
  if (!name) {
    c.status(422)
    return c.render(<AccountPage user={user} name={name} errors={{ name: '氏名を入力してください。' }} />, { title: 'アカウント' })
  }
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run()
  return redirectWith(c, '/account', 'プロフィールを更新しました。')
})

app.post('/sidebar', async (c) => {
  const form = await readForm(c)
  setSidebarCollapsed(c, field(form, 'collapsed', 1) === '1')
  return c.redirect(safeNext(field(form, 'next', 2000)), 303)
})

app.post('/password', async (c) => {
  const user = c.var.user!
  const form = await readForm(c)
  const current = field(form, 'current', 200)
  const password = field(form, 'password', 200)

  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>()
  const errors: Errors = {}
  if (!row || !(await verifyPassword(current, row.password_hash))) errors.current = '現在のパスワードが正しくありません。'
  const passwordError = checkPassword(password, user)
  if (passwordError) errors.password = passwordError
  if (Object.keys(errors).length) {
    c.status(422)
    return c.render(<AccountPage user={user} errors={errors} />, { title: 'アカウント' })
  }

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run()
  await destroyOtherSessions(c, user.id)
  return redirectWith(c, '/account', 'パスワードを変更しました。')
})

export default app
