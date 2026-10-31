/// <reference lib="dom" />

import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

type Tone = 'cyan' | 'amber' | 'rose' | 'violet' | 'emerald'
type Paint = Tone | 'shine' | 'deep'
type Palette = { deep: Color; mid: Color; bright: Color; shine: Color; tones: Record<Tone, Color> }
type Put = (x: number, y: number, z: number, paint: Paint) => void
type Cell = { x: number; y: number; z: number; paint: Paint }
type Model = { cells: Cell[]; height: number; radius: number; lift: number }
type Voxel = {
  pos: Vector3
  vel: Vector3
  home: Vector3 | null
  prevHome: Vector3 | null
  leaveAt: number
  buildAt: number
  freeUntil: number
  color: Color
  goalColor: Color
  scale: number
  spin: Vector3
  tumble: Vector3
  orbit: { radius: number; height: number; phase: number; speed: number }
}

const VOXEL = 0.2
const LEAVE = 0.6
const SWIRL = 0.9
const BUILD = 2.2
const HOLD = 4.2
const SPARE_VOXELS = 60
const AUTO_SPIN = 0.35
const LOOK_AT = new Vector3(0, 1.9, 0)
const CAMERA_OFFSET = new Vector3(1.8, 2, 10.5)
const UP = new Vector3(0, 1, 0)
const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

const cycle = <T>(list: readonly T[], i: number) => list[((i % list.length) + list.length) % list.length]
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const random = (min: number, max: number) => min + Math.random() * (max - min)

function sculpt(lift: number, draw: (put: Put) => void): Model {
  const grid = new Map<string, Cell>()
  draw((x, y, z, paint) => grid.set(`${x},${y},${z}`, { x, y, z, paint }))
  // 中まで詰めないのは、外から見えないキューブまで組み立てると数が倍になり、組み上がるのが遅く見えるため
  const cells = [...grid.values()].filter(({ x, y, z }) => !NEIGHBORS.every(([dx, dy, dz]) => grid.has(`${x + dx},${y + dy},${z + dz}`)))
  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const zs = cells.map((c) => c.z)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const minY = Math.min(...ys)
  const moved = cells.map((c) => ({ ...c, x: c.x - cx, y: c.y - minY, z: c.z - cz }))
  return { cells: moved, height: Math.max(...ys) - minY + 1, radius: Math.max(...moved.map((c) => Math.hypot(c.x, c.z))), lift }
}

function box(put: Put, [x0, x1]: number[], [y0, y1]: number[], [z0, z1]: number[], paint: Paint) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(x, y, z, paint)
}

function blob(put: Put, [cx, cy, cz]: number[], [rx, ry, rz]: number[], paint: Paint) {
  for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let z = Math.floor(cz - rz); z <= cz + rz; z++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1) put(x, y, z, paint)
}

function insidePolygon(x: number, y: number, points: number[][]) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function smile(put: Put, z: number, eyeY: number, gap: number) {
  put(-gap, eyeY, z, 'deep')
  put(gap, eyeY, z, 'deep')
  put(-gap - 1, eyeY - 2, z, 'rose')
  put(gap + 1, eyeY - 2, z, 'rose')
  put(0, eyeY - 1, z, 'deep')
}

const rocket = sculpt(0, (put) => {
  for (let y = 0; y <= 1; y++)
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x * x + z * z <= 1) put(x, y, z, y ? 'amber' : 'rose')
  for (let y = 2; y <= 11; y++)
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 5) put(x, y, z, y === 4 || y === 10 ? 'rose' : 'shine')
  box(put, [-1, 1], [7, 8], [2, 2], 'cyan')
  ;[4, 2, 1, 0].forEach((r2, n) => {
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= r2) put(x, 12 + n, z, 'rose')
  })
  for (const [dx, dz] of NEIGHBORS.filter(([, dy]) => dy === 0).map(([x, , z]) => [x, z])) {
    for (let y = 2; y <= 5; y++) put(dx * 3, y, dz * 3, 'violet')
    for (let y = 2; y <= 3; y++) put(dx * 4, y, dz * 4, 'violet')
  }
})

