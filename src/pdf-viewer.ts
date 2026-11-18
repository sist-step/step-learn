/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// legacy でない版を使わないのは、Iterator や Map.prototype.getOrInsertComputed を前提にしていて、iOS 18 までの Safari では読み込んだ時点で止まるため
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  version,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { STATE_INTERVAL, type PresentationView } from './lib/presentation'
import { getSetting, setSetting } from './lib/settings'

GlobalWorkerOptions.workerSrc = workerUrl

const ASSETS = `/assets/pdfjs-${version}/`
const CSS_UNITS = 96 / 72
const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS.at(-1)!
const MAX_AUTO_ZOOM = 1.25
const MAX_CANVAS_PIXELS = 16_777_216

type Zoom = number | 'auto' | 'width'

type PageView = {
  page: PDFPageProxy
  el: HTMLDivElement
  width: number
  height: number
  canvas: HTMLCanvasElement | null
  renderedScale: number
  task: RenderTask | null
  text: TextLayer | null
  thumb: { el: HTMLButtonElement; frame: HTMLElement; canvas: HTMLCanvasElement | null; task: RenderTask | null }
}

function paint(page: PDFPageProxy, viewport: PageViewport) {
  const ratio = Math.min(devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  const task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
  return { canvas, task }
}

function createThumb(pageNumber: number, width: number, height: number) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'pdf-thumb'
  el.dataset.pdfThumb = String(pageNumber)
  el.setAttribute('aria-label', `${pageNumber} ページ`)
  const frame = document.createElement('span')
  frame.className = 'pdf-thumb-page'
  frame.style.aspectRatio = `${width} / ${height}`
  const label = document.createElement('span')
  label.className = 'pdf-thumb-num'
  label.setAttribute('aria-hidden', 'true')
  label.textContent = String(pageNumber)
  el.append(frame, label)
  return { el, frame, canvas: null, task: null }
}

const viewers = new Set<{ root: HTMLElement; destroy: () => void }>()

export function releaseDetachedPdfViewers() {
  for (const v of viewers) {
    if (v.root.isConnected) continue
    v.destroy()
    viewers.delete(v)
  }
}

type ViewerOptions = {
  url: string
  /** 描くページ数。なければ全ページ */
  limit?: number
  /** PDF を読み込めなかったときに出す文言 */
  errorText: string
}

type ViewerHandle = {
  /** 描いているページ数 */
  pages: () => number
  currentPage: () => number
  goTo: (n: number) => void
  /** 描くページを n ページ目まで増やす。減らすことはできない */
  setLimit: (n: number) => Promise<void>
  /** n ページ目より後ろのページに「未公開」の印を付ける */
  markUnreleased: (n: number) => void
  /** ページの一覧で、先生が映しているページに印を付ける */
  markPresenting: (n: number | null) => void
  /** 利用者がスクロールやボタンでほかのページへ移ったときに呼ぶ（goTo での移動では呼ばない） */
  onMove: (listener: (page: number) => void) => void
}

export async function mountPdfViewer(root: HTMLElement) {
  root.dataset.pdfReady = ''
  releaseDetachedPdfViewers()
  const viewer = createViewer(root, {
    url: root.dataset.pdfViewer!,
    errorText: 'PDF を表示できませんでした。「ブラウザ」に切り替えるか、ダウンロードして開いてください。',
  })
  viewers.add({ root, destroy: viewer.destroy })
  await viewer.ready
}

