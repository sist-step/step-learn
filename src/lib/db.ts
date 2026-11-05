import { sql, type SQLWrapper } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { config } from './config'
import * as schema from './schema'
import { openDatabase } from './sqlite'

export type DB = BetterSQLite3Database<typeof schema>

// 黙って開かずに止めるのは、Moodle モードのコードから間接的に読み込まれると、移行先で使うはずの step-learn.db が
// Moodle モードのサーバーにも作られてしまうため
if (config.moodle) {
  throw new Error(
    'Moodle モード（MOODLE_URL を設定）では step-learn.db を開きません。src/moodle-mode/ から src/lib/db.ts を読み込んでいるモジュールがないか確認してください（CLI も Moodle モードでは使えません）',
  )
}

// drizzle の like() を使わないのは、入力の % と _ をワイルドカードとして扱わせないための ESCAPE を付けられないため
export const contains = (column: SQLWrapper, q: string) => sql`${column} LIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'`

// 開発中のホットリロードで接続が増えないよう、globalThis に保持する
const g = globalThis as unknown as { __drizzle?: DB }
export const db = (g.__drizzle ??= openDatabase(config.databasePath, 'migrations', schema))