const robot = sculpt(0, (put) => {
  box(put, [-2, -1], [0, 2], [-1, 0], 'violet')
  box(put, [1, 2], [0, 2], [-1, 0], 'violet')
  box(put, [-3, 3], [3, 7], [-2, 1], 'shine')
  box(put, [-1, 1], [4, 5], [2, 2], 'emerald')
  box(put, [-5, -4], [3, 6], [-1, 0], 'violet')
  box(put, [4, 5], [3, 6], [-1, 0], 'violet')
  box(put, [-1, 1], [8, 8], [-1, 0], 'violet')
  box(put, [-4, 4], [9, 14], [-2, 2], 'shine')
  box(put, [-3, 3], [10, 13], [3, 3], 'deep')
  box(put, [-2, -2], [11, 12], [3, 3], 'cyan')
  box(put, [2, 2], [11, 12], [3, 3], 'cyan')
  put(-5, 11, 0, 'amber')
  put(5, 11, 0, 'amber')
  box(put, [0, 0], [15, 16], [0, 0], 'violet')
  put(0, 17, 0, 'amber')
})

const cat = sculpt(0, (put) => {
  blob(put, [0, 3, 0], [3.2, 3.6, 2.6], 'amber')
  box(put, [-1, 1], [1, 4], [3, 3], 'shine')
  blob(put, [0, 9, 0.5], [3.7, 3.1, 2.9], 'amber')
  for (const side of [-1, 1]) {
    for (let x = 1; x <= 3; x++) box(put, [side * x, side * x], [12, 12], [0, 1], 'amber')
    for (let x = 2; x <= 3; x++) box(put, [side * x, side * x], [13, 13], [0, 1], 'amber')
    put(side * 3, 14, 0, 'amber')
    put(side * 2, 12, 2, 'rose')
  }
  smile(put, 3, 9, 2)
  for (const [x, y] of [
    [3, 1],
    [4, 1],
    [5, 2],
    [5, 3],
    [5, 4],
    [5, 5],
  ])
    put(x, y, -2, 'amber')
  put(4, 6, -2, 'shine')
  put(-1, 0, 2, 'shine')
  put(1, 0, 2, 'shine')
})

const heart = sculpt(0.5, (put) => {
  for (let x = -7; x <= 7; x++)
    for (let y = -7; y <= 8; y++) {
      const X = x / 6
      const Y = y / 6
      if ((X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 <= 0) box(put, [x, x], [y, y], [-1, 1], 'rose')
    }
  put(-4, 4, 2, 'shine')
  put(-3, 5, 2, 'shine')
  smile(put, 2, 1, 2)
})

const star = sculpt(0.5, (put) => {
  const points = Array.from({ length: 10 }, (_, k) => {
    const r = k % 2 ? 3.4 : 8
    const a = (Math.PI / 5) * k + Math.PI / 2
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) if (insidePolygon(x, y, points)) box(put, [x, x], [y, y], [-1, 1], 'amber')
  smile(put, 2, 1, 2)
})

const house = sculpt(0, (put) => {
  box(put, [-4, 4], [0, 6], [-3, 3], 'shine')
  for (let k = 0; k <= 4; k++) box(put, [-5 + k, 5 - k], [7 + k, 7 + k], [-4, 4], 'rose')
  box(put, [-1, 1], [0, 3], [4, 4], 'amber')
  box(put, [-3, -2], [3, 4], [4, 4], 'cyan')
  box(put, [2, 3], [3, 4], [4, 4], 'cyan')
  box(put, [2, 3], [9, 11], [-2, -1], 'violet')
})

const tree = sculpt(0, (put) => {
  box(put, [-1, 1], [0, 5], [-1, 1], 'amber')
  blob(put, [0, 9, 0], [4.5, 3.8, 4.5], 'emerald')
  blob(put, [0, 12.5, 0], [3, 2.2, 3], 'emerald')
  for (const [x, y, z] of [
    [-2, 9, 5],
    [2, 10, 4],
    [4, 8, 2],
    [-4, 10, -2],
    [1, 13, 3],
  ])
    put(x, y, z, 'rose')
})

const dinosaur = sculpt(0, (put) => {
  blob(put, [0, 5, 0], [4, 3, 2.5], 'emerald')
  for (const x of [-3, 1]) for (const z of [-2, 1]) box(put, [x, x + 1], [0, 2], [z, z + 1], 'emerald')
  box(put, [3, 5], [6, 9], [-1, 1], 'emerald')
  box(put, [4, 8], [9, 12], [-2, 2], 'emerald')
  box(put, [-5, -4], [4, 5], [-1, 1], 'emerald')
  box(put, [-7, -6], [3, 4], [0, 0], 'emerald')
  put(-8, 3, 0, 'emerald')
  box(put, [-2, 2], [3, 5], [3, 3], 'shine')
  for (const [x, y] of [
    [-3, 8],
    [-1, 9],
    [1, 9],
    [3, 10],
  ])
    put(x, y, 0, 'amber')
  for (const z of [-3, 3]) {
    put(6, 11, z, 'deep')
    put(7, 10, z, 'rose')
  }
})

const iceCream = sculpt(0, (put) => {
  for (let y = 0; y <= 6; y++) {
    const r = 0.5 + y * 0.42
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= r * r) put(x, y, z, 'amber')
  }
  blob(put, [0, 9, 0], [3.2, 2.6, 3.2], 'rose')
  blob(put, [0, 12.5, 0], [2.8, 2.3, 2.8], 'cyan')
  for (const [x, y, z, p] of [
    [-2, 9, 3, 'shine'],
    [2, 8, 3, 'violet'],
    [0, 10, 3, 'emerald'],
    [-3, 8, 1, 'amber'],
  ] as [number, number, number, Paint][])
    put(x, y, z, p)
  smile(put, 3, 13, 1)
  put(0, 15, 0, 'rose')
  put(0, 16, 0, 'emerald')
})

const rabbit = sculpt(0, (put) => {
  blob(put, [0, 3, 0], [3, 3.2, 2.6], 'shine')
  blob(put, [0, 8.5, 0.5], [3, 2.6, 2.6], 'shine')
  for (const x of [-2, 1]) {
    box(put, [x, x + 1], [11, 16], [0, 0], 'shine')
    box(put, [x, x + 1], [12, 15], [1, 1], 'rose')
  }
  smile(put, 3, 9, 1)
  put(-2, 0, 2, 'shine')
  put(2, 0, 2, 'shine')
  put(0, 2, -3, 'shine')
  box(put, [3, 3], [2, 4], [2, 2], 'amber')
  put(3, 5, 2, 'emerald')
})

const ufo = sculpt(0.6, (put) => {
  for (let x = -6; x <= 6; x++)
    for (let z = -6; z <= 6; z++) {
      const d = x * x + z * z
      if (d <= 16) box(put, [x, x], [2, 2], [z, z], 'violet')
      if (d <= 31) box(put, [x, x], [3, 4], [z, z], 'violet')
      if (d <= 18) box(put, [x, x], [5, 5], [z, z], 'violet')
    }
  for (let x = -3; x <= 3; x++)
    for (let y = 6; y <= 9; y++) for (let z = -3; z <= 3; z++) if (x * x + (y - 6) ** 2 + z * z <= 10) put(x, y, z, 'cyan')
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k
    put(Math.round(Math.cos(a) * 5.5), 3, Math.round(Math.sin(a) * 5.5), 'amber')
  }
  smile(put, 3, 8, 1)
})

