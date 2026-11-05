import { and, eq, gt, lte } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { config } from '../lib/config'
import type { AppEnv, User } from '../lib/types'
import { coursesKey, cached } from './cache'
import { api, isTokenError, type Exchanged } from './client'
import { db } from './db'
import { toNavCourse } from './mapping'
import { sessions, users } from './schema'
import { decryptToken, encryptToken } from './token'

// 必須にしないのは、AppEnv を受け取る共通の部品（renderer・redirectWith など）にそのまま渡せるようにするため
export type MoodleEnv = { Variables: AppEnv['Variables'] & { token?: string } }

// 通常モードの sid と名前を分けるのは、同じホストで両方のモードを動かしたとき（開発で別ポートに立てるなど）に Cookie が混ざらないため
const SESSION_COOKIE = 'moodle_sid'
const SESSION_TTL = 60 * 60 * 24 * 30 // 30日
// 残り期限がこれを下回ったときだけ延長する（毎リクエストの書き込みを避ける）
const SESSION_REFRESH_BELOW = SESSION_TTL / 2

const NAV_LIMIT = 12

const enc = new TextEncoder()
const now = () => Math.floor(Date.now() / 1000)
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')

function setSessionCookie(c: Context, token: string) {
  return setSignedCookie(c, SESSION_COOKIE, token, config.sessionSecret, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  })
}

async function readSessionId(c: Context) {
  const token = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE)
  return typeof token === 'string' ? sha256(token) : null
}

/** コードを交換して受け取ったユーザーで、STEP Learn のセッションを始める */
export async function createSession(c: Context<MoodleEnv>, ex: Exchanged) {
  const user = {
    username: ex.username,
    name: ex.fullname,
    email: ex.email,
    siteAdmin: ex.siteadmin ? 1 : 0,
    token: encryptToken(ex.token),
    tokenExpiresAt: ex.validuntil,
  }
  const token = randomToken()
  const id = await sha256(token)
  db.transaction((tx) => {
    tx.insert(users)
      .values({ id: ex.userid, ...user })
      .onConflictDoUpdate({ target: users.id, set: user })
      .run()
    tx.delete(sessions).where(lte(sessions.expiresAt, now())).run()
    tx.insert(sessions)
      .values({ id, userId: ex.userid, moodleSid: ex.sidhash, expiresAt: now() + SESSION_TTL })
      .run()
  })
  await setSessionCookie(c, token)
}

export async function destroySession(c: Context) {
  const id = await readSessionId(c)
  if (id) db.delete(sessions).where(eq(sessions.id, id)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** Moodle でログアウトされたセッションから始めた、STEP Learn のセッションを消す */
export const destroyByMoodleSid = (sidhash: string) => db.delete(sessions).where(eq(sessions.moodleSid, sidhash)).run().changes

const findSession = (id: string) =>
  db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      siteAdmin: users.siteAdmin,
      token: users.token,
      tokenExpiresAt: users.tokenExpiresAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now())))
    .get()

export const session = createMiddleware<MoodleEnv>(async (c, next) => {
  c.set('user', null)
  c.set('navCourses', [])

  const id = await readSessionId(c)
  const row = id && findSession(id)
  const token = row ? decryptToken(row.token) : null
  // トークンの期限が切れたら Moodle にログインし直してもらう。Moodle のセッションが残っていれば画面は出ずに戻ってくる
  const expired = !!row && row.tokenExpiresAt > 0 && row.tokenExpiresAt <= now()
  if (!id || !row || !token || expired) {
    if (id && row) db.delete(sessions).where(eq(sessions.id, id)).run()
    if (getCookie(c, SESSION_COOKIE) !== undefined) deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return next()
  }

  const user: User = { id: row.id, email: row.email, name: row.name, username: row.username, role: row.siteAdmin ? 'admin' : 'student' }
  c.set('user', user)
  c.set('token', token)
  if (c.req.method === 'GET') {
    try {
      const list = await cached(coursesKey(user.id), () => api(token).myCourses())
      c.set(
        'navCourses',
        list
          .filter((m) => m.role)
          .slice(0, NAV_LIMIT)
          .map(toNavCourse),
      )
    } catch (e) {
      // ナビが出せないだけで画面は表示できるので、トークンが無効なとき以外は続ける
      if (isTokenError(e)) throw e
      console.error('[moodle] navCourses', e)
    }
  }

  const t = now()
  if (row.expiresAt - t < SESSION_REFRESH_BELOW) {
    db.update(sessions)
      .set({ expiresAt: t + SESSION_TTL })
      .where(eq(sessions.id, id))
      .run()
    const cookie = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE)
    if (typeof cookie === 'string') await setSessionCookie(c, cookie)
  }

  await next()
})

export const requireAuth = createMiddleware<MoodleEnv>(async (c, next) => {
  if (!c.var.user) {
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? url.pathname + url.search : '/dashboard'
    return c.redirect(`/login?next=${encodeURIComponent(next)}`)
  }
  await next()
})

/** オープンリダイレクトを防ぐため、同一サイト内の相対パスのみ許可 */
export function safeNext(next: string | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard'
  return next
}
