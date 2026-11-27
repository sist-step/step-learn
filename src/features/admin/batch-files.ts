import { zipStream } from '../../lib/zip'
import { ROLE_LABELS, type ManagedRole } from '../../lib/types'
import type { BatchFileFormat } from './user-batch'

/** 配るファイルの 1 人分。パスワードは平文なので、ファイルを作るときにだけ使う */
export type BatchCard = { name: string; username: string; password: string }

export type BatchFileInput = { cards: BatchCard[]; role: ManagedRole; loginUrl: string }

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

const xmlPart = (path: string, xml: string) => ({
  path,
  read: async () => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`),
})

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

const contentTypes = (overrides: Record<string, string>) =>
  xmlPart(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      overrides,
    )
      .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join('')}</Types>`,
  )

const rootRels = (target: string) =>
  xmlPart(
    '_rels/.rels',
    `<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="${target}"/></Relationships>`,
  )

// ---------------------------------------------------------------- ログインカード（Word）

// 寸法とフォントは、学校で使っていたカードの Word の型（A4 縦・余白 2.54cm・2 列 × 4 段）に合わせている
const CARDS_PER_ROW = 2
const ROWS_PER_PAGE = 4
const CELL_WIDTHS = [4876, 4820]
const ROW_HEIGHT = 3288
const FONT_SIZE = 22
const JA_FONT = 'MS Mincho'
const LATIN_FONT = 'Cambria'

const run = (text: string, font: string, { br = false } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:cs="${font}" w:eastAsia="${font}" w:hAnsi="${font}"/><w:sz w:val="${FONT_SIZE}"/><w:szCs w:val="${FONT_SIZE}"/></w:rPr>${br ? '<w:br/>' : ''}${text ? `<w:t xml:space="preserve">${escapeXml(text)}</w:t>` : ''}</w:r>`

/** 1 行を [日本語の部分, 英数字の部分] で表す。英数字の部分だけ欧文のフォントにする */
const cardLines = (card: BatchCard, host: string): [string, string][] => [
  ['【ログインカード】', ''],
  ['', ''],
  [`氏名：${card.name} さん`, ''],
  ['ログインURL：', host],
  ['ユーザー名：', card.username],
  ['パスワード：', card.password],
  ['', ''],
  ['※このカードは大切に保管してください。', ''],
  ['※忘れた場合やなくした場合は', ''],
  ['先生に伝えてください。', ''],
]

const BORDER = (sz: number) =>
  ['top', 'left', 'bottom', 'right'].map((side) => `<w:${side} w:val="single" w:color="auto" w:sz="${sz}"/>`).join('')

function cardCell(card: BatchCard | undefined, host: string, width: number) {
  const runs = card
    ? cardLines(card, host)
        .map(([ja, latin], i) => run(ja, JA_FONT, { br: i > 0 }) + (latin ? run(latin, LATIN_FONT) : ''))
        .join('')
    : ''
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/><w:tcBorders>${BORDER(1)}</w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="276"/></w:pPr>${runs}</w:p></w:tc>`
}

function cardTable(cards: BatchCard[], host: string) {
  const rows: string[] = []
  for (let i = 0; i < cards.length; i += CARDS_PER_ROW) {
    const cells = CELL_WIDTHS.map((width, col) => cardCell(cards[i + col], host, width)).join('')
    rows.push(`<w:tr><w:trPr><w:trHeight w:val="${ROW_HEIGHT}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`)
  }
  const width = CELL_WIDTHS.reduce((a, b) => a + b, 0)
  const tableBorders = BORDER(4) + ['insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:color="auto" w:sz="4"/>`).join('')
  return `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${width}"/><w:tblBorders>${tableBorders}</w:tblBorders></w:tblPr><w:tblGrid>${CELL_WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`
}

const SECTION =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:docGrid w:linePitch="360"/></w:sectPr>'

function cardsDocument(cards: BatchCard[], host: string) {
  const perPage = CARDS_PER_ROW * ROWS_PER_PAGE
  const pages: string[] = []
  for (let i = 0; i < cards.length; i += perPage) pages.push(cardTable(cards.slice(i, i + perPage), host))
  // 改ページではなくセクションで区切るのは、改ページの段落が次のページの先頭に 1 行分の空きを作り、4 段目がはみ出すため
  const body = pages.map((table, i) => (i < pages.length - 1 ? `${table}<w:p><w:pPr>${SECTION}</w:pPr></w:p>` : `${table}<w:p/>`)).join('')
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${SECTION}</w:body></w:document>`
}

const docx = ({ cards, loginUrl }: BatchFileInput) =>
  zipStream([
    contentTypes({ '/word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' }),
    rootRels('word/document.xml'),
    xmlPart('word/document.xml', cardsDocument(cards, new URL(loginUrl).host)),
  ])

// ---------------------------------------------------------------- 一覧（Excel・CSV）

const COLUMNS = ['氏名', 'ユーザー名', 'パスワード', 'ロール', 'ログイン URL']
const COLUMN_WIDTHS = [20, 16, 14, 8, 36]

const tableRows = ({ cards, role, loginUrl }: BatchFileInput) => [
  COLUMNS,
  ...cards.map((card) => [card.name, card.username, card.password, ROLE_LABELS[role], loginUrl]),
]

const columnName = (i: number) => String.fromCharCode(65 + i)

// 数値の型で入れないのは、2026001 のようなユーザー名が数値になり、0 で始まる接頭辞の 0 が消えるため
function sheetXml(rows: string[][]) {
  const cols = COLUMN_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const data = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((v, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`).join('')}</row>`,
    )
    .join('')
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`
}

const SHEET_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'

const xlsx = (input: BatchFileInput) =>
  zipStream([
    contentTypes({
      '/xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      '/xl/worksheets/sheet1.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    }),
    rootRels('xl/workbook.xml'),
    xmlPart(
      'xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ユーザー" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    xmlPart(
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${SHEET_REL}" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    xmlPart('xl/worksheets/sheet1.xml', sheetXml(tableRows(input))),
  ])

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

// BOM を付けるのは、付けないと Excel が Shift_JIS として開き、氏名が文字化けするため
const csv = (input: BatchFileInput) =>
  new Blob([
    `﻿${tableRows(input)
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}\r\n`,
  ]).stream()

export const BATCH_FILES: Record<BatchFileFormat, { contentType: string; build: (input: BatchFileInput) => ReadableStream<Uint8Array> }> = {
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', build: docx },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', build: xlsx },
  csv: { contentType: 'text/csv; charset=utf-8', build: csv },
}