const snowman = sculpt(0, (put) => {
  blob(put, [0, 3, 0], [3.6, 3.4, 3.6], 'shine')
  blob(put, [0, 8.5, 0], [2.8, 2.5, 2.8], 'shine')
  blob(put, [0, 12.5, 0], [2.2, 2, 2.2], 'shine')
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 6) put(x, 11, z, 'rose')
  put(0, 7, 3, 'deep')
  put(0, 9, 3, 'deep')
  put(-1, 13, 2, 'deep')
  put(1, 13, 2, 'deep')
  put(0, 12, 3, 'amber')
  put(0, 12, 4, 'amber')
  box(put, [-2, 2], [14, 14], [-2, 2], 'violet')
  box(put, [-1, 1], [15, 17], [-1, 1], 'violet')
  box(put, [-1, 1], [15, 15], [-1, 1], 'rose')
  box(put, [3, 5], [9, 9], [0, 0], 'amber')
  box(put, [-5, -3], [9, 9], [0, 0], 'amber')
})

const laptop = sculpt(0, (put) => {
  box(put, [-6, 6], [0, 0], [-2, 4], 'violet')
  for (let x = -5; x <= 5; x += 2) for (let z = 0; z <= 3; z++) put(x, 1, z, 'shine')
  box(put, [-6, 6], [1, 9], [-3, -3], 'violet')
  box(put, [-5, 5], [2, 8], [-2, -2], 'deep')
  for (const [y, x0, x1, p] of [
    [7, -4, 0, 'cyan'],
    [6, -3, 2, 'amber'],
    [5, -3, -1, 'rose'],
    [5, 0, 3, 'emerald'],
    [4, -4, 1, 'violet'],
    [3, -3, 2, 'cyan'],
  ] as [number, number, number, Paint][])
    box(put, [x0, x1], [y, y], [-2, -2], p)
})

