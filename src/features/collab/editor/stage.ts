/// <reference lib="dom" />
// スライドとキャンバスの面。置いたものの描画・選択・移動・大きさの変更・文字の入力・ほかの人のカーソルと選択の表示を受け持つ
import * as Y from 'yjs'
import type { EditorContext, Presence } from './app'
import { hasText, newElement, newId, penPath, readElement, shapePath, simplify, type ElData, type ElMap, type ShapeKind } from './shapes'

export type Tool = 'select' | 'hand' | 'note' | 'text' | 'line' | 'arrow' | 'pen' | `shape:${ShapeKind}`

type StageOptions = {
  ctx: EditorContext
  host: HTMLElement
  /** board は自由に動かせる無限の面、slides は決まった大きさの面を枠に合わせて出す */
  mode: 'board' | 'slides'
  size?: { w: number; h: number }
  origin: string
  /** 新しく置くものの文字の大きさ */
  fontSize: number
  /** ほかの人の選択を出す範囲（スライドの ID。キャンバスは board） */
  scope: () => string
  onSelect?: (ids: string[]) => void
  /** 付箋の色など、道具ごとの既定の値 */
  noteColor: () => string
  /** ペンと線の色。決めていなければ、面の文字の色で描く */
  penColor?: () => string | undefined
  /** 道具で 1 つ置き終えて、選ぶ道具に戻ったとき（道具のボタンの表示を戻す） */
  onToolDone?: () => void
  /** ドラッグの始めと終わりで区切り、1 回のドラッグを 1 回の「元に戻す」にまとめる */
  undo?: Y.UndoManager
  /** 拡大率が変わったとき */
  onView?: (zoom: number) => void
}

type View = { x: number; y: number; z: number }
type Rect = { x: number; y: number; w: number; h: number }
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'p1' | 'p2'

type RemoteStage = { scope: string; sel: string[]; pointer?: { x: number; y: number } }

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_SIZE = 8
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

const svgNs = 'http://www.w3.org/2000/svg'
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(svgNs, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)

const defaultValign = (d: ElData) => d.valign ?? (d.type === 'text' ? 'top' : 'middle')
const defaultAlign = (d: ElData) => d.align ?? (d.type === 'text' ? 'left' : 'center')

// 文字だけで自分のコピーかを比べないのは、文字のない図形だと、別の場所でコピーした文字と区別できないため
const CLIPBOARD_TYPE = 'application/x-step-learn-elements'

const STYLE_KEYS: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' }

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

function normalize(r: Rect): Rect {
  return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) }
}

/** 線の 2 点から、位置と大きさと相対の点を求める */
function lineBox(x1: number, y1: number, x2: number, y2: number) {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  return { x, y, w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)), points: [x1 - x, y1 - y, x2 - x, y2 - y] }
}

