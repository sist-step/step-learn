// DB を読み込まず、渡された DB とテーブルで動かすのは、通常モード（step-learn.db）と Moodle モード（moodle-mode.db）の両方で同じ OAuth を使うため
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, lt, lte, notExists } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as z from 'zod/mini'
import type { oauthClients as clientsTable, oauthCodes as codesTable, oauthGrants as grantsTable } from '../../lib/schema'

const CODE_TTL = 10 * 60
const ACCESS_TTL = 60 * 60
const REFRESH_TTL = 60 * 60 * 24 * 30 // 30日
// 毎回書かないのは、ツールを呼ぶたびに DB に書き込まないため。一覧で「最後に使った日時」を見るには十分細かい
const TOUCH_INTERVAL = 60
// 登録しただけで使われていないクライアントを残す期間。動的登録は誰でもできるので、溜まり続けないようにする
const UNUSED_CLIENT_TTL = 60 * 60 * 24 * 30

const MAX_REDIRECT_URIS = 10
const MAX_CLIENT_NAME = 100

const now = () => Math.floor(Date.now() / 1000)
const randomToken = () => randomBytes(32).toString('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** OAuth のエラー応答（RFC 6749 の 5.2） */
export type OAuthFailure = {
  error: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'invalid_redirect_uri' | 'invalid_client_metadata'
  description: string
}

export type OAuthTokens = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string }

export const isFailure = (v: object): v is OAuthFailure => 'error' in v

const fail = (error: OAuthFailure['error'], description: string): OAuthFailure => ({ error, description })

const ALLOWED_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
])

// 接続ごとに変わる ChatGPT の戻り先（iss を返さないサーバー向け）。chatgpt.com の下のパスなので、前方一致で受け付けてよい
const CHATGPT_CONNECTOR_REDIRECT = 'https://chatgpt.com/connector/oauth/'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)

/**
 * つなげてよい戻り先か。誰でも登録できるようにしないのは、攻撃者が「Claude」を名乗るクライアントを自分のサーバーへの戻り先で登録し、
 * 同意の画面へのリンクを教師に踏ませると、本人のトークンを取られるため
 */
export function isAllowedRedirectUri(uri: string) {
  const url = URL.parse(uri)
  if (!url || url.username || url.password || url.hash) return false
  if (isLoopback(url)) return true
  const base = `${url.origin}${url.pathname}`
  return url.protocol === 'https:' && (ALLOWED_REDIRECTS.has(base) || (base.startsWith(CHATGPT_CONNECTOR_REDIRECT) && !url.search))
}

/**
 * 要求の戻り先が、クライアントの登録した戻り先のどれかと同じか。手元のアプリ（http://localhost など）はポートを比べない。
 * ポートまで比べないのは、手元のアプリは空いているポートで待ち受け、Claude Code の CIMD はポートのない戻り先を載せているため（RFC 8252 の 7.3）
 */
export function matchesRedirectUri(registered: readonly string[], requested: string) {
  const url = URL.parse(requested)
  if (!url || !isAllowedRedirectUri(requested)) return false
  return registered.some((uri) => {
    if (uri === requested) return true
    const r = URL.parse(uri)
    return !!r && isLoopback(url) && isLoopback(r) && r.hostname === url.hostname && r.pathname === url.pathname && r.search === url.search
  })
}

/** 戻り先から分かる、つなぐアプリ。名前はクライアントが自由に名乗れるので、確かめられる戻り先のホストで見分ける */
export function clientKind(redirectUri: string): 'claude' | 'chatgpt' | 'local' {
  const url = new URL(redirectUri)
  if (isLoopback(url)) return 'local'
  return url.hostname === 'chatgpt.com' ? 'chatgpt' : 'claude'
}

/**
 * クライアント ID として受け付ける CIMD（Client ID Metadata Document）の URL。
 * どの URL でも取りに行かないのは、取りに行く先を利用者が決められると、サーバーから内部のネットワークへ要求させられる（SSRF）ため
 */
const METADATA_DOCUMENTS = new Set([
  'https://claude.ai/oauth/mcp-oauth-client-metadata',
  'https://claude.ai/oauth/claude-code-client-metadata',
  'https://chatgpt.com/oauth/client.json',
  'https://vscode.dev/oauth/client-metadata.json',
])

const METADATA_TIMEOUT = 5_000
const METADATA_CACHE_TTL = 60 * 60 * 1000

const metadataSchema = z.object({
  client_id: z.string(),
  client_name: z.optional(z.string()),
  redirect_uris: z.array(z.string()).check(z.minLength(1), z.maxLength(20)),
})

const metadataCache = new Map<string, { at: number; doc: { name: string; redirectUris: string[] } }>()

