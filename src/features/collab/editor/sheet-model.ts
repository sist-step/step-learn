// 表計算の中身（Yjs）の形と読み書き。画面（sheet.ts）と .xlsx の変換（xlsx.ts）で使う
import * as Y from 'yjs'
import {
  CYCLE,
  evaluateFormula,
  formatGeneral,
  isDateInput,
  isError,
  literalValue,
  moveFormula,
  renameSheetRefs,
  serialDate,
  shiftFormula,
  type Scalar,
} from './formula'

export const SHEET_FORMATS = ['', 'number', 'fixed2', 'currency', 'percent', 'date'] as const

export type SheetFormat = (typeof SHEET_FORMATS)[number]

export type CellStyle = {
  b?: 1
  i?: 1
  u?: 1
  s?: 1
  wrap?: 1
  /** 文字の大きさ（ピクセル）。なければ既定の大きさ */
  fs?: number
  /** 罫線のある辺。t・r・b・l の組み合わせ */
  bd?: string
  color?: string
  fill?: string
  align?: 'left' | 'center' | 'right'
  fmt?: SheetFormat
}

/** シート 1 枚。cells はセルの入力（r,c → 入力された文字）、styles は書式、widths は列の幅、heights は行の高さ（ピクセル） */
export type SheetMap = Y.Map<unknown>

export const DEFAULT_ROWS = 100
export const DEFAULT_COLS = 26
export const MAX_ROWS = 10_000
export const MAX_COLS = 200
export const DEFAULT_WIDTH = 96
export const DEFAULT_HEIGHT = 26

export const cellKey = (r: number, c: number) => `${r},${c}`

export function parseKey(key: string) {
  const i = key.indexOf(',')
  return { r: Number(key.slice(0, i)), c: Number(key.slice(i + 1)) }
}

export const sheetsOf = (doc: Y.Doc) => doc.getArray<SheetMap>('sheets')

export const cellsOf = (sheet: SheetMap) => sheet.get('cells') as Y.Map<string>
export const stylesOf = (sheet: SheetMap) => sheet.get('styles') as Y.Map<CellStyle>
export const widthsOf = (sheet: SheetMap) => sheet.get('widths') as Y.Map<number>
/** 行の高さ。この機能より前に作ったシートにはまだない */
export const heightsOf = (sheet: SheetMap) => sheet.get('heights') as Y.Map<number> | undefined
const text = (v: unknown) => (typeof v === 'string' ? v : '')

export const nameOf = (sheet: SheetMap) => text(sheet.get('name'))
export const idOf = (sheet: SheetMap) => text(sheet.get('id'))
export const rowsOf = (sheet: SheetMap) => Math.min(MAX_ROWS, Number(sheet.get('rows')) || DEFAULT_ROWS)
export const colsOf = (sheet: SheetMap) => Math.min(MAX_COLS, Number(sheet.get('cols')) || DEFAULT_COLS)
export const frozenRowsOf = (sheet: SheetMap) => Math.max(0, Number(sheet.get('frozenRows')) || 0)
export const frozenColsOf = (sheet: SheetMap) => Math.max(0, Number(sheet.get('frozenCols')) || 0)

export function setRowHeight(sheet: SheetMap, r: number, height: number) {
  let heights = heightsOf(sheet)
  if (height === DEFAULT_HEIGHT) return heights?.delete(String(r))
  if (!heights) {
    heights = new Y.Map<number>()
    sheet.set('heights', heights)
  }
  heights.set(String(r), height)
}

/** まだ文書に入れていないシート（Y.Map に入れる前の値をまとめて持つ） */
export type SheetData = {
  id: string
  name: string
  rows: number
  cols: number
  cells: Record<string, string>
  styles: Record<string, CellStyle>
  widths: Record<string, number>
  heights?: Record<string, number>
  frozenRows?: number
  frozenCols?: number
}

