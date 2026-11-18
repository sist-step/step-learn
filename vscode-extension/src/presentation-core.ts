// VS Code の API を使わないのは、Node だけで動かして確かめられるようにするため（VS Code とつなぐのは presentation-session.ts）
import type { Deck, DeckSlide, ShowState } from './powerpoint'
import { SyncError } from './sync'

/** STEP Learn が返す、PDF と公開の範囲のあらまし */
export type PresentationSummary = { pages: number; released: number; all: boolean }

/** リンクの鍵と引き換えに受け取るもの。heartbeat は、スライドが変わらなくても送り続ける間隔（秒） */
export type PresentationGrant = PresentationSummary & {
  ref: string
  course: string
  title: string
  user: { id: number; name: string }
  token: string
  heartbeat: number
  maxSize: number
}

/** STEP Learn に送る、映しているスライド。slideId が null は、スライドショーをしていない */
export type Position = { slideId: number | null; complete: boolean }

/** page は先生が映しているページ。unknown は、PDF にないスライドだったか */
export type PositionResult = PresentationSummary & { page: number | null; unknown: boolean }

/** 鍵が使えなくなった（期限が切れた・アイテムが消えた・教師から外れた） */
export class PresentationTokenError extends SyncError {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const UNREACHABLE = 'STEP Learn に接続できませんでした。ネットワークを確かめてください。'

const INVALID = 'STEP Learn から受け取った内容が正しくありません。'

async function failure(res: Response) {
  const body: unknown = await res.json().catch(() => null)
  const message = isObject(body) && typeof body.error === 'string' ? body.error : `STEP Learn に接続できませんでした（${res.status}）。`
  return res.status === 401 ? new PresentationTokenError(message) : new SyncError(message)
}

// リダイレクトを追わないのは、大きすぎる本文を送ると STEP Learn が画面へのリダイレクトを返し、追うとその画面の HTML を成功として受け取ってしまうため
const call = (url: URL, init: RequestInit) =>
  fetch(url, { ...init, redirect: 'manual' }).catch(() => {
    throw new SyncError(UNREACHABLE)
  })

const post = (server: URL, name: string, token: string | null, body: unknown) =>
  call(new URL(`/api/vscode/presentation/${name}`, server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })

function parseSummary(body: unknown): PresentationSummary {
  if (!isObject(body) || typeof body.pages !== 'number' || typeof body.released !== 'number') throw new SyncError(INVALID)
  return { pages: body.pages, released: body.released, all: body.all === true }
}

/** リンクの鍵を、PDF を上げて映しているスライドを送るための鍵に引き換える */
export async function claimPresentation(server: URL, launchToken: string): Promise<PresentationGrant> {
  const res = await post(server, 'claim', null, { token: launchToken })
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
    throw new SyncError(INVALID)
  return {
    ...parseSummary(body),
    ref: body.ref,
    course: body.course,
    title: body.title,
    token: body.token,
    user: { id: body.user.id, name: body.user.name },
    heartbeat: typeof body.heartbeat === 'number' && body.heartbeat > 0 ? body.heartbeat : 10,
    maxSize: typeof body.maxSize === 'number' ? body.maxSize : 30 * 1024 * 1024,
  }
}

/** PDF に入るスライド（非表示でないもの）。この順が PDF のページの順になる */
const shownSlides = (deck: Deck) => deck.slides.filter((s) => !s.hidden)

/** PDF と一緒に送る、ページごとのスライドの ID と、アニメーションのあるページ */
export function metaOf(deck: Deck) {
  const shown = shownSlides(deck)
  const pagesWith = (has: (s: DeckSlide) => boolean) => shown.flatMap((s, i) => (has(s) ? [i + 1] : []))
  return {
    slideIds: shown.map((s) => s.id),
    animatedPages: pagesWith((s) => s.clicks > 0),
    triggerPages: pagesWith((s) => s.triggers),
    sourceName: deck.name.slice(0, 300),
  }
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

export async function uploadPdf(
  server: URL,
  grant: PresentationGrant,
  pdf: Uint8Array<ArrayBuffer>,
  deck: Deck,
): Promise<PresentationSummary> {
  if (pdf.length > grant.maxSize)
    throw new SyncError(
      `PDF が大きすぎます（${megabytes(pdf.length)}）。アップロードできるのは ${megabytes(grant.maxSize)} までです。画像を圧縮するか、スライドを分けてください。`,
    )
  const form = new FormData()
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'slides.pdf')
  form.set('meta', JSON.stringify(metaOf(deck)))
  const res = await call(new URL('/api/vscode/presentation/pdf', server), {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.token}`, Accept: 'application/json' },
    body: form,
  })
  if (!res.ok) throw await failure(res)
  return parseSummary(await res.json())
}

export async function sendPosition(server: URL, token: string, position: Position): Promise<PositionResult> {
  const res = await post(server, 'position', token, position)
  if (!res.ok) throw await failure(res)
  const body: unknown = await res.json()
  const summary = parseSummary(body)
  const page = isObject(body) && typeof body.page === 'number' ? body.page : null
  return { ...summary, page, unknown: isObject(body) && body.unknown === true }
}

export async function endSync(server: URL, token: string, releaseAll: boolean): Promise<PresentationSummary> {
  const res = await post(server, 'end', token, { releaseAll })
  if (!res.ok) throw await failure(res)
  return parseSummary(await res.json())
}

/** アニメーションの長さが分からないスライドで、最後のクリックのあとに待つ秒数 */
const DEFAULT_TAIL = 1
/** アニメーションが長くても、これ以上は待たない */
const MAX_TAIL = 15
/** PowerPoint がクリックの段階として返す、すべてのアニメーションのあとの値（msoClickStateAfterAllAnimations） */
const AFTER_ALL_ANIMATIONS = -2

/**
 * PowerPoint の状態から、STEP Learn に送る位置（映しているスライドと、そのスライドのアニメーションが終わったか）を決める。
 * クリックの段階を読めない OS（Mac）では、クリックで進むアニメーションのあるスライドを「終わっていない」のままにする。
 * STEP Learn は 1 つ前のページまでしか公開しないので、そのスライドは、先生が次のスライドへ進んだときに学生に出る
 */
export class PositionTracker {
  private readonly slides: Map<number, DeckSlide>
  private slideId: number | null = null
  /** 今のスライドで、最後のクリックまで進んだ時刻 */
  private reachedAt: number | null = null

  constructor(deck: Deck) {
    this.slides = new Map(deck.slides.map((s) => [s.id, s]))
  }

  next(state: ShowState, now: number): Position {
    if (state.state !== 'show' || state.slideId === null) {
      this.slideId = null
      return { slideId: null, complete: false }
    }
    if (state.slideId !== this.slideId) {
      this.slideId = state.slideId
      this.reachedAt = null
    }
    const slide = this.slides.get(state.slideId)
    // 自動で始まるアニメーションの前（クリックの段階が -1）は、クリックの数（0 以上）より小さいので、終わっていないことになる
    const reached =
      state.click !== null && state.clicks !== null
        ? state.click === AFTER_ALL_ANIMATIONS || state.click >= state.clicks
        : (slide?.clicks ?? 0) === 0
    if (!reached) {
      this.reachedAt = null
      return { slideId: state.slideId, complete: false }
    }
    this.reachedAt ??= now
    // 最後のクリックまで進んでもすぐに終わったことにしないのは、そのクリックで始まったアニメーションがまだ動いているため
    const tail = Math.min(MAX_TAIL, slide ? slide.tail : DEFAULT_TAIL)
    return { slideId: state.slideId, complete: now - this.reachedAt >= tail * 1000 }
  }
}