/** ビューアーを組み立てる。ready は描けるようになったら操作の口を返し、読み込めなかったときや途中で外されたときは null を返す */
function createViewer(root: HTMLElement, { url, limit = Infinity, errorText }: ViewerOptions) {
  const pagesEl = root.querySelector<HTMLElement>('[data-pdf-pages]')!
  const status = root.querySelector<HTMLElement>('[data-pdf-status]')!
  const toolbar = root.querySelector<HTMLElement>('[data-pdf-toolbar]')!
  const pageInput = root.querySelector<HTMLInputElement>('[data-pdf-page]')!
  const countEl = root.querySelector<HTMLElement>('[data-pdf-count]')!
  const zoomEl = root.querySelector<HTMLElement>('[data-pdf-zoom]')!
  const fitBtn = root.querySelector<HTMLElement>('[data-pdf-action="fit"]')!
  const thumbsEl = root.querySelector<HTMLElement>('[data-pdf-thumbs]')!
  const thumbsBtn = root.querySelector<HTMLElement>('[data-pdf-action="thumbs"]')!
  const tail = pagesEl.querySelector<HTMLElement>('[data-pdf-tail]')
  const narrow = matchMedia('(max-width: 640px)')

  const loading = getDocument({
    url,
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
  })
  let observer: IntersectionObserver | null = null
  let thumbObserver: IntersectionObserver | null = null
  let resizer: ResizeObserver | null = null
  const listeners = new AbortController()
  const { signal } = listeners
  let destroyed = false
  // 描いたページも外すのは、発表ファイルでは PDF が変わるたびに、同じ要素の中にビューアーを組み立て直すため
  function destroy() {
    destroyed = true
    observer?.disconnect()
    thumbObserver?.disconnect()
    resizer?.disconnect()
    listeners.abort()
    void loading.destroy()
    pagesEl.querySelectorAll('.pdf-page').forEach((el) => el.remove())
    thumbsEl.replaceChildren()
    toolbar.hidden = true
    root.removeAttribute('data-thumbs-motion')
  }

  return { ready: build().catch(() => null), destroy }

  async function build(): Promise<ViewerHandle | null> {
    const views: PageView[] = []
    const byEl = new Map<HTMLDivElement, PageView>()
    const byThumb = new Map<HTMLButtonElement, PageView>()
    const visible = new Set<PageView>()
    let zoom: Zoom = 'auto'
    let scale = 1
    let unreleasedAfter = Infinity
    let sized = false
    let presenting: number | null = null

    const doc = await loading.promise.catch(() => null)
    if (!doc) {
      if (root.isConnected && !destroyed) status.textContent = errorText
      return null
    }

    function size(v: PageView) {
      v.el.style.width = `${Math.floor(v.width * scale)}px`
      v.el.style.height = `${Math.floor(v.height * scale)}px`
    }

    function mark(v: PageView) {
      const n = v.page.pageNumber
      v.el.classList.toggle('is-unreleased', n > unreleasedAfter)
      v.thumb.el.classList.toggle('is-unreleased', n > unreleasedAfter)
      v.thumb.el.classList.toggle('is-presenting', n === presenting)
    }

    async function addPages(upTo: number) {
      const from = views.length + 1
      const to = Math.min(upTo, doc!.numPages)
      if (to < from) return
      const pages = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => doc!.getPage(from + i)))
      if (destroyed || !root.isConnected) return
      const added = pages.map((page): PageView => {
        const { width, height } = page.getViewport({ scale: CSS_UNITS })
        const el = document.createElement('div')
        el.className = 'pdf-page'
        el.setAttribute('role', 'img')
        el.setAttribute('aria-label', `${page.pageNumber} ページ`)
        return {
          page,
          el,
          width,
          height,
          canvas: null,
          renderedScale: 0,
          task: null,
          text: null,
          thumb: createThumb(page.pageNumber, width, height),
        }
      })
      views.push(...added)
      const els = added.map((v) => v.el)
      if (tail) tail.before(...els)
      else pagesEl.append(...els)
      thumbsEl.append(...added.map((v) => v.thumb.el))
      for (const v of added) {
        byEl.set(v.el, v)
        byThumb.set(v.thumb.el, v)
        // 最初の倍率が決まる前に大きさを付けないのは、付けると倍率を決めるときにスクロール位置を保とうとして、先頭から少しずれるため
        if (sized) size(v)
        mark(v)
        observer?.observe(v.el)
        thumbObserver?.observe(v.thumb.el)
      }
      countEl.textContent = String(views.length)
    }

    await addPages(limit)
    if (destroyed || !root.isConnected || views.length === 0) return null

    status.hidden = true
    toolbar.hidden = false

    function padding() {
      const s = getComputedStyle(pagesEl)
      return {
        x: parseFloat(s.paddingLeft) + parseFloat(s.paddingRight),
        y: parseFloat(s.paddingTop) + parseFloat(s.paddingBottom),
      }
    }

    // 自動の倍率を独自に決めないのは、ブラウザ標準のビューアー（pdf.js と同じ決め方）と切り替えたときに大きさが変わらないようにするため
    function scaleFor(z: Zoom) {
      if (typeof z === 'number') return z
      const pad = padding()
      const first = views[0]
      const widthScale = (pagesEl.clientWidth - pad.x) / Math.max(...views.map((v) => v.width))
      if (z === 'width') return widthScale
      const heightScale = (pagesEl.clientHeight - pad.y) / first.height
      return first.width > first.height ? Math.min(widthScale, heightScale) : Math.min(widthScale, MAX_AUTO_ZOOM)
    }

    function pageAt(y: number) {
      let found = views[0]
      for (const v of views) {
        if (v.el.offsetTop > y) break
        found = v
      }
      return found
    }

    function setZoom(next: Zoom, anchorY = 0) {
      const anchorPage = pageAt(pagesEl.scrollTop + anchorY)
      const laidOut = anchorPage.el.offsetHeight > 0
      const within = laidOut ? (pagesEl.scrollTop + anchorY - anchorPage.el.offsetTop) / anchorPage.el.offsetHeight : 0
      const xRatio = pagesEl.scrollWidth > pagesEl.clientWidth ? (pagesEl.scrollLeft + pagesEl.clientWidth / 2) / pagesEl.scrollWidth : 0.5
      zoom = next
      scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scaleFor(next)))
      pagesEl.style.setProperty('--total-scale-factor', String(scale * CSS_UNITS))
      views.forEach(size)
      sized = true
      if (laidOut) pagesEl.scrollTop = anchorPage.el.offsetTop + within * anchorPage.el.offsetHeight - anchorY
      pagesEl.scrollLeft = xRatio * pagesEl.scrollWidth - pagesEl.clientWidth / 2
      // 移動先のページを覚え直すのは、倍率を変えてスクロール位置が動いただけで、ほかのページへ移ったことにしないため
      if (jumped) jumped = { page: jumped.page, scrollTop: pagesEl.scrollTop }
      zoomEl.textContent = `${Math.round(scale * 100)}%`
      fitBtn.setAttribute('aria-pressed', String(zoom === 'width'))
      scheduleRender()
    }

    let renderTimer = 0
    function scheduleRender() {
      clearTimeout(renderTimer)
      renderTimer = window.setTimeout(() => visible.forEach((v) => void render(v)), 120)
    }

    async function render(v: PageView) {
      if (v.renderedScale === scale && v.canvas) return
      v.task?.cancel()
      const viewport = v.page.getViewport({ scale: scale * CSS_UNITS })
      const { canvas, task } = paint(v.page, viewport)
      v.task = task
      try {
        await task.promise
      } catch {
        return
      }
      if (v.task !== task) return
      v.task = null
      // 古い canvas を先に外さないのは、拡大・縮小のたびにページが一瞬白くなるため
      if (v.canvas) v.canvas.replaceWith(canvas)
      else v.el.prepend(canvas)
      v.canvas = canvas
      v.renderedScale = scale
      if (v.text) v.text.update({ viewport })
      else void renderText(v, viewport)
    }

    async function renderText(v: PageView, viewport: PageViewport) {
      const container = document.createElement('div')
      container.className = 'pdf-text'
      v.text = new TextLayer({ textContentSource: v.page.streamTextContent(), container, viewport })
      v.el.append(container)
      await v.text.render().catch(() => container.remove())
    }

    // 全ページの canvas を持ち続けないのは、ページ数の多い PDF でメモリを使い切るため
    function release(v: PageView) {
      v.task?.cancel()
      v.task = null
      if (!v.canvas) return
      v.canvas.width = 0
      v.canvas.remove()
      v.canvas = null
      v.renderedScale = 0
    }

    async function renderThumb(v: PageView) {
      const thumb = v.thumb
      if (thumb.canvas || thumb.task || !thumb.frame.clientWidth) return
      const { canvas, task } = paint(v.page, v.page.getViewport({ scale: (thumb.frame.clientWidth / v.width) * CSS_UNITS }))
      thumb.task = task
      try {
        await task.promise
      } catch {
        return
      }
      if (thumb.task !== task) return
      thumb.task = null
      thumb.frame.append(canvas)
      thumb.canvas = canvas
    }

    function releaseThumb(v: PageView) {
      const thumb = v.thumb
      thumb.task?.cancel()
      thumb.task = null
      if (!thumb.canvas) return
      thumb.canvas.width = 0
      thumb.canvas.remove()
      thumb.canvas = null
    }

    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = byThumb.get(e.target as HTMLButtonElement)!
          if (e.isIntersecting) void renderThumb(v)
          else releaseThumb(v)
        }
      },
      { root: thumbsEl, rootMargin: '100% 0px' },
    )
    const thumbs = thumbObserver
    views.forEach((v) => thumbs.observe(v.thumb.el))

    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = byEl.get(e.target as HTMLDivElement)!
          if (e.isIntersecting) {
            visible.add(v)
            void render(v)
          } else {
            visible.delete(v)
            release(v)
          }
        }
      },
      { root: pagesEl, rootMargin: '150% 0px' },
    )
    const pageObserver = observer
    views.forEach((v) => pageObserver.observe(v.el))

    let lastWidth = pagesEl.clientWidth
    let lastHeight = pagesEl.clientHeight
    resizer = new ResizeObserver(() => {
      if (pagesEl.clientWidth === lastWidth && pagesEl.clientHeight === lastHeight) return
      lastWidth = pagesEl.clientWidth
      lastHeight = pagesEl.clientHeight
      if (typeof zoom !== 'number') setZoom(zoom)
    })
    resizer.observe(pagesEl)

    // 移動先のページをスクロール位置だけから決め直さないのは、ページが小さく何枚も見えていると、選んだページではなく下のページが現在のページになるため
    let jumped: { page: number; scrollTop: number } | null = null

    function currentPage() {
      if (jumped?.scrollTop === pagesEl.scrollTop) return jumped.page
      jumped = null
      if (pagesEl.scrollTop <= 0) return 1
      if (pagesEl.scrollTop + pagesEl.clientHeight >= pagesEl.scrollHeight - 1) return views.length
      return pageAt(pagesEl.scrollTop + pagesEl.clientHeight / 3).page.pageNumber
    }

    let lastPage = 1
    let moveListener: ((page: number) => void) | null = null

    let current: PageView | null = null
    function markCurrent() {
      const next = views[currentPage() - 1]
      if (document.activeElement !== pageInput) pageInput.value = String(next.page.pageNumber)
      if (next === current) return
      current?.thumb.el.removeAttribute('aria-current')
      next.thumb.el.setAttribute('aria-current', 'page')
      current = next
      revealThumb(next)
    }

    // scrollIntoView を使わないのは、PDF の下に本文があって画面ごとスクロールしているときに、画面までスクロールさせてしまうため
    function revealThumb(v: PageView) {
      if (!root.hasAttribute('data-thumbs-open')) return
      const margin = 12
      const { offsetTop: top, offsetHeight: height } = v.thumb.el
      if (top - margin < thumbsEl.scrollTop) thumbsEl.scrollTop = top - margin
      else if (top + height + margin > thumbsEl.scrollTop + thumbsEl.clientHeight)
        thumbsEl.scrollTop = top + height + margin - thumbsEl.clientHeight
    }

    function goTo(n: number) {
      const v = views[Math.min(views.length, Math.max(1, n)) - 1]
      pagesEl.scrollTo({ top: v.el.offsetTop - parseFloat(getComputedStyle(pagesEl).paddingTop) })
      jumped = { page: v.page.pageNumber, scrollTop: pagesEl.scrollTop }
      lastPage = v.page.pageNumber
      pageInput.value = String(v.page.pageNumber)
      markCurrent()
    }

    /** ボタンやページ番号の入力など、利用者の操作でページを移る */
    function moveTo(n: number) {
      goTo(n)
      moveListener?.(lastPage)
    }

    // hidden の切り替えを CSS（display の allow-discrete と @starting-style）に任せないのは、Firefox では閉じるときに滑らず一瞬で消えるため
    function setThumbsOpen(open: boolean) {
      if (open && thumbsEl.hidden) {
        thumbsEl.hidden = false
        thumbsEl.getBoundingClientRect()
      }
      if (!open && !root.hasAttribute('data-thumbs-motion')) thumbsEl.hidden = true
      root.toggleAttribute('data-thumbs-open', open)
      thumbsBtn.setAttribute('aria-pressed', String(open))
      if (open && current) revealThumb(current)
    }

    // wheel を横取りして PDF と画面に振り分けないのは、タッチのスクロールや慣性・ホイールの滑らかなスクロールまで自前で作り直すことになるため
    const syncPageScrolled = () => root.toggleAttribute('data-page-scrolled', scrollY > 0)
    syncPageScrolled()
    addEventListener('scroll', syncPageScrolled, { passive: true, signal })

    let scrollFrame = 0
    pagesEl.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          markCurrent()
          const page = currentPage()
          if (page === lastPage) return
          lastPage = page
          moveListener?.(page)
        })
      },
      { passive: true, signal },
    )

    pagesEl.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        setZoom(scale * Math.exp(-e.deltaY * 0.01), e.clientY - pagesEl.getBoundingClientRect().top)
      },
      { passive: false, signal },
    )

    const stepZoom = (dir: 1 | -1) =>
      dir > 0 ? (ZOOM_STEPS.find((z) => z > scale + 0.01) ?? MAX_ZOOM) : (ZOOM_STEPS.findLast((z) => z < scale - 0.01) ?? MIN_ZOOM)

    toolbar.addEventListener(
      'click',
      (e) => {
        const action = (e.target as Element).closest<HTMLElement>('[data-pdf-action]')?.dataset.pdfAction
        if (action === 'prev') moveTo(currentPage() - 1)
        else if (action === 'next') moveTo(currentPage() + 1)
        else if (action === 'zoom-in') setZoom(stepZoom(1))
        else if (action === 'zoom-out') setZoom(stepZoom(-1))
        else if (action === 'fit') setZoom(zoom === 'width' ? 'auto' : 'width')
        else if (action === 'thumbs') {
          const open = !root.hasAttribute('data-thumbs-open')
          setThumbsOpen(open)
          if (!narrow.matches) setSetting('pdfThumbs', open)
        }
      },
      { signal },
    )

    thumbsEl.addEventListener(
      'click',
      (e) => {
        const thumb = (e.target as Element).closest<HTMLElement>('[data-pdf-thumb]')
        if (!thumb) return
        moveTo(Number(thumb.dataset.pdfThumb))
        if (narrow.matches) setThumbsOpen(false)
      },
      { signal },
    )

    const hideClosedThumbs = (e: TransitionEvent) => {
      if (e.target === thumbsEl && e.propertyName === 'translate' && !root.hasAttribute('data-thumbs-open')) thumbsEl.hidden = true
    }
    thumbsEl.addEventListener('transitionend', hideClosedThumbs, { signal })
    thumbsEl.addEventListener('transitioncancel', hideClosedThumbs, { signal })

    thumbsEl.addEventListener(
      'keydown',
      (e) => {
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
        const thumb = (e.target as Element).closest<HTMLElement>('[data-pdf-thumb]')
        if (!step || !thumb) return
        e.preventDefault()
        const next = views[Number(thumb.dataset.pdfThumb) - 1 + step]
        if (!next) return
        next.thumb.el.focus({ preventScroll: true })
        moveTo(next.page.pageNumber)
      },
      { signal },
    )

    pageInput.addEventListener(
      'change',
      () => {
        const n = Number(pageInput.value)
        if (Number.isInteger(n)) moveTo(n)
        else pageInput.value = String(currentPage())
      },
      { signal },
    )
    pageInput.addEventListener('focus', () => pageInput.select(), { signal })

    // スマホ幅で開いた状態から始めないのは、一覧がページに重なって最初のページが隠れるため
    setThumbsOpen(!narrow.matches && getSetting('pdfThumbs'))
    setZoom('auto')
    markCurrent()
    root.toggleAttribute('data-thumbs-motion', true)

    // 続けて呼ばれても 1 つずつ足すのは、前の分を読み込んでいる途中で次を始めると、同じページを 2 回足してしまうため
    let growing = Promise.resolve()
    return {
      pages: () => views.length,
      currentPage,
      goTo,
      setLimit: (n) => (growing = growing.then(() => addPages(n)).catch(() => {})),
      markUnreleased(n) {
        unreleasedAfter = n
        views.forEach(mark)
      },
      markPresenting(n) {
        presenting = n
        views.forEach(mark)
      },
      onMove(listener) {
        moveListener = listener
      },
    }
  }
}

