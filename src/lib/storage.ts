import { AwsClient } from 'aws4fetch'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { config } from './config'

// 教材ファイルの保存先。開発はローカルディスク、本番は R2（S3 互換 API）。
// キーは courses/{courseId}/{random}/{filename} の形にして、コース削除時に prefix 単位で消せるようにしている。

export const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30MB

export type StoredFile = { key: string; name: string; size: number; type: string }
export type ServeOptions = { filename: string; contentType: string; inline: boolean }

interface Storage {
  put(key: string, file: File, contentType: string): Promise<void>
  delete(keys: string[]): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  /** ダウンロード用のレスポンス。R2 では署名付き URL へのリダイレクトを返し、Node を経由させない */
  serve(key: string, opts: ServeOptions): Promise<Response | null>
}

// 署名付き URL のクエリに載せるため空白を含めない（"+" と "%20" の解釈差で署名がずれるのを避ける）
const disposition = ({ filename, inline }: ServeOptions) =>
  `${inline ? 'inline' : 'attachment'};filename*=UTF-8''${encodeURIComponent(filename)}`

// アップロードされた HTML/SVG などを同一オリジンで実行させないため、
// インライン表示は呼び出し側で PDF とラスタ画像に限り、それ以外は octet-stream の添付として返す。
const servedType = (opts: ServeOptions) => (opts.inline ? opts.contentType : 'application/octet-stream')

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
    const body = Readable.toWeb(fs.createReadStream(p)) as ReadableStream
    return new Response(body, {
      headers: {
        'Content-Type': servedType(opts),
        'Content-Length': String(stat.size),
        'Content-Disposition': disposition(opts),
        ...(opts.inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    })
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
    url.searchParams.set('X-Amz-Expires', '300')
    url.searchParams.set('response-content-type', servedType(opts))
    url.searchParams.set('response-content-disposition', disposition(opts))
    const signed = await this.client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })
    return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'private, no-store' } })
  }
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export const storage: Storage = config.r2 ? new R2Storage(config.r2) : new LocalStorage(path.resolve(config.filesDir))

const safeName = (name: string) => name.replace(/[\\/\x00-\x1f]/g, '_').slice(-120) || 'file'

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