export function newSheet(data: SheetData): SheetMap {
  const sheet = new Y.Map<unknown>()
  sheet.set('id', data.id)
  sheet.set('name', data.name)
  sheet.set('rows', data.rows)
  sheet.set('cols', data.cols)
  if (data.frozenRows) sheet.set('frozenRows', data.frozenRows)
  if (data.frozenCols) sheet.set('frozenCols', data.frozenCols)
  const cells = new Y.Map<string>()
  for (const [k, v] of Object.entries(data.cells)) cells.set(k, v)
  const styles = new Y.Map<CellStyle>()
  for (const [k, v] of Object.entries(data.styles)) styles.set(k, v)
  const widths = new Y.Map<number>()
  for (const [k, v] of Object.entries(data.widths)) widths.set(k, v)
  const heights = new Y.Map<number>()
  for (const [k, v] of Object.entries(data.heights ?? {})) heights.set(k, v)
  sheet.set('cells', cells)
  sheet.set('styles', styles)
  sheet.set('widths', widths)
  sheet.set('heights', heights)
  return sheet
}

export function sheetData(sheet: SheetMap): SheetData {
  return {
    id: idOf(sheet),
    name: nameOf(sheet),
    rows: rowsOf(sheet),
    cols: colsOf(sheet),
    cells: Object.fromEntries(cellsOf(sheet).entries()),
    styles: Object.fromEntries(stylesOf(sheet).entries()),
    widths: Object.fromEntries(widthsOf(sheet).entries()),
    heights: Object.fromEntries(heightsOf(sheet)?.entries() ?? []),
    frozenRows: frozenRowsOf(sheet),
    frozenCols: frozenColsOf(sheet),
  }
}

/** シートの並びを変える。Yjs の値は入れ直せないので、同じ id の写しに置き換える（開いている人の画面はそのシートのまま） */
export function moveSheet(doc: Y.Doc, from: number, to: number) {
  const list = sheetsOf(doc)
  const data = sheetData(list.get(from))
  list.delete(from, 1)
  list.insert(to, [newSheet(data)])
}

export function renameSheet(doc: Y.Doc, sheet: SheetMap, name: string) {
  const old = nameOf(sheet)
  sheet.set('name', name)
  for (const other of sheetsOf(doc).toArray()) {
    const cells = cellsOf(other)
    for (const [key, raw] of Array.from(cells.entries())) {
      if (!raw.startsWith('=')) continue
      const next = `=${renameSheetRefs(raw.slice(1), old, name)}`
      if (next !== raw) cells.set(key, next)
    }
  }
}

export const emptySheet = (id: string, name: string): SheetData => ({
  id,
  name,
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
  cells: {},
  styles: {},
  widths: {},
})

/**
 * シートが 1 枚もなければ、最初のシートを入れる。
 * 決まった clientID の別の文書で作って写すのは、同時に開いた 2 人がそれぞれ作っても、同じ変更として 1 枚にまとまるようにするため
 */
export function ensureSheet(doc: Y.Doc) {
  if (sheetsOf(doc).length) return
  const seed = new Y.Doc()
  seed.clientID = 0
  sheetsOf(seed).push([newSheet(emptySheet('sheet1', 'Sheet1'))])
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
  seed.destroy()
}

const sheetByName = (doc: Y.Doc, name: string) =>
  sheetsOf(doc)
    .toArray()
    .find((s) => nameOf(s).toLowerCase() === name.toLowerCase())

// ---------------------------------------------------------------- 計算

// 参照をたどる再帰をこれより深くしないのは、上から下へ累計するシートで、末尾のセルから先頭までの数千段をたどると、スタックが足りずに落ちるため
const MAX_DEPTH = 200

/** 深すぎて、いまのスタックでは計算しない参照先 */
class TooDeep {
  constructor(
    readonly sheet: SheetMap,
    readonly r: number,
    readonly c: number,
  ) {}
}

