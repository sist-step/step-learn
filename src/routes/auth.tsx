import { Hono } from 'hono'
import { AuthShell } from '../components/layout'
import { Field } from '../components/ui'
import { createSession, destroySession, dummyVerify, hashPassword, needsRehash, safeNext, verifyPassword } from '../lib/auth'
import { field, isEmail, readForm, redirectWith } from '../lib/http'
import type { AppEnv } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()

type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>

const FormError = ({ message }: { message?: string }) =>
  message ? (
    <div class="alert alert-error" role="alert">
      {message}
    </div>
  ) : null

const LoginPage = ({ email = '', next = '', errors = {} }: { email?: string; next?: string; errors?: Errors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <p class="muted">アカウントにログインして学習を続けましょう。</p>
      <FormError message={errors.form} />
      <form method="post" action="/login" class="stack" data-loading-form>
        <input type="hidden" name="next" value={next} />
        <Field label="メールアドレス" name="email" type="email" value={email} autocomplete="email" required autofocus={!email} />
        <Field
          label="パスワード"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          autofocus={!!email}
        />
        <button type="submit" class="btn btn-primary btn-lg btn-block">
          ログイン
        </button>
      </form>
      <p class="auth-switch">
        アカウントをお持ちでない方は <a href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>新規登録</a>
      </p>
    </div>
  </AuthShell>
)

const RegisterPage = ({
  values = {},
  next = '',
  errors = {},
}: {
  values?: { name?: string; email?: string }
  next?: string
  errors?: Errors
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>アカウントを作成</h1>
      <p class="muted">数秒で完了します。すぐにコースへ参加できます。</p>
      <FormError message={errors.form} />
      <form method="post" action="/register" class="stack" data-loading-form>
        <input type="hidden" name="next" value={next} />
        <Field label="氏名" name="name" value={values.name} error={errors.name} autocomplete="name" required autofocus maxlength={60} />
        <Field label="メールアドレス" name="email" type="email" value={values.email} error={errors.email} autocomplete="email" required />
        <Field
          label="パスワード"
          name="password"
          type="password"
          error={errors.password}
          hint="8文字以上"
          autocomplete="new-password"
          required
          minlength={8}
        />
        <button type="submit" class="btn btn-primary btn-lg btn-block">
          登録してはじめる
        </button>
      </form>
      <p class="auth-switch">
        すでにアカウントをお持ちの方は <a href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>ログイン</a>
      </p>
    </div>
  </AuthShell>
)

app.get('/login', (c) => {
  if (c.var.user) return c.redirect('/dashboard')
  return c.render(<LoginPage next={c.req.query('next')} />, { title: 'ログイン' })
})

app.post('/login', async (c) => {
  const form = await readForm(c)
  const email = field(form, 'email', 254).toLowerCase()
  const password = field(form, 'password', 200)
  const next = field(form, 'next', 500)

  const user = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string }>()
  const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password)

  if (!user || !ok) {
    c.status(401)
    return c.render(
      <LoginPage email={email} next={next} errors={{ form: 'メールアドレスまたはパスワードが正しくありません。' }} />,
      { title: 'ログイン' },
    )
  }

  if (needsRehash(user.password_hash)) {
    // id だけを条件にしないのは、同時に行われたパスワード変更を古いパスワードで上書きしないため
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?')
      .bind(await hashPassword(password), user.id, user.password_hash)
      .run()
  }

  await createSession(c, user.id)
  return c.redirect(safeNext(next), 303)
})

app.get('/register', (c) => {
  if (c.var.user) return c.redirect('/dashboard')
  return c.render(<RegisterPage next={c.req.query('next')} />, { title: '新規登録' })
})

app.post('/register', async (c) => {
  const form = await readForm(c)
  const name = field(form, 'name', 60)
  const email = field(form, 'email', 254).toLowerCase()
  const password = field(form, 'password', 200)
  const next = field(form, 'next', 500)

  const errors: Errors = {}
  if (!name) errors.name = '氏名を入力してください。'
  if (!isEmail(email)) errors.email = '有効なメールアドレスを入力してください。'
  if (password.length < 8) errors.password = 'パスワードは8文字以上にしてください。'

  if (!errors.email) {
    const exists = await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()
    if (exists) errors.email = 'このメールアドレスはすでに登録されています。'
  }

  if (Object.keys(errors).length) {
    c.status(422)
    return c.render(<RegisterPage values={{ name, email }} next={next} errors={errors} />, { title: '新規登録' })
  }

  // 最初の 1 人目は管理者にする（初期セットアップ用）
  const user = await db.prepare(
    `INSERT INTO users (email, name, password_hash, role)
     VALUES (?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'student' ELSE 'admin' END)
     RETURNING id, role`,
  )
    .bind(email, name, await hashPassword(password))
    .first<{ id: number; role: string }>()

  await createSession(c, user!.id)
  return redirectWith(
    c,
    safeNext(next),
    user!.role === 'admin' ? 'ようこそ！最初のユーザーとして管理者に設定されました。' : `ようこそ、${name}さん！`,
  )
})

app.post('/logout', async (c) => {
  await destroySession(c)
  return redirectWith(c, '/login', 'ログアウトしました。', 'info')
})

export default app
