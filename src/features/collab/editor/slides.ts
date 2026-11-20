/// <reference lib="dom" />
import * as Y from 'yjs'
import type { CollabEditor, EditorContext, Presence } from './app'
import { isShapeKind, newElement, newId, readElement, type ElData, type ElMap } from './shapes'
import { Stage, applyTextDiff, drawElement, styleCommand, syncStyleTools, syncTextarea } from './stage'

/** スライドの大きさ（pt）。16:9 の PowerPoint の既定と同じ */
export const SLIDE_W = 720
export const SLIDE_H = 405

export type SlideMap = Y.Map<unknown>

export const slidesOf = (doc: Y.Doc) => doc.getArray<SlideMap>('slides')
export const elementsOf = (slide: SlideMap) => slide.get('elements') as Y.Map<ElMap>
export const notesOf = (slide: SlideMap) => slide.get('notes') as Y.Text
export const slideId = (slide: SlideMap) => {
  const id = slide.get('id')
  return typeof id === 'string' ? id : ''
}
export const backgroundOf = (slide: SlideMap) => {
  const bg = slide.get('bg')
  return typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff'
}

export type SlideData = { id: string; bg?: string; notes?: string; elements: ElData[] }

export function newSlide(data: SlideData): SlideMap {
  const slide = new Y.Map<unknown>()
  slide.set('id', data.id)
  if (data.bg) slide.set('bg', data.bg)
  const elements = new Y.Map<ElMap>()
  for (const d of data.elements) elements.set(d.id, newElement(d))
  slide.set('elements', elements)
  slide.set('notes', new Y.Text(data.notes ?? ''))
  return slide
}

export type Layout = 'title' | 'content' | 'blank'

/** レイアウトごとの最初の中身。id を引数で決めるのは、最初のスライドを全員が同じ変更として作るため（ensureSlide） */
export function layoutElements(layout: Layout, id: (name: string) => string): ElData[] {
  if (layout === 'title')
    return [
      {
        id: id('title'),
        type: 'text',
        x: 60,
        y: 120,
        w: 600,
        h: 90,
        z: 1,
        fontSize: 40,
        bold: true,
        align: 'center',
        valign: 'middle',
        placeholder: 'クリックしてタイトルを入力',
      },
      {
        id: id('subtitle'),
        type: 'text',
        x: 60,
        y: 220,
        w: 600,
        h: 56,
        z: 2,
        fontSize: 22,
        align: 'center',
        color: '#475569',
        placeholder: 'クリックしてサブタイトルを入力',
      },
    ]
  if (layout === 'content')
    return [
      {
        id: id('title'),
        type: 'text',
        x: 40,
        y: 24,
        w: 640,
        h: 64,
        z: 1,
        fontSize: 32,
        bold: true,
        valign: 'middle',
        placeholder: 'クリックしてタイトルを入力',
      },
      {
        id: id('body'),
        type: 'text',
        x: 40,
        y: 104,
        w: 640,
        h: 270,
        z: 2,
        fontSize: 20,
        bullet: true,
        placeholder: 'クリックしてテキストを入力',
      },
    ]
  return []
}

/** スライドが 1 枚もなければ、タイトルのスライドを入れる。決まった clientID で作るのは、sheet-model.ts の ensureSheet と同じ理由 */
export function ensureSlide(doc: Y.Doc) {
  if (slidesOf(doc).length) return
  const seed = new Y.Doc()
  seed.clientID = 0
  slidesOf(seed).push([newSlide({ id: 'slide1', elements: layoutElements('title', (name) => `slide1-${name}`) })])
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
  seed.destroy()
}

/** スライド 1 枚を、幅 width の枠に描く（サムネイルとスライドショー） */
function paint(host: HTMLElement, slide: SlideMap, width: number) {
  const scale = width / SLIDE_W
  const paper = document.createElement('div')
  paper.className = 'slide-paint'
  Object.assign(paper.style, {
    width: `${SLIDE_W}px`,
    height: `${SLIDE_H}px`,
    transform: `scale(${scale})`,
    background: backgroundOf(slide),
  })
  const items = [...elementsOf(slide).values()].map(readElement).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
  for (const d of items) {
    const el = document.createElement('div')
    drawElement(el, d, true)
    paper.append(el)
  }
  host.style.height = `${SLIDE_H * scale}px`
  host.replaceChildren(paper)
}

