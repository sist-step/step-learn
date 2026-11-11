// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は BundleBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/bundle.ts）
import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { formatBytes } from '../../lib/bytes'
import {
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_SIZE,
  VSCODE_EXTENSION_ID,
  bundlePath,
  bundleSize,
  conflictingPath,
  folderNameOf,
  isExcludedPath,
  isInFolder,
  samePath,
  type BundleFile,
  type BundleStore,
} from '../../lib/bundle'
import { claimLaunch, signGrant, signLaunch, verifyGrant } from '../../lib/bundle-token'
import { config } from '../../lib/config'
import type { CourseAccess } from '../../lib/courses'
import { clientIp, field, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { deleteKeys, inBackground, isExecutable, storage } from '../../lib/storage'
import type { AppEnv } from '../../lib/types'
import { buildZip } from '../../lib/zip'

type C = Context<AppEnv>

export type BundleContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  title: string
  /** 拡張機能に渡すアイテムの識別子。storeOf に渡すと同じ置き場所が返る */
  ref: string
  store: BundleStore
}

export type BundleBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら返す。開けなければ null */
  resolve: (c: C) => Promise<BundleContext | null>
  /** 拡張機能からの要求（ログインのセッションがない）で、ref のアイテムの置き場所を返す。アイテムがなくなっていれば null */
  storeOf: (ref: string) => BundleStore | null
  /** ストレージのキーの先頭。コースを消すときにまとめて消せるよう、コースごとに分ける */
  keyPrefix: (courseId: number) => string
  editUrl: (courseId: number, itemId: number) => string
  itemUrl: (courseId: number, itemId: number) => string
}

