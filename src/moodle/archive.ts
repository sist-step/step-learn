import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'

// 展開のライブラリを使わないのは、ランタイム依存を増やさないため。
// ZIP だけに対応しないのは、Moodle の設定（enabletgzbackups）によっては .mbz が tar.gz で書き出されるため

/** アーカイブ内のパスが展開先の外（`../` や絶対パス）を指すなら null */
function safeJoin(dest: string, name: string) {
  const p = path.resolve(dest, name.replace(/\\/g, '/'))
  return p.startsWith(dest + path.sep) ? p : null
}

async function writeEntry(dest: string, name: string, source: Readable | null) {
  const target = safeJoin(dest, name)
  if (!target) return
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  if (source) await pipeline(source, fs.createWriteStream(target))
  else await fs.promises.writeFile(target, '')
}

async function extractZip(file: string, dest: string) {
  const fd = await fs.promises.open(file)
  try {
    const read = async (length: number, position: number) => {
      const buf = Buffer.alloc(length)
      await fd.read(buf, 0, length, position)
      return buf
    }
    const size = (await fd.stat()).size
    const tailLength = Math.min(size, 65_557)
    const tail = await read(tailLength, size - tailLength)
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('ZIP ファイルが壊れています（終端が見つかりません）。')
    let count = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)
    if (count === 0xff_ff || cdOffset === 0xff_ff_ff_ff) {
      const locator = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd)
      if (locator < 0) throw new Error('ZIP ファイルが壊れています（ZIP64 の情報が見つかりません）。')
      const zip64 = await read(56, Number(tail.readBigUInt64LE(locator + 8)))
      count = Number(zip64.readBigUInt64LE(32))
      cdSize = Number(zip64.readBigUInt64LE(40))
      cdOffset = Number(zip64.readBigUInt64LE(48))
    }

    const cd = await read(cdSize, cdOffset)
    let p = 0
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02_01_4b_50) throw new Error('ZIP ファイルが壊れています（目次が読めません）。')
      const method = cd.readUInt16LE(p + 10)
      let compressedSize = cd.readUInt32LE(p + 20)
      let uncompressedSize = cd.readUInt32LE(p + 24)
      const nameLength = cd.readUInt16LE(p + 28)
      const extraLength = cd.readUInt16LE(p + 30)
      const commentLength = cd.readUInt16LE(p + 32)
      let localOffset = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLength)
      for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength; e += 4 + cd.readUInt16LE(e + 2)) {
        if (cd.readUInt16LE(e) !== 0x0001) continue
        let q = e + 4
        const next = () => Number(cd.readBigUInt64LE((q += 8) - 8))
        if (uncompressedSize === 0xff_ff_ff_ff) uncompressedSize = next()
        if (compressedSize === 0xff_ff_ff_ff) compressedSize = next()
        if (localOffset === 0xff_ff_ff_ff) localOffset = next()
      }
      p += 46 + nameLength + extraLength + commentLength
      if (name.endsWith('/')) continue
      if (method !== 0 && method !== 8) throw new Error(`ZIP の圧縮方式（${method}）に対応していません: ${name}`)

      const local = await read(30, localOffset)
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      if (compressedSize === 0) {
        await writeEntry(dest, name, null)
        continue
      }
      const raw = fs.createReadStream(file, { start: dataStart, end: dataStart + compressedSize - 1 })
      await writeEntry(dest, name, method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw)
    }
  } finally {
    await fd.close()
  }
}

/** ストリームから、ちょうど n バイトずつ取り出す。途中で終わったら null */
function byteReader(source: AsyncIterable<Buffer>) {
  const it = source[Symbol.asyncIterator]()
  let pending: Buffer = Buffer.alloc(0)
  return async (n: number) => {
    while (pending.length < n) {
      const { value, done } = await it.next()
      if (done) return null
      pending = pending.length ? Buffer.concat([pending, value]) : value
    }
    const out = pending.subarray(0, n)
    pending = pending.subarray(n)
    return out
  }
}

const cString = (b: Buffer) => {
  const end = b.indexOf(0)
  return b.toString('utf8', 0, end < 0 ? b.length : end)
}

function tarSize(field: Buffer) {
  if (field[0] & 0x80) return Number(field.subarray(1).readBigUInt64BE(field.length - 9))
  return parseInt(cString(field).trim() || '0', 8)
}

const paxPath = (data: Buffer) => data.toString('utf8').match(/^\d+ path=(.*)$/m)?.[1] ?? null

async function extractTarGz(file: string, dest: string) {
  const take = byteReader(fs.createReadStream(file).pipe(zlib.createGunzip()))
  let longName: string | null = null
  for (;;) {
    const header = await take(512)
    if (!header || header.every((b) => b === 0)) return
    const size = tarSize(header.subarray(124, 136))
    const type = String.fromCharCode(header[156] || 0x30)
    const padded = Math.ceil(size / 512) * 512

    if (type === 'L' || type === 'x') {
      const data = await take(padded)
      if (!data) throw new Error('tar ファイルが途中で終わっています。')
      longName = type === 'L' ? cString(data.subarray(0, size)) : (paxPath(data.subarray(0, size)) ?? longName)
      continue
    }

    const prefix = header.toString('utf8', 257, 262) === 'ustar' ? cString(header.subarray(345, 500)) : ''
    const name = longName ?? (prefix ? `${prefix}/` : '') + cString(header.subarray(0, 100))
    longName = null

    if (type !== '0') {
      if (padded && !(await take(padded))) throw new Error('tar ファイルが途中で終わっています。')
      continue
    }
    const body = new PassThrough()
    const written = writeEntry(dest, name, body)
    for (let left = size; left > 0;) {
      const chunk = await take(Math.min(left, 1 << 20))
      if (!chunk) throw new Error('tar ファイルが途中で終わっています。')
      if (!body.write(chunk)) await new Promise((resolve) => body.once('drain', resolve))
      left -= chunk.length
    }
    body.end()
    await written
    if (padded > size && !(await take(padded - size))) throw new Error('tar ファイルが途中で終わっています。')
  }
}

/** .mbz を一時ディレクトリに展開して、そのパスを返す。展開済みのディレクトリが渡されたらそのまま返す */
export async function openBackup(input: string) {
  const stat = await fs.promises.stat(input).catch(() => null)
  if (!stat) throw new Error(`${input} が見つかりません。`)
  if (stat.isDirectory()) return { dir: path.resolve(input), cleanup: async () => {} }

  const fd = await fs.promises.open(input)
  const magic = Buffer.alloc(4)
  await fd.read(magic, 0, 4, 0)
  await fd.close()

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'step-learn-moodle-'))
  const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true })
  try {
    if (magic[0] === 0x50 && magic[1] === 0x4b) await extractZip(input, dir)
    else if (magic[0] === 0x1f && magic[1] === 0x8b) await extractTarGz(input, dir)
    else throw new Error('Moodle のバックアップファイル（.mbz）ではありません。')
  } catch (err) {
    await cleanup()
    throw err
  }
  return { dir, cleanup }
}
