import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  USERNAME_TAKEN,
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
} from '../../lib/auth'
import { config } from '../../lib/config'
import { db } from '../../lib/db'
import { validate } from '../../lib/forms'
import { clientIp, field, readForm, redirectWith } from '../../lib/http'
import { mailer } from '../../lib/mail'
import { rateLimiter } from '../../lib/rate-limit'
import { users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { CompleteRegisterPage, InvalidLinkPage, LoginPage, RegisterPage, RegisterSentPage } from './views'

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

export function showLogin(c: Context<AppEnv>) {
  if (c.var.user) return c.redirect('/dashboard')
  return c.render(<LoginPage next={c.req.query('next')} />, { title: 'ログイン' })
}

export async function submitLogin(c: Context<AppEnv>) {
  const form = await readForm(c)
  const result = validate('login', form)
  if (!result.ok) {
    c.status(422)
    return c.render(<LoginPage login={field(form, 'login', 254)} next={field(form, 'next', 500)} errors={result.errors} />, {
      title: 'ログイン',
    })
  }
  const { login, password, next } = result.values

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
}

export function showRegister(c: Context<AppEnv>) {
  if (c.var.user) return c.redirect('/dashboard')
  return c.render(<RegisterPage next={c.req.query('next')} />, { title: '新規登録' })
}

export async function submitRegister(c: Context<AppEnv>) {
  const form = await readForm(c)
  const result = validate('register', form)
  if (!result.ok) {
    c.status(422)
    return c.render(<RegisterPage email={field(form, 'email', 254)} next={field(form, 'next', 500)} errors={result.errors} />, {
      title: '新規登録',
    })
  }
  const { email, next } = result.values

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
        subject: '【STEP Learn】このメールアドレスは登録済みです',
        text: [
          'STEP Learn で、このメールアドレスでの新規登録が試みられました。',
          'このメールアドレスのアカウントはすでに登録されています。次の URL からログインしてください。',
          '',
          `${origin}/login`,
          '',
          '心当たりがない場合は、このメールを破棄してください。',
        ].join('\n'),
      }
    : {
        subject: '【STEP Learn】登録を完了してください',
        text: [
          'STEP Learn への登録ありがとうございます。',
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
}

export async function showCompleteRegister(c: Context<AppEnv>) {
  if (c.var.user) return c.redirect('/dashboard')
  const token = c.req.query('token') ?? ''
  const verification = await findEmailVerification(token)
  if (!verification) {
    c.status(410)
    return c.render(<InvalidLinkPage />, { title: '新規登録' })
  }
  return c.render(<CompleteRegisterPage token={token} email={verification.email} />, { title: '新規登録' })
}

export async function submitCompleteRegister(c: Context<AppEnv>) {
  const form = await readForm(c)
  const token = field(form, 'token', 100)
  const verification = await findEmailVerification(token)
  if (!verification) {
    c.status(410)
    return c.render(<InvalidLinkPage />, { title: '新規登録' })
  }
  const { email, next } = verification

  // 送られてきたメールアドレスを使わないのは、画面の隠し欄は書き換えられるので、確認済みのものと違うかもしれないため
  const result = validate('completeRegister', { ...form, email })
  if (!result.ok) {
    const values = { name: field(form, 'name', 60), username: field(form, 'username', 100) }
    c.status(422)
    return c.render(<CompleteRegisterPage token={token} email={email} {...values} errors={result.errors} />, { title: '新規登録' })
  }
  const { name, username, password } = result.values

  const created = await createUser({ email, name, username, password })
  if ('taken' in created) {
    if (created.taken === 'email')
      return redirectWith(c, '/login', 'このメールアドレスはすでに登録されています。ログインしてください。', 'info')
    c.status(422)
    return c.render(
      <CompleteRegisterPage token={token} email={email} name={name} username={username} errors={{ username: USERNAME_TAKEN }} />,
      {
        title: '新規登録',
      },
    )
  }

  await createSession(c, created.id)
  return redirectWith(c, safeNext(next), `ようこそ、${name}さん！`)
}

export async function logout(c: Context<AppEnv>) {
  await destroySession(c)
  return redirectWith(c, '/login', 'ログアウトしました。', 'info')
}
