/// <reference lib="dom" />
import * as Y from 'yjs'
import { presenceColor } from '../collab'
import type { CollabEditor, EditorContext, Presence } from './app'
import { FUNCTION_NAMES, cellName, colName, formatGeneral, formulaRefs, isError, parseCellName, sheetPrefix, type Scalar } from './formula'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_COLS,
  MAX_ROWS,
  SHEET_FORMATS,
  cellKey,
  cellsOf,
  colsOf,
  createEvaluator,
  displayValue,
  emptySheet,
  ensureSheet,
  fillSeries,
  frozenColsOf,
  frozenRowsOf,
  heightsOf,
  idOf,
  moveSheet,
  movedRaw,
  nameOf,
  naturalAlign,
  newSheet,
  parseKey,
  renameSheet,
  replaceSheets,
  rowsOf,
  setRowHeight,
  sheetData,
  sheetsOf,
  shiftCells,
  stylesOf,
  widthsOf,
  type CellStyle,
  type SheetFormat,
  type SheetMap,
} from './sheet-model'

const ROW_H = DEFAULT_HEIGHT
const HEAD_H = 26
const ROW_HEAD_W = 48
const OVERSCAN = 8
const MIN_WIDTH = 24
const MAX_WIDTH = 800
const MAX_HEIGHT = 600
const CELL_PADDING = 12
const MAX_STYLE_CELLS = 50_000
const MAX_FIT_ROWS = 500
const MAX_SUGGESTIONS = 8
const SCROLL_EDGE = 28

type Box = { r1: number; c1: number; r2: number; c2: number }
/** ar・ac は入力先のセル、fr・fc は伸ばしている端。range は Enter や Tab で範囲の中を進んでいるあいだの範囲 */
type Selection = { ar: number; ac: number; fr: number; fc: number; range?: Box }
type RemoteSelection = { sheet: string } & Box
type Rect = { left: number; top: number; width: number; height: number }
type Edit = { mode: 'enter' | 'edit'; sheet: string; r: number; c: number }
type RefPick = { start: number; end: number; text: string; ar: number; ac: number; fr: number; fc: number }
type ClipCell = { raw: string; style?: CellStyle }
type Clip = { sheet: string; box: Box; text: string; cells: ClipCell[][]; cut: boolean }
type Suggest = { items: string[]; index: number; start: number; moved: boolean }
type Drag = { kind: 'cells' | 'cols' | 'rows' } | { kind: 'ref'; ar: number; ac: number } | { kind: 'fill'; from: Box; to: Box | null }
type MenuEntry = { label: string; run: () => void; danger?: boolean; disabled?: boolean } | 'sep'

const boxOf = (s: Selection): Box =>
  s.range ?? {
    r1: Math.min(s.ar, s.fr),
    c1: Math.min(s.ac, s.fc),
    r2: Math.max(s.ar, s.fr),
    c2: Math.max(s.ac, s.fc),
  }

const single = (b: Box) => b.r1 === b.r2 && b.c1 === b.c2
const areaOf = (b: Box) => (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1)
const inBox = (b: Box, r: number, c: number) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

const BORDER_SHADOWS: Record<string, string> = {
  t: 'inset 0 1px 0 var(--sheet-line)',
  r: 'inset -1px 0 0 var(--sheet-line)',
  b: 'inset 0 -1px 0 var(--sheet-line)',
  l: 'inset 1px 0 0 var(--sheet-line)',
}

function cssOf(style: CellStyle | undefined, align: string) {
  const parts = [`text-align:${style?.align ?? align}`]
  if (style?.b) parts.push('font-weight:700')
  if (style?.i) parts.push('font-style:italic')
  const lines = [style?.u && 'underline', style?.s && 'line-through'].filter(Boolean)
  if (lines.length) parts.push(`text-decoration:${lines.join(' ')}`)
  if (typeof style?.fs === 'number') parts.push(`font-size:${style.fs}px`)
  if (isColor(style?.color)) parts.push(`color:${style.color}`)
  if (isColor(style?.fill)) parts.push(`background:${style.fill}`)
  const shadows = [...(style?.bd ?? '')].map((side) => BORDER_SHADOWS[side]).filter(Boolean)
  if (shadows.length) parts.push(`box-shadow:${shadows.join(',')}`)
  return parts.join(';')
}

/** タブ区切りの文字（Excel やスプレッドシートからの貼り付け）を行と列に分ける。" で囲んだ欄の中の改行とタブはそのまま */
function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === '\t') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  rows.push(row)
  return rows
}

const tsvField = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

const sameClipText = (a: string, b: string) => a.replace(/\r/g, '').replace(/\n$/, '') === b.replace(/\r/g, '').replace(/\n$/, '')

function closeParens(raw: string) {
  if (!raw.startsWith('=')) return raw
  const depth = raw.replace(/"(?:[^"]|"")*"/g, '').split('')
  let open = 0
  for (const ch of depth) open += ch === '(' ? 1 : ch === ')' ? -1 : 0
  return open > 0 ? raw + ')'.repeat(open) : raw
}

function compareForSort(a: Scalar, b: Scalar, dir: 1 | -1) {
  const blank = (v: Scalar) => v === null || v === ''
  if (blank(a) || blank(b)) return Number(blank(a)) - Number(blank(b))
  const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3)
  if (rank(a) !== rank(b)) return (rank(a) - rank(b)) * dir
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' }) * dir
  return (Number(a) - Number(b)) * dir
}

function indexAt(positions: Float64Array, value: number) {
  let low = 0
  let high = positions.length - 2
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (positions[mid] <= value) low = mid
    else high = mid - 1
  }
  return low
}

function buildLayout(s: SheetMap) {
  const rows = rowsOf(s)
  const cols = colsOf(s)
  const heights = heightsOf(s)
  const widths = widthsOf(s)
  const tops = new Float64Array(rows + 1)
  for (let r = 0; r < rows; r++) tops[r + 1] = tops[r] + (heights?.get(String(r)) ?? ROW_H)
  const lefts = new Float64Array(cols + 1)
  for (let c = 0; c < cols; c++) lefts[c + 1] = lefts[c] + (widths.get(String(c)) ?? DEFAULT_WIDTH)
  const fr = Math.min(frozenRowsOf(s), rows - 1)
  const fc = Math.min(frozenColsOf(s), cols - 1)
  return { id: idOf(s), rows, cols, tops, lefts, fr, fc, frozenH: tops[fr], frozenW: lefts[fc] }
}

