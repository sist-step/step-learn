// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは extension.ts）
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type ManifestFile = { path: string; size: number; sha256: string }

/** 変更履歴を送るための鍵と、アイテムが「データを同期する」になっているか */
export type ManifestSync = { token: string; enabled: boolean }

/** STEP Learn の /api/vscode/claim の応答。sync は、同期に対応していない古い STEP Learn にはない */
export type Manifest = { ref: string; course: string; title: string; grant: string; files: ManifestFile[]; sync?: ManifestSync }

/** 前に用意したときの記録。files は、配られたときのファイルの中身のハッシュ（学生が書き換えたかを見分ける） */
export type Synced = { folder: string; files: Record<string, string> }

/** 学生に見せる理由付きの失敗 */
export class SyncError extends Error {}

// サーバーの上限（MAX_BUNDLE_FILES・MAX_BUNDLE_SIZE）より大きくしておくのは、サーバーの上限を上げても拡張機能を出し直さずに済ませるため
const MAX_FILES = 2000
const MAX_TOTAL_SIZE = 500 * 1024 * 1024
const PARALLEL = 4

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** リンクの server。https か、手元で動かしている STEP Learn（http://localhost）だけを受け付ける */
export function parseServer(raw: string): URL | null {
  // URL.parse を使わないのは、VS Code 1.90 の Node（20）にはまだないため
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return new URL(url.origin)
  return null
}

