import http from 'node:http'
import { config } from './config'

export const SANDBOX_LANGUAGES = ['python'] as const

export type SandboxLanguage = (typeof SANDBOX_LANGUAGES)[number]

/** sandbox（sandbox/server.py）が受け付ける上限。UTF-8 でのバイト数 */
export const MAX_CODE_BYTES = 64 * 1024
export const MAX_STDIN_BYTES = 32 * 1024

export type RunRequest = { language: SandboxLanguage; code: string; stdin?: string }

/** exited 以外は途中で止まった: 時間切れ / 出力が多すぎる / メモリ不足などで強制終了された */
export const RUN_STATUSES = ['exited', 'timeout', 'output_limit', 'killed'] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

export type RunResult = {
  status: RunStatus
  /** status が exited のときだけ入る */
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

/** コードを実行できなかった（実行した結果のエラーは RunResult に入る）。message はそのまま画面に出せる */
export class SandboxError extends Error {}

// 30 秒より短くしないのは、sandbox が空きを待つ時間（20 秒）と実行の上限（10 秒）の途中で切ってしまうため
const TIMEOUT = 40_000

export const sandboxEnabled = config.sandbox !== null

const isRunResult = (v: unknown): v is RunResult => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    (RUN_STATUSES as readonly unknown[]).includes(r.status) &&
    (r.exitCode === null || typeof r.exitCode === 'number') &&
    typeof r.stdout === 'string' &&
    typeof r.stderr === 'string' &&
    typeof r.durationMs === 'number'
  )
}

// fetch を使わないのは、UNIX ドメインソケットにつなげないため
function post(target: NonNullable<typeof config.sandbox>, path: string, body: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { ...target, path, method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

export async function runCode({ language, code, stdin = '' }: RunRequest): Promise<RunResult> {
  if (!config.sandbox) throw new SandboxError('SANDBOX_URL が設定されていないため、コードを実行できません')
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new SandboxError('コードが長すぎるため、実行できません')
  if (Buffer.byteLength(stdin) > MAX_STDIN_BYTES) throw new SandboxError('入力が長すぎるため、実行できません')
  let res: { status: number; body: string }
  try {
    res = await post(config.sandbox, '/run', JSON.stringify({ language, code, stdin }))
  } catch (e) {
    console.error('[sandbox]', e)
    throw new SandboxError('実行環境に接続できません')
  }
  if (res.status === 503) throw new SandboxError('実行環境が混み合っています。少し待ってからもう一度お試しください')
  let result: unknown = null
  try {
    result = JSON.parse(res.body)
  } catch {}
  if (res.status !== 200 || !isRunResult(result)) {
    console.error('[sandbox]', res.status, res.body.slice(0, 200))
    throw new SandboxError('コードを実行できませんでした')
  }
  return result
}
