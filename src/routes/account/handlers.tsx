import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { USERNAME_TAKEN, destroyOtherSessions, hasPassword, hashPassword, isUsernameTaken, verifyPassword } from '../../lib/auth'
import { config } from '../../lib/config'
import { db } from '../../lib/db'
import { validate, type FieldErrors } from '../../lib/forms'
import { type Form, field, readForm, redirectWith } from '../../lib/http'
import { microsoftAccountOf, startMicrosoftAuth, unlinkMicrosoft } from '../../lib/microsoft'
import { checkPassword } from '../../lib/password'
import { rateLimiter } from '../../lib/rate-limit'
import { users } from '../../lib/schema'
import type { AppEnv, User } from '../../lib/types'
import { type AccountSecurity, AccountPage, type Profile } from './views'

// ログインと同じくらいに抑えるのは、セッションを奪った人が、ここを現在のパスワードを総当たりで探す手段に使えないようにするため
const passwordFailures = rateLimiter({ limit: 10, windowSec: 15 * 60 })

const passwordHashOf = (userId: number) =>
  db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get()?.passwordHash ?? ''

const securityOf = (user: User): AccountSecurity => ({
  hasPassword: hasPassword(passwordHashOf(user.id)),
  microsoft: config.microsoft ? { account: microsoftAccountOf(user.id) } : null,
})

function render(c: Context<AppEnv>, { errors, values }: { errors?: FieldErrors; values?: Profile } = {}) {
  const user = c.var.user!
  return c.render(<AccountPage user={user} security={securityOf(user)} errors={errors} values={values} />, { title: 'アカウント' })
}

export const show = (c: Context<AppEnv>) => render(c)

export async function updateProfile(c: Context<AppEnv>) {
  const user = c.var.user!
  const form = await readForm(c)
  const result = validate('profile', form)
  const errors: FieldErrors = result.ok ? {} : result.errors
  if (result.ok && isUsernameTaken(result.values.username, user.id)) errors.username = USERNAME_TAKEN
  if (!result.ok || errors.username) {
    const values = { name: field(form, 'name', 60), username: field(form, 'username', 100) }
    c.status(422)
    return render(c, { values, errors })
  }
  db.update(users).set(result.values).where(eq(users.id, user.id)).run()
  return redirectWith(c, '/account', 'プロフィールを更新しました。')
}

export async function changePassword(c: Context<AppEnv>) {
  const user = c.var.user!
  const form = await readForm(c)
  const stored = passwordHashOf(user.id)
  if (!hasPassword(stored)) return setPassword(c, form, stored)

  const result = validate('password', form)
  if (!result.ok) {
    c.status(422)
    return render(c, { errors: result.errors })
  }
  const { current, password } = result.values

  const key = String(user.id)
  const wait = passwordFailures.retryAfter(key)
  if (wait) {
    c.status(429)
    c.header('Retry-After', String(wait))
    const message = `試行回数が多すぎます。${Math.ceil(wait / 60)}分ほど待ってから再度お試しください。`
    return render(c, { errors: { current: message } })
  }
  // 照合に失敗してから数えないのは、照合を待つ間に届いた同時のリクエストが、どれも上限の判定を通ってしまうため
  passwordFailures.hit(key)

  const errors: FieldErrors = {}
  if (await verifyPassword(current, stored)) passwordFailures.release(key)
  else errors.current = '現在のパスワードが正しくありません。'
  // スキーマで確かめないのは、パスワードに含めてはいけない氏名やユーザー名がこのフォームの入力にないため
  const passwordError = checkPassword(password, user)
  if (passwordError) errors.password = passwordError
  if (Object.keys(errors).length) {
    c.status(422)
    return render(c, { errors })
  }

  const passwordHash = await hashPassword(password)
  db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run()
  await destroyOtherSessions(c, user.id)
  return redirectWith(c, '/account', 'パスワードを変更しました。')
}

/** Microsoft アカウントで登録したなど、まだパスワードがないユーザーが最初に設定する。照らし合わせる現在のパスワードがないので聞かない */
async function setPassword(c: Context<AppEnv>, form: Form, stored: string) {
  const user = c.var.user!
  const result = validate('setPassword', form)
  const passwordError = result.ok ? checkPassword(result.values.password, user) : null
  if (!result.ok || passwordError) {
    c.status(422)
    return render(c, { errors: result.ok ? { password: passwordError! } : result.errors })
  }
  const passwordHash = await hashPassword(result.values.password)
  // id だけを条件にしないのは、別のタブで先に設定したパスワードを、現在のパスワードを聞かずに上書きしないため
  const res = db
    .update(users)
    .set({ passwordHash })
    .where(and(eq(users.id, user.id), eq(users.passwordHash, stored)))
    .run()
  if (!res.changes) return redirectWith(c, '/account', 'パスワードはすでに設定されています。', 'info')
  await destroyOtherSessions(c, user.id)
  return redirectWith(c, '/account', 'パスワードを設定しました。')
}

// ---------------------------------------------------------------- Microsoft アカウント

export async function linkMicrosoft(c: Context<AppEnv>) {
  if (!config.microsoft) return c.notFound()
  return c.redirect(await startMicrosoftAuth(c, { next: '/account', linkUserId: c.var.user!.id }), 303)
}

export function unlink(c: Context<AppEnv>) {
  if (!config.microsoft) return c.notFound()
  const user = c.var.user!
  // パスワードがないまま解除させないのは、パスワードでも Microsoft アカウントでもログインできなくなり、メールでの再設定でしか戻れなくなるため
  if (!hasPassword(passwordHashOf(user.id)))
    return redirectWith(c, '/account', 'パスワードを設定してから、連携を解除してください。', 'error')
  unlinkMicrosoft(user.id)
  return redirectWith(c, '/account', 'Microsoft アカウントの連携を解除しました。', 'info')
}
