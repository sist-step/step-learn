import { AwsClient } from 'aws4fetch'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { config } from './config'

// 教材ファイルの保存先。開発はローカルディスク、本番は R2（S3 互換 API）。
// キーは courses/{courseId}/{random}/{filename} の形にして、コース削除時に prefix 単位で消せるようにしている。

export const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30MB

export const FILE_TOO_LARGE = `ファイルサイズは ${formatBytes(MAX_FILE_SIZE)} までです。`

export const EXECUTABLE_NOT_ALLOWED = '実行ファイル（.exe など）はアップロードできません。'

// .js・.sh・.py などのスクリプトを含めないのは、プログラミングの授業で教材として配るため
const EXECUTABLE_NAME =
  /\.(exe|dll|com|scr|pif|cpl|msi|msp|msix|msixbundle|appx|appxbundle|bat|cmd|vbs|vbe|jse|wsf|wsh|hta|lnk|reg|apk|dmg|pkg|command)$/i

const startsWith = (bytes: Uint8Array, magic: number[], at = 0) => magic.every((b, i) => bytes[at + i] === b)

// 拡張子だけで判定しないのは、名前を変えた実行ファイルも止めるため
export async function isExecutable(file: File) {
  if (EXECUTABLE_NAME.test(file.name)) return true
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  // 先頭の "MZ" だけで決めないのは、たまたま MZ で始まるテキストまで止めてしまうため
  if (startsWith(head, [0x4d, 0x5a]) && head.length >= 0x40) {
    const peOffset = new DataView(head.buffer).getUint32(0x3c, true)
    if (startsWith(head, [0x50, 0x45, 0, 0], peOffset)) return true
  }
  const elf = [0x7f, 0x45, 0x4c, 0x46]
  const machO = [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
  ]
  if (startsWith(head, elf) || machO.some((m) => startsWith(head, m))) return true
  // Java の .class も CAFEBABE で始まるので、続く値（Mach-O は CPU の数、Java は 45 以上のバージョン）で見分ける
  const universal = startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) || startsWith(head, [0xca, 0xfe, 0xba, 0xbf])
  return universal && head.length >= 8 && new DataView(head.buffer).getUint32(4) < 45
}

export type StoredFile = { key: string; name: string; size: number; type: string }
export type ServeOptions = { filename: string; contentType: string; inline: boolean; range?: string }

interface Storage {
  put(key: string, file: File, contentType: string): Promise<void>
  delete(keys: string[]): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  /** ダウンロード用のレスポンス。R2 では署名付き URL へのリダイレクトを返し、Node を経由させない */
  serve(key: string, opts: ServeOptions): Promise<Response | null>
  /** 先頭から最大 maxBytes を読む（テキストのプレビュー用） */
  read(key: string, maxBytes: number): Promise<Uint8Array | null>
}

// 署名付き URL のクエリに載せるため空白を含めない（"+" と "%20" の解釈差で署名がずれるのを避ける）
const disposition = ({ filename, inline }: ServeOptions) =>
  `${inline ? 'inline' : 'attachment'};filename*=UTF-8''${encodeURIComponent(filename)}`

// アップロードされた HTML/SVG などを同一オリジンで実行させないため、
// インライン表示は呼び出し側でブラウザが中身を実行しない種類（PDF・ラスタ画像・動画・音声）に限り、
// それ以外は octet-stream の添付として返す。
const servedType = (opts: ServeOptions) => (opts.inline ? opts.contentType : 'application/octet-stream')