/** CIMD を取りに行き、クライアントの名前と戻り先を返す。許可した URL でないか、取れなければ null */
async function fetchClientMetadata(clientId: string) {
  if (!METADATA_DOCUMENTS.has(clientId)) return null
  const cached = metadataCache.get(clientId)
  if (cached && Date.now() - cached.at < METADATA_CACHE_TTL) return cached.doc
  try {
    const res = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(METADATA_TIMEOUT),
    })
    const parsed = metadataSchema.safeParse(res.ok ? await res.json() : null)
    // client_id が取りに行った URL と違えば使わないのは、ほかのクライアントの文書を写して名乗れないようにするため（仕様の MUST）
    if (!parsed.success || parsed.data.client_id !== clientId) return null
    const doc = { name: (parsed.data.client_name ?? '').slice(0, MAX_CLIENT_NAME), redirectUris: parsed.data.redirect_uris }
    metadataCache.set(clientId, { at: Date.now(), doc })
    return doc
  } catch (e) {
    console.error('[oauth]', clientId, e)
    return null
  }
}

/** 動的登録（RFC 7591）の本文。ほかの項目は使わないので読まない */
export const registrationSchema = z.object({
  redirect_uris: z.array(z.string().check(z.maxLength(2000))).check(z.minLength(1), z.maxLength(MAX_REDIRECT_URIS)),
  client_name: z.optional(z.string()),
  grant_types: z.optional(z.array(z.string())),
  response_types: z.optional(z.array(z.string())),
})

export type Registration = z.output<typeof registrationSchema>

/** PKCE の code_verifier（RFC 7636 の 4.1） */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/

/** S256 のチャレンジ（SHA-256 の base64url、43 文字） */
export const isCodeChallenge = (v: string) => /^[A-Za-z0-9\-_]{43}$/.test(v)

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export type OAuthStore = ReturnType<typeof createOAuthStore>

