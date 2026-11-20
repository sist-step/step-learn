import crypto from 'node:crypto'
import type { Context } from 'hono'
import * as z from 'zod/mini'
import { config } from './config'
import { bearerToken, clientIp, readJson } from './http'
import { rateLimiter } from './rate-limit'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名とこの鍵を使い回さないため
const key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, '', 'step-learn vscode bundle', 32))

/** VS Code で開くリンクに付ける鍵の有効期間。押してから VS Code が開くまでの間だけ使えればよい */
const LAUNCH_TTL = 5 * 60
/** 学期のあいだ、STEP Learn の画面から開き直さなくても使い続けられる長さ */
const TERM_TTL = 180 * 24 * 60 * 60

/** ref はモードごとのアイテムの識別子（backend の itemOf / targetOf に渡す） */
type Base = { ref: string; userId: number; exp: number }
/** 拡張機能のリンクの鍵。nonce で 1 回だけ引き換えられるようにする */
type Launch = Base & { nonce: string }

/**
 * 鍵の種類ごとの中身。種類を分けるのは、別の機能の鍵と取り違えて引き換えられないようにするため。
 * stamp は backend の stampOf が返す、発行したときの利用者の印。半年使える鍵を、パスワードを変えたときに取り消すのに使う。
 * DB に鍵を保存して取り消せるようにしないのは、保存しなくても、印が変われば発行済みの鍵をまとめて使えなくできるため
 */
type ClaimsByKind = {
  /** ファイル自動配布とコーディングエージェントのリンク。course と title は、展開先のフォルダー名に使う */
  launch: Launch & { course: string; title: string }
  /** 鍵と引き換えに渡す、ファイルを受け取るための鍵 */
  grant: Base
  /** 変更履歴を送るための鍵 */
  sync: Base & { stamp?: string }
  /** コードのアイテムを VS Code で開くリンク */
  'code-launch': Launch
  /** 拡張機能が書きかけのコードを送る・提出するための鍵 */
  code: Base & { stamp?: string }
  /** 発表ファイルの「PowerPoint と同期」のリンク */
  'presentation-launch': Launch
  /** 拡張機能が PDF を上げ、映しているスライドを送るための鍵 */
  presentation: Base
}

type TokenKind = keyof ClaimsByKind
type LaunchKind = 'launch' | 'code-launch' | 'presentation-launch'
type Claims<K extends TokenKind> = ClaimsByKind[K] & { kind: K }
type Fields<K extends TokenKind> = Omit<ClaimsByKind[K], 'exp' | 'nonce'>

const TTL: Record<TokenKind, number> = {
  launch: LAUNCH_TTL,
  grant: 15 * 60,
  sync: TERM_TTL,
  'code-launch': LAUNCH_TTL,
  // 変更履歴の鍵と同じ長さにするのは、学期のあいだ STEP Learn の画面から開き直さなくても、保存と提出を続けられるようにするため
  code: TERM_TTL,
  'presentation-launch': LAUNCH_TTL,
  // 学期のあいだ使えるようにしないのは、学生に見せる範囲を変えられる鍵で、授業のたびに画面から始め直してもらえば足りるため。朝に始めた同期が、その日の授業のあいだ続く長さにする
  presentation: 12 * 60 * 60,
}

const LAUNCH_KINDS: readonly TokenKind[] = ['launch', 'code-launch', 'presentation-launch'] satisfies LaunchKind[]

const mac = (body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url')

/** 鍵に入れる利用者の印。パスワードのハッシュをそのまま入れないのは、鍵の中身は拡張機能から読めるため */
export const credentialStamp = (passwordHash: string) => mac(`stamp\0${passwordHash}`).slice(0, 16)

const nowSec = () => Math.floor(Date.now() / 1000)

// DB に保存しないのは、署名を確かめれば作った人とアイテムが分かるため。開くための鍵は数分で切れ、
// 長く使える同期の鍵でできるのは本人の変更履歴を足すことだけで、使うたびにアイテムと利用者が残っているかを確かめる
export function signToken<K extends TokenKind>(kind: K, fields: Fields<K>): string {
  const nonce = LAUNCH_KINDS.includes(kind) ? { nonce: crypto.randomBytes(12).toString('base64url') } : {}
  const body = Buffer.from(JSON.stringify({ kind, ...fields, ...nonce, exp: nowSec() + TTL[kind] })).toString('base64url')
  return `${body}.${mac(body)}`
}

/** 種類が kind の、期限内で改ざんされていない鍵の中身。そうでなければ null */
function verifyToken<K extends TokenKind>(kind: K, token: string): Claims<K> | null {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(mac(body))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims<K>
    return claims.kind === kind && typeof claims.exp === 'number' && claims.exp > nowSec() ? claims : null
  } catch {
    return null
  }
}

// メモリに持つのは、使い終わった鍵を覚えておくのが有効期間の数分だけでよく、再起動で忘れても期限切れで使えなくなるため
const usedNonces = new Map<string, number>()

/** nonce をまだ使っていなければ、使ったことにして true を返す */
function useNonce(nonce: string, exp: number) {
  const now = nowSec()
  for (const [used, until] of usedNonces) if (until <= now) usedNonces.delete(used)
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, exp)
  return true
}

const LAUNCH_CLAIM = z.object({ token: z.string() })

/** VS Code の拡張機能が送ってきたリンクの鍵を、1 回だけ使えるように確かめる。使い済み・期限切れ・改ざんされた鍵なら null */
async function claimLaunch<K extends LaunchKind>(c: Context, kind: K): Promise<Claims<K> | null> {
  const claims = verifyToken(kind, (await readJson(c, LAUNCH_CLAIM))?.token ?? '')
  return claims && useNonce(claims.nonce, claims.exp) ? claims : null
}

/** Authorization ヘッダーの、種類が kind の鍵の中身 */
export const verifyBearer = <K extends TokenKind>(c: Context, kind: K) => verifyToken(kind, bearerToken(c))

export const tooManyRequests = (c: Context) => c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)

export const linkExpired = (c: Context) =>
  c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)

/** 拡張機能がリンクの鍵を引き換える処理。引き換えられたら鍵の中身、そうでなければ返す応答 */
export function launchClaimer<K extends LaunchKind>(kind: K) {
  // 上限を付けるのは、ログインしていなくても呼べ、鍵を総当たりで試されないようにするため
  const limit = rateLimiter({ limit: 30, windowSec: 60 })
  return async (c: Context): Promise<Claims<K> | Response> => {
    const ip = clientIp(c)
    if (limit.retryAfter(ip)) return tooManyRequests(c)
    limit.hit(ip)
    return (await claimLaunch(c, kind)) ?? linkExpired(c)
  }
}
