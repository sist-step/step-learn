import { and, eq, gt, lte } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { parseSigned } from 'hono/utils/cookie'
import { config } from '../lib/config'
import type { AppEnv, User } from '../lib/types'
import { coursesKey, cached } from './cache'
import { api, isTokenError, type Exchanged } from './client'
import { db } from './db'
import { isInProgress, toNavCourse } from './mapping'
import { sessions, users } from './schema'
import { decryptToken, encryptToken } from './token'

// 必須にしないのは、AppEnv を受け取る共通の部品（renderer・redirectWith など）にそのまま渡せるようにするため
export type MoodleEnv = { Variables: AppEnv['Variables'] & { token?: string } }

// 通常モードの sid と名前を分けるのは、同じホストで両方のモードを動かしたとき（開発で別ポートに立てるなど）に Cookie が混ざらないため
const SESSION_COOKIE = 'moodle_sid'
const SESSION_TTL = 60 * 60 * 24 * 30 // 30日
// 残り期限がこれを下回ったときだけ延長する（毎リクエストの書き込みを避ける）
const SESSION_REFRESH_BELOW = SESSION_TTL / 2

// 毎リクエスト確かめないのは、画面を開くたびに Moodle を 1 回余分に待たせないため。Moodle の時間切れ（既定 8 時間）に比べれば十分短い
const MOODLE_CHECK_INTERVAL = 60_000
const MOODLE_CHECK_MAX_ENTRIES = 5_000

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

const toUser = (row: { id: number; email: string; name: string; username: string; siteAdmin: number }): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  username: row.username,
  role: row.siteAdmin ? 'admin' : 'student',
})

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

const moodleCheckedAt = new Map<string, number>()

/** STEP Learn のセッションを始めた Moodle のセッションが続いているか。続いていれば Moodle 側も延長される */
async function moodleSessionActive(id: string, token: string, moodleSid: string) {
  const last = moodleCheckedAt.get(id)
  if (last !== undefined && Date.now() - last < MOODLE_CHECK_INTERVAL) return true
  moodleCheckedAt.delete(id)
  moodleCheckedAt.set(id, Date.now())
  if (moodleCheckedAt.size > MOODLE_CHECK_MAX_ENTRIES) moodleCheckedAt.delete(moodleCheckedAt.keys().next().value!)
  try {
    const { active } = await api(token).checkSession(moodleSid)
    return active
  } catch (e) {
    if (isTokenError(e)) return false
    // 確かめられないときにログアウトさせないのは、Moodle が一時的に止まったり、プラグインが古かったりするだけで全員を締め出さないため
    console.error('[moodle] checkSession', e)
    return true
  }
}

/** 消したセッションを始めた Moodle のセッション（sid の SHA-256）を返す。セッションがなければ null */
export async function destroySession(c: Context) {
  const id = await readSessionId(c)
  const row = id ? db.delete(sessions).where(eq(sessions.id, id)).returning({ moodleSid: sessions.moodleSid }).get() : undefined
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return row?.moodleSid ?? null
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
      moodleSid: sessions.moodleSid,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now())))
    .get()

/** セッションの行と、セッションが続いていればトークン（続いていなければ token が null。行は呼び出し側で消す） */
async function activeSession(id: string) {
  const row = findSession(id)
  const token = row ? decryptToken(row.token) : null
  // トークンの期限が切れたら Moodle にログインし直してもらう。Moodle のセッションが残っていれば画面は出ずに戻ってくる
  const expired = !!row && row.tokenExpiresAt > 0 && row.tokenExpiresAt <= now()
  // ログアウトの通知だけに頼らないのは、Moodle の時間切れや管理者による強制ログアウトでは user_loggedout が起きないため
  if (!row || !token || expired || !(await moodleSessionActive(id, token, row.moodleSid))) return { row, token: null }
  return { row, token }
}

/** 画面共有の接続（socket.io）のように、Hono を通らない要求の Cookie ヘッダーから利用者とトークンを読む */
export async function sessionFromCookieHeader(header: string | undefined) {
  if (!header) return null
  const cookie = (await parseSigned(header, config.sessionSecret, SESSION_COOKIE))[SESSION_COOKIE]
  if (typeof cookie !== 'string') return null
  const { row, token } = await activeSession(await sha256(cookie))
  return row && token ? { user: toUser(row), token } : null
}

export const session = createMiddleware<MoodleEnv>(async (c, next) => {
  c.set('user', null)
  c.set('navCourses', [])

  const id = await readSessionId(c)
  const { row, token } = id ? await activeSession(id) : { row: undefined, token: null }
  if (!id || !row || !token) {
    if (id && row) db.delete(sessions).where(eq(sessions.id, id)).run()
    if (getCookie(c, SESSION_COOKIE) !== undefined) deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return next()
  }

  const user = toUser(row)
  c.set('user', user)
  c.set('token', token)
  if (c.req.method === 'GET') {
    try {
      const list = await cached(coursesKey(user.id), () => api(token).myCourses())
      c.set(
        'navCourses',
        list
          .filter((m) => m.role && isInProgress(m))
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
