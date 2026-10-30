import { formatBytes, storage } from './storage'

// SVG を受け付けないのは、スクリプトを埋め込めるので同一オリジンでインライン表示すると XSS になるため
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const

type ImageExt = keyof typeof IMAGE_TYPES

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export const IMAGE_TOO_LARGE = `画像のサイズは ${formatBytes(MAX_IMAGE_SIZE)} までです。`

export const IMAGE_ACCEPT = Object.values(IMAGE_TYPES).join(',')

const isImageExt = (ext: string): ext is ImageExt => Object.hasOwn(IMAGE_TYPES, ext)

const matches = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b)

// ブラウザが送る file.type や拡張子で判定しないのは、利用者が自由に書き換えられるため
async function detectImageType(file: File): Promise<ImageExt | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (matches(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (matches(head, [0xff, 0xd8, 0xff])) return 'jpg'
  if (matches(head, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (matches(head, [0x52, 0x49, 0x46, 0x46]) && matches(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

export async function putImage(prefix: string, file: File): Promise<{ key: string } | { error: string }> {
  if (file.size > MAX_IMAGE_SIZE) return { error: IMAGE_TOO_LARGE }
  const ext = await detectImageType(file)
  if (!ext) return { error: 'PNG・JPEG・WebP・GIF のいずれかの画像を選択してください。' }
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`
  await storage.put(key, file, IMAGE_TYPES[ext])
  return { key }
}

export const imageName = (key: string) => key.slice(key.lastIndexOf('/') + 1)

export async function serveImage(key: string) {
  const name = imageName(key)
  const ext = name.slice(name.lastIndexOf('.') + 1)
  if (!isImageExt(ext)) return null
  return storage.serve(key, { filename: name, contentType: IMAGE_TYPES[ext], inline: true })
}