type Thumb = {
  item: HTMLElement
  num: HTMLElement
  paper: HTMLElement
  people: HTMLElement
  tools: HTMLElement
  key: string
}

const MENU_MARGIN = 8
const DRAG_START = 6

export function mount(ctx: EditorContext): CollabEditor {
  const ORIGIN = 'slides-local'
  const { doc } = ctx
  ensureSlide(doc)
  const slides = slidesOf(doc)
  const undo = new Y.UndoManager(slides, { trackedOrigins: new Set([ORIGIN]), captureTimeout: 400 })
  const change = (fn: () => void) => doc.transact(fn, ORIGIN)
  const step = (fn: () => void) => {
    undo.stopCapturing()
    change(fn)
  }
  let currentId = slideId(slides.get(0))
  let currentIndex = 0
  const current = () => slides.toArray().find((s) => slideId(s) === currentId) ?? slides.get(0)

  const layout = document.createElement('div')
  layout.className = 'slides-layout'
  const rail = document.createElement('div')
  rail.className = 'slides-rail'
  rail.setAttribute('role', 'listbox')
  rail.setAttribute('aria-label', 'スライドの一覧')
  const main = document.createElement('div')
  main.className = 'slides-main'
  const canvas = document.createElement('div')
  canvas.className = 'slides-canvas'
  const notes = document.createElement('textarea')
  notes.className = 'slides-notes input'
  notes.placeholder = 'ノート（発表者のメモ）'
  notes.setAttribute('aria-label', 'ノート')
  main.append(canvas, notes)
  layout.append(rail, main)
  ctx.stage.replaceChildren(layout)

  const stage = new Stage(
    {
      ctx,
      host: canvas,
      mode: 'slides',
      size: { w: SLIDE_W, h: SLIDE_H },
      origin: ORIGIN,
      fontSize: 24,
      scope: () => currentId,
      noteColor: () => '#fef08a',
      onSelect: () => syncStyleTools(stage, ctx),
      undo,
    },
    elementsOf(current()),
  )

  // ---------------------------------------------------------------- ツールバーのメニュー
  const bar = ctx.root.querySelector<HTMLElement>('.collab-bar')
  // CSS だけで開かないのは、バーが横にスクロールするため、バーの中に置いたパネルは切り取られて見えなくなるため
  const placeMenu = (e: MouseEvent) => {
    const menu = (e.target as Element).closest?.('details.collab-menu > summary')?.parentElement
    if (!(menu instanceof HTMLDetailsElement) || !menu.open || !bar?.contains(menu)) return
    const panel = menu.querySelector<HTMLElement>(':scope > .popover-panel')
    if (!panel) return
    panel.classList.remove('is-above')
    const anchor = menu.getBoundingClientRect()
    const left = Math.max(MENU_MARGIN, Math.min(anchor.left, innerWidth - panel.offsetWidth - MENU_MARGIN))
    Object.assign(panel.style, { left: `${left}px`, top: `${anchor.bottom + 6}px` })
  }
  const closeMenus = () => {
    for (const menu of bar?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) menu.open = false
  }
  document.addEventListener('click', placeMenu)
  bar?.addEventListener('scroll', closeMenus, { passive: true })
  addEventListener('resize', closeMenus)

  // ---------------------------------------------------------------- ノート
  let notesText: Y.Text | null = null
  const notesObserver = (event: Y.YTextEvent) => {
    if (event.transaction.origin === ORIGIN && document.activeElement === notes) return
    syncTextarea(notes, event)
  }
  function bindNotes() {
    const next = notesOf(current())
    if (next === notesText) return
    notesText?.unobserve(notesObserver)
    notesText = next
    notes.value = next.toJSON()
    next.observe(notesObserver)
  }
  notes.addEventListener('input', () => notesText && change(() => applyTextDiff(notesText!, notes.value)))
  notes.addEventListener('keydown', (e) => e.stopPropagation())

  // ---------------------------------------------------------------- 一覧
  const toolsTemplate = ctx.root.querySelector<HTMLTemplateElement>('template[data-slide-tools]')!
  const thumbs = new Map<string, Thumb>()
  let railFrame = 0
  let revealCurrent = true

  function createThumb(id: string): Thumb {
    const item = document.createElement('div')
    item.className = 'slides-thumb'
    item.setAttribute('role', 'option')
    item.dataset.slide = id
    item.tabIndex = 0
    const num = document.createElement('span')
    num.className = 'slides-thumb-num'
    const frame = document.createElement('div')
    frame.className = 'slides-thumb-frame'
    const paper = document.createElement('div')
    const people = document.createElement('div')
    people.className = 'slides-thumb-people'
    frame.append(paper, people)
    const tools = toolsTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement
    item.append(num, frame, tools)
    return { item, num, paper, people, tools, key: '' }
  }

  // 全部を作り直さないのは、ほかの人の操作のたびに、押している最中のボタンやフォーカスが消えてしまうため
  function renderRail() {
    railFrame = 0
    const list = slides.toArray()
    const here = new Map<string, Presence[]>()
    for (const [clientId, state] of ctx.awareness.getStates()) {
      if (clientId === doc.clientID) continue
      const user = (state as { user?: Presence }).user
      const scope = (state as { stage?: { scope?: string } }).stage?.scope
      if (user && scope) here.set(scope, [...(here.get(scope) ?? []), user])
    }
    const width = matchMedia('(max-width: 640px)').matches ? 104 : Math.max(80, rail.clientWidth - 44)
    const seen = new Set<string>()
    const items = list.map((slide, i) => {
      const id = slideId(slide)
      seen.add(id)
      const thumb = thumbs.get(id) ?? createThumb(id)
      thumbs.set(id, thumb)
      thumb.num.textContent = String(i + 1)
      thumb.item.setAttribute('aria-selected', id === currentId ? 'true' : 'false')
      const key = `${width}:${JSON.stringify(slide.toJSON())}`
      if (thumb.key !== key) {
        paint(thumb.paper, slide, width)
        thumb.key = key
      }
      thumb.people.replaceChildren(
        ...(here.get(id) ?? []).map((p) => {
          const dot = document.createElement('span')
          dot.style.setProperty('--person', p.color)
          dot.title = `${p.name} さん`
          return dot
        }),
      )
      const disabled: Record<string, boolean> = { up: i === 0, down: i === list.length - 1, copy: false, remove: list.length < 2 }
      for (const b of thumb.tools.querySelectorAll<HTMLButtonElement>('[data-slide-action]')) b.disabled = disabled[b.dataset.slideAction!]
      return thumb.item
    })
    for (const id of thumbs.keys()) if (!seen.has(id)) thumbs.delete(id)
    if (items.length !== rail.children.length || items.some((item, i) => rail.children[i] !== item)) rail.replaceChildren(...items)
    if (revealCurrent) thumbs.get(currentId)?.item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealCurrent = false
  }
  const scheduleRail = () => {
    if (!railFrame) railFrame = requestAnimationFrame(renderRail)
  }

  function syncCurrent() {
    const slide = current()
    stage.setContainer(elementsOf(slide))
    stage.paper.style.background = backgroundOf(slide)
    ctx.setValue('background', backgroundOf(slide))
    bindNotes()
    syncStyleTools(stage, ctx)
  }

  function show(id: string) {
    currentId = id
    currentId = slideId(current())
    currentIndex = slides.toArray().indexOf(current())
    revealCurrent = true
    syncCurrent()
    scheduleRail()
  }

  function go(delta: number, focusThumb: boolean) {
    const next = slides.toArray()[slides.toArray().indexOf(current()) + delta]
    if (!next) return
    show(slideId(next))
    if (focusThumb) thumbs.get(currentId)?.item.focus()
  }

  function addSlide(kind: Layout, after = slides.toArray().indexOf(current())) {
    const id = newId()
    step(() => slides.insert(after + 1, [newSlide({ id, elements: layoutElements(kind, () => newId()) })]))
    show(id)
  }

  const slideData = (src: SlideMap, id: string, newIds: boolean): SlideData => ({
    id,
    bg: src.get('bg') as string | undefined,
    notes: notesOf(src).toJSON(),
    elements: [...elementsOf(src).values()].map((m) => ({ ...readElement(m), ...(newIds ? { id: newId() } : {}) })),
  })

  function moveSlide(from: number, to: number) {
    const list = slides.toArray()
    if (from === to || to < 0 || to >= list.length) return
    const data = slideData(list[from], slideId(list[from]), false)
    // Y.Array に並べ替えがないので、消して入れ直す。同時にほかの人がこのスライドを編集していると、その変更は入れ直す前の方に入って消える
    step(() => {
      slides.delete(from, 1)
      slides.insert(to, [newSlide(data)])
    })
    show(currentId)
  }

  function slideAction(action: string) {
    const list = slides.toArray()
    const index = list.indexOf(current())
    if (index < 0) return
    if (action === 'remove' && list.length > 1) {
      step(() => slides.delete(index, 1))
      show(slideId(slides.get(Math.max(0, index - 1))))
    } else if (action === 'copy') {
      const id = newId()
      const data = slideData(list[index], id, true)
      step(() => slides.insert(index + 1, [newSlide(data)]))
      show(id)
    } else if (action === 'up' || action === 'down') {
      moveSlide(index, action === 'up' ? index - 1 : index + 1)
    }
  }

  let justDragged = false
  rail.addEventListener('click', (e) => {
    if (justDragged) return
    const target = e.target as Element
    const action = target.closest<HTMLElement>('[data-slide-action]')?.dataset.slideAction
    if (action) slideAction(action)
    else {
      const id = target.closest<HTMLElement>('[data-slide]')?.dataset.slide
      if (!id) return
      if (id !== currentId) show(id)
    }
    // 一覧にフォーカスを残さないのは、続けて押す貼り付けや Delete がスライドに届かなくなるため
    stage.focus()
  })

  // タッチで並べ替えないのは、一覧を指でスクロールする操作と区別できないため（タッチは矢印のボタンで動かす）
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const target = e.target as Element
    const source = target.closest<HTMLElement>('[data-slide]')
    if (!source || target.closest('button')) return
    const horizontal = matchMedia('(max-width: 640px)').matches
    const from = [...rail.children].indexOf(source)
    let to: number | null = null
    const clearMarks = () => {
      for (const el of rail.querySelectorAll('.is-drop-before, .is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after')
    }
    const onMove = (ev: PointerEvent) => {
      if (to === null && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_START) return
      source.classList.add('is-dragging')
      const items = [...rail.children]
      const found = items.findIndex((el) => {
        const r = el.getBoundingClientRect()
        return horizontal ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2
      })
      to = found < 0 ? items.length : found
      clearMarks()
      if (found < 0) items.at(-1)?.classList.add('is-drop-after')
      else items[found].classList.add('is-drop-before')
    }
    const onUp = () => {
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', onUp)
      removeEventListener('pointercancel', onUp)
      source.classList.remove('is-dragging')
      clearMarks()
      if (to === null) return
      justDragged = true
      setTimeout(() => (justDragged = false), 0)
      moveSlide(from, to > from ? to - 1 : to)
      stage.focus()
    }
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    addEventListener('pointercancel', onUp)
  })

  // ---------------------------------------------------------------- スライドショー
  function present() {
    const screen = document.createElement('div')
    screen.className = 'slideshow'
    screen.tabIndex = 0
    const stageEl = document.createElement('div')
    stageEl.className = 'slideshow-slide'
    const hint = document.createElement('p')
    hint.className = 'slideshow-hint'
    hint.textContent = '← → で移動、Esc で終了'
    screen.append(stageEl, hint)
    document.body.append(screen)
    let index = Math.max(0, slides.toArray().indexOf(current()))
    const draw = () => {
      const list = slides.toArray()
      index = Math.max(0, Math.min(list.length - 1, index))
      const width = Math.min(innerWidth, (innerHeight * SLIDE_W) / SLIDE_H)
      paint(stageEl, list[index], width)
      stageEl.style.width = `${width}px`
    }
    const close = () => {
      removeEventListener('resize', draw)
      slides.unobserveDeep(draw)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      screen.remove()
      stage.focus()
    }
    screen.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) index++
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) index--
      else if (e.key === 'Home') index = 0
      else if (e.key === 'End') index = slides.length - 1
      else if (e.key === 'Escape') return close()
      else return
      e.preventDefault()
      draw()
    })
    // 押したら進むだけにしないのは、キーボードのないタッチ端末で戻れなくなるため
    screen.addEventListener('click', (e) => {
      index += e.clientX < innerWidth * 0.3 ? -1 : 1
      if (index >= slides.length) return close()
      draw()
    })
    screen.addEventListener('fullscreenchange', () => !document.fullscreenElement && screen.isConnected && close())
    addEventListener('resize', draw)
    slides.observeDeep(draw)
    draw()
    screen.focus()
    void screen.requestFullscreen?.().catch(() => {})
  }

  // ---------------------------------------------------------------- 同期
  const onSlides = () => {
    if (!slides.length) {
      // ORIGIN を付けないのは、この補いまで「元に戻す」の対象にすると、また 1 枚もない状態に戻ってしまうため
      doc.transact(() => slides.push([newSlide({ id: newId(), elements: [] })]))
      return
    }
    const index = slides.toArray().findIndex((s) => slideId(s) === currentId)
    if (index < 0) return show(slideId(slides.get(Math.min(currentIndex, slides.length - 1))))
    currentIndex = index
    syncCurrent()
    scheduleRail()
  }
  slides.observeDeep(onSlides)
  ctx.awareness.on('change', scheduleRail)
  const railResize = new ResizeObserver(scheduleRail)
  railResize.observe(rail)

  const SLIDE_KEYS: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, PageUp: -1, ArrowDown: 1, ArrowRight: 1, PageDown: 1 }
  const onKey = (e: KeyboardEvent) => {
    if (stage.isEditing || e.isComposing) return
    const key = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) {
      e.preventDefault()
      if (e.shiftKey || key === 'y') undo.redo()
      else undo.undo()
      return
    }
    const delta = SLIDE_KEYS[e.key]
    const inRail = rail.contains(e.target as Node)
    if (!delta || e.metaKey || e.ctrlKey || e.altKey || (!inRail && stage.selection.length)) return
    e.preventDefault()
    go(delta, inRail)
  }
  layout.addEventListener('keydown', onKey)
  show(currentId)

  // 真ん中に重ねたままにしないのは、増えたことがわからないため
  function freeSpot(w: number, h: number) {
    const taken = [...elementsOf(current()).values()].map(readElement)
    let x = (SLIDE_W - w) / 2
    let y = (SLIDE_H - h) / 2
    while (taken.some((d) => d.x === x && d.y === y)) {
      x += 16
      y += 16
    }
    return { x, y, w, h }
  }

  function run(cmd: string, value: string | undefined) {
    if (cmd === 'addSlide') return addSlide(value === 'title' || value === 'content' ? value : 'blank')
    if (cmd === 'addText') {
      const id = stage.insert({ type: 'text', ...freeSpot(400, 50), fontSize: 24, text: '' })
      return stage.startEditing(id)
    }
    if (cmd === 'addShape' && isShapeKind(value)) {
      stage.insert({
        type: 'shape',
        shape: value,
        ...freeSpot(200, 120),
        fill: '#bfdbfe',
        stroke: '#1d4ed8',
        strokeWidth: 2,
        fontSize: 20,
        text: '',
      })
      return
    }
    if (cmd === 'addLine') {
      stage.insert({
        type: 'line',
        ...freeSpot(200, 1),
        points: [0, 0, 200, 0],
        stroke: '#1f2937',
        strokeWidth: 2,
        arrow: value === 'arrow',
      })
      return
    }
    if (cmd === 'background' && value) {
      const slide = current()
      step(() => slide.set('bg', value))
      return
    }
    if (styleCommand(stage, cmd, value)) syncStyleTools(stage, ctx)
  }

  return {
    command(cmd, value) {
      if (cmd === 'present') return present()
      run(cmd, value)
      stage.focus()
    },
    undo() {
      undo.undo()
      stage.focus()
    },
    redo() {
      undo.redo()
      stage.focus()
    },
    insertImage(url, size) {
      stage.insertImage(url, size)
      stage.focus()
    },
    async exportFile() {
      const { slidesToPptx } = await import('./pptx')
      return slidesToPptx(doc)
    },
    async importFile(file) {
      const { pptxToSlides } = await import('./pptx')
      const data = await pptxToSlides(file, ctx.uploadImage)
      step(() => {
        slides.delete(0, slides.length)
        slides.push(data.map(newSlide))
      })
      show(data[0]?.id ?? '')
    },
    destroy() {
      cancelAnimationFrame(railFrame)
      document.removeEventListener('click', placeMenu)
      bar?.removeEventListener('scroll', closeMenus)
      removeEventListener('resize', closeMenus)
      slides.unobserveDeep(onSlides)
      ctx.awareness.off('change', scheduleRail)
      railResize.disconnect()
      notesText?.unobserve(notesObserver)
      layout.removeEventListener('keydown', onKey)
      stage.destroy()
      undo.destroy()
    },
  }
}
