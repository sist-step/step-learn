// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は PresentationBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/presentation.ts）
import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { VSCODE_EXTENSION_ID } from '../../lib/bundle'
import { LAUNCH_CLAIM, claimPresentationLaunch, signPresentation, signPresentationLaunch, verifyPresentation } from '../../lib/bundle-token'
import { config } from '../../lib/config'
import type { CourseAccess } from '../../lib/courses'
import { clientIp, intParam, readFields, readJson, redirectWith, wantsJson } from '../../lib/http'
import { servePresentationPage, splitPresentationPdf } from '../../lib/presentation-pages'
import {
  PRESENTATION_END,
  PRESENTATION_META,
  PRESENTATION_POSITION,
  SYNC_HEARTBEAT,
  ended,
  isSyncing,
  moved,
  presentationView,
  releasedAll,
  releasedBy,
  restarted,
  uploaded,
  type PresentationState,
  type PresentationStore,
} from '../../lib/presentation'
import { rateLimiter } from '../../lib/rate-limit'
import { FILE_TOO_LARGE, MAX_FILE_SIZE, deleteKeys, inBackground, storage } from '../../lib/storage'
import type { AppEnv } from '../../lib/types'

type C = Context<AppEnv>

export type PresentationContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  title: string
  /** 拡張機能に渡すアイテムの識別子。targetOf に渡すと同じアイテムが返る */
  ref: string
  store: PresentationStore
}

export type PresentationTarget = {
  courseId: number
  course: string
  title: string
  user: { id: number; name: string }
  store: PresentationStore
}

export type PresentationBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら返す。開けなければ null */
  resolve: (c: C) => Promise<PresentationContext | null>
  /** 拡張機能からの要求（ログインのセッションがない）で、userId の人が ref のアイテムを今も編集できるなら返す */
  targetOf: (ref: string, userId: number) => Promise<PresentationTarget | null>
  /** ストレージのキーの先頭。コースを消すときにまとめて消せるよう、コースごとに分ける */
  keyPrefix: (courseId: number) => string
  itemUrl: (courseId: number, itemId: number) => string
}

const nowSec = () => Math.floor(Date.now() / 1000)

const serverOrigin = (c: C) => config.appOrigin ?? new URL(c.req.url).origin

const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''

const pagesOf = (s: PresentationState) => (s.fileKey ? s.slideIds.length : 0)

