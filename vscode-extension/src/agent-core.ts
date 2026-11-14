// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは agent-view.ts）
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isExcluded } from './history'
import { SyncError } from './sync'

// ---------------------------------------------------------------- STEP Learn とのやり取り

/** STEP Learn の lib/ai-models.ts の AiToolCall と同じ形。arguments はモデルが書いた JSON の文字列 */
export type AgentToolCall = { id: string; name: string; arguments: string }

/** STEP Learn の lib/ai-models.ts の AiMessage（system を除く）と同じ形。native は受け取ったまま送り返す */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: AgentToolCall[]; native?: unknown }
  | { role: 'tool'; toolCallId: string; content: string; isError: boolean }

export type AgentReply = { text: string; toolCalls: AgentToolCall[]; stop: string; native?: unknown }

export type AgentStatus = {
  state: string
  /** サイドバーに出してよいか（使える期間のあいだ） */
  open: boolean
  message: string
  course: string
  title: string
  model: string
  opensAt: number | null
  closesAt: number | null
  /** 本人が使った割合（0〜100） */
  usage: number
  contextLimit: number
}

export type AgentGrant = { ref: string; course: string; title: string; user: { id: number; name: string }; token: string }

/** トークンが使えなくなった（アイテムが消えた・コースから外れた・ほかの PC で作り直して古くなった） */
export class AgentTokenError extends SyncError {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const UNREACHABLE = 'STEP Learn に接続できませんでした。ネットワークを確かめてください。'

async function failure(res: Response) {
  const body: unknown = await res.json().catch(() => null)
  const message = isObject(body) && typeof body.error === 'string' ? body.error : `STEP Learn に接続できませんでした（${res.status}）。`
  return res.status === 401 ? new AgentTokenError(message) : new SyncError(message)
}

const call = (url: URL, init: RequestInit) =>
  fetch(url, init).catch((e: unknown) => {
    if (init.signal?.aborted) throw e
    throw new SyncError(UNREACHABLE)
  })

/** リンクの鍵を、コーディングエージェントのトークンに引き換える */
export async function claimAgent(server: URL, launchToken: string): Promise<AgentGrant> {
  const res = await call(new URL('/api/vscode/agent/claim', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  })
  if (!res.ok) throw await failure(res)
  const body: unknown = await res.json()
  if (
    !isObject(body) ||
    typeof body.ref !== 'string' ||
    typeof body.course !== 'string' ||
    typeof body.title !== 'string' ||
    typeof body.token !== 'string' ||
    !isObject(body.user) ||
    typeof body.user.id !== 'number' ||
    typeof body.user.name !== 'string'
  )
    throw new SyncError('STEP Learn から受け取った内容が正しくありません。')
  return { ref: body.ref, course: body.course, title: body.title, token: body.token, user: { id: body.user.id, name: body.user.name } }
}

const authorized = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' })

export async function fetchAgentStatus(server: URL, token: string): Promise<AgentStatus> {
  const res = await call(new URL('/api/vscode/agent/status', server), { headers: authorized(token) })
  if (!res.ok) throw await failure(res)
  const body: unknown = await res.json()
  if (!isObject(body) || typeof body.state !== 'string' || typeof body.open !== 'boolean')
    throw new SyncError('STEP Learn から受け取った内容が正しくありません。')
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    state: body.state,
    open: body.open,
    message: text(body.message),
    course: text(body.course),
    title: text(body.title),
    model: text(body.model),
    opensAt: num(body.opensAt),
    closesAt: num(body.closesAt),
    usage: num(body.usage) ?? 0,
    contextLimit: num(body.contextLimit) ?? 80_000,
  }
}

export const revokeAgent = (server: URL, token: string) =>
  call(new URL('/api/vscode/agent/revoke', server), { method: 'POST', headers: authorized(token) }).then(
    () => undefined,
    () => undefined,
  )

export type AgentTurn = { reply: AgentReply; contextTokens: number; usage: number }

function parseTurn(event: Record<string, unknown>): AgentTurn {
  const reply = isObject(event.reply) ? event.reply : {}
  const toolCalls = Array.isArray(reply.toolCalls)
    ? reply.toolCalls.filter(
        (c): c is AgentToolCall => isObject(c) && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.arguments === 'string',
      )
    : []
  return {
    reply: {
      text: typeof reply.text === 'string' ? reply.text : '',
      toolCalls,
      stop: typeof reply.stop === 'string' ? reply.stop : 'end',
      native: reply.native,
    },
    contextTokens: typeof event.contextTokens === 'number' ? event.contextTokens : 0,
    usage: typeof event.usage === 'number' ? event.usage : 0,
  }
}