/** 文字の変更を、前後の同じ部分を除いた差分として Y.Text に入れる（ほかの人の同時の入力と混ぜられるように） */
export function applyTextDiff(ytext: Y.Text, next: string) {
  const prev = ytext.toJSON()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let end = 0
  while (end < prev.length - start && end < next.length - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++
  if (prev.length - start - end > 0) ytext.delete(start, prev.length - start - end)
  if (next.length - start - end > 0) ytext.insert(start, next.slice(start, next.length - end))
}

export function syncTextarea(area: HTMLTextAreaElement, event: Y.YTextEvent) {
  let start = area.selectionStart
  let end = area.selectionEnd
  let index = 0
  for (const op of event.delta) {
    if (op.retain) index += op.retain
    else if (typeof op.insert === 'string') {
      if (index <= start) start += op.insert.length
      if (index <= end) end += op.insert.length
      index += op.insert.length
    } else if (op.delete) {
      if (index < start) start = Math.max(index, start - op.delete)
      if (index < end) end = Math.max(index, end - op.delete)
    }
  }
  area.value = (event.target as Y.Text).toJSON()
  area.setSelectionRange(start, end)
}

function styleBody(body: HTMLElement, d: ElData) {
  Object.assign(body.style, {
    fontSize: `${d.fontSize ?? 18}px`,
    color: isColor(d.color) ? d.color : '',
    fontWeight: d.bold ? '700' : '',
    fontStyle: d.italic ? 'italic' : '',
    textDecoration: d.underline ? 'underline' : '',
    textAlign: defaultAlign(d),
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[defaultValign(d)],
    background: d.type === 'text' && isColor(d.fill) ? d.fill : '',
  })
}

function fillRows(body: HTMLElement, d: ElData, plain: boolean) {
  const row = (className: string, text: string) => Object.assign(document.createElement('div'), { className, textContent: text })
  if (!d.text && d.placeholder && !plain) return body.replaceChildren(row('el-row is-placeholder', d.placeholder))
  body.replaceChildren(...(d.text ?? '').split('\n').map((line) => row(d.bullet && line ? 'el-row is-bullet' : 'el-row', line || '\u200b')))
}

/** 置いたもの 1 つを DOM にする（サムネイルとスライドショーでも使う）。plain のときは、空の欄の案内の文字を出さない */
export function drawElement(el: HTMLElement, d: ElData, plain = false) {
  el.className = `el el-${d.type}`
  el.dataset.id = d.id
  Object.assign(el.style, { left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px` })
  const parts: Element[] = []
  if (d.type === 'shape' || d.type === 'note') {
    const box = svg('svg', { class: 'el-svg', viewBox: `0 0 ${d.w} ${d.h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' })
    const sw = d.type === 'note' ? 0 : (d.strokeWidth ?? 2)
    box.append(
      svg('path', {
        d: shapePath(d.type === 'note' ? 'rect' : (d.shape ?? 'rect'), d.w, d.h),
        fill: isColor(d.fill) ? d.fill : d.type === 'note' ? '#fef08a' : 'none',
        stroke: sw && isColor(d.stroke) ? d.stroke : 'none',
        'stroke-width': sw,
        'vector-effect': 'non-scaling-stroke',
      }),
    )
    parts.push(box)
  }
  if (d.type === 'image' && d.src) {
    const img = document.createElement('img')
    img.src = d.src
    img.alt = ''
    img.draggable = false
    parts.push(img)
  }
  if (d.type === 'line' || d.type === 'pen') {
    const box = svg('svg', { class: 'el-svg', viewBox: `0 0 ${d.w} ${d.h}`, overflow: 'visible', 'aria-hidden': 'true' })
    const stroke = isColor(d.stroke) ? d.stroke : 'currentColor'
    const width = d.strokeWidth ?? (d.type === 'pen' ? 3 : 2)
    const p = d.points ?? []
    const path = d.type === 'pen' ? penPath(p) : `M${p[0] ?? 0} ${p[1] ?? 0}L${p[2] ?? d.w} ${p[3] ?? d.h}`
    box.append(svg('path', { d: path, class: 'el-hit', fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, width + 10) }))
    box.append(svg('path', { d: path, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    if (d.type === 'line' && d.arrow && p.length >= 4) {
      const angle = Math.atan2(p[3] - p[1], p[2] - p[0])
      const size = 6 + width * 2.5
      const tip = (a: number) => `${p[2] - size * Math.cos(angle + a)} ${p[3] - size * Math.sin(angle + a)}`
      box.append(
        svg('path', {
          d: `M${tip(0.45)}L${p[2]} ${p[3]}L${tip(-0.45)}Z`,
          fill: stroke,
          stroke,
          'stroke-width': 1,
          'stroke-linejoin': 'round',
        }),
      )
    }
    parts.push(box)
  }
  if (hasText(d.type)) {
    const text = document.createElement('div')
    text.className = 'el-body'
    styleBody(text, d)
    fillRows(text, d, plain)
    parts.push(text)
  }
  el.replaceChildren(...parts)
}

export class Stage {
  readonly world: HTMLDivElement
  readonly paper: HTMLDivElement
  private readonly overlay: HTMLDivElement
  private container: Y.Map<ElMap>
  private view: View = { x: 0, y: 0, z: 1 }
  private nodes = new Map<string, { el: HTMLElement; key: string }>()
  selection: string[] = []
  tool: Tool = 'select'
  private editing: { id: string; area: HTMLTextAreaElement; ytext: Y.Text; stop: () => void } | null = null
  private frame = 0
  private spaceDown = false
  private clipboard: ElData[] = []
  private clipboardId = ''
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private readonly resize: ResizeObserver
  private readonly cleanup: (() => void)[] = []

  constructor(
    private readonly o: StageOptions,
    container: Y.Map<ElMap>,
  ) {
    this.container = container
    const { host } = o
    host.classList.add('stage', `stage-${o.mode}`)
    host.tabIndex = 0
    this.world = document.createElement('div')
    this.world.className = 'stage-world'
    this.paper = document.createElement('div')
    this.paper.className = 'stage-paper'
    if (o.size) Object.assign(this.paper.style, { width: `${o.size.w}px`, height: `${o.size.h}px` })
    this.world.append(this.paper)
    this.overlay = document.createElement('div')
    this.overlay.className = 'stage-overlay'
    host.replaceChildren(this.world, this.overlay)

    const observe = () => this.schedule()
    this.container.observeDeep(observe)
    this.cleanup.push(() => this.container.unobserveDeep(observe))
    o.ctx.awareness.on('change', observe)
    this.cleanup.push(() => o.ctx.awareness.off('change', observe))

    this.resize = new ResizeObserver(() => {
      if (o.mode === 'slides') this.fit()
      this.schedule()
    })
    this.resize.observe(host)
    this.listen()
    if (o.mode === 'slides') this.fit()
    this.render()
  }

  // ---------------------------------------------------------------- 状態

  get scale() {
    return this.view.z
  }

  setContainer(container: Y.Map<ElMap>) {
    if (container === this.container) return
    this.stopEditing()
    this.cleanup.shift()?.()
    this.container = container
    const observe = () => this.schedule()
    container.observeDeep(observe)
    this.cleanup.unshift(() => container.unobserveDeep(observe))
    for (const { el } of this.nodes.values()) el.remove()
    this.nodes.clear()
    this.select([])
    this.render()
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.o.host.dataset.tool = tool.startsWith('shape:') ? 'shape' : tool
    if (tool !== 'select') this.select([])
  }

  private change(fn: () => void) {
    this.o.ctx.doc.transact(fn, this.o.origin)
  }

  // change のままにしないのは、続けて行った操作が 1 回の「元に戻す」でまとめて消えてしまうため
  private step(fn: () => void) {
    this.o.undo?.stopCapturing()
    this.change(fn)
  }

  focus() {
    ;(this.editing?.area ?? this.o.host).focus({ preventScroll: true })
  }

  private items() {
    return [...this.container.values()].map((m) => ({ m, d: readElement(m) }))
  }

  private get(id: string) {
    return this.container.get(id)
  }

  select(ids: string[]) {
    this.selection = ids.filter((id) => this.container.has(id))
    this.o.host.closest<HTMLElement>('[data-collab]')?.toggleAttribute('data-has-selection', this.selection.length > 0)
    this.announce()
    this.o.onSelect?.(this.selection)
    this.schedule()
  }

  private lastPointer = 0
  private announce(pointer?: { x: number; y: number }) {
    const state: RemoteStage = { scope: this.o.scope(), sel: this.selection, pointer }
    if (pointer) {
      const now = Date.now()
      if (now - this.lastPointer < 50) return
      this.lastPointer = now
    }
    this.o.ctx.awareness.setLocalStateField('stage', state)
  }

  // ---------------------------------------------------------------- 座標

  private hostRect() {
    return this.o.host.getBoundingClientRect()
  }

  toWorld(clientX: number, clientY: number) {
    const r = this.hostRect()
    return { x: (clientX - r.left - this.view.x) / this.view.z, y: (clientY - r.top - this.view.y) / this.view.z }
  }

  private toScreen(rect: Rect): Rect {
    return {
      x: rect.x * this.view.z + this.view.x,
      y: rect.y * this.view.z + this.view.y,
      w: rect.w * this.view.z,
      h: rect.h * this.view.z,
    }
  }

  /** 画面の真ん中の、面の上の位置 */
  center() {
    const r = this.hostRect()
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2)
  }

  fit() {
    const r = this.hostRect()
    if (this.o.size) {
      const pad = r.width < 640 ? 12 : 32
      const z = Math.max(0.05, Math.min((r.width - pad * 2) / this.o.size.w, (r.height - pad * 2) / this.o.size.h))
      this.view = { z, x: (r.width - this.o.size.w * z) / 2, y: (r.height - this.o.size.h * z) / 2 }
    } else {
      const all = this.items().map(({ d }) => d)
      if (!all.length) {
        this.view = { z: 1, x: r.width / 2, y: r.height / 2 }
      } else {
        const x1 = Math.min(...all.map((d) => d.x))
        const y1 = Math.min(...all.map((d) => d.y))
        const x2 = Math.max(...all.map((d) => d.x + d.w))
        const y2 = Math.max(...all.map((d) => d.y + d.h))
        const z = Math.max(MIN_ZOOM, Math.min(1.5, (r.width - 120) / Math.max(1, x2 - x1), (r.height - 120) / Math.max(1, y2 - y1)))
        this.view = { z, x: r.width / 2 - ((x1 + x2) / 2) * z, y: r.height / 2 - ((y1 + y2) / 2) * z }
      }
    }
    this.schedule()
  }

  zoomAt(factor: number, clientX?: number, clientY?: number) {
    const r = this.hostRect()
    const cx = (clientX ?? r.left + r.width / 2) - r.left
    const cy = (clientY ?? r.top + r.height / 2) - r.top
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.z * factor))
    const wx = (cx - this.view.x) / this.view.z
    const wy = (cy - this.view.y) / this.view.z
    this.view = { z, x: cx - wx * z, y: cy - wy * z }
    this.schedule()
  }

  // ---------------------------------------------------------------- 描画

  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render())
  }

  private render() {
    this.frame = 0
    const { x, y, z } = this.view
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`
    this.o.onView?.(z)
    if (this.o.mode === 'board') {
      const grid = 24 * z
      this.o.host.style.backgroundSize = `${grid}px ${grid}px`
      this.o.host.style.backgroundPosition = `${x}px ${y}px`
    }
    const items = this.items().sort((a, b) => a.d.z - b.d.z || (a.d.id < b.d.id ? -1 : 1))
    const seen = new Set<string>()
    items.forEach(({ d }, i) => {
      seen.add(d.id)
      const key = JSON.stringify(d)
      let node = this.nodes.get(d.id)
      if (!node) {
        node = { el: document.createElement('div'), key: '' }
        this.nodes.set(d.id, node)
        this.world.append(node.el)
      }
      if (node.key !== key && this.editing?.id !== d.id) {
        drawElement(node.el, d)
        node.key = key
      } else if (this.editing?.id === d.id) {
        Object.assign(node.el.style, { left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px` })
        const body = node.el.querySelector<HTMLElement>(':scope > .el-body')
        if (body) {
          styleBody(body, d)
          fillRows(body, d, false)
        }
        this.styleEditor()
      }
      node.el.style.zIndex = String(i + 1)
    })
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue
      node.el.remove()
      this.nodes.delete(id)
      if (this.editing?.id === id) this.stopEditing()
    }
    if (this.selection.some((id) => !seen.has(id))) this.select(this.selection.filter((id) => seen.has(id)))
    this.renderOverlay(items.map(({ d }) => d))
  }

  private renderOverlay(all: ElData[]) {
    const byId = new Map(all.map((d) => [d.id, d]))
    const parts: HTMLElement[] = []
    const box = (r: Rect, cls: string) => {
      const el = document.createElement('div')
      el.className = cls
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
      return el
    }
    for (const [clientId, state] of this.o.ctx.awareness.getStates()) {
      if (clientId === this.o.ctx.doc.clientID) continue
      const user = (state as { user?: Presence }).user
      const stage = (state as { stage?: RemoteStage }).stage
      if (!user || !stage || stage.scope !== this.o.scope()) continue
      for (const id of stage.sel ?? []) {
        const d = byId.get(id)
        if (!d) continue
        const el = box(this.toScreen(d), 'stage-remote')
        el.style.setProperty('--person', user.color)
        parts.push(el)
      }
      if (stage.pointer && this.o.mode === 'board') {
        const p = this.toScreen({ x: stage.pointer.x, y: stage.pointer.y, w: 0, h: 0 })
        const cursor = document.createElement('div')
        cursor.className = 'stage-cursor'
        cursor.style.setProperty('--person', user.color)
        Object.assign(cursor.style, { left: `${p.x}px`, top: `${p.y}px` })
        const label = document.createElement('span')
        label.textContent = user.name
        cursor.append(label)
        parts.push(cursor)
      }
    }
    const selected = this.selection.map((id) => byId.get(id)).filter((d): d is ElData => !!d)
    for (const d of selected) parts.push(box(this.toScreen(d), 'stage-sel'))
    if (selected.length === 1 && !this.editing) {
      const d = selected[0]
      const r = this.toScreen(d)
      if (d.type === 'line') {
        const p = d.points ?? [0, 0, d.w, d.h]
        for (const [h, px, py] of [
          ['p1', p[0], p[1]],
          ['p2', p[2], p[3]],
        ] as const) {
          const el = box(
            { x: (d.x + px) * this.view.z + this.view.x - 6, y: (d.y + py) * this.view.z + this.view.y - 6, w: 12, h: 12 },
            'stage-handle',
          )
          el.dataset.handle = h
          parts.push(el)
        }
      } else if (d.type !== 'pen') {
        for (const h of HANDLES) {
          const hx = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2
          const hy = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2
          const el = box({ x: hx - 6, y: hy - 6, w: 12, h: 12 }, 'stage-handle')
          el.dataset.handle = h
          parts.push(el)
        }
      }
    }
    if (this.marquee) parts.push(box(this.toScreen(normalize(this.marquee)), 'stage-marquee'))
    if (this.preview) parts.push(this.preview)
    this.overlay.replaceChildren(...parts)
  }

  // ---------------------------------------------------------------- 置く・変える

  private topZ() {
    return Math.max(0, ...this.items().map(({ d }) => d.z)) + 1
  }

  insert(data: Omit<ElData, 'id' | 'z'> & { id?: string }) {
    const id = data.id ?? newId()
    this.step(() => this.container.set(id, newElement({ ...data, id, z: this.topZ() })))
    this.select([id])
    return id
  }

  insertImage(src: string, size: { width: number; height: number }) {
    const r = this.hostRect()
    const max = this.o.size ? Math.min(this.o.size.w, this.o.size.h) * 0.6 : Math.min(r.width, r.height) / this.view.z / 2
    const scale = Math.min(1, max / Math.max(size.width, size.height))
    const w = Math.round(size.width * scale)
    const h = Math.round(size.height * scale)
    const c = this.o.size ? { x: this.o.size.w / 2, y: this.o.size.h / 2 } : this.center()
    this.insert({ type: 'image', src, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h })
    this.setTool('select')
  }

  /** 選んでいるものの書式を変える。文字を入力している最中は、そのものだけ */
  patch(fields: Partial<ElData>) {
    const ids = this.editing ? [this.editing.id] : this.selection
    if (!ids.length) return
    this.step(() => {
      for (const id of ids) {
        const m = this.get(id)
        if (!m) continue
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) m.delete(k)
          else m.set(k, v)
        }
      }
    })
    if (this.editing) this.styleEditor()
  }

  /** 選んでいる最初のもの */
  first(): ElData | null {
    const id = this.editing?.id ?? this.selection[0]
    const m = id ? this.get(id) : undefined
    return m ? readElement(m) : null
  }

  remove(ids = this.selection) {
    if (!ids.length) return
    this.stopEditing()
    this.step(() => ids.forEach((id) => this.container.delete(id)))
    this.select([])
  }

  duplicate(ids = this.selection, offset = 20) {
    const copies = ids
      .map((id) => this.get(id))
      .filter((m): m is ElMap => !!m)
      .map((m) => ({ ...readElement(m), id: newId() }))
    this.paste(copies, offset)
  }

  private paste(list: ElData[], offset: number) {
    if (!list.length) return
    let z = this.topZ()
    const ids: string[] = []
    this.step(() => {
      for (const d of list) {
        const id = newId()
        ids.push(id)
        this.container.set(id, newElement({ ...d, id, x: d.x + offset, y: d.y + offset, z: z++ }))
      }
    })
    this.select(ids)
  }

  reorder(where: 'front' | 'back') {
    const all = this.items().map(({ d }) => d.z)
    let z = where === 'front' ? Math.max(0, ...all) + 1 : Math.min(0, ...all) - this.selection.length
    this.step(() => {
      for (const id of this.selection) this.get(id)?.set('z', z++)
    })
  }

  /** 選んでいるものをまとめて読む（コピー用） */
  copySelection() {
    this.clipboard = this.selection
      .map((id) => this.get(id))
      .filter((m): m is ElMap => !!m)
      .map(readElement)
    return this.clipboard
  }

  // ---------------------------------------------------------------- 文字の入力

  startEditing(id: string, selectAll = false) {
    const m = this.get(id)
    const ytext = m?.get('text')
    if (!m || !(ytext instanceof Y.Text)) return
    this.stopEditing()
    // 次のコマを待たずに描くのは、置いたばかりのものはまだ DOM がなく、そのまま文字の入力を始められないため
    if (!this.nodes.has(id)) {
      cancelAnimationFrame(this.frame)
      this.render()
    }
    const node = this.nodes.get(id)
    if (!node) return
    this.select([id])
    const area = document.createElement('textarea')
    area.className = 'el-editor'
    area.value = ytext.toJSON()
    area.spellcheck = false
    area.setAttribute('aria-label', '文字')
    node.el.classList.add('is-editing')
    node.el.append(area)
    const onInput = () => {
      this.change(() => applyTextDiff(ytext, area.value))
      this.growText(id, area)
    }
    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin !== this.o.origin) syncTextarea(area, event)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        this.stopEditing()
        this.o.host.focus({ preventScroll: true })
      }
      this.styleKey(e)
      e.stopPropagation()
    }
    const onBlur = () =>
      setTimeout(() => {
        if (this.editing?.area !== area || document.activeElement === area) return
        // ツールバーの選択欄や色の欄へ移っただけで入力を終えないのは、文字の大きさを変えるたびに入力し直すことになるため
        const control = document.activeElement?.closest('.collab-bar') ? document.activeElement : null
        if (control) control.addEventListener('blur', onBlur, { once: true })
        else this.stopEditing()
      }, 0)
    area.addEventListener('input', onInput)
    area.addEventListener('keydown', onKey)
    area.addEventListener('blur', onBlur)
    ytext.observe(observer)
    this.editing = {
      id,
      area,
      ytext,
      stop: () => {
        ytext.unobserve(observer)
        area.removeEventListener('input', onInput)
        area.removeEventListener('keydown', onKey)
        area.removeEventListener('blur', onBlur)
      },
    }
    this.styleEditor()
    area.focus({ preventScroll: true })
    if (selectAll) area.select()
    else area.setSelectionRange(area.value.length, area.value.length)
    this.schedule()
  }

  private styleEditor() {
    if (!this.editing) return
    const m = this.get(this.editing.id)
    if (!m) return
    const d = readElement(m)
    const { area } = this.editing
    Object.assign(area.style, {
      fontSize: `${d.fontSize ?? 18}px`,
      color: isColor(d.color) ? d.color : '',
      fontWeight: d.bold ? '700' : '',
      fontStyle: d.italic ? 'italic' : '',
      textDecoration: d.underline ? 'underline' : '',
      textAlign: defaultAlign(d),
      background: d.type === 'text' && isColor(d.fill) ? d.fill : '',
      paddingLeft: d.bullet ? 'calc(10px + 1.1em)' : '',
      paddingTop: '',
    })
    area.dataset.type = d.type
    const valign = defaultValign(d)
    if (valign === 'top') return
    // CSS で揃えないのは、textarea の中身は縦に揃えられないため
    const base = parseFloat(getComputedStyle(area).paddingTop)
    area.style.height = '0'
    const need = area.scrollHeight
    area.style.height = ''
    const free = Math.max(0, area.clientHeight - need)
    area.style.paddingTop = `${base + (valign === 'middle' ? free / 2 : free)}px`
  }

  private styleKey(e: KeyboardEvent) {
    const cmd = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey ? STYLE_KEYS[e.key.toLowerCase()] : undefined
    if (!cmd || !this.first()) return false
    e.preventDefault()
    styleCommand(this, cmd, undefined)
    this.o.onSelect?.(this.selection)
    return true
  }

  private growText(id: string, area: HTMLTextAreaElement) {
    const m = this.get(id)
    if (!m || m.get('type') !== 'text') return
    area.style.height = 'auto'
    const need = area.scrollHeight
    area.style.height = ''
    const h = Number(m.get('h')) || 0
    if (need > h + 1) this.change(() => m.set('h', Math.ceil(need)))
  }

  stopEditing() {
    const editing = this.editing
    if (!editing) return
    this.editing = null
    editing.stop()
    editing.area.remove()
    const node = this.nodes.get(editing.id)
    node?.el.classList.remove('is-editing')
    if (node) node.key = ''
    const m = this.get(editing.id)
    if (m && m.get('type') === 'text' && !m.get('placeholder') && !editing.ytext.toJSON().trim()) this.remove([editing.id])
    this.schedule()
  }

  get isEditing() {
    return !!this.editing
  }

  // ---------------------------------------------------------------- 操作

  private marquee: Rect | null = null
  private preview: HTMLElement | null = null

  private listen() {
    const { host } = this.o
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(host, 'pointerdown', (e) => this.onPointerDown(e))
    on(host, 'dblclick', (e) => {
      if (this.editing) return
      // e.target を使わないのは、押したときにポインターを面に取り込むので、ダブルクリックの対象がいつも面そのものになるため
      const el = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((hit) => host.contains(hit) && hit.closest('.el'))
        ?.closest<HTMLElement>('.el')
      const id = el?.dataset.id
      const m = id ? this.get(id) : undefined
      if (id && m && hasText(String(m.get('type')) as ElData['type'])) this.startEditing(id)
      else if (!el && this.o.mode === 'board' && this.tool === 'select') {
        const p = this.toWorld(e.clientX, e.clientY)
        const newText = this.insert({ type: 'text', x: p.x, y: p.y - 14, w: 240, h: 36, fontSize: this.o.fontSize, text: '' })
        this.startEditing(newText)
      }
    })
    on(host, 'pointermove', (e) => {
      if (this.o.mode === 'board' && e.pointerType === 'mouse') this.announce(this.toWorld(e.clientX, e.clientY))
    })
    on(host, 'pointerleave', () => {
      if (this.o.mode === 'board') this.o.ctx.awareness.setLocalStateField('stage', { scope: this.o.scope(), sel: this.selection })
    })
    on(
      host,
      'wheel',
      (e) => {
        if (this.o.mode !== 'board') return
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
        else {
          this.view = { ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY }
          this.schedule()
        }
      },
      { passive: false },
    )
    on(host, 'keydown', (e) => this.onKey(e))
    on(window, 'keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false
        host.classList.remove('is-panning')
      }
    })
    on(host, 'copy', (e) => {
      if (this.editing || !this.selection.length) return
      e.preventDefault()
      this.writeClipboard(e)
    })
    on(host, 'cut', (e) => {
      if (this.editing || !this.selection.length) return
      e.preventDefault()
      this.writeClipboard(e)
      this.remove()
    })
    on(host, 'paste', (e) => void this.onPaste(e))
  }

  private writeClipboard(e: ClipboardEvent) {
    const list = this.copySelection()
    this.clipboardId = newId()
    e.clipboardData?.setData(CLIPBOARD_TYPE, this.clipboardId)
    e.clipboardData?.setData(
      'text/plain',
      list
        .map((d) => d.text ?? '')
        .filter(Boolean)
        .join('\n'),
    )
  }

  private async onPaste(e: ClipboardEvent) {
    if (this.editing) return
    const own = !!this.clipboard.length && e.clipboardData?.getData(CLIPBOARD_TYPE) === this.clipboardId
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
    const text = e.clipboardData?.getData('text/plain') ?? ''
    e.preventDefault()
    if (own) return this.paste(this.clipboard, 24)
    if (file) {
      const url = await this.o.ctx.uploadImage(file)
      if (!url) return
      const { imageSize } = await import('./app')
      this.insertImage(url, await imageSize(url))
      return
    }
    if (!text.trim()) return
    const c = this.o.size ? { x: this.o.size.w / 2, y: this.o.size.h / 2 } : this.center()
    this.insert({ type: 'text', x: c.x - 160, y: c.y - 20, w: 320, h: 40, fontSize: this.o.fontSize, text })
  }

  private onKey(e: KeyboardEvent) {
    if (this.editing || e.isComposing || this.styleKey(e)) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === ' ' && this.o.mode === 'board') {
      this.spaceDown = true
      this.o.host.classList.add('is-panning')
      e.preventDefault()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.length) {
      e.preventDefault()
      this.remove()
    } else if (e.key === 'Escape') {
      this.select([])
      this.setTool('select')
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      this.duplicate()
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      this.select(this.items().map(({ d }) => d.id))
    } else if (e.key === 'Enter' && this.selection.length === 1) {
      e.preventDefault()
      this.startEditing(this.selection[0])
    } else if (e.key.startsWith('Arrow') && this.selection.length) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const [dx, dy] = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key] ?? [0, 0]
      this.change(() => {
        for (const id of this.selection) {
          const m = this.get(id)
          if (!m) continue
          m.set('x', (Number(m.get('x')) || 0) + dx)
          m.set('y', (Number(m.get('y')) || 0) + dy)
        }
      })
    } else if (!mod && e.key.length === 1 && this.selection.length === 1) {
      const m = this.get(this.selection[0])
      if (m && m.get('text') instanceof Y.Text) {
        this.startEditing(this.selection[0], true)
      }
    }
  }

  private onPointerDown(e: PointerEvent) {
    const { host } = this.o
    if (this.editing && (e.target as Element).closest('.el-editor')) return
    host.focus({ preventScroll: true })
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const cleanupPointer = () => this.pointers.delete(e.pointerId)
    if (this.pointers.size === 2 && this.o.mode === 'board') return this.pinch(e)
    const handle = (e.target as HTMLElement).dataset?.handle as Handle | undefined
    const target = (e.target as Element).closest<HTMLElement>('.el')
    const panning = this.o.mode === 'board' && (this.tool === 'hand' || this.spaceDown || e.button === 1)
    if (e.button !== 0 && !panning) return cleanupPointer()
    if (this.editing) this.stopEditing()
    e.preventDefault()
    const start = this.toWorld(e.clientX, e.clientY)
    let move: (p: { x: number; y: number }, ev: PointerEvent) => void = () => {}
    let end: (p: { x: number; y: number }, ev: PointerEvent) => void = () => {}

    if (panning) {
      const origin = { ...this.view }
      const sx = e.clientX
      const sy = e.clientY
      host.classList.add('is-grabbing')
      move = (_p, ev) => {
        this.view = { ...origin, x: origin.x + ev.clientX - sx, y: origin.y + ev.clientY - sy }
        this.schedule()
      }
      end = () => host.classList.remove('is-grabbing')
    } else if (handle && this.selection.length === 1) {
      ;[move, end] = this.resizeDrag(this.selection[0], handle, e.shiftKey)
    } else if (this.tool === 'select') {
      const id = target?.dataset.id
      if (id) {
        const clickToEdit = this.o.mode === 'slides' && !e.shiftKey && this.opensOnClick(id)
        if (e.shiftKey) this.select(this.selection.includes(id) ? this.selection.filter((x) => x !== id) : [...this.selection, id])
        else if (!this.selection.includes(id)) this.select([id])
        const [drag, drop, moved] = this.moveDrag(start)
        move = drag
        end = (_p, ev) => {
          drop()
          if (clickToEdit && !moved() && ev.type === 'pointerup') this.startEditing(id)
        }
      } else {
        if (!e.shiftKey) this.select([])
        const base = e.shiftKey ? [...this.selection] : []
        move = (p) => {
          this.marquee = { x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y }
          const area = normalize(this.marquee)
          const hit = this.items()
            .filter(({ d }) => intersects(area, d))
            .map(({ d }) => d.id)
          this.selection = [...new Set([...base, ...hit])]
          this.schedule()
        }
        end = () => {
          this.marquee = null
          this.select(this.selection)
        }
      }
    } else if (this.tool === 'pen') {
      const points = [start.x, start.y]
      const path = svg('path', {
        fill: 'none',
        stroke: this.penColor() ?? 'currentColor',
        'stroke-width': 3 * this.view.z,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
      const box = svg('svg', { class: 'stage-preview-svg' })
      box.append(path)
      const wrap = document.createElement('div')
      wrap.className = 'stage-preview'
      wrap.append(box)
      this.preview = wrap
      move = (p) => {
        points.push(p.x, p.y)
        const screen = points.map((v, i) => (i % 2 ? v * this.view.z + this.view.y : v * this.view.z + this.view.x))
        path.setAttribute('d', penPath(screen))
        this.schedule()
      }
      end = () => {
        this.preview = null
        const simple = simplify(points, 0.8 / this.view.z)
        const xs = simple.filter((_, i) => i % 2 === 0)
        const ys = simple.filter((_, i) => i % 2 === 1)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        this.insert({
          type: 'pen',
          x,
          y,
          w: Math.max(1, Math.max(...xs) - x),
          h: Math.max(1, Math.max(...ys) - y),
          points: simple.map((v, i) => (i % 2 ? v - y : v - x)),
          stroke: this.penColor(),
          strokeWidth: 3,
        })
        this.select([])
      }
    } else if (this.tool === 'line' || this.tool === 'arrow') {
      const arrow = this.tool === 'arrow'
      let id: string | null = null
      move = (p) => {
        const box = lineBox(start.x, start.y, p.x, p.y)
        if (!id) id = this.insert({ type: 'line', ...box, arrow, stroke: this.penColor(), strokeWidth: 2 })
        else {
          const m = this.get(id)
          if (m) this.change(() => Object.entries(box).forEach(([k, v]) => m.set(k, v)))
        }
      }
      end = () => {
        if (!id)
          id = this.insert({
            type: 'line',
            ...lineBox(start.x, start.y, start.x + 160, start.y),
            arrow,
            stroke: this.penColor(),
            strokeWidth: 2,
          })
        this.setTool('select')
        this.select([id])
        this.o.onToolDone?.()
      }
    } else if (this.tool === 'note' || this.tool === 'text') {
      end = () => {
        const id =
          this.tool === 'note'
            ? this.insert({
                type: 'note',
                x: start.x - 90,
                y: start.y - 90,
                w: 180,
                h: 180,
                fill: this.o.noteColor(),
                fontSize: this.o.fontSize,
                text: '',
              })
            : this.insert({ type: 'text', x: start.x, y: start.y - 16, w: 260, h: 40, fontSize: this.o.fontSize, text: '' })
        this.setTool('select')
        this.o.onToolDone?.()
        this.startEditing(id)
      }
    } else if (this.tool.startsWith('shape:')) {
      const shape = this.tool.slice(6) as ShapeKind
      let id: string | null = null
      move = (p) => {
        const r = normalize({ x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y })
        if (e.shiftKey) r.w = r.h = Math.max(r.w, r.h)
        if (!id)
          id = this.insert({
            type: 'shape',
            shape,
            ...r,
            fill: '#bfdbfe',
            stroke: '#1d4ed8',
            strokeWidth: 2,
            fontSize: this.o.fontSize,
            text: '',
          })
        else {
          const m = this.get(id)
          if (m) this.change(() => Object.entries(r).forEach(([k, v]) => m.set(k, v)))
        }
      }
      end = () => {
        if (!id)
          id = this.insert({
            type: 'shape',
            shape,
            x: start.x - 80,
            y: start.y - 50,
            w: 160,
            h: 100,
            fill: '#bfdbfe',
            stroke: '#1d4ed8',
            strokeWidth: 2,
            fontSize: this.o.fontSize,
            text: '',
          })
        else {
          const m = this.get(id)
          if (m && (Number(m.get('w')) < MIN_SIZE || Number(m.get('h')) < MIN_SIZE)) this.change(() => (m.set('w', 160), m.set('h', 100)))
        }
        this.setTool('select')
        this.select([id])
        this.o.onToolDone?.()
      }
    }

    const undo = this.o.undo
    undo?.stopCapturing()
    host.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      move(this.toWorld(ev.clientX, ev.clientY), ev)
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
      cleanupPointer()
      end(this.toWorld(ev.clientX, ev.clientY), ev)
      undo?.stopCapturing()
      this.schedule()
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
  }

  private penColor() {
    return this.o.penColor?.()
  }

  private opensOnClick(id: string) {
    const m = this.get(id)
    const text = m?.get('text')
    if (!(text instanceof Y.Text)) return false
    return (this.selection.length === 1 && this.selection[0] === id) || (!!m?.get('placeholder') && !text.length)
  }

  private pinch(e: PointerEvent) {
    const { host } = this.o
    const ids = [...this.pointers.keys()]
    const read = () => ids.map((id) => this.pointers.get(id)!)
    const dist = () => {
      const [a, b] = read()
      return Math.hypot(a.x - b.x, a.y - b.y) || 1
    }
    const mid = () => {
      const [a, b] = read()
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    let lastDist = dist()
    let lastMid = mid()
    const onMove = (ev: PointerEvent) => {
      if (!this.pointers.has(ev.pointerId)) return
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      const d = dist()
      const m = mid()
      this.view = { ...this.view, x: this.view.x + m.x - lastMid.x, y: this.view.y + m.y - lastMid.y }
      this.zoomAt(d / lastDist, m.x, m.y)
      lastDist = d
      lastMid = m
    }
    const onUp = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId)
      if (this.pointers.size >= 2) return
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
      this.pointers.clear()
    }
    host.setPointerCapture(e.pointerId)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
  }

  private moveDrag(start: { x: number; y: number }) {
    const origins = this.selection
      .map((id) => this.get(id))
      .filter((m): m is ElMap => !!m)
      .map((m) => ({ m, x: Number(m.get('x')) || 0, y: Number(m.get('y')) || 0 }))
    let moved = false
    let pending: { x: number; y: number } | null = null
    let raf = 0
    const flush = () => {
      raf = 0
      if (!pending) return
      const { x: dx, y: dy } = pending
      this.change(() => origins.forEach((o) => (o.m.set('x', Math.round(o.x + dx)), o.m.set('y', Math.round(o.y + dy)))))
    }
    return [
      (p: { x: number; y: number }) => {
        const dx = p.x - start.x
        const dy = p.y - start.y
        if (!moved && Math.hypot(dx, dy) * this.view.z < 3) return
        moved = true
        pending = { x: dx, y: dy }
        if (!raf) raf = requestAnimationFrame(flush)
      },
      () => {
        cancelAnimationFrame(raf)
        flush()
      },
      () => moved,
    ] as const
  }

  private resizeDrag(id: string, handle: Handle, keepRatio: boolean) {
    const m = this.get(id)
    if (!m) return [() => {}, () => {}] as const
    const d = readElement(m)
    const ratio = d.w / d.h
    const fixedRatio = keepRatio || d.type === 'image'
    let raf = 0
    let pending: Record<string, number | number[]> | null = null
    const flush = () => {
      raf = 0
      if (!pending) return
      const fields = pending
      this.change(() => Object.entries(fields).forEach(([k, v]) => m.set(k, v)))
    }
    return [
      (p: { x: number; y: number }) => {
        if (handle === 'p1' || handle === 'p2') {
          const pts = d.points ?? [0, 0, d.w, d.h]
          const a = { x: d.x + pts[0], y: d.y + pts[1] }
          const b = { x: d.x + pts[2], y: d.y + pts[3] }
          const box = handle === 'p1' ? lineBox(p.x, p.y, b.x, b.y) : lineBox(a.x, a.y, p.x, p.y)
          pending = box
        } else {
          let x1 = d.x
          let y1 = d.y
          let x2 = d.x + d.w
          let y2 = d.y + d.h
          if (handle.includes('w')) x1 = Math.min(p.x, x2 - MIN_SIZE)
          if (handle.includes('e')) x2 = Math.max(p.x, x1 + MIN_SIZE)
          if (handle.includes('n')) y1 = Math.min(p.y, y2 - MIN_SIZE)
          if (handle.includes('s')) y2 = Math.max(p.y, y1 + MIN_SIZE)
          let w = x2 - x1
          let h = y2 - y1
          if (fixedRatio && handle.length === 2) {
            if (w / h > ratio) w = h * ratio
            else h = w / ratio
            if (handle.includes('w')) x1 = x2 - w
            if (handle.includes('n')) y1 = y2 - h
          }
          pending = { x: Math.round(x1), y: Math.round(y1), w: Math.round(w), h: Math.round(h) }
        }
        if (!raf) raf = requestAnimationFrame(flush)
      },
      () => {
        cancelAnimationFrame(raf)
        flush()
      },
    ] as const
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.stopEditing()
    this.resize.disconnect()
    for (const fn of this.cleanup) fn()
  }
}

