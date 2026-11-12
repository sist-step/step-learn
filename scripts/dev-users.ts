import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { eq, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// src/lib/schema.ts を読み込まないのは、拡張子なしの import を node がそのままでは解決できないため
const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  username: text('username'),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'teacher', 'student'] }).notNull(),
})

// npm run user:create を使わないのは、ユーザー名と同じ短いパスワードがパスワードの規則で弾かれるため
const DEV_USERS = [
  { role: 'admin', name: '管理者' },
  { role: 'teacher', name: '教師' },
  { role: 'student', name: '学生' },
] as const

// src/lib/auth.ts の hashPassword を使わないのは、schema.ts と同じく node から読み込めないため。形式と回数はそちらに合わせる
const PBKDF2_ITERATIONS = 600_000

const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`
}

const dbPath = path.resolve('data', 'step-learn.db')
if (!fs.existsSync(dbPath)) {
  console.error(`${dbPath} がありません。先に npm run dev を起動して DB を作ってください。`)
  process.exit(1)
}

const sqlite = new BetterSqlite3(dbPath)
sqlite.pragma('busy_timeout = 5000')
const db = drizzle(sqlite)

for (const { role, name } of DEV_USERS) {
  const email = `${role}@example.com`
  const username = role
  const passwordHash = await hashPassword(username)
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .all()
  if (existing.length > 1) {
    console.error(`${email} とユーザー名 ${username} が別の利用者に使われています。どちらかを変えてから実行し直してください。`)
    process.exit(1)
  }
  const [found] = existing
  if (found) {
    db.update(users).set({ email, username, passwordHash, role }).where(eq(users.id, found.id)).run()
    console.log(`更新しました: ${username}（${email}）`)
  } else {
    db.insert(users).values({ email, name, username, passwordHash, role }).run()
    console.log(`作成しました: ${username}（${email}）`)
  }
}

console.log('パスワードはユーザー名と同じです。')
sqlite.close()