// 複数範囲の指定は使うブラウザがないので、解釈せずに全体を返す
function byteRange(header: string | undefined, size: number) {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (!m[1] && !m[2])) return null
  const start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0)
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  return start > end || start >= size ? 'unsatisfiable' : { start, end }
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private file(key: string) {
    const p = path.resolve(this.root, key)
    if (!p.startsWith(this.root + path.sep)) throw new Error('invalid storage key')
    return p
  }

  async put(key: string, file: File) {
    const p = this.file(key)
    await fs.promises.mkdir(path.dirname(p), { recursive: true })
    await fs.promises.writeFile(p, Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream))
  }

  async delete(keys: string[]) {
    await Promise.all(keys.map((k) => fs.promises.rm(this.file(k), { force: true })))
  }

  async deletePrefix(prefix: string) {
    await fs.promises.rm(this.file(prefix.replace(/\/$/, '')), { recursive: true, force: true })
  }

  async serve(key: string, opts: ServeOptions) {
    const p = this.file(key)
    const stat = await fs.promises.stat(p).catch(() => null)
    if (!stat) return null
    const headers = {
      'Content-Type': servedType(opts),
      'Content-Disposition': disposition(opts),
      ...(opts.inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    }
    const range = byteRange(opts.range, stat.size)
    if (range === 'unsatisfiable')
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } })
    const { start, end } = range ?? { start: 0, end: stat.size - 1 }
    const body = stat.size === 0 ? null : (Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream)
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        ...(range && { 'Content-Range': `bytes ${start}-${end}/${stat.size}` }),
      },
    })
  }

  async read(key: string, maxBytes: number) {
    const handle = await fs.promises.open(this.file(key)).catch(() => null)
    if (!handle) return null
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(maxBytes), 0, maxBytes, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }
}

class R2Storage implements Storage {
  private client: AwsClient
  private base: string

  constructor(r2: NonNullable<typeof config.r2>) {
    this.client = new AwsClient({
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    this.base = `https://${r2.accountId}.r2.cloudflarestorage.com/${r2.bucket}`
  }

  private url(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  private async send(url: string, init?: RequestInit) {
    const res = await this.client.fetch(url, init)
    if (!res.ok && res.status !== 404) throw new Error(`R2 ${init?.method ?? 'GET'} ${res.status}: ${await res.text()}`)
    return res
  }

  async put(key: string, file: File, contentType: string) {
    await this.send(this.url(key), {
      method: 'PUT',
      body: await file.arrayBuffer(),
      headers: { 'Content-Type': contentType },
    })
  }

  async delete(keys: string[]) {
    // 少数ずつ並列に削除（教材ファイルは 1 コースあたり多くても数百件程度）
    for (let i = 0; i < keys.length; i += 10) {
      await Promise.all(keys.slice(i, i + 10).map((k) => this.send(this.url(k), { method: 'DELETE' })))
    }
  }

  async deletePrefix(prefix: string) {
    let token: string | undefined
    do {
      const q = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) })
      const xml = await (await this.send(`${this.base}?${q}`)).text()
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => unescapeXml(m[1]))
      await this.delete(keys)
      token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
    } while (token)
  }

  async serve(key: string, opts: ServeOptions) {
    const url = new URL(this.url(key))
    // 動画・音声はシークのたびに署名付き URL へ Range で取り直すので、視聴の途中で期限が切れないよう長めにする
    url.searchParams.set('X-Amz-Expires', opts.inline ? '3600' : '300')
    url.searchParams.set('response-content-type', servedType(opts))
    url.searchParams.set('response-content-disposition', disposition(opts))
    const signed = await this.client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })
    return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'private, no-store' } })
  }

  async read(key: string, maxBytes: number) {
    const res = await this.send(this.url(key), { headers: { Range: `bytes=0-${maxBytes - 1}` } })
    return res.status === 404 ? null : new Uint8Array(await res.arrayBuffer())
  }
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

export const storage: Storage = config.r2 ? new R2Storage(config.r2) : new LocalStorage(path.resolve(config.filesDir))

const safeName = (name: string) => name.replace(/[\\/\p{Cc}]/gu, '_').slice(-120) || 'file'

export async function putCourseFile(courseId: number, file: File): Promise<StoredFile> {
  const name = safeName(file.name)
  const key = `courses/${courseId}/${crypto.randomUUID()}/${name}`
  const type = file.type || 'application/octet-stream'
  await storage.put(key, file, type)
  return { key, name, size: file.size, type }
}

export const deleteKeys = (keys: (string | null | undefined)[]) => storage.delete(keys.filter((k): k is string => !!k))

export const deleteCourseFiles = (courseId: number) => storage.deletePrefix(`courses/${courseId}/`)

/** レスポンスを待たせない後片付け（失敗してもログだけ残す） */
export function inBackground(task: Promise<unknown>) {
  task.catch((e) => console.error('[background]', e))
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
