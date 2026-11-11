import crypto from 'node:crypto'
import { config } from './config'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名とこの鍵を使い回さないため
const key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, '', 'step-learn vscode bundle', 32))

/** VS Code で開くリンクに付ける鍵の有効期間。押してから VS Code が開くまでの間だけ使えればよい */
export const LAUNCH_TTL = 5 * 60
/** 鍵と引き換えに渡す、ファイルを受け取るための鍵の有効期間 */
export const GRANT_TTL = 15 * 60

/** ref はモードごとのアイテムの識別子（backend の storeOf に渡す）。course と title は、展開先のフォルダー名に使う */
export type LaunchClaims = { kind: 'launch'; ref: string; userId: number; course: string; title: string; nonce: string; exp: number }
export type GrantClaims = { kind: 'grant'; ref: string; userId: number; exp: number }
type Claims = LaunchClaims | GrantClaims

const mac = (body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url')

const nowSec = () => Math.floor(Date.now() / 1000)

// DB に保存しないのは、数分で切れる鍵で、署名を確かめれば作った人とアイテムが分かるため
function sign(claims: Claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${body}.${mac(body)}`
}

function verify(token: string): Claims | null {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(mac(body))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims
    return typeof claims.exp === 'number' && claims.exp > nowSec() ? claims : null
  } catch {
    return null
  }
}

export const signLaunch = (claims: Omit<LaunchClaims, 'kind' | 'nonce' | 'exp'>) =>
  sign({ kind: 'launch', ...claims, nonce: crypto.randomBytes(12).toString('base64url'), exp: nowSec() + LAUNCH_TTL })

// メモリに持つのは、使い終わった鍵を覚えておくのが有効期間の数分だけでよく、再起動で忘れても期限切れで使えなくなるため
const usedNonces = new Map<string, number>()

/** リンクの鍵を 1 回だけ使えるように確かめる。使い済み・期限切れ・改ざんされた鍵なら null */
export function claimLaunch(token: string): LaunchClaims | null {
  const claims = verify(token)
  if (claims?.kind !== 'launch') return null
  const now = nowSec()
  for (const [nonce, exp] of usedNonces) if (exp <= now) usedNonces.delete(nonce)
  if (usedNonces.has(claims.nonce)) return null
  usedNonces.set(claims.nonce, claims.exp)
  return claims
}

export const signGrant = (claims: Omit<GrantClaims, 'kind' | 'exp'>) => sign({ kind: 'grant', ...claims, exp: nowSec() + GRANT_TTL })

export function verifyGrant(token: string): GrantClaims | null {
  const claims = verify(token)
  return claims?.kind === 'grant' ? claims : null
}
