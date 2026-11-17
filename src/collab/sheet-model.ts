// 表計算の中身（Yjs）の形と読み書き。画面（sheet.ts）と .xlsx の変換（xlsx.ts）で使う
import * as Y from 'yjs'
import { CYCLE, evaluateFormula, formatGeneral, isDateInput, isError, literalValue, serialDate, shiftFormula, type Scalar } from './formula'

export const SHEET_FORMATS = ['', 'number', 'fixed2', 'currency', 'percent', 'date'] as const

export type SheetFormat = (typeof SHEET_FORMATS)[number]

export type CellStyle = { b?: 1; i?: 1; u?: 1; color?: string; fill?: string; align?: 'left' | 'center' | 'right'; fmt?: SheetFormat }

/** シート 1 枚。cells はセルの入力（r,c → 入力された文字）、styles は書式、widths は列の幅（ピクセル） */
export type SheetMap = Y.Map<unknown>

export const DEFAULT_ROWS = 100
export const DEFAULT_COLS = 26
export const MAX_ROWS = 10_000
export const MAX_COLS = 200
export const DEFAULT_WIDTH = 96

export const cellKey = (r: number, c: number) => `${r},${c}`

export function parseKey(key: string) {
  const i = key.indexOf(',')
  return { r: Number(key.slice(0, i)), c: Number(key.slice(i + 1)) }
}

export const sheetsOf = (doc: Y.Doc) => doc.getArray<SheetMap>('sheets')

export const cellsOf = (sheet: SheetMap) => sheet.get('cells') as Y.Map<string>
export const stylesOf = (sheet: SheetMap) => sheet.get('styles') as Y.Map<CellStyle>
export const widthsOf = (sheet: SheetMap) => sheet.get('widths') as Y.Map<number>
const text = (v: unknown) => (typeof v === 'string' ? v : '')

export const nameOf = (sheet: SheetMap) => text(sheet.get('name'))
export const idOf = (sheet: SheetMap) => text(sheet.get('id'))
export const rowsOf = (sheet: SheetMap) => Math.min(MAX_ROWS, Number(sheet.get('rows')) || DEFAULT_ROWS)
export const colsOf = (sheet: SheetMap) => Math.min(MAX_COLS, Number(sheet.get('cols')) || DEFAULT_COLS)

/** まだ文書に入れていないシート（Y.Map に入れる前の値をまとめて持つ） */
export type SheetData = {
  id: string
  name: string
  rows: number
  cols: number
  cells: Record<string, string>
  styles: Record<string, CellStyle>
  widths: Record<string, number>
}

export function newSheet(data: SheetData): SheetMap {
  const sheet = new Y.Map<unknown>()
  sheet.set('id', data.id)
  sheet.set('name', data.name)
  sheet.set('rows', data.rows)
  sheet.set('cols', data.cols)
  const cells = new Y.Map<string>()
  for (const [k, v] of Object.entries(data.cells)) cells.set(k, v)
  const styles = new Y.Map<CellStyle>()
  for (const [k, v] of Object.entries(data.styles)) styles.set(k, v)
  const widths = new Y.Map<number>()
  for (const [k, v] of Object.entries(data.widths)) widths.set(k, v)
  sheet.set('cells', cells)
  sheet.set('styles', styles)
  sheet.set('widths', widths)
  return sheet
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

export const sheetByName = (doc: Y.Doc, name: string) =>
  sheetsOf(doc)
    .toArray()
    .find((s) => nameOf(s).toLowerCase() === name.toLowerCase())

// ---------------------------------------------------------------- 計算

/** シートのセルの値を求める。作り直すまで結果を覚えておくので、文書が変わったら作り直す */
export function createEvaluator(doc: Y.Doc) {
  const memo = new Map<string, Scalar>()
  const busy = new Set<string>()
  function value(sheet: SheetMap, r: number, c: number): Scalar {
    const key = `${idOf(sheet)}:${r},${c}`
    if (memo.has(key)) return memo.get(key)!
    const raw = cellsOf(sheet).get(cellKey(r, c))
    if (raw === undefined) return null
    if (!raw.startsWith('=')) {
      const v = literalValue(raw)
      memo.set(key, v)
      return v
    }
    if (busy.has(key)) return CYCLE
    busy.add(key)
    const v = evaluateFormula(raw.slice(1), {
      cell: (name, rr, cc) => {
        const target = name === null ? sheet : sheetByName(doc, name)
        return target ? value(target, rr, cc) : undefined
      },
      size: (name) => {
        const target = name === null ? sheet : sheetByName(doc, name)
        return target && { rows: rowsOf(target), cols: colsOf(target) }
      },
    })
    busy.delete(key)
    memo.set(key, v)
    return v
  }
  return { value }
}

// ---------------------------------------------------------------- 表示

const nf = (min: number, max: number) => new Intl.NumberFormat('ja-JP', { minimumFractionDigits: min, maximumFractionDigits: max })
const NUMBER = nf(0, 0)
const FIXED2 = nf(2, 2)
const PERCENT = nf(0, 2)

export function formatDateSerial(n: number) {
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
  if (axis === 'col') {
    const widths = widthsOf(sheet)
    const moved: [string, number][] = []
    for (const [key, w] of Array.from(widths.entries())) {
      const c = Number(key)
      if (c < at) continue
      widths.delete(key)
      if (count < 0 && c < at - count) continue
      moved.push([String(c + count), w])
    }
    for (const [key, w] of moved) widths.set(key, w)
  }
  const sizeKey = axis === 'row' ? 'rows' : 'cols'
  const size = axis === 'row' ? rowsOf(sheet) : colsOf(sheet)
  sheet.set(sizeKey, Math.max(1, Math.min(axis === 'row' ? MAX_ROWS : MAX_COLS, size + count)))
  for (const other of sheetsOf(doc).toArray()) {
    const cells = cellsOf(other)
    for (const [key, raw] of cells.entries()) {
      if (!raw.startsWith('=')) continue
      const next = `=${shiftFormula(raw.slice(1), axis, at, count, name, nameOf(other))}`
      if (next !== raw) cells.set(key, next)
    }
  }
}

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
    }))
}
