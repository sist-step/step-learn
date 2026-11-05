import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function openDatabase<S extends Record<string, unknown>>(
  file: string,
  migrationsFolder: string,
  schema: S,
): BetterSQLite3Database<S> {
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
  migrate(db, { migrationsFolder: path.resolve(migrationsFolder) })
  if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
    throw new Error('マイグレーション後に外部キーの整合性が崩れています。data/ のバックアップから戻してください')
  }
  sqlite.exec('PRAGMA foreign_keys = ON')
  return db
}