const asList = <T,>(v: T | T[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

const serverOrigin = (c: C) => config.appOrigin ?? new URL(c.req.url).origin

export function createBundleHandlers({ resolve, keyPrefix, editUrl, itemUrl }: BundleBackend) {
  async function manage(c: C) {
    const ctx = await resolve(c)
    return ctx?.access.canManage ? ctx : null
  }

  type Upload = { path: string; file: File }

  // 1 つずつ確かめるのは、どのファイルで止めたかを教師に伝えるため
  async function readUploads(c: C): Promise<{ ok: true; uploads: Upload[]; skipped: number } | { ok: false; error: string }> {
    const body = await c.req.parseBody({ all: true })
    const files = asList(body.files).filter((f): f is File => f instanceof File)
    const paths = asList(body.paths).map((p) => (typeof p === 'string' ? p : ''))
    if (!files.length) return { ok: false, error: 'アップロードするファイルを選択してください。' }
    const uploads: Upload[] = []
    let skipped = 0
    for (const [i, file] of files.entries()) {
      const path = bundlePath(paths[i] || file.name)
      if (!path) return { ok: false, error: `「${paths[i] || file.name}」は、ファイルの名前か場所に使えない文字が含まれています。` }
      if (isExcludedPath(path)) {
        skipped++
        continue
      }
      if (await isExecutable(file)) return { ok: false, error: `「${path}」は実行ファイルのため、アップロードできません。` }
      if (uploads.some((u) => samePath(u.path, path))) return { ok: false, error: `「${path}」が 2 つあります。` }
      uploads.push({ path, file })
    }
    return { ok: true, uploads, skipped }
  }

  async function upload(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, itemId, store } = ctx
    const back = editUrl(access.course.id, itemId)
    const read = await readUploads(c)
    if (!read.ok) return redirectWith(c, back, read.error, 'error')
    const { uploads, skipped } = read
    if (!uploads.length)
      return redirectWith(c, back, 'アップロードできるファイルがありませんでした（.git や node_modules などは外しています）。', 'error')

    const kept = store.list().filter((f) => !uploads.some((u) => samePath(u.path, f.path)))
    const paths = [...kept.map((f) => f.path), ...uploads.map((u) => u.path)]
    if (paths.length > MAX_BUNDLE_FILES) return redirectWith(c, back, `ファイルは ${MAX_BUNDLE_FILES} 個までです。`, 'error')
    if (bundleSize(kept) + uploads.reduce((sum, u) => sum + u.file.size, 0) > MAX_BUNDLE_SIZE)
      return redirectWith(c, back, `ファイルの合計は ${formatBytes(MAX_BUNDLE_SIZE)} までです。`, 'error')
    const conflict = conflictingPath(paths)
    if (conflict) return redirectWith(c, back, `「${conflict}」は、同じ名前のファイルとフォルダーがぶつかっています。`, 'error')

    const prefix = `${keyPrefix(access.course.id)}bundles/`
    const stored: BundleFile[] = []
    for (const { path, file } of uploads) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const fileKey = `${prefix}${crypto.randomUUID()}`
      await storage.put(fileKey, file, 'application/octet-stream')
      stored.push({ path, fileKey, size: file.size, sha256: sha256(bytes) })
    }
    inBackground(deleteKeys(store.put(stored)))
    const note = skipped ? `（${skipped} 個は配らないファイルとして外しました）` : ''
    return redirectWith(c, back, `${stored.length} 個のファイルをアップロードしました。${note}`)
  }

  async function remove(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, itemId, store } = ctx
    const form = await readForm(c)
    const path = field(form, 'path', 1000)
    const folder = field(form, 'folder', 1000)
    const all = field(form, 'all') === '1'
    if (!path && !folder && !all) return c.notFound()
    const removed = store.remove((p) => all || (!!path && samePath(p, path)) || (!!folder && isInFolder(p, folder)))
    inBackground(deleteKeys(removed))
    const message = all ? 'すべてのファイルを削除しました。' : `「${path || folder}」を削除しました。`
    return redirectWith(c, editUrl(access.course.id, itemId), message, 'info')
  }

  async function download(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const folder = folderNameOf(ctx.title)
    const files = ctx.store.list()
    const entries = await Promise.all(
      files.map(async (f) => ({
        path: `${folder}/${f.path}`,
        data: f.size ? ((await storage.read(f.fileKey, f.size)) ?? new Uint8Array()) : new Uint8Array(),
      })),
    )
    c.header('Content-Type', 'application/zip')
    c.header('Content-Disposition', `attachment;filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`)
    c.header('Cache-Control', 'private, no-store')
    return c.body(new Uint8Array(buildZip(entries)))
  }

  async function launch(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const { access, itemId, title, ref } = ctx
    if (!wantsJson(c)) return c.redirect(itemUrl(access.course.id, itemId), 303)
    const token = signLaunch({ ref, userId: c.var.user!.id, course: access.course.title, title })
    const query = new URLSearchParams({ server: serverOrigin(c), token })
    return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/open?${query}` })
  }

  return { upload, remove, download, launch }
}

export function bundleRoutes(h: ReturnType<typeof createBundleHandlers>) {
  const app = new Hono<AppEnv>()
  app.post('/:id/items/:iid/bundle/files', h.upload)
  app.post('/:id/items/:iid/bundle/files/delete', h.remove)
  app.get('/:id/items/:iid/bundle/zip', h.download)
  app.post('/:id/items/:iid/bundle/launch', h.launch)
  return app
}

/** STEP Learn for VSCode（vscode-extension/）が呼ぶ API。ログインのセッションの代わりに、リンクの鍵と、それと引き換えた鍵で確かめる */
export function vscodeApi({ storeOf }: Pick<BundleBackend, 'storeOf'>) {
  // 上限を付けるのは、ログインしていなくても呼べ、鍵を総当たりで試されないようにするため
  const claimLimit = rateLimiter({ limit: 30, windowSec: 60 })
  const app = new Hono<AppEnv>()

  app.post('/claim', async (c) => {
    const ip = clientIp(c)
    if (claimLimit.retryAfter(ip)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    claimLimit.hit(ip)
    const body: unknown = await c.req.json().catch(() => null)
    const token = typeof body === 'object' && body !== null && 'token' in body && typeof body.token === 'string' ? body.token : ''
    const claims = claimLaunch(token)
    const store = claims && storeOf(claims.ref)
    if (!claims || !store)
      return c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)
    return c.json({
      ref: claims.ref,
      course: claims.course,
      title: claims.title,
      grant: signGrant({ ref: claims.ref, userId: claims.userId }),
      files: store.list().map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    })
  })

  // パスではなく中身のハッシュで指すのは、URL が .md などで終わると開発サーバー（Vite）が自分のファイルとして横取りし、
  // 拡張機能はどのみち受け取った中身をハッシュで確かめるため
  app.get('/files/:sha256{[0-9a-f]{64}}', async (c) => {
    const grant = verifyGrant(c.req.header('authorization')?.replace(/^Bearer /, '') ?? '')
    const store = grant && storeOf(grant.ref)
    if (!store) return c.json({ error: '期限が切れました。STEP Learn の画面からもう一度開いてください。' }, 401)
    const file = store.list().find((f) => f.sha256 === c.req.param('sha256'))
    if (!file) return c.json({ error: 'ファイルが見つかりません。' }, 404)
    const res = await storage.serve(file.fileKey, {
      filename: file.path.split('/').pop()!,
      contentType: 'application/octet-stream',
      inline: false,
    })
    return res ?? c.json({ error: 'ファイルが見つかりません。' }, 404)
  })

  return app
}
