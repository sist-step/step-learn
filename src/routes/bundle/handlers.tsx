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
import {
  MAX_SYNC_FILE_SIZE,
  distributedText,
  parseChanges,
  recordChanges,
  textOf,
  type BundleSyncStore,
  type SyncVersion,
} from '../../lib/bundle-sync'
import { claimLaunch, signGrant, signLaunch, signSync, verifyGrant, verifySync } from '../../lib/bundle-token'
import { config } from '../../lib/config'
import type { CourseAccess } from '../../lib/courses'
import { diffLines } from '../../lib/diff'
import { clientIp, field, intParam, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { deleteKeys, inBackground, isExecutable, storage } from '../../lib/storage'
import type { AppEnv } from '../../lib/types'
import { ZipError, buildZip, listZip, type ZipItem } from '../../lib/zip'
import { SyncHistoryPage, SyncStudentsPage, type SyncFileRow } from './views'

type C = Context<AppEnv>

export type BundleContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  title: string
  /** 拡張機能に渡すアイテムの識別子。storeOf に渡すと同じ置き場所が返る */
  ref: string
  store: BundleStore
  sync: BundleSyncStore
}

export type BundleBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら返す。開けなければ null */
  resolve: (c: C) => Promise<BundleContext | null>
  /** 拡張機能からの要求（ログインのセッションがない）で、userId の人が使う ref のアイテムの置き場所を返す。アイテムがなくなっていれば null */
  itemOf: (ref: string, userId: number) => Promise<Pick<BundleContext, 'store' | 'sync'> | null>
  /** ストレージのキーの先頭。コースを消すときにまとめて消せるよう、コースごとに分ける */
  keyPrefix: (courseId: number) => string
  editUrl: (courseId: number, itemId: number) => string
  itemUrl: (courseId: number, itemId: number) => string
}

