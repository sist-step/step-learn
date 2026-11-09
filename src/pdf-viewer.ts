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

GlobalWorkerOptions.workerSrc = workerUrl

const ASSETS = `/assets/pdfjs-${version}/`
const CSS_UNITS = 96 / 72
const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS.at(-1)!
const MAX_AUTO_ZOOM = 1.25
const MAX_CANVAS_PIXELS = 16_777_216
const THUMBS_KEY = 'pdf-thumbs'

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

function readThumbsOpen() {
  try {
    return localStorage.getItem(THUMBS_KEY) !== '0'
  } catch {
    return true
  }
}

function saveThumbsOpen(open: boolean) {
  try {
    localStorage.setItem(THUMBS_KEY, open ? '1' : '0')
  } catch {
    // 保存できなくても、次に開いたときに既定の開き方に戻るだけなので知らせない
  }
}

const viewers = new Set<{ root: HTMLElement; destroy: () => void }>()

export function releaseDetachedPdfViewers() {
  for (const v of viewers) {
    if (v.root.isConnected) continue
    v.destroy()
    viewers.delete(v)
  }
}

export async function mountPdfViewer(root: HTMLElement) {
  root.dataset.pdfReady = ''
  releaseDetachedPdfViewers()
  const pagesEl = root.querySelector<HTMLElement>('[data-pdf-pages]')!
  const status = root.querySelector<HTMLElement>('[data-pdf-status]')!
  const toolbar = root.querySelector<HTMLElement>('[data-pdf-toolbar]')!
  const pageInput = root.querySelector<HTMLInputElement>('[data-pdf-page]')!
  const countEl = root.querySelector<HTMLElement>('[data-pdf-count]')!
  const zoomEl = root.querySelector<HTMLElement>('[data-pdf-zoom]')!
  const fitBtn = root.querySelector<HTMLElement>('[data-pdf-action="fit"]')!
  const thumbsEl = root.querySelector<HTMLElement>('[data-pdf-thumbs]')!
  const thumbsBtn = root.querySelector<HTMLElement>('[data-pdf-action="thumbs"]')!
  const narrow = matchMedia('(max-width: 640px)')

  const loading = getDocument({
    url: root.dataset.pdfViewer!,
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
  })
  let observer: IntersectionObserver | null = null
  let thumbObserver: IntersectionObserver | null = null
  let resizer: ResizeObserver | null = null
  const listeners = new AbortController()
  viewers.add({
    root,
    destroy: () => {
      observer?.disconnect()
      thumbObserver?.disconnect()
      resizer?.disconnect()
      listeners.abort()
      void loading.destroy()
    },
  })

  let views: PageView[]
  try {
    const doc = await loading.promise
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
    views = pages.map((page) => {
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
  } catch {
    if (root.isConnected) status.textContent = 'PDF を表示できませんでした。「ブラウザ」に切り替えるか、ダウンロードして開いてください。'
    return
  }
  if (!root.isConnected) return

  const byEl = new Map(views.map((v) => [v.el, v]))
  const byThumb = new Map(views.map((v) => [v.thumb.el, v]))
  const visible = new Set<PageView>()
  let zoom: Zoom = 'auto'
  let scale = 1

  pagesEl.append(...views.map((v) => v.el))
  thumbsEl.append(...views.map((v) => v.thumb.el))
  status.remove()
  toolbar.hidden = false
  countEl.textContent = String(views.length)

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
    for (const v of views) {
      v.el.style.width = `${Math.floor(v.width * scale)}px`
      v.el.style.height = `${Math.floor(v.height * scale)}px`
    }
    if (laidOut) pagesEl.scrollTop = anchorPage.el.offsetTop + within * anchorPage.el.offsetHeight - anchorY
    pagesEl.scrollLeft = xRatio * pagesEl.scrollWidth - pagesEl.clientWidth / 2
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
  views.forEach((v) => thumbObserver!.observe(v.thumb.el))

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
  views.forEach((v) => observer!.observe(v.el))

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
    pageInput.value = String(v.page.pageNumber)
    markCurrent()
  }

  function setThumbsOpen(open: boolean) {
    thumbsEl.hidden = !open
    root.toggleAttribute('data-thumbs-open', open)
    thumbsBtn.setAttribute('aria-pressed', String(open))
    if (open && current) revealThumb(current)
  }

  // wheel を横取りして PDF と画面に振り分けないのは、タッチのスクロールや慣性・ホイールの滑らかなスクロールまで自前で作り直すことになるため
  const syncPageScrolled = () => root.toggleAttribute('data-page-scrolled', scrollY > 0)
  syncPageScrolled()
  addEventListener('scroll', syncPageScrolled, { passive: true, signal: listeners.signal })

  let scrollFrame = 0
  pagesEl.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        markCurrent()
      })
    },
    { passive: true },
  )

  pagesEl.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(scale * Math.exp(-e.deltaY * 0.01), e.clientY - pagesEl.getBoundingClientRect().top)
    },
    { passive: false },
  )

  const stepZoom = (dir: 1 | -1) =>
    dir > 0 ? (ZOOM_STEPS.find((z) => z > scale + 0.01) ?? MAX_ZOOM) : (ZOOM_STEPS.findLast((z) => z < scale - 0.01) ?? MIN_ZOOM)

  toolbar.addEventListener('click', (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-pdf-action]')?.dataset.pdfAction
    if (action === 'prev') goTo(currentPage() - 1)
    else if (action === 'next') goTo(currentPage() + 1)
    else if (action === 'zoom-in') setZoom(stepZoom(1))
    else if (action === 'zoom-out') setZoom(stepZoom(-1))
    else if (action === 'fit') setZoom(zoom === 'width' ? 'auto' : 'width')
    else if (action === 'thumbs') {
      const open = !root.hasAttribute('data-thumbs-open')
      setThumbsOpen(open)
      if (!narrow.matches) saveThumbsOpen(open)
    }
  })

  thumbsEl.addEventListener('click', (e) => {
    const thumb = (e.target as Element).closest<HTMLElement>('[data-pdf-thumb]')
    if (!thumb) return
    goTo(Number(thumb.dataset.pdfThumb))
    if (narrow.matches) setThumbsOpen(false)
  })

  thumbsEl.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    const thumb = (e.target as Element).closest<HTMLElement>('[data-pdf-thumb]')
    if (!step || !thumb) return
    e.preventDefault()
    const next = views[Number(thumb.dataset.pdfThumb) - 1 + step]
    if (!next) return
    next.thumb.el.focus({ preventScroll: true })
    goTo(next.page.pageNumber)
  })

  pageInput.addEventListener('change', () => {
    const n = Number(pageInput.value)
    if (Number.isInteger(n)) goTo(n)
    else pageInput.value = String(currentPage())
  })
  pageInput.addEventListener('focus', () => pageInput.select())

  // スマホ幅で開いた状態から始めないのは、一覧がページに重なって最初のページが隠れるため
  setThumbsOpen(!narrow.matches && readThumbsOpen())
  setZoom('auto')
  markCurrent()
}
