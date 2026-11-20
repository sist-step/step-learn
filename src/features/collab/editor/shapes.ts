// スライドとキャンバスに置くもの（図形・テキスト・画像・付箋・線）の形と描き方
import * as Y from 'yjs'

const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'star', 'arrowRight', 'speech'] as const

export type ShapeKind = (typeof SHAPE_KINDS)[number]

export const isShapeKind = (v: unknown): v is ShapeKind => typeof v === 'string' && (SHAPE_KINDS as readonly string[]).includes(v)

type ElType = 'text' | 'shape' | 'image' | 'note' | 'line' | 'pen'

export type Align = 'left' | 'center' | 'right'

/** 置くもの 1 つ。座標と大きさはスライド・キャンバスの単位（スライドは pt、キャンバスは等倍のピクセル） */
export type ElData = {
  id: string
  type: ElType
  x: number
  y: number
  w: number
  h: number
  z: number
  shape?: ShapeKind
  text?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  color?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: Align
  valign?: 'top' | 'middle' | 'bottom'
  bullet?: boolean
  /** 文字が空のときに薄く出す案内（スライドのタイトルの欄など） */
  placeholder?: string
  src?: string
  /** 線とペンの点（x, y の並び。左上からの位置） */
  points?: number[]
  arrow?: boolean
}

export type ElMap = Y.Map<unknown>

export const hasText = (type: ElType) => type === 'text' || type === 'shape' || type === 'note'

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// 文書に入れる前の Y.Map は読めない（has も get も警告になって空を返す）ので、入れた値を見ずに組み立てる
export function newElement(data: ElData): ElMap {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(data)) if (v !== undefined && k !== 'text') m.set(k, v)
  if (hasText(data.type) || data.text !== undefined) m.set('text', new Y.Text(data.text ?? ''))
  return m
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function readElement(m: ElMap): ElData {
  const text = m.get('text')
  const points = m.get('points')
  return {
    id: str(m.get('id')) ?? '',
    type: (str(m.get('type')) ?? 'shape') as ElType,
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: Math.max(1, num(m.get('w'), 100)),
    h: Math.max(1, num(m.get('h'), 100)),
    z: num(m.get('z')),
    shape: isShapeKind(m.get('shape')) ? (m.get('shape') as ShapeKind) : undefined,
    text: text instanceof Y.Text ? text.toJSON() : undefined,
    fill: str(m.get('fill')),
    stroke: str(m.get('stroke')),
    strokeWidth: typeof m.get('strokeWidth') === 'number' ? num(m.get('strokeWidth')) : undefined,
    color: str(m.get('color')),
    fontSize: typeof m.get('fontSize') === 'number' ? num(m.get('fontSize')) : undefined,
    bold: m.get('bold') === true,
    italic: m.get('italic') === true,
    underline: m.get('underline') === true,
    align: (str(m.get('align')) as Align | undefined) ?? undefined,
    valign: (str(m.get('valign')) as ElData['valign']) ?? undefined,
    bullet: m.get('bullet') === true,
    placeholder: str(m.get('placeholder')),
    src: str(m.get('src')),
    points: Array.isArray(points) ? points.filter((p): p is number => typeof p === 'number') : undefined,
    arrow: m.get('arrow') === true,
  }
}

/** 図形の輪郭（SVG の path）。大きさ w×h の箱に収める */
export function shapePath(kind: ShapeKind, w: number, h: number) {
  switch (kind) {
    case 'rect':
      return `M0 0H${w}V${h}H0Z`
    case 'roundRect': {
      const r = Math.min(w, h) * 0.16
      return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
    }
    case 'ellipse':
      return `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h}A${w / 2} ${h / 2} 0 1 1 ${w / 2} 0Z`
    case 'triangle':
      return `M${w / 2} 0L${w} ${h}H0Z`
    case 'diamond':
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`
    case 'star': {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 ? 0.4 : 1
        pts.push(`${w / 2 + (w / 2) * rr * Math.cos(a)} ${h / 2 + (h / 2) * rr * Math.sin(a) * 1.05 + h * 0.025}`)
      }
      return `M${pts.join('L')}Z`
    }
    case 'arrowRight':
      return `M0 ${h * 0.25}H${w * 0.6}V0L${w} ${h / 2}L${w * 0.6} ${h}V${h * 0.75}H0Z`
    case 'speech':
      return `M0 0H${w}V${h * 0.78}H${w * 0.38}L${w * 0.16} ${h}L${w * 0.2} ${h * 0.78}H0Z`
  }
}

/** ペンの点の並びを、なめらかな線（2 次ベジェ）の path にする */
export function penPath(points: number[]) {
  if (points.length < 4) return points.length >= 2 ? `M${points[0]} ${points[1]}h0.01` : ''
  let d = `M${points[0]} ${points[1]}`
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2
    const my = (points[i + 1] + points[i + 3]) / 2
    d += `Q${points[i]} ${points[i + 1]} ${mx} ${my}`
  }
  return `${d}L${points[points.length - 2]} ${points[points.length - 1]}`
}

/** 点を間引く（Ramer–Douglas–Peucker）。ペンで描いた線を保存する前に、ほとんど変わらない点を落とす */
export function simplify(points: number[], tolerance: number): number[] {
  if (points.length <= 4) return points
  const pts: [number, number][] = []
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]])
  const keep = Array.from({ length: pts.length }, () => false)
  keep[0] = keep[pts.length - 1] = true
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let max = 0
    let index = -1
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay) || 1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len
      if (d > max) {
        max = d
        index = i
      }
    }
    if (max > tolerance && index > 0) {
      keep[index] = true
      stack.push([a, index], [index, b])
    }
  }
  return pts.flatMap((p, i) => (keep[i] ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : []))
}
