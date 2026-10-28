import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { config } from './config'
import * as schema from './schema'

// better-sqlite3 の薄いラッパー。
// prepare().bind().first() / all() / run() と batch() の形で書けるようにしている。
// SQLite は同期 API でプロセス内で完結するため、ネットワーク往復がなく非常に速い。

type Param = string | number | bigint | Buffer | null
type StatementSync = BetterSqlite3.Statement<unknown[]>

class Statement {
  private params: unknown[] = []
  constructor(
    private stmt: StatementSync,
    private numbered: boolean,
  ) {}

  // better-sqlite3 は ?1 / ?2 を名前付きパラメータとして扱い、位置引数の配列では束縛できない
  bind(...params: Param[]) {
    const s = new Statement(this.stmt, this.numbered)
    s.params = this.numbered ? [Object.fromEntries(params.map((p, i) => [i + 1, p]))] : params
    return s
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.firstSync<T>()
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.allSync<T>()
  }

  async run() {
    return this.runSync()
  }

  firstSync<T>() {
    return (this.stmt.get(...this.params) as T | undefined) ?? null
  }

  allSync<T>() {
    return { results: this.stmt.all(...this.params) as T[] }
  }

  runSync() {
    const r = this.stmt.run(...this.params)
    return { meta: { changes: Number(r.changes) } }
  }

  /** 結果行を返す文かどうか（SELECT / RETURNING） */
  get returnsRows() {
    return this.stmt.reader
  }
}

export class Database {
  private cache = new Map<string, { stmt: StatementSync; numbered: boolean }>()
  constructor(readonly sqlite: BetterSqlite3.Database) {}

  /** 同じ SQL のプリペアドステートメントは使い回す */
  prepare(sql: string) {
    let entry = this.cache.get(sql)
    if (!entry) {
      entry = { stmt: this.sqlite.prepare<unknown[]>(sql), numbered: /\?\d/.test(sql) }
      this.cache.set(sql, entry)
    }
    return new Statement(entry.stmt, entry.numbered)
  }

  /** 複数の文を 1 トランザクションで実行する */
  async batch(statements: Statement[]): Promise<{ results: unknown[] }[]> {
    this.sqlite.exec('BEGIN')
    try {
      const out = statements.map((s) => (s.returnsRows ? s.allSync() : { results: [], ...s.runSync() }))
      this.sqlite.exec('COMMIT')
      return out
    } catch (e) {
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }
}

function open() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const sqlite = new BetterSqlite3(config.databasePath)
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  const orm = drizzle(sqlite, { schema })
  migrate(orm, { migrationsFolder: path.resolve('migrations') })
  return { db: new Database(sqlite), orm }
}

// 開発中のホットリロードで接続が増えないよう、globalThis に保持する
const g = globalThis as unknown as { __database?: ReturnType<typeof open> }
export const { db, orm } = (g.__database ??= open())