// サーバーも確かめているが、ここでも確かめるのは、受け取ったパスでフォルダーの外に書き込まないことを拡張機能の側で保証するため
const INVALID_SEGMENT = /[\p{Cc}<>:"|?*\\]|^\.{1,2}$|[. ]$/u

export const isSafePath = (p: string) => {
  const parts = p.split('/')
  return parts.length > 0 && parts.length <= 64 && parts.every((s) => s.length > 0 && s.length <= 255 && !INVALID_SEGMENT.test(s))
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** コースやアイテムの名前を、フォルダー名に使える形にする */
export function folderName(name: string) {
  const safe = name
    .replace(/[\p{Cc}<>:"|?*\\/]/gu, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return !safe || RESERVED_NAMES.test(safe) ? `_${safe}` : safe
}

/** 配布ファイルを用意する場所。setting が空なら「ドキュメント/STEP Learn」（ドキュメントのフォルダーがなければホーム） */
export async function rootFolder(setting: string) {
  const home = os.homedir()
  if (setting.trim()) return path.resolve(setting.trim().replace(/^~(?=$|[\\/])/, home))
  const documents = path.join(home, 'Documents')
  return path.join((await exists(documents)) ? documents : home, 'STEP Learn')
}

export const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  )

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

async function errorOf(res: Response) {
  const body: unknown = await res.json().catch(() => null)
  return isObject(body) && typeof body.error === 'string' ? body.error : `STEP Learn に接続できませんでした（${res.status}）。`
}

function parseManifest(body: unknown): Manifest {
  const invalid = new SyncError('STEP Learn から受け取った内容が正しくありません。')
  if (!isObject(body) || !Array.isArray(body.files)) throw invalid
  const { ref, course, title, grant } = body
  if (typeof ref !== 'string' || typeof course !== 'string' || typeof title !== 'string' || typeof grant !== 'string') throw invalid
  const files = body.files.map((f: unknown): ManifestFile => {
    if (!isObject(f) || typeof f.path !== 'string' || typeof f.size !== 'number' || typeof f.sha256 !== 'string') throw invalid
    if (!isSafePath(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new SyncError(`「${f.path}」は、この PC に用意できない場所です。`)
    return { path: f.path, size: f.size, sha256: f.sha256 }
  })
  if (files.length > MAX_FILES || files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_SIZE)
    throw new SyncError('配布されたファイルが多すぎるため、用意できません。')
  const sync =
    isObject(body.sync) && typeof body.sync.token === 'string' ? { token: body.sync.token, enabled: body.sync.enabled === true } : undefined
  return { ref, course, title, grant, files, sync }
}

/** リンクの鍵を、配るファイルの一覧と、ファイルを受け取るための鍵に引き換える */
export async function claim(server: URL, token: string): Promise<Manifest> {
  const res = await fetch(new URL('/api/vscode/claim', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {
    throw new SyncError('STEP Learn に接続できませんでした。ネットワークを確かめてください。')
  })
  if (!res.ok) throw new SyncError(await errorOf(res))
  return parseManifest(await res.json())
}

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

const targetOf = (folder: string, p: string) => path.join(folder, ...p.split('/'))

async function localHash(file: string) {
  const stat = await fs.lstat(file).catch(() => null)
  if (!stat) return null
  // ファイル以外（フォルダーやシンボリックリンク）を読まないのは、リンク先のフォルダーの外のファイルを書き換えないため
  if (!stat.isFile()) return 'other'
  return sha256(await fs.readFile(file))
}

/** 用意済みのフォルダーと配るファイルを比べる */
export type Plan = {
  /** まだないファイル */
  missing: ManifestFile[]
  /** 先生が更新していて、学生は書き換えていないファイル */
  updatable: ManifestFile[]
  /** 配られたものと同じファイル */
  same: ManifestFile[]
  /** 学生が書き換えたファイル（上書きしない） */
  modified: ManifestFile[]
}

export async function plan(folder: string, manifest: Manifest, synced?: Synced): Promise<Plan> {
  const result: Plan = { missing: [], updatable: [], same: [], modified: [] }
  for (const file of manifest.files) {
    const local = await localHash(targetOf(folder, file.path))
    if (local === null) result.missing.push(file)
    else if (local === file.sha256) result.same.push(file)
    else if (local !== 'other' && synced?.files[file.path] === local) result.updatable.push(file)
    else result.modified.push(file)
  }
  return result
}

/** 同じ名前のフォルダーがあるか、ほかのアイテムに使われていれば「名前 (2)」のように番号を付ける */
export async function freshFolder(base: string, taken: ReadonlySet<string>) {
  let candidate = base
  for (let n = 2; taken.has(candidate) || (await exists(candidate)); n++) candidate = `${base} (${n})`
  return candidate
}

async function writeInside(root: string, p: string, bytes: Uint8Array) {
  const target = targetOf(root, p)
  await fs.mkdir(path.dirname(target), { recursive: true })
  // 途中のフォルダーがシンボリックリンクなら、書き込み先が用意したフォルダーの外に出るので止める
  const parent = await fs.realpath(path.dirname(target))
  if (parent !== root && !parent.startsWith(root + path.sep))
    throw new SyncError(`「${p}」は、用意するフォルダーの外を指しているため書き込みませんでした。`)
  const existing = await fs.lstat(target).catch(() => null)
  if (existing && !existing.isFile()) throw new SyncError(`「${p}」と同じ名前のフォルダーなどがあるため、書き込めませんでした。`)
  // 一時ファイルに書いてから置き換えるのは、途中で失敗したときに書きかけのファイルを残さないため
  const temp = `${target}.step-learn-${crypto.randomBytes(4).toString('hex')}`
  await fs.writeFile(temp, bytes)
  await fs.rename(temp, target)
}

/** files を受け取って folder に書き込む。done は書き終えたファイルの数 */
export async function download(
  server: URL,
  manifest: Manifest,
  files: ManifestFile[],
  folder: string,
  onProgress?: (done: number) => void,
) {
  await fs.mkdir(folder, { recursive: true })
  const root = await fs.realpath(folder)
  let next = 0
  let done = 0
  async function worker() {
    while (next < files.length) {
      const file = files[next++]
      const res = await fetch(new URL(`/api/vscode/files/${file.sha256}`, server), {
        headers: { Authorization: `Bearer ${manifest.grant}` },
      }).catch(() => {
        throw new SyncError('STEP Learn に接続できませんでした。ネットワークを確かめてください。')
      })
      if (!res.ok) throw new SyncError(await errorOf(res))
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (sha256(bytes) !== file.sha256) throw new SyncError(`「${file.path}」を正しく受け取れませんでした。もう一度お試しください。`)
      await writeInside(root, file.path, bytes)
      onProgress?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker))
}

/** 用意したあとの記録。学生が書き換えたファイルは、前に配られたときのハッシュのまま残す */
export function record(folder: string, previous: Synced | undefined, written: ManifestFile[], same: ManifestFile[]): Synced {
  const files = { ...(previous?.folder === folder ? previous.files : {}) }
  for (const f of [...written, ...same]) files[f.path] = f.sha256
  return { folder, files }
}