/** シートのセルの値を求める。作り直すまで結果を覚えておくので、文書が変わったら作り直す */
export function createEvaluator(doc: Y.Doc) {
  const memo = new Map<string, Scalar>()
  const busy = new Set<string>()
  let depth = 0
  const keyOf = (sheet: SheetMap, r: number, c: number) => `${idOf(sheet)}:${r},${c}`

  function compute(sheet: SheetMap, r: number, c: number): Scalar {
    const key = keyOf(sheet, r, c)
    if (memo.has(key)) return memo.get(key)!
    const raw = cellsOf(sheet).get(cellKey(r, c))
    if (raw === undefined) return null
    if (!raw.startsWith('=')) {
      const v = literalValue(raw)
      memo.set(key, v)
      return v
    }
    if (busy.has(key)) return CYCLE
    if (depth >= MAX_DEPTH) throw new TooDeep(sheet, r, c)
    busy.add(key)
    depth++
    try {
      const v = evaluateFormula(raw.slice(1), {
        cell: (name, rr, cc) => {
          const target = name === null ? sheet : sheetByName(doc, name)
          return target ? compute(target, rr, cc) : undefined
        },
        size: (name) => {
          const target = name === null ? sheet : sheetByName(doc, name)
          return target && { rows: rowsOf(target), cols: colsOf(target) }
        },
        here: { r, c },
      })
      memo.set(key, v)
      return v
    } finally {
      busy.delete(key)
      depth--
    }
  }

  /** 深すぎる参照先は、先にそちらだけを新しいスタックで求めて覚え、もとのセルを求め直す */
  function value(sheet: SheetMap, r: number, c: number): Scalar {
    const pending: TooDeep[] = [new TooDeep(sheet, r, c)]
    for (;;) {
      const next = pending.at(-1)!
      try {
        const v = compute(next.sheet, next.r, next.c)
        pending.pop()
        if (pending.length === 0) return v
      } catch (e) {
        if (!(e instanceof TooDeep)) throw e
        const key = keyOf(e.sheet, e.r, e.c)
        // 求めている途中のセルにまた行き着いたら、深さの上限より長い循環なので、そのセルを循環にして先へ進める
        if (pending.some((p) => keyOf(p.sheet, p.r, p.c) === key)) memo.set(key, CYCLE)
        else pending.push(e)
      }
    }
  }
  return { value }
}

// ---------------------------------------------------------------- 表示

const nf = (min: number, max: number) => new Intl.NumberFormat('ja-JP', { minimumFractionDigits: min, maximumFractionDigits: max })
const NUMBER = nf(0, 0)
const FIXED2 = nf(2, 2)
const PERCENT = nf(0, 2)

function formatDateSerial(n: number) {
  const d = serialDate(n)
  return `${d.y}/${d.m}/${d.d}`
}

/** セルに出す文字 */
export function displayValue(value: Scalar, raw: string, fmt?: SheetFormat): string {
  if (value === null) return ''
  if (isError(value)) return value.error
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return value
  switch (fmt) {
    case 'number':
      return NUMBER.format(value)
    case 'fixed2':
      return FIXED2.format(value)
    case 'currency':
      return `¥${NUMBER.format(value)}`
    case 'percent':
      return `${PERCENT.format(value * 100)}%`
    case 'date':
      return formatDateSerial(value)
  }
  if (isDateInput(raw)) return formatDateSerial(value)
  if (/%\s*$/.test(raw) && !raw.startsWith('=')) return `${PERCENT.format(value * 100)}%`
  return formatGeneral(value)
}

/** 揃えを決めていないセルの揃え。数は右、真偽値とエラーは中央、文字は左 */
export const naturalAlign = (value: Scalar) =>
  typeof value === 'number' ? 'right' : typeof value === 'boolean' || isError(value) ? 'center' : 'left'

// ---------------------------------------------------------------- 行と列の挿入・削除

/** 行（axis が row）か列を、at の位置に count だけ挿入する（count が負なら at から -count だけ削除する） */
export function shiftCells(doc: Y.Doc, sheet: SheetMap, axis: 'row' | 'col', at: number, count: number) {
  const name = nameOf(sheet)
  for (const map of [cellsOf(sheet), stylesOf(sheet)] as Y.Map<unknown>[]) {
    const moved: [string, unknown][] = []
    for (const [key, v] of Array.from(map.entries())) {
      const { r, c } = parseKey(key)
      const pos = axis === 'row' ? r : c
      if (pos < at) continue
      map.delete(key)
      if (count < 0 && pos < at - count) continue
      moved.push([axis === 'row' ? cellKey(r + count, c) : cellKey(r, c + count), v])
    }
    for (const [key, v] of moved) map.set(key, v)
  }
  const sizes = axis === 'col' ? widthsOf(sheet) : heightsOf(sheet)
  if (sizes) {
    const moved: [string, number][] = []
    for (const [key, size] of Array.from(sizes.entries())) {
      const pos = Number(key)
      if (pos < at) continue
      sizes.delete(key)
      if (count < 0 && pos < at - count) continue
      moved.push([String(pos + count), size])
    }
    for (const [key, size] of moved) sizes.set(key, size)
  }
  const frozenKey = axis === 'row' ? 'frozenRows' : 'frozenCols'
  const frozen = axis === 'row' ? frozenRowsOf(sheet) : frozenColsOf(sheet)
  if (at < frozen) sheet.set(frozenKey, count > 0 ? frozen + count : Math.max(at, frozen + count))
  const sizeKey = axis === 'row' ? 'rows' : 'cols'
  const size = axis === 'row' ? rowsOf(sheet) : colsOf(sheet)
  sheet.set(sizeKey, Math.max(1, Math.min(axis === 'row' ? MAX_ROWS : MAX_COLS, size + count)))
  for (const other of sheetsOf(doc).toArray()) {
    const cells = cellsOf(other)
    for (const [key, raw] of Array.from(cells.entries())) {
      if (!raw.startsWith('=')) continue
      const next = `=${shiftFormula(raw.slice(1), axis, at, count, name, nameOf(other))}`
      if (next !== raw) cells.set(key, next)
    }
  }
}

