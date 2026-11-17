/// <reference lib="dom" />
// 文書と .docx の変換。書き出しは docx、読み込みは mammoth（意味の構造だけを読み、色や揃えは引き継がない）
import type { JSONContent } from '@tiptap/core'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'
import mammoth from 'mammoth/mammoth.browser'
import { fetchImage, fitSize, hexColor } from './office'

// A4 の余白を除いた幅（ピクセル）。画像をこれより大きく入れない
const CONTENT_WIDTH = 600

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 } as const

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const

type Ctx = { images: Map<string, Awaited<ReturnType<typeof fetchImage>>>; lists: number }

type Mark = { type: string; attrs?: Record<string, unknown> }

function textRun(node: JSONContent): TextRun {
  const marks = (node.marks ?? []) as Mark[]
  const has = (type: string) => marks.some((m) => m.type === type)
  const style = marks.find((m) => m.type === 'textStyle')?.attrs
  const highlight = marks.find((m) => m.type === 'highlight')?.attrs
  const color = hexColor(style?.color as string | undefined)
  const fill = highlight ? (hexColor(highlight.color as string | undefined) ?? 'FFFF00') : null
  return new TextRun({
    text: node.text ?? '',
    bold: has('bold') || undefined,
    italics: has('italic') || undefined,
    underline: has('underline') || has('link') ? {} : undefined,
    strike: has('strike') || undefined,
    color: color ?? (has('link') ? '1D4ED8' : undefined),
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    font: has('code') ? 'Consolas' : undefined,
  })
}

function inline(nodes: JSONContent[] | undefined, ctx: Ctx): ParagraphChild[] {
  return (nodes ?? []).flatMap((node): ParagraphChild[] => {
    if (node.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })]
    if (node.type === 'image') return imageRuns(node, ctx)
    if (node.type !== 'text') return []
    const link = ((node.marks ?? []) as Mark[]).find((m) => m.type === 'link')?.attrs?.href
    const run = textRun(node)
    return typeof link === 'string' && /^https?:/.test(link) ? [new ExternalHyperlink({ link, children: [run] })] : [run]
  })
}

function imageRuns(node: JSONContent, ctx: Ctx): ParagraphChild[] {
  const image = ctx.images.get(String(node.attrs?.src))
  if (!image) return []
  return [new ImageRun({ type: image.type, data: image.data, transformation: fitSize(image.width, image.height, CONTENT_WIDTH) })]
}

const alignmentOf = (node: JSONContent) => ALIGNMENTS[node.attrs?.textAlign as keyof typeof ALIGNMENTS]

function paragraph(node: JSONContent, ctx: Ctx, extra: IParagraphOptions = {}) {
  return new Paragraph({ children: inline(node.content, ctx), alignment: alignmentOf(node), ...extra })
}

function listItems(node: JSONContent, ctx: Ctx, reference: string, level: number, instance: number): (Paragraph | Table)[] {
  return (node.content ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((child, i) => {
      if (child.type === 'bulletList') return listItems(child, ctx, 'bullets', level + 1, instance)
      if (child.type === 'orderedList') return listItems(child, ctx, 'numbers', level + 1, ++ctx.lists)
      if (i === 0 && child.type === 'paragraph')
        return [paragraph(child, ctx, { numbering: { reference, level: Math.min(level, 8), instance } })]
      return blocks([child], ctx)
    }),
  )
}

function table(node: JSONContent, ctx: Ctx) {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map((cell) => {
          const children = blocks(cell.content ?? [], ctx)
          return new TableCell({
            children: children.length ? children : [new Paragraph('')],
            columnSpan: Number(cell.attrs?.colspan) || undefined,
            rowSpan: Number(cell.attrs?.rowspan) || undefined,
            shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
          })
        }),
      }),
  )
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function blocks(nodes: JSONContent[], ctx: Ctx): (Paragraph | Table)[] {
  return nodes.flatMap((node): (Paragraph | Table)[] => {
    switch (node.type) {
      case 'paragraph':
        return [paragraph(node, ctx)]
      case 'heading':
        return [paragraph(node, ctx, { heading: HEADINGS[(node.attrs?.level as keyof typeof HEADINGS) ?? 1] ?? HeadingLevel.HEADING_4 })]
      case 'bulletList':
        return listItems(node, ctx, 'bullets', 0, 0)
      case 'orderedList':
        return listItems(node, ctx, 'numbers', 0, ++ctx.lists)
      case 'blockquote':
        return (node.content ?? []).flatMap((child) =>
          child.type === 'paragraph' ? [paragraph(child, ctx, { indent: { left: 720 } })] : blocks([child], ctx),
        )
      case 'codeBlock':
        return (node.content?.[0]?.text ?? '').split('\n').map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Consolas' })],
              shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
            }),
        )
      case 'horizontalRule':
        return [new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } } })]
      case 'image':
        return [new Paragraph({ children: imageRuns(node, ctx) })]
      case 'table':
        return [table(node, ctx)]
      default:
        return node.content ? blocks(node.content, ctx) : []
    }
  })
}

function imageSources(node: JSONContent, found = new Set<string>()) {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') found.add(node.attrs.src)
  for (const child of node.content ?? []) imageSources(child, found)
  return found
}

const LIST_LEVELS = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (level: number) => string) =>
  Array.from({ length: 9 }, (_, level) => ({
    level,
    format,
    text: text(level),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))

/** 文書（TipTap の JSON）を .docx にする */
export async function docToDocx(json: JSONContent) {
  const sources = [...imageSources(json)]
  const images = new Map(await Promise.all(sources.map(async (src) => [src, await fetchImage(src)] as const)))
  const children = blocks(json.content ?? [], { images, lists: 0 })
  const document = new Document({
    styles: { default: { document: { run: { font: 'Yu Gothic', size: 21 } } } },
    numbering: {
      config: [
        { reference: 'bullets', levels: LIST_LEVELS(LevelFormat.BULLET, (l) => ['●', '○', '■'][l % 3]) },
        { reference: 'numbers', levels: LIST_LEVELS(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  })
  return Packer.toBlob(document)
}

/** .docx を、文書に入れる HTML にする。中の画像はサーバーに置き、置けなかった画像は外す */
export async function docxToHtml(file: File, upload: (blob: Blob) => Promise<string | null>) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      styleMap: ['u => u', 'strike => s'],
      convertImage: mammoth.images.imgElement(async (image) => {
        const url = await upload(new Blob([await image.readAsArrayBuffer()], { type: image.contentType }))
        return url ? { src: url } : { src: '' }
      }),
    },
  )
  return result.value.replace(/<img src=""[^>]*>/g, '')
}
