/// <reference lib="dom" />
// スライドと .pptx の変換。書き出しは pptxgenjs、読み込みはファイルの中の XML を直接読む（図形・テキスト・画像・背景・ノート）
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import type * as Y from 'yjs'
import { fetchImage, hexColor, mediaBlob } from './office'
import { newId, readElement, type Align, type ElData, type ShapeKind } from './shapes'
import { SLIDE_H, SLIDE_W, backgroundOf, elementsOf, notesOf, slidesOf, type SlideData } from './slides'

const PT_PER_IN = 72
const EMU_PER_PT = 12_700

const SHAPES: Record<ShapeKind, PptxGenJS.SHAPE_NAME> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  star: 'star5',
  arrowRight: 'rightArrow',
  speech: 'wedgeRectCallout',
}

const inch = (pt: number) => pt / PT_PER_IN

const box = (d: ElData) => ({ x: inch(d.x), y: inch(d.y), w: inch(d.w), h: inch(d.h) })

function textOptions(d: ElData): PptxGenJS.TextPropsOptions {
  const color = hexColor(d.color)
  return {
    ...box(d),
    fontSize: d.fontSize ?? 18,
    fontFace: 'Yu Gothic',
    bold: d.bold,
    italic: d.italic,
    underline: d.underline ? { style: 'sng' } : undefined,
    color: color ?? '1F2937',
    align: d.align ?? (d.type === 'text' ? 'left' : 'center'),
    valign: d.valign ?? (d.type === 'text' ? 'top' : 'middle'),
    margin: 4,
  }
}

const textRuns = (d: ElData): PptxGenJS.TextProps[] =>
  (d.text ?? '')
    .split('\n')
    .map((line, i, lines) => ({ text: line, options: { bullet: d.bullet && line ? true : undefined, breakLine: i < lines.length - 1 } }))

