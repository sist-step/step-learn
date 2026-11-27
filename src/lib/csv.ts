// 先頭の = + - @ に ' を付けるのは、Excel が数式として読み、値が壊れたり、意図しない数式が動いたりするため
const csvCell = (v: string) => {
  const text = /^[=+\-@]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// BOM を付けるのは、付けないと Excel が Shift_JIS として開き、日本語が文字化けするため
/** Excel でそのまま開ける CSV の本文 */
export const csvText = (rows: string[][]) => `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`

export const csvHeaders = (filename: string) => ({
  'Content-Type': 'text/csv; charset=utf-8',
  'Content-Disposition': `attachment;filename*=UTF-8''${encodeURIComponent(filename)}`,
  'Cache-Control': 'no-store',
})
