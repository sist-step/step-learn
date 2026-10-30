import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { AppShell } from '../components/layout'
import { Styles } from '../components/style'
import { Button } from '../components/button'
import { Card } from '../components/card'
import { TextField } from '../components/form'
import { Avatar, PageHeader } from '../components/ui'
import { destroyOtherSessions, hashPassword, requireAuth, verifyPassword } from '../lib/auth'
import { field, readForm, redirectWith } from '../lib/http'
import { checkPassword, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '../lib/password'
import { ROLE_LABELS, type AppEnv, type User } from '../lib/types'
import { USERNAME_HINT, USERNAME_MAX_LENGTH, checkUsername, normalizeUsername } from '../lib/username'
import { db } from '../lib/db'
import { users } from '../lib/schema'

const app = new Hono<AppEnv>()
app.use(requireAuth)

type Errors = Partial<Record<'name' | 'username' | 'current' | 'password', string>>

type Profile = { name: string; username: string }

const AccountPage = ({ user, errors = {}, values }: { user: User; errors?: Errors; values?: Profile }) => (
  <AppShell>
    <Styles use={['/src/routes/account.css']} />
    <PageHeader title="アカウント" description="プロフィールとセキュリティの設定" />
    <div class="settings-grid">
      <Card heading="プロフィール" description="コースの参加者一覧などに表示されます。">
        <div class="profile-row">
          <Avatar name={user.name} size={56} />
          <div>
            <div class="strong">{user.name}</div>
            <div class="muted small">
              {user.username && `@${user.username} · `}
              {user.email} · {ROLE_LABELS[user.role]}
            </div>
          </div>
        </div>
        <form method="post" action="/account" class="stack" data-loading-form>
          <TextField label="氏名" name="name" value={values?.name ?? user.name} error={errors.name} required maxlength={60} />
          <TextField
            label="ユーザー名"
            name="username"
            value={values?.username ?? user.username ?? ''}
            error={errors.username}
            hint={user.username ? USERNAME_HINT : `まだ設定されていません。${USERNAME_HINT}`}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            required
            maxlength={USERNAME_MAX_LENGTH}
          />
          <div class="form-actions">
            <Button type="submit" variant="primary">
              保存
            </Button>
          </div>
        </form>
      </Card>

      <Card heading="パスワード" description="変更すると、ほかの端末のセッションはすべてログアウトされます。">
        <form method="post" action="/account/password" class="stack" data-loading-form>
          <TextField label="現在のパスワード" name="current" type="password" error={errors.current} autocomplete="current-password" required />
          <TextField
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
            <Button type="submit" variant="primary">
              パスワードを変更
            </Button>
          </div>
        </form>
      </Card>
    </div>
  </AppShell>
)

app.get('/', (c) => c.render(<AccountPage user={c.var.user!} />, { title: 'アカウント' }))

app.post('/', async (c) => {
  const user = c.var.user!
  const form = await readForm(c)
  const values = { name: field(form, 'name', 60), username: normalizeUsername(field(form, 'username', 100)) }
  const errors: Errors = {}
  if (!values.name) errors.name = '氏名を入力してください。'
  const usernameError = checkUsername(values.username, user.id)
  if (usernameError) errors.username = usernameError
  if (Object.keys(errors).length) {
    c.status(422)
    return c.render(<AccountPage user={user} values={values} errors={errors} />, { title: 'アカウント' })
  }
  db.update(users).set(values).where(eq(users.id, user.id)).run()
  return redirectWith(c, '/account', 'プロフィールを更新しました。')
})

app.post('/password', async (c) => {
  const user = c.var.user!
  const form = await readForm(c)
  const current = field(form, 'current', 200)
  const password = field(form, 'password', 200)

  const row = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).get()
  const errors: Errors = {}
  if (!row || !(await verifyPassword(current, row.passwordHash))) errors.current = '現在のパスワードが正しくありません。'
  const passwordError = checkPassword(password, user)
  if (passwordError) errors.password = passwordError
  if (Object.keys(errors).length) {
    c.status(422)
    return c.render(<AccountPage user={user} errors={errors} />, { title: 'アカウント' })
  }

  const passwordHash = await hashPassword(password)
  db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run()
  await destroyOtherSessions(c, user.id)
  return redirectWith(c, '/account', 'パスワードを変更しました。')
})

export default app