const base64 = (data: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(data)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** スライドを .pptx にする */
export async function slidesToPptx(doc: Y.Doc) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'STEP Learn'
  for (const slide of slidesOf(doc).toArray()) {
    const s = pptx.addSlide()
    s.background = { color: hexColor(backgroundOf(slide)) ?? 'FFFFFF' }
    const items = [...elementsOf(slide).values()].map(readElement).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
    for (const d of items) {
      if (d.type === 'image' && d.src) {
        const image = await fetchImage(d.src)
        if (image) s.addImage({ ...box(d), data: `image/${image.type === 'jpg' ? 'jpeg' : image.type};base64,${base64(image.data)}` })
      } else if (d.type === 'line') {
        const [x1, y1, x2, y2] = d.points ?? [0, 0, d.w, d.h]
        const forward = x2 >= x1 === y2 >= y1
        const toEnd = forward ? x2 >= x1 : x2 < x1
        const arrow = d.arrow ? 'triangle' : undefined
        s.addShape('line', {
          ...box(d),
          flipH: !forward,
          line: {
            color: hexColor(d.stroke) ?? '1F2937',
            width: d.strokeWidth ?? 2,
            endArrowType: toEnd ? arrow : undefined,
            beginArrowType: toEnd ? undefined : arrow,
          },
        })
      } else if (d.type === 'shape' || d.type === 'note') {
        const fill = hexColor(d.fill) ?? (d.type === 'note' ? 'FEF08A' : null)
        const stroke = d.type === 'note' ? null : hexColor(d.stroke)
        s.addText(textRuns(d), {
          ...textOptions(d),
          shape: d.type === 'note' ? 'rect' : SHAPES[d.shape ?? 'rect'],
          fill: fill ? { color: fill } : undefined,
          line: stroke ? { color: stroke, width: d.strokeWidth ?? 2 } : undefined,
        })
      } else if (d.type === 'text' && d.text) {
        const fill = hexColor(d.fill)
        s.addText(textRuns(d), { ...textOptions(d), fill: fill ? { color: fill } : undefined })
      }
    }
    const notes = notesOf(slide).toJSON()
    if (notes) s.addNotes(notes)
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob
}

// ---------------------------------------------------------------- 読み込み

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

const kids = (el: Element | null | undefined, ns: keyof typeof NS, name: string) =>
  el ? [...el.children].filter((c) => c.namespaceURI === NS[ns] && c.localName === name) : []
const kid = (el: Element | null | undefined, ns: keyof typeof NS, name: string) => kids(el, ns, name)[0] ?? null
const deep = (el: Element | null | undefined, ns: keyof typeof NS, name: string) => (el ? [...el.getElementsByTagNameNS(NS[ns], name)] : [])
const path = (el: Element | null | undefined, steps: [keyof typeof NS, string][]) =>
  steps.reduce<Element | null>((e, [ns, n]) => kid(e, ns, n), el ?? null)
const intAttr = (el: Element | null, name: string) => (el?.hasAttribute(name) ? Number(el.getAttribute(name)) : null)

function resolve(from: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const relsPath = (file: string) => {
  const i = file.lastIndexOf('/')
  return `${file.slice(0, i)}/_rels/${file.slice(i + 1)}.rels`
}

type Xfrm = { x: number; y: number; w: number; h: number; flipH: boolean; flipV: boolean }
type Placeholder = { xfrm: Xfrm | null; type: string; size?: number }
type Ctx = {
  zip: JSZip
  theme: Map<string, string>
  upload: (blob: Blob) => Promise<string | null>
  scale: number
  dx: number
  dy: number
}

async function readXml(zip: JSZip, file: string) {
  const text = await zip.file(file)?.async('text')
  return text ? new DOMParser().parseFromString(text, 'application/xml') : null
}

async function readRels(zip: JSZip, file: string) {
  const xml = await readXml(zip, relsPath(file))
  const map = new Map<string, { target: string; type: string }>()
  for (const rel of xml ? [...xml.getElementsByTagName('Relationship')] : []) {
    const target = rel.getAttribute('Target') ?? ''
    map.set(rel.getAttribute('Id') ?? '', {
      target: rel.getAttribute('TargetMode') === 'External' ? target : resolve(file, target),
      type: (rel.getAttribute('Type') ?? '').split('/').pop() ?? '',
    })
  }
  return map
}

function xfrmOf(el: Element | null): Xfrm | null {
  const off = kid(el, 'a', 'off')
  const ext = kid(el, 'a', 'ext')
  if (!off || !ext) return null
  return {
    x: Number(off.getAttribute('x')) || 0,
    y: Number(off.getAttribute('y')) || 0,
    w: Number(ext.getAttribute('cx')) || 0,
    h: Number(ext.getAttribute('cy')) || 0,
    flipH: el?.getAttribute('flipH') === '1',
    flipV: el?.getAttribute('flipV') === '1',
  }
}

function colorOf(el: Element | null, theme: Map<string, string>): string | undefined {
  if (!el) return undefined
  const srgb = kid(el, 'a', 'srgbClr')?.getAttribute('val')
  if (srgb) return `#${srgb.toLowerCase()}`
  const scheme = kid(el, 'a', 'schemeClr')?.getAttribute('val')
  if (scheme) {
    const key = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[scheme] ?? scheme
    return theme.get(key)
  }
  const sys = kid(el, 'a', 'sysClr')?.getAttribute('lastClr')
  return sys ? `#${sys.toLowerCase()}` : undefined
}

async function readTheme(zip: JSZip, masterFile: string | null) {
  const theme = new Map<string, string>()
  const rels = masterFile ? await readRels(zip, masterFile) : new Map()
  const themeFile = [...rels.values()].find((r) => r.type === 'theme')?.target ?? 'ppt/theme/theme1.xml'
  const xml = await readXml(zip, themeFile)
  const scheme = xml ? deep(xml.documentElement, 'a', 'clrScheme')[0] : null
  for (const c of scheme ? [...scheme.children] : []) {
    const v = kid(c, 'a', 'srgbClr')?.getAttribute('val') ?? kid(c, 'a', 'sysClr')?.getAttribute('lastClr')
    if (v) theme.set(c.localName, `#${v.toLowerCase()}`)
  }
  return theme
}

/** レイアウトとマスターにある、位置の決まった欄（タイトル・本文など）。位置を書いていない欄はここから位置を借りる */
async function readPlaceholders(zip: JSZip, file: string | null) {
  const map = new Map<string, Placeholder>()
  if (!file) return map
  const xml = await readXml(zip, file)
  for (const sp of xml ? deep(xml.documentElement, 'p', 'sp') : []) {
    const ph = path(sp, [
      ['p', 'nvSpPr'],
      ['p', 'nvPr'],
      ['p', 'ph'],
    ])
    if (!ph) continue
    const type = ph.getAttribute('type') ?? 'body'
    const idx = ph.getAttribute('idx')
    const size = deep(sp, 'a', 'defRPr')[0]?.getAttribute('sz')
    const entry = {
      xfrm: xfrmOf(
        path(sp, [
          ['p', 'spPr'],
          ['a', 'xfrm'],
        ]),
      ),
      type,
      size: size ? Number(size) / 100 : undefined,
    }
    if (idx) map.set(`idx:${idx}`, entry)
    if (!map.has(`type:${type}`)) map.set(`type:${type}`, entry)
  }
  return map
}

const PRESETS: Record<string, ShapeKind> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  star5: 'star',
  rightArrow: 'arrowRight',
  wedgeRectCallout: 'speech',
  wedgeRoundRectCallout: 'speech',
}

const ALIGNS: Record<string, Align> = { l: 'left', ctr: 'center', r: 'right', just: 'left' }

function readText(txBody: Element | null, theme: Map<string, string>) {
  const lines: string[] = []
  let first: Element | null = null
  let align: Align | undefined
  let bullet = false
  for (const p of kids(txBody, 'a', 'p')) {
    const pPr = kid(p, 'a', 'pPr')
    align ??= ALIGNS[pPr?.getAttribute('algn') ?? '']
    if (kid(pPr, 'a', 'buChar') || kid(pPr, 'a', 'buAutoNum')) bullet = true
    let line = ''
    for (const child of Array.from(p.children)) {
      if (child.localName === 'r' || child.localName === 'fld') {
        first ??= kid(child, 'a', 'rPr')
        line += kid(child, 'a', 't')?.textContent ?? ''
      } else if (child.localName === 'br') line += '\n'
    }
    lines.push(line)
  }
  const anchor = kid(txBody, 'a', 'bodyPr')?.getAttribute('anchor')
  const size = intAttr(first, 'sz')
  return {
    text: lines.join('\n').replace(/\n+$/, ''),
    align,
    bullet,
    valign: anchor === 'ctr' ? ('middle' as const) : anchor === 'b' ? ('bottom' as const) : anchor === 't' ? ('top' as const) : undefined,
    fontSize: size ? size / 100 : undefined,
    bold: first?.getAttribute('b') === '1',
    italic: first?.getAttribute('i') === '1',
    underline: !!first?.getAttribute('u') && first.getAttribute('u') !== 'none',
    color: colorOf(kid(first, 'a', 'solidFill'), theme),
  }
}

type Transform = (x: Xfrm) => Xfrm

async function readShapes(
  tree: Element,
  ctx: Ctx,
  rels: Map<string, { target: string; type: string }>,
  places: Map<string, Placeholder>[],
  transform: Transform,
) {
  const out: ElData[] = []
  const place = (x: Xfrm) => {
    const t = transform(x)
    return {
      x: Math.round((t.x / EMU_PER_PT) * ctx.scale + ctx.dx),
      y: Math.round((t.y / EMU_PER_PT) * ctx.scale + ctx.dy),
      w: Math.max(4, Math.round((t.w / EMU_PER_PT) * ctx.scale)),
      h: Math.max(4, Math.round((t.h / EMU_PER_PT) * ctx.scale)),
      flipH: t.flipH,
      flipV: t.flipV,
    }
  }
  for (const node of Array.from(tree.children)) {
    const z = out.length + 1
    if (node.localName === 'grpSp') {
      const gx = xfrmOf(
        path(node, [
          ['p', 'grpSpPr'],
          ['a', 'xfrm'],
        ]),
      )
      const chOff = kid(
        path(node, [
          ['p', 'grpSpPr'],
          ['a', 'xfrm'],
        ]),
        'a',
        'chOff',
      )
      const chExt = kid(
        path(node, [
          ['p', 'grpSpPr'],
          ['a', 'xfrm'],
        ]),
        'a',
        'chExt',
      )
      const inner: Transform = (x) => {
        if (!gx || !chOff || !chExt) return transform(x)
        const cx = Number(chOff.getAttribute('x')) || 0
        const cy = Number(chOff.getAttribute('y')) || 0
        const sx = gx.w / (Number(chExt.getAttribute('cx')) || gx.w || 1)
        const sy = gx.h / (Number(chExt.getAttribute('cy')) || gx.h || 1)
        return transform({ ...x, x: gx.x + (x.x - cx) * sx, y: gx.y + (x.y - cy) * sy, w: x.w * sx, h: x.h * sy })
      }
      out.push(...(await readShapes(node, ctx, rels, places, inner)).map((d, i) => ({ ...d, z: z + i })))
      continue
    }
    if (node.localName === 'pic') {
      const embed = deep(node, 'a', 'blip')[0]?.getAttributeNS(NS.r, 'embed')
      const target = embed && rels.get(embed)?.target
      const x = xfrmOf(
        path(node, [
          ['p', 'spPr'],
          ['a', 'xfrm'],
        ]),
      )
      if (!target || !x) continue
      const data = await ctx.zip.file(target)?.async('uint8array')
      const blob = data && mediaBlob(target, data)
      const src = blob && (await ctx.upload(blob))
      if (src) out.push({ id: newId(), type: 'image', src, z, ...place(x) })
      continue
    }
    if (node.localName === 'graphicFrame') {
      const x = xfrmOf(kid(node, 'p', 'xfrm'))
      const rows = deep(node, 'a', 'tr').map((tr) =>
        deep(tr, 'a', 'tc')
          .map((tc) =>
            deep(tc, 'a', 't')
              .map((t) => t.textContent)
              .join(''),
          )
          .join('\t'),
      )
      if (x && rows.length) out.push({ id: newId(), type: 'text', text: rows.join('\n'), fontSize: 14, z, ...place(x) })
      continue
    }
    if (node.localName !== 'sp' && node.localName !== 'cxnSp') continue
    const spPr = kid(node, 'p', 'spPr')
    const ph = path(node, [
      [node.localName === 'sp' ? 'p' : 'p', node.localName === 'sp' ? 'nvSpPr' : 'nvCxnSpPr'],
      ['p', 'nvPr'],
      ['p', 'ph'],
    ])
    const phType = ph?.getAttribute('type') ?? (ph ? 'body' : null)
    const phIdx = ph?.getAttribute('idx')
    const inherited = ph ? places.map((m) => (phIdx && m.get(`idx:${phIdx}`)) || m.get(`type:${phType}`)).find((p) => p?.xfrm) : undefined
    const x = xfrmOf(kid(spPr, 'a', 'xfrm')) ?? inherited?.xfrm ?? null
    if (!x) continue
    const pos = place(x)
    const prst = kid(spPr, 'a', 'prstGeom')?.getAttribute('prst') ?? 'rect'
    const ln = kid(spPr, 'a', 'ln')
    const stroke = kid(ln, 'a', 'noFill') ? undefined : colorOf(kid(ln, 'a', 'solidFill'), ctx.theme)
    const strokeWidth = intAttr(ln, 'w')
    if (node.localName === 'cxnSp' || prst === 'line' || prst.startsWith('straightConnector')) {
      const [x1, x2] = pos.flipH ? [pos.w, 0] : [0, pos.w]
      const [y1, y2] = pos.flipV ? [pos.h, 0] : [0, pos.h]
      const tail = kid(ln, 'a', 'tailEnd')?.getAttribute('type')
      out.push({
        id: newId(),
        type: 'line',
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        z,
        points: [x1, y1, x2, y2],
        stroke: stroke ?? '#1f2937',
        strokeWidth: strokeWidth ? Math.max(1, Math.round(strokeWidth / EMU_PER_PT)) : 2,
        arrow: !!tail && tail !== 'none',
      })
      continue
    }
    const fill = kid(spPr, 'a', 'noFill') ? undefined : colorOf(kid(spPr, 'a', 'solidFill'), ctx.theme)
    const text = readText(kid(node, 'p', 'txBody'), ctx.theme)
    const kind = PRESETS[prst]
    const plainBox = !fill && !stroke && (prst === 'rect' || !kind)
    const titleLike = phType === 'title' || phType === 'ctrTitle'
    const fontSize = Math.round((text.fontSize ?? inherited?.size ?? (titleLike ? 36 : 18)) * ctx.scale)
    out.push({
      id: newId(),
      type: plainBox ? 'text' : 'shape',
      shape: plainBox ? undefined : (kind ?? 'rect'),
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      z,
      text: text.text,
      fill,
      stroke: plainBox ? undefined : stroke,
      strokeWidth: strokeWidth ? Math.max(1, Math.round(strokeWidth / EMU_PER_PT)) : plainBox ? undefined : stroke ? 1 : 0,
      color: text.color,
      fontSize,
      bold: text.bold || titleLike || undefined,
      italic: text.italic || undefined,
      underline: text.underline || undefined,
      align: text.align ?? (phType === 'ctrTitle' || phType === 'subTitle' ? 'center' : undefined),
      valign: text.valign ?? (titleLike ? 'middle' : undefined),
      bullet: text.bullet || (phType === 'body' && !!text.text) || undefined,
    })
  }
  return out
}

async function readNotes(zip: JSZip, file: string | undefined) {
  const xml = file ? await readXml(zip, file) : null
  if (!xml) return ''
  for (const sp of deep(xml.documentElement, 'p', 'sp')) {
    const ph = deep(sp, 'p', 'ph')[0]
    if (ph?.getAttribute('type') !== 'body') continue
    return kids(kid(sp, 'p', 'txBody'), 'a', 'p')
      .map((p) =>
        deep(p, 'a', 't')
          .map((t) => t.textContent)
          .join(''),
      )
      .join('\n')
      .trim()
  }
  return ''
}

/** .pptx をスライドにする。アニメーション・グラフ・SmartArt・図形の回転は読まない */
export async function pptxToSlides(file: File, upload: (blob: Blob) => Promise<string | null>): Promise<SlideData[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const presentationFile = 'ppt/presentation.xml'
  const presentation = await readXml(zip, presentationFile)
  if (!presentation) throw new Error('presentation.xml がありません')
  const size = deep(presentation.documentElement, 'p', 'sldSz')[0]
  const width = (Number(size?.getAttribute('cx')) || SLIDE_W * EMU_PER_PT) / EMU_PER_PT
  const height = (Number(size?.getAttribute('cy')) || SLIDE_H * EMU_PER_PT) / EMU_PER_PT
  const scale = Math.min(SLIDE_W / width, SLIDE_H / height)
  const rels = await readRels(zip, presentationFile)
  const order = deep(presentation.documentElement, 'p', 'sldId')
    .map((s) => rels.get(s.getAttributeNS(NS.r, 'id') ?? '')?.target)
    .filter((t): t is string => !!t)
  const out: SlideData[] = []
  const masters = new Map<string, Map<string, Placeholder>>()
  for (const slideFile of order) {
    const xml = await readXml(zip, slideFile)
    if (!xml) continue
    const slideRels = await readRels(zip, slideFile)
    const layoutFile = [...slideRels.values()].find((r) => r.type === 'slideLayout')?.target ?? null
    const layoutRels = layoutFile ? await readRels(zip, layoutFile) : new Map<string, { target: string; type: string }>()
    const masterFile = [...layoutRels.values()].find((r) => r.type === 'slideMaster')?.target ?? null
    if (masterFile && !masters.has(masterFile)) masters.set(masterFile, await readPlaceholders(zip, masterFile))
    const theme = await readTheme(zip, masterFile)
    const ctx: Ctx = { zip, theme, upload, scale, dx: (SLIDE_W - width * scale) / 2, dy: (SLIDE_H - height * scale) / 2 }
    const places = [await readPlaceholders(zip, layoutFile), masterFile ? masters.get(masterFile)! : new Map<string, Placeholder>()]
    const cSld = kid(xml.documentElement, 'p', 'cSld')
    const bg = colorOf(
      path(cSld, [
        ['p', 'bg'],
        ['p', 'bgPr'],
        ['a', 'solidFill'],
      ]),
      theme,
    )
    const tree = kid(cSld, 'p', 'spTree')
    const elements = tree ? await readShapes(tree, ctx, slideRels, places, (x) => x) : []
    const notesFile = [...slideRels.values()].find((r) => r.type === 'notesSlide')?.target
    out.push({ id: newId(), bg: bg && /^#[0-9a-f]{6}$/.test(bg) ? bg : undefined, notes: await readNotes(zip, notesFile), elements })
  }
  if (!out.length) throw new Error('スライドがありません')
  return out
}