export function createPresentationHandlers({ resolve, itemUrl }: PresentationBackend) {
  async function manage(c: C) {
    const ctx = await resolve(c)
    return ctx?.access.canManage ? ctx : null
  }

  async function state(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    c.header('Cache-Control', 'no-store')
    return c.json(presentationView(ctx.store.get(), nowSec(), ctx.access.canManage))
  }

  async function pdf(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return c.notFound()
    const saved = ctx.store.get()
    const view = presentationView(saved, nowSec(), ctx.access.canManage)
    // 公開の途中の学生に返さないのは、この PDF には未公開のページも入っているため。学生は page で公開済みのページだけを受け取る
    if (!saved.fileKey || view.pages === 0 || !(ctx.access.canManage || view.all)) return c.notFound()
    const download = c.req.query('download') === '1'
    const res = await storage.serve(saved.fileKey, {
      filename: `${ctx.title}.pdf`,
      contentType: 'application/pdf',
      inline: !download,
      range: c.req.header('range'),
    })
    return res ?? c.notFound()
  }

  async function page(c: C) {
    const ctx = await resolve(c)
    const number = intParam(c, 'page')
    if (!ctx || !number) return c.notFound()
    const saved = ctx.store.get()
    if (number > presentationView(saved, nowSec(), ctx.access.canManage).pages) return c.notFound()
    const res = await servePresentationPage(saved, number, {
      filename: `${ctx.title} ${number}.pdf`,
      contentType: 'application/pdf',
      inline: true,
      range: c.req.header('range'),
    })
    return res ?? c.notFound()
  }

  async function releaseAll(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const saved = ctx.store.get()
    const back = itemUrl(ctx.access.course.id, ctx.itemId)
    if (!saved.fileKey) return redirectWith(c, back, 'PDF がまだありません。', 'error')
    ctx.store.save(releasedAll(saved))
    return redirectWith(c, back, 'すべてのページを公開しました。')
  }

  async function setReleased(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const fields = await readFields(c, 'presentationReleased')
    const saved = ctx.store.get()
    if (!fields || !saved.fileKey) return c.notFound()
    const patch = releasedBy(saved, fields.page)
    ctx.store.save(patch)
    const message = patch.releasedPage ? `${patch.releasedPage} ページ目までを公開しました。` : 'すべてのページを未公開にしました。'
    return redirectWith(c, itemUrl(ctx.access.course.id, ctx.itemId), message)
  }

  async function reset(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const saved = ctx.store.get()
    const back = itemUrl(ctx.access.course.id, ctx.itemId)
    if (!saved.fileKey) return redirectWith(c, back, 'PDF がまだありません。', 'error')
    ctx.store.save(restarted(saved))
    const showing = isSyncing(saved, nowSec()) && (saved.currentPage ?? 0) > 1
    return redirectWith(
      c,
      back,
      showing
        ? '公開を 1 ページ目に戻しました。スライドショーで映しているページまでは、また公開されます。'
        : '公開を 1 ページ目に戻しました。',
    )
  }

  async function launch(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    if (!wantsJson(c)) return c.redirect(itemUrl(ctx.access.course.id, ctx.itemId), 303)
    const token = signPresentationLaunch({ ref: ctx.ref, userId: c.var.user!.id })
    const query = new URLSearchParams({ server: serverOrigin(c), token })
    return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/presentation?${query}` })
  }

  return { state, pdf, page, releaseAll, setReleased, reset, launch }
}

export function presentationRoutes(h: ReturnType<typeof createPresentationHandlers>) {
  const app = new Hono<AppEnv>()
  app.get('/:id/items/:iid/presentation/state', h.state)
  app.get('/:id/items/:iid/presentation/pdf', h.pdf)
  app.get('/:id/items/:iid/presentation/pages/:page', h.page)
  app.post('/:id/items/:iid/presentation/release-all', h.releaseAll)
  app.post('/:id/items/:iid/presentation/released', h.setReleased)
  app.post('/:id/items/:iid/presentation/reset', h.reset)
  app.post('/:id/items/:iid/presentation/launch', h.launch)
  return app
}

// ---------------------------------------------------------------- 拡張機能から

const PDF_PATH = '/api/vscode/presentation/pdf'

/** 拡張機能が PDF を上げる要求か。ログインのセッションがなくても、鍵で教師と確かめられるので、本文の上限を上げてよい */
export const isPresentationUpload = (c: Context) => c.req.method === 'POST' && c.req.path === PDF_PATH && !!verifyPresentation(bearer(c))

const TOKEN_INVALID =
  '同期の期限が切れたか、このアイテムを編集できなくなりました。STEP Learn の画面から、もう一度「PowerPoint と同期」を押してください。'

const PDF_MAGIC = '%PDF-'

/** 拡張機能に返す、PDF と公開の範囲のあらまし */
const summaryOf = (s: PresentationState) => ({
  pages: pagesOf(s),
  released: s.allReleased ? pagesOf(s) : Math.min(s.releasedPage, pagesOf(s)),
  all: s.allReleased,
  sourceName: s.sourceName,
  exportedAt: s.exportedAt,
})

/** STEP Learn for VSCode（vscode-extension/）が呼ぶ API。ログインのセッションの代わりに、リンクの鍵と、それと引き換えた鍵で確かめる */
export function presentationApi({ targetOf, keyPrefix }: PresentationBackend) {
  // 上限を付けるのは、ログインしていなくても呼べ、鍵を総当たりで試されないようにするため
  const claimLimit = rateLimiter({ limit: 30, windowSec: 60 })
  // 拡張機能は 0.5 秒おきに読み、変わったときと SYNC_HEARTBEAT 秒おきにだけ送るので、スライドを送り続けても届かない回数にする
  const positionLimit = rateLimiter({ limit: 300, windowSec: 60 })
  const app = new Hono<AppEnv>()

  // 使うたびに確かめるのは、鍵が半日使え、そのあいだに教師から外されたり、アイテムが消されたりするため
  async function tokenTarget(c: C) {
    const claims = verifyPresentation(bearer(c))
    const target = claims && (await targetOf(claims.ref, claims.userId))
    if (!claims || !target) return null
    c.set('logUserId', target.user.id)
    c.set('logTarget', { courseId: target.courseId, title: target.title })
    return { ...target, limitKey: `${claims.ref} ${claims.userId}` }
  }

  app.post('/claim', async (c) => {
    const ip = clientIp(c)
    if (claimLimit.retryAfter(ip)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    claimLimit.hit(ip)
    const claims = claimPresentationLaunch((await readJson(c, LAUNCH_CLAIM))?.token ?? '')
    const target = claims && (await targetOf(claims.ref, claims.userId))
    if (!claims || !target)
      return c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)
    return c.json({
      ref: claims.ref,
      course: target.course,
      title: target.title,
      user: target.user,
      token: signPresentation({ ref: claims.ref, userId: claims.userId }),
      heartbeat: SYNC_HEARTBEAT,
      maxSize: MAX_FILE_SIZE,
      ...summaryOf(target.store.get()),
    })
  })

  app.post('/pdf', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File) || file.size === 0) return c.json({ error: 'PDF がありません。' }, 400)
    if (file.size > MAX_FILE_SIZE) return c.json({ error: FILE_TOO_LARGE }, 413)
    const head = new TextDecoder('latin1').decode(await file.slice(0, PDF_MAGIC.length).arrayBuffer())
    if (head !== PDF_MAGIC) return c.json({ error: 'PDF ではないファイルです。' }, 400)
    let raw: unknown = null
    try {
      raw = JSON.parse(typeof form.meta === 'string' ? form.meta : '')
    } catch {}
    const meta = PRESENTATION_META.safeParse(raw)
    if (!meta.success) return c.json({ error: '送られた内容が正しくありません。' }, 400)

    const fileKey = `${keyPrefix(target.courseId)}presentations/${crypto.randomUUID()}/slides.pdf`
    await storage.put(fileKey, file, 'application/pdf')
    // 分けられなくても全ページ入りの PDF を配って続けないのは、未公開のページが学生に渡るため
    const pages = await splitPresentationPdf(fileKey, new Uint8Array(await file.arrayBuffer()), meta.data.slideIds.length).catch(() => 0)
    if (!pages) {
      inBackground(deleteKeys([fileKey]))
      return c.json({ error: 'PDF を読み取れませんでした。PowerPoint から書き出し直してください。' }, 400)
    }
    const inPdf = (list: number[]) => [...new Set(list)].filter((page) => page <= pages).sort((a, b) => a - b)
    const saved = target.store.get()
    target.store.save(
      uploaded(
        saved,
        {
          fileKey,
          fileSize: file.size,
          // 届いた ID をそのまま使わないのは、PDF のページのほうが少ないと、開けないページまで公開の範囲に入るため
          slideIds: meta.data.slideIds.slice(0, pages),
          animatedPages: inPdf(meta.data.animatedPages),
          triggerPages: inPdf(meta.data.triggerPages),
          sourceName: meta.data.sourceName,
        },
        nowSec(),
      ),
    )
    if (saved.fileKey) inBackground(deleteKeys([saved.fileKey]))
    return c.json(summaryOf(target.store.get()))
  })

  app.post('/position', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    if (positionLimit.retryAfter(target.limitKey)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    positionLimit.hit(target.limitKey)
    const position = await readJson(c, PRESENTATION_POSITION)
    if (!position) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    const saved = target.store.get()
    if (!saved.fileKey) return c.json({ error: 'PDF がまだありません。PDF を書き出してから同期してください。' }, 409)
    const { patch, unknown } = moved(saved, position, nowSec())
    target.store.save(patch)
    const next = { ...saved, ...patch }
    return c.json({ unknown, page: next.currentPage, ...summaryOf(next) })
  })

  app.post('/end', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    const body = await readJson(c, PRESENTATION_END)
    if (!body) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    const saved = target.store.get()
    const patch = ended(saved, body.releaseAll && !!saved.fileKey)
    target.store.save(patch)
    return c.json(summaryOf({ ...saved, ...patch }))
  })

  return app
}
