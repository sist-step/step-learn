import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean }

const DIR = 'migrations'
const JOURNAL = `${DIR}/meta/_journal.json`
const work = path.resolve('node_modules/.cache/check-migrations')
const errors: string[] = []

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })
const snapshotOf = (e: JournalEntry) => `${DIR}/meta/${e.tag.split('_')[0]}_snapshot.json`
const readJournal = (json: string | null): JournalEntry[] => (json ? JSON.parse(json).entries : [])

function showAt(ref: string, file: string) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function step(title: string, fn: () => void) {
  const before = errors.length
  fn()
  console.log(`${errors.length === before ? '✓' : '✗'} ${title}`)
}

const baseArg = process.argv[2] ?? 'origin/master'
const base = git('merge-base', baseArg, 'HEAD').trim()
const baseJournal = readJournal(showAt(base, JOURNAL))
const headJournal = readJournal(fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, 'utf8') : null)
console.log(`比較対象: ${baseArg} (${base.slice(0, 7)})、適用済みマイグレーション ${baseJournal.length} 件\n`)

step('適用済みのマイグレーションが変更・削除されていない', () => {
  const protectedFiles = new Set(baseJournal.flatMap((e) => [`${DIR}/${e.tag}.sql`, snapshotOf(e)]))
  // HEAD ではなく作業ツリーと比べるのは、コミット前にローカルで確認したときも検出するため
  const changed = git('diff', '--no-renames', '--name-status', base, '--', DIR)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string])
  for (const [status, file] of changed) {
    if (protectedFiles.has(file))
      errors.push(
        `${file} が${status === 'D' ? '削除' : '変更'}されています。適用済みのマイグレーションは編集せず、新しいマイグレーションを追加してください`,
      )
  }
})

step('journal は既存エントリを保ったまま末尾に追加されている', () => {
  baseJournal.forEach((e, i) => {
    if (JSON.stringify(headJournal[i]) !== JSON.stringify(e)) errors.push(`${JOURNAL} の既存エントリ ${e.tag} が変更・削除されています`)
  })
  const lastWhen = Math.max(0, ...baseJournal.map((e) => e.when))
  headJournal.slice(baseJournal.length).forEach((e, i) => {
    const prev = headJournal[baseJournal.length + i - 1]
    if (e.idx !== baseJournal.length + i) errors.push(`${e.tag} の idx が連番になっていません`)
    // migrator は最後に適用した when より新しいものだけを適用するため、古い when は本番で黙ってスキップされる
    if (e.when <= Math.max(lastWhen, prev?.when ?? 0)) {
      errors.push(
        `${e.tag} の作成日時が既存のマイグレーションより古いため、適用済みの DB では実行されません。ベースブランチを取り込んでから npm run db:generate で作り直してください`,
      )
    }
  })
})

step('migrations/ の SQL がすべて journal に載っている', () => {
  const tags = new Set(headJournal.map((e) => e.tag))
  for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
    if (!tags.has(f.replace(/\.sql$/, '')))
      errors.push(`${DIR}/${f} が journal にないため適用されません。手で作らず npm run db:generate で生成してください`)
  }
  for (const e of headJournal) {
    if (!fs.existsSync(`${DIR}/${e.tag}.sql`)) errors.push(`${DIR}/${e.tag}.sql がありません`)
    if (!fs.existsSync(snapshotOf(e))) errors.push(`${snapshotOf(e)} がありません`)
  }
})

fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })

const kit = (configFile: string, command: string) =>
  execFileSync('npx', ['drizzle-kit', command, '--config', configFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

step('schema.ts とマイグレーションが一致している', () => {
  // 作業ツリーを汚さないよう、コピーした migrations/ に対して generate する
  const out = path.join(work, 'generate')
  fs.cpSync(DIR, out, { recursive: true })
  const config = path.join(work, 'drizzle.config.ts')
  // drizzle-kit は out の先頭に ./ を付けて解決するため、絶対パスでは渡せない
  fs.writeFileSync(
    config,
    `export default ${JSON.stringify({ dialect: 'sqlite', schema: './src/lib/schema.ts', out: path.relative('.', out) })}\n`,
  )
  try {
    kit(config, 'check')
    const before = fs.readdirSync(out).length
    kit(config, 'generate')
    if (fs.readdirSync(out).length !== before)
      errors.push('schema.ts の変更に対応するマイグレーションがありません。npm run db:generate を実行してコミットしてください')
  } catch (e) {
    errors.push(`drizzle-kit が失敗しました\n${(e as { stderr?: string }).stderr ?? String(e)}`)
  }
})

function applyAll(folders: string[]) {
  const sqlite = new BetterSqlite3(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const orm = drizzle(sqlite)
  for (const folder of folders) migrate(orm, { migrationsFolder: folder })
  const applied = sqlite.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at').pluck().all() as string[]
  sqlite.close()
  return applied
}

step('マイグレーションが空の DB と適用済みの DB の両方に適用できる', () => {
  const expected = readMigrationFiles({ migrationsFolder: DIR }).map((m) => m.hash)
  try {
    if (JSON.stringify(applyAll([DIR])) !== JSON.stringify(expected))
      errors.push('空の DB にすべてのマイグレーションが適用されませんでした')
  } catch (e) {
    errors.push(`空の DB への適用に失敗しました: ${(e as Error).message}`)
  }
  if (!baseJournal.length) return
  const baseDir = path.join(work, 'base')
  fs.mkdirSync(baseDir)
  execFileSync('sh', ['-c', `git archive ${base} ${DIR} | tar -x -C ${JSON.stringify(baseDir)}`])
  try {
    const applied = applyAll([path.join(baseDir, DIR), DIR])
    if (JSON.stringify(applied) !== JSON.stringify(expected))
      errors.push('ベースブランチのマイグレーションを適用済みの DB に、追加分が正しく適用されませんでした')
  } catch (e) {
    errors.push(`ベースブランチのマイグレーションを適用済みの DB への適用に失敗しました: ${(e as Error).message}`)
  }
})

fs.rmSync(work, { recursive: true, force: true })

if (errors.length) {
  console.error(`\n${errors.map((e) => `- ${e}`).join('\n')}`)
  process.exit(1)
}
