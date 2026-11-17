// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは code-session.ts と extension.ts）
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SyncError, isSafePath, type ManifestUser } from './sync'

/** コードのアイテムのファイル 1 つ。名前はブラウザエディターのタブと同じ（index.html・style.css・script.js・main.py） */
export type CodeFile = { path: string; content: string }

/** STEP Learn の GET /api/vscode/code/state の応答 */
export type CodeState = { title: string; language: string; files: CodeFile[]; canSubmit: boolean; page: string }

/** STEP Learn の POST /api/vscode/code/claim の応答 */
export type CodeManifest = CodeState & { ref: string; course: string; user: ManifestUser; token: string }

/** 前に用意したときの記録。files は、STEP Learn とやりとりするファイルの名前 */
export type CodeRecord = { folder: string; title: string; files: string[]; canSubmit: boolean; page: string }

/** STEP Learn とそろえたときの、ファイルの中身のハッシュ。書き換えたのが手元か STEP Learn かを見分ける */
export type CodeSynced = Record<string, string>

export type Verdict = 'pass' | 'partial' | 'fail'

/** いちばん新しい提出の判定 */
export type CodeResult = {
  status: 'none' | 'pending' | 'graded' | 'failed'
  createdAt: number
  /** optional は発展の制約で、クリアには数えない */
  verdicts: { label: string; verdict: Verdict; reason: string; optional: boolean }[]
  feedback: string
  teacherComment: string
}

