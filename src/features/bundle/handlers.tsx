// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は BundleBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/bundle.ts）
import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { MAX_BUNDLE_FILES, MAX_BUNDLE_SIZE, VSCODE_EXTENSION_ID, type BundleFile, type BundleStore } from './bundle'
import {
  MAX_SYNC_FILE_SIZE,
  SYNC_REQUEST,
  distributedText,
  recordChanges,
  textOf,
  type BundleSyncStore,
  type SyncVersion,
} from './bundle-sync'
import { launchClaimer, linkExpired, signToken, tooManyRequests, verifyBearer } from '../../lib/vscode-token'
import type { CourseAccess } from '../../lib/courses'
import { diffLines } from '../../lib/diff'
import { appOrigin, intParam, readFields, readJson, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { deleteKeys, inBackground, storage } from '../../lib/storage'
import { readTreeRemove, readTreeUploads, treeUploadProblem, treeZip } from '../../lib/tree-upload'
import type { AppEnv } from '../../lib/types'
import { SyncHistoryPage, SyncStudentsPage, type SyncFileRow } from './views'

type C = Context<AppEnv>

type BundleContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  title: string
  /** 拡張機能に渡すアイテムの識別子。itemOf に渡すと同じ置き場所が返る */
  ref: string
  store: BundleStore
  sync: BundleSyncStore
}

export type BundleBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら返す。開けなければ null */
  resolve: (c: C) => Promise<BundleContext | null>
  /** 拡張機能からの要求（ログインのセッションがない）で、userId の人が使う ref のアイテムの置き場所を返す。今は開けない（アイテムがない・コースから外れた・非表示）なら null */
  itemOf: (ref: string, userId: number) => Promise<Pick<BundleContext, 'store' | 'sync'> | null>
  /**
   * 半年使える鍵（同期・コード）に入れる、userId の人の今の印。印が変わると、それより前に渡した鍵は使えない。
   * Moodle モードは使うたびに Moodle のトークンで権限を確かめ直すので、渡さない
   */
  stampOf?: (userId: number) => string | undefined
  /** ストレージのキーの先頭。コースを消すときにまとめて消せるよう、コースごとに分ける */
  keyPrefix: (courseId: number) => string
  editUrl: (courseId: number, itemId: number) => string
  itemUrl: (courseId: number, itemId: number) => string
}

const LIMITS = { maxFiles: MAX_BUNDLE_FILES, maxSize: MAX_BUNDLE_SIZE }

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

const readStored = (file: BundleFile) => storage.read(file.fileKey, file.size)

const SYNC_PATH = '/api/vscode/sync'

/** 拡張機能が変更を送る要求か。ログインのセッションがなくても、鍵で本人と確かめられるので、本文の上限を上げてよい */
export const isSyncRequest = (c: Context) => c.req.method === 'POST' && c.req.path === SYNC_PATH && !!verifyBearer(c, 'sync')

export function createBundleHandlers({ resolve, keyPrefix, editUrl, itemUrl }: BundleBackend) {
  async function manage(c: C) {
    const ctx = await resolve(c)
    return ctx?.access.canManage ? ctx : null
  }

  async function upload(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, itemId, store } = ctx
    const back = editUrl(access.course.id, itemId)
    const read = await readTreeUploads(c, LIMITS)
    if (!read.ok) return redirectWith(c, back, read.error, 'error')
    const { uploads, skipped } = read
    const problem = treeUploadProblem(store.list(), uploads, LIMITS)
    if (problem) return redirectWith(c, back, problem, 'error')

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
    const target = await readTreeRemove(c)
    if (!target) return c.notFound()
    inBackground(deleteKeys(store.remove(target.match)))
    return redirectWith(c, editUrl(access.course.id, itemId), target.message, 'info')
  }

  async function download(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const files = ctx.store.list().map((f) => ({
      path: f.path,
      read: async () => (f.size ? ((await storage.read(f.fileKey, f.size)) ?? new Uint8Array()) : new Uint8Array()),
    }))
    return treeZip(c, ctx.title, files)
  }

  async function launch(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const { access, itemId, title, ref } = ctx
    if (!wantsJson(c)) return c.redirect(itemUrl(access.course.id, itemId), 303)
    const token = signToken('launch', { ref, userId: c.var.user!.id, course: access.course.title, title })
    const query = new URLSearchParams({ server: appOrigin(c), token })
    return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/open?${query}` })
  }

  // ---------------------------------------------------------------- データの同期と変更履歴

  async function setSync(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const on = (await readFields(c, 'bundleSync'))?.sync === 1
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
export function vscodeApi({ itemOf, stampOf }: Pick<BundleBackend, 'itemOf' | 'stampOf'>) {
  const claim = launchClaimer('launch')
  // 拡張機能は保存から数秒待ってまとめて送るので、普通に使っていて届く回数ではない
  const syncLimit = rateLimiter({ limit: 120, windowSec: 60 })
  const app = new Hono<AppEnv>()

  async function syncTarget(c: C) {
    const claims = verifyBearer(c, 'sync')
    if (!claims || claims.stamp !== stampOf?.(claims.userId)) return null
    const item = await itemOf(claims.ref, claims.userId)
    // 利用者も確かめるのは、鍵が半年使え、そのあいだに利用者が消されているかもしれないため
    if (!item?.sync.findUser(claims.userId)) return null
    return { ...item, userId: claims.userId, limitKey: `${claims.ref} ${claims.userId}` }
  }

  app.post('/claim', async (c) => {
    const claims = await claim(c)
    if (claims instanceof Response) return claims
    const item = await itemOf(claims.ref, claims.userId)
    const user = item?.sync.findUser(claims.userId)
    if (!item || !user) return linkExpired(c)
    return c.json({
      ref: claims.ref,
      course: claims.course,
      title: claims.title,
      // 拡張機能に鍵の中身を読ませないのは、鍵の形を変えたときに拡張機能を出し直さずに済ませるため
      user: { id: user.id, name: user.name },
      grant: signToken('grant', { ref: claims.ref, userId: claims.userId }),
      files: item.store.list().map(({ path, size, sha256 }) => ({ path, size, sha256 })),
      // 同期が無効でも鍵を渡すのは、あとから教師が有効にしたときに、学生が画面から開き直さなくても送り始められるようにするため
      sync: {
        token: signToken('sync', { ref: claims.ref, userId: claims.userId, stamp: stampOf?.(claims.userId) }),
        enabled: item.sync.enabled(),
      },
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
    if (syncLimit.retryAfter(target.limitKey)) return tooManyRequests(c)
    syncLimit.hit(target.limitKey)
    const changes = await readJson(c, SYNC_REQUEST)
    if (!changes) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    const result = await recordChanges(target.sync, target.userId, changes, target.store.list(), readStored)
    return c.json({ enabled: true, ...result })
  })

  // パスではなく中身のハッシュで指すのは、URL が .md などで終わると開発サーバー（Vite）が自分のファイルとして横取りし、
  // 拡張機能はどのみち受け取った中身をハッシュで確かめるため
  app.get('/files/:sha256{[0-9a-f]{64}}', async (c) => {
    const grant = verifyBearer(c, 'grant')
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
