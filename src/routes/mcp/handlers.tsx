import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import * as z from 'zod/mini'
import { DOCS_ABILITIES } from '../../lib/ai-docs'
import { config } from '../../lib/config'
import { clientIp, intParam, readForm, redirectWith } from '../../lib/http'
import { serveMcp, type McpTool } from '../../lib/mcp'
import {
  clientKind,
  isCodeChallenge,
  isFailure,
  matchesRedirectUri,
  registrationSchema,
  type OAuthFailure,
  type OAuthStore,
} from '../../lib/oauth'
import { rateLimiter } from '../../lib/rate-limit'
import type { AppEnv } from '../../lib/types'
import { AppsPage, AuthorizeErrorPage, ConsentPage, type AuthorizeFields, type ClientView } from './views'

type C = Context<AppEnv>

/** トークンの持ち主として要求を扱えるか。expired は、Moodle のトークンが切れていて、ログインし直してもらう必要がある */
export type McpSignIn = 'ok' | 'expired' | 'forbidden'

/** MCP の OAuth と /mcp を、モードごとの DB と権限の確認で動かす（通常モードは backend.ts、Moodle モードは moodle-mode/mcp.ts） */
export type McpBackend = {
  store: OAuthStore
  /** ログインしている利用者が MCP を使える教師か */
  canUse: (c: C) => Promise<boolean>
  /** userId の利用者を c に入れ（c.var.user。Moodle モードでは c.var.token も）、MCP を使える教師なら ok */
  signIn: (c: C, userId: number) => Promise<McpSignIn>
  tools: McpTool[]
}

const MCP_PATH = '/mcp'

const INSTRUCTIONS = ['STEP Learn（STEP の学習管理システム）の MCP サーバーです。利用者は STEP の教師です。', ...DOCS_ABILITIES].join('\n')

const NOT_TEACHER = `MCP を使えるのは、${config.aiEmailDomain} のメールアドレスで登録した教師のアカウントだけです。`

// 登録とトークンの交換はログインしていなくても呼べるので、IP ごとに数を限る
const registerLimiter = rateLimiter({ limit: 20, windowSec: 60 * 60 })
const tokenLimiter = rateLimiter({ limit: 60, windowSec: 60 })

/** 外から見える、このサーバーのオリジン。OAuth の issuer と MCP の resource に使う */
function publicOrigin(c: C) {
  if (config.appOrigin) return config.appOrigin.replace(/\/$/, '')
  const url = new URL(c.req.url)
  return c.req.header('x-forwarded-proto') === 'https' ? `https://${url.host}` : url.origin
}

const resourceOf = (c: C) => `${publicOrigin(c)}${MCP_PATH}`

/** 要求の resource（RFC 8707）が、このサーバーの /mcp か。送られなければ /mcp とみなす */
function requestedResource(c: C, value: string | undefined) {
  const resource = resourceOf(c)
  if (value === undefined || value === '') return resource
  return value.replace(/\/$/, '') === resource ? resource : null
}

const protectedResourceMetadataUrl = (c: C) => `${publicOrigin(c)}/.well-known/oauth-protected-resource${MCP_PATH}`

function protectedResourceMetadata(c: C) {
  return c.json({
    resource: resourceOf(c),
    authorization_servers: [publicOrigin(c)],
    bearer_methods_supported: ['header'],
    resource_name: 'STEP Learn',
  })
}

// scopes_supported を出さないのは、スコープで分けるほどの権限がなく、offline_access などを出すと Claude や ChatGPT がそれを求めてくるため
function authorizationServerMetadata(c: C) {
  const origin = publicOrigin(c)
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  })
}

const oauthError = (c: C, failure: OAuthFailure, status: 400 | 401 | 429 = 400) =>
  c.json({ error: failure.error, error_description: failure.description }, status, { 'Cache-Control': 'no-store' })

function limited(c: C, limiter: ReturnType<typeof rateLimiter>) {
  const key = clientIp(c)
  if (limiter.retryAfter(key)) return true
  limiter.hit(key)
  return false
}

const toClientView = (client: { name: string }, redirectUri: string): ClientView => {
  const kind = clientKind(redirectUri)
  return { kind, name: client.name, host: kind === 'local' ? null : new URL(redirectUri).host }
}

const authorizeSchema = z.object({
  client_id: z.string().check(z.minLength(1), z.maxLength(2000)),
  redirect_uri: z.string().check(z.minLength(1), z.maxLength(2000)),
  response_type: z.optional(z.string()),
  code_challenge: z.optional(z.string()),
  code_challenge_method: z.optional(z.string()),
  state: z.optional(z.string().check(z.maxLength(2000))),
  resource: z.optional(z.string().check(z.maxLength(2000))),
})

type Authorize =
  | { ok: true; fields: AuthorizeFields; client: ClientView; resource: string; codeChallenge: string }
  | { ok: false; page: { heading: string; text: string } }
  | { ok: false; redirect: string }

/** 戻り先に、認可の結果（code か error）を載せる。iss を付けるのは、ChatGPT などが別の認可サーバーの応答と取り違えないようにするため（RFC 9207） */
function redirectBack(c: C, redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries({ ...params, iss: publicOrigin(c) })) if (value !== undefined) url.searchParams.set(key, value)
  return url.toString()
}

