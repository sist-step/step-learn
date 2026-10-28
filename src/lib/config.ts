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

export const config = {
  port: Number(env.PORT ?? 3000),
  /** 公開 URL のオリジン。リバースプロキシ配下では CSRF 検証に必須（例: https://lms.example.com） */
  appOrigin: env.APP_ORIGIN || undefined,
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
}
