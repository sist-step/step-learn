import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { config } from '../lib/config'
import { openDatabase } from '../lib/sqlite'
import * as schema from './schema'

export type MoodleDB = BetterSQLite3Database<typeof schema>

// 開発中のホットリロードで接続が増えないよう、globalThis に保持する
const g = globalThis as unknown as { __moodleDrizzle?: MoodleDB }
export const db = (g.__moodleDrizzle ??= openDatabase(config.moodleDatabasePath, 'migrations-moodle', schema))