async function checkAuthorize(c: C, store: OAuthStore, raw: Record<string, unknown>): Promise<Authorize> {
  const parsed = authorizeSchema.safeParse(raw)
  const client = parsed.success ? await store.findClient(parsed.data.client_id) : undefined
  // 戻り先へ返さず画面に出すのは、確かめられない戻り先へ移ると、攻撃者のサイトへのリダイレクトに使われるため
  if (!parsed.success || !client)
    return {
      ok: false,
      page: {
        heading: 'このアプリは接続できません',
        text: 'アプリが登録されていないか、要求が正しくありません。AI アプリから接続し直してください。',
      },
    }
  const p = parsed.data
  if (!matchesRedirectUri(client.redirectUris, p.redirect_uri))
    return {
      ok: false,
      page: { heading: 'このアプリは接続できません', text: '戻り先が登録されたものと違います。AI アプリから接続し直してください。' },
    }
  const back = (error: string, description: string) => ({
    ok: false as const,
    redirect: redirectBack(c, p.redirect_uri, { error, error_description: description, state: p.state }),
  })
  if (p.response_type !== 'code') return back('unsupported_response_type', 'response_type は code にしてください。')
  if (p.code_challenge_method !== 'S256' || !p.code_challenge || !isCodeChallenge(p.code_challenge))
    return back('invalid_request', 'PKCE の S256 の code_challenge を付けてください。')
  const resource = requestedResource(c, p.resource)
  if (!resource) return back('invalid_target', `resource は ${resourceOf(c)} にしてください。`)
  return {
    ok: true,
    fields: {
      client_id: p.client_id,
      redirect_uri: p.redirect_uri,
      response_type: p.response_type,
      code_challenge: p.code_challenge,
      code_challenge_method: p.code_challenge_method,
      state: p.state,
      resource: p.resource,
    },
    client: toClientView(client, p.redirect_uri),
    resource,
    codeChallenge: p.code_challenge,
  }
}

function loginRedirect(c: C) {
  const url = new URL(c.req.url)
  return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
}

const bearerToken = (c: C) => c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null

/** 認証が要ることを伝える 401。resource_metadata から、クライアントが認可サーバーを見つける（RFC 9728） */
function unauthorized(c: C, error?: 'invalid_token') {
  const params = [error && `error="${error}"`, `resource_metadata="${protectedResourceMetadataUrl(c)}"`].filter(Boolean).join(', ')
  return c.json({ error: error ?? 'unauthorized', error_description: '認証が必要です。' }, 401, { 'WWW-Authenticate': `Bearer ${params}` })
}

const tokenSchema = z.object({
  grant_type: z.string(),
  client_id: z.string().check(z.minLength(1), z.maxLength(2000)),
  code: z.optional(z.string().check(z.maxLength(200))),
  redirect_uri: z.optional(z.string().check(z.maxLength(2000))),
  code_verifier: z.optional(z.string().check(z.maxLength(200))),
  refresh_token: z.optional(z.string().check(z.maxLength(200))),
  resource: z.optional(z.string().check(z.maxLength(2000))),
})

