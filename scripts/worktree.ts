import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const WORKTREES_DIR = '.claude/worktrees'
const BRANCH_PREFIXES = ['feature', 'fix', 'chore', 'docs']
const FIRST_DEV_PORT = 5180

// 子プロセスの出力を stdout に流さないのは、WorktreeCreate フックでは stdout が worktree のパスを返す経路になっているため
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, stdio: ['ignore', 2, 2] })
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const log = (message: string) => console.error(message)

function tryGit(cwd: string, ...args: string[]) {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

const mainRootOf = (cwd: string) => path.dirname(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'))

// ディレクトリを入れ子にしないのは、削除したあとに feature/ などの空のディレクトリが残るため
const dirNameOf = (name: string) => name.replaceAll('/', '-')

function branchNameOf(name: string) {
  const prefix = BRANCH_PREFIXES.find((p) => name.startsWith(`${p}-`) || name.startsWith(`${p}/`))
  return prefix ? `${prefix}/${name.slice(prefix.length + 1)}` : `worktree-${dirNameOf(name)}`
}

async function readHookInput() {
  let json = ''
  for await (const chunk of process.stdin) json += chunk
  return JSON.parse(json) as { cwd: string; name?: string; worktree_path?: string }
}

const isPortFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })

async function findFreePort() {
  let port = FIRST_DEV_PORT
  while (!(await isPortFree(port))) port++
  return port
}

async function copyData(from: string, to: string) {
  const src = path.join(from, 'data')
  const dest = path.join(to, 'data')
  if (!fs.existsSync(src)) return
  // 静的 import にしないのは、worktree の中で npm run worktree:setup を実行したときはまだ node_modules がなく、npm ci のあとでないと読み込めないため
  const { default: BetterSqlite3 } = await import('better-sqlite3')
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    if (/\.db-(wal|shm)$/.test(entry) || fs.existsSync(path.join(dest, entry))) continue
    if (entry.endsWith('.db')) {
      // ファイルをそのままコピーしないのは、起動中の開発サーバーが WAL に書きかけの内容を取りこぼし、壊れた DB になりうるため
      const db = new BetterSqlite3(path.join(src, entry), { readonly: true, fileMustExist: true })
      await db.backup(path.join(dest, entry))
      db.close()
    } else {
      fs.cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true })
    }
    log(`data/${entry} をコピーしました`)
  }
}

async function setup(worktree: string) {
  const mainRoot = mainRootOf(worktree)
  if (path.resolve(worktree) === mainRoot) throw new Error('メインの作業ディレクトリではなく、worktree の中で実行してください')
  if (fs.existsSync(path.join(mainRoot, '.env')) && !fs.existsSync(path.join(worktree, '.env'))) {
    fs.copyFileSync(path.join(mainRoot, '.env'), path.join(worktree, '.env'))
    log('.env をコピーしました')
  }
  if (!fs.existsSync(path.join(worktree, 'node_modules'))) run('npm', ['ci'], worktree)
  await copyData(mainRoot, worktree)
  const port = await findFreePort()
  log(`\n準備ができました: ${worktree}`)
  log(`開発サーバー: npm run dev -- --port ${port} --strictPort`)
}

async function create() {
  const input = await readHookInput()
  if (!input.name) throw new Error('WorktreeCreate フックの入力に name がありません')
  const mainRoot = mainRootOf(input.cwd)
  const worktree = path.join(mainRoot, WORKTREES_DIR, dirNameOf(input.name))
  const branch = branchNameOf(input.name)
  if (!fs.existsSync(worktree)) {
    tryGit(mainRoot, 'fetch', '--quiet', 'origin', 'master')
    const base = tryGit(mainRoot, 'rev-parse', '--verify', '--quiet', 'origin/master') ? 'origin/master' : 'HEAD'
    const exists = tryGit(mainRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) !== null
    run('git', exists ? ['worktree', 'add', worktree, branch] : ['worktree', 'add', '--no-track', '-b', branch, worktree, base], mainRoot)
  }
  await setup(worktree)
  console.log(worktree)
}

async function remove() {
  const input = await readHookInput()
  if (!input.worktree_path) throw new Error('WorktreeRemove フックの入力に worktree_path がありません')
  const mainRoot = mainRootOf(input.cwd)
  const branch = tryGit(input.worktree_path, 'branch', '--show-current')
  // --force なしにしないのは、data/ や node_modules などの無視されたファイルや未コミットの変更が残っていると削除できないため。消してよいかは Claude Code が先にユーザーに確認している
  run('git', ['worktree', 'remove', '--force', input.worktree_path], mainRoot)
  // -D にしないのは、マージしていないコミットのあるブランチまで消さないため
  if (branch && tryGit(mainRoot, 'branch', '-d', branch) !== null) log(`ブランチ ${branch} を削除しました`)
}

const commands: Record<string, () => Promise<void>> = { create, remove, setup: () => setup(process.cwd()) }
const command = commands[process.argv[2] ?? '']
if (!command) throw new Error('使い方: node scripts/worktree.ts <create|remove|setup>')
await command()