// ---------------------------------------------------------------- オートフィル

const WEEKDAY_SERIES = [
  ['日', '月', '火', '水', '木', '金', '土'],
  ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
]

const mod = (n: number, size: number) => ((n % size) + size) % size

const stepOf = (ns: number[]) => (ns.length < 2 ? 1 : (ns[ns.length - 1] - ns[0]) / (ns.length - 1))

const isLinear = (ns: number[], step: number) => ns.every((n, i) => Math.abs(n - (ns[0] + step * i)) < 1e-9)

const formatSerialInput = (serial: number) => {
  const d = serialDate(serial)
  return `${d.y}/${d.m}/${d.d}`
}

export function fillSeries(values: string[]): (k: number) => string {
  const repeat = (k: number) => values[mod(k, values.length)]
  if (values.some((v) => v === '' || v.startsWith('='))) return repeat
  if (values.every(isDateInput)) {
    const serials = values.map((v) => literalValue(v) as number)
    const step = stepOf(serials)
    if (isLinear(serials, step)) return (k) => formatSerialInput(serials[0] + step * k)
    return repeat
  }
  const numbers = values.map(literalValue)
  if (numbers.every((n) => typeof n === 'number')) {
    if (values.length === 1 || !values.every((v) => /^[+-]?[\d.]+$/.test(v.trim()))) return repeat
    const ns = numbers as number[]
    const step = stepOf(ns)
    if (isLinear(ns, step)) return (k) => formatGeneral(ns[0] + step * k)
    return repeat
  }
  for (const names of WEEKDAY_SERIES) {
    const at = values.map((v) => names.indexOf(v))
    if (at.every((i) => i >= 0)) return (k) => names[mod(at[0] + k * (at.length > 1 ? mod(at[1] - at[0], 7) || 1 : 1), 7)]
  }
  const parts = values.map((v) => /^(.*?)(\d+)(\D*)$/.exec(v))
  if (parts.every(Boolean) && parts.every((p) => p![1] === parts[0]![1] && p![3] === parts[0]![3])) {
    const ns = parts.map((p) => Number(p![2]))
    const step = stepOf(ns)
    const width = parts[0]![2].startsWith('0') ? parts[0]![2].length : 0
    if (isLinear(ns, step))
      return (k) => {
        const n = ns[0] + step * k
        return n < 0 ? repeat(k) : `${parts[0]![1]}${String(n).padStart(width, '0')}${parts[0]![3]}`
      }
  }
  return repeat
}

export const movedRaw = (raw: string, dr: number, dc: number) => (raw.startsWith('=') ? `=${moveFormula(raw.slice(1), dr, dc)}` : raw)

/** すべてのシートを、読み込んだシートに置き換える */
export function replaceSheets(doc: Y.Doc, sheets: SheetData[]) {
  const list = sheetsOf(doc)
  list.delete(0, list.length)
  list.push(sheets.map(newSheet))
}

/** 書き出し用に、シートの中身を素の値で読む */
export function readSheets(doc: Y.Doc) {
  return sheetsOf(doc)
    .toArray()
    .map((sheet) => ({
      sheet,
      name: nameOf(sheet),
      rows: rowsOf(sheet),
      cols: colsOf(sheet),
      cells: [...cellsOf(sheet).entries()],
      styles: stylesOf(sheet),
      widths: widthsOf(sheet),
      heights: heightsOf(sheet),
      frozenRows: frozenRowsOf(sheet),
      frozenCols: frozenColsOf(sheet),
    }))
}
