// 「データを同期する」アイテムで、保存したファイルの内容を変更履歴として STEP Learn に送る。
// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは extension.ts）
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SyncError } from './sync'

/** STEP Learn の GET /api/vscode/sync の応答 */
export type SyncStatus = { enabled: boolean; maxFileSize: number }

/** 前に送ったファイルの中身のハッシュ。消したと送ったファイルは null */
export type Uploaded = Record<string, string | null>

/** 送る変更 1 つ。content が null なら、ファイルを消した */
export type Change = { path: string; content: Uint8Array | null; sha256: string | null }

/** 鍵の期限が切れた・アイテムがなくなったなど、STEP Learn の画面から開き直さないと続けられない失敗 */
export class SyncExpiredError extends SyncError {}

// サーバーの上限（SYNC_BODY_LIMIT・MAX_SYNC_CHANGES）より小さくしておくのは、base64 にすると 3 分の 4 に膨らむため
const MAX_BATCH_BYTES = 1024 * 1024
const MAX_BATCH_CHANGES = 100
// 上限を付けるのは、生成物の入ったフォルダーを置かれたときに、開くたびに数万のファイルを読まないようにするため
const MAX_SCANNED_FILES = 5000

/** サーバー（lib/bundle.ts の EXCLUDED_SEGMENTS）が受け付けない場所。読まずに済ませる */
const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
])

export const isExcluded = (p: string) => p.split('/').some((s) => EXCLUDED_SEGMENTS.has(s))

/** folder の中のファイルの場所を、/ 区切りの相対パスにする。folder の外なら null */
export function relativePath(folder: string, file: string) {
  const rel = path.relative(folder, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

const targetOf = (folder: string, p: string) => path.join(folder, ...p.split('/'))

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

async function request(server: URL, token: string, init?: RequestInit) {
  const res = await fetch(new URL('/api/vscode/sync', server), {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch(() => {
    throw new SyncError('STEP Learn に接続できませんでした。')
  })
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 401)
    throw new SyncExpiredError(isObject(body) && typeof body.error === 'string' ? body.error : '同期の期限が切れました。')
  if (!res.ok || !isObject(body)) throw new SyncError(`STEP Learn に接続できませんでした（${res.status}）。`)
  return body
}

export async function fetchStatus(server: URL, token: string): Promise<SyncStatus> {
  const body = await request(server, token)
  return { enabled: body.enabled === true, maxFileSize: typeof body.maxFileSize === 'number' ? body.maxFileSize : 0 }
}

/** dir の下の、記録の対象になるファイル。prefix は dir の相対パス */
async function listFiles(folder: string, prefix: string, found: string[] = []) {
  const entries = await fs.readdir(targetOf(folder, prefix), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (found.length >= MAX_SCANNED_FILES) break
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue
    const p = prefix ? `${prefix}/${entry.name}` : entry.name
    // シンボリックリンクをたどらないのは、フォルダーの外のファイルを STEP Learn に送らないため
    if (entry.isDirectory()) await listFiles(folder, p, found)
    else if (entry.isFile()) found.push(p)
  }
  return found
}

/** path の今の中身。ファイルがなければ null、記録しないもの（大きすぎる・文字でない・ファイルでない）なら 'skip' */
async function readTracked(folder: string, p: string, maxFileSize: number) {
  const target = targetOf(folder, p)
  const stat = await fs.lstat(target).catch(() => null)
  if (!stat) return null
  if (!stat.isFile() || stat.size > maxFileSize) return 'skip'
  const content = new Uint8Array(await fs.readFile(target))
  if (content.includes(0)) return 'skip'
  return { content, sha256: crypto.createHash('sha256').update(content).digest('hex') }
}

/** 変わったと知らされた場所を、確かめるファイルの一覧にする。フォルダーなら中のファイル、なくなっていれば前に知っていた中のファイル */
async function expand(folder: string, p: string, known: string[]) {
  const stat = await fs.lstat(targetOf(folder, p)).catch(() => null)
  if (stat?.isDirectory()) return listFiles(folder, p)
  if (stat) return [p]
  return [p, ...known.filter((k) => k.startsWith(`${p}/`))]
}

/**
 * フォルダーの今の状態を、前に送った状態（なければ配られた状態）と比べて、送る変更を集める。
 * paths を渡さなければ、フォルダー全体を調べる
 */
export async function collectChanges(
  folder: string,
  distributed: Record<string, string>,
  uploaded: Uploaded,
  maxFileSize: number,
  paths?: Iterable<string>,
): Promise<Change[]> {
  const known = [...new Set([...Object.keys(distributed), ...Object.keys(uploaded)])]
  const targets = new Set<string>()
  if (paths) for (const p of paths) for (const file of await expand(folder, p, known)) targets.add(file)
  else for (const file of [...(await listFiles(folder, '')), ...known]) targets.add(file)

  const changes: Change[] = []
  for (const p of targets) {
    if (isExcluded(p)) continue
    const before = Object.hasOwn(uploaded, p) ? uploaded[p] : (distributed[p] ?? null)
    const now = await readTracked(folder, p, maxFileSize)
    if (now === 'skip') continue
    if (!now) {
      if (before !== null) changes.push({ path: p, content: null, sha256: null })
    } else if (now.sha256 !== before) changes.push({ path: p, ...now })
  }
  return changes
}

function batches(changes: Change[]) {
  const result: Change[][] = [[]]
  let size = 0
  for (const change of changes) {
    const bytes = change.content?.length ?? 0
    if (result.at(-1)!.length >= MAX_BATCH_CHANGES || (size + bytes > MAX_BATCH_BYTES && result.at(-1)!.length > 0)) {
      result.push([])
      size = 0
    }
    result.at(-1)!.push(change)
    size += bytes
  }
  return result
}

/**
 * 変更を送る。onSent は、1 回分を送り終えるたびに呼ぶ（途中で失敗しても、送り終えた分を覚えておけるようにする）。
 * enabled は教師が同期を止めていないか、full は記録の上限に達して残せなかったものがあるか
 */
export async function pushChanges(server: URL, token: string, changes: Change[], onSent: (sent: Change[]) => void | Promise<void>) {
  let full = false
  for (const batch of batches(changes)) {
    const body = await request(server, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: batch.map((c) =>
          c.content ? { path: c.path, content: Buffer.from(c.content).toString('base64') } : { path: c.path, deleted: true },
        ),
      }),
    })
    if (body.enabled !== true) return { enabled: false, full }
    full ||= body.full === true
    await onSent(batch)
  }
  return { enabled: true, full }
}

/** 送り終えた変更を、前に送った状態に反映する */
export function markUploaded(uploaded: Uploaded, sent: Change[]): Uploaded {
  const next = { ...uploaded }
  for (const change of sent) next[change.path] = change.sha256
  return next
}
