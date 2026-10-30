import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { config } from './config'
import { formatBytes } from './storage'
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

/** Referer が同一オリジンならそのパスを、そうでなければ fallback を返す */
export function sameOriginReferer(c: Context, fallback: string) {
  try {
    const ref = new URL(c.req.header('referer') ?? '')
    if (ref.origin === new URL(c.req.url).origin) return ref.pathname + ref.search
  } catch {}
  return fallback
}

// hono/body-limit を使わないのは、読み切った本文を new Request(c.req.raw) で包み直す実装で、
// global の Request を差し替えない開発サーバーでは @hono/node-server の軽量な Request を受け付けられず 500 になるため
export const limitBody = (maxSize: number, message = `送信できるデータの大きさは ${formatBytes(maxSize)} までです。`) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const raw = c.req.raw
    if (!raw.body) return next()
    // 413 を返さないのは、client.ts が HTML でない応答を受けると送信先の URL を GET で開き直してしまうため
    const tooLarge = () => redirectWith(c, sameOriginReferer(c, '/'), message, 'error')
    const length = raw.headers.get('content-length')
    if (length !== null && !raw.headers.has('transfer-encoding')) return Number(length) > maxSize ? tooLarge() : next()

    const reader = raw.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxSize) return tooLarge()
      chunks.push(value)
    }
    c.req.raw = new Request(c.req.url, { method: raw.method, headers: raw.headers, body: new Blob(chunks) })
    await next()
  })

export type Theme = 'light' | 'dark'

const THEME_COOKIE = 'theme'

// OS の設定に合わせないのは、利用者が自分で選んだときだけダークにするため
export const getTheme = (c: Context): Theme => (getCookie(c, THEME_COOKIE) === 'dark' ? 'dark' : 'light')

export type Form = Record<string, string | File | (string | File)[]>

export async function readForm(c: Context): Promise<Form> {
  return (await c.req.parseBody()) as Form
}

export function field(form: Form, key: string, max = 10_000) {
  const v = form[key]
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function fileField(form: Form, key: string) {
  const v = form[key]
  return v instanceof File && v.size > 0 ? v : null
}

export function intParam(c: Context, key: string) {
  const n = Number(c.req.param(key))
  return Number.isSafeInteger(n) && n > 0 ? n : null
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