/** 書式のツールバー（features/collab/components/collab.tsx の ShapeStyleTools）の操作。受け持たない操作なら false */
export function styleCommand(stage: Stage, cmd: string, value: string | undefined) {
  const handled = applyStyle(stage, cmd, value)
  if (handled) stage.focus()
  return handled
}

function applyStyle(stage: Stage, cmd: string, value: string | undefined) {
  const d = stage.first()
  switch (cmd) {
    case 'fontSize':
      if (Number(value) > 0) stage.patch({ fontSize: Number(value) })
      return true
    case 'bold':
      stage.patch({ bold: !d?.bold || undefined })
      return true
    case 'italic':
      stage.patch({ italic: !d?.italic || undefined })
      return true
    case 'underline':
      stage.patch({ underline: !d?.underline || undefined })
      return true
    case 'bullet':
      stage.patch({ bullet: !d?.bullet || undefined })
      return true
    case 'color':
      stage.patch({ color: value })
      return true
    case 'fill':
      stage.patch({ fill: value })
      return true
    case 'stroke':
      stage.patch({ stroke: value })
      return true
    case 'align':
      stage.patch({ align: value === 'left' || value === 'center' || value === 'right' ? value : undefined })
      return true
    case 'front':
    case 'back':
      stage.reorder(cmd)
      return true
    case 'duplicate':
      stage.duplicate()
      return true
    case 'delete':
      stage.remove()
      return true
  }
  return false
}

