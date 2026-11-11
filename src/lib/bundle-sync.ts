// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { bundlePath, isExcludedPath, samePath, type BundleFile } from './bundle'
import type { Student } from './code-store'
import { diffLines, diffStats, splitLines } from './diff'

/** 記録するファイル 1 つの大きさの上限。残すのはソースコードの変更履歴なので、大きなファイルは記録しない */
export const MAX_SYNC_FILE_SIZE = 256 * 1024
/** 1 人がアイテム 1 つに残せる記録の合計（縮める前の大きさ） */
export const MAX_SYNC_TOTAL_SIZE = 30 * 1024 * 1024
/** 拡張機能が 1 回に送れる本文の大きさと、変更の数 */
export const SYNC_BODY_LIMIT = 2 * 1024 * 1024
export const MAX_SYNC_CHANGES = 200
/** 変更履歴の画面に出す、1 人の記録の数（新しいものから） */
export const MAX_LISTED_VERSIONS = 5000

/** 記録 1 件（中身を除く） */
export type SyncVersion = {
  id: number
  path: string
  /** ファイルを消した記録なら 1 */
  deleted: number
  sha256: string
  size: number
  added: number
  removed: number
  createdAt: number
}

export type SyncVersionContent = SyncVersion & { content: Buffer | null }

export type NewSyncVersion = Omit<SyncVersionContent, 'id' | 'createdAt'>

/** 変更履歴の一覧の 1 行。versions は記録の数、lastAt はいちばん新しい記録の日時（記録がなければ null） */
export type SyncStudentRow = { student: Student; versions: number; lastAt: number | null }

/**
 * ファイル自動配布のアイテム 1 つの、同期の設定と記録の置き場所。通常モードは step-learn.db（lib/bundle-items.ts）、
 * Moodle モードは moodle-mode.db（moodle-mode/bundle-store.ts）に置く
 */
export type BundleSyncStore = {
  enabled: () => boolean
  setEnabled: (on: boolean) => void
  /** 変更履歴の一覧に並べる人 */
  listStudents: () => SyncStudentRow[]
  findUser: (userId: number) => Student | undefined
  /** 1 人の記録（新しい順） */
  listVersions: (userId: number) => SyncVersion[]
  getVersion: (userId: number, id: number) => SyncVersionContent | undefined
  /** そのファイルのいちばん新しい記録 */
  latest: (userId: number, path: string) => SyncVersionContent | undefined
  add: (userId: number, versions: NewSyncVersion[]) => void
  /** 1 人の記録の大きさの合計 */
  usage: (userId: number) => number
}

/** アイテムの画面に出す同期の状態。historyHref は、見ている人が開ける変更履歴の画面（なければ出さない） */
export type BundleSyncState = { enabled: boolean; historyHref?: string }

export function syncStateOf(sync: BundleSyncStore, base: string, viewer: { id: number; canManage: boolean }): BundleSyncState {
  const enabled = sync.enabled()
  if (viewer.canManage)
    return { enabled, historyHref: enabled || sync.listStudents().some((r) => r.versions) ? `${base}/history` : undefined }
  return { enabled, historyHref: sync.usage(viewer.id) > 0 ? `${base}/history/${viewer.id}` : undefined }
}

export function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // UTF-8 でないものは、Windows の古いエディターが書き出す Shift_JIS とみなす
    return new TextDecoder('shift_jis').decode(bytes)
  }
}

const isText = (bytes: Uint8Array) => !bytes.includes(0)

export const textOf = (version: Pick<SyncVersionContent, 'content'>) =>
  version.content ? decodeText(zlib.gunzipSync(version.content)) : ''

/** 最初の記録と比べる、配ったファイルの中身。配っていないファイルや、文字として読めないファイルなら空 */
export async function distributedText(files: BundleFile[], path: string, read: (file: BundleFile) => Promise<Uint8Array | null>) {
  const file = files.find((f) => samePath(f.path, path))
  if (!file || !file.size || file.size > MAX_SYNC_FILE_SIZE) return ''
  const bytes = await read(file)
  return bytes && isText(bytes) ? decodeText(bytes) : ''
}

/** 拡張機能から送られた変更 1 つ。content が null なら、ファイルを消した */
export type SyncChange = { path: string; content: Uint8Array | null }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** 要求の本文から、記録できる変更だけを取り出す。記録しないもの（大きすぎる・文字でない・配らない場所）は捨てる */
export function parseChanges(body: unknown): SyncChange[] | null {
  if (!isObject(body) || !Array.isArray(body.changes) || body.changes.length > MAX_SYNC_CHANGES) return null
  // 同じファイルが 2 回あれば後のものだけを残すのは、1 回の要求の中の途中の状態を記録しても、同じ時刻の記録が並ぶだけになるため
  const changes = new Map<string, SyncChange>()
  for (const raw of body.changes as unknown[]) {
    if (!isObject(raw) || typeof raw.path !== 'string') return null
    const path = bundlePath(raw.path)
    if (!path || isExcludedPath(path)) continue
    if (raw.deleted === true) {
      changes.set(path, { path, content: null })
      continue
    }
    if (typeof raw.content !== 'string') return null
    const content = Buffer.from(raw.content, 'base64')
    if (content.length <= MAX_SYNC_FILE_SIZE && isText(content)) changes.set(path, { path, content })
  }
  return [...changes.values()]
}

/**
 * 変更を記録する。前の記録（なければ配ったファイル）と同じ中身のものは記録しない。
 * full は、上限に達して記録できなかったものがあるか
 */
export async function recordChanges(
  sync: BundleSyncStore,
  userId: number,
  changes: SyncChange[],
  files: BundleFile[],
  read: (file: BundleFile) => Promise<Uint8Array | null>,
) {
  const versions: NewSyncVersion[] = []
  let room = MAX_SYNC_TOTAL_SIZE - sync.usage(userId)
  let full = false
  for (const { path, content } of changes) {
    const latest = sync.latest(userId, path)
    const distributed = files.find((f) => samePath(f.path, path))
    const gone = latest ? !!latest.deleted : !distributed
    if (!content) {
      if (gone) continue
      const before = latest ? textOf(latest) : await distributedText(files, path, read)
      versions.push({ path, deleted: 1, sha256: '', size: 0, added: 0, removed: splitLines(before).length, content: null })
      continue
    }
    const sha256 = crypto.createHash('sha256').update(content).digest('hex')
    if (latest ? !latest.deleted && latest.sha256 === sha256 : distributed?.sha256 === sha256) continue
    if (content.length > room) {
      full = true
      continue
    }
    room -= content.length
    const before = latest ? textOf(latest) : await distributedText(files, path, read)
    const stats = diffStats(diffLines(before, decodeText(content)))
    versions.push({ path, deleted: 0, sha256, size: content.length, ...stats, content: zlib.gzipSync(content) })
  }
  sync.add(userId, versions)
  return { recorded: versions.length, full }
}
