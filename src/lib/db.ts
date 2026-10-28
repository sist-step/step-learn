import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { config } from './config'

// node:sqlite（Node 24 標準）の薄いラッパー。
// prepare().bind().first() / all() / run() と batch() の形で書けるようにしている。
// SQLite は同期 API でプロセス内で完結するため、ネットワーク往復がなく非常に速い。

type Param = SQLInputValue

class Statement {
  private params: Param[] = []
  constructor(private stmt: StatementSync) {}

  bind(...params: Param[]) {
    const s = new Statement(this.stmt)
    s.params = params
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
    return this.stmt.columns().length > 0
  }
}

export class Database {
  private cache = new Map<string, StatementSync>()
  constructor(readonly sqlite: DatabaseSync) {}

  /** 同じ SQL のプリペアドステートメントは使い回す */
  prepare(sql: string) {
    let stmt = this.cache.get(sql)
    if (!stmt) {
      stmt = this.sqlite.prepare(sql)
      this.cache.set(sql, stmt)
    }
    return new Statement(stmt)
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

function migrate(sqlite: DatabaseSync, dir: string) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))')
  const applied = new Set((sqlite.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    sqlite.exec('BEGIN')
    try {
      sqlite.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
      sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
      sqlite.exec('COMMIT')
      console.log(`[db] applied migration ${file}`)
    } catch (e) {
      sqlite.exec('ROLLBACK')
      throw e
    }
  }
}

function open() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const sqlite = new DatabaseSync(config.databasePath)
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  migrate(sqlite, path.resolve('migrations'))
  return new Database(sqlite)
}

// 開発中のホットリロードで接続が増えないよう、globalThis に保持する
const g = globalThis as unknown as { __db?: Database }
export const db = (g.__db ??= open())
