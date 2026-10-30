import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { USERNAME_TAKEN, destroyOtherSessions, hashPassword, isUsernameTaken, verifyPassword } from '../../lib/auth'
import { db } from '../../lib/db'
import { validate, type FieldErrors } from '../../lib/forms'
import { field, readForm, redirectWith } from '../../lib/http'
import { checkPassword } from '../../lib/password'
import { users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { AccountPage } from './views'

export const show = (c: Context<AppEnv>) => c.render(<AccountPage user={c.var.user!} />, { title: 'アカウント' })

export async function updateProfile(c: Context<AppEnv>) {
  const user = c.var.user!
  const form = await readForm(c)
  const result = validate('profile', form)
  const errors: FieldErrors = result.ok ? {} : result.errors
  if (result.ok && isUsernameTaken(result.values.username, user.id)) errors.username = USERNAME_TAKEN
  if (!result.ok || errors.username) {
    const values = { name: field(form, 'name', 60), username: field(form, 'username', 100) }
    c.status(422)
    return c.render(<AccountPage user={user} values={values} errors={errors} />, { title: 'アカウント' })
  }
  db.update(users).set(result.values).where(eq(users.id, user.id)).run()
  return redirectWith(c, '/account', 'プロフィールを更新しました。')
}

export async function changePassword(c: Context<AppEnv>) {
  const user = c.var.user!
  const result = validate('password', await readForm(c))
  if (!result.ok) {
    c.status(422)
    return c.render(<AccountPage user={user} errors={result.errors} />, { title: 'アカウント' })
  }
  const { current, password } = result.values

  const row = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).get()
  const errors: FieldErrors = {}
  if (!row || !(await verifyPassword(current, row.passwordHash))) errors.current = '現在のパスワードが正しくありません。'
  // スキーマで確かめないのは、パスワードに含めてはいけない氏名やユーザー名がこのフォームの入力にないため
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
}