/** 鍵の期限が切れたか、アイテムを開けなくなった。STEP Learn の画面から開き直すまで送れない */
export class CodeExpiredError extends SyncError {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export const hashText = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

const authorized = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' })

async function call(url: URL, init: RequestInit) {
  const res = await fetch(url, init).catch(() => {
    throw new SyncError('STEP Learn に接続できませんでした。ネットワークを確かめてください。')
  })
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return body
  const message = isObject(body) && typeof body.error === 'string' ? body.error : `STEP Learn に接続できませんでした（${res.status}）。`
  throw res.status === 401 ? new CodeExpiredError(message) : new SyncError(message)
}

const invalid = () => new SyncError('STEP Learn から受け取った内容が正しくありません。')

function parseState(body: unknown): CodeState {
  if (!isObject(body) || !Array.isArray(body.files)) throw invalid()
  const { title, language, canSubmit, page } = body
  if (typeof title !== 'string' || typeof language !== 'string' || typeof page !== 'string') throw invalid()
  const files = body.files.map((f: unknown): CodeFile => {
    if (!isObject(f) || typeof f.path !== 'string' || typeof f.content !== 'string') throw invalid()
    // サーバーが決める名前だけだが、ここでも確かめるのは、受け取ったパスでフォルダーの外に書き込まないことを拡張機能の側で保証するため
    if (!isSafePath(f.path) || f.path.includes('/')) throw new SyncError(`「${f.path}」は、この PC に用意できない場所です。`)
    return { path: f.path, content: f.content }
  })
  return { title, language, files, canSubmit: canSubmit === true, page }
}

/** リンクの鍵を、今のコードと、コードを送るための鍵に引き換える */
export async function claimCode(server: URL, token: string): Promise<CodeManifest> {
  const body = await call(new URL('/api/vscode/code/claim', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
  })
  const state = parseState(body)
  if (!isObject(body) || !isObject(body.user)) throw invalid()
  const { ref, course, token: codeToken } = body
  const { id, name } = body.user
  if (typeof ref !== 'string' || typeof course !== 'string' || typeof codeToken !== 'string') throw invalid()
  if (typeof id !== 'number' || typeof name !== 'string') throw invalid()
  return { ...state, ref, course, token: codeToken, user: { id, name } }
}

export async function fetchCodeState(server: URL, token: string): Promise<CodeState> {
  return parseState(await call(new URL('/api/vscode/code/state', server), { headers: authorized(token) }))
}

const filesBody = (files: CodeFile[]) => JSON.stringify({ files: Object.fromEntries(files.map((f) => [f.path, f.content])) })

/** 書きかけのコードとして保存する（ブラウザエディターで開くと、この内容が入る） */
export async function saveDraft(server: URL, token: string, files: CodeFile[]) {
  await call(new URL('/api/vscode/code/draft', server), {
    method: 'POST',
    headers: { ...authorized(token), 'Content-Type': 'application/json' },
    body: filesBody(files),
  })
}

/** 提出する。graded は AI が判定するか（しないときは教師が確認する） */
export async function submitCode(server: URL, token: string, files: CodeFile[]): Promise<{ graded: boolean }> {
  const body = await call(new URL('/api/vscode/code/submit', server), {
    method: 'POST',
    headers: { ...authorized(token), 'Content-Type': 'application/json' },
    body: filesBody(files),
  })
  return { graded: isObject(body) && body.graded === true }
}

const VERDICTS: readonly unknown[] = ['pass', 'partial', 'fail'] satisfies Verdict[]
const STATUSES: readonly unknown[] = ['none', 'pending', 'graded', 'failed'] satisfies CodeResult['status'][]

const isVerdict = (v: unknown): v is Verdict => VERDICTS.includes(v)
const isStatus = (v: unknown): v is CodeResult['status'] => STATUSES.includes(v)

/** いちばん新しい提出の判定。まだ提出していなければ null */
export async function fetchResult(server: URL, token: string): Promise<CodeResult | null> {
  const body = await call(new URL('/api/vscode/code/result', server), { headers: authorized(token) })
  if (!isObject(body)) throw invalid()
  const s = body.submission
  if (s === null) return null
  if (!isObject(s) || !isStatus(s.status) || !Array.isArray(s.verdicts)) throw invalid()
  const verdicts = s.verdicts.map((v: unknown) => {
    if (!isObject(v) || typeof v.label !== 'string' || !isVerdict(v.verdict)) throw invalid()
    return { label: v.label, verdict: v.verdict, reason: typeof v.reason === 'string' ? v.reason : '', optional: v.optional === true }
  })
  return {
    status: s.status,
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
    verdicts,
    feedback: typeof s.feedback === 'string' ? s.feedback : '',
    teacherComment: typeof s.teacherComment === 'string' ? s.teacherComment : '',
  }
}

/** folder にある、names のファイルの中身。ないファイルや、ファイルでないもの（フォルダーやシンボリックリンク）は含めない */
export async function readLocal(folder: string, names: readonly string[]): Promise<CodeFile[]> {
  const files: CodeFile[] = []
  for (const name of names) {
    const file = path.join(folder, name)
    const stat = await fs.lstat(file).catch(() => null)
    if (stat?.isFile()) files.push({ path: name, content: await fs.readFile(file, 'utf8') })
  }
  return files
}

/** STEP Learn のコードと手元のファイルを比べる */
export type CodePlan = {
  /** 手元にないか、手元は前にそろえたときのままで、STEP Learn だけが変わったファイル（そのまま書き込んでよい） */
  write: CodeFile[]
  /** 手元でも STEP Learn でも書き換えたファイル */
  conflicts: CodeFile[]
  /** 手元だけを書き換えたファイル（STEP Learn に送る） */
  ahead: CodeFile[]
}

export async function planCode(folder: string, files: CodeFile[], synced: CodeSynced): Promise<CodePlan> {
  const plan: CodePlan = { write: [], conflicts: [], ahead: [] }
  const local = new Map(
    (
      await readLocal(
        folder,
        files.map((f) => f.path),
      )
    ).map((f) => [f.path, f.content]),
  )
  for (const file of files) {
    const mine = local.get(file.path)
    if (mine === undefined) plan.write.push(file)
    else if (mine === file.content) continue
    else if (hashText(mine) === synced[file.path]) plan.write.push(file)
    else if (hashText(file.content) === synced[file.path]) plan.ahead.push({ path: file.path, content: mine })
    else plan.conflicts.push(file)
  }
  return plan
}

export async function writeLocal(folder: string, files: CodeFile[]) {
  await fs.mkdir(folder, { recursive: true })
  for (const file of files) {
    const target = path.join(folder, file.path)
    const existing = await fs.lstat(target).catch(() => null)
    if (existing && !existing.isFile()) throw new SyncError(`「${file.path}」と同じ名前のフォルダーなどがあるため、書き込めませんでした。`)
    // 一時ファイルに書いてから置き換えるのは、途中で失敗したときに書きかけのファイルを残さないため
    const temp = `${target}.step-learn-${crypto.randomBytes(4).toString('hex')}`
    await fs.writeFile(temp, file.content, 'utf8')
    await fs.rename(temp, target)
  }
}

/** files の中身のハッシュを synced に重ねる */
export const markSynced = (synced: CodeSynced, files: CodeFile[]): CodeSynced => ({
  ...synced,
  ...Object.fromEntries(files.map((f) => [f.path, hashText(f.content)])),
})
