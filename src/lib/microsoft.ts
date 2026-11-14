import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { z } from 'zod'
import { isHttps } from './auth'
import { config } from './config'
import { db } from './db'
import { userIdentities } from './schema'

const COOKIE_PATH = '/auth/microsoft'
const FLOW_COOKIE = 'ms_flow'
const FLOW_TTL = 10 * 60
const SIGNUP_COOKIE = 'ms_signup'
const SIGNUP_TTL = 30 * 60

// 個人の Microsoft アカウント（outlook.com など）がまとめて属するテナント
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

const enc = new TextEncoder()
const now = () => Math.floor(Date.now() / 1000)
const base64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url')
const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

const authority = () => `https://login.microsoftonline.com/${config.microsoft!.tenant}/oauth2/v2.0`
// 要求の URL を優先しないのは、リバースプロキシの後ろでは http:// や内部のホスト名になり、Microsoft に登録した戻り先と一致しないため
const redirectUri = (c: Context) => `${config.appOrigin ?? new URL(c.req.url).origin}${COOKIE_PATH}/callback`

const cookieOptions = (c: Context, maxAge: number) => ({
  httpOnly: true,
  secure: isHttps(c),
  sameSite: 'Lax' as const,
  path: COOKIE_PATH,
  maxAge,
})

async function writeCookie(c: Context, name: string, value: object, maxAge: number) {
  await setSignedCookie(c, name, JSON.stringify({ ...value, exp: now() + maxAge }), config.sessionSecret, cookieOptions(c, maxAge))
}

async function readCookie<T extends z.ZodType>(c: Context, name: string, schema: T): Promise<z.output<T> | null> {
  const raw = await getSignedCookie(c, config.sessionSecret, name)
  if (typeof raw !== 'string') return null
  try {
    const value = z.object({ exp: z.number() }).and(schema).parse(JSON.parse(raw))
    return value.exp > now() ? value : null
  } catch {
    return null
  }
}

const FLOW = z.object({ state: z.string(), nonce: z.string(), verifier: z.string(), next: z.string(), linkUserId: z.number().nullable() })

export type MicrosoftFlow = z.output<typeof FLOW>

/** Microsoft のサインイン画面の URL を返し、戻ってきたときに照らし合わせる値を Cookie に残す。linkUserId は、ログイン中のユーザーに結び付けるとき */
export async function startMicrosoftAuth(c: Context, { next, linkUserId = null }: { next: string; linkUserId?: number | null }) {
  const flow: MicrosoftFlow = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), next, linkUserId }
  await writeCookie(c, FLOW_COOKIE, flow, FLOW_TTL)
  const url = new URL(`${authority()}/authorize`)
  url.search = new URLSearchParams({
    client_id: config.microsoft!.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(c),
    response_mode: 'query',
    scope: 'openid profile email',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: base64url(await crypto.subtle.digest('SHA-256', enc.encode(flow.verifier))),
    code_challenge_method: 'S256',
    // 前回のアカウントで黙って進ませないのは、教室の共用の端末では、前の人の Microsoft アカウントでログインしてしまうため
    prompt: 'select_account',
  }).toString()
  return url.href
}

/** 戻ってきた要求の state が、この端末で始めたものと一致すればその内容を返す。Cookie は一度きりで消す */
export async function takeMicrosoftFlow(c: Context) {
  const flow = await readCookie(c, FLOW_COOKIE, FLOW)
  deleteCookie(c, FLOW_COOKIE, { path: COOKIE_PATH })
  return flow && flow.state === c.req.query('state') ? flow : null
}

const truthy = z.union([z.boolean(), z.string(), z.number()]).transform((v) => v === true || v === 'true' || v === '1' || v === 1)

const CLAIMS = z.object({
  aud: z.string(),
  iss: z.string(),
  exp: z.number(),
  nonce: z.string(),
  tid: z.string(),
  oid: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  preferred_username: z.string().optional(),
  xms_edov: truthy.optional(),
})

