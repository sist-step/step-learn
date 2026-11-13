import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  USERNAME_TAKEN,
  createEmailVerification,
  createPasswordReset,
  createSession,
  createUser,
  destroySession,
  dummyVerify,
  findEmailVerification,
  findPasswordReset,
  hashPassword,
  needsRehash,
  resetPassword,
  verifyPassword,
} from '../../lib/auth'
import { config } from '../../lib/config'
import { db } from '../../lib/db'
import { type FieldErrors, validate } from '../../lib/forms'
import { clientIp, field, readForm, redirectWith, safeNext } from '../../lib/http'
import { mailer } from '../../lib/mail'
import { checkPassword } from '../../lib/password'
import { rateLimiter } from '../../lib/rate-limit'
import { users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import {
  CompleteRegisterPage,
  ForgotPasswordPage,
  ForgotPasswordSentPage,
  InvalidLinkPage,
  LoginPage,
  RegisterPage,
  RegisterSentPage,
  ResetPasswordPage,
} from './views'

// IP ごとの上限を高めにしているのは、教室などで同じグローバル IP から大勢が一斉にアクセスするため
const loginFailuresByIp = rateLimiter({ limit: 50, windowSec: 15 * 60 })
const loginFailuresByAccount = rateLimiter({ limit: 10, windowSec: 15 * 60 })
const registerByIp = rateLimiter({ limit: 100, windowSec: 60 * 60 })
const registerByEmail = rateLimiter({ limit: 3, windowSec: 60 * 60 })
const forgotByIp = rateLimiter({ limit: 100, windowSec: 60 * 60 })
const forgotByEmail = rateLimiter({ limit: 3, windowSec: 60 * 60 })

const appOrigin = (c: Context) => config.appOrigin ?? new URL(c.req.url).origin

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
  // 入力のまま数えないのは、メールアドレスもユーザー名も大文字小文字を区別せずに照合するので、書き分けるだけで上限を逃れられるため
  const account = login.toLowerCase()
  const wait = Math.max(loginFailuresByIp.retryAfter(ip), loginFailuresByAccount.retryAfter(account))
  if (wait) {
    return c.render(<LoginPage login={login} next={next} errors={{ form: tooManyRequests(c, wait) }} />, { title: 'ログイン' })
  }
  // 照合に失敗してから数えないのは、照合を待つ間に届いた同時のリクエストが、どれも上限の判定を通ってしまうため
  loginFailuresByIp.hit(ip)
  loginFailuresByAccount.hit(account)

  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(login.includes('@') ? eq(users.email, login) : eq(users.username, login))
    .get()
  const ok = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password)

  if (!user || !ok) {
    if (user) c.set('logUserId', user.id)
    c.status(401)
    return c.render(
      <LoginPage login={login} next={next} errors={{ form: 'メールアドレス（ユーザー名）またはパスワードが正しくありません。' }} />,
      { title: 'ログイン' },
    )
  }

  loginFailuresByIp.release(ip)
  loginFailuresByAccount.reset(account)

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
  const origin = appOrigin(c)
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
    return c.render(<InvalidLinkPage retry="register" />, { title: '新規登録' })
  }
  return c.render(<CompleteRegisterPage token={token} email={verification.email} />, { title: '新規登録' })
}

export async function submitCompleteRegister(c: Context<AppEnv>) {
  const form = await readForm(c)
  const token = field(form, 'token', 100)
  const verification = await findEmailVerification(token)
  if (!verification) {
    c.status(410)
    return c.render(<InvalidLinkPage retry="register" />, { title: '新規登録' })
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

export function showForgotPassword(c: Context<AppEnv>) {
  if (c.var.user) return c.redirect('/account')
  return c.render(<ForgotPasswordPage />, { title: 'パスワードの再設定' })
}

export async function submitForgotPassword(c: Context<AppEnv>) {
  const form = await readForm(c)
  const result = validate('forgotPassword', form)
  if (!result.ok) {
    c.status(422)
    return c.render(<ForgotPasswordPage email={field(form, 'email', 254)} errors={result.errors} />, { title: 'パスワードの再設定' })
  }
  const { email } = result.values

  const ip = clientIp(c)
  const wait = Math.max(forgotByIp.retryAfter(ip), forgotByEmail.retryAfter(email))
  if (wait) {
    return c.render(<ForgotPasswordPage email={email} errors={{ form: tooManyRequests(c, wait) }} />, { title: 'パスワードの再設定' })
  }
  forgotByIp.hit(ip)
  forgotByEmail.hit(email)

  // 未登録のアドレスに「登録がない」と知らせるメールを送らないのは、入力さえすれば誰にでもメールを送れてしまうため
  const user = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  if (user) {
    const mail = {
      subject: '【STEP Learn】パスワードの再設定',
      text: [
        'STEP Learn で、パスワードの再設定が求められました。',
        '次の URL を開いて、1時間以内に新しいパスワードを設定してください。',
        '',
        `${appOrigin(c)}/password/reset?token=${await createPasswordReset(user.id)}`,
        '',
        '心当たりがない場合は、このメールを破棄してください。パスワードは変わりません。',
      ].join('\n'),
    }
    // 送信を待たないのは、SMTP の応答時間や失敗の有無から登録済みかどうかを推測されないようにするため
    mailer.send({ to: email, ...mail }).catch((err) => console.error('[mail] 送信に失敗しました', err))
  }

  return c.render(<ForgotPasswordSentPage email={email} />, { title: 'パスワードの再設定' })
}

export async function showResetPassword(c: Context<AppEnv>) {
  const token = c.req.query('token') ?? ''
  const user = await findPasswordReset(token)
  if (!user) {
    c.status(410)
    return c.render(<InvalidLinkPage retry="reset" />, { title: 'パスワードの再設定' })
  }
  return c.render(<ResetPasswordPage token={token} email={user.email} />, { title: 'パスワードの再設定' })
}

export async function submitResetPassword(c: Context<AppEnv>) {
  const form = await readForm(c)
  const token = field(form, 'token', 100)
  const user = await findPasswordReset(token)
  if (!user) {
    c.status(410)
    return c.render(<InvalidLinkPage retry="reset" />, { title: 'パスワードの再設定' })
  }

  const result = validate('resetPassword', form)
  // スキーマで確かめないのは、パスワードに含めてはいけない氏名やユーザー名がこのフォームの入力にないため
  const passwordError = result.ok ? checkPassword(result.values.password, user) : null
  if (!result.ok || passwordError) {
    const errors: FieldErrors = result.ok ? { password: passwordError! } : result.errors
    c.status(422)
    return c.render(<ResetPasswordPage token={token} email={user.email} errors={errors} />, { title: 'パスワードの再設定' })
  }

  await resetPassword(user.id, result.values.password)
  // 先に今のセッションを消すのは、別のアカウントでログインしたままリンクを開いた場合に、そのセッションを残さないため
  await destroySession(c)
  await createSession(c, user.id)
  return redirectWith(c, '/dashboard', 'パスワードを設定しました。')
}

export async function logout(c: Context<AppEnv>) {
  await destroySession(c)
  return redirectWith(c, '/login', 'ログアウトしました。', 'info')
}