const bulb = sculpt(0, (put) => {
  for (let y = 0; y <= 2; y++)
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 3) put(x, y, z, y % 2 ? 'shine' : 'violet')
  for (let y = 3; y <= 4; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 4) put(x, y, z, 'amber')
  blob(put, [0, 8, 0], [3.5, 3.8, 3.5], 'amber')
  put(-2, 10, 3, 'shine')
  put(-1, 11, 3, 'shine')
  smile(put, 4, 8, 1)
})

const gamepad = sculpt(0.8, (put) => {
  box(put, [-7, 7], [0, 4], [-1, 1], 'violet')
  box(put, [-7, -4], [-3, -1], [-1, 1], 'violet')
  box(put, [4, 7], [-3, -1], [-1, 1], 'violet')
  box(put, [-5, -5], [1, 3], [2, 2], 'shine')
  box(put, [-6, -4], [2, 2], [2, 2], 'shine')
  for (const [x, y, p] of [
    [5, 3, 'amber'],
    [6, 2, 'rose'],
    [4, 2, 'cyan'],
    [5, 1, 'emerald'],
  ] as [number, number, Paint][])
    put(x, y, 2, p)
  put(-1, 3, 2, 'shine')
  put(1, 3, 2, 'shine')
  box(put, [-6, -4], [5, 5], [-1, 0], 'rose')
  box(put, [4, 6], [5, 5], [-1, 0], 'cyan')
})

const headphones = sculpt(0, (put) => {
  for (const side of [-1, 1]) {
    box(put, side < 0 ? [-8, -7] : [7, 8], [0, 4], [-2, 2], 'shine')
    box(put, [side * 6, side * 6], [1, 3], [-1, 1], 'rose')
  }
  for (let a = 0; a <= Math.PI; a += 0.04) {
    const x = Math.round(Math.cos(a) * 7.5)
    const y = Math.round(4 + Math.sin(a) * 7)
    box(put, [x, x], [y, y], [-1, 0], 'violet')
  }
})

const smartphone = sculpt(0.3, (put) => {
  box(put, [-4, 4], [0, 15], [-1, -1], 'violet')
  box(put, [-4, 4], [0, 15], [0, 0], 'violet')
  box(put, [-3, 3], [1, 14], [0, 0], 'deep')
  ;[12, 10, 8].forEach((y, row) =>
    [-2, 0, 2].forEach((x, col) => put(x, y, 0, cycle(['cyan', 'amber', 'rose', 'emerald', 'violet'] as Paint[], row * 3 + col))),
  )
  box(put, [-2, 2], [3, 3], [0, 0], 'shine')
  box(put, [-1, 1], [14, 14], [0, 0], 'violet')
  box(put, [-3, -1], [11, 14], [-2, -2], 'deep')
  put(-2, 13, -3, 'cyan')
  put(-2, 11, -3, 'cyan')
  put(0, 14, -2, 'amber')
})

const guitar = sculpt(0, (put) => {
  blob(put, [0, 4, 0], [4, 3.2, 1.2], 'rose')
  blob(put, [0, 8.5, 0], [3, 2.4, 1.2], 'rose')
  box(put, [-1, 1], [3, 3], [1, 1], 'shine')
  box(put, [-1, 1], [5, 5], [1, 1], 'deep')
  box(put, [-1, 1], [7, 7], [1, 1], 'deep')
  box(put, [0, 0], [11, 19], [0, 0], 'amber')
  box(put, [-1, 1], [20, 22], [0, 0], 'amber')
  for (const y of [20, 22]) for (const x of [-2, 2]) put(x, y, 0, 'shine')
})

const drone = sculpt(0.6, (put) => {
  box(put, [-2, 2], [2, 3], [-2, 2], 'shine')
  put(0, 1, 2, 'deep')
  put(-1, 3, 3, 'cyan')
  put(1, 3, 3, 'cyan')
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      for (let k = 3; k <= 5; k++) put(sx * k, 2, sz * k, 'violet')
      put(sx * 5, 3, sz * 5, 'violet')
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= 4) put(sx * 5 + dx, 4, sz * 5 + dz, 'rose')
    }
})

const basketball = sculpt(0.3, (put) => {
  for (let x = -5; x <= 5; x++)
    for (let y = -5; y <= 5; y++)
      for (let z = -5; z <= 5; z++) if (x * x + y * y + z * z <= 26) put(x, y, z, x === 0 || y === 0 ? 'deep' : 'amber')
})

