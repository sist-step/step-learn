/// <reference lib="dom" />
import * as Y from 'yjs'
import type { CollabEditor, EditorContext, Presence } from './app'
import { cellName, colName, moveFormula, parseCellName } from './formula'
import {
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
  idOf,
  nameOf,
  naturalAlign,
  newSheet,
  rowsOf,
  sheetsOf,
  shiftCells,
  stylesOf,
  widthsOf,
  type CellStyle,
  type SheetFormat,
  type SheetMap,
} from './sheet-model'

const ROW_H = 26
const HEAD_H = 26
const ROW_HEAD_W = 48
const OVERSCAN = 8
const MIN_WIDTH = 24

type Selection = { ar: number; ac: number; fr: number; fc: number }
type Box = { r1: number; c1: number; r2: number; c2: number }
type RemoteSelection = { sheet: string } & Box

const boxOf = (s: Selection): Box => ({
  r1: Math.min(s.ar, s.fr),
  c1: Math.min(s.ac, s.fc),
  r2: Math.max(s.ar, s.fr),
  c2: Math.max(s.ac, s.fc),
})

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

function cssOf(style: CellStyle | undefined, align: string) {
  const parts = [`text-align:${style?.align ?? align}`]
  if (style?.b) parts.push('font-weight:700')
  if (style?.i) parts.push('font-style:italic')
  if (style?.u) parts.push('text-decoration:underline')
  if (isColor(style?.color)) parts.push(`color:${style.color}`)
  if (isColor(style?.fill)) parts.push(`background:${style.fill}`)
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

export function mount(ctx: EditorContext): CollabEditor {
  const { doc } = ctx
  const ORIGIN = 'sheet-local'
  ensureSheet(doc)
  const sheets = sheetsOf(doc)
  const undo = new Y.UndoManager(sheets, { trackedOrigins: new Set([ORIGIN]), captureTimeout: 500 })
  const change = (fn: () => void) => doc.transact(fn, ORIGIN)

  let activeId = idOf(sheets.get(0))
  let sel: Selection = { ar: 0, ac: 0, fr: 0, fc: 0 }
  let editing: null | 'enter' | 'edit' = null
  let evaluator = createEvaluator(doc)
  let lastCopy: { text: string; r: number; c: number } | null = null

  // ---------------------------------------------------------------- DOM
  const wrap = document.createElement('div')
  wrap.className = 'sheet-wrap'
  const grid = document.createElement('div')
  grid.className = 'sheet-grid'
  const table = document.createElement('table')
  table.className = 'sheet-table'
  const layer = document.createElement('div')
  layer.className = 'sheet-layer'
  const selBox = document.createElement('div')
  selBox.className = 'sheet-sel'
  const activeBox = document.createElement('div')
  activeBox.className = 'sheet-active'
  const remoteLayer = document.createElement('div')
  const input = document.createElement('textarea')
  input.className = 'sheet-input'
  input.setAttribute('aria-label', 'セルの入力')
  input.spellcheck = false
  input.autocapitalize = 'off'
  layer.append(selBox, remoteLayer, activeBox, input)
  grid.append(table, layer)
  const more = document.createElement('div')
  more.className = 'sheet-more'
  const moreBtn = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'btn btn-ghost btn-sm',
    textContent: '＋ 100 行を追加',
  })
  more.append(moreBtn)
  grid.append(more)
  const tabs = document.createElement('div')
  tabs.className = 'sheet-tabs'
  tabs.setAttribute('role', 'tablist')
  wrap.append(grid, tabs)
  ctx.stage.replaceChildren(wrap)

  const nameBox = ctx.root.querySelector<HTMLInputElement>('[data-sheet-name-box]')
  const formulaInput = ctx.root.querySelector<HTMLInputElement>('[data-sheet-formula]')

  const sheet = () => sheets.toArray().find((s) => idOf(s) === activeId) ?? sheets.get(0)
  const widthOf = (s: SheetMap, c: number) => widthsOf(s).get(String(c)) ?? DEFAULT_WIDTH
  function colLeft(s: SheetMap, c: number) {
    let x = 0
    for (let i = 0; i < c; i++) x += widthOf(s, i)
    return x
  }
  const rawOf = (s: SheetMap, r: number, c: number) => cellsOf(s).get(cellKey(r, c)) ?? ''

  // ---------------------------------------------------------------- 描画
  let frame = 0
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render)
  }

  function render() {
    frame = 0
    const s = sheet()
    if (idOf(s) !== activeId) activeId = idOf(s)
    const rows = rowsOf(s)
    const cols = colsOf(s)
    clampSelection(rows, cols)
    const first = Math.max(0, Math.floor((grid.scrollTop - HEAD_H) / ROW_H) - OVERSCAN)
    const last = Math.min(rows - 1, Math.ceil((grid.scrollTop + grid.clientHeight) / ROW_H) + OVERSCAN)
    const box = boxOf(sel)
    const widths = Array.from({ length: cols }, (_, c) => widthOf(s, c))
    const total = widths.reduce((a, b) => a + b, ROW_HEAD_W)
    const head = widths
      .map(
        (w, c) =>
          `<th class="sheet-col${c >= box.c1 && c <= box.c2 ? ' is-on' : ''}" data-col="${c}">${colName(c)}<span class="sheet-resize" data-resize="${c}"></span></th>`,
      )
      .join('')
    const styles = stylesOf(s)
    const body: string[] = []
    for (let r = first; r <= last; r++) {
      const cells: string[] = []
      for (let c = 0; c < cols; c++) {
        const raw = rawOf(s, r, c)
        if (!raw && !styles.has(cellKey(r, c))) {
          cells.push(`<td data-r="${r}" data-c="${c}"></td>`)
          continue
        }
        const value = raw ? evaluator.value(s, r, c) : null
        const style = styles.get(cellKey(r, c))
        const text = displayValue(value, raw, style?.fmt)
        const error = typeof value === 'object' && value !== null
        cells.push(
          `<td data-r="${r}" data-c="${c}" style="${cssOf(style, naturalAlign(value))}"${error ? ' class="is-error"' : ''}>${escapeHtml(text)}</td>`,
        )
      }
      body.push(
        `<tr><th class="sheet-row${r >= box.r1 && r <= box.r2 ? ' is-on' : ''}" data-row="${r}">${r + 1}</th>${cells.join('')}</tr>`,
      )
    }
    table.style.width = `${total}px`
    table.innerHTML =
      `<colgroup><col style="width:${ROW_HEAD_W}px">${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>` +
      `<thead><tr><th class="sheet-corner" data-all></th>${head}</tr></thead>` +
      `<tbody><tr class="sheet-spacer" style="height:${first * ROW_H}px"></tr>${body.join('')}<tr class="sheet-spacer" style="height:${(rows - 1 - last) * ROW_H}px"></tr></tbody>`
    more.hidden = rows >= MAX_ROWS
    placeBoxes()
    renderRemote()
    renderTabs()
    syncToolbar()
  }

  function rect(s: SheetMap, b: Box) {
    const left = ROW_HEAD_W + colLeft(s, b.c1)
    let width = 0
    for (let c = b.c1; c <= b.c2; c++) width += widthOf(s, c)
    return { left, top: HEAD_H + b.r1 * ROW_H, width, height: (b.r2 - b.r1 + 1) * ROW_H }
  }

  const place = (el: HTMLElement, r: ReturnType<typeof rect>) =>
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })

  function placeBoxes() {
    const s = sheet()
    const box = boxOf(sel)
    place(selBox, rect(s, box))
    selBox.hidden = box.r1 === box.r2 && box.c1 === box.c2
    const active = rect(s, { r1: sel.ar, c1: sel.ac, r2: sel.ar, c2: sel.ac })
    place(activeBox, active)
    Object.assign(input.style, {
      left: `${active.left}px`,
      top: `${active.top}px`,
      minWidth: `${active.width}px`,
      height: `${editing ? Math.max(active.height, input.scrollHeight) : active.height}px`,
    })
    input.classList.toggle('is-editing', !!editing)
  }

  function renderRemote() {
    const s = sheet()
    const boxes: HTMLElement[] = []
    for (const [clientId, state] of ctx.awareness.getStates()) {
      if (clientId === doc.clientID) continue
      const user = (state as { user?: Presence }).user
      const at = (state as { sheet?: RemoteSelection }).sheet
      if (!user || !at || at.sheet !== activeId) continue
      const el = document.createElement('div')
      el.className = 'sheet-remote'
      el.style.setProperty('--person', user.color)
      place(el, rect(s, at))
      const label = document.createElement('span')
      label.textContent = user.name
      el.append(label)
      boxes.push(el)
    }
    remoteLayer.replaceChildren(...boxes)
  }

  function renderTabs() {
    const list = sheets.toArray()
    const items = list.map((s) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sheet-tab'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', idOf(s) === activeId ? 'true' : 'false')
      b.dataset.sheet = idOf(s)
      b.textContent = nameOf(s)
      b.title = 'ダブルクリックで名前を変える'
      return b
    })
    const add = Object.assign(document.createElement('button'), { type: 'button', className: 'sheet-tab is-add', textContent: '＋' })
    add.dataset.sheetAdd = ''
    add.setAttribute('aria-label', 'シートを追加')
    const remove = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'sheet-tab is-remove',
      textContent: 'シートを削除',
    })
    remove.dataset.sheetRemove = ''
    remove.hidden = list.length < 2
    if (!tabs.querySelector('input')) tabs.replaceChildren(...items, add, remove)
  }

  function syncToolbar() {
    const s = sheet()
    const style = stylesOf(s).get(cellKey(sel.ar, sel.ac))
    ctx.setPressed('bold', !!style?.b)
    ctx.setPressed('italic', !!style?.i)
    ctx.setPressed('underline', !!style?.u)
    for (const align of ['left', 'center', 'right']) ctx.setPressed('align', style?.align === align, align)
    ctx.setValue('format', style?.fmt ?? '')
    if (nameBox && document.activeElement !== nameBox) {
      const box = boxOf(sel)
      nameBox.value =
        box.r1 === box.r2 && box.c1 === box.c2 ? cellName(sel.ar, sel.ac) : `${cellName(box.r1, box.c1)}:${cellName(box.r2, box.c2)}`
    }
    if (formulaInput && document.activeElement !== formulaInput && !editing) formulaInput.value = rawOf(s, sel.ar, sel.ac)
  }

  function clampSelection(rows: number, cols: number) {
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v))
    sel = { ar: clamp(sel.ar, rows), ac: clamp(sel.ac, cols), fr: clamp(sel.fr, rows), fc: clamp(sel.fc, cols) }
  }

  function announce() {
    ctx.awareness.setLocalStateField('sheet', { sheet: activeId, ...boxOf(sel) } satisfies RemoteSelection)
  }

  function scrollIntoView(r: number, c: number) {
    const s = sheet()
    const left = ROW_HEAD_W + colLeft(s, c)
    const right = left + widthOf(s, c)
    const top = HEAD_H + r * ROW_H
    if (top - HEAD_H < grid.scrollTop) grid.scrollTop = top - HEAD_H
    else if (top + ROW_H > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + ROW_H - grid.clientHeight
    if (left - ROW_HEAD_W < grid.scrollLeft) grid.scrollLeft = left - ROW_HEAD_W
    else if (right > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = right - grid.clientWidth
  }

  function select(next: Selection, scroll = true) {
    sel = next
    if (scroll) scrollIntoView(sel.fr, sel.fc)
    announce()
    schedule()
  }

  const moveTo = (r: number, c: number) => {
    const s = sheet()
    const rr = Math.max(0, Math.min(rowsOf(s) - 1, r))
    const cc = Math.max(0, Math.min(colsOf(s) - 1, c))
    select({ ar: rr, ac: cc, fr: rr, fc: cc })
  }

  // ---------------------------------------------------------------- 入力
  function setCell(s: SheetMap, r: number, c: number, raw: string) {
    const cells = cellsOf(s)
    if (raw === '') cells.delete(cellKey(r, c))
    else cells.set(cellKey(r, c), raw)
  }

  function startEdit(mode: 'enter' | 'edit', initial?: string) {
    editing = mode
    if (initial !== undefined) input.value = initial
    else input.value = rawOf(sheet(), sel.ar, sel.ac)
    placeBoxes()
    input.focus()
    if (mode === 'edit') input.setSelectionRange(input.value.length, input.value.length)
    if (formulaInput) formulaInput.value = input.value
  }

  function commit(dr: number, dc: number) {
    if (!editing) return
    const value = input.value
    editing = null
    input.value = ''
    change(() => setCell(sheet(), sel.ar, sel.ac, value))
    moveTo(sel.ar + dr, sel.ac + dc)
  }

  function cancel() {
    editing = null
    input.value = ''
    schedule()
  }

  function eachCell(fn: (r: number, c: number) => void) {
    const b = boxOf(sel)
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(r, c)
  }

  function styleSelection(patch: (style: CellStyle) => CellStyle) {
    const s = sheet()
    const styles = stylesOf(s)
    change(() =>
      eachCell((r, c) => {
        const key = cellKey(r, c)
        const next = patch({ ...styles.get(key) })
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== '')) as CellStyle
        if (Object.keys(clean).length) styles.set(key, clean)
        else styles.delete(key)
      }),
    )
  }

  function toggle(flag: 'b' | 'i' | 'u') {
    const on = !stylesOf(sheet()).get(cellKey(sel.ar, sel.ac))?.[flag]
    styleSelection((st) => ({ ...st, [flag]: on ? 1 : undefined }))
  }

  function clearSelection() {
    const s = sheet()
    change(() => eachCell((r, c) => cellsOf(s).delete(cellKey(r, c))))
  }

  function copyText() {
    const s = sheet()
    const b = boxOf(sel)
    const lines: string[] = []
    for (let r = b.r1; r <= b.r2; r++) {
      const fields: string[] = []
      for (let c = b.c1; c <= b.c2; c++) fields.push(tsvField(rawOf(s, r, c)))
      lines.push(fields.join('\t'))
    }
    return { text: lines.join('\n'), r: b.r1, c: b.c1 }
  }

  function paste(text: string) {
    const s = sheet()
    const grid2 = parseTsv(text)
    const own = lastCopy && lastCopy.text.replace(/\r/g, '') === text.replace(/\r/g, '').replace(/\n$/, '') ? lastCopy : null
    const rows = Math.min(grid2.length, MAX_ROWS - sel.ar)
    const width = Math.max(...grid2.map((r) => r.length))
    change(() => {
      if (sel.ar + rows > rowsOf(s)) s.set('rows', Math.min(MAX_ROWS, sel.ar + rows))
      if (sel.ac + width > colsOf(s)) s.set('cols', Math.min(MAX_COLS, sel.ac + width))
      for (let i = 0; i < rows; i++)
        grid2[i].forEach((v, j) => {
          if (sel.ac + j >= MAX_COLS) return
          const raw = own && v.startsWith('=') ? `=${moveFormula(v.slice(1), sel.ar - own.r, sel.ac - own.c)}` : v
          setCell(s, sel.ar + i, sel.ac + j, raw)
        })
    })
    select({ ar: sel.ar, ac: sel.ac, fr: sel.ar + rows - 1, fc: sel.ac + width - 1 }, false)
  }

  function insertRef(r: number, c: number) {
    const ref = cellName(r, c)
    const { selectionStart: a, selectionEnd: b, value } = input
    input.value = value.slice(0, a) + ref + value.slice(b)
    input.setSelectionRange(a + ref.length, a + ref.length)
    if (formulaInput) formulaInput.value = input.value
  }

  // 計算式の途中（演算子・カンマ・括弧のあと）でだけセルの参照を入れるのは、それ以外で押したときは入力を確定して選び直したいため
  const wantsRef = () => editing && input.value.startsWith('=') && /[=+\-*/^&(,:<>]\s*$/.test(input.value.slice(0, input.selectionStart))

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

  // ---------------------------------------------------------------- シート
  function uniqueName(base: string) {
    const names = new Set(sheets.toArray().map((s) => nameOf(s).toLowerCase()))
    for (let i = 1; ; i++) {
      const name = `${base}${i}`
      if (!names.has(name.toLowerCase())) return name
    }
  }

  function addSheet() {
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    change(() => sheets.push([newSheet(emptySheet(id, uniqueName('Sheet')))]))
    activeId = id
    moveTo(0, 0)
  }

  function renameSheet(tab: HTMLElement) {
    const s = sheets.toArray().find((x) => idOf(x) === tab.dataset.sheet)
    if (!s) return
    const field = Object.assign(document.createElement('input'), { className: 'sheet-tab-input', value: nameOf(s), maxLength: 31 })
    field.setAttribute('aria-label', 'シートの名前')
    tab.replaceWith(field)
    field.focus()
    field.select()
    let done = false
    const finish = (save: boolean) => {
      if (done) return
      done = true
      const name = field.value.trim()
      field.remove()
      if (save && name && name !== nameOf(s)) {
        if (/[[\]:*?/\\]/.test(name)) ctx.toast('シートの名前に [ ] : * ? / \\ は使えません。', 'error')
        else if (sheets.toArray().some((x) => x !== s && nameOf(x).toLowerCase() === name.toLowerCase()))
          ctx.toast('同じ名前のシートがあります。', 'error')
        else change(() => s.set('name', name))
      }
      schedule()
    }
    field.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
    field.addEventListener('blur', () => finish(true))
  }

  async function removeSheet(anchor: HTMLElement) {
    const s = sheet()
    if (sheets.length < 2) return
    const ok = await ctx.confirmNear(anchor, [`シート「${nameOf(s)}」を削除しますか？`], { ok: '削除する', tone: 'danger' })
    if (!ok) return
    const index = sheets.toArray().indexOf(s)
    if (index < 0) return
    change(() => sheets.delete(index, 1))
    activeId = idOf(sheets.get(Math.max(0, index - 1)))
    moveTo(0, 0)
  }

  tabs.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('button')
    if (!el) return
    if (el.dataset.sheet) {
      activeId = el.dataset.sheet
      moveTo(0, 0)
      grid.scrollTo(0, 0)
    } else if (el.dataset.sheetAdd !== undefined) addSheet()
    else if (el.dataset.sheetRemove !== undefined) void removeSheet(el)
  })
  tabs.addEventListener('dblclick', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-sheet]')
    if (el) renameSheet(el)
  })

  // ---------------------------------------------------------------- マウス
  const cellAt = (target: EventTarget | null) => {
    const td = (target as Element | null)?.closest?.('td[data-r]') as HTMLElement | null
    return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null
  }

  let dragging = false
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const resize = target.closest<HTMLElement>('[data-resize]')
    if (resize) return startResize(e, Number(resize.dataset.resize))
    const s = sheet()
    const col = target.closest<HTMLElement>('[data-col]')
    const row = target.closest<HTMLElement>('[data-row]')
    if (target.closest('[data-all]')) {
      if (editing) commit(0, 0)
      select({ ar: 0, ac: 0, fr: rowsOf(s) - 1, fc: colsOf(s) - 1 }, false)
    } else if (col) {
      if (editing) commit(0, 0)
      const c = Number(col.dataset.col)
      select({ ar: 0, ac: e.shiftKey ? sel.ac : c, fr: rowsOf(s) - 1, fc: c }, false)
    } else if (row) {
      if (editing) commit(0, 0)
      const r = Number(row.dataset.row)
      select({ ar: e.shiftKey ? sel.ar : r, ac: 0, fr: r, fc: colsOf(s) - 1 }, false)
    } else {
      const at = cellAt(target)
      if (!at || target === input) return
      if (wantsRef()) {
        e.preventDefault()
        insertRef(at.r, at.c)
        return
      }
      if (editing) commit(0, 0)
      select(e.shiftKey ? { ...sel, fr: at.r, fc: at.c } : { ar: at.r, ac: at.c, fr: at.r, fc: at.c }, false)
      dragging = true
      grid.setPointerCapture(e.pointerId)
    }
    e.preventDefault()
    input.focus()
  })
  grid.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const at = cellAt(document.elementFromPoint(e.clientX, e.clientY))
    if (at && (at.r !== sel.fr || at.c !== sel.fc)) select({ ...sel, fr: at.r, fc: at.c }, false)
  })
  grid.addEventListener('pointerup', () => (dragging = false))
  // e.target を使わないのは、押したときにポインターを表に取り込むので、ダブルクリックの対象がいつも表そのものになるため
  grid.addEventListener('dblclick', (e) => {
    if (cellAt(document.elementFromPoint(e.clientX, e.clientY))) startEdit('edit')
  })
  grid.addEventListener('scroll', schedule, { passive: true })

  function startResize(e: PointerEvent, c: number) {
    e.preventDefault()
    e.stopPropagation()
    const s = sheet()
    const startX = e.clientX
    const startW = widthOf(s, c)
    const col = table.querySelectorAll('col')[c + 1] as HTMLElement | undefined
    let width = startW
    const move = (ev: PointerEvent) => {
      width = Math.max(MIN_WIDTH, Math.min(800, startW + ev.clientX - startX))
      if (col) col.style.width = `${width}px`
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (width !== startW) change(() => widthsOf(s).set(String(c), Math.round(width)))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  moreBtn.addEventListener('click', () => {
    const s = sheet()
    change(() => s.set('rows', Math.min(MAX_ROWS, rowsOf(s) + 100)))
  })

  // ---------------------------------------------------------------- キーボード
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    const mod = e.metaKey || e.ctrlKey
    const s = sheet()
    if (editing) {
      if (e.key === 'Enter' && !e.altKey) {
        e.preventDefault()
        commit(e.shiftKey ? -1 : 1, 0)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        commit(0, e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (editing === 'enter' && e.key.startsWith('Arrow') && !wantsRef()) {
        e.preventDefault()
        const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] ?? [0, 0]
        commit(dr, dc)
      }
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[e.key]) {
      e.preventDefault()
      const [dr, dc] = arrows[e.key]
      const far = mod ? (dr ? (dr > 0 ? rowsOf(s) : -rowsOf(s)) : 0) : dr
      const farC = mod ? (dc ? (dc > 0 ? colsOf(s) : -colsOf(s)) : 0) : dc
      if (e.shiftKey) {
        const fr = Math.max(0, Math.min(rowsOf(s) - 1, sel.fr + far))
        const fc = Math.max(0, Math.min(colsOf(s) - 1, sel.fc + farC))
        select({ ...sel, fr, fc })
      } else moveTo(sel.ar + far, sel.ac + farC)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      moveTo(sel.ar, sel.ac + (e.shiftKey ? -1 : 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      moveTo(sel.ar + (e.shiftKey ? -1 : 1), sel.ac)
    } else if (e.key === 'F2') {
      e.preventDefault()
      startEdit('edit')
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      clearSelection()
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) undo.redo()
      else undo.undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      undo.redo()
    } else if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      toggle('b')
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      toggle('i')
    } else if (mod && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      toggle('u')
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      select({ ar: 0, ac: 0, fr: rowsOf(s) - 1, fc: colsOf(s) - 1 }, false)
    }
  })
  // 打った文字で入力を始めるのは、日本語入力の変換中の文字も、確定前からセルに見せるため（keydown では変換中の文字が分からない）
  input.addEventListener('input', () => {
    if (!editing) {
      editing = 'enter'
      placeBoxes()
    }
    if (formulaInput) formulaInput.value = input.value
    input.style.height = 'auto'
    input.style.height = `${Math.max(ROW_H, input.scrollHeight)}px`
  })
  input.addEventListener('compositionstart', () => {
    if (!editing) {
      editing = 'enter'
      placeBoxes()
    }
  })
  input.addEventListener('blur', () => {
    if (editing && document.activeElement !== formulaInput) commit(0, 0)
  })
  input.addEventListener('copy', (e) => {
    if (editing) return
    e.preventDefault()
    lastCopy = copyText()
    e.clipboardData?.setData('text/plain', lastCopy.text)
  })
  input.addEventListener('cut', (e) => {
    if (editing) return
    e.preventDefault()
    lastCopy = copyText()
    e.clipboardData?.setData('text/plain', lastCopy.text)
    clearSelection()
  })
  input.addEventListener('paste', (e) => {
    if (editing) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain')
    if (text) paste(text)
  })

  formulaInput?.addEventListener('focus', () => {
    if (!editing) startEditFromBar()
  })
  function startEditFromBar() {
    editing = 'edit'
    input.value = rawOf(sheet(), sel.ar, sel.ac)
    placeBoxes()
  }
  formulaInput?.addEventListener('input', () => {
    input.value = formulaInput.value
    if (!editing) editing = 'edit'
    placeBoxes()
  })
  formulaInput?.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      input.value = formulaInput.value
      commit(1, 0)
      input.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      input.focus()
    }
  })
  formulaInput?.addEventListener('blur', () => {
    if (editing && document.activeElement !== input) {
      input.value = formulaInput.value
      commit(0, 0)
    }
  })
  nameBox?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return
    e.preventDefault()
    const [a, b] = nameBox.value.split(':')
    const p = parseCellName(a ?? '')
    const q = b ? parseCellName(b) : p
    if (!p || !q) return ctx.toast('セルの場所が正しくありません。', 'error')
    select({ ar: p.r, ac: p.c, fr: q.r, fc: q.c })
    input.focus()
  })

  // ---------------------------------------------------------------- 同期
  const onChange = () => {
    evaluator = createEvaluator(doc)
    schedule()
  }
  sheets.observeDeep(onChange)
  ctx.awareness.on('change', schedule)
  const resize = new ResizeObserver(schedule)
  resize.observe(grid)
  announce()
  render()
  input.focus({ preventScroll: true })

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
      case 'color':
        return value && styleSelection((st) => ({ ...st, color: value }))
      case 'fill':
        return value && styleSelection((st) => ({ ...st, fill: value }))
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
        return rowsOf(s) > b.r2 - b.r1 + 1 && insertRows(b.r1, -(b.r2 - b.r1 + 1))
      case 'colDelete':
        return colsOf(s) > b.c2 - b.c1 + 1 && insertCols(b.c1, -(b.c2 - b.c1 + 1))
      case 'clear':
        return clearSelection()
    }
  }

  return {
    command: (cmd, value) => {
      command(cmd, value)
      input.focus({ preventScroll: true })
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
      const { replaceSheets } = await import('./sheet-model')
      change(() => replaceSheets(doc, data))
      activeId = data[0]?.id ?? activeId
      moveTo(0, 0)
    },
    destroy() {
      cancelAnimationFrame(frame)
      sheets.unobserveDeep(onChange)
      ctx.awareness.off('change', schedule)
      resize.disconnect()
      undo.destroy()
    },
  }
}
