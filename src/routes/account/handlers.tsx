import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { destroyOtherSessions, hashPassword, verifyPassword } from '../../lib/auth'
import { db } from '../../lib/db'
import { field, readForm, redirectWith } from '../../lib/http'
import { checkPassword } from '../../lib/password'
import { users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { checkUsername, normalizeUsername } from '../../lib/username'
import { AccountPage, type Errors } from './views'

export const show = (c: Context<AppEnv>) => c.render(<AccountPage user={c.var.user!} />, { title: 'アカウント' })

export async function updateProfile(c: Context<AppEnv>) {
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
}

export async function changePassword(c: Context<AppEnv>) {
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
}
