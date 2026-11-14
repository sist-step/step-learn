// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない
import crypto from 'node:crypto'
import { config } from './config'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名や会話の暗号化とこの鍵を使い回さないため
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'step-learn', 'agent-api-key', 32))
const IV_LENGTH = 12
const TAG_LENGTH = 16

/** aad はキーを入れたアイテムを表す文字列。DB の行を入れ替えられても、ほかのアイテムのキーとして読み出せないようにする */
export function sealApiKey(aad: string, apiKey: string) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

export function openApiKey(aad: string, sealed: Buffer): string | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, sealed.subarray(0, IV_LENGTH))
    decipher.setAAD(Buffer.from(aad))
    decipher.setAuthTag(sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))
    return Buffer.concat([decipher.update(sealed.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8')
  } catch {
    // SESSION_SECRET を変えると読み出せなくなる。そのときは入っていないものとして扱い、管理者に入れ直してもらう
    return null
  }
}

// 末尾を 4 文字にするのは、見分けるのに足り、キーそのものを推測する手がかりにならない長さのため
export const apiKeyHintOf = (apiKey: string) => apiKey.slice(-4)

const TOKEN_PREFIX = 'slagent_'

export const newAgentToken = () => `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`

/** DB に置く、トークンのハッシュ。トークンの形でなければ null（DB を引かずに済ませる） */
export const agentTokenHash = (token: string) =>
  token.startsWith(TOKEN_PREFIX) && token.length <= 200 ? crypto.createHash('sha256').update(token).digest('hex') : null
