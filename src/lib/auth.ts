import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv, NavCourse, Role, User } from './types'
import { db } from './db'

const SESSION_COOKIE = 'sid'
const SESSION_TTL = 60 * 60 * 24 * 30 // 30日
// 残り期限がこれを下回ったときだけ延長する（毎リクエストの書き込みを避ける）
const SESSION_REFRESH_BELOW = SESSION_TTL / 2

// Workers の PBKDF2 は 100,000 回が上限
const PBKDF2_ITERATIONS = 100_000

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

// 存在しないユーザーでもハッシュ計算を行い、応答時間からの列挙を防ぐ
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(new Uint8Array(16))}$${toB64(new Uint8Array(32))}`
export const dummyVerify = (password: string) => verifyPassword(password, DUMMY_HASH)

const sessionIdFromToken = async (token: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(token)))

function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  })
}

export async function createSession(c: Context<AppEnv>, userId: number) {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (ch) => ({ '+': '-', '/': '_', '=': '' })[ch]!)
  const id = await sessionIdFromToken(token)
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, now() + SESSION_TTL)
    .run()
  setSessionCookie(c, token)
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sessionIdFromToken(token)).run()
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** 現在のセッション以外を無効化する（パスワード変更時など） */
export async function destroyOtherSessions(c: Context<AppEnv>, userId: number) {
  const token = getCookie(c, SESSION_COOKIE)
  const current = token ? await sessionIdFromToken(token) : ''
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, current).run()
}

/**
 * セッションからユーザーを復元する。
 * GET のときはサイドバー用の受講コース一覧も同じ batch でまとめて取得する。
 */
export const session = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null)
  c.set('navCourses', [])

  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return next()

  const sid = await sessionIdFromToken(token)
  const t = now()
  const userQuery = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sid, t)

  let row: (User & { expires_at: number }) | null
  if (c.req.method === 'GET') {
    const navQuery = db
      .prepare(
        `SELECT c.id, c.title, c.color
         FROM sessions s
         JOIN enrollments e ON e.user_id = s.user_id
         JOIN courses c ON c.id = e.course_id
         WHERE s.id = ? AND s.expires_at > ?
         ORDER BY c.title LIMIT 12`,
      )
      .bind(sid, t)
    const [u, nav] = await db.batch([userQuery, navQuery])
    row = (u.results[0] as (User & { expires_at: number }) | undefined) ?? null
    c.set('navCourses', nav.results as NavCourse[])
  } else {
    row = await userQuery.first()
  }

  if (!row) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return next()
  }

  const { expires_at, ...user } = row
  c.set('user', user)

  if (expires_at - t < SESSION_REFRESH_BELOW) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(t + SESSION_TTL, sid).run()
    setSessionCookie(c, token)
  }

  await next()
})

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

export const canCreateCourse = (user: User | null) => user?.role === 'admin' || user?.role === 'teacher'

/** オープンリダイレクトを防ぐため、同一サイト内の相対パスのみ許可 */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard'
  return next
}