const skateboard = sculpt(0.4, (put) => {
  box(put, [-7, 7], [2, 2], [-2, 2], 'violet')
  box(put, [-9, -8], [3, 3], [-2, 2], 'violet')
  box(put, [8, 9], [3, 3], [-2, 2], 'violet')
  box(put, [-4, 4], [2, 2], [0, 0], 'rose')
  box(put, [-2, 2], [2, 2], [-1, 1], 'amber')
  for (const x of [-6, 6]) {
    box(put, [x - 1, x + 1], [1, 1], [-1, 1], 'shine')
    for (const z of [-2, 2]) box(put, [x - 1, x], [0, 0], [z, z], 'cyan')
  }
})

const trophy = sculpt(0, (put) => {
  box(put, [-3, 3], [0, 1], [-3, 3], 'violet')
  box(put, [-1, 1], [2, 4], [-1, 1], 'amber')
  for (let y = 5; y <= 11; y++) {
    const r = 2 + (y - 5) * 0.35
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const d = Math.hypot(x, z)
        if (d <= r && (y === 5 || d > r - 1.3)) put(x, y, z, 'amber')
      }
  }
  for (const side of [-1, 1])
    for (const [x, y] of [
      [5, 10],
      [6, 9],
      [6, 8],
      [5, 7],
    ])
      put(side * x, y, 0, 'amber')
  for (const [x, y] of [
    [0, 8],
    [-1, 8],
    [1, 8],
    [0, 9],
    [0, 7],
  ])
    put(x, y, 3, 'rose')
})

const sword = sculpt(0, (put) => {
  box(put, [-1, 1], [6, 18], [0, 0], 'shine')
  box(put, [0, 0], [7, 17], [0, 0], 'cyan')
  put(0, 19, 0, 'shine')
  box(put, [-4, 4], [5, 5], [-1, 1], 'amber')
  put(0, 5, 2, 'rose')
  box(put, [0, 0], [1, 4], [-1, 1], 'violet')
  box(put, [-1, 1], [0, 0], [-1, 1], 'amber')
})

const MODELS = [
  rocket,
  gamepad,
  cat,
  headphones,
  house,
  guitar,
  iceCream,
  drone,
  robot,
  basketball,
  tree,
  smartphone,
  ufo,
  skateboard,
  rabbit,
  trophy,
  heart,
  sword,
  dinosaur,
  laptop,
  snowman,
  bulb,
  star,
]

function readPalette(host: HTMLElement): Palette {
  const read = (el: Element, name: string) => new Color(getComputedStyle(el).getPropertyValue(name).trim())
  const tone = (name: Tone) => {
    // :root から読まないのは、コースの色が tone-* クラスにだけ定義されているため
    const probe = document.createElement('i')
    probe.className = `tone-${name}`
    host.append(probe)
    const color = read(probe, '--c1')
    probe.remove()
    return color
  }
  return {
    deep: read(host, '--art-deep'),
    mid: read(host, '--art-mid'),
    bright: read(host, '--art-bright'),
    shine: read(host, '--art-shine'),
    tones: { cyan: tone('cyan'), amber: tone('amber'), rose: tone('rose'), violet: tone('violet'), emerald: tone('emerald') },
  }
}

function starShape(outer: number, inner: number) {
  const s = new Shape()
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? inner : outer
    const a = (Math.PI / 5) * k + Math.PI / 2
    if (k) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  return s
}

