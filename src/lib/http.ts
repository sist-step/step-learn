import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv, Flash } from './types'

const FLASH_COOKIE = 'flash'

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

export type Form = Record<string, string | File | (string | File)[]>

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