const asList = <T,>(v: T | T[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** zip の中身がすべて 1 つのフォルダーに入っていれば、そのフォルダーを外した場所 */
function withoutWrapper(paths: string[]) {
  const top = paths[0]?.split('/')[0]
  // そのまま置かないのは、フォルダーを圧縮した zip だと学生の PC でフォルダーが 1 段深くなるため（フォルダーを選んだときも、そのフォルダーの名前は外す）
  const wrapped = !!top && paths.every((p) => p.startsWith(`${top}/`))
  return wrapped ? paths.map((p) => p.slice(top.length + 1)) : paths
}

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

const serverOrigin = (c: C) => config.appOrigin ?? new URL(c.req.url).origin

const readStored = (file: BundleFile) => storage.read(file.fileKey, file.size)

const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''

const SYNC_PATH = '/api/vscode/sync'

/** 拡張機能が変更を送る要求か。ログインのセッションがなくても、鍵で本人と確かめられるので、本文の上限を上げてよい */
export const isSyncRequest = (c: Context) => c.req.method === 'POST' && c.req.path === SYNC_PATH && !!verifySync(bearer(c))

export function createBundleHandlers({ resolve, keyPrefix, editUrl, itemUrl }: BundleBackend) {
  async function manage(c: C) {
    const ctx = await resolve(c)
    return ctx?.access.canManage ? ctx : null
  }

  type Upload = { path: string; file: File }
  type Picked = { name: string; file: File }
  type Read<T> = ({ ok: true } & T) | { ok: false; error: string }

  // 書かれた大きさで先に確かめるのは、上限を超える zip を展開してメモリを使わないため
  async function unpack(archive: File): Promise<Read<{ picked: Picked[]; skipped: number }>> {
    let items: ZipItem[]
    try {
      items = await listZip(new Uint8Array(await archive.arrayBuffer()))
    } catch (e) {
      if (e instanceof ZipError) return { ok: false, error: `「${archive.name}」を展開できませんでした。${e.message}` }
      throw e
    }
    const usable = items.filter((i) => !isExcludedPath(i.path.replace(/\\/g, '/')))
    if (usable.length > MAX_BUNDLE_FILES) return { ok: false, error: `ファイルは ${MAX_BUNDLE_FILES} 個までです。` }
    if (bundleSize(usable) > MAX_BUNDLE_SIZE) return { ok: false, error: `ファイルの合計は ${formatBytes(MAX_BUNDLE_SIZE)} までです。` }
    const names = withoutWrapper(usable.map((i) => i.path.replace(/\\/g, '/')))
    const picked: Picked[] = []
    for (const [i, item] of usable.entries()) {
      try {
        picked.push({ name: names[i], file: new File([await item.read()], names[i].split('/').pop()!) })
      } catch (e) {
        if (e instanceof ZipError) return { ok: false, error: `「${archive.name}」の「${item.path}」を展開できませんでした。${e.message}` }
        throw e
      }
    }
    return { ok: true, picked, skipped: items.length - usable.length }
  }

  // 1 つずつ確かめるのは、どのファイルで止めたかを教師に伝えるため
  async function readUploads(c: C): Promise<Read<{ uploads: Upload[]; skipped: number }>> {
    const body = await c.req.parseBody({ all: true })
    const files = asList(body.files).filter((f): f is File => f instanceof File)
    const paths = asList(body.paths).map((p) => (typeof p === 'string' ? p : ''))
    const archives = asList(body.archives).filter((f): f is File => f instanceof File)
    if (!files.length && !archives.length) return { ok: false, error: 'アップロードするファイルを選択してください。' }
    const picked: Picked[] = files.map((file, i) => ({ name: paths[i] || file.name, file }))
    // ブラウザが外した数も足すのは、node_modules などを送らずに済ませつつ、外した数をまとめて伝えるため
    let skipped = typeof body.skipped === 'string' ? Math.min(Math.max(Math.trunc(Number(body.skipped)) || 0, 0), 1_000_000) : 0
    for (const archive of archives) {
      const read = await unpack(archive)
      if (!read.ok) return read
      picked.push(...read.picked)
      skipped += read.skipped
    }
    const uploads: Upload[] = []
    for (const { name, file } of picked) {
      const path = bundlePath(name)
      if (!path) return { ok: false, error: `「${name}」は、ファイルの名前か場所に使えない文字が含まれています。` }
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

  // ---------------------------------------------------------------- データの同期と変更履歴

  async function setSync(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const on = field(await readForm(c), 'sync', 1) === '1'
    ctx.sync.setEnabled(on)
    const message = on
      ? 'データの同期を有効にしました。学生が VS Code で保存した内容が、変更履歴として残ります。'
      : 'データの同期を止めました。これまでの変更履歴は残ります。'
    return redirectWith(c, editUrl(ctx.access.course.id, ctx.itemId), message, on ? 'success' : 'info')
  }

  async function listHistory(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, itemId, title, sync } = ctx
    return c.render(
      <SyncStudentsPage
        access={access}
        item={{ id: itemId, title }}
        itemUrl={itemUrl(access.course.id, itemId)}
        enabled={sync.enabled()}
        rows={sync.listStudents()}
      />,
      { title: `変更履歴 - ${title}` },
    )
  }

  function fileRows(versions: SyncVersion[]): SyncFileRow[] {
    const rows = new Map<string, SyncFileRow>()
    for (const v of versions) {
      const row = rows.get(v.path)
      if (row) row.versions++
      else rows.set(v.path, { path: v.path, versions: 1, deleted: !!v.deleted, latestId: v.id })
    }
    return [...rows.values()].sort((a, b) => a.path.localeCompare(b.path, 'ja'))
  }

  async function showHistory(c: C) {
    const ctx = await resolve(c)
    const studentId = intParam(c, 'uid')
    // 学生に自分の記録を見せるのは、何が先生に見えているかを本人が確かめられるようにするため
    if (!ctx || !studentId || !(ctx.access.canManage || studentId === c.var.user!.id)) return c.notFound()
    const { access, itemId, title, store, sync } = ctx
    const student = sync.findUser(studentId)
    const versions = sync.listVersions(studentId)
    if (!student || !versions.length) return c.notFound()

    // ファイルの場所を URL に入れないのは、開発サーバー（Vite）が .md などで終わる URL を自分のファイルとして横取りするため
    const wanted = Number(c.req.query('v')) || versions[0].id
    // ほかの学生の記録の ID を付けた URL で開けないよう、この学生の記録の中から選ぶ
    const path = versions.find((v) => v.id === wanted)?.path
    const timeline = versions.filter((v) => v.path === path)
    const index = timeline.findIndex((v) => v.id === wanted)
    const chosen = index >= 0 ? sync.getVersion(studentId, wanted) : undefined
    if (!chosen) return c.notFound()
    const previous = timeline[index + 1] && sync.getVersion(studentId, timeline[index + 1].id)
    const before = previous ? textOf(previous) : await distributedText(store.list(), chosen.path, readStored)

    return c.render(
      <SyncHistoryPage
        access={access}
        item={{ id: itemId, title }}
        itemUrl={itemUrl(access.course.id, itemId)}
        student={student}
        files={fileRows(versions)}
        timeline={timeline}
        version={chosen}
        lines={diffLines(before, textOf(chosen))}
        full={c.req.query('view') === 'full'}
        fromDistributed={!previous}
      />,
      { title: `${student.name} さんの変更履歴 - ${title}` },
    )
  }

  return { upload, remove, download, launch, setSync, listHistory, showHistory }
}

export function bundleRoutes(h: ReturnType<typeof createBundleHandlers>) {
  const app = new Hono<AppEnv>()
  app.post('/:id/items/:iid/bundle/files', h.upload)
  app.post('/:id/items/:iid/bundle/files/delete', h.remove)
  app.get('/:id/items/:iid/bundle/zip', h.download)
  app.post('/:id/items/:iid/bundle/launch', h.launch)
  app.post('/:id/items/:iid/bundle/sync', h.setSync)
  app.get('/:id/items/:iid/bundle/history', h.listHistory)
  app.get('/:id/items/:iid/bundle/history/:uid', h.showHistory)
  return app
}

const SYNC_EXPIRED = '同期の期限が切れました。STEP Learn の画面からもう一度開いてください。'

/** STEP Learn for VSCode（vscode-extension/）が呼ぶ API。ログインのセッションの代わりに、リンクの鍵と、それと引き換えた鍵で確かめる */
export function vscodeApi({ itemOf }: Pick<BundleBackend, 'itemOf'>) {
  // 上限を付けるのは、ログインしていなくても呼べ、鍵を総当たりで試されないようにするため
  const claimLimit = rateLimiter({ limit: 30, windowSec: 60 })
  // 拡張機能は保存から数秒待ってまとめて送るので、普通に使っていて届く回数ではない
  const syncLimit = rateLimiter({ limit: 120, windowSec: 60 })
  const app = new Hono<AppEnv>()

  async function syncTarget(c: C) {
    const claims = verifySync(bearer(c))
    const item = claims && (await itemOf(claims.ref, claims.userId))
    // 利用者も確かめるのは、鍵が半年使え、そのあいだに利用者が消されているかもしれないため
    if (!claims || !item?.sync.findUser(claims.userId)) return null
    return { ...item, userId: claims.userId, limitKey: `${claims.ref} ${claims.userId}` }
  }

  app.post('/claim', async (c) => {
    const ip = clientIp(c)
    if (claimLimit.retryAfter(ip)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    claimLimit.hit(ip)
    const body: unknown = await c.req.json().catch(() => null)
    const token = typeof body === 'object' && body !== null && 'token' in body && typeof body.token === 'string' ? body.token : ''
    const claims = claimLaunch(token)
    const item = claims && (await itemOf(claims.ref, claims.userId))
    if (!claims || !item)
      return c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)
    return c.json({
      ref: claims.ref,
      course: claims.course,
      title: claims.title,
      grant: signGrant({ ref: claims.ref, userId: claims.userId }),
      files: item.store.list().map(({ path, size, sha256 }) => ({ path, size, sha256 })),
      // 同期が無効でも鍵を渡すのは、あとから教師が有効にしたときに、学生が画面から開き直さなくても送り始められるようにするため
      sync: { token: signSync({ ref: claims.ref, userId: claims.userId }), enabled: item.sync.enabled() },
    })
  })

  app.get('/sync', async (c) => {
    const target = await syncTarget(c)
    if (!target) return c.json({ error: SYNC_EXPIRED }, 401)
    return c.json({ enabled: target.sync.enabled(), maxFileSize: MAX_SYNC_FILE_SIZE })
  })

  app.post('/sync', async (c) => {
    const target = await syncTarget(c)
    if (!target) return c.json({ error: SYNC_EXPIRED }, 401)
    if (!target.sync.enabled()) return c.json({ enabled: false, recorded: 0, full: false })
    if (syncLimit.retryAfter(target.limitKey)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    syncLimit.hit(target.limitKey)
    const changes = parseChanges(await c.req.json().catch(() => null))
    if (!changes) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    const result = await recordChanges(target.sync, target.userId, changes, target.store.list(), readStored)
    return c.json({ enabled: true, ...result })
  })

  // パスではなく中身のハッシュで指すのは、URL が .md などで終わると開発サーバー（Vite）が自分のファイルとして横取りし、
  // 拡張機能はどのみち受け取った中身をハッシュで確かめるため
  app.get('/files/:sha256{[0-9a-f]{64}}', async (c) => {
    const grant = verifyGrant(bearer(c))
    const store = grant && (await itemOf(grant.ref, grant.userId))?.store
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