/** 選んでいるものに合わせて、書式のツールバーの表示を変える */
export function syncStyleTools(stage: Stage, ctx: EditorContext) {
  const d = stage.first()
  ctx.setPressed('bold', !!d?.bold)
  ctx.setPressed('italic', !!d?.italic)
  ctx.setPressed('underline', !!d?.underline)
  ctx.setPressed('bullet', !!d?.bullet)
  for (const align of ['left', 'center', 'right']) ctx.setPressed('align', !!d && defaultAlign(d) === align, align)
  if (!d) return
  if (d.fontSize) {
    addFontSizeOption(ctx, d.fontSize)
    ctx.setValue('fontSize', String(d.fontSize))
  }
  if (isColor(d.color)) ctx.setValue('color', d.color)
  if (isColor(d.fill)) ctx.setValue('fill', d.fill)
  if (isColor(d.stroke)) ctx.setValue('stroke', d.stroke)
}

// 選択肢にない大きさをそのままにしないのは、選択欄が空になって今の大きさがわからなくなるため（レイアウトの 22 や読み込んだファイルの値）
function addFontSizeOption(ctx: EditorContext, size: number) {
  const select = ctx.root.querySelector<HTMLSelectElement>('select[data-cmd="fontSize"]')
  if (!select || [...select.options].some((o) => Number(o.value) === size)) return
  const next = [...select.options].find((o) => Number(o.value) > size)
  select.add(new Option(String(size), String(size)), next ?? null)
}
