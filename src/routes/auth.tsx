import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { AuthShell } from '../components/layout'
import { Button } from '../components/button'
import { TextField } from '../components/form'
import { Alert, Tabs } from '../components/ui'
import {
  createEmailVerification,
  createSession,
  createUser,
  destroySession,
  dummyVerify,
  findEmailVerification,
  hashPassword,
  needsRehash,
  safeNext,
  verifyPassword,
} from '../lib/auth'
import { config } from '../lib/config'
import { clientIp, field, isEmail, readForm, redirectWith } from '../lib/http'
import { mailer } from '../lib/mail'
import { checkPassword, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '../lib/password'
import { rateLimiter } from '../lib/rate-limit'
import type { AppEnv } from '../lib/types'
import { USERNAME_HINT, USERNAME_MAX_LENGTH, checkUsername, normalizeUsername } from '../lib/username'
import { db } from '../lib/db'
import { users } from '../lib/schema'

const app = new Hono<AppEnv>()

type Errors = Partial<Record<'name' | 'username' | 'email' | 'password' | 'form', string>>

// IP ごとの上限を高めにしているのは、教室などで同じグローバル IP から大勢が一斉にアクセスするため
const loginFailuresByIp = rateLimiter({ limit: 50, windowSec: 15 * 60 })
const loginFailuresByAccount = rateLimiter({ limit: 10, windowSec: 15 * 60 })
const registerByIp = rateLimiter({ limit: 100, windowSec: 60 * 60 })
const registerByEmail = rateLimiter({ limit: 3, windowSec: 60 * 60 })

function tooManyRequests(c: Context, retryAfter: number) {
  c.status(429)
  c.header('Retry-After', String(retryAfter))
  return `試行回数が多すぎます。${Math.ceil(retryAfter / 60)}分ほど待ってから再度お試しください。`
}

const FormError = ({ message }: { message?: string }) => (message ? <Alert>{message}</Alert> : null)

const AuthTabs = ({ current, next }: { current: 'login' | 'register'; next: string }) => {
  const query = next ? `?next=${encodeURIComponent(next)}` : ''
  return (
    <Tabs
      label="ログインと新規登録"
      block
      items={[
        { href: `/login${query}`, label: 'ログイン', active: current === 'login' },
        { href: `/register${query}`, label: '新規登録', active: current === 'register' },
      ]}
    />
  )
}

const LoginPage = ({ login = '', next = '', errors = {} }: { login?: string; next?: string; errors?: Errors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <p class="muted">アカウントにログインして学習を続けましょう。</p>
      <AuthTabs current="login" next={next} />
      <FormError message={errors.form} />
      <form method="post" action="/login" class="stack" data-loading-form>
        <input type="hidden" name="next" value={next} />
        <TextField
          label="メールアドレスまたはユーザー名"
          name="login"
          value={login}
          autocomplete="username"
          autocapitalize="none"
          spellcheck={false}
          required
          autofocus={!login}
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          autofocus={!!login}
        />
        <Button type="submit" variant="primary" size="lg" block>
          ログイン
        </Button>
      </form>
    </div>
  </AuthShell>
)

const RegisterPage = ({ email = '', next = '', errors = {} }: { email?: string; next?: string; errors?: Errors }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>アカウントを作成</h1>
      <p class="muted">メールアドレスに届くリンクから登録を完了してください。</p>
      <AuthTabs current="register" next={next} />
      <FormError message={errors.form} />
      <form method="post" action="/register" class="stack" data-loading-form>
        <input type="hidden" name="next" value={next} />
        <TextField label="メールアドレス" name="email" type="email" value={email} error={errors.email} autocomplete="email" required autofocus />
        <Button type="submit" variant="primary" size="lg" block>
          確認メールを送る
        </Button>
      </form>
    </div>
  </AuthShell>
)

const RegisterSentPage = ({ email }: { email: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>メールを確認してください</h1>
      <p class="muted">
        {email} 宛てにメールを送信しました。メールに記載されたリンクから、24時間以内に登録を完了してください。
        届かない場合は、迷惑メールフォルダを確認するか、しばらくしてから再度お試しください。
      </p>
      <p class="auth-switch">
        <a href="/register">メールアドレスを入力し直す</a>
      </p>
    </div>
  </AuthShell>
)

const CompleteRegisterPage = ({
  token,
  email,
  name = '',
  username = '',
  errors = {},
}: {
  token: string
  email: string
  name?: string
  username?: string
  errors?: Errors
}) => (
  <AuthShell>
    <div class="auth-card">
      <h1>登録を完了する</h1>
      <p class="muted">{email} で登録します。氏名・ユーザー名・パスワードを設定してください。</p>
      <FormError message={errors.form} />
      <form method="post" action="/register/complete" class="stack" data-loading-form>
        <input type="hidden" name="token" value={token} />
        {/* パスワードマネージャーがメールアドレスと組にして保存できるようにする */}
        <input type="hidden" name="email" value={email} autocomplete="username" />
        <TextField label="氏名" name="name" value={name} error={errors.name} autocomplete="name" required autofocus maxlength={60} />
        <TextField
          label="ユーザー名"
          name="username"
          value={username}
          error={errors.username}
          hint={USERNAME_HINT}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          required
          maxlength={USERNAME_MAX_LENGTH}
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          error={errors.password}
          hint={PASSWORD_HINT}
          autocomplete="new-password"
          required
          minlength={PASSWORD_MIN_LENGTH}
        />
        <Button type="submit" variant="primary" size="lg" block>
          登録してはじめる
        </Button>
      </form>
    </div>
  </AuthShell>
)

const InvalidLinkPage = () => (
  <AuthShell>
    <div class="auth-card">
      <h1>リンクが無効です</h1>
      <p class="muted">リンクの有効期限が切れているか、すでに使われています。お手数ですが、もう一度登録をやり直してください。</p>
      <Button href="/register" variant="primary" size="lg" block>
        新規登録へ
      </Button>
    </div>
  </AuthShell>
)

app.get('/login', (c) => {
  if (c.var.user) return c.redirect('/dashboard')
  return c.render(<LoginPage next={c.req.query('next')} />, { title: 'ログイン' })
})

app.post('/login', async (c) => {
  const form = await readForm(c)
  const login = field(form, 'login', 254).toLowerCase()
  const password = field(form, 'password', 200)
  const next = field(form, 'next', 500)

  const ip = clientIp(c)
  const wait = Math.max(loginFailuresByIp.retryAfter(ip), loginFailuresByAccount.retryAfter(login))
  if (wait) {
    return c.render(<LoginPage login={login} next={next} errors={{ form: tooManyRequests(c, wait) }} />, { title: 'ログイン' })
  }

  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(login.includes('@') ? eq(users.email, login) : eq(users.username, login))
    .get()
  const ok = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password)

  if (!user || !ok) {
    loginFailuresByIp.hit(ip)
    loginFailuresByAccount.hit(login)
    c.status(401)
    return c.render(
      <LoginPage login={login} next={next} errors={{ form: 'メールアドレス（ユーザー名）またはパスワードが正しくありません。' }} />,
      { title: 'ログイン' },
    )
  }

  loginFailuresByAccount.reset(login)

  if (needsRehash(user.passwordHash)) {
    const passwordHash = await hashPassword(password)
    // id だけを条件にしないのは、同時に行われたパスワード変更を古いパスワードで上書きしないため
    db.update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
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
  const email = field(form, 'email', 254).toLowerCase()
  const next = field(form, 'next', 500)

  if (!isEmail(email)) {
    c.status(422)
    return c.render(<RegisterPage email={email} next={next} errors={{ email: '有効なメールアドレスを入力してください。' }} />, {
      title: '新規登録',
    })
  }

  const ip = clientIp(c)
  const wait = Math.max(registerByIp.retryAfter(ip), registerByEmail.retryAfter(email))
  if (wait) {
    return c.render(<RegisterPage email={email} next={next} errors={{ form: tooManyRequests(c, wait) }} />, { title: '新規登録' })
  }
  registerByIp.hit(ip)
  registerByEmail.hit(email)

  // 登録済みかどうかは画面に出さず、メールの内容だけを変える（画面からの登録有無の列挙を防ぐ）
  const origin = config.appOrigin ?? new URL(c.req.url).origin
  const exists = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  const mail = exists
    ? {
        subject: '【StepLearn】このメールアドレスは登録済みです',
        text: [
          'StepLearn で、このメールアドレスでの新規登録が試みられました。',
          'このメールアドレスのアカウントはすでに登録されています。次の URL からログインしてください。',
          '',
          `${origin}/login`,
          '',
          '心当たりがない場合は、このメールを破棄してください。',
        ].join('\n'),
      }
    : {
        subject: '【StepLearn】登録を完了してください',
        text: [
          'StepLearn への登録ありがとうございます。',
          '次の URL を開いて、24時間以内に登録を完了してください。',
          '',
          `${origin}/register/complete?token=${await createEmailVerification(email, next)}`,
          '',
          '心当たりがない場合は、このメールを破棄してください。',
        ].join('\n'),
      }
  // 送信を待たないのは、SMTP の応答時間や失敗の有無から登録済みかどうかを推測されないようにするため
  mailer.send({ to: email, ...mail }).catch((err) => console.error('[mail] 送信に失敗しました', err))

  return c.render(<RegisterSentPage email={email} />, { title: '新規登録' })
})

app.get('/register/complete', async (c) => {
  if (c.var.user) return c.redirect('/dashboard')
  const token = c.req.query('token') ?? ''
  const verification = await findEmailVerification(token)
  if (!verification) {
    c.status(410)
    return c.render(<InvalidLinkPage />, { title: '新規登録' })
  }
  return c.render(<CompleteRegisterPage token={token} email={verification.email} />, { title: '新規登録' })
})

app.post('/register/complete', async (c) => {
  const form = await readForm(c)
  const token = field(form, 'token', 100)
  const name = field(form, 'name', 60)
  const username = normalizeUsername(field(form, 'username', 100))
  const password = field(form, 'password', 200)

  const verification = await findEmailVerification(token)
  if (!verification) {
    c.status(410)
    return c.render(<InvalidLinkPage />, { title: '新規登録' })
  }
  const { email, next } = verification

  const errors: Errors = {}
  if (!name) errors.name = '氏名を入力してください。'
  const usernameError = checkUsername(username)
  if (usernameError) errors.username = usernameError
  const passwordError = checkPassword(password, { email, name, username })
  if (passwordError) errors.password = passwordError
  if (Object.keys(errors).length) {
    c.status(422)
    return c.render(<CompleteRegisterPage token={token} email={email} name={name} username={username} errors={errors} />, { title: '新規登録' })
  }

  const created = await createUser({ email, name, username, password })
  if ('taken' in created) {
    if (created.taken === 'email') return redirectWith(c, '/login', 'このメールアドレスはすでに登録されています。ログインしてください。', 'info')
    c.status(422)
    const errors = { username: 'このユーザー名はすでに使われています。' }
    return c.render(<CompleteRegisterPage token={token} email={email} name={name} username={username} errors={errors} />, { title: '新規登録' })
  }

  await createSession(c, created.id)
  return redirectWith(c, safeNext(next), `ようこそ、${name}さん！`)
})

app.post('/logout', async (c) => {
  await destroySession(c)
  return redirectWith(c, '/login', 'ログアウトしました。', 'info')
})

export default app
