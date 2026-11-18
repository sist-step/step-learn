import { PowerPointError } from './powerpoint'

export type PageSize = { width: number; height: number }

const UNREADABLE = 'スライドの画像を読めませんでした。'

const isFrameHeader = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)

function jpegInfo(jpeg: Buffer) {
  if (jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8) throw new PowerPointError(UNREADABLE)
  let at = 2
  while (at + 9 < jpeg.length) {
    if (jpeg.readUInt8(at) !== 0xff) break
    const marker = jpeg.readUInt8(at + 1)
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (isFrameHeader(marker))
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7), components: jpeg.readUInt8(at + 9) }
    at += 2 + jpeg.readUInt16BE(at + 2)
  }
  throw new PowerPointError(UNREADABLE)
}

function colorSpaceOf(components: number) {
  if (components === 3) return '/DeviceRGB'
  if (components === 1) return '/DeviceGray'
  throw new PowerPointError(UNREADABLE)
}

const points = (n: number) => String(Number(n.toFixed(2)))

// PDF のライブラリを使わないのは、JPEG はそのまま PDF に埋め込め、拡張機能の依存を増やさずに済むため
export function jpegsToPdf(jpegs: Buffer[], page: PageSize): Buffer {
  const width = points(page.width)
  const height = points(page.height)
  const objects: Buffer[] = []
  const add = (...parts: (string | Buffer)[]) =>
    objects.push(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p))))
  const firstPage = 3
  const kids = jpegs.map((_, i) => `${firstPage + i * 3} 0 R`).join(' ')
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add(`<< /Type /Pages /Count ${jpegs.length} /Kids [${kids}] >>`)
  jpegs.forEach((jpeg, i) => {
    const info = jpegInfo(jpeg)
    const self = firstPage + i * 3
    const content = `q ${width} 0 0 ${height} 0 0 cm /Slide Do Q`
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${self + 1} 0 R /Resources << /XObject << /Slide ${self + 2} 0 R >> >> >>`,
    )
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    add(
      `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpaceOf(info.components)} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    )
  })

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')]
  let size = chunks[0]?.length ?? 0
  const push = (chunk: Buffer) => {
    chunks.push(chunk)
    size += chunk.length
  }
  const offsets = objects.map((body, i) => {
    const offset = size
    push(Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]))
    return offset
  })
  const xref = size
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      'latin1',
    ),
  )
  return Buffer.concat(chunks)
}
