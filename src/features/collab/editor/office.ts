/// <reference lib="dom" />
// Office の形式（.docx / .xlsx / .pptx）の読み書きで共通に使う処理

let colorCtx: CanvasRenderingContext2D | null = null

/** CSS の色を RRGGBB（# なし・大文字）にする。読めない・透明なら null */
export function hexColor(color: string | undefined | null): string | null {
  if (!color || color === 'transparent') return null
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.slice(1).toUpperCase()
  colorCtx ??= document.createElement('canvas').getContext('2d')
  if (!colorCtx) return null
  colorCtx.fillStyle = '#000000'
  colorCtx.fillStyle = color
  const normalized = colorCtx.fillStyle
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.slice(1).toUpperCase() : null
}

type ImageData = { data: ArrayBuffer; type: 'png' | 'jpg' | 'gif'; width: number; height: number }

const IMAGE_TYPES: Record<string, ImageData['type']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

/**
 * 画像を取ってきて、Office に入れられる形（PNG・JPEG・GIF）にする。WebP は PNG に描き直す。取れなければ null
 */
export async function fetchImage(src: string): Promise<ImageData | null> {
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const { width, height } = bitmap
    const type = IMAGE_TYPES[blob.type]
    if (type) {
      bitmap.close()
      return { data: await blob.arrayBuffer(), type, width, height }
    }
    const canvas = Object.assign(document.createElement('canvas'), { width, height })
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return png && { data: await png.arrayBuffer(), type: 'png', width, height }
  } catch {
    return null
  }
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Office のファイルの中の画像（拡張子で種類を決める）を、サーバーに置ける Blob にする。置けない種類（EMF など）は null */
export function mediaBlob(name: string, data: Uint8Array | ArrayBuffer): Blob | null {
  const type = MEDIA_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()]
  return type ? new Blob([data instanceof Uint8Array ? new Uint8Array(data) : data], { type }) : null
}

/** 長い辺を max までに縮めた大きさ */
export function fitSize(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}