export function mount(ctx: EditorContext): CollabEditor {
  const { doc } = ctx
  const ORIGIN = 'sheet-local'
  ensureSheet(doc)
  const sheets = sheetsOf(doc)
  // 間隔でまとめないのは、続けて入力した別々のセルが 1 回の「元に戻す」で一緒に消えてしまうため
  const undo = new Y.UndoManager(sheets, { trackedOrigins: new Set([ORIGIN]), captureTimeout: 0 })
  const change = (fn: () => void) => doc.transact(fn, ORIGIN)
  const coarse = matchMedia('(pointer: coarse)')
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const modKey = isMac ? '⌘' : 'Ctrl+'

  let activeId = idOf(sheets.get(0))
  let sel: Selection = { ar: 0, ac: 0, fr: 0, fc: 0 }
  let edit: Edit | null = null
  let refPick: RefPick | null = null
  let suggest: Suggest | null = null
  let evaluator = createEvaluator(doc)
  let clip: Clip | null = null
  let drag: Drag | null = null
  let dragFrame = 0
  let pointer = { x: 0, y: 0 }
  let cachedLayout: ReturnType<typeof buildLayout> | null = null
  let tabsKey = ''
  let closeMenu: (() => void) | null = null
  const views = new Map<string, { sel: Selection; top: number; left: number }>()

  // ---------------------------------------------------------------- DOM
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
    const node = document.createElement(tag)
    node.className = className
    parent?.append(node)
    return node
  }
  const wrap = el('div', 'sheet-wrap')
  const grid = el('div', 'sheet-grid', wrap)
  const table = el('table', 'sheet-table', grid)
  const layer = el('div', 'sheet-layer', grid)
  const copyBox = el('div', 'sheet-copy', layer)
  const selBox = el('div', 'sheet-sel', layer)
  const refLayer = el('div', '', layer)
  const remoteLayer = el('div', '', layer)
  const fillBox = el('div', 'sheet-fill-preview', layer)
  const activeBox = el('div', 'sheet-active', layer)
  const handle = el('div', 'sheet-handle', layer)
  const input = el('textarea', 'sheet-input', layer)
  input.setAttribute('aria-label', 'セルの入力')
  input.spellcheck = false
  input.autocapitalize = 'off'
  const more = el('div', 'sheet-more', grid)
  const moreBtn = el('button', 'btn btn-ghost btn-sm', more)
  moreBtn.type = 'button'
  moreBtn.textContent = '＋ 100 行を追加'
  const foot = el('div', 'sheet-foot', wrap)
  const tabs = el('div', 'sheet-tabs', foot)
  tabs.setAttribute('role', 'tablist')
  const status = el('div', 'sheet-status', foot)
  status.setAttribute('aria-live', 'off')
  const suggestBox = el('div', 'sheet-suggest', wrap)
  suggestBox.hidden = true
  const measureBox = el('div', 'sheet-measure', wrap)
  measureBox.setAttribute('aria-hidden', 'true')

  const findBar = el('form', 'sheet-find', wrap)
  findBar.hidden = true
  findBar.setAttribute('role', 'search')
  const findInput = el('input', 'input input-sm', findBar)
  findInput.placeholder = '検索'
  findInput.setAttribute('aria-label', '検索する文字')
  const findCount = el('span', 'sheet-find-count muted small', findBar)
  const replaceInput = el('input', 'input input-sm', findBar)
  replaceInput.placeholder = '置換後の文字'
  replaceInput.setAttribute('aria-label', '置換後の文字')
  const findButton = (label: string) => {
    const b = el('button', 'btn btn-ghost btn-sm', findBar)
    b.type = 'button'
    b.textContent = label
    return b
  }
  const findPrev = findButton('前へ')
  const findNext = findButton('次へ')
  const replaceOne = findButton('置換')
  const replaceAll = findButton('すべて置換')
  const findClose = findButton('閉じる')

  ctx.stage.replaceChildren(wrap)

  const nameBox = ctx.root.querySelector<HTMLInputElement>('[data-sheet-name-box]')
  const formulaInput = ctx.root.querySelector<HTMLInputElement>('[data-sheet-formula]')

  const measureCtx = document.createElement('canvas').getContext('2d')
  const gridFont = getComputedStyle(grid)
  const fontOf = (style?: CellStyle) =>
    `${style?.i ? 'italic ' : ''}${style?.b ? '700 ' : ''}${style?.fs ?? parseFloat(gridFont.fontSize)}px ${gridFont.fontFamily}`
  function textWidth(text: string, style?: CellStyle) {
    if (!measureCtx) return text.length * 8
    measureCtx.font = fontOf(style)
    return measureCtx.measureText(text).width
  }

  const sheetById = (id: string) => sheets.toArray().find((s) => idOf(s) === id)
  const sheet = () => sheetById(activeId) ?? sheets.get(0)
  const rawOf = (s: SheetMap, r: number, c: number) => cellsOf(s).get(cellKey(r, c)) ?? ''
  function layout() {
    const s = sheet()
    if (!cachedLayout || cachedLayout.id !== idOf(s)) cachedLayout = buildLayout(s)
    return cachedLayout
  }
  const shownText = (s: SheetMap, r: number, c: number) => {
    const raw = rawOf(s, r, c)
    return raw ? displayValue(evaluator.value(s, r, c), raw, stylesOf(s).get(cellKey(r, c))?.fmt) : ''
  }
  const focusGrid = () => {
    if (!coarse.matches || edit) input.focus({ preventScroll: true })
  }

  // ---------------------------------------------------------------- 描画
  let frame = 0
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render)
  }

  function renderRow(s: SheetMap, r: number, L: ReturnType<typeof layout>, box: Box) {
    const styles = stylesOf(s)
    const cells = cellsOf(s)
    const height = L.tops[r + 1] - L.tops[r]
    const frozenRow = r < L.fr
    const out: string[] = []
    let spillEnd = -1
    for (let c = 0; c < L.cols; c++) {
      const key = cellKey(r, c)
      const raw = cells.get(key) ?? ''
      const style = styles.get(key)
      const frozenCol = c < L.fc
      const classes: string[] = []
      const css: string[] = []
      if (frozenRow) {
        classes.push('is-fr')
        css.push(`top:${HEAD_H + L.tops[r]}px`)
        if (r === L.fr - 1) classes.push('is-fr-edge')
      }
      if (frozenCol) {
        classes.push('is-fc')
        css.push(`left:${ROW_HEAD_W + L.lefts[c]}px`)
        if (c === L.fc - 1) classes.push('is-fc-edge')
      }
      let html = ''
      if (raw || style) {
        const value = raw ? evaluator.value(s, r, c) : null
        let text = displayValue(value, raw, style?.fmt)
        const width = L.lefts[c + 1] - L.lefts[c]
        const room = width - CELL_PADDING
        if (typeof value === 'number' && text.length * 4 > room && textWidth(text, style) > room) text = '###'
        if (isError(value)) classes.push('is-error')
        css.push(cssOf(style, naturalAlign(value)))
        const clipped = style?.wrap || style?.fs
        const leftAligned = (style?.align ?? naturalAlign(value)) === 'left'
        if (typeof value === 'string' && !style?.wrap && leftAligned && !frozenRow && !frozenCol && text.length * 6 > room) {
          let need = textWidth(text, style) - room
          let last = c
          while (need > 0 && last + 1 < L.cols) {
            const next = cellKey(r, last + 1)
            if (cells.get(next) || styles.get(next)?.fill) break
            last++
            need -= L.lefts[last + 1] - L.lefts[last]
          }
          if (last > c) {
            classes.push('is-spill')
            spillEnd = last
          }
        }
        const body = escapeHtml(text)
        html = clipped ? `<div class="sheet-clip${style?.wrap ? ' is-wrap' : ''}" style="max-height:${height - 1}px">${body}</div>` : body
      }
      if (c < spillEnd) classes.push('is-covered')
      const attrs = `${classes.length ? ` class="${classes.join(' ')}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}`
      out.push(`<td data-r="${r}" data-c="${c}"${attrs}>${html}</td>`)
    }
    const rowStyle = height === ROW_H ? '' : ` style="height:${height}px"`
    const headCss = frozenRow ? ` style="top:${HEAD_H + L.tops[r]}px;z-index:4"` : ''
    const on = r >= box.r1 && r <= box.r2 ? ' is-on' : ''
    return `<tr${rowStyle}><th class="sheet-row${on}${r === L.fr - 1 ? ' is-fr-edge' : ''}" data-row="${r}"${headCss}>${r + 1}<span class="sheet-resize-row" data-resize-row="${r}"></span></th>${out.join('')}</tr>`
  }

  function render() {
    frame = 0
    const s = sheet()
    if (idOf(s) !== activeId) activeId = idOf(s)
    const L = layout()
    clampSelection(L.rows, L.cols)
    const box = boxOf(sel)
    const scrollTop = grid.scrollTop
    const first = Math.max(L.fr, indexAt(L.tops, scrollTop + L.frozenH) - OVERSCAN)
    const last = Math.min(L.rows - 1, indexAt(L.tops, scrollTop + grid.clientHeight - HEAD_H) + OVERSCAN)
    const cols: string[] = []
    const head: string[] = []
    for (let c = 0; c < L.cols; c++) {
      const width = L.lefts[c + 1] - L.lefts[c]
      cols.push(`<col style="width:${width}px">`)
      const on = c >= box.c1 && c <= box.c2 ? ' is-on' : ''
      const frozen = c < L.fc ? ` style="left:${ROW_HEAD_W + L.lefts[c]}px;z-index:6"` : ''
      head.push(
        `<th class="sheet-col${on}${c === L.fc - 1 ? ' is-fc-edge' : ''}" data-col="${c}"${frozen}>${colName(c)}<span class="sheet-resize" data-resize="${c}"></span></th>`,
      )
    }
    const body: string[] = []
    for (let r = 0; r < L.fr; r++) body.push(renderRow(s, r, L, box))
    body.push(`<tr class="sheet-spacer" style="height:${L.tops[first] - L.tops[L.fr]}px"></tr>`)
    for (let r = first; r <= last; r++) body.push(renderRow(s, r, L, box))
    body.push(`<tr class="sheet-spacer" style="height:${L.tops[L.rows] - L.tops[last + 1]}px"></tr>`)
    table.style.width = `${ROW_HEAD_W + L.lefts[L.cols]}px`
    table.innerHTML =
      `<colgroup><col style="width:${ROW_HEAD_W}px">${cols.join('')}</colgroup>` +
      `<thead><tr><th class="sheet-corner" data-all></th>${head.join('')}</tr></thead>` +
      `<tbody>${body.join('')}</tbody>`
    more.hidden = L.rows >= MAX_ROWS
    placeBoxes()
    renderRemote()
    renderTabs()
    renderStatus()
    syncToolbar()
  }

  function viewRect(b: Box): Rect | null {
    const L = layout()
    const axis = (from: number, to: number, pos: Float64Array, frozen: number, frozenSize: number, scroll: number, head: number) => {
      const limit = head + frozenSize + scroll
      let start = head + pos[from]
      let end = head + pos[to + 1]
      if (from < frozen) start += scroll
      else if (frozen) start = Math.max(start, limit)
      if (to < frozen) end += scroll
      else if (frozen) end = Math.max(end, limit)
      return [start, end]
    }
    const r2 = Math.min(b.r2, L.rows - 1)
    const c2 = Math.min(b.c2, L.cols - 1)
    if (b.r1 > r2 || b.c1 > c2) return null
    const [top, bottom] = axis(b.r1, r2, L.tops, L.fr, L.frozenH, grid.scrollTop, HEAD_H)
    const [left, right] = axis(b.c1, c2, L.lefts, L.fc, L.frozenW, grid.scrollLeft, ROW_HEAD_W)
    return bottom <= top || right <= left ? null : { left, top, width: right - left, height: bottom - top }
  }

  function place(node: HTMLElement, r: Rect | null) {
    node.hidden = !r
    if (r) Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }

  function placeEditor() {
    const s = sheet()
    const at = edit ?? { r: sel.ar, c: sel.ac }
    const away = !!edit && edit.sheet !== activeId
    input.classList.toggle('is-editing', !!edit)
    input.classList.toggle('is-away', away)
    const rect = viewRect({ r1: at.r, c1: at.c, r2: at.r, c2: at.c })
    if (!rect) return
    const style = stylesOf(s).get(cellKey(at.r, at.c))
    Object.assign(input.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      fontSize: style?.fs ? `${style.fs}px` : '',
      fontWeight: style?.b ? '700' : '',
      fontStyle: style?.i ? 'italic' : '',
    })
    if (!edit) {
      Object.assign(input.style, { width: `${rect.width}px`, height: `${rect.height}px` })
      return
    }
    const maxWidth = Math.max(rect.width, grid.clientWidth - (rect.left - grid.scrollLeft) - 4)
    const lines = input.value.split('\n').map((line) => textWidth(line, style) + CELL_PADDING + 8)
    input.style.width = `${clamp(Math.max(...lines), rect.width, maxWidth)}px`
    input.style.height = 'auto'
    input.style.height = `${Math.max(rect.height, input.scrollHeight)}px`
  }

  function placeRefs() {
    const value = edit ? input.value : ''
    if (!edit || !value.startsWith('=')) return refLayer.replaceChildren()
    const editing = sheetById(edit.sheet)
    const name = nameOf(sheet()).toLowerCase()
    const boxes: HTMLElement[] = []
    formulaRefs(value.slice(1)).forEach((ref, i) => {
      const target = ref.sheet ?? (editing ? nameOf(editing) : '')
      if (target.toLowerCase() !== name) return
      const rect = viewRect(ref)
      if (!rect) return
      const node = el('div', 'sheet-ref')
      node.style.setProperty('--person', presenceColor(i))
      place(node, rect)
      boxes.push(node)
    })
    refLayer.replaceChildren(...boxes)
  }

  function placeBoxes() {
    const box = boxOf(sel)
    place(selBox, single(box) ? null : viewRect(box))
    place(activeBox, viewRect({ r1: sel.ar, c1: sel.ac, r2: sel.ar, c2: sel.ac }))
    place(copyBox, clip && clip.sheet === activeId ? viewRect(clip.box) : null)
    copyBox.classList.toggle('is-cut', !!clip?.cut)
    const corner = viewRect({ r1: box.r2, c1: box.c2, r2: box.r2, c2: box.c2 })
    handle.hidden = !corner || !!edit || coarse.matches
    if (corner) Object.assign(handle.style, { left: `${corner.left + corner.width}px`, top: `${corner.top + corner.height}px` })
    place(fillBox, drag?.kind === 'fill' && drag.to ? viewRect(drag.to) : null)
    placeEditor()
    placeRefs()
  }

  function renderRemote() {
    const boxes: HTMLElement[] = []
    for (const [clientId, state] of ctx.awareness.getStates()) {
      if (clientId === doc.clientID) continue
      const user = (state as { user?: Presence }).user
      const at = (state as { sheet?: RemoteSelection }).sheet
      if (!user || !at || at.sheet !== activeId) continue
      const rect = viewRect(at)
      if (!rect) continue
      const node = el('div', 'sheet-remote')
      node.style.setProperty('--person', user.color)
      place(node, rect)
      const label = el('span', '', node)
      label.textContent = user.name
      boxes.push(node)
    }
    remoteLayer.replaceChildren(...boxes)
  }

  function renderTabs() {
    const list = sheets.toArray()
    const key = JSON.stringify([activeId, list.map((s) => [idOf(s), nameOf(s)])])
    // 同じ内容なら作り直さないのは、ダブルクリックの 2 回目が別の要素に当たって名前の変更を始められなくなるため
    if (key === tabsKey || tabs.querySelector('input')) return
    tabsKey = key
    const items = list.map((s) => {
      const id = idOf(s)
      const active = id === activeId
      const item = el('div', 'sheet-tab-item')
      const b = el('button', 'sheet-tab', item)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', active ? 'true' : 'false')
      b.dataset.sheet = id
      b.textContent = nameOf(s)
      b.title = 'ダブルクリックで名前を変える'
      if (active) {
        const menu = el('button', 'sheet-tab-more', item)
        menu.type = 'button'
        menu.dataset.sheetMenu = id
        menu.setAttribute('aria-label', `シート「${nameOf(s)}」の操作`)
      }
      return item
    })
    const add = el('button', 'sheet-tab is-add')
    add.type = 'button'
    add.textContent = '＋'
    add.dataset.sheetAdd = ''
    add.setAttribute('aria-label', 'シートを追加')
    tabs.replaceChildren(...items, add)
  }

  function renderStatus() {
    const box = boxOf(sel)
    if (single(box)) {
      status.textContent = ''
      return
    }
    const s = sheet()
    const numbers: number[] = []
    let count = 0
    const visit = (r: number, c: number) => {
      count++
      const value = evaluator.value(s, r, c)
      if (typeof value === 'number') numbers.push(value)
    }
    const cells = cellsOf(s)
    if (areaOf(box) <= cells.size) {
      for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) if (cells.has(cellKey(r, c))) visit(r, c)
    } else
      for (const key of cells.keys()) {
        const { r, c } = parseKey(key)
        if (inBox(box, r, c)) visit(r, c)
      }
    const parts = [`データの個数: ${count}`]
    if (numbers.length) {
      const total = numbers.reduce((a, b) => a + b, 0)
      parts.unshift(`合計: ${formatGeneral(total)}`, `平均: ${formatGeneral(total / numbers.length)}`)
    }
    status.textContent = parts.join('　')
  }

  function syncToolbar() {
    const s = sheet()
    const style = stylesOf(s).get(cellKey(sel.ar, sel.ac))
    ctx.setPressed('bold', !!style?.b)
    ctx.setPressed('italic', !!style?.i)
    ctx.setPressed('underline', !!style?.u)
    ctx.setPressed('strike', !!style?.s)
    ctx.setPressed('wrap', !!style?.wrap)
    for (const align of ['left', 'center', 'right']) ctx.setPressed('align', style?.align === align, align)
    ctx.setValue('format', style?.fmt ?? '')
    ctx.setValue('fontSize', style?.fs ? String(style.fs) : '')
    const box = boxOf(sel)
    const name = single(box) ? cellName(sel.ar, sel.ac) : `${cellName(box.r1, box.c1)}:${cellName(box.r2, box.c2)}`
    if (nameBox && document.activeElement !== nameBox) nameBox.value = name
    input.setAttribute('aria-label', `セル ${cellName(sel.ar, sel.ac)} の入力`)
    if (formulaInput && document.activeElement !== formulaInput && !edit) formulaInput.value = rawOf(s, sel.ar, sel.ac)
  }

  function clampSelection(rows: number, cols: number) {
    const fits = sel.range && sel.range.r2 < rows && sel.range.c2 < cols
    sel = {
      ar: clamp(sel.ar, 0, rows - 1),
      ac: clamp(sel.ac, 0, cols - 1),
      fr: clamp(sel.fr, 0, rows - 1),
      fc: clamp(sel.fc, 0, cols - 1),
      ...(fits && { range: sel.range }),
    }
  }

  function announce() {
    ctx.awareness.setLocalStateField('sheet', { sheet: activeId, ...boxOf(sel) } satisfies RemoteSelection)
  }

  function scrollIntoView(r: number, c: number) {
    const L = layout()
    if (r >= L.fr) {
      const top = L.tops[r] - L.frozenH
      const bottom = L.tops[r + 1] - L.frozenH
      const view = grid.clientHeight - HEAD_H - L.frozenH
      if (top < grid.scrollTop) grid.scrollTop = top
      else if (bottom > grid.scrollTop + view) grid.scrollTop = bottom - view
    }
    if (c >= L.fc) {
      const left = L.lefts[c] - L.frozenW
      const right = L.lefts[c + 1] - L.frozenW
      const view = grid.clientWidth - ROW_HEAD_W - L.frozenW
      if (left < grid.scrollLeft) grid.scrollLeft = left
      else if (right > grid.scrollLeft + view) grid.scrollLeft = right - view
    }
  }

  function select(next: Selection, scroll = true) {
    const L = layout()
    sel = {
      ar: clamp(next.ar, 0, L.rows - 1),
      ac: clamp(next.ac, 0, L.cols - 1),
      fr: clamp(next.fr, 0, L.rows - 1),
      fc: clamp(next.fc, 0, L.cols - 1),
    }
    if (scroll) scrollIntoView(sel.fr, sel.fc)
    announce()
    schedule()
  }

  const moveTo = (r: number, c: number) => select({ ar: r, ac: c, fr: r, fc: c })

  function advance(dr: number, dc: number) {
    const box = boxOf(sel)
    if (single(box)) return moveTo(sel.ar + dr, sel.ac + dc)
    let { ar: r, ac: c } = sel
    if (dr) {
      r += dr
      if (r > box.r2 || r < box.r1) {
        r = dr > 0 ? box.r1 : box.r2
        c = c + dr > box.c2 ? box.c1 : c + dr < box.c1 ? box.c2 : c + dr
      }
    } else {
      c += dc
      if (c > box.c2 || c < box.c1) {
        c = dc > 0 ? box.c1 : box.c2
        r = r + dc > box.r2 ? box.r1 : r + dc < box.r1 ? box.r2 : r + dc
      }
    }
    scrollIntoView(r, c)
    sel = { ar: r, ac: c, fr: r, fc: c, range: box }
    announce()
    schedule()
  }

  function switchSheet(id: string, keepEdit = false) {
    if (id === activeId) return
    views.set(activeId, { sel, top: grid.scrollTop, left: grid.scrollLeft })
    activeId = id
    cachedLayout = null
    const view = views.get(id)
    sel = view?.sel ?? { ar: 0, ac: 0, fr: 0, fc: 0 }
    grid.scrollTo(view?.left ?? 0, view?.top ?? 0)
    if (!keepEdit) refPick = null
    announce()
    schedule()
  }

  // ---------------------------------------------------------------- 入力
  function setCell(s: SheetMap, r: number, c: number, raw: string) {
    const cells = cellsOf(s)
    if (raw === '') cells.delete(cellKey(r, c))
    else cells.set(cellKey(r, c), raw)
  }

  function setStyle(s: SheetMap, r: number, c: number, style: CellStyle | undefined) {
    const styles = stylesOf(s)
    const key = cellKey(r, c)
    if (style && Object.keys(style).length) styles.set(key, style)
    else if (styles.has(key)) styles.delete(key)
  }

  const field = () => (formulaInput && document.activeElement === formulaInput ? formulaInput : input)

  function syncFields(from: HTMLInputElement | HTMLTextAreaElement) {
    if (from !== input) input.value = from.value
    if (formulaInput && from !== formulaInput) formulaInput.value = from.value
    placeEditor()
    placeRefs()
    updateSuggest(from)
  }

  function startEdit(mode: Edit['mode'], initial?: string) {
    edit = { mode, sheet: activeId, r: sel.ar, c: sel.ac }
    input.value = initial ?? rawOf(sheet(), sel.ar, sel.ac)
    if (formulaInput) formulaInput.value = input.value
    placeBoxes()
    input.focus()
    if (mode === 'edit') input.setSelectionRange(input.value.length, input.value.length)
    updateSuggest(input)
  }

  function closeEdit() {
    const closing = edit
    edit = null
    refPick = null
    input.value = ''
    hideSuggest()
    if (closing && closing.sheet !== activeId) switchSheet(closing.sheet)
    return closing
  }

  function commit(dr: number, dc: number) {
    const value = closeParens(input.value)
    const target = closeEdit()
    if (!target) return
    const s = sheetById(target.sheet)
    if (s && value !== rawOf(s, target.r, target.c)) {
      const style = stylesOf(s).get(cellKey(target.r, target.c))
      const multiline = value.includes('\n') && !style?.wrap
      change(() => {
        setCell(s, target.r, target.c, value)
        if (multiline) setStyle(s, target.r, target.c, { ...style, wrap: 1 })
        if (multiline || style?.wrap || style?.fs) fitRow(s, target.r, multiline ? { c: target.c, wrap: true } : undefined)
      })
    }
    if (dr || dc) advance(dr, dc)
    else schedule()
  }

  function cancel() {
    closeEdit()
    if (formulaInput) formulaInput.value = rawOf(sheet(), sel.ar, sel.ac)
    schedule()
  }

  function canPick() {
    if (!edit) return false
    const f = field()
    if (!f.value.startsWith('=')) return false
    const caret = f.selectionStart ?? 0
    if (refPick && caret === refPick.end && f.value.slice(refPick.start, refPick.end) === refPick.text) return true
    return /[=+\-*/^&(,:<>]\s*$/.test(f.value.slice(0, caret))
  }

  function pickRef(ar: number, ac: number, fr: number, fc: number) {
    if (!edit) return
    const f = field()
    const box = boxOf({ ar, ac, fr, fc })
    const prefix = activeId === edit.sheet ? '' : sheetPrefix(nameOf(sheet()))
    const text = `${prefix}${cellName(box.r1, box.c1)}${single(box) ? '' : `:${cellName(box.r2, box.c2)}`}`
    const caret = f.selectionStart ?? f.value.length
    const replacing = refPick && caret === refPick.end && f.value.slice(refPick.start, refPick.end) === refPick.text
    const start = replacing ? refPick!.start : caret
    const end = replacing ? refPick!.end : (f.selectionEnd ?? caret)
    f.value = f.value.slice(0, start) + text + f.value.slice(end)
    f.setSelectionRange(start + text.length, start + text.length)
    refPick = { start, end: start + text.length, text, ar, ac, fr, fc }
    syncFields(f)
    hideSuggest()
  }

  // ---------------------------------------------------------------- 関数の候補
  function hideSuggest() {
    suggest = null
    suggestBox.hidden = true
  }

  function updateSuggest(f: HTMLInputElement | HTMLTextAreaElement) {
    const before = f.value.slice(0, f.selectionStart ?? f.value.length)
    const quotes = before.split('"').length - 1
    const m = f.value.startsWith('=') && quotes % 2 === 0 ? /(?:^=|[=+\-*/^&(,<>:\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before) : null
    const word = m?.[1].toUpperCase() ?? ''
    const items = word ? FUNCTION_NAMES.filter((name) => name.startsWith(word) && name !== word).slice(0, MAX_SUGGESTIONS) : []
    if (!items.length) return hideSuggest()
    suggest = { items, index: 0, start: before.length - word.length, moved: false }
    renderSuggest(f)
  }

  function renderSuggest(f: HTMLElement) {
    if (!suggest) return
    const { items, index } = suggest
    suggestBox.replaceChildren(
      ...items.map((name, i) => {
        const b = el('button', i === index ? 'sheet-suggest-item is-on' : 'sheet-suggest-item')
        b.type = 'button'
        b.dataset.fn = name
        b.textContent = name
        return b
      }),
    )
    suggestBox.hidden = false
    const rect = f.getBoundingClientRect()
    const host = wrap.getBoundingClientRect()
    suggestBox.style.left = `${Math.max(0, rect.left - host.left)}px`
    suggestBox.style.top = `${rect.bottom - host.top + 2}px`
  }

  function acceptSuggest(name: string) {
    if (!suggest) return
    const f = field()
    const caret = f.selectionStart ?? f.value.length
    const text = `${name}(`
    f.value = f.value.slice(0, suggest.start) + text + f.value.slice(caret)
    const at = suggest.start + text.length
    f.setSelectionRange(at, at)
    hideSuggest()
    syncFields(f)
  }

  suggestBox.addEventListener('pointerdown', (e) => {
    const name = (e.target as Element).closest<HTMLElement>('[data-fn]')?.dataset.fn
    e.preventDefault()
    if (name) acceptSuggest(name)
  })

  // ---------------------------------------------------------------- 書式
  function eachCell(fn: (r: number, c: number) => void) {
    const b = boxOf(sel)
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(r, c)
  }

  function tooManyCells() {
    if (areaOf(boxOf(sel)) <= MAX_STYLE_CELLS) return false
    ctx.toast(`書式を一度に変えられるのは ${MAX_STYLE_CELLS.toLocaleString('ja-JP')} セルまでです。`, 'error')
    return true
  }

  function styleSelection(patch: (style: CellStyle, r: number, c: number) => CellStyle, after?: (s: SheetMap, box: Box) => void) {
    if (tooManyCells()) return
    const s = sheet()
    const styles = stylesOf(s)
    change(() => {
      eachCell((r, c) => {
        const next = patch({ ...styles.get(cellKey(r, c)) }, r, c)
        setStyle(s, r, c, Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== '')) as CellStyle)
      })
      after?.(s, boxOf(sel))
    })
  }

  function toggle(flag: 'b' | 'i' | 'u' | 's') {
    const on = !stylesOf(sheet()).get(cellKey(sel.ar, sel.ac))?.[flag]
    styleSelection((st) => ({ ...st, [flag]: on ? 1 : undefined }))
  }

  const fitRows = (s: SheetMap, box: Box) => {
    if (box.r2 - box.r1 < MAX_FIT_ROWS) for (let r = box.r1; r <= box.r2; r++) fitRow(s, r)
  }

  function setBorders(kind: string | undefined) {
    const b = boxOf(sel)
    const merge = (st: CellStyle, sides: string) => {
      const have = new Set([...(st.bd ?? ''), ...sides])
      return { ...st, bd: [...'trbl'].filter((side) => have.has(side)).join('') || undefined }
    }
    styleSelection((st, r, c) => {
      if (kind === 'none') return { ...st, bd: undefined }
      if (kind === 'all') return merge(st, 'trbl')
      if (kind === 'bottom') return r === b.r2 ? merge(st, 'b') : st
      return merge(st, `${r === b.r1 ? 't' : ''}${c === b.c2 ? 'r' : ''}${r === b.r2 ? 'b' : ''}${c === b.c1 ? 'l' : ''}`)
    })
  }

  function fitRow(s: SheetMap, r: number, extra?: { c: number; wrap: boolean }) {
    const styles = stylesOf(s)
    const widths = widthsOf(s)
    let height = ROW_H
    for (let c = 0; c < colsOf(s); c++) {
      const key = cellKey(r, c)
      const style = styles.get(key)
      const wrapped = !!style?.wrap || (extra?.c === c && extra.wrap)
      if (!wrapped && !style?.fs) continue
      const text = shownText(s, r, c) || rawOf(s, r, c)
      if (!text) continue
      Object.assign(measureBox.style, {
        font: fontOf(style),
        whiteSpace: wrapped ? 'pre-wrap' : 'nowrap',
        width: wrapped ? `${(widths.get(String(c)) ?? DEFAULT_WIDTH) - CELL_PADDING}px` : 'auto',
      })
      measureBox.textContent = text
      height = Math.max(height, Math.ceil(measureBox.offsetHeight) + 6)
    }
    measureBox.textContent = ''
    const current = heightsOf(s)?.get(String(r)) ?? ROW_H
    const next = Math.min(MAX_HEIGHT, height)
    if (next !== current) setRowHeight(s, r, next)
  }

  function fitColumn(s: SheetMap, c: number) {
    const styles = stylesOf(s)
    let width = 0
    for (const key of cellsOf(s).keys()) {
      const at = parseKey(key)
      if (at.c !== c) continue
      for (const line of shownText(s, at.r, c).split('\n')) width = Math.max(width, textWidth(line, styles.get(key)))
    }
    const next = width ? clamp(Math.ceil(width) + CELL_PADDING + 4, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH
    if (next === DEFAULT_WIDTH) widthsOf(s).delete(String(c))
    else widthsOf(s).set(String(c), next)
  }

  function refitWrappedRows(s: SheetMap, cols: Set<number>) {
    const rows = new Set<number>()
    for (const [key, style] of stylesOf(s).entries()) {
      if (!style.wrap) continue
      const at = parseKey(key)
      if (cols.has(at.c)) rows.add(at.r)
    }
    if (rows.size <= MAX_FIT_ROWS) for (const r of rows) fitRow(s, r)
  }

  // ---------------------------------------------------------------- 消去・コピー・貼り付け
  function clearSelection() {
    const s = sheet()
    const box = boxOf(sel)
    const cells = cellsOf(s)
    change(() => {
      for (const key of Array.from(cells.keys())) {
        const { r, c } = parseKey(key)
        if (inBox(box, r, c)) cells.delete(key)
      }
    })
  }

  function clearFormats() {
    const s = sheet()
    const box = boxOf(sel)
    const styles = stylesOf(s)
    change(() => {
      for (const key of Array.from(styles.keys())) {
        const { r, c } = parseKey(key)
        if (inBox(box, r, c)) styles.delete(key)
      }
      fitRows(s, box)
    })
  }

  /** 使っている範囲に切り詰める。すべて選んだときに 200 万セルを読まないようにするため */
  function trimToUsed(s: SheetMap, b: Box): Box {
    if (areaOf(b) <= 10_000) return b
    let r2 = b.r1
    let c2 = b.c1
    for (const map of [cellsOf(s), stylesOf(s)] as Y.Map<unknown>[])
      for (const key of map.keys()) {
        const { r, c } = parseKey(key)
        if (!inBox(b, r, c)) continue
        r2 = Math.max(r2, r)
        c2 = Math.max(c2, c)
      }
    return { ...b, r2, c2 }
  }

  function makeClip(cut: boolean) {
    const s = sheet()
    const box = trimToUsed(s, boxOf(sel))
    const styles = stylesOf(s)
    const cells: ClipCell[][] = []
    for (let r = box.r1; r <= box.r2; r++) {
      const row: ClipCell[] = []
      for (let c = box.c1; c <= box.c2; c++) row.push({ raw: rawOf(s, r, c), style: styles.get(cellKey(r, c)) })
      cells.push(row)
    }
    const text = cells.map((row) => row.map((cell) => tsvField(cell.raw)).join('\t')).join('\n')
    clip = { sheet: activeId, box, text, cells, cut }
    schedule()
    return clip
  }

  const valueText = (v: Scalar) => (v === null ? '' : isError(v) ? v.error : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))

  function ensureSize(s: SheetMap, rows: number, cols: number) {
    if (rows > rowsOf(s)) s.set('rows', Math.min(MAX_ROWS, rows))
    if (cols > colsOf(s)) s.set('cols', Math.min(MAX_COLS, cols))
  }

  function pasteOwn(from: Clip, valuesOnly: boolean) {
    const s = sheet()
    const source = sheetById(from.sheet)
    const target = boxOf(sel)
    const h = from.cells.length
    const w = from.cells[0].length
    const tall = target.r2 - target.r1 + 1
    const wide = target.c2 - target.c1 + 1
    const repeatR = !from.cut && tall % h === 0 ? tall / h : 1
    const repeatC = !from.cut && wide % w === 0 ? wide / w : 1
    const rows = Math.min(h * repeatR, MAX_ROWS - target.r1)
    const cols = Math.min(w * repeatC, MAX_COLS - target.c1)
    const values =
      valuesOnly && source
        ? from.cells.map((row, i) => row.map((_, j) => valueText(evaluator.value(source, from.box.r1 + i, from.box.c1 + j))))
        : null
    change(() => {
      ensureSize(s, target.r1 + rows, target.c1 + cols)
      if (from.cut && source)
        for (let r = from.box.r1; r <= from.box.r2; r++)
          for (let c = from.box.c1; c <= from.box.c2; c++) {
            setCell(source, r, c, '')
            setStyle(source, r, c, undefined)
          }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const si = i % h
          const sj = j % w
          const cell = from.cells[si][sj]
          const r = target.r1 + i
          const c = target.c1 + j
          if (values) {
            setCell(s, r, c, values[si][sj])
            continue
          }
          setCell(s, r, c, from.cut ? cell.raw : movedRaw(cell.raw, r - (from.box.r1 + si), c - (from.box.c1 + sj)))
          setStyle(s, r, c, cell.style)
        }
    })
    if (from.cut) clip = null
    select({ ar: target.r1, ac: target.c1, fr: target.r1 + rows - 1, fc: target.c1 + cols - 1 }, false)
  }

  function pasteText(text: string) {
    const s = sheet()
    const rows = parseTsv(text)
    const target = boxOf(sel)
    if (rows.length === 1 && rows[0].length === 1) {
      if (areaOf(target) > MAX_STYLE_CELLS) return ctx.toast('貼り付ける範囲が広すぎます。', 'error')
      change(() => eachCell((r, c) => setCell(s, r, c, rows[0][0])))
      return
    }
    const height = Math.min(rows.length, MAX_ROWS - target.r1)
    const width = Math.min(Math.max(...rows.map((r) => r.length)), MAX_COLS - target.c1)
    change(() => {
      ensureSize(s, target.r1 + height, target.c1 + width)
      for (let i = 0; i < height; i++) rows[i].slice(0, width).forEach((v, j) => setCell(s, target.r1 + i, target.c1 + j, v))
    })
    select({ ar: target.r1, ac: target.c1, fr: target.r1 + height - 1, fc: target.c1 + width - 1 }, false)
  }

  function paste(text: string, valuesOnly = false) {
    if (clip && sameClipText(clip.text, text)) pasteOwn(clip, valuesOnly)
    else pasteText(text)
  }

  async function copyToClipboard(cut: boolean) {
    const made = makeClip(cut)
    await navigator.clipboard?.writeText(made.text).catch(() => undefined)
  }

  async function pasteFromClipboard(valuesOnly: boolean) {
    const text = await navigator.clipboard?.readText().catch(() => null)
    if (text) paste(text, valuesOnly)
    else if (clip) pasteOwn(clip, valuesOnly)
    else ctx.toast(`ブラウザが読み取りを許可していません。${modKey}V で貼り付けてください。`, 'error')
    focusGrid()
  }

  // ---------------------------------------------------------------- オートフィル
  function fillRange(from: Box, to: Box) {
    const s = sheet()
    const styles = stylesOf(s)
    const vertical = to.r1 !== from.r1 || to.r2 !== from.r2
    const lines = vertical ? [from.c1, from.c2] : [from.r1, from.r2]
    const [start, end] = vertical ? [from.r1, from.r2] : [from.c1, from.c2]
    const [toStart, toEnd] = vertical ? [to.r1, to.r2] : [to.c1, to.c2]
    const size = end - start + 1
    const mod = (n: number) => ((n % size) + size) % size
    change(() => {
      for (let line = lines[0]; line <= lines[1]; line++) {
        const at = (p: number) => (vertical ? { r: p, c: line } : { r: line, c: p })
        const raws: string[] = []
        for (let p = start; p <= end; p++) raws.push(rawOf(s, at(p).r, at(p).c))
        const series = fillSeries(raws)
        for (let p = toStart; p <= toEnd; p++) {
          if (p >= start && p <= end) continue
          const k = p - start
          const srcPos = start + mod(k)
          const src = at(srcPos)
          const dst = at(p)
          const raw = rawOf(s, src.r, src.c)
          const next = raw.startsWith('=') ? movedRaw(raw, dst.r - src.r, dst.c - src.c) : series(k)
          setCell(s, dst.r, dst.c, next)
          setStyle(s, dst.r, dst.c, styles.get(cellKey(src.r, src.c)))
        }
      }
    })
    select({ ar: to.r1, ac: to.c1, fr: to.r2, fc: to.c2 }, false)
  }

  function fillTarget(from: Box, r: number, c: number): Box | null {
    const down = r - from.r2
    const up = from.r1 - r
    const right = c - from.c2
    const left = from.c1 - c
    const most = Math.max(down, up, right, left)
    if (most <= 0) return null
    if (most === down) return { ...from, r2: r }
    if (most === up) return { ...from, r1: r }
    if (most === right) return { ...from, c2: c }
    return { ...from, c1: c }
  }

  function fillDownToData() {
    const s = sheet()
    const box = boxOf(sel)
    const neighbor = box.c1 > 0 && rawOf(s, box.r2 + 1, box.c1 - 1) ? box.c1 - 1 : box.c2 + 1
    let r = box.r2
    while (r + 1 < rowsOf(s) && rawOf(s, r + 1, neighbor)) r++
    if (r > box.r2) fillRange(box, { ...box, r2: r })
  }

  function fillFromEdge(vertical: boolean) {
    const box = boxOf(sel)
    if (vertical) {
      if (box.r1 === box.r2 && box.r1 > 0) fillRange({ ...box, r1: box.r1 - 1, r2: box.r1 - 1 }, box)
      else if (box.r2 > box.r1) fillRange({ ...box, r2: box.r1 }, box)
    } else if (box.c1 === box.c2 && box.c1 > 0) fillRange({ ...box, c1: box.c1 - 1, c2: box.c1 - 1 }, box)
    else if (box.c2 > box.c1) fillRange({ ...box, c2: box.c1 }, box)
  }

  // ---------------------------------------------------------------- 行と列
  function insertRows(at: number, count: number) {
    const s = sheet()
    if (count > 0 && rowsOf(s) + count > MAX_ROWS) return ctx.toast(`行は ${MAX_ROWS} 行までです。`, 'error')
    change(() => shiftCells(doc, s, 'row', at, count))
  }
  function insertCols(at: number, count: number) {
    const s = sheet()
    if (count > 0 && colsOf(s) + count > MAX_COLS) return ctx.toast(`列は ${MAX_COLS} 列までです。`, 'error')
    change(() => shiftCells(doc, s, 'col', at, count))
  }
  function deleteRows() {
    const b = boxOf(sel)
    const count = b.r2 - b.r1 + 1
    if (rowsOf(sheet()) <= count) return ctx.toast('すべての行は削除できません。', 'error')
    insertRows(b.r1, -count)
  }
  function deleteCols() {
    const b = boxOf(sel)
    const count = b.c2 - b.c1 + 1
    if (colsOf(sheet()) <= count) return ctx.toast('すべての列は削除できません。', 'error')
    insertCols(b.c1, -count)
  }

  function sortSelection(dir: 1 | -1) {
    const s = sheet()
    const box = trimToUsed(s, boxOf(sel))
    if (box.r1 === box.r2) return ctx.toast('並べ替える行を 2 行以上選んでください。', 'error')
    const styles = stylesOf(s)
    const key = clamp(sel.ac, box.c1, box.c2)
    const rows: { from: number; value: Scalar; cells: ClipCell[] }[] = []
    for (let r = box.r1; r <= box.r2; r++) {
      const cells: ClipCell[] = []
      for (let c = box.c1; c <= box.c2; c++) cells.push({ raw: rawOf(s, r, c), style: styles.get(cellKey(r, c)) })
      rows.push({ from: r, value: rawOf(s, r, key) ? evaluator.value(s, r, key) : null, cells })
    }
    rows.sort((a, b) => compareForSort(a.value, b.value, dir) || a.from - b.from)
    change(() =>
      rows.forEach((row, i) => {
        const r = box.r1 + i
        row.cells.forEach((cell, j) => {
          setCell(s, r, box.c1 + j, movedRaw(cell.raw, r - row.from, 0))
          setStyle(s, r, box.c1 + j, cell.style)
        })
      }),
    )
  }

  // ---------------------------------------------------------------- シート
  function uniqueName(base: string) {
    const names = new Set(sheets.toArray().map((s) => nameOf(s).toLowerCase()))
    for (let i = 1; ; i++) {
      const name = `${base}${i}`
      if (!names.has(name.toLowerCase())) return name
    }
  }

  const newSheetId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  function addSheet() {
    const id = newSheetId()
    change(() => sheets.push([newSheet(emptySheet(id, uniqueName('Sheet')))]))
    switchSheet(id)
    focusGrid()
  }

  function duplicateSheet(s: SheetMap) {
    const id = newSheetId()
    const index = sheets.toArray().indexOf(s)
    change(() => sheets.insert(index + 1, [newSheet({ ...sheetData(s), id, name: uniqueName(`${nameOf(s)} のコピー`) })]))
    switchSheet(id)
    focusGrid()
  }

  function shiftSheet(s: SheetMap, delta: number) {
    const from = sheets.toArray().indexOf(s)
    const to = from + delta
    if (from < 0 || to < 0 || to >= sheets.length) return
    change(() => moveSheet(doc, from, to))
    cachedLayout = null
    focusGrid()
  }

  function startRename(id: string) {
    const s = sheetById(id)
    const item = tabs.querySelector(`[data-sheet="${CSS.escape(id)}"]`)?.closest<HTMLElement>('.sheet-tab-item')
    if (!s || !item) return
    const form = el('input', 'sheet-tab-input')
    form.value = nameOf(s)
    form.maxLength = 31
    form.setAttribute('aria-label', 'シートの名前')
    item.replaceChildren(form)
    form.focus()
    form.select()
    let done = false
    const finish = (save: boolean) => {
      if (done) return
      done = true
      const name = form.value.trim()
      form.remove()
      tabsKey = ''
      if (save && name && name !== nameOf(s)) {
        if (/[[\]:*?/\\]/.test(name)) ctx.toast('シートの名前に [ ] : * ? / \\ は使えません。', 'error')
        else if (sheets.toArray().some((x) => x !== s && nameOf(x).toLowerCase() === name.toLowerCase()))
          ctx.toast('同じ名前のシートがあります。', 'error')
        else change(() => renameSheet(doc, s, name))
      }
      schedule()
      focusGrid()
    }
    form.addEventListener('keydown', (e) => {
      if (e.isComposing || (e.key !== 'Enter' && e.key !== 'Escape')) return
      // 既定の動作を止めないと、フォーカスを移したセルの入力欄に Enter の改行が入り、セルの中身を消してしまう
      e.preventDefault()
      finish(e.key === 'Enter')
    })
    form.addEventListener('blur', () => finish(true))
  }

  async function removeSheet(s: SheetMap, anchor: HTMLElement) {
    if (sheets.length < 2) return
    const ok = await ctx.confirmNear(anchor, [`シート「${nameOf(s)}」を削除しますか？`], { ok: '削除する', tone: 'danger' })
    if (!ok) return
    const index = sheets.toArray().indexOf(s)
    if (index < 0) return
    const removing = idOf(s)
    const next = idOf(sheets.get(index === 0 ? 1 : index - 1))
    if (removing === activeId) switchSheet(next)
    views.delete(removing)
    change(() => sheets.delete(index, 1))
    focusGrid()
  }

  function tabMenu(id: string, x: number, y: number, anchor: HTMLElement) {
    const s = sheetById(id)
    if (!s) return
    const index = sheets.toArray().indexOf(s)
    openMenu(
      [
        { label: '名前を変更', run: () => startRename(id) },
        { label: '複製', run: () => duplicateSheet(s) },
        { label: '左へ移動', run: () => shiftSheet(s, -1), disabled: index === 0 },
        { label: '右へ移動', run: () => shiftSheet(s, 1), disabled: index === sheets.length - 1 },
        'sep',
        { label: 'シートを削除', run: () => void removeSheet(s, anchor), danger: true, disabled: sheets.length < 2 },
      ],
      x,
      y,
    )
  }

  // 数式の入力中にシートを切り替えられるように、押した時点でセルからフォーカスを外さない
  tabs.addEventListener('mousedown', (e) => {
    if (canPick() && (e.target as Element).closest('[data-sheet]')) e.preventDefault()
  })
  tabs.addEventListener('click', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('button')
    if (!target) return
    if (target.dataset.sheet) {
      if (target.dataset.sheet !== activeId) switchSheet(target.dataset.sheet, canPick())
      if (!edit) focusGrid()
    } else if (target.dataset.sheetMenu) {
      const rect = target.getBoundingClientRect()
      tabMenu(target.dataset.sheetMenu, rect.left, rect.top, target)
    } else if (target.dataset.sheetAdd !== undefined) addSheet()
  })
  tabs.addEventListener('dblclick', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-sheet]')?.dataset.sheet
    if (id) startRename(id)
  })
  tabs.addEventListener('contextmenu', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-sheet]')
    if (!target?.dataset.sheet) return
    e.preventDefault()
    if (target.dataset.sheet !== activeId) switchSheet(target.dataset.sheet)
    tabMenu(target.dataset.sheet, e.clientX, e.clientY, target)
  })

  // ---------------------------------------------------------------- 右クリックのメニュー
  function openMenu(entries: MenuEntry[], x: number, y: number) {
    closeMenu?.()
    const menu = el('div', 'sheet-menu', wrap)
    menu.setAttribute('role', 'menu')
    entries.forEach((entry) => {
      if (entry === 'sep') return el('div', 'sheet-menu-sep', menu)
      const b = el('button', entry.danger ? 'menu-item is-danger' : 'menu-item', menu)
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.disabled = !!entry.disabled
      el('span', '', b).textContent = entry.label
      b.addEventListener('click', () => {
        closeMenu?.()
        entry.run()
        if (document.activeElement === document.body) focusGrid()
      })
    })
    menu.tabIndex = -1
    const margin = 8
    menu.style.left = `${clamp(x, margin, innerWidth - menu.offsetWidth - margin)}px`
    menu.style.top = `${y + menu.offsetHeight + margin > innerHeight ? Math.max(margin, y - menu.offsetHeight) : y}px`
    const onDown = (e: Event) => {
      if (!menu.contains(e.target as Node)) closeMenu?.()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? at + 1 : at <= 0 ? items.length - 1 : at - 1
        items[next % items.length]?.focus()
      }
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeMenu?.()
      focusGrid()
    }
    menu.addEventListener('mousedown', (e) => e.preventDefault())
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    closeMenu = () => {
      closeMenu = null
      menu.remove()
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
    // 先頭の項目に当てないのは、マウスで開いただけで最初の項目が選ばれたように見えるため
    menu.focus({ preventScroll: true })
  }

  function rowEntries(): MenuEntry[] {
    const b = boxOf(sel)
    const n = b.r2 - b.r1 + 1
    return [
      { label: `上に ${n} 行を挿入`, run: () => insertRows(b.r1, n) },
      { label: `下に ${n} 行を挿入`, run: () => insertRows(b.r2 + 1, n) },
      { label: `${n} 行を削除`, run: deleteRows, danger: true },
    ]
  }

  function colEntries(): MenuEntry[] {
    const b = boxOf(sel)
    const n = b.c2 - b.c1 + 1
    return [
      { label: `左に ${n} 列を挿入`, run: () => insertCols(b.c1, n) },
      { label: `右に ${n} 列を挿入`, run: () => insertCols(b.c2 + 1, n) },
      { label: `${n} 列を削除`, run: deleteCols, danger: true },
    ]
  }

  const clipboardEntries = (): MenuEntry[] => [
    { label: `切り取り（${modKey}X）`, run: () => void copyToClipboard(true) },
    { label: `コピー（${modKey}C）`, run: () => void copyToClipboard(false) },
    { label: `貼り付け（${modKey}V）`, run: () => void pasteFromClipboard(false) },
    { label: `値だけ貼り付け（⇧${modKey}V）`, run: () => void pasteFromClipboard(true) },
  ]

  const clearEntries = (): MenuEntry[] => [
    { label: '内容を消去', run: clearSelection },
    { label: '書式をクリア', run: clearFormats },
  ]

  grid.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    if (target === input && edit) return
    const col = target.closest<HTMLElement>('[data-col]')
    const row = target.closest<HTMLElement>('[data-row]')
    const onCell = target.closest('td[data-r]')
    if (!col && !row && !onCell) return
    e.preventDefault()
    if (edit) commit(0, 0)
    const L = layout()
    const box = boxOf(sel)
    let entries: MenuEntry[]
    if (col) {
      const c = Number(col.dataset.col)
      if (!(box.r1 === 0 && box.r2 === L.rows - 1 && c >= box.c1 && c <= box.c2)) select({ ar: 0, ac: c, fr: L.rows - 1, fc: c }, false)
      const s = sheet()
      const picked = boxOf(sel)
      entries = [
        ...clipboardEntries(),
        'sep',
        ...colEntries(),
        'sep',
        {
          label: '幅を中身に合わせる',
          run: () =>
            change(() => {
              for (let i = picked.c1; i <= picked.c2; i++) fitColumn(s, i)
            }),
        },
        ...clearEntries(),
      ]
    } else if (row) {
      const r = Number(row.dataset.row)
      if (!(box.c1 === 0 && box.c2 === L.cols - 1 && r >= box.r1 && r <= box.r2)) select({ ar: r, ac: 0, fr: r, fc: L.cols - 1 }, false)
      const s = sheet()
      const picked = boxOf(sel)
      entries = [
        ...clipboardEntries(),
        'sep',
        ...rowEntries(),
        'sep',
        { label: '高さを中身に合わせる', run: () => change(() => fitRows(s, picked)) },
        ...clearEntries(),
      ]
    } else {
      const at = cellFromPoint(e.clientX, e.clientY)
      if (!inBox(box, at.r, at.c)) moveToNoScroll(at.r, at.c)
      entries = [...clipboardEntries(), 'sep', ...rowEntries(), ...colEntries(), 'sep', ...clearEntries()]
    }
    openMenu(entries, e.clientX, e.clientY)
  })

  const moveToNoScroll = (r: number, c: number) => select({ ar: r, ac: c, fr: r, fc: c }, false)

  // ---------------------------------------------------------------- マウス
  function cellFromPoint(x: number, y: number) {
    const L = layout()
    const rect = grid.getBoundingClientRect()
    const vx = x - rect.left - ROW_HEAD_W
    const vy = y - rect.top - HEAD_H
    const px = vx < L.frozenW && L.fc ? Math.max(0, vx) : vx + grid.scrollLeft
    const py = vy < L.frozenH && L.fr ? Math.max(0, vy) : vy + grid.scrollTop
    return { r: indexAt(L.tops, Math.max(0, py)), c: indexAt(L.lefts, Math.max(0, px)) }
  }

  function autoScroll() {
    const L = layout()
    const rect = grid.getBoundingClientRect()
    const speed = (distance: number) => Math.min(40, Math.ceil(distance / 2))
    const top = rect.top + HEAD_H + L.frozenH
    const left = rect.left + ROW_HEAD_W + L.frozenW
    const right = rect.left + grid.clientWidth
    const bottom = rect.top + grid.clientHeight
    if (drag?.kind !== 'cols') {
      if (pointer.y < top + SCROLL_EDGE && grid.scrollTop > 0 && pointer.y < top) grid.scrollTop -= speed(top - pointer.y)
      else if (pointer.y > bottom - SCROLL_EDGE) grid.scrollTop += speed(pointer.y - (bottom - SCROLL_EDGE))
    }
    if (drag?.kind !== 'rows') {
      if (pointer.x < left && grid.scrollLeft > 0) grid.scrollLeft -= speed(left - pointer.x)
      else if (pointer.x > right - SCROLL_EDGE) grid.scrollLeft += speed(pointer.x - (right - SCROLL_EDGE))
    }
  }

  function applyDrag() {
    if (!drag) return
    const at = cellFromPoint(pointer.x, pointer.y)
    if (drag.kind === 'cells' && (at.r !== sel.fr || at.c !== sel.fc)) select({ ...sel, fr: at.r, fc: at.c }, false)
    else if (drag.kind === 'cols' && at.c !== sel.fc) select({ ...sel, fc: at.c }, false)
    else if (drag.kind === 'rows' && at.r !== sel.fr) select({ ...sel, fr: at.r }, false)
    else if (drag.kind === 'ref' && refPick && (at.r !== refPick.fr || at.c !== refPick.fc)) pickRef(drag.ar, drag.ac, at.r, at.c)
    else if (drag.kind === 'fill') {
      drag.to = fillTarget(drag.from, at.r, at.c)
      place(fillBox, drag.to ? viewRect(drag.to) : null)
    }
  }

  function dragLoop() {
    if (!drag) return
    autoScroll()
    applyDrag()
    dragFrame = requestAnimationFrame(dragLoop)
  }

  function startDrag(next: Drag, e: PointerEvent) {
    drag = next
    pointer = { x: e.clientX, y: e.clientY }
    grid.setPointerCapture(e.pointerId)
    cancelAnimationFrame(dragFrame)
    dragFrame = requestAnimationFrame(dragLoop)
  }

  function endDrag() {
    const ended = drag
    drag = null
    cancelAnimationFrame(dragFrame)
    if (ended?.kind === 'fill') {
      fillBox.hidden = true
      if (ended.to) fillRange(ended.from, ended.to)
    }
  }

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (isMac && e.ctrlKey)) return
    const target = e.target as HTMLElement
    if (target === input || target.closest('.sheet-more')) return
    // タッチでは押した時点で選ばないのは、スクロールしようとしただけでセルが動き、キーボードまで開いてしまうため
    if (e.pointerType === 'touch') return
    const resize = target.closest<HTMLElement>('[data-resize]')
    if (resize) return startResize(e, Number(resize.dataset.resize))
    const resizeRow = target.closest<HTMLElement>('[data-resize-row]')
    if (resizeRow) return startRowResize(e, Number(resizeRow.dataset.resizeRow))
    const L = layout()
    if (target === handle) {
      e.preventDefault()
      startDrag({ kind: 'fill', from: boxOf(sel), to: null }, e)
      return
    }
    const col = target.closest<HTMLElement>('[data-col]')
    const row = target.closest<HTMLElement>('[data-row]')
    if (target.closest('[data-all]')) {
      if (edit) commit(0, 0)
      select({ ar: 0, ac: 0, fr: L.rows - 1, fc: L.cols - 1 }, false)
    } else if (col) {
      if (edit) commit(0, 0)
      const c = Number(col.dataset.col)
      select({ ar: 0, ac: e.shiftKey ? sel.ac : c, fr: L.rows - 1, fc: c }, false)
      startDrag({ kind: 'cols' }, e)
    } else if (row) {
      if (edit) commit(0, 0)
      const r = Number(row.dataset.row)
      select({ ar: e.shiftKey ? sel.ar : r, ac: 0, fr: r, fc: L.cols - 1 }, false)
      startDrag({ kind: 'rows' }, e)
    } else {
      if (!target.closest('td[data-r]')) return
      const at = cellFromPoint(e.clientX, e.clientY)
      if (canPick()) {
        e.preventDefault()
        const base = e.shiftKey && refPick ? { ar: refPick.ar, ac: refPick.ac } : { ar: at.r, ac: at.c }
        pickRef(base.ar, base.ac, at.r, at.c)
        startDrag({ kind: 'ref', ...base }, e)
        return
      }
      if (edit) commit(0, 0)
      select(e.shiftKey ? { ...sel, fr: at.r, fc: at.c } : { ar: at.r, ac: at.c, fr: at.r, fc: at.c }, false)
      startDrag({ kind: 'cells' }, e)
    }
    e.preventDefault()
    input.focus({ preventScroll: true })
  })
  grid.addEventListener('pointermove', (e) => {
    if (drag) pointer = { x: e.clientX, y: e.clientY }
  })
  grid.addEventListener('pointerup', endDrag)
  grid.addEventListener('pointercancel', endDrag)

  grid.addEventListener('click', (e) => {
    if ((e as PointerEvent).pointerType !== 'touch') return
    const target = e.target as HTMLElement
    if (target === input || target.closest('.sheet-more')) return
    const L = layout()
    const col = target.closest<HTMLElement>('[data-col]')
    const row = target.closest<HTMLElement>('[data-row]')
    if (edit && !canPick()) commit(0, 0)
    if (col) select({ ar: 0, ac: Number(col.dataset.col), fr: L.rows - 1, fc: Number(col.dataset.col) }, false)
    else if (row) select({ ar: Number(row.dataset.row), ac: 0, fr: Number(row.dataset.row), fc: L.cols - 1 }, false)
    else if (target.closest('td[data-r]')) {
      const at = cellFromPoint(e.clientX, e.clientY)
      if (canPick()) pickRef(at.r, at.c, at.r, at.c)
      else if (at.r === sel.ar && at.c === sel.ac && single(boxOf(sel))) startEdit('edit')
      else moveToNoScroll(at.r, at.c)
    }
  })

  // e.target を使わないのは、押したときにポインターを表に取り込むので、ダブルクリックの対象がいつも表そのものになるため
  grid.addEventListener('dblclick', (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const s = sheet()
    const resize = hit?.closest<HTMLElement>('[data-resize]')
    const resizeRow = hit?.closest<HTMLElement>('[data-resize-row]')
    if (hit === handle) fillDownToData()
    else if (resize) {
      const c = Number(resize.dataset.resize)
      change(() => {
        fitColumn(s, c)
        refitWrappedRows(s, new Set([c]))
      })
    } else if (resizeRow) change(() => fitRow(s, Number(resizeRow.dataset.resizeRow)))
    else if (hit?.closest('td[data-r]') && !edit) startEdit('edit')
  })
  grid.addEventListener('scroll', schedule, { passive: true })

  function resizeTargets(picked: number, from: number, to: number, whole: boolean) {
    const targets: number[] = []
    if (whole && picked >= from && picked <= to) for (let i = from; i <= to; i++) targets.push(i)
    else targets.push(picked)
    return targets
  }

  function startResize(e: PointerEvent, c: number) {
    e.preventDefault()
    e.stopPropagation()
    const s = sheet()
    const L = layout()
    const box = boxOf(sel)
    const targets = resizeTargets(c, box.c1, box.c2, box.r1 === 0 && box.r2 === L.rows - 1)
    const startX = e.clientX
    const startW = L.lefts[c + 1] - L.lefts[c]
    const col = table.querySelectorAll('col')[c + 1] as HTMLElement | undefined
    let width = startW
    const move = (ev: PointerEvent) => {
      width = clamp(startW + ev.clientX - startX, MIN_WIDTH, MAX_WIDTH)
      if (col) col.style.width = `${width}px`
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (width === startW) return
      change(() => {
        for (const i of targets) widthsOf(s).set(String(i), Math.round(width))
        refitWrappedRows(s, new Set(targets))
      })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  function startRowResize(e: PointerEvent, r: number) {
    e.preventDefault()
    e.stopPropagation()
    const s = sheet()
    const L = layout()
    const box = boxOf(sel)
    const targets = resizeTargets(r, box.r1, box.r2, box.c1 === 0 && box.c2 === L.cols - 1)
    const startY = e.clientY
    const startH = L.tops[r + 1] - L.tops[r]
    const tr = (e.target as Element).closest('tr')
    let height = startH
    const move = (ev: PointerEvent) => {
      height = clamp(startH + ev.clientY - startY, ROW_H, MAX_HEIGHT)
      if (tr) tr.style.height = `${height}px`
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (height === startH) return
      change(() => {
        for (const i of targets) setRowHeight(s, i, Math.round(height))
      })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  moreBtn.addEventListener('click', () => {
    const s = sheet()
    change(() => s.set('rows', Math.min(MAX_ROWS, rowsOf(s) + 100)))
  })

  // ---------------------------------------------------------------- キーボード
  const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }

  function jumpFrom(r: number, c: number, dr: number, dc: number) {
    const s = sheet()
    const L = layout()
    const filled = (rr: number, cc: number) => !!rawOf(s, rr, cc)
    const inside = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < L.rows && cc < L.cols
    let nr = r + dr
    let nc = c + dc
    if (!inside(nr, nc)) return { r, c }
    if (filled(r, c) && filled(nr, nc)) {
      while (inside(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) {
        nr += dr
        nc += dc
      }
    } else {
      while (inside(nr + dr, nc + dc) && !filled(nr, nc)) {
        nr += dr
        nc += dc
      }
    }
    return { r: nr, c: nc }
  }

  function lastUsedCell(s: SheetMap) {
    let r = 0
    let c = 0
    for (const key of cellsOf(s).keys()) {
      const at = parseKey(key)
      r = Math.max(r, at.r)
      c = Math.max(c, at.c)
    }
    return { r, c }
  }

  function navKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const s = sheet()
    const L = layout()
    const go = (r: number, c: number) => (e.shiftKey ? select({ ...sel, fr: r, fc: c }) : moveTo(r, c))
    const handled = () => e.preventDefault()
    if (ARROWS[e.key]) {
      handled()
      const [dr, dc] = ARROWS[e.key]
      const to = mod ? jumpFrom(sel.fr, sel.fc, dr, dc) : { r: sel.fr + dr, c: sel.fc + dc }
      go(to.r, to.c)
    } else if (e.key === 'Tab') {
      handled()
      advance(0, e.shiftKey ? -1 : 1)
    } else if (e.key === 'Enter') {
      handled()
      if (mod) return startEdit('edit')
      advance(e.shiftKey ? -1 : 1, 0)
    } else if (e.key === 'F2') {
      handled()
      startEdit('edit')
    } else if (e.key === 'Escape') {
      if (clip) {
        clip = null
        schedule()
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      handled()
      clearSelection()
    } else if (e.key === 'Home') {
      handled()
      go(mod ? 0 : sel.fr, 0)
    } else if (e.key === 'End') {
      handled()
      const last = lastUsedCell(s)
      go(mod ? last.r : sel.fr, last.c)
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      handled()
      const page = Math.max(1, Math.floor((grid.clientHeight - HEAD_H - L.frozenH) / ROW_H) - 1)
      go(sel.fr + (e.key === 'PageDown' ? page : -page), sel.fc)
    } else if (!mod) return
    else if (key === 'z') {
      handled()
      if (e.shiftKey) undo.redo()
      else undo.undo()
    } else if (key === 'y') {
      handled()
      undo.redo()
    } else if (key === 'b' || key === 'i' || key === 'u') {
      handled()
      toggle(key)
    } else if (key === 'a') {
      handled()
      select({ ar: 0, ac: 0, fr: L.rows - 1, fc: L.cols - 1 }, false)
    } else if (key === 'd') {
      handled()
      fillFromEdge(true)
    } else if (key === 'r') {
      handled()
      fillFromEdge(false)
    } else if (key === 'f') {
      handled()
      openFind()
    } else if (key === 's') {
      handled()
    } else if (key === 'v' && e.shiftKey) {
      // paste イベントを待たないのは、⇧ 付きの貼り付けで paste が届くかがブラウザによって違うため
      handled()
      void pasteFromClipboard(true)
    }
  }

  function moveSuggest(delta: number) {
    if (!suggest) return
    suggest.index = (suggest.index + delta + suggest.items.length) % suggest.items.length
    suggest.moved = true
    renderSuggest(field())
  }

  function editKey(e: KeyboardEvent) {
    const f = field()
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        return moveSuggest(e.key === 'ArrowDown' ? 1 : -1)
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggest.moved)) {
        e.preventDefault()
        return acceptSuggest(suggest.items[suggest.index])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return hideSuggest()
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.altKey || e.ctrlKey) {
        const a = f.selectionStart ?? f.value.length
        f.value = `${f.value.slice(0, a)}\n${f.value.slice(f.selectionEnd ?? a)}`
        f.setSelectionRange(a + 1, a + 1)
        return syncFields(f)
      }
      commit(e.shiftKey ? -1 : 1, 0)
      focusGrid()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit(0, e.shiftKey ? -1 : 1)
      focusGrid()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      focusGrid()
    } else if (ARROWS[e.key]) {
      const [dr, dc] = ARROWS[e.key]
      if (canPick()) {
        e.preventDefault()
        const base = refPick ?? { ar: edit!.r, ac: edit!.c, fr: edit!.r, fc: edit!.c }
        const L = layout()
        const r = clamp(base.fr + dr, 0, L.rows - 1)
        const c = clamp(base.fc + dc, 0, L.cols - 1)
        if (e.shiftKey) pickRef(base.ar, base.ac, r, c)
        else pickRef(r, c, r, c)
        scrollIntoView(r, c)
      } else if (edit?.mode === 'enter' && f === input) {
        e.preventDefault()
        commit(dr, dc)
      }
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (edit) editKey(e)
    else navKey(e)
  })

  function beginTyping() {
    if (edit) return
    edit = { mode: 'enter', sheet: activeId, r: sel.ar, c: sel.ac }
    placeBoxes()
  }

  // 打った文字で入力を始めるのは、日本語入力の変換中の文字も、確定前からセルに見せるため（keydown では変換中の文字が分からない）
  input.addEventListener('input', () => {
    beginTyping()
    syncFields(input)
  })
  input.addEventListener('compositionstart', beginTyping)
  input.addEventListener('click', () => updateSuggest(input))
  input.addEventListener('blur', (e) => {
    if (edit && e.relatedTarget !== formulaInput && document.hasFocus()) commit(0, 0)
  })
  input.addEventListener('copy', (e) => {
    if (edit) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', makeClip(false).text)
  })
  input.addEventListener('cut', (e) => {
    if (edit) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', makeClip(true).text)
  })
  input.addEventListener('paste', (e) => {
    if (edit) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain')
    if (text) paste(text)
  })

  formulaInput?.addEventListener('focus', () => {
    if (edit) return
    edit = { mode: 'edit', sheet: activeId, r: sel.ar, c: sel.ac }
    input.value = rawOf(sheet(), sel.ar, sel.ac)
    formulaInput.value = input.value
    placeBoxes()
  })
  formulaInput?.addEventListener('input', () => {
    if (!edit) edit = { mode: 'edit', sheet: activeId, r: sel.ar, c: sel.ac }
    syncFields(formulaInput)
  })
  formulaInput?.addEventListener('keydown', (e) => {
    if (e.isComposing || !edit) return
    editKey(e)
  })
  formulaInput?.addEventListener('blur', (e) => {
    if (edit && e.relatedTarget !== input && document.hasFocus()) commit(0, 0)
  })

  nameBox?.addEventListener('focus', () => nameBox.select())
  nameBox?.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      schedule()
      return focusGrid()
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const [a, b] = nameBox.value.split(':')
    const p = parseCellName(a ?? '')
    const q = b ? parseCellName(b) : p
    if (!p || !q) return ctx.toast('セルの場所が正しくありません。', 'error')
    select({ ar: p.r, ac: p.c, fr: q.r, fc: q.c })
    nameBox.blur()
    focusGrid()
  })

  // ---------------------------------------------------------------- 検索と置換
  type Match = { r: number; c: number }

  function findMatches(): Match[] {
    const needle = findInput.value.toLowerCase()
    if (!needle) return []
    const s = sheet()
    const out: Match[] = []
    for (const [key, raw] of cellsOf(s).entries()) {
      const at = parseKey(key)
      if (raw.toLowerCase().includes(needle) || shownText(s, at.r, at.c).toLowerCase().includes(needle)) out.push(at)
    }
    return out.sort((a, b) => a.r - b.r || a.c - b.c)
  }

  function updateFindCount(matches: Match[]) {
    const i = matches.findIndex((m) => m.r === sel.ar && m.c === sel.ac)
    findCount.textContent = !findInput.value ? '' : matches.length ? `${i < 0 ? '-' : i + 1} / ${matches.length}` : '見つかりません'
  }

  function findStep(dir: 1 | -1) {
    const matches = findMatches()
    if (matches.length) {
      const after = (m: Match) => m.r > sel.ar || (m.r === sel.ar && m.c > sel.ac)
      const before = (m: Match) => m.r < sel.ar || (m.r === sel.ar && m.c < sel.ac)
      const next = dir > 0 ? (matches.find(after) ?? matches[0]) : (matches.findLast(before) ?? matches[matches.length - 1])
      moveTo(next.r, next.c)
    }
    updateFindCount(matches)
  }

  const findPattern = () => new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

  function replaceCurrent() {
    const s = sheet()
    const raw = rawOf(s, sel.ar, sel.ac)
    if (findInput.value && findPattern().test(raw)) {
      const next = raw.replace(findPattern(), () => replaceInput.value)
      change(() => setCell(s, sel.ar, sel.ac, next))
    }
    findStep(1)
  }

  function replaceEverything() {
    if (!findInput.value) return
    const s = sheet()
    let count = 0
    change(() => {
      for (const [key, raw] of Array.from(cellsOf(s).entries())) {
        if (!findPattern().test(raw)) continue
        cellsOf(s).set(
          key,
          raw.replace(findPattern(), () => replaceInput.value),
        )
        count++
      }
    })
    ctx.toast(count ? `${count} 件を置換しました。` : '置換するものは見つかりませんでした。', count ? 'success' : 'info')
    updateFindCount(findMatches())
  }

  function openFind() {
    findBar.hidden = false
    findInput.focus()
    findInput.select()
    updateFindCount(findMatches())
  }

  function closeFind() {
    findBar.hidden = true
    focusGrid()
  }

  findBar.addEventListener('submit', (e) => e.preventDefault())
  findBar.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.target === replaceInput) replaceCurrent()
      else findStep(e.shiftKey ? -1 : 1)
    }
  })
  findInput.addEventListener('input', () => updateFindCount(findMatches()))
  findPrev.addEventListener('click', () => findStep(-1))
  findNext.addEventListener('click', () => findStep(1))
  replaceOne.addEventListener('click', replaceCurrent)
  replaceAll.addEventListener('click', replaceEverything)
  findClose.addEventListener('click', closeFind)

  // ---------------------------------------------------------------- 同期
  const onChange = () => {
    cachedLayout = null
    evaluator = createEvaluator(doc)
    schedule()
  }
  sheets.observeDeep(onChange)
  ctx.awareness.on('change', schedule)
  const resize = new ResizeObserver(schedule)
  resize.observe(grid)
  announce()
  render()
  focusGrid()

  function command(cmd: string, value: string | undefined) {
    const s = sheet()
    const b = boxOf(sel)
    switch (cmd) {
      case 'bold':
        return toggle('b')
      case 'italic':
        return toggle('i')
      case 'underline':
        return toggle('u')
      case 'strike':
        return toggle('s')
      case 'color':
        return value && styleSelection((st) => ({ ...st, color: value }))
      case 'fill':
        return value && styleSelection((st) => ({ ...st, fill: value }))
      case 'border':
        return setBorders(value)
      case 'fontSize': {
        const fs = Number(value) || undefined
        return styleSelection((st) => ({ ...st, fs }), fitRows)
      }
      case 'wrap': {
        const on = !stylesOf(s).get(cellKey(sel.ar, sel.ac))?.wrap
        return styleSelection((st) => ({ ...st, wrap: on ? 1 : undefined }), fitRows)
      }
      case 'align': {
        const current = stylesOf(s).get(cellKey(sel.ar, sel.ac))?.align
        const align = value === 'left' || value === 'center' || value === 'right' ? value : undefined
        return styleSelection((st) => ({ ...st, align: current === align ? undefined : align }))
      }
      case 'format': {
        const fmt = (SHEET_FORMATS as readonly string[]).includes(value ?? '') ? (value as SheetFormat) : ''
        return styleSelection((st) => ({ ...st, fmt: fmt || undefined }))
      }
      case 'rowAbove':
        return insertRows(b.r1, b.r2 - b.r1 + 1)
      case 'rowBelow':
        return insertRows(b.r2 + 1, b.r2 - b.r1 + 1)
      case 'colLeft':
        return insertCols(b.c1, b.c2 - b.c1 + 1)
      case 'colRight':
        return insertCols(b.c2 + 1, b.c2 - b.c1 + 1)
      case 'rowDelete':
        return deleteRows()
      case 'colDelete':
        return deleteCols()
      case 'sort':
        return sortSelection(value === 'desc' ? -1 : 1)
      case 'freezeRows':
        return change(() => s.set('frozenRows', b.r2 + 1))
      case 'freezeCols':
        return change(() => s.set('frozenCols', b.c2 + 1))
      case 'unfreeze':
        return change(() => {
          s.set('frozenRows', 0)
          s.set('frozenCols', 0)
        })
      case 'clear':
        return clearSelection()
      case 'clearFormat':
        return clearFormats()
    }
  }

  return {
    command: (cmd, value) => {
      if (cmd === 'find') return openFind()
      if (edit) commit(0, 0)
      command(cmd, value)
      focusGrid()
    },
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    async exportFile() {
      const { sheetsToXlsx } = await import('./xlsx')
      return sheetsToXlsx(doc)
    },
    async importFile(file) {
      const { xlsxToSheets } = await import('./xlsx')
      const data = await xlsxToSheets(file)
      change(() => replaceSheets(doc, data))
      views.clear()
      clip = null
      activeId = data[0]?.id ?? activeId
      cachedLayout = null
      // 履歴に積まないのは、高さの調整だけが「元に戻す」の 1 回分になってしまうため
      doc.transact(() => {
        for (const s of sheets.toArray()) {
          const rows = new Set<number>()
          for (const [key, style] of stylesOf(s).entries()) if (style.wrap || style.fs) rows.add(parseKey(key).r)
          if (rows.size > MAX_FIT_ROWS) continue
          for (const r of rows) if (!heightsOf(s)?.has(String(r))) fitRow(s, r)
        }
      })
      moveTo(0, 0)
    },
    destroy() {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(dragFrame)
      closeMenu?.()
      sheets.unobserveDeep(onChange)
      ctx.awareness.off('change', schedule)
      resize.disconnect()
      undo.destroy()
    },
  }
}