/** 会話を送り、応答を 1 回受け取る。本文は届くたびに onText に渡す */
export async function sendAgentMessages(
  server: URL,
  token: string,
  body: { messages: AgentMessage[]; platform: string },
  { onText, signal }: { onText: (text: string) => void; signal: AbortSignal },
): Promise<AgentTurn> {
  const res = await call(new URL('/api/vscode/agent/messages', server), {
    method: 'POST',
    headers: { ...authorized(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw await failure(res)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event: unknown = JSON.parse(line)
      if (!isObject(event)) continue
      if (event.type === 'text' && typeof event.text === 'string') onText(event.text)
      else if (event.type === 'done') return parseTurn(event)
      else if (event.type === 'error')
        throw new SyncError(typeof event.message === 'string' ? event.message : 'AI の応答を受け取れませんでした。')
    }
    if (done) throw new SyncError('AI の応答が途中で切れました。もう一度お試しください。')
  }
}

// ---------------------------------------------------------------- ツール

/** ツールを実行した結果。content は AI に返す文字列、summary は画面に出す短い説明 */
export type ToolResult = { content: string; isError: boolean; summary: string; file?: string }

/** VS Code とつなぐところ。開いているエディターの書きかけの内容を読み書きし、コマンドの実行を学生に確かめる */
export type ToolHost = {
  /** エディターで開いていて保存していない内容。なければ undefined（ファイルから読む） */
  unsaved: (file: string) => string | undefined
  write: (file: string, content: string) => Promise<void>
  confirm: (command: string, reason: string) => Promise<boolean>
  signal: AbortSignal
}

class ToolError extends Error {}

const MAX_LIST = 400
const MAX_DEPTH = 6
const MAX_READ_BYTES = 256 * 1024
const MAX_READ_LINES = 1500
const MAX_SEARCH_FILES = 3000
const MAX_SEARCH_RESULTS = 100
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const MAX_WRITE_SIZE = 1024 * 1024
const MAX_OUTPUT = 20_000
const COMMAND_TIMEOUT = 60_000

const SHELLS: Partial<Record<NodeJS.Platform, string>> = { win32: 'powershell.exe', darwin: '/bin/zsh', linux: '/bin/sh' }

function argsOf(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ToolError('引数の JSON を読み取れませんでした。')
  }
  if (!isObject(parsed)) throw new ToolError('引数が正しくありません。')
  return parsed
}

const stringArg = (args: Record<string, unknown>, key: string) => {
  const v = args[key]
  if (typeof v !== 'string') throw new ToolError(`${key} を文字列で指定してください。`)
  return v
}

const optionalString = (args: Record<string, unknown>, key: string) => (args[key] === undefined ? undefined : stringArg(args, key))

const lineArg = (args: Record<string, unknown>, key: string) => {
  const v = args[key]
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new ToolError(`${key} は 1 以上の整数にしてください。`)
  return v
}

/** 長い出力の真ん中を省く。頭と末尾のどちらにも大事な内容（エラーの場所と最後のメッセージ）があるため */
export function truncateMiddle(text: string, max = MAX_OUTPUT) {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n…（${text.length - max} 文字を省きました）…\n${text.slice(-half)}`
}

export const withLineNumbers = (lines: string[], first: number) => {
  const width = String(first + lines.length - 1).length
  return lines.map((l, i) => `${String(first + i).padStart(width)}| ${l}`).join('\n')
}

/** old を new に置き換えた中身。見つからないか、replaceAll でないのに複数あれば ToolError */
export function replaceText(content: string, oldText: string, newText: string, replaceAll: boolean) {
  if (!oldText) throw new ToolError('old_text が空です。')
  const count = content.split(oldText).length - 1
  if (count === 0) throw new ToolError('old_text がファイルの中に見つかりませんでした。read_file で今の中身を確かめてください。')
  if (count > 1 && !replaceAll)
    throw new ToolError(`old_text が ${count} か所あります。前後の行も含めて 1 か所に絞るか、replace_all を true にしてください。`)
  return { content: replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, () => newText), count }
}

const lineCount = (s: string) => (s ? s.split('\n').length : 0)

/** root の中で動くツールを実行する。root は VS Code で開いているフォルダー */
export function createToolRunner(root: string, host: ToolHost) {
  async function resolveInside(p: string | undefined) {
    const rel = (p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '')
    if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..'))
      throw new ToolError('開いているフォルダーからの相対パス（/ 区切り、.. を含まない）で指定してください。')
    const target = path.join(root, ...rel.split('/').filter((s) => s && s !== '.'))
    // 一番近い、すでにある親までたどって実際の場所を確かめるのは、シンボリックリンクでフォルダーの外を読み書きしないため
    let existing = target
    while (!(await fs.lstat(existing).catch(() => null))) existing = path.dirname(existing)
    const real = await fs.realpath(existing)
    const realRoot = await fs.realpath(root)
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new ToolError('開いているフォルダーの外は扱えません。')
    return {
      target,
      rel:
        rel
          .split('/')
          .filter((s) => s && s !== '.')
          .join('/') || '.',
    }
  }

  async function readText(target: string, rel: string) {
    const unsaved = host.unsaved(target)
    if (unsaved !== undefined) return unsaved
    const stat = await fs.stat(target).catch(() => null)
    if (!stat?.isFile()) throw new ToolError(`「${rel}」というファイルはありません。`)
    if (stat.size > MAX_READ_BYTES * 4) throw new ToolError(`「${rel}」は大きすぎて読めません。`)
    const bytes = await fs.readFile(target)
    if (bytes.includes(0)) throw new ToolError(`「${rel}」は文字のファイルではありません。`)
    return bytes.toString('utf8')
  }

  async function listFiles(args: Record<string, unknown>): Promise<ToolResult> {
    const { target, rel } = await resolveInside(optionalString(args, 'path'))
    const lines: string[] = []
    async function walk(dir: string, prefix: string, depth: number) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
      if (!entries) throw new ToolError(`「${rel}」というフォルダーはありません。`)
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      for (const e of entries) {
        if (lines.length >= MAX_LIST) return
        const p = prefix ? `${prefix}/${e.name}` : e.name
        if (isExcluded(p)) continue
        if (e.isDirectory()) {
          lines.push(`${p}/`)
          if (depth < MAX_DEPTH) await walk(path.join(dir, e.name), p, depth + 1)
        } else if (e.isFile()) lines.push(p)
      }
    }
    await walk(target, rel === '.' ? '' : rel, 1)
    const more = lines.length >= MAX_LIST ? `\n…（${MAX_LIST} 件で打ち切りました。path でフォルダーを絞ってください）` : ''
    return { content: (lines.join('\n') || '（空のフォルダー）') + more, isError: false, summary: `「${rel}」の一覧を見ました` }
  }

  async function readFile(args: Record<string, unknown>): Promise<ToolResult> {
    const { target, rel } = await resolveInside(stringArg(args, 'path'))
    const all = (await readText(target, rel)).split('\n')
    const start = lineArg(args, 'start_line') ?? 1
    const end = Math.min(lineArg(args, 'end_line') ?? all.length, all.length, start + MAX_READ_LINES - 1)
    const body = withLineNumbers(all.slice(start - 1, end), start)
    const rest = end < all.length ? `\n…（全 ${all.length} 行のうち ${end} 行目まで。続きは start_line で指定してください）` : ''
    return { content: body + rest, isError: false, summary: `「${rel}」を読みました`, file: rel }
  }

  async function searchText(args: Record<string, unknown>): Promise<ToolResult> {
    const query = stringArg(args, 'query')
    if (!query) throw new ToolError('query が空です。')
    const { target, rel } = await resolveInside(optionalString(args, 'path'))
    const needle = query.toLowerCase()
    const hits: string[] = []
    let scanned = 0
    async function walk(dir: string, prefix: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (hits.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCH_FILES) return
        const p = prefix ? `${prefix}/${e.name}` : e.name
        if (isExcluded(p)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walk(full, p)
        else if (e.isFile()) {
          scanned++
          const stat = await fs.stat(full).catch(() => null)
          if (!stat || stat.size > MAX_SEARCH_FILE_SIZE) continue
          const bytes = await fs.readFile(full).catch(() => null)
          if (!bytes || bytes.includes(0)) continue
          bytes
            .toString('utf8')
            .split('\n')
            .forEach((line, i) => {
              if (hits.length < MAX_SEARCH_RESULTS && line.toLowerCase().includes(needle))
                hits.push(`${p}:${i + 1}: ${line.trim().slice(0, 200)}`)
            })
        }
      }
    }
    await walk(target, rel === '.' ? '' : rel)
    return {
      content: hits.length ? hits.join('\n') : '見つかりませんでした。',
      isError: false,
      summary: `「${query}」を探しました（${hits.length} 件）`,
    }
  }

  async function writeFile(args: Record<string, unknown>): Promise<ToolResult> {
    const { target, rel } = await resolveInside(stringArg(args, 'path'))
    const content = stringArg(args, 'content')
    if (Buffer.byteLength(content) > MAX_WRITE_SIZE) throw new ToolError('中身が大きすぎます。')
    const stat = await fs.lstat(target).catch(() => null)
    if (stat && !stat.isFile()) throw new ToolError(`「${rel}」はファイルではありません。`)
    await host.write(target, content)
    return {
      content: `「${rel}」に書き込みました（${lineCount(content)} 行）。`,
      isError: false,
      summary: `${stat ? '「' + rel + '」を書き直しました' : '「' + rel + '」を作りました'}（${lineCount(content)} 行）`,
      file: rel,
    }
  }

  async function editFile(args: Record<string, unknown>): Promise<ToolResult> {
    const { target, rel } = await resolveInside(stringArg(args, 'path'))
    const oldText = stringArg(args, 'old_text')
    const newText = stringArg(args, 'new_text')
    const before = await readText(target, rel)
    const { content, count } = replaceText(before, oldText, newText, args.replace_all === true)
    await host.write(target, content)
    const added = lineCount(newText) * count
    const removed = lineCount(oldText) * count
    return {
      content: `「${rel}」の ${count} か所を置き換えました。`,
      isError: false,
      summary: `「${rel}」を書き換えました（+${added} −${removed}）`,
      file: rel,
    }
  }

  async function runCommand(args: Record<string, unknown>): Promise<ToolResult> {
    const command = stringArg(args, 'command').trim()
    const reason = optionalString(args, 'reason') ?? ''
    if (!command) throw new ToolError('command が空です。')
    if (!(await host.confirm(command, reason)))
      return { content: '学生がこのコマンドの実行を許可しませんでした。', isError: true, summary: `実行しませんでした: ${command}` }
    const output = await new Promise<{ code: number | null; text: string; timedOut: boolean }>((resolve) => {
      const child = exec(
        command,
        { cwd: root, timeout: COMMAND_TIMEOUT, maxBuffer: 4 * 1024 * 1024, shell: SHELLS[process.platform], windowsHide: true },
        (error, stdout, stderr) => {
          const timedOut = !!error && 'killed' in error && error.killed === true
          const code = error ? (typeof error.code === 'number' ? error.code : null) : 0
          resolve({ code, text: [stdout, stderr].filter(Boolean).join('\n'), timedOut })
        },
      )
      host.signal.addEventListener('abort', () => child.kill(), { once: true })
    })
    const head = output.timedOut
      ? `${COMMAND_TIMEOUT / 1000} 秒たっても終わらなかったため止めました。`
      : `終了コード: ${output.code ?? '不明'}`
    return {
      content: `${head}\n--- 出力 ---\n${truncateMiddle(output.text) || '（出力なし）'}`,
      isError: output.code !== 0,
      summary: `実行しました: ${command}（${output.timedOut ? '時間切れ' : `終了コード ${output.code ?? '不明'}`}）`,
    }
  }

  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
    list_files: listFiles,
    read_file: readFile,
    search_text: searchText,
    write_file: writeFile,
    edit_file: editFile,
    run_command: runCommand,
  }

  return async function run(call: AgentToolCall): Promise<ToolResult> {
    const tool = tools[call.name]
    if (!tool) return { content: `${call.name} というツールはありません。`, isError: true, summary: `使えないツール: ${call.name}` }
    try {
      return await tool(argsOf(call.arguments))
    } catch (e) {
      if (e instanceof ToolError) return { content: e.message, isError: true, summary: e.message }
      const message = e instanceof Error ? e.message : String(e)
      return { content: `失敗しました: ${message}`, isError: true, summary: `失敗しました: ${message}` }
    }
  }
}
