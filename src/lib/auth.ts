import { and, eq, gt, lte, ne } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { parseSigned } from 'hono/utils/cookie'
import type { AppEnv, Role, User } from './types'
import { config } from './config'
import { db } from './db'
import { courses, emailVerifications, enrollments, sessions, users } from './schema'

const SESSION_COOKIE = 'sid'
const SESSION_TTL = 60 * 60 * 24 * 30 // 30日
// 残り期限がこれを下回ったときだけ延長する（毎リクエストの書き込みを避ける）
const SESSION_REFRESH_BELOW = SESSION_TTL / 2

const PBKDF2_ITERATIONS = 600_000

const EMAIL_VERIFICATION_TTL = 60 * 60 * 24 // 24時間

const enc = new TextEncoder()

const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

const now = () => Math.floor(Date.now() / 1000)

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false
  const derived = await pbkdf2(password, fromB64(salt), Number(iter))
  return timingSafeEqual(new Uint8Array(derived), fromB64(hash))
}

export function needsRehash(stored: string) {
  const [scheme, iter] = stored.split('$')
  return scheme !== 'pbkdf2' || Number(iter) < PBKDF2_ITERATIONS
}

// 存在しないユーザーでもハッシュ計算を行い、応答時間からの列挙を防ぐ
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(new Uint8Array(16))}$${toB64(new Uint8Array(32))}`
export const dummyVerify = (password: string) => verifyPassword(password, DUMMY_HASH)

const randomToken = () =>
  toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (ch) => ({ '+': '-', '/': '_', '=': '' })[ch]!)
const hashToken = async (token: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(token)))
const sessionIdFromToken = hashToken

function setSessionCookie(c: Context, token: string) {
  return setSignedCookie(c, SESSION_COOKIE, token, config.sessionSecret, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  })
}

async function readSessionToken(c: Context) {
  const token = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE)
  return typeof token === 'string' ? token : null
}

export async function createSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken()
  const id = await sessionIdFromToken(token)
  db.insert(sessions)
    .values({ id, userId, expiresAt: now() + SESSION_TTL })
    .run()
  await setSessionCookie(c, token)
}

export async function destroySession(c: Context<AppEnv>) {
  const token = await readSessionToken(c)
  if (token) {
    const id = await sessionIdFromToken(token)
    db.delete(sessions).where(eq(sessions.id, id)).run()
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export const USERNAME_TAKEN = 'このユーザー名はすでに使われています。'

export const isUsernameTaken = (username: string, exceptUserId?: number) =>
  !!db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), exceptUserId ? ne(users.id, exceptUserId) : undefined))
    .get()

/** 作成できたらユーザー ID を、メールアドレスかユーザー名が登録済みならどちらが重複したかを返す */
export async function createUser(user: { email: string; name: string; username: string; password: string; role?: Role }) {
  const passwordHash = await hashPassword(user.password)
  return db.transaction((tx): { id: number } | { taken: 'email' | 'username' } => {
    const inserted = tx
      .insert(users)
      .values({ email: user.email, name: user.name, username: user.username, passwordHash, role: user.role ?? 'student' })
      // 事前の存在確認だけに頼らないのは、確認と INSERT の間に同じメールやユーザー名で登録されると UNIQUE 制約違反になるため
      .onConflictDoNothing()
      .returning({ id: users.id })
      .get()
    const emailTaken = !inserted && !!tx.select({ id: users.id }).from(users).where(eq(users.email, user.email)).get()
    // ユーザー名の重複で確認用トークンを消さないのは、別のユーザー名で登録をやり直せるようにするため
    if (inserted || emailTaken) tx.delete(emailVerifications).where(eq(emailVerifications.email, user.email)).run()
    if (inserted) return { id: inserted.id }
    return { taken: emailTaken ? 'email' : 'username' }
  })
}

/** メール確認用のトークンを発行する。DB にはハッシュだけを保存し、平文はメールのリンクにだけ載せる */
export async function createEmailVerification(email: string, next: string) {
  const token = randomToken()
  const t = now()
  const tokenHash = await hashToken(token)
  db.transaction((tx) => {
    tx.delete(emailVerifications).where(lte(emailVerifications.expiresAt, t)).run()
    tx.insert(emailVerifications)
      .values({ tokenHash, email, next, expiresAt: t + EMAIL_VERIFICATION_TTL })
      .run()
  })
  return token
}

export async function findEmailVerification(token: string) {
  if (!token) return null
  const tokenHash = await hashToken(token)
  const row = db
    .select({ email: emailVerifications.email, next: emailVerifications.next })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.tokenHash, tokenHash), gt(emailVerifications.expiresAt, now())))
    .get()
  return row ?? null
}

/** 現在のセッション以外を無効化する（パスワード変更時など） */
export async function destroyOtherSessions(c: Context<AppEnv>, userId: number) {
  const token = await readSessionToken(c)
  const current = token ? await sessionIdFromToken(token) : ''
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, current)))
    .run()
}

const userColumns = { id: users.id, email: users.email, name: users.name, username: users.username, role: users.role }

const findSessionUser = (sid: string) =>
  db
    .select({ ...userColumns, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, now())))
    .get()

/** セッションからユーザーを復元する。GET のときはナビ用の受講コース一覧も取得する */
export const session = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null)
  c.set('navCourses', [])

  const token = await readSessionToken(c)
  if (!token) {
    if (getCookie(c, SESSION_COOKIE) !== undefined) deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return next()
  }

  const sid = await sessionIdFromToken(token)
  const row = findSessionUser(sid)
  if (!row) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return next()
  }

  const { expiresAt, ...user } = row
  c.set('user', user)
  if (c.req.method === 'GET') {
    c.set(
      'navCourses',
      db
        .select({ id: courses.id, title: courses.title, color: courses.color, iconImage: courses.iconImage })
        .from(enrollments)
        .innerJoin(courses, eq(courses.id, enrollments.courseId))
        .where(eq(enrollments.userId, user.id))
        .orderBy(courses.title)
        .limit(12)
        .all(),
    )
  }

  const t = now()
  if (expiresAt - t < SESSION_REFRESH_BELOW) {
    db.update(sessions)
      .set({ expiresAt: t + SESSION_TTL })
      .where(eq(sessions.id, sid))
      .run()
    await setSessionCookie(c, token)
  }

  await next()
})

/** socket.io の接続のように Hono の Context がないところで、Cookie ヘッダーからユーザーを復元する */
export async function userFromCookieHeader(header: string | undefined) {
  if (!header) return null
  const token = (await parseSigned(header, config.sessionSecret, SESSION_COOKIE))[SESSION_COOKIE]
  if (typeof token !== 'string') return null
  const row = findSessionUser(await sessionIdFromToken(token))
  if (!row) return null
  const { expiresAt, ...user } = row
  return user
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) {
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? url.pathname + url.search : '/dashboard'
    return c.redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  await next()
})

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user
    if (!user || !roles.includes(user.role)) return c.notFound()
    await next()
  })

export const canCreateCourse = (user: User | null) => user?.role === 'admin'

/** オープンリダイレクトを防ぐため、同一サイト内の相対パスのみ許可 */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard'
  return next
}