function buildScene(host: HTMLElement) {
  const palette = readPalette(host)
  const paint = (p: Paint) => (p === 'shine' ? palette.shine : p === 'deep' ? palette.deep : palette.tones[p])
  const tones = Object.values(palette.tones)
  const scene = new Scene()
  scene.background = palette.deep.clone()
  scene.fog = new Fog(palette.deep, 13, 30)

  const sky = new HemisphereLight(palette.shine.clone().lerp(palette.bright, 0.25), palette.mid, 1.7)
  const sun = new DirectionalLight(palette.shine, 2.3)
  sun.position.set(-3, 8, 5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -4
  sun.shadow.camera.right = sun.shadow.camera.top = 4
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 20
  sun.shadow.bias = -0.002
  const rim = new DirectionalLight(palette.tones.violet, 1.4)
  rim.position.set(4, 3, -6)
  scene.add(sky, sun, rim)

  const pedestal = new Mesh(
    new CylinderGeometry(2.1, 2.3, 0.3, 64),
    new MeshStandardMaterial({ color: palette.deep.clone().lerp(palette.mid, 0.5), roughness: 0.35, metalness: 0.4 }),
  )
  pedestal.position.y = -0.15
  pedestal.receiveShadow = true
  const rimGlow = new Mesh(new TorusGeometry(2.15, 0.035, 8, 96), new MeshBasicMaterial({ color: palette.bright }))
  rimGlow.rotation.x = Math.PI / 2
  scene.add(pedestal, rimGlow)

  const sculpture = new Group()
  scene.add(sculpture)
  const count = Math.max(...MODELS.map((m) => m.cells.length)) + SPARE_VOXELS
  const cubes = new InstancedMesh(
    new RoundedBoxGeometry(VOXEL * 0.92, VOXEL * 0.92, VOXEL * 0.92, 2, 0.035),
    new MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }),
    count,
  )
  cubes.castShadow = cubes.receiveShadow = true
  sculpture.add(cubes)
  const voxels: Voxel[] = Array.from({ length: count }, (_, k) => {
    const orbit = { radius: random(2.4, 3.4), height: random(0.3, 3.6), phase: random(0, Math.PI * 2), speed: random(0.3, 0.8) }
    const color = cycle(tones, k).clone()
    return {
      pos: new Vector3(Math.cos(orbit.phase) * orbit.radius, orbit.height, Math.sin(orbit.phase) * orbit.radius),
      vel: new Vector3(),
      home: null,
      prevHome: null,
      leaveAt: 0,
      buildAt: Infinity,
      freeUntil: 0,
      color,
      goalColor: color.clone(),
      scale: 0.5,
      spin: new Vector3(random(0, 6), random(0, 6), random(0, 6)),
      tumble: new Vector3(random(-3, 3), random(-3, 3), random(-3, 3)),
      orbit,
    }
  })

  const sparkGeometry = new ShapeGeometry(starShape(0.09, 0.04))
  const sparks = Array.from({ length: 48 }, () => {
    const mesh = new Mesh(sparkGeometry, new MeshBasicMaterial({ transparent: true, depthWrite: false }))
    mesh.visible = false
    scene.add(mesh)
    return { mesh, velocity: new Vector3(), life: 0 }
  })
  let nextSpark = 0
  const burst = (at: Vector3, { count = 14, power = 2.2, color }: { count?: number; power?: number; color?: Color } = {}) => {
    for (let k = 0; k < count; k++) {
      const spark = sparks[nextSpark++ % sparks.length]
      const a = (Math.PI * 2 * k) / count + Math.random() * 0.3
      spark.mesh.material.color.copy(color ?? cycle(tones, k))
      spark.mesh.position.copy(at)
      spark.velocity.set(Math.cos(a) * power, Math.sin(a) * power + power * 0.55, random(-0.75, 0.75))
      spark.life = 1
      spark.mesh.visible = true
    }
  }

  let model = MODELS[0]
  let modelIndex = -1
  let buildFrom = 0
  let nextModelAt = 0
  function startModel(time: number, index: number) {
    modelIndex = ((index % MODELS.length) + MODELS.length) % MODELS.length
    model = MODELS[modelIndex]
    buildFrom = time + SWIRL
    nextModelAt = buildFrom + BUILD + HOLD
    const homes = model.cells
      .map((cell) => ({ cell, order: cell.y + Math.random() * 0.8 }))
      .sort((a, b) => a.order - b.order)
      .map(({ cell }) => cell)
    const order = voxels.map((_, k) => k).sort(() => Math.random() - 0.5)
    const top = model.height * VOXEL + model.lift + 1
    order.forEach((k, n) => {
      const v = voxels[k]
      v.prevHome = v.home
      v.leaveAt = time + (v.home ? (1 - v.home.y / top) * LEAVE : 0)
      const cell = homes[n]
      if (!cell) {
        v.home = null
        v.buildAt = Infinity
        return
      }
      v.home = new Vector3(cell.x * VOXEL, cell.y * VOXEL + VOXEL / 2 + model.lift, cell.z * VOXEL)
      v.buildAt = buildFrom + (cell.y / model.height) * BUILD + Math.random() * 0.15
      v.goalColor = paint(cell.paint).clone()
    })
  }

  const camera = new PerspectiveCamera(34, 1, 0.1, 80)
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  const view = { pitch: 0, held: false, spin: AUTO_SPIN }
  const poked = { combo: 0, last: -10 }
  const matrix = new Matrix4()
  const turn = new Quaternion()
  const euler = new Euler()
  const goal = new Vector3()
  const pull = new Vector3()
  const size = new Vector3()
  let lastTime = 0

  function update(time: number, dt: number) {
    if (modelIndex < 0 || time >= nextModelAt) startModel(time, modelIndex + 1)

    voxels.forEach((v, k) => {
      const free = time < v.freeUntil
      const settled = !!v.home && time >= v.buildAt
      const leaving = !!v.prevHome && time < v.leaveAt
      if (leaving) goal.copy(v.prevHome!)
      else if (settled) goal.copy(v.home!)
      else {
        const a = v.orbit.phase + time * v.orbit.speed
        goal.set(Math.cos(a) * v.orbit.radius, v.orbit.height + Math.sin(time * 0.9 + v.orbit.phase) * 0.25, Math.sin(a) * v.orbit.radius)
      }
      // 1 回でまとめて進めないのは、描画が遅い端末で dt が大きくなると、ばねが暴れてキューブが飛び散るため
      for (let step = 0; step < 2; step++) {
        const h = dt / 2
        if (free) {
          v.vel.multiplyScalar(Math.exp(-h * 1.2))
          v.vel.y -= 3 * h
        } else {
          v.vel.addScaledVector(pull.subVectors(goal, v.pos), 90 * h).multiplyScalar(Math.exp(-h * 11))
        }
        v.pos.addScaledVector(v.vel, h)
      }
      const away = free ? 1 : Math.min(1, v.pos.distanceTo(goal) * 1.5)
      if (away > 0.02) v.spin.addScaledVector(v.tumble, dt * away * (free ? 2.5 : 1))
      else v.spin.multiplyScalar(Math.exp(-dt * 10))
      v.scale += (settled || leaving || free ? 1 - v.scale : 0.45 - v.scale) * (1 - Math.exp(-dt * 6))
      if (settled) v.color.lerp(v.goalColor, 1 - Math.exp(-dt * 8))
      matrix.compose(v.pos, turn.setFromEuler(euler.set(v.spin.x, v.spin.y, v.spin.z)), size.setScalar(v.scale))
      cubes.setMatrixAt(k, matrix)
      cubes.setColorAt(k, v.color)
    })
    cubes.instanceMatrix.needsUpdate = true
    if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true

    rimGlow.scale.setScalar(1 + 0.02 * Math.sin(time * 3))

    if (!view.held) {
      view.spin += (AUTO_SPIN - view.spin) * (1 - Math.exp(-dt * 1.2))
      view.pitch *= Math.exp(-dt * 2.5)
      sculpture.rotation.y += view.spin * dt
    }

    for (const spark of sparks) {
      if (spark.life <= 0) continue
      spark.life -= dt / 0.9
      spark.velocity.y -= dt * 4
      spark.mesh.position.addScaledVector(spark.velocity, dt)
      spark.mesh.quaternion.copy(camera.quaternion)
      spark.mesh.rotateZ(time * 6)
      spark.mesh.scale.setScalar(Math.max(0.001, spark.life))
      spark.mesh.material.opacity = clamp01(spark.life * 1.5)
      spark.mesh.visible = spark.life > 0
    }

    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 4))
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 4))
    const offset = CAMERA_OFFSET.clone()
    offset.applyAxisAngle(new Vector3().crossVectors(offset, UP).normalize(), view.pitch)
    camera.position
      .copy(LOOK_AT)
      .add(offset)
      .add(new Vector3(pointer.x * 0.8, -pointer.y * 0.5, 0))
    camera.lookAt(LOOK_AT)

    lastTime = time
  }

  const setPointer = (x: number, y: number) => {
    pointer.tx = x
    pointer.ty = y
  }

  const raycaster = new Raycaster()
  const hit = (ndc: Vector2) => {
    raycaster.setFromCamera(ndc, camera)
    cubes.computeBoundingSphere()
    return raycaster.intersectObject(cubes, false)[0]?.point ?? null
  }
  const scatter = (at: Vector3, reach: number, power: number) => {
    const center = sculpture.worldToLocal(at.clone())
    for (const v of voxels) {
      const away = v.pos.clone().sub(center)
      const distance = away.length()
      if (distance > reach) continue
      const force = 1 - distance / reach
      if (distance < 0.001) away.set(random(-1, 1), 1, random(-1, 1))
      v.vel.addScaledVector(away.normalize(), power * force + 1)
      v.vel.y += power * 0.5 * force
      v.freeUntil = lastTime + random(0.5, 1.1)
      v.tumble.set(random(-8, 8), random(-8, 8), random(-8, 8))
    }
  }
  const poke = (ndc: Vector2) => {
    const time = lastTime
    const target = hit(ndc)
    if (target) {
      poked.combo = time - poked.last < 0.6 ? poked.combo + 1 : 1
      poked.last = time
      if (poked.combo < 3) {
        scatter(target, 0.9, 6)
        burst(target, { count: 10, power: 1.6 })
        return
      }
      poked.combo = 0
      scatter(target, 10, 7)
      burst(target, { count: 24, power: 3 })
      startModel(time + 0.6, modelIndex + 1)
    } else {
      raycaster.setFromCamera(ndc, camera)
      burst(raycaster.ray.at(camera.position.distanceTo(LOOK_AT), new Vector3()), { count: 10, power: 1.4 })
    }
  }
  const canPoke = (ndc: Vector2) => hit(ndc) !== null
  let lastDrag = 0
  const drag = (dx: number, dy: number) => {
    const now = performance.now()
    const turnBy = dx * 0.01
    view.held = true
    sculpture.rotation.y += turnBy
    view.spin = turnBy / Math.max(1 / 120, (now - lastDrag) / 1000)
    view.pitch = Math.max(-0.45, Math.min(0.6, view.pitch + dy * 0.004))
    lastDrag = now
  }
  const release = () => {
    view.held = false
    // 止めてから離したときに勢いを残さないのは、そっと置いたつもりの作品が急に回り出すため
    if (performance.now() - lastDrag > 80) view.spin = 0
  }
  return { scene, camera, update, setPointer, poke, canPoke, drag, release }
}