export type MicrosoftIdentity = {
  subject: string
  /** 画面に出すための Microsoft アカウントのメールアドレス（なければユーザー名） */
  email: string
  /** Microsoft がドメインの持ち主を確かめたメールアドレス。既存のアカウントとの照合と、新規登録にはこれだけを使う */
  verifiedEmail: string | null
  name: string
}

const isEmail = (s: string | undefined): s is string => !!s && s.length <= 254 && z.email().safeParse(s).success

/** 認可コードを ID トークンに交換し、Microsoft アカウントを返す。確かめられなければ例外を投げる */
export async function exchangeMicrosoftCode(c: Context, flow: MicrosoftFlow, code: string): Promise<MicrosoftIdentity> {
  const ms = config.microsoft!
  const res = await fetch(`${authority()}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: ms.clientId,
      client_secret: ms.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(c),
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error_description?: unknown } | null
  if (!res.ok || typeof body?.id_token !== 'string')
    throw new Error(`ID トークンを受け取れませんでした（${res.status} ${JSON.stringify(body?.error_description ?? null)}）`)

  // 署名を確かめないのは、TLS で Microsoft のトークンエンドポイントからクライアントシークレット付きで直接受け取っていて、
  // 改ざんされる経路がないため（OpenID Connect Core 3.1.3.7）。公開鍵の取得と鍵の切り替えへの追従を持たずに済む
  const payload = body.id_token.split('.')[1] ?? ''
  const claims = CLAIMS.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  if (claims.aud !== ms.clientId) throw new Error('ID トークンの宛先が違います')
  if (claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) throw new Error('ID トークンの発行元が違います')
  if (claims.exp <= now()) throw new Error('ID トークンの期限が切れています')
  if (claims.nonce !== flow.nonce) throw new Error('ID トークンの nonce が一致しません')

  const email = claims.email?.trim()
  // 組織のアカウントで xms_edov を確かめるのは、組織の管理者がメールアドレスを自由に設定でき、ほかの人のアドレスを名乗れるため
  const verified = isEmail(email) && (claims.tid === CONSUMER_TENANT || claims.xms_edov === true)
  return {
    subject: `${claims.tid}:${claims.oid}`,
    email: (email || claims.preferred_username || '').slice(0, 254),
    verifiedEmail: verified ? email : null,
    name: (claims.name ?? '').trim().slice(0, 60),
  }
}

const SIGNUP = z.object({ subject: z.string(), email: z.string(), name: z.string(), next: z.string() })

export type MicrosoftSignup = z.output<typeof SIGNUP>

/** 登録を終えるまで、確かめた Microsoft アカウントを Cookie に持っておく。DB に置かないのは、登録をやめた人の分が残り続けるため */
export const holdMicrosoftSignup = (c: Context, signup: MicrosoftSignup) => writeCookie(c, SIGNUP_COOKIE, signup, SIGNUP_TTL)

export const readMicrosoftSignup = (c: Context) => readCookie(c, SIGNUP_COOKIE, SIGNUP)

export const clearMicrosoftSignup = (c: Context) => deleteCookie(c, SIGNUP_COOKIE, { path: COOKIE_PATH })

const ofProvider = eq(userIdentities.provider, 'microsoft')

export const findMicrosoftUser = (subject: string) =>
  db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(ofProvider, eq(userIdentities.subject, subject)))
    .get()?.userId ?? null

export const microsoftAccountOf = (userId: number) =>
  db
    .select({ email: userIdentities.email })
    .from(userIdentities)
    .where(and(ofProvider, eq(userIdentities.userId, userId)))
    .get() ?? null

/** 結び付けられたら true。この Microsoft アカウントか、ユーザーのほうが、すでにほかと結び付いていれば false */
export const linkMicrosoft = (userId: number, identity: MicrosoftIdentity) =>
  db
    .insert(userIdentities)
    .values({ provider: 'microsoft', subject: identity.subject, userId, email: identity.email })
    .onConflictDoNothing()
    .run().changes > 0

export const unlinkMicrosoft = (userId: number) =>
  db
    .delete(userIdentities)
    .where(and(ofProvider, eq(userIdentities.userId, userId)))
    .run()
