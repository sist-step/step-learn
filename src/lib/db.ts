import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { config } from './config'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema>

function open(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new BetterSqlite3(file)
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `)
  const db = drizzle(sqlite, { schema })
  // 外部キーを有効にしたまま移行しないのは、テーブルを作り直すマイグレーションの DROP TABLE で、子テーブルの行が
  // ON DELETE CASCADE で消えるため。移行はトランザクション内で走るので、SQL 側の PRAGMA foreign_keys=OFF は効かない。
  // better-sqlite3 は既定で外部キーが有効なので、明示的に切る
  sqlite.exec('PRAGMA foreign_keys = OFF')
  migrate(db, { migrationsFolder: path.resolve('migrations') })
  if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
    throw new Error('マイグレーション後に外部キーの整合性が崩れています。data/ のバックアップから戻してください')
  }
  sqlite.exec('PRAGMA foreign_keys = ON')
  return db
}

// drizzle の like() を使わないのは、入力の % と _ をワイルドカードとして扱わせないための ESCAPE を付けられないため
export const contains = (column: SQLWrapper, q: string) => sql`${column} LIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'`

// 開発中のホットリロードで接続が増えないよう、globalThis に保持する
const g = globalThis as unknown as { __drizzle?: DB }
export const db = (g.__drizzle ??= open(config.databasePath))
