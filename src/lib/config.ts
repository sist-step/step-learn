import path from 'node:path'

// .env があれば読み込む（本番では環境変数を直接渡してもよい）
try {
  process.loadEnvFile()
} catch {}

const env = process.env
const dataDir = path.resolve(env.DATA_DIR ?? './data')

export const config = {
  port: Number(env.PORT ?? 3000),
  /** 公開 URL のオリジン。リバースプロキシ配下では CSRF 検証に必須（例: https://lms.example.com） */
  appOrigin: env.APP_ORIGIN || undefined,
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