type Art = {
  canvas: HTMLCanvasElement
  observer: ResizeObserver
  resize: () => void
  destroy: () => void
}
let art: Art | null = null
const still = matchMedia('(prefers-reduced-motion: reduce)')

function dispose(root: Object3D) {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    node.geometry.dispose()
    for (const material of [node.material].flat() as Material[]) {
      material.dispose()
    }
  })
}

function create(host: HTMLElement): Art {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  const canvas = renderer.domElement
  canvas.classList.add('auth-art-canvas')
  const { scene, camera, update, setPointer, poke, canPoke, drag, release } = buildScene(host)

  let time = 0
  let last = performance.now()
  const render = () => renderer.render(scene, camera)
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement ?? host
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // 画角を固定しないのは、縦長の枠で作品の左右がはみ出すため
    camera.fov = Math.max(34, Math.min(46, 34 * (0.85 / camera.aspect)))
    camera.updateProjectionMatrix()
    if (still.matches) {
      for (let t = 0; t <= SWIRL + BUILD + 1; t += 0.05) update(t, 0.05)
      render()
    }
  }
  const observer = new ResizeObserver(resize)
  const loop = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt
    update(time, dt)
    render()
  }
  if (!still.matches) renderer.setAnimationLoop(loop)
  const onPointer = (e: PointerEvent) => setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1)
  addEventListener('pointermove', onPointer, { passive: true })

  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }
  let press: { x: number; y: number; id: number; dragging: boolean } | null = null
  // 動きを減らす設定では、つついたりドラッグしたりしても絵が動かないので、操作できる見た目にもしない
  if (!still.matches) {
    canvas.classList.add('is-interactive')
    canvas.addEventListener('pointerdown', (e) => {
      if (press || e.button !== 0) return
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false }
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!press) return canvas.classList.toggle('is-pointing', canPoke(toNdc(e)))
      if (e.pointerId !== press.id) return
      const dx = e.clientX - press.x
      const dy = e.clientY - press.y
      // わずかに指がずれただけでドラッグにしないのは、タップでつついたつもりが作品の回転になるため
      if (!press.dragging && Math.hypot(dx, dy) < 6) return
      press.dragging = true
      canvas.classList.add('is-dragging')
      drag(dx, dy)
      press.x = e.clientX
      press.y = e.clientY
    })
    const finish = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return
      if (!press.dragging && e.type === 'pointerup') poke(toNdc(e))
      press = null
      release()
      canvas.classList.remove('is-dragging')
    }
    canvas.addEventListener('pointerup', finish)
    canvas.addEventListener('pointercancel', finish)
  }

  const destroy = () => {
    renderer.setAnimationLoop(null)
    observer.disconnect()
    removeEventListener('pointermove', onPointer)
    dispose(scene)
    renderer.dispose()
    renderer.forceContextLoss()
    canvas.remove()
  }
  return { canvas, observer, resize, destroy }
}

// 遷移で body ごと差し替わっても描き直さないのは、WebGL の準備に時間がかかり、ログインと新規登録を切り替えるたびに組み立てが最初からやり直しになるため
export function showAuthArt(host: HTMLElement | null) {
  if (!host) {
    art?.destroy()
    art = null
    return
  }
  art ??= create(host)
  const { canvas } = art
  if (canvas.parentElement !== host) host.append(canvas)
  art.observer.disconnect()
  art.observer.observe(host)
  art.resize()
  requestAnimationFrame(() => canvas.classList.add('is-ready'))
}
