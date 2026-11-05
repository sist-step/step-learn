import crypto from 'node:crypto'
import { config } from '../lib/config'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名と暗号化で同じ鍵を使い回さないため
const key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, '', 'step-learn moodle token', 32))

// ハッシュにしないのは、Moodle を呼ぶたびに元のトークンが要るため
export function encryptToken(token: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

/** 鍵が変わった（SESSION_SECRET を変えた）などで復号できなければ null */
export function decryptToken(stored: string) {
  try {
    const buf = Buffer.from(stored, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