/** MCP の OAuth のクライアント・認可コード・接続を、db の 3 つのテーブルで扱う。Moodle モードのテーブルも同じ形にする（moodle-mode/schema.ts） */
export function createOAuthStore<S extends Record<string, unknown>>({
  db,
  oauthClients,
  oauthCodes,
  oauthGrants,
}: {
  db: BetterSQLite3Database<S>
  oauthClients: typeof clientsTable
  oauthCodes: typeof codesTable
  oauthGrants: typeof grantsTable
}) {
  function newTokens(): { tokens: OAuthTokens; accessHash: string; refreshHash: string } {
    const access = randomToken()
    const refresh = randomToken()
    return {
      tokens: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh },
      accessHash: sha256(access),
      refreshHash: sha256(refresh),
    }
  }

  return {
    /** 登録できたらクライアントの情報（RFC 7591 の応答）を返す */
    register(reg: Registration) {
      if (!reg.redirect_uris.every(isAllowedRedirectUri))
        return fail('invalid_redirect_uri', 'この戻り先のクライアントは登録できません。Claude・ChatGPT・手元のアプリから接続してください。')
      if (reg.grant_types && !reg.grant_types.includes('authorization_code'))
        return fail('invalid_client_metadata', 'grant_types には authorization_code を含めてください。')
      const name = (reg.client_name ?? '').trim().slice(0, MAX_CLIENT_NAME)
      const id = randomToken()
      const t = now()
      db.transaction((tx) => {
        tx.delete(oauthClients)
          .where(
            and(
              lt(oauthClients.createdAt, t - UNUSED_CLIENT_TTL),
              notExists(tx.select({ id: oauthGrants.id }).from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id))),
            ),
          )
          .run()
        tx.insert(oauthClients).values({ id, name, redirectUris: reg.redirect_uris, createdAt: t }).run()
      })
      return {
        client_id: id,
        client_id_issued_at: t,
        client_name: name || undefined,
        redirect_uris: reg.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        // 秘密鍵を発行しないのは、PKCE で守れるうえ、Claude などのサーバーの外で動く手元のアプリには秘密を置けないため。求められても none で返す
        token_endpoint_auth_method: 'none',
      }
    },

    /**
     * クライアント ID のクライアント。CIMD の URL なら文書を取りに行き、接続が参照できるように行を作るか更新する。
     * 登録されていないか、文書が取れなければ null
     */
    async findClient(id: string) {
      const doc = await fetchClientMetadata(id)
      if (doc) {
        db.insert(oauthClients)
          .values({ id, ...doc })
          .onConflictDoUpdate({ target: oauthClients.id, set: doc })
          .run()
        return { id, ...doc }
      }
      return db
        .select({ id: oauthClients.id, name: oauthClients.name, redirectUris: oauthClients.redirectUris })
        .from(oauthClients)
        .where(eq(oauthClients.id, id))
        .get()
    },

    /** 同意したときに、トークンと交換する認可コードを発行する */
    issueCode(grant: { clientId: string; userId: number; redirectUri: string; codeChallenge: string; resource: string }) {
      const code = randomToken()
      db.transaction((tx) => {
        tx.delete(oauthCodes).where(lte(oauthCodes.expiresAt, now())).run()
        tx.insert(oauthCodes)
          .values({ id: sha256(code), ...grant, expiresAt: now() + CODE_TTL })
          .run()
      })
      return code
    },

    /** 認可コードを、新しい接続のトークンと交換する。コードは 1 回だけ使える */
    exchangeCode({
      code,
      clientId,
      redirectUri,
      verifier,
      resource,
    }: {
      code: string
      clientId: string
      redirectUri: string
      verifier: string
      resource: string
    }) {
      return db.transaction((tx): OAuthTokens | OAuthFailure => {
        // 先に消すのは、失敗した交換でもコードを使い切り、PKCE の検証を何度も試せないようにするため
        const row = tx
          .delete(oauthCodes)
          .where(eq(oauthCodes.id, sha256(code)))
          .returning()
          .get()
        if (!row || row.expiresAt <= now()) return fail('invalid_grant', '認可コードが無効か、期限が切れています。')
        if (row.clientId !== clientId || row.redirectUri !== redirectUri || row.resource !== resource)
          return fail('invalid_grant', '認可コードを発行したときと、クライアント・戻り先・resource が違います。')
        if (!VERIFIER.test(verifier) || challengeOf(verifier) !== row.codeChallenge)
          return fail('invalid_grant', 'code_verifier が正しくありません。')
        const { tokens, accessHash, refreshHash } = newTokens()
        const t = now()
        tx.insert(oauthGrants)
          .values({
            clientId,
            userId: row.userId,
            resource,
            accessHash,
            accessExpiresAt: t + ACCESS_TTL,
            refreshHash,
            refreshExpiresAt: t + REFRESH_TTL,
            createdAt: t,
            lastUsedAt: t,
          })
          .run()
        return tokens
      })
    },

    /** リフレッシュトークンで、接続のトークンを入れ替える */
    refresh({ refreshToken, clientId, resource }: { refreshToken: string; clientId: string; resource: string }) {
      const hash = sha256(refreshToken)
      return db.transaction((tx): OAuthTokens | OAuthFailure => {
        const grant = tx.select().from(oauthGrants).where(eq(oauthGrants.refreshHash, hash)).get()
        if (!grant) {
          // 入れ替えたあとの古いトークンが使われたら、漏れて第三者が使っているかもしれないので、接続ごと消す
          tx.delete(oauthGrants).where(eq(oauthGrants.previousRefreshHash, hash)).run()
          return fail('invalid_grant', 'リフレッシュトークンが無効です。接続し直してください。')
        }
        if (grant.clientId !== clientId || grant.resource !== resource)
          return fail('invalid_grant', 'リフレッシュトークンを発行したときと、クライアントか resource が違います。')
        const t = now()
        if (grant.refreshExpiresAt <= t) {
          tx.delete(oauthGrants).where(eq(oauthGrants.id, grant.id)).run()
          return fail('invalid_grant', 'リフレッシュトークンの期限が切れています。接続し直してください。')
        }
        const { tokens, accessHash, refreshHash } = newTokens()
        tx.update(oauthGrants)
          .set({
            accessHash,
            accessExpiresAt: t + ACCESS_TTL,
            refreshHash,
            previousRefreshHash: hash,
            refreshExpiresAt: t + REFRESH_TTL,
            lastUsedAt: t,
          })
          .where(eq(oauthGrants.id, grant.id))
          .run()
        return tokens
      })
    },

    /** アクセストークンの持ち主。無効か期限切れなら null */
    authenticate(accessToken: string, resource: string) {
      const t = now()
      const grant = db
        .select({ id: oauthGrants.id, userId: oauthGrants.userId, resource: oauthGrants.resource, lastUsedAt: oauthGrants.lastUsedAt })
        .from(oauthGrants)
        .where(and(eq(oauthGrants.accessHash, sha256(accessToken)), gt(oauthGrants.accessExpiresAt, t)))
        .get()
      if (!grant || grant.resource !== resource) return null
      if (t - grant.lastUsedAt >= TOUCH_INTERVAL) db.update(oauthGrants).set({ lastUsedAt: t }).where(eq(oauthGrants.id, grant.id)).run()
      return { grantId: grant.id, userId: grant.userId }
    },

    /** 利用者が許可している接続。新しい順 */
    grantsOf: (userId: number) =>
      db
        .select({
          id: oauthGrants.id,
          name: oauthClients.name,
          redirectUris: oauthClients.redirectUris,
          createdAt: oauthGrants.createdAt,
          lastUsedAt: oauthGrants.lastUsedAt,
        })
        .from(oauthGrants)
        .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
        .where(eq(oauthGrants.userId, userId))
        .orderBy(desc(oauthGrants.createdAt))
        .limit(100)
        .all(),

    /** 接続を解除する。利用者のものでなければ false */
    revoke: (userId: number, grantId: number) =>
      db
        .delete(oauthGrants)
        .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
        .run().changes > 0,
  }
}
