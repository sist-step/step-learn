import crypto from 'node:crypto'
import * as z from 'zod/mini'
import { config } from './config'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名とこの鍵を使い回さないため
const key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, '', 'step-learn vscode bundle', 32))

/** VS Code で開くリンクに付ける鍵の有効期間。押してから VS Code が開くまでの間だけ使えればよい */
export const LAUNCH_TTL = 5 * 60
/** 鍵と引き換えに渡す、ファイルを受け取るための鍵の有効期間 */
export const GRANT_TTL = 15 * 60
/** 変更履歴を送るための鍵の有効期間。学期のあいだ、STEP Learn の画面から開き直さなくても送り続けられる長さにする */
export const SYNC_TTL = 180 * 24 * 60 * 60

/** ref はモードごとのアイテムの識別子（backend の storeOf に渡す）。course と title は、展開先のフォルダー名に使う */
export type LaunchClaims = { kind: 'launch'; ref: string; userId: number; course: string; title: string; nonce: string; exp: number }
export type GrantClaims = { kind: 'grant'; ref: string; userId: number; exp: number }
export type SyncClaims = { kind: 'sync'; ref: string; userId: number; exp: number }
/** コードのアイテムを VS Code で開くリンクの鍵。ファイル自動配布の鍵と kind を分け、取り違えて引き換えられないようにする */
export type CodeLaunchClaims = { kind: 'code-launch'; ref: string; userId: number; nonce: string; exp: number }
/** 拡張機能が書きかけのコードを送る・提出するための鍵 */
export type CodeClaims = { kind: 'code'; ref: string; userId: number; exp: number }
type Claims = LaunchClaims | GrantClaims | SyncClaims | CodeLaunchClaims | CodeClaims

const mac = (body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url')

const nowSec = () => Math.floor(Date.now() / 1000)

// DB に保存しないのは、署名を確かめれば作った人とアイテムが分かるため。開くための鍵は数分で切れ、
// 長く使える同期の鍵でできるのは本人の変更履歴を足すことだけで、使うたびにアイテムと利用者が残っているかを確かめる
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

/** VS Code の拡張機能が、リンクの鍵を引き換えるときに送る本文 */
export const LAUNCH_CLAIM = z.object({ token: z.string() })

/** リンクの鍵を 1 回だけ使えるように確かめる。使い済み・期限切れ・改ざんされた鍵なら null */
export function claimLaunch(token: string): LaunchClaims | null {
  const claims = verify(token)
  return claims?.kind === 'launch' && useNonce(claims.nonce, claims.exp) ? claims : null
}

/** nonce をまだ使っていなければ、使ったことにして true を返す */
function useNonce(nonce: string, exp: number) {
  const now = nowSec()
  for (const [used, until] of usedNonces) if (until <= now) usedNonces.delete(used)
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, exp)
  return true
}

export const signGrant = (claims: Omit<GrantClaims, 'kind' | 'exp'>) => sign({ kind: 'grant', ...claims, exp: nowSec() + GRANT_TTL })

export function verifyGrant(token: string): GrantClaims | null {
  const claims = verify(token)
  return claims?.kind === 'grant' ? claims : null
}

export const signSync = (claims: Omit<SyncClaims, 'kind' | 'exp'>) => sign({ kind: 'sync', ...claims, exp: nowSec() + SYNC_TTL })

export function verifySync(token: string): SyncClaims | null {
  const claims = verify(token)
  return claims?.kind === 'sync' ? claims : null
}

export const signCodeLaunch = (claims: Omit<CodeLaunchClaims, 'kind' | 'nonce' | 'exp'>) =>
  sign({ kind: 'code-launch', ...claims, nonce: crypto.randomBytes(12).toString('base64url'), exp: nowSec() + LAUNCH_TTL })

/** コードのアイテムのリンクの鍵を 1 回だけ使えるように確かめる */
export function claimCodeLaunch(token: string): CodeLaunchClaims | null {
  const claims = verify(token)
  return claims?.kind === 'code-launch' && useNonce(claims.nonce, claims.exp) ? claims : null
}

// 変更履歴の鍵と同じ長さにするのは、学期のあいだ STEP Learn の画面から開き直さなくても、保存と提出を続けられるようにするため
export const signCode = (claims: Omit<CodeClaims, 'kind' | 'exp'>) => sign({ kind: 'code', ...claims, exp: nowSec() + SYNC_TTL })

export function verifyCode(token: string): CodeClaims | null {
  const claims = verify(token)
  return claims?.kind === 'code' ? claims : null
}
