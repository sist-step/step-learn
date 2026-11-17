/// <reference lib="dom" />
import * as Y from 'yjs'
import type { CollabEditor, EditorContext, Presence } from './app'
import { isShapeKind, newElement, newId, readElement, type ElData, type ElMap } from './shapes'
import { Stage, applyTextDiff, drawElement, styleCommand, syncStyleTools } from './stage'

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

export function mount(ctx: EditorContext): CollabEditor {
  const ORIGIN = 'slides-local'
  const { doc } = ctx
  ensureSlide(doc)
  const slides = slidesOf(doc)
  const undo = new Y.UndoManager(slides, { trackedOrigins: new Set([ORIGIN]), captureTimeout: 400 })
  const change = (fn: () => void) => doc.transact(fn, ORIGIN)
  let currentId = slideId(slides.get(0))
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

  // ---------------------------------------------------------------- ノート
  let notesText: Y.Text | null = null
  const notesObserver = (event: Y.YTextEvent) => {
    if (event.transaction.origin === ORIGIN && document.activeElement === notes) return
    notes.value = event.target.toJSON()
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
  let railFrame = 0
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
    const width = matchMedia('(max-width: 640px)').matches ? 116 : Math.max(80, rail.clientWidth - 40)
    const items = list.map((slide, i) => {
      const item = document.createElement('div')
      item.className = 'slides-thumb'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', slideId(slide) === currentId ? 'true' : 'false')
      item.dataset.slide = slideId(slide)
      item.tabIndex = 0
      const num = document.createElement('span')
      num.className = 'slides-thumb-num'
      num.textContent = String(i + 1)
      const frame = document.createElement('div')
      frame.className = 'slides-thumb-frame'
      paint(frame, slide, width)
      const people = document.createElement('div')
      people.className = 'slides-thumb-people'
      for (const p of here.get(slideId(slide)) ?? []) {
        const dot = document.createElement('span')
        dot.style.setProperty('--person', p.color)
        dot.title = `${p.name} さん`
        people.append(dot)
      }
      frame.append(people)
      item.append(num, frame)
      if (slideId(slide) === currentId) {
        const tools = document.createElement('div')
        tools.className = 'slides-thumb-tools'
        for (const [action, label] of [
          ['up', '上へ'],
          ['down', '下へ'],
          ['copy', '複製'],
          ['remove', '削除'],
        ] as const) {
          const b = Object.assign(document.createElement('button'), {
            type: 'button',
            textContent: label,
            className: 'btn btn-ghost btn-sm',
          })
          b.dataset.slideAction = action
          if ((action === 'up' && i === 0) || (action === 'down' && i === list.length - 1) || (action === 'remove' && list.length < 2))
            b.disabled = true
          tools.append(b)
        }
        item.append(tools)
      }
      return item
    })
    rail.replaceChildren(...items)
  }
  const scheduleRail = () => {
    if (!railFrame) railFrame = requestAnimationFrame(renderRail)
  }

  function show(id: string) {
    currentId = id
    const slide = current()
    currentId = slideId(slide)
    stage.setContainer(elementsOf(slide))
    stage.paper.style.background = backgroundOf(slide)
    ctx.setValue('background', backgroundOf(slide))
    bindNotes()
    scheduleRail()
  }

  function addSlide(kind: Layout, after = slides.toArray().indexOf(current())) {
    const id = newId()
    change(() => slides.insert(after + 1, [newSlide({ id, elements: layoutElements(kind, () => newId()) })]))
    show(id)
  }

  function slideAction(action: string) {
    const list = slides.toArray()
    const index = list.indexOf(current())
    if (index < 0) return
    if (action === 'remove' && list.length > 1) {
      change(() => slides.delete(index, 1))
      show(slideId(slides.get(Math.max(0, index - 1))))
    } else if (action === 'copy') {
      const src = list[index]
      const id = newId()
      const data: SlideData = {
        id,
        bg: src.get('bg') as string | undefined,
        notes: notesOf(src).toJSON(),
        elements: [...elementsOf(src).values()].map((m) => ({ ...readElement(m), id: newId() })),
      }
      change(() => slides.insert(index + 1, [newSlide(data)]))
      show(id)
    } else if (action === 'up' || action === 'down') {
      const to = action === 'up' ? index - 1 : index + 1
      if (to < 0 || to >= list.length) return
      const src = list[index]
      const data: SlideData = {
        id: slideId(src),
        bg: src.get('bg') as string | undefined,
        notes: notesOf(src).toJSON(),
        elements: [...elementsOf(src).values()].map(readElement),
      }
      // Y.Array に並べ替えがないので、消して入れ直す。同時にほかの人がこのスライドを編集していると、その変更は入れ直す前の方に入って消える
      change(() => {
        slides.delete(index, 1)
        slides.insert(to, [newSlide(data)])
      })
      show(data.id)
    }
  }

  rail.addEventListener('click', (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-slide-action]')?.dataset.slideAction
    if (action) return slideAction(action)
    const id = (e.target as Element).closest<HTMLElement>('[data-slide]')?.dataset.slide
    if (id && id !== currentId) show(id)
  })
  rail.addEventListener('keydown', (e) => {
    const list = slides.toArray()
    const index = list.indexOf(current())
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = list[index + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        show(slideId(next))
        requestAnimationFrame(() => rail.querySelector<HTMLElement>(`[data-slide="${slideId(next)}"]`)?.focus())
      }
    }
  })

  // ---------------------------------------------------------------- スライドショー
  function present() {
    const show = document.createElement('div')
    show.className = 'slideshow'
    show.tabIndex = 0
    const stageEl = document.createElement('div')
    stageEl.className = 'slideshow-slide'
    const hint = document.createElement('p')
    hint.className = 'slideshow-hint'
    hint.textContent = '← → で移動、Esc で終了'
    show.append(stageEl, hint)
    document.body.append(show)
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
      show.remove()
    }
    show.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) index++
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) index--
      else if (e.key === 'Home') index = 0
      else if (e.key === 'End') index = slides.length - 1
      else if (e.key === 'Escape') return close()
      else return
      e.preventDefault()
      draw()
    })
    show.addEventListener('click', () => {
      index++
      if (index >= slides.length) return close()
      draw()
    })
    show.addEventListener('fullscreenchange', () => !document.fullscreenElement && show.isConnected && close())
    addEventListener('resize', draw)
    slides.observeDeep(draw)
    draw()
    show.focus()
    void show.requestFullscreen?.().catch(() => {})
  }

  // ---------------------------------------------------------------- 同期
  const onSlides = () => {
    if (!slides.toArray().some((s) => slideId(s) === currentId)) show(slideId(slides.get(0)))
    else {
      stage.paper.style.background = backgroundOf(current())
      stage.setContainer(elementsOf(current()))
    }
    scheduleRail()
  }
  slides.observeDeep(onSlides)
  ctx.awareness.on('change', scheduleRail)
  const railResize = new ResizeObserver(scheduleRail)
  railResize.observe(rail)

  const onUndoKey = (e: KeyboardEvent) => {
    if (stage.isEditing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    e.preventDefault()
    if (e.shiftKey) undo.redo()
    else undo.undo()
  }
  canvas.addEventListener('keydown', onUndoKey)
  show(currentId)

  const center = (w: number, h: number) => ({ x: (SLIDE_W - w) / 2, y: (SLIDE_H - h) / 2, w, h })

  return {
    command(cmd, value) {
      if (cmd === 'addSlide') return addSlide(value === 'title' || value === 'content' ? value : 'blank')
      if (cmd === 'addText') {
        const id = stage.insert({ type: 'text', ...center(400, 50), fontSize: 24, text: '' })
        return stage.startEditing(id)
      }
      if (cmd === 'addShape' && isShapeKind(value))
        return stage.insert({
          type: 'shape',
          shape: value,
          ...center(200, 120),
          fill: '#bfdbfe',
          stroke: '#1d4ed8',
          strokeWidth: 2,
          fontSize: 20,
          text: '',
        })
      if (cmd === 'background' && value) {
        const slide = current()
        change(() => slide.set('bg', value))
        stage.paper.style.background = value
        return
      }
      if (cmd === 'present') return present()
      if (styleCommand(stage, cmd, value)) syncStyleTools(stage, ctx)
    },
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    insertImage: (url, size) => stage.insertImage(url, size),
    async exportFile() {
      const { slidesToPptx } = await import('./pptx')
      return slidesToPptx(doc)
    },
    async importFile(file) {
      const { pptxToSlides } = await import('./pptx')
      const data = await pptxToSlides(file, ctx.uploadImage)
      change(() => {
        slides.delete(0, slides.length)
        slides.push(data.map(newSlide))
      })
      show(data[0]?.id ?? '')
    },
    destroy() {
      cancelAnimationFrame(railFrame)
      slides.unobserveDeep(onSlides)
      ctx.awareness.off('change', scheduleRail)
      railResize.disconnect()
      notesText?.unobserve(notesObserver)
      canvas.removeEventListener('keydown', onUndoKey)
      stage.destroy()
      undo.destroy()
    },
  }
}
