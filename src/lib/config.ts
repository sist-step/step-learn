import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// .env があれば読み込む（本番では環境変数を直接渡してもよい）
try {
  process.loadEnvFile()
} catch {}

const env = process.env
const dataDir = path.resolve(env.DATA_DIR ?? './data')

function loadSessionSecret() {
  if (env.SESSION_SECRET) {
    if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET は 32 文字以上にしてください')
    return env.SESSION_SECRET
  }
  // 起動ごとにランダム生成しないのは、再起動のたびに全員がログアウトされるのを避けるため
  const file = path.join(dataDir, 'session-secret')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {}
  const secret = crypto.randomBytes(32).toString('base64url')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

function loadSmtp() {
  if (!env.SMTP_HOST) return null
  if (!env.MAIL_FROM) throw new Error('SMTP_HOST を設定する場合は MAIL_FROM も設定してください')
  // リクエストの Host からリンクを作ると、Host を偽装した登録要求で確認リンクを攻撃者のドメインに向けられる
  if (!env.APP_ORIGIN) throw new Error('SMTP_HOST を設定する場合は APP_ORIGIN も設定してください')
  const port = Number(env.SMTP_PORT ?? 587)
  return {
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    from: env.MAIL_FROM,
  }
}

export const config = {
  port: Number(env.PORT ?? 3000),
  /** 公開 URL のオリジン。リバースプロキシ配下では CSRF 検証に必須（例: https://lms.example.com） */
  appOrigin: env.APP_ORIGIN || undefined,
  /** リバースプロキシが付けた X-Forwarded-For をクライアント IP として信頼するか（レート制限に使う） */
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  /** セッション Cookie の HMAC 署名鍵。未設定なら DATA_DIR/session-secret を生成して使う */
  sessionSecret: loadSessionSecret(),
  databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, 'step-learn.db')),
  filesDir: path.join(dataDir, 'files'),
  /** R2 の 4 項目がすべて設定されていれば R2、なければローカルディスクに保存 */
  r2:
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
      ? {
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          bucket: env.R2_BUCKET,
        }
      : null,
  /** SMTP_HOST が設定されていれば SMTP で送信、なければメール本文をサーバーログに出す */
  smtp: loadSmtp(),
}