export function createMcpHandlers(backend: McpBackend) {
  const { store } = backend

  async function register(c: C) {
    if (limited(c, registerLimiter))
      return oauthError(c, { error: 'invalid_request', description: '登録が多すぎます。時間をおいてください。' }, 429)
    const parsed = registrationSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return oauthError(c, { error: 'invalid_client_metadata', description: 'redirect_uris を正しく指定してください。' })
    const result = store.register(parsed.data)
    if (isFailure(result)) return oauthError(c, result)
    return c.json(result, 201, { 'Cache-Control': 'no-store' })
  }

  async function showAuthorize(c: C) {
    const checked = await checkAuthorize(c, store, c.req.query())
    if (!checked.ok) {
      if ('redirect' in checked) return c.redirect(checked.redirect)
      c.status(400)
      return c.render(<AuthorizeErrorPage {...checked.page} loggedIn={!!c.var.user} />, { title: 'AI アプリとの接続' })
    }
    const user = c.var.user
    if (!user) return loginRedirect(c)
    if (!(await backend.canUse(c))) {
      c.status(403)
      return c.render(<AuthorizeErrorPage heading="接続できません" text={NOT_TEACHER} loggedIn />, { title: 'AI アプリとの接続' })
    }
    return c.render(<ConsentPage client={checked.client} user={user} fields={checked.fields} />, { title: 'AI アプリとの接続' })
  }

  async function submitAuthorize(c: C) {
    const form = await readForm(c)
    const checked = await checkAuthorize(c, store, form)
    if (!checked.ok) {
      if ('redirect' in checked) return c.redirect(checked.redirect, 303)
      c.status(400)
      return c.render(<AuthorizeErrorPage {...checked.page} loggedIn={!!c.var.user} />, { title: 'AI アプリとの接続' })
    }
    const user = c.var.user
    if (!user) return loginRedirect(c)
    const { client_id, redirect_uri, state } = checked.fields
    if (form.decision !== 'allow')
      return c.redirect(
        redirectBack(c, redirect_uri, { error: 'access_denied', error_description: '利用者が許可しませんでした。', state }),
        303,
      )
    if (!(await backend.canUse(c))) {
      c.status(403)
      return c.render(<AuthorizeErrorPage heading="接続できません" text={NOT_TEACHER} loggedIn />, { title: 'AI アプリとの接続' })
    }
    const code = store.issueCode({
      clientId: client_id,
      userId: user.id,
      redirectUri: redirect_uri,
      codeChallenge: checked.codeChallenge,
      resource: checked.resource,
    })
    return c.redirect(redirectBack(c, redirect_uri, { code, state }), 303)
  }

  async function token(c: C) {
    if (limited(c, tokenLimiter))
      return oauthError(c, { error: 'invalid_request', description: '要求が多すぎます。時間をおいてください。' }, 429)
    const parsed = tokenSchema.safeParse(await c.req.parseBody().catch(() => null))
    if (!parsed.success) return oauthError(c, { error: 'invalid_request', description: 'grant_type と client_id を指定してください。' })
    const p = parsed.data
    const resource = requestedResource(c, p.resource)
    if (!resource) return oauthError(c, { error: 'invalid_request', description: `resource は ${resourceOf(c)} にしてください。` })
    let result
    if (p.grant_type === 'authorization_code') {
      if (!p.code || !p.redirect_uri || !p.code_verifier)
        return oauthError(c, { error: 'invalid_request', description: 'code と redirect_uri と code_verifier を指定してください。' })
      result = store.exchangeCode({
        code: p.code,
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        verifier: p.code_verifier,
        resource,
      })
    } else if (p.grant_type === 'refresh_token') {
      if (!p.refresh_token) return oauthError(c, { error: 'invalid_request', description: 'refresh_token を指定してください。' })
      result = store.refresh({ refreshToken: p.refresh_token, clientId: p.client_id, resource })
    } else {
      return c.json({ error: 'unsupported_grant_type', error_description: 'authorization_code か refresh_token にしてください。' }, 400)
    }
    if (isFailure(result)) return oauthError(c, result)
    return c.json(result, 200, { 'Cache-Control': 'no-store' })
  }

  async function mcp(c: C) {
    const token = bearerToken(c)
    const grant = token ? store.authenticate(token, resourceOf(c)) : null
    if (!grant) return unauthorized(c, token ? 'invalid_token' : undefined)
    const signedIn = await backend.signIn(c, grant.userId)
    // 期限切れを 401 にするのは、クライアントに認可をやり直させ、その途中で Moodle にログインし直してもらうため
    if (signedIn === 'expired') return unauthorized(c, 'invalid_token')
    if (signedIn === 'forbidden') return c.json({ error: 'forbidden', error_description: NOT_TEACHER }, 403)
    return serveMcp(c, backend.tools, INSTRUCTIONS)
  }

  async function apps(c: C) {
    const user = c.var.user
    if (!user) return loginRedirect(c)
    if (!(await backend.canUse(c))) return c.notFound()
    const grants = store.grantsOf(user.id).map((g) => ({
      id: g.id,
      client: toClientView(g, g.redirectUris[0]),
      createdAt: g.createdAt,
      lastUsedAt: g.lastUsedAt,
    }))
    return c.render(<AppsPage mcpUrl={resourceOf(c)} grants={grants} />, { title: 'AI アプリとの接続' })
  }

  async function revoke(c: C) {
    const user = c.var.user
    const id = intParam(c, 'gid')
    if (!user || !id || !store.revoke(user.id, id)) return c.notFound()
    return redirectWith(c, '/account/apps', '接続を解除しました。', 'info')
  }

  return {
    protectedResourceMetadata,
    authorizationServerMetadata,
    register,
    showAuthorize,
    submitAuthorize,
    token,
    mcp,
    apps,
    revoke,
  }
}

// ブラウザで動く MCP のクライアント（MCP Inspector など）からも呼べるようにする。Cookie を使わないので、どのオリジンに許しても本人以外には使えない
const publicCors = cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Last-Event-ID'],
  exposeHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version'],
})

/** MCP の OAuth と /mcp。アプリの最上位に載せる */
export function mcpRoutes(h: ReturnType<typeof createMcpHandlers>) {
  const app = new Hono<AppEnv>()
  app.use('/.well-known/*', publicCors)
  app.use('/oauth/token', publicCors)
  app.use('/oauth/register', publicCors)
  app.use(MCP_PATH, publicCors)
  app.get('/.well-known/oauth-protected-resource', h.protectedResourceMetadata)
  app.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, h.protectedResourceMetadata)
  app.get('/.well-known/oauth-authorization-server', h.authorizationServerMetadata)
  app.post('/oauth/register', h.register)
  app.get('/oauth/authorize', h.showAuthorize)
  app.post('/oauth/authorize', h.submitAuthorize)
  app.post('/oauth/token', h.token)
  app.all(MCP_PATH, h.mcp)
  app.get('/account/apps', h.apps)
  app.post('/account/apps/:gid/delete', h.revoke)
  return app
}
