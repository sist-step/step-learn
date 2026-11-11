import zlib from 'node:zlib'
import yauzl, { type Entry } from 'yauzl'

export type ZipEntry = { path: string; data: Uint8Array }

const UTF8_NAMES = 0x0800
const STORED = 0
const DEFLATED = 8

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

// ZIP64 に対応しないのは、アイテム 1 つの上限（lib/bundle.ts の MAX_BUNDLE_SIZE・MAX_BUNDLE_FILES）が ZIP の 4GB・65535 件に届かないため
export function buildZip(entries: ZipEntry[], modified = new Date()): Buffer {
  const { time, day } = dosDateTime(modified)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const deflated = zlib.deflateRawSync(entry.data)
    // 縮まないもの（画像や圧縮済みのファイル）は、展開の手間を省くためそのまま入れる
    const compress = deflated.length < entry.data.length
    const body = compress ? deflated : entry.data
    const crc = zlib.crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(compress ? DEFLATED : STORED, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, Buffer.from(body.buffer, body.byteOffset, body.byteLength))

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(compress ? DEFLATED : STORED, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

export class ZipError extends Error {}

/** zip の中のファイル 1 つ。read は中身を展開する（読めなければ ZipError を投げる） */
export type ZipItem = { path: string; size: number; read: () => Promise<Uint8Array<ArrayBuffer>> }

const UNICODE_PATH_FIELD = 0x7075
const UNIX_HOST = 3
const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const BROKEN = 'zip ファイルが壊れているか、zip ではありません。'

// UTF-8 の印がなくても先に UTF-8 として試すのは、macOS の圧縮が印を付けずに UTF-8 で名前を入れるため。
// それで読めなければ Shift_JIS とみなし、yauzl に任せないのは、yauzl が印のない名前を CP437 として読み、日本語の Windows の圧縮（Shift_JIS）が文字化けするため
function nameOf(entry: Entry) {
  const { fileNameRaw: raw, generalPurposeBitFlag: flags, extraFields } = entry
  if (flags & UTF8_NAMES) return new TextDecoder().decode(raw)
  if (extraFields.some((f) => f.id === UNICODE_PATH_FIELD)) return yauzl.getFileNameLowLevel(flags, raw, extraFields, false)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return new TextDecoder('shift_jis').decode(raw)
  }
}

const isLink = (entry: Entry) => entry.versionMadeBy >> 8 === UNIX_HOST && ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK

const asZipError = (e: unknown) => (e instanceof ZipError ? e : new ZipError(BROKEN))

/** zip の中のファイルの一覧。フォルダーとシンボリックリンクは含めない。zip として読めなければ ZipError を投げる */
export async function listZip(data: Uint8Array): Promise<ZipItem[]> {
  try {
    const zip = await yauzl.fromBufferPromise(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      lazyEntries: true,
      decodeStrings: false,
      autoClose: false,
      // 書かれた大きさを超えたら止めるのは、展開すると巨大になる zip（zip 爆弾）でメモリを使い切らないため。呼び出し側は書かれた大きさで上限を確かめる
      validateEntrySizes: true,
    })
    const items: ZipItem[] = []
    for await (const entry of zip.eachEntry()) {
      const path = nameOf(entry).normalize('NFC')
      if (/[/\\]$/.test(path) || isLink(entry)) continue
      const read = async () => {
        if (entry.isEncrypted()) throw new ZipError('パスワード付きの zip には対応していません。')
        if (!entry.canDecodeFileData()) throw new ZipError('対応していない圧縮形式の zip です。')
        try {
          const stream = await zip.openReadStreamPromise(entry)
          return new Uint8Array(Buffer.concat(await stream.toArray()))
        } catch (e) {
          throw asZipError(e)
        }
      }
      items.push({ path, size: entry.uncompressedSize, read })
    }
    return items
  } catch (e) {
    throw asZipError(e)
  }
}
