// 通常モードと Moodle モードの両方と、ブラウザ（pdf-viewer.ts）が読み込むので、DB や Node の API を使うモジュールを import しない
import * as z from 'zod/mini'

export const PRESENTATION_KIND = 'presentation'

export const presentationBase = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/presentation`

export const MAX_PRESENTATION_PAGES = 2000

/** 拡張機能が、スライドが変わらなくても送り続ける間隔（秒）。拡張機能に claim の応答で伝える */
export const SYNC_HEARTBEAT = 10
/** この秒数のあいだ拡張機能から届かなければ、同期が止まったとみなす */
export const SYNC_ALIVE = 30
/** socket.io につながっていないときに、画面が公開の状態を読む間隔（ミリ秒） */
export const STATE_INTERVAL = 3000
/** socket.io につながっているときの間隔（ミリ秒）。同期が途切れたことは知らせが来ないので、読むのを完全にはやめない */
export const LIVE_STATE_INTERVAL = 15_000

/** socket.io の接続先のパス。画面共有（/socket.io）や共同編集とは別のサーバーにする */
export const PRESENTATION_SOCKET_PATH = '/presentation-io/'

export type PresentationServerEvents = {
  /** 公開の状態が変わった。中身を送らないのは、読むたびに state で権限を確かめるため */
  changed: () => void
}

export type PresentationTargetIds = { courseId: number; itemId: number }

export function parsePresentationBase(base: string): PresentationTargetIds | null {
  const match = /^\/courses\/(\d+)\/items\/(\d+)\/presentation$/.exec(base)
  const courseId = Number(match?.[1])
  const itemId = Number(match?.[2])
  return Number.isSafeInteger(courseId) && Number.isSafeInteger(itemId) && courseId > 0 && itemId > 0 ? { courseId, itemId } : null
}

export type PresentationState = {
  /** PDF の保存先。まだなければ null */
  fileKey: string | null
  fileSize: number
  /** PDF を上げ直すたびに増やす */
  version: number
  /** PDF の各ページの、PowerPoint のスライドの ID */
  slideIds: number[]
  /** クリックで進むアニメーションがあるページ（1 始まり） */
  animatedPages: number[]
  /** 図形を押すと動くアニメーションがあるページ（1 始まり） */
  triggerPages: number[]
  sourceName: string
  /** これまでに公開したスライドの ID */
  releasedSlideIds: number[]
  /** 公開の範囲の最後のページ。0 は、まだどのページも公開していない */
  releasedPage: number
  /** 先生が映しているページ */
  currentPage: number | null
  allReleased: boolean
  /** 最後に拡張機能から届いた時刻。同期を止めたら null */
  syncedAt: number | null
  exportedAt: number | null
}

export const EMPTY_PRESENTATION: PresentationState = {
  fileKey: null,
  fileSize: 0,
  version: 0,
  slideIds: [],
  animatedPages: [],
  triggerPages: [],
  sourceName: '',
  releasedSlideIds: [],
  releasedPage: 0,
  currentPage: null,
  allReleased: false,
  syncedAt: null,
  exportedAt: null,
}

/** モードごとの置き場所（通常モードは lib/presentation-items.ts、Moodle モードは moodle-mode/presentation.ts） */
export type PresentationStore = {
  get: () => PresentationState
  /** 変える項目だけを渡す */
  save: (patch: Partial<PresentationState>) => void
}

type Patch = Partial<PresentationState>

const union = (a: readonly number[], b: readonly number[]) => [...new Set([...a, ...b])]

const releaseTo = (s: PresentationState, page: number): Patch => ({
  releasedPage: page,
  releasedSlideIds: union(s.releasedSlideIds, s.slideIds.slice(0, page)),
})

export type UploadedPdf = Pick<PresentationState, 'fileKey' | 'fileSize' | 'slideIds' | 'animatedPages' | 'triggerPages' | 'sourceName'>

/**
 * PDF を上げ直したとき。公開の範囲は、公開済みのスライドのうち、新しい PDF でいちばん後ろにあるページまで。
 * 前と違う名前のファイルなら、どのページも公開していない状態から始める
 */
export function uploaded(s: PresentationState, pdf: UploadedPdf, now: number): Patch {
  // スライドの ID だけで引き継がないのは、ID がどのファイルでも同じ番号から始まり、別のファイルの公開済みのスライドと取り違えるため
  const same = s.sourceName === pdf.sourceName
  const before = same ? s.releasedSlideIds : []
  const allReleased = same && s.allReleased
  const released = new Set(before)
  // 公開済みのスライドが先頭から続いているところまでにしないのは、途中にスライドを足しただけで、その後ろの公開済みのページが見えなくなるため
  const releasedPage = allReleased ? pdf.slideIds.length : pdf.slideIds.findLastIndex((id) => released.has(id)) + 1
  return {
    ...pdf,
    version: s.version + 1,
    allReleased,
    releasedPage,
    releasedSlideIds: union(before, pdf.slideIds.slice(0, releasedPage)),
    currentPage: null,
    exportedAt: now,
    syncedAt: now,
  }
}

/** 拡張機能が送る、映しているスライド。slideId が null は、スライドショーをしていない */
export type Position = { slideId: number | null; complete: boolean }

/**
 * 映しているスライドが届いたとき。アニメーションが終わっていればそのページまで、まだなら 1 つ前のページまで公開する。
 * unknown は、PDF にないスライド（PDF を書き出したあとに足したスライドなど）だったか
 */
export function moved(s: PresentationState, { slideId, complete }: Position, now: number): { patch: Patch; unknown: boolean } {
  if (slideId === null) return { patch: { currentPage: null, syncedAt: now }, unknown: false }
  const page = s.slideIds.indexOf(slideId) + 1
  if (!page) return { patch: { syncedAt: now }, unknown: true }
  const reach = complete ? page : page - 1
  // 狭めないのは、先生が前のスライドに戻っても、一度見せたページを学生から隠さないため
  return { patch: { currentPage: page, syncedAt: now, ...(reach > s.releasedPage && releaseTo(s, reach)) }, unknown: false }
}

export const releasedAll = (s: PresentationState): Patch => ({ allReleased: true, ...releaseTo(s, s.slideIds.length) })

/** 同期を止めたとき */
export const ended = (s: PresentationState, releaseAll: boolean): Patch => ({
  currentPage: null,
  syncedAt: null,
  ...(releaseAll && releasedAll(s)),
})

/** 先生が公開の範囲を手で決めたとき。狭めることもできる */
export function releasedBy(s: PresentationState, page: number): Patch {
  const releasedPage = Math.min(s.slideIds.length, Math.max(0, page))
  return { allReleased: false, releasedPage, releasedSlideIds: s.slideIds.slice(0, releasedPage) }
}

/** 先生が公開をやり直すとき。1 ページ目だけを公開した状態に戻す */
export const restarted = (s: PresentationState): Patch => releasedBy(s, 1)

export const isSyncing = (s: PresentationState, now: number) => s.syncedAt !== null && now - s.syncedAt < SYNC_ALIVE

/** 画面のビューアーが読む公開の状態 */
export type PresentationView = {
  /** PDF がまだなければ 0 */
  version: number
  /** 見せるページ数。教師には全ページ */
  pages: number
  /** 公開の範囲の最後のページ */
  released: number
  /** 学生の画面を合わせるページ。同期していないときと、すべて公開したあとは null */
  follow: number | null
  all: boolean
  syncing: boolean
  /** 教師にだけ返す */
  manage?: {
    /** 先生が映しているページ */
    current: number | null
    sourceName: string
    exportedAt: number | null
    animatedPages: number[]
    triggerPages: number[]
  }
}

export function presentationView(s: PresentationState, now: number, canManage: boolean): PresentationView {
  const total = s.fileKey ? s.slideIds.length : 0
  const released = s.allReleased ? total : Math.min(s.releasedPage, total)
  const syncing = isSyncing(s, now)
  // 公開の範囲の外を映しているとき（アニメーションの途中）に最後の公開ページへ合わせるのは、学生の画面を、いま見られるいちばん新しいページに置いておくため
  const follow = syncing && !s.allReleased && s.currentPage !== null && released > 0 ? Math.min(s.currentPage, released) : null
  return {
    version: s.fileKey ? s.version : 0,
    pages: canManage ? total : released,
    released,
    follow,
    all: s.allReleased,
    syncing,
    ...(canManage && {
      manage: {
        current: syncing ? s.currentPage : null,
        sourceName: s.sourceName,
        exportedAt: s.exportedAt,
        animatedPages: s.animatedPages,
        triggerPages: s.triggerPages,
      },
    }),
  }
}

const pageList = z.array(z.int().check(z.gte(1), z.lte(MAX_PRESENTATION_PAGES))).check(z.maxLength(MAX_PRESENTATION_PAGES))

/** 拡張機能が PDF と一緒に送る、ページごとのスライドの ID など */
export const PRESENTATION_META = z.object({
  slideIds: z.array(z.int().check(z.gte(0))).check(z.minLength(1), z.maxLength(MAX_PRESENTATION_PAGES)),
  animatedPages: pageList,
  triggerPages: pageList,
  sourceName: z.string().check(z.maxLength(300)),
})

export const PRESENTATION_POSITION = z.object({ slideId: z.nullable(z.int().check(z.gte(0))), complete: z.boolean() })

export const PRESENTATION_END = z.object({ releaseAll: z.boolean() })
