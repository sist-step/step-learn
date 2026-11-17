/// <reference lib="dom" />
// 表計算と .xlsx の変換（exceljs）。値・計算式・文字の書式・塗り・揃え・表示形式・列の幅を引き継ぐ
import ExcelJS from 'exceljs'
import type * as Y from 'yjs'
import { dateSerial, isError } from './formula'
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_WIDTH,
  MAX_COLS,
  MAX_ROWS,
  cellKey,
  createEvaluator,
  readSheets,
  type CellStyle,
  type SheetData,
  type SheetFormat,
} from './sheet-model'
import { hexColor } from './office'

// exceljs の列の幅（文字数）とピクセルの比。Excel の既定のフォントでおおよそ 1 文字 7 ピクセル
const PX_PER_CHAR = 7

const NUM_FMTS: Record<Exclude<SheetFormat, ''>, string> = {
  number: '#,##0',
  fixed2: '0.00',
  currency: '"¥"#,##0',
  percent: '0%',
  date: 'yyyy/m/d',
}

function formatOf(numFmt: string | undefined): SheetFormat | undefined {
  if (!numFmt || numFmt === 'General') return undefined
  if (numFmt.includes('%')) return 'percent'
  if (/[¥$€£]/.test(numFmt)) return 'currency'
  if (/y|d|m\/|\/m/i.test(numFmt.replace(/"[^"]*"/g, ''))) return 'date'
  if (/0\.0/.test(numFmt)) return 'fixed2'
  if (numFmt.includes('#,##0')) return 'number'
  return undefined
}

const argb = (hex: string) => `FF${hex}`

/** 表計算の中身を .xlsx にする。計算式は式のまま入れ、開いたときに出す値として計算した結果も添える */
export async function sheetsToXlsx(doc: Y.Doc) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'STEP Learn'
  const evaluator = createEvaluator(doc)
  for (const s of readSheets(doc)) {
    const ws = wb.addWorksheet(s.name.slice(0, 31) || 'Sheet')
    for (const [key, width] of s.widths.entries()) ws.getColumn(Number(key) + 1).width = width / PX_PER_CHAR
    const cells = new Map(s.cells)
    const keys = new Set([...cells.keys(), ...s.styles.keys()])
    for (const key of keys) {
      const [r, c] = key.split(',').map(Number)
      const cell = ws.getCell(r + 1, c + 1)
      const raw = cells.get(key)
      if (raw !== undefined) {
        const value = evaluator.value(s.sheet, r, c)
        if (raw.startsWith('=')) {
          const result = isError(value) ? { error: value.error as ExcelJS.CellErrorValue['error'] } : (value ?? undefined)
          cell.value = { formula: raw.slice(1), result: result as ExcelJS.CellFormulaValue['result'] }
        } else cell.value = isError(value) ? raw : (value as ExcelJS.CellValue)
      }
      const style = s.styles.get(key)
      if (!style) continue
      const color = hexColor(style.color)
      cell.font = { bold: !!style.b, italic: !!style.i, underline: !!style.u, ...(color && { color: { argb: argb(color) } }) }
      const fill = hexColor(style.fill)
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(fill) } }
      if (style.align) cell.alignment = { horizontal: style.align }
      if (style.fmt) cell.numFmt = NUM_FMTS[style.fmt]
    }
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const colorOf = (c: Partial<ExcelJS.Color> | undefined) =>
  c?.argb && /^[0-9A-F]{8}$/i.test(c.argb) ? `#${c.argb.slice(2).toLowerCase()}` : undefined

function rawOf(cell: ExcelJS.Cell): string | null {
  if (cell.formula) return `=${cell.formula}`
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `${v.getUTCFullYear()}/${v.getUTCMonth() + 1}/${v.getUTCDate()}`
  if ('richText' in v) return v.richText.map((t) => t.text).join('')
  if ('hyperlink' in v) return String(v.text ?? v.hyperlink)
  if ('error' in v) return v.error
  if ('result' in v)
    return typeof v.result === 'number' || typeof v.result === 'string' || typeof v.result === 'boolean' ? String(v.result) : null
  return null
}

function styleOf(cell: ExcelJS.Cell, dateValue: boolean): CellStyle | null {
  const style: CellStyle = {}
  if (cell.font?.bold) style.b = 1
  if (cell.font?.italic) style.i = 1
  if (cell.font?.underline) style.u = 1
  const color = colorOf(cell.font?.color)
  if (color && color !== '#000000') style.color = color
  const fill = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? colorOf(cell.fill.fgColor) : undefined
  if (fill) style.fill = fill
  const h = cell.alignment?.horizontal
  if (h === 'left' || h === 'center' || h === 'right') style.align = h
  const fmt = formatOf(cell.numFmt) ?? (dateValue ? 'date' : undefined)
  if (fmt) style.fmt = fmt
  return Object.keys(style).length ? style : null
}

/** .xlsx をシートの中身にする。図・グラフ・セルの結合・条件付き書式は読まない */
export async function xlsxToSheets(file: File): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const out: SheetData[] = []
  wb.eachSheet((ws, i) => {
    const cells: Record<string, string> = {}
    const styles: Record<string, CellStyle> = {}
    const widths: Record<string, number> = {}
    let maxR = 0
    let maxC = 0
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > MAX_ROWS) return
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > MAX_COLS) return
        const key = cellKey(r - 1, c - 1)
        const dateValue = cell.value instanceof Date
        const raw = dateValue
          ? String(
              dateSerial((cell.value as Date).getUTCFullYear(), (cell.value as Date).getUTCMonth() + 1, (cell.value as Date).getUTCDate()),
            )
          : rawOf(cell)
        if (raw !== null && raw !== '') cells[key] = raw
        const style = styleOf(cell, dateValue)
        if (style) styles[key] = style
        if (raw || style) {
          maxR = Math.max(maxR, r)
          maxC = Math.max(maxC, c)
        }
      })
    })
    ws.columns?.forEach((col, c) => {
      if (c < MAX_COLS && col.width && Math.round(col.width * PX_PER_CHAR) !== DEFAULT_WIDTH)
        widths[String(c)] = Math.round(col.width * PX_PER_CHAR)
    })
    out.push({
      id: `x${i}${Date.now().toString(36)}`,
      name: ws.name.slice(0, 31) || `Sheet${i}`,
      rows: Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, maxR + 20)),
      cols: Math.min(MAX_COLS, Math.max(DEFAULT_COLS, maxC + 2)),
      cells,
      styles,
      widths,
    })
  })
  if (!out.length) throw new Error('シートがありません')
  return out
}