// --- 発表ファイル（components/presentation.tsx の PresentationStage）
const NO_PDF_FOR_TEACHER =
  'PDF はまだありません。「PowerPoint と同期」を押すと、VS Code の拡張機能が、PowerPoint で開いているファイルを PDF にしてアップロードします。'

/** 公開の状態を読み続け、公開の範囲のページだけを描く。学生の画面は、先生が映しているページに合わせて動かす */
export function mountPresentation(root: HTMLElement) {
  root.dataset.presentationReady = ''
  releaseDetachedPdfViewers()
  const base = root.dataset.presentation!
  const canManage = root.hasAttribute('data-manage')
  const status = root.querySelector<HTMLElement>('[data-pdf-status]')!
  const tail = root.querySelector<HTMLElement>('[data-pdf-tail]')!
  const returnBtn = root.querySelector<HTMLElement>('[data-presentation-return]')!
  const listeners = new AbortController()

  let viewer: ReturnType<typeof createViewer> | null = null
  let handle: ViewerHandle | null = null
  let version = -1
  let pages = 0
  let follow: number | null = null
  // 先生と同じページにいるあいだだけ合わせるのは、前のページを見返している学生の画面を、先生が進むたびに動かさないため
  let following = true
  let timer = 0
  let stopped = false

  function setFollowing(on: boolean) {
    following = on
    returnBtn.hidden = on || follow === null || !handle
  }

  function showMessage(text: string) {
    viewer?.destroy()
    viewer = null
    handle = null
    status.textContent = text
    status.hidden = false
    tail.hidden = true
    returnBtn.hidden = true
  }

  async function load(view: PresentationView) {
    const keep = handle?.currentPage() ?? null
    version = view.version
    pages = view.pages
    if (!view.version) return showMessage(canManage ? NO_PDF_FOR_TEACHER : '資料はまだありません。')
    if (!view.pages) return showMessage('先生がスライドを映すと、ここに表示されます。')
    showMessage('読み込んでいます…')
    const created = createViewer(root, {
      url: `${base}/pdf?v=${view.version}`,
      limit: view.pages,
      errorText: 'PDF を表示できませんでした。ページを読み込み直してください。',
    })
    viewer = created
    const ready = await created.ready
    if (viewer !== created || !ready) return
    handle = ready
    ready.onMove((page) => follow !== null && setFollowing(page === follow))
    // 読み込んでいるあいだに公開の範囲が広がっていたら、その分を足す
    if (pages > ready.pages()) await ready.setLimit(pages)
    const start = following && follow !== null ? follow : keep
    if (start) ready.goTo(start)
  }

  function renderBar(view: PresentationView) {
    const live = document.querySelector<HTMLElement>('[data-presentation-live]')
    const count = document.querySelector<HTMLElement>('[data-presentation-count]')
    const download = document.querySelector<HTMLAnchorElement>('[data-presentation-download]')
    const pageInput = document.querySelector<HTMLInputElement>('[data-presentation-page]')
    if (live) live.hidden = !view.syncing
    if (count)
      count.textContent = !view.version
        ? ''
        : canManage
          ? view.all
            ? `すべて公開（${view.pages} ページ）`
            : `公開 ${view.released} / ${view.pages} ページ`
          : view.all
            ? 'すべて公開中'
            : view.pages
              ? `${view.pages} ページ目まで公開中`
              : ''
    if (download) {
      download.hidden = !view.version || !(canManage || view.all)
      download.href = `${base}/pdf?download=1&v=${view.version}`
    }
    if (pageInput && document.activeElement !== pageInput && !pageInput.closest('details')?.hasAttribute('open'))
      pageInput.value = String(view.released)
  }

  async function apply(view: PresentationView) {
    follow = canManage ? null : view.follow
    renderBar(view)
    if (view.version !== version || view.pages < pages || (pages === 0 && view.pages > 0)) await load(view)
    else if (view.pages > pages) {
      pages = view.pages
      await handle?.setLimit(pages)
    }
    if (!handle) return
    handle.markUnreleased(canManage ? view.released : view.pages)
    handle.markPresenting(view.manage?.current ?? null)
    tail.hidden = canManage || view.all
    if (follow !== null && following && handle.currentPage() !== follow) handle.goTo(follow)
    setFollowing(following)
  }

  async function tick() {
    if (stopped) return
    if (!document.hidden) {
      try {
        const res = await fetch(`${base}/state`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
        if (stopped) return
        if (res.ok) await apply((await res.json()) as PresentationView)
        else if (res.status === 404) {
          version = -1
          pages = 0
          renderBar({ version: 0, pages: 0, released: 0, follow: null, all: false, syncing: false })
          showMessage('この資料は、今は開けません。')
        }
      } catch {}
    }
    if (!stopped) timer = window.setTimeout(() => void tick(), STATE_INTERVAL)
  }

  returnBtn.addEventListener(
    'click',
    () => {
      setFollowing(true)
      if (follow !== null) handle?.goTo(follow)
    },
    { signal: listeners.signal },
  )
  // 裏にあるあいだ読まないのは、見ていないタブの数だけサーバーに問い合わせ続けることになるため。表に戻ったらすぐ読み直す
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) return
      clearTimeout(timer)
      void tick()
    },
    { signal: listeners.signal },
  )

  viewers.add({
    root,
    destroy: () => {
      stopped = true
      clearTimeout(timer)
      listeners.abort()
      viewer?.destroy()
    },
  })
  void tick()
}
