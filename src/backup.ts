// SQLite のバックアップ。`npm run build` で dist/server/backup.js にビルドされる。
// cli.ts に入れないのは、cli.ts は通常モードの DB（lib/db.ts）を読み込むので、Moodle モードのサーバーでは動かないため
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import BetterSqlite3 from 'better-sqlite3'
import { config } from './lib/config'

const USAGE = `使い方: npm run db:backup -- [--out <ディレクトリ>] [--keep <世代数>]

動いているサーバーを止めずに、SQLite のデータベース（step-learn.db・moodle-mode.db のうちあるもの）を複製します。
ファイルをそのままコピーしないでください。WAL に書きかけの内容があると、壊れた複製になります。

  --out    書き出す先（既定 data/backups）
  --keep   残す世代の数。古いものから消す（既定 7）`

const JST_OFFSET = 9 * 60 * 60 * 1000

const stamp = (date: Date) => new Date(date.getTime() + JST_OFFSET).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(path.dirname(config.databasePath), 'backups') },
    keep: { type: 'string', default: '7' },
    help: { type: 'boolean', short: 'h' },
  },
})
if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
const keep = Number(values.keep)
if (!Number.isSafeInteger(keep) || keep < 1) fail(`--keep には 1 以上の整数を指定してください。\n\n${USAGE}`)

const sources = [config.databasePath, config.moodleDatabasePath].filter((file) => fs.existsSync(file))
if (!sources.length) fail(`データベースが見つかりません（${path.dirname(config.databasePath)}）。`)

fs.mkdirSync(values.out, { recursive: true })
const now = stamp(new Date())
for (const source of sources) {
  const base = path.basename(source, '.db')
  const target = path.join(values.out, `${base}-${now}.db`)
  // 書き出し先に直接書かないのは、途中で止まったときに、完全な複製と見分けのつかないファイルが残るため
  const partial = `${target}.partial`
  const db = new BetterSqlite3(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(partial)
  } finally {
    db.close()
  }
  fs.renameSync(partial, target)
  console.log(`${target} に書き出しました。`)

  const pattern = new RegExp(`^${base}-\\d{8}-\\d{6}\\.db$`)
  const old = fs
    .readdirSync(values.out)
    .filter((name) => pattern.test(name))
    .sort()
    .slice(0, -keep)
  for (const name of old) fs.rmSync(path.join(values.out, name))
  if (old.length) console.log(`古いバックアップを ${old.length} 個消しました。`)
}
