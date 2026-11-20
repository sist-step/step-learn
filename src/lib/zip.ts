import { promisify } from 'node:util'
import zlib from 'node:zlib'
import yauzl, { type Entry } from 'yauzl'

/** zip に入れるファイル 1 つ。中身は入れる順番が来たときに read で読む */
type ZipSource = { path: string; read: () => Promise<Uint8Array> }

const UTF8_NAMES = 0x0800
const STORED = 0
const DEFLATED = 8
const JST_OFFSET = 9 * 60 * 60 * 1000

const deflateRaw = promisify(zlib.deflateRaw)

// サーバーの現地時刻で書かないのは、コンテナは UTC で動くので、展開したファイルの日時が日本の時刻から 9 時間ずれるため
function dosDateTime(date: Date) {
  const jst = new Date(date.getTime() + JST_OFFSET)
  const time = (jst.getUTCHours() << 11) | (jst.getUTCMinutes() << 5) | Math.floor(jst.getUTCSeconds() / 2)
  const day = ((jst.getUTCFullYear() - 1980) << 9) | ((jst.getUTCMonth() + 1) << 5) | jst.getUTCDate()
  return { time, day }
}

/**
 * ファイルを 1 つずつ読んで縮めながら zip を流す。
 * 全部を読んでから組み立てないのは、アイテム 1 つで数十 MB あり、何人も同時にダウンロードするとメモリを使い切るため
 */
// ZIP64 に対応しないのは、アイテム 1 つの上限（features/bundle/bundle.ts の MAX_BUNDLE_SIZE・MAX_BUNDLE_FILES）が ZIP の 4GB・65535 件に届かないため
export function zipStream(sources: ZipSource[], modified = new Date()): ReadableStream<Uint8Array> {
  const { time, day } = dosDateTime(modified)
  const centrals: Buffer[] = []
  let offset = 0
  let index = 0
  return new ReadableStream({
    async pull(controller) {
      if (index === sources.length) {
        const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
        const end = Buffer.alloc(22)
        end.writeUInt32LE(0x06054b50, 0)
        end.writeUInt16LE(sources.length, 8)
        end.writeUInt16LE(sources.length, 10)
        end.writeUInt32LE(centralSize, 12)
        end.writeUInt32LE(offset, 16)
        for (const b of [...centrals, end]) controller.enqueue(b)
        controller.close()
        return
      }
      const source = sources[index++]
      const name = Buffer.from(source.path, 'utf8')
      const data = await source.read()
      const deflated = await deflateRaw(data)
      // 縮まないもの（画像や圧縮済みのファイル）は、展開の手間を省くためそのまま入れる
      const compress = deflated.length < data.length
      const body = compress ? deflated : data
      const crc = zlib.crc32(data)

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(UTF8_NAMES, 6)
      local.writeUInt16LE(compress ? DEFLATED : STORED, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(day, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      controller.enqueue(local)
      controller.enqueue(name)
      controller.enqueue(body)

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
      central.writeUInt32LE(data.length, 24)
      central.writeUInt16LE(name.length, 28)
      central.writeUInt32LE(offset, 42)
      centrals.push(central, name)

      offset += local.length + name.length + body.length
    },
  })
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
