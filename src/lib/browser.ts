import { buildWebDocument, type CodeFiles } from './code'
import { config } from './config'
import { postToContainer } from './sandbox'

/** browser のコンテナ（browser/server.mjs）が返す、Web の提出を開いたときの記録 */
export type WebRecord = {
  /** ok 以外は途中まで: 時間内に終わらなかった / Chromium が止まった */
  status: 'ok' | 'timeout' | 'error'
  views: { width: number; height: number; title: string; overflowX: boolean; lines: string[]; total: number }[]
  /** 開いてから 1 秒の間に、何もしなくても変わったところ */
  timeline: string[]
  hovers: { target: string; changes: string[] }[]
  clicks: { target: string; changes: string[]; notes: string[]; console: string[] }[]
  console: { level: 'log' | 'warn' | 'error'; text: string }[]
  notes: string[]
  durationMs: number
}

/** 記録を取れなかった（コンテナにつながらない・混んでいる）。採点はコードだけで続ける */
export class BrowserError extends Error {}

// 40 秒より短くしないのは、コンテナが空きを待つ時間（20 秒）と 1 回の実行の上限（20 秒）の途中で切ってしまうため
const TIMEOUT = 45_000
/** AI に渡す記録の長さの上限。長い提出で入力のトークンが増えすぎないようにする */
const MAX_RECORD_LENGTH = 9000

export const browserEnabled = config.browser !== null

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

const isWebRecord = (v: unknown): v is WebRecord => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    (r.status === 'ok' || r.status === 'timeout' || r.status === 'error') &&
    Array.isArray(r.views) &&
    r.views.every((view: Record<string, unknown>) => typeof view.width === 'number' && isStrings(view.lines)) &&
    isStrings(r.timeline) &&
    Array.isArray(r.hovers) &&
    Array.isArray(r.clicks) &&
    Array.isArray(r.console) &&
    isStrings(r.notes)
  )
}

/** Web の提出を browser のコンテナで開き、画面の様子と操作したときの変化を記録する */
export async function recordWeb(files: CodeFiles): Promise<WebRecord> {
  if (!config.browser) throw new BrowserError('BROWSER_URL が設定されていません')
  let res: { status: number; body: string }
  try {
    res = await postToContainer(config.browser, '/render', JSON.stringify({ html: buildWebDocument(files) }), TIMEOUT)
  } catch (e) {
    console.error('[browser]', e)
    throw new BrowserError('実行環境に接続できません')
  }
  if (res.status === 503) throw new BrowserError('実行環境が混み合っています')
  let record: unknown = null
  try {
    record = JSON.parse(res.body)
  } catch {}
  if (res.status !== 200 || !isWebRecord(record)) {
    console.error('[browser]', res.status, res.body.slice(0, 200))
    throw new BrowserError('提出を開けませんでした')
  }
  return record
}

const STATUS_LABELS: Record<WebRecord['status'], string> = {
  ok: '最後まで確かめた',
  timeout: '時間内に終わらなかった（無限ループなどで止まった可能性がある。ここにあるのは途中までの記録）',
  error: '途中で止まった（ここにあるのは途中までの記録）',
}

const withoutRect = (line: string) => line.replace(/ \[\d+,\d+ \d+x\d+\]/, '')

/** 記録を AI に渡す文章にする。狭い画面は、広い画面と違う要素だけを書く */
export function describeWebRecord(record: WebRecord) {
  const parts = [`状態: ${STATUS_LABELS[record.status]}`]
  const [wide, narrow] = record.views
  if (wide) {
    parts.push(
      `■ 幅 ${wide.width}px の画面で開いたときの要素（[x,y 幅x高さ] は場所と大きさ、{} は計算後のスタイル）`,
      ...wide.lines,
      `横にはみ出す: ${wide.overflowX ? 'はい' : 'いいえ'}`,
    )
  }
  if (wide && narrow) {
    const same = narrow.lines.length === wide.lines.length
    const changed = same ? narrow.lines.filter((line, i) => withoutRect(line) !== withoutRect(wide.lines[i])) : narrow.lines
    parts.push(
      `■ 幅 ${narrow.width}px の画面で開いたとき、${same ? 'スタイルが幅 ' + wide.width + 'px と違う要素（場所と大きさは幅に合わせて変わる）' : 'の要素'}`,
      ...(changed.length ? changed : ['（スタイルの違いはない）']),
      `横にはみ出す: ${narrow.overflowX ? 'はい' : 'いいえ'}`,
    )
  }
  if (record.timeline.length) parts.push('■ 開いてから 1 秒の間に、何もしなくても変わったところ', ...record.timeline)
  if (record.hovers.length) {
    parts.push(
      '■ :hover を書いた要素にマウスを乗せたときの変化',
      ...record.hovers.map((h) => `- ${h.target}: ${h.changes.length ? h.changes.join('、') : '見た目は変わらない'}`),
    )
  }
  if (record.clicks.length) {
    parts.push('■ 押せる要素を上から順に押したときの変化（押すと現れた要素も押し、変化があった要素は 2 回まで押す）')
    record.clicks.forEach((click, i) => {
      parts.push(`${i + 1}. ${click.target} を押す`)
      const lines = [...click.changes, ...click.notes.map((n) => `（${n}）`), ...click.console.map((c) => `コンソール ${c}`)]
      parts.push(...(lines.length ? lines.map((l) => `   ${l}`) : ['   変化なし']))
    })
  }
  const errors = record.console.filter((c) => c.level !== 'log')
  if (errors.length) parts.push('■ コンソールのエラーと警告', ...errors.map((c) => `${c.level}: ${c.text}`))
  if (record.notes.length) parts.push('■ そのほか', ...record.notes)
  const text = parts.join('\n')
  return text.length > MAX_RECORD_LENGTH ? `${text.slice(0, MAX_RECORD_LENGTH)}\n（長いので、ここから先は省いた）` : text
}
