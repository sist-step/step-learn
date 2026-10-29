import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { config } from './config'
import type { AppEnv, Flash } from './types'

const FLASH_COOKIE = 'flash'
const SIDEBAR_COOKIE = 'sidebar'

export const flashMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('flash', null)
  const raw = getCookie(c, FLASH_COOKIE)
  if (raw) {
    try {
      c.set('flash', JSON.parse(raw) as Flash)
    } catch {}
    deleteCookie(c, FLASH_COOKIE, { path: '/' })
  }
  await next()
})

/** 次のページ表示時にトーストを出してリダイレクトする */
export function redirectWith(c: Context<AppEnv>, location: string, message: string, type: Flash['type'] = 'success') {
  setCookie(c, FLASH_COOKIE, JSON.stringify({ type, message }), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 })
  return c.redirect(location, 303)
}

export const isSidebarCollapsed = (c: Context) => getCookie(c, SIDEBAR_COOKIE) === 'collapsed'

export type Theme = 'light' | 'dark'

const THEME_COOKIE = 'theme'

// OS の設定に合わせないのは、利用者が自分で選んだときだけダークにするため
export const getTheme = (c: Context): Theme => (getCookie(c, THEME_COOKIE) === 'dark' ? 'dark' : 'light')

const EDIT_MODE_COOKIE = 'edit_mode'

export const isEditMode = (c: Context) => getCookie(c, EDIT_MODE_COOKIE) === '1'

// URL のクエリで持たないのは、コースや画面をまたいでも編集モードを保つため
export function setEditMode(c: Context, on: boolean) {
  if (on) setCookie(c, EDIT_MODE_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'Lax' })
  else deleteCookie(c, EDIT_MODE_COOKIE, { path: '/' })
}

export type Form =Record<string, string | File | (string | File)[]>

export async function readForm(c: Context): Promise<Form> {
  return (await c.req.parseBody()) as Form
}

export function field(form: Form, key: string, max = 10_000) {
  const v = form[key]
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function intParam(c: Context, key: string) {
  const n = Number(c.req.param(key))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254

export const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const wantsJson = (c: Context) => (c.req.header('accept') ?? '').includes('application/json')

export function clientIp(c: Context) {
  if (config.trustProxy) {
    // 先頭はクライアントが自由に書けるので、直前のプロキシが追記した末尾を使う
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (forwarded) return forwarded
  }
  return getConnInfo(c).remote.address ?? 'unknown'
}
