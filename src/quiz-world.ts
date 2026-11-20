/// <reference lib="dom" />

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  Fog,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  DodecahedronGeometry,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Raycaster,
  RepeatWrapping,
  Scene,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { MAX_QUIZ_ESSAY_LENGTH, MAX_QUIZ_INDENT, MAX_QUIZ_OUTPUT_LENGTH, type QuizKind } from './lib/quiz'

type Triple = [number, number, number]
type Tones = { main: Color; sub: Color; accent: Color; shade: Color }
type Kit = {
  ink: Color
  white: Color
  cheek: Color
  gold: Color
  red: Color
  danger: Color
  stone: Color
  yellow: Color
  wood: Color
  green: Color
  /** ダンジョンの石（床と壁の上の面）・暗い石（壁）・闇（背景と霧）・炎 */
  rock: Color
  rockDark: Color
  night: Color
  flame: Color
  dark: boolean
  tones: (kind: QuizKind) => Tones
  mat: (color: Color) => Material
}
type Actor = {
  island: Group
  animal: Group
  shadow: Mesh
  mouth: Mesh | null
  /** 1 回転しながら跳ぶ動きの残り時間（秒） */
  spin: number
  scale: number
  /** 体の向き（y 軸の回転）。正面を向いたままにしないのは、カメラから離れた動物が横を向いて見えるため */
  facing: number
}
type View = {
  scene: Scene
  camera: PerspectiveCamera
  update: (time: number, dt: number) => void
  /** 枠の縦横比が変わったときに、カメラの位置を決め直す */
  frame: (aspect: number) => void
  /** 3D の上に、もう 1 度重ねて描くもの（手もとの明かりと、運んでいるもの） */
  after?: (renderer: WebGLRenderer) => void
  /** 明るい所が白く飛ばないように、映画のような階調で描く */
  filmic?: boolean
  /** 画面の中の位置（ビューポートの px）を押したとき。touch は、指で押したか */
  tap?: (x: number, y: number, touch: boolean) => void
  /** カーソルがその位置へ動いたとき。そこを押すと何かが起きるなら true を返す */
  pointing?: (x: number, y: number) => boolean
  /** マウスや指を動かして、視点を回したとき（動かした量は px） */
  look?: (dx: number, dy: number) => void
  /** キーを押した・離したとき。操作に使うキーなら true を返す */
  key?: (code: string, down: boolean) => boolean
  /** キャンバスからフォーカスが外れたとき */
  release?: () => void
  stop?: () => void
}

// 画角を広くしないのは、枠の端の島や動物が、遠近でゆがんで傾いて見えるため
const FOV = 26
const SPIN = 0.75
const HOP = 1.4
const CONFETTI = 90
const CONFETTI_SECONDS = 7

const SPHERE = new SphereGeometry(1, 28, 20)
const CONE = new ConeGeometry(1, 1, 20)
const CYLINDER = new CylinderGeometry(1, 1, 1, 20)
const still = matchMedia('(prefers-reduced-motion: reduce)')
const coarse = matchMedia('(hover: none), (pointer: coarse)')

const ease = (dt: number, speed: number) => 1 - Math.exp(-dt * speed)
const random = (min: number, max: number) => min + Math.random() * (max - min)

function readKit(host: HTMLElement): Kit {
  const read = (el: Element, name: string, fallback?: Color) => {
    const value = getComputedStyle(el).getPropertyValue(name).trim()
    return value ? new Color(value) : (fallback ?? new Color('#888'))
  }
  const cache = new Map<QuizKind, Tones>()
  const materials = new Map<string, Material>()
  return {
    ink: read(host, '--qa-ink'),
    white: read(host, '--qa-white'),
    cheek: read(host, '--qa-cheek'),
    gold: read(host, '--qg-gold'),
    red: read(host, '--qg-red'),
    danger: read(host, '--danger'),
    stone: read(host, '--border-strong'),
    yellow: read(host, '--qg-yellow'),
    wood: read(host, '--qg-brown').lerp(new Color('#fff'), 0.35),
    green: read(host, '--qg-green'),
    rock: read(host, '--qg-rock'),
    rockDark: read(host, '--qg-rock-dark'),
    night: read(host, '--qg-night'),
    flame: read(host, '--qg-flame'),
    dark: document.documentElement.dataset.theme === 'dark',
    tones(kind) {
      const known = cache.get(kind)
      if (known) return known
      // 色を :root から読まないのは、動物の色が quiz-game.css で形式ごとのクラスにだけ定義されているため
      const probe = document.createElement('i')
      probe.className = `qa-${kind}`
      host.append(probe)
      const main = read(probe, '--qa-main')
      const tones = {
        main,
        sub: read(probe, '--qa-sub', main.clone().lerp(new Color('#fff'), 0.6)),
        accent: read(probe, '--qa-accent', main.clone().lerp(new Color('#fff'), 0.3)),
        shade: read(probe, '--qa-shade', main.clone().multiplyScalar(0.8)),
      }
      probe.remove()
      cache.set(kind, tones)
      return tones
    },
    mat(color) {
      const key = color.getHexString()
      const known = materials.get(key)
      if (known) return known
      const material = new MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 })
      materials.set(key, material)
      return material
    },
  }
}

// ---------------------------------------------------------------- 動物

function put(group: Object3D, kit: Kit, geometry: BufferGeometry, color: Color, at: Triple, size: Triple | number, turn?: Triple) {
  const mesh = new Mesh(geometry, kit.mat(color))
  mesh.position.set(...at)
  if (typeof size === 'number') mesh.scale.setScalar(size)
  else mesh.scale.set(...size)
  if (turn) mesh.rotation.set(...turn)
  group.add(mesh)
  return mesh
}

const both = (make: (side: number) => void) => [-1, 1].forEach(make)

/** 目・ほっぺ・口。口は、笑うと下向き、くやしいと上向きの弧にする（setMood） */
function face(g: Group, kit: Kit, eye: [x: number, y: number, z: number, r: number], cheek?: Triple, mouth?: Triple) {
  const [x, y, z, r] = eye
  both((s) => {
    put(g, kit, SPHERE, kit.ink, [s * x, y, z], r)
    put(g, kit, SPHERE, kit.white, [s * x + r * 0.3, y + r * 0.38, z + r * 0.75], r * 0.34)
    if (cheek) put(g, kit, SPHERE, kit.cheek, [s * cheek[0], cheek[1], cheek[2]], [0.085, 0.055, 0.03])
  })
  if (!mouth) return null
  const arc = new Mesh(new TorusGeometry(mouth[2], 0.02, 8, 20, Math.PI), kit.mat(kit.ink))
  arc.position.set(0, mouth[0], mouth[1])
  arc.rotation.z = Math.PI
  arc.userData.y = mouth[0]
  arc.userData.r = mouth[2]
  g.add(arc)
  return arc
}

function setMood(mouth: Mesh | null, happy: boolean) {
  if (!mouth) return
  mouth.rotation.z = happy ? Math.PI : 0
  mouth.position.y = (mouth.userData.y as number) - (happy ? 0 : (mouth.userData.r as number) * 0.7)
}

const feet = (g: Group, kit: Kit, color: Color) => both((s) => put(g, kit, SPHERE, color, [s * 0.15, 0.06, 0.2], [0.11, 0.07, 0.15]))

/** components/quiz-animal.tsx の絵と同じ動物を、球・円すい・円柱の組み合わせで作る。足もとが原点 */
const ANIMALS: Record<QuizKind, (g: Group, kit: Kit, c: Tones) => Mesh | null> = {
  choice(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.42, 0], [0.44, 0.42, 0.4])
    put(g, kit, SPHERE, c.sub, [0, 0.38, 0.2], [0.3, 0.3, 0.26])
    put(g, kit, SPHERE, c.main, [0, 0.98, 0], [0.5, 0.46, 0.46])
    both((s) => {
      put(g, kit, CONE, c.main, [s * 0.3, 1.42, 0], [0.13, 0.3, 0.13], [0, 0, -s * 0.35])
      put(g, kit, SPHERE, kit.white, [s * 0.2, 1.02, 0.36], [0.2, 0.2, 0.1])
      put(g, kit, SPHERE, c.shade, [s * 0.42, 0.45, 0], [0.12, 0.28, 0.24], [0, 0, s * 0.2])
      put(g, kit, SPHERE, c.accent, [s * 0.15, 0.05, 0.12], [0.1, 0.05, 0.14])
    })
    put(g, kit, CONE, c.accent, [0, 0.9, 0.47], [0.07, 0.16, 0.07], [Math.PI / 2 + 0.5, 0, 0])
    return face(g, kit, [0.2, 1.02, 0.455, 0.075])
  },
  short(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.4, 0], [0.4, 0.38, 0.38])
    put(g, kit, SPHERE, c.sub, [0, 0.36, 0.2], [0.26, 0.26, 0.22])
    put(g, kit, SPHERE, c.main, [0, 0.96, 0], [0.5, 0.44, 0.45])
    both((s) => {
      put(g, kit, CONE, c.main, [s * 0.3, 1.4, 0], [0.16, 0.3, 0.16], [0, 0, -s * 0.25])
      put(g, kit, CONE, c.accent, [s * 0.3, 1.38, 0.07], [0.09, 0.2, 0.09], [0, 0, -s * 0.25])
      put(g, kit, SPHERE, c.shade, [s * 0.1, 1.36, 0.2], [0.03, 0.07, 0.05])
    })
    put(g, kit, SPHERE, c.shade, [0, 1.38, 0.18], [0.03, 0.08, 0.05])
    put(g, kit, SPHERE, c.sub, [0, 0.86, 0.36], [0.2, 0.14, 0.14])
    put(g, kit, SPHERE, c.accent, [0, 0.9, 0.5], [0.045, 0.035, 0.03])
    put(g, kit, SPHERE, c.main, [0.3, 0.35, -0.35], 0.1)
    put(g, kit, SPHERE, c.main, [0.4, 0.55, -0.42], 0.095)
    put(g, kit, SPHERE, c.shade, [0.42, 0.78, -0.4], 0.09)
    feet(g, kit, c.main)
    return face(g, kit, [0.2, 1, 0.42, 0.065], [0.33, 0.88, 0.33], [0.84, 0.49, 0.06])
  },
  order(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.45, 0], [0.42, 0.46, 0.4])
    put(g, kit, SPHERE, kit.white, [0, 0.42, 0.16], [0.32, 0.36, 0.3])
    put(g, kit, SPHERE, c.main, [0, 1, 0], [0.44, 0.42, 0.42])
    put(g, kit, SPHERE, kit.white, [0, 0.96, 0.17], [0.34, 0.3, 0.3])
    put(g, kit, CONE, c.accent, [0, 0.93, 0.5], [0.08, 0.16, 0.06], [Math.PI / 2, 0, 0])
    both((s) => {
      put(g, kit, SPHERE, c.main, [s * 0.44, 0.5, 0], [0.08, 0.26, 0.16], [0, 0, s * 0.35])
      put(g, kit, SPHERE, c.accent, [s * 0.15, 0.04, 0.16], [0.13, 0.05, 0.17])
    })
    return face(g, kit, [0.15, 1.04, 0.44, 0.06], [0.26, 0.92, 0.39])
  },
  lines(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.36, 0], [0.44, 0.34, 0.4])
    put(g, kit, SPHERE, c.sub, [0, 0.33, 0.18], [0.32, 0.26, 0.26])
    put(g, kit, SPHERE, c.main, [0, 0.86, 0], [0.56, 0.4, 0.46])
    both((s) => {
      put(g, kit, SPHERE, c.main, [s * 0.27, 1.2, 0.08], 0.17)
      put(g, kit, SPHERE, kit.white, [s * 0.27, 1.22, 0.16], 0.125)
      put(g, kit, SPHERE, c.main, [s * 0.4, 0.14, 0.12], [0.16, 0.12, 0.2])
    })
    return face(g, kit, [0.27, 1.23, 0.275, 0.06], [0.4, 0.8, 0.3], [0.8, 0.455, 0.15])
  },
  match(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.38, 0], [0.38, 0.36, 0.36])
    put(g, kit, SPHERE, kit.white, [0, 0.34, 0.18], [0.25, 0.25, 0.22])
    put(g, kit, SPHERE, c.main, [0, 0.92, 0], [0.46, 0.42, 0.43])
    both((s) => {
      put(g, kit, SPHERE, c.main, [s * 0.17, 1.58, -0.02], [0.1, 0.36, 0.08], [0, 0, -s * 0.12])
      put(g, kit, SPHERE, c.accent, [s * 0.17, 1.58, 0.045], [0.055, 0.27, 0.03], [0, 0, -s * 0.12])
    })
    put(g, kit, SPHERE, c.accent, [0, 0.9, 0.43], [0.04, 0.03, 0.03])
    put(g, kit, SPHERE, kit.white, [0, 0.36, -0.36], 0.12)
    feet(g, kit, c.main)
    return face(g, kit, [0.18, 0.97, 0.4, 0.06], [0.3, 0.85, 0.33], [0.84, 0.425, 0.05])
  },
  essay(g, kit, c) {
    put(g, kit, SPHERE, c.main, [0, 0.5, 0], [0.62, 0.36, 0.44])
    both((s) => {
      put(g, kit, CYLINDER, c.main, [s * 0.18, 0.93, 0.1], [0.035, 0.3, 0.035])
      put(g, kit, SPHERE, kit.white, [s * 0.18, 1.12, 0.12], 0.12)
      put(g, kit, SPHERE, c.main, [s * 0.62, 0.68, 0.06], 0.08)
      put(g, kit, SPHERE, c.main, [s * 0.72, 0.8, 0.08], 0.08)
      put(g, kit, SPHERE, c.main, [s * 0.86, 0.95, 0.1], [0.2, 0.17, 0.14])
      put(g, kit, SPHERE, c.main, [s * 0.8, 1.12, 0.1], [0.1, 0.12, 0.09])
      for (const z of [0.22, 0, -0.22]) put(g, kit, SPHERE, c.main, [s * 0.6, 0.2, z], [0.2, 0.045, 0.045], [0, 0, -s * 0.6])
    })
    return face(g, kit, [0.18, 1.12, 0.225, 0.055], [0.36, 0.52, 0.37], [0.5, 0.44, 0.08])
  },
  blank(g, kit, c) {
    put(g, kit, SPHERE, c.shade, [0.05, 0.5, -0.45], 0.26)
    put(g, kit, SPHERE, c.shade, [0.05, 0.95, -0.55], 0.3)
    put(g, kit, SPHERE, c.shade, [0.05, 1.35, -0.42], 0.22)
    put(g, kit, SPHERE, c.sub, [0.05, 1.38, -0.3], 0.1)
    put(g, kit, SPHERE, c.main, [0, 0.4, 0], [0.38, 0.38, 0.36])
    put(g, kit, SPHERE, c.sub, [0, 0.36, 0.18], [0.25, 0.27, 0.22])
    put(g, kit, SPHERE, c.main, [0, 0.94, 0], [0.46, 0.42, 0.43])
    both((s) => {
      put(g, kit, SPHERE, c.main, [s * 0.28, 1.32, 0], 0.11)
      put(g, kit, SPHERE, c.accent, [s * 0.28, 1.32, 0.06], 0.06)
      put(g, kit, SPHERE, c.sub, [s * 0.2, 0.82, 0.33], [0.15, 0.13, 0.12])
    })
    put(g, kit, SPHERE, kit.ink, [0, 0.9, 0.44], [0.045, 0.035, 0.03])
    put(g, kit, SPHERE, kit.white, [0, 0.77, 0.44], [0.04, 0.045, 0.02])
    feet(g, kit, c.main)
    return face(g, kit, [0.18, 1, 0.4, 0.06])
  },
}

const SHADOW = new CircleGeometry(0.5, 24)

function makeActor(kit: Kit, kind: QuizKind, scale: number): Actor {
  const island = new Group()
  const animal = new Group()
  const mouth = ANIMALS[kind](animal, kit, kit.tones(kind))
  // 影を落とす設定（shadowMap）にしないのは、動物の数だけ影を描き直すことになり、古い端末で重くなるため
  const shadow = new Mesh(SHADOW, new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.012
  animal.scale.setScalar(scale)
  island.add(shadow, animal)
  return { island, animal, shadow, mouth, spin: 0, scale, facing: 0 }
}

/** 動物を跳ねさせる。hop は 0〜1 の周期の位置で、前半だけ宙に浮く */
function moveActor(actor: Actor, hop: number | null, time: number, dt: number) {
  let lift = 0
  let squash = 1 + Math.sin(time * 2.2 + actor.island.position.x) * 0.025
  if (hop !== null && hop < 0.5) {
    lift = Math.sin((hop / 0.5) * Math.PI) * 0.3
    squash = 1 + Math.sin((hop / 0.5) * Math.PI) * 0.08
  }
  if (actor.spin > 0) {
    const p = 1 - actor.spin / SPIN
    lift += Math.sin(p * Math.PI) * 0.7
    actor.spin = Math.max(0, actor.spin - dt)
    actor.animal.rotation.y = actor.facing + (actor.spin > 0 ? p * Math.PI * 2 : 0)
  } else actor.animal.rotation.y = actor.facing
  actor.animal.position.y = lift
  actor.animal.scale.set(actor.scale / Math.sqrt(squash), actor.scale * squash, actor.scale / Math.sqrt(squash))
  actor.shadow.scale.setScalar(actor.scale * (1.1 - lift * 0.5))
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

function starGeometry(size: number) {
  const geometry = new ExtrudeGeometry(starShape(size, size * 0.46), {
    depth: size * 0.3,
    bevelEnabled: true,
    bevelSize: size * 0.1,
    bevelThickness: size * 0.1,
    bevelSegments: 2,
  })
  geometry.center()
  return geometry
}

const goldMaterial = (kit: Kit) =>
  new MeshStandardMaterial({ color: kit.gold, roughness: 0.3, metalness: 0.35, emissive: kit.gold, emissiveIntensity: 0.25 })

function lights(scene: Scene, kit: Kit) {
  const sky = new HemisphereLight(0xffffff, kit.dark ? 0x30344a : 0xb9c0dc, kit.dark ? 1.5 : 1.9)
  const sun = new DirectionalLight(0xffffff, kit.dark ? 1.5 : 1.7)
  sun.position.set(3, 6, 5)
  scene.add(sky, sun)
}

// ---------------------------------------------------------------- 解答: 扉を開けて進むゲーム

/** 部屋 1 つの一辺の長さと、壁（天井まで）の高さ */
const CELL = 12
const HEDGE = 3.4
/** 扉の通れる幅の半分・扉のない通り道の幅の半分・壁の厚みの半分 */
const DOORWAY = 0.95
const ARCH = 1.7
const WALL = 0.3
/** 体の半径。目の位置が壁にめり込んで、壁の向こうが見えないようにする */
const BODY = 0.34
/** 目の高さ。番をしている動物と目が合う高さにする */
const EYE = 1.15
const WALK = 4.2
const JUMP = 4.6
const GRAVITY = 16
/** キーで向きを変える速さ（ラジアン / 秒）と、マウスを 1px 動かしたときに回る角度 */
const TURN = 2.2
const LOOK = 0.0024
/** 明かりを落とすたいまつの数。たいまつの数だけ光源を置かないのは、光源 1 つごとに全部の面の計算が増えて、古い端末で重くなるため */
const GLOWS = 3
/** これより遠い部屋と壁は描かない。霧で闇に沈んで見えない所まで描いて、重くしないため */
const FAR = 40
const GEM_REACH = 0.9
const CHEST_REACH = 2.4
const CHEST_GEMS = 5
const DUST = 70
/** 手の届く長さ。これより遠いものは、近づくまで動かせない。部屋の中を歩いて答える遊びにするため */
const REACH = 3.4
/** 文字を描く板の細かさ（長さ 1 あたりの px） */
const PLATE = 320
/** 扉の真ん中から、問題の石板の真ん中までの横の長さ */
const BOARD_X = 3.75
/** 字下げ 1 段ぶんの、ブロックの横のずれ */
const NOTCH = 0.13
/** 前後（W S と上下の矢印）と、左右への横歩き（A D） */
const MOVES: Record<string, [forward: number, strafe: number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  KeyD: [0, 1],
}
/** 左右の矢印は、その場で向きを変える。マウスを使えないときも、キーだけで曲がり角を進めるようにするため */
const TURNS_BY_KEY: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1 }
/** PageUp / PageDown は、見上げる・見下ろす。棚の高い段と低い段にも、キーだけで照準を合わせられるようにするため */
const NODS_BY_KEY: Record<string, number> = { PageUp: 1, PageDown: -1 }

const turnTo = (from: number, to: number, amount: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount

type Place = { x: number; z: number }
type Room = { gx: number; gz: number; x: number; z: number; parent: number }
type Edge = {
  x: number
  z: number
  /** 壁が奥行きの向き（z）に伸びていて、左右（x）に通り抜ける */
  across: boolean
  kind: 'wall' | 'arch' | 'gate'
  /** 扉の番号（kind が gate のとき） */
  gate: number
  /** 扉を「手前の部屋 → 先の部屋」の向きに合わせる回転（y 軸） */
  turn: number
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

/** 北・東・西・南。重みは、次の部屋を選ぶときの選ばれやすさ。奥（北）へ進みやすくして、手前へ戻る道を少なめにする */
const DIRS: readonly [dx: number, dz: number, weight: number][] = [
  [0, -1, 3],
  [1, 0, 2],
  [-1, 0, 2],
  [0, 1, 1],
]
const TURNS = [0, -Math.PI / 2, Math.PI / 2, Math.PI]

/**
 * マップを作る。部屋を格子の上に並べ、スタートからゴールまでの部屋（問題の数 + 1）を、同じ場所を通らない道としてランダムに伸ばす。
 * そこへ、問題のない寄り道の部屋をいくつか足す。開くたびに形が変わる
 */
function layout(count: number) {
  const key = (gx: number, gz: number) => `${gx},${gz}`
  const room = (gx: number, gz: number, parent = -1): Room => ({ gx, gz, x: gx * CELL, z: gz * CELL, parent })
  for (let attempt = 0; attempt < 80; attempt++) {
    const main = [room(0, 0)]
    const taken = new Set([key(0, 0)])
    while (main.length <= count) {
      const last = main[main.length - 1]
      const options = DIRS.filter(([dx, dz]) => !taken.has(key(last.gx + dx, last.gz + dz)))
      if (!options.length) break
      let roll = Math.random() * options.reduce((sum, [, , weight]) => sum + weight, 0)
      const [dx, dz] = options.find(([, , weight]) => (roll -= weight) < 0) ?? options[0]
      main.push(room(last.gx + dx, last.gz + dz))
      taken.add(key(last.gx + dx, last.gz + dz))
    }
    // 行き止まりに入り込んで伸ばせなくなったら、最初から作り直す
    if (main.length <= count) continue
    const sides: Room[] = []
    const wanted = Math.min(10, 2 + Math.ceil(count / 2))
    for (let tries = 0; tries < wanted * 8 && sides.length < wanted; tries++) {
      const parent = Math.floor(Math.random() * count)
      const [dx, dz] = pick(DIRS)
      const gx = main[parent].gx + dx
      const gz = main[parent].gz + dz
      if (taken.has(key(gx, gz))) continue
      sides.push(room(gx, gz, parent))
      taken.add(key(gx, gz))
    }
    return { main, sides }
  }
  return { main: Array.from({ length: count + 1 }, (_, i) => room(0, -i)), sides: [] as Room[] }
}

/** 部屋どうしの境目と、マップの外まわりを、壁・扉・通り道に分ける */
function edgesOf(main: Room[], sides: Room[]) {
  const key = (gx: number, gz: number) => `${gx},${gz}`
  const at = new Map<string, { index: number; side: boolean }>()
  main.forEach((r, index) => at.set(key(r.gx, r.gz), { index, side: false }))
  sides.forEach((r, index) => at.set(key(r.gx, r.gz), { index, side: true }))
  const edges: Edge[] = []
  const seen = new Set<string>()
  const each = (r: Room, index: number, side: boolean) =>
    DIRS.forEach(([dx, dz], d) => {
      const other = at.get(key(r.gx + dx, r.gz + dz))
      const id = [key(r.gx, r.gz), key(r.gx + dx, r.gz + dz)].sort().join('|')
      if (seen.has(id)) return
      const edge = { x: r.x + (dx * CELL) / 2, z: r.z + (dz * CELL) / 2, across: dx !== 0 }
      const joined = other && (side ? !other.side && other.index === r.parent : other.side && sides[other.index].parent === index)
      if (joined) edges.push({ ...edge, kind: 'arch', gate: -1, turn: TURNS[d] })
      else if (!side && other && !other.side && Math.abs(other.index - index) === 1) {
        // 扉は、番号の小さい部屋（手前）から大きい部屋（先）へ向けて置く
        const forward = other.index > index
        edges.push({ ...edge, kind: 'gate', gate: Math.min(index, other.index), turn: TURNS[d] + (forward ? 0 : Math.PI) })
      } else edges.push({ ...edge, kind: 'wall', gate: -1, turn: TURNS[d] })
      seen.add(id)
    })
  main.forEach((r, i) => each(r, i, false))
  sides.forEach((r, i) => each(r, i, true))
  return edges
}

// ---------------------------------------------------------------- 質感: 石と木の模様

/** 模様に Math.random を使わないのは、開くたびに壁や床の柄まで変わると、石の並びがたまたま崩れた回に粗く見えるため */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}

/** 模様の 1 ます（石 1 個・板 1 枚）。場所と大きさは絵の一辺を 1 とした割合で、shade は 0〜1 の明るさのばらつき */
type Cell = [x: number, y: number, w: number, h: number, shade: number]
type Surface = { map: CanvasTexture; bump: CanvasTexture }
const SHEET = 512

function sheet(width = SHEET, height = SHEET) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')!
}

function textureOf(paper: CanvasRenderingContext2D, color = true) {
  const texture = new CanvasTexture(paper.canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  if (color) texture.colorSpace = SRGBColorSpace
  return texture
}

/** ますを格子に並べる。stagger は、1 段おきに半ますずらす（れんが積み）。右端からはみ出す分を左端にも描くので、くり返しても継ぎ目が出ない */
const grid = (cols: number, rows: number, seed: number, stagger: boolean): Cell[] => {
  const rand = seeded(seed)
  return Array.from({ length: rows }, (_, row) => {
    const shades = Array.from({ length: cols }, rand)
    return Array.from({ length: cols + 1 }, (_, col): Cell => [
      (col - (stagger && row % 2 ? 0.5 : 0)) / cols,
      row / rows,
      1 / cols,
      1 / rows,
      shades[col % cols],
    ])
  }).flat()
}

/** 石積み・石だたみ・板の模様。色の絵と、でこぼこ（bumpMap）の絵を、同じ並びで作る */
function surface(base: Color, cells: Cell[], seed: number, gap: number): Surface {
  const rand = seeded(seed)
  const paint = sheet()
  const relief = sheet()
  const hex = (color: Color) => `#${color.getHexString()}`
  paint.fillStyle = hex(base.clone().multiplyScalar(0.34))
  paint.fillRect(0, 0, SHEET, SHEET)
  relief.fillStyle = '#000'
  relief.fillRect(0, 0, SHEET, SHEET)
  for (const [cx, cy, cw, ch, shade] of cells) {
    const x = cx * SHEET + gap / 2
    const y = cy * SHEET + gap / 2
    const w = cw * SHEET - gap
    const h = ch * SHEET - gap
    paint.fillStyle = hex(base.clone().multiplyScalar(0.8 + shade * 0.36))
    paint.fillRect(x, y, w, h)
    paint.fillStyle = 'rgb(255 255 255 / 0.09)'
    paint.fillRect(x, y, w, 3)
    paint.fillStyle = 'rgb(0 0 0 / 0.2)'
    paint.fillRect(x, y + h - 4, w, 4)
    const level = Math.round(150 + shade * 80)
    relief.fillStyle = `rgb(${level} ${level} ${level})`
    relief.fillRect(x, y, w, h)
    const tall = h > w * 1.5
    for (let k = Math.round((w * h) / 520); k > 0; k--) {
      const light = rand() < 0.45
      const mw = tall ? 1.5 + rand() * 2 : 3 + rand() * 12
      const mh = tall ? 20 + rand() * 90 : 2 + rand() * 7
      const mx = x + rand() * Math.max(0, w - mw)
      const my = y + rand() * Math.max(0, h - mh)
      paint.fillStyle = light ? 'rgb(255 255 255 / 0.06)' : 'rgb(0 0 0 / 0.11)'
      paint.fillRect(mx, my, mw, mh)
      relief.fillStyle = light ? 'rgb(255 255 255 / 0.12)' : 'rgb(0 0 0 / 0.3)'
      relief.fillRect(mx, my, mw, mh)
    }
  }
  return { map: textureOf(paint), bump: textureOf(relief, false) }
}

/** 面の大きさに合わせて模様をくり返す箱（per は模様 1 枚ぶんの長さ）。1 辺 1 の箱を拡大して使わないのは、長い壁で石が横に引き伸ばされるため */
function block(w: number, h: number, d: number, per: number) {
  const geometry = new BoxGeometry(w, h, d)
  const uv = geometry.attributes.uv
  const faces = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let i = 0; i < uv.count; i++) {
    const [across, up] = faces[Math.floor(i / 4)]
    uv.setXY(i, (uv.getX(i) * across) / per, (uv.getY(i) * up) / per)
  }
  return geometry
}

/**
 * 面の向きごとに、箱の 6 面から模様を貼る（長さ per で模様 1 枚）。形ごとの UV のままにしないのは、
 * 丸い台座や角の丸い箱で、石や木目が引き伸ばされたり、ものごとに模様の大きさがばらついたりするため
 */
function boxMap<T extends BufferGeometry>(geometry: T, per: number) {
  const { position, normal } = geometry.attributes
  const uv = new BufferAttribute(new Float32Array(position.count * 2), 2)
  for (let i = 0; i < position.count; i++) {
    const [ax, ay, az] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))]
    const [u, v] =
      ax >= ay && ax >= az
        ? [position.getZ(i), position.getY(i)]
        : ay >= az
          ? [position.getX(i), position.getZ(i)]
          : [position.getX(i), position.getY(i)]
    uv.setXY(i, u / per, v / per)
  }
  geometry.setAttribute('uv', uv)
  return geometry
}

/** 角を丸めた箱。角が立った箱にしないのは、ふちに光が乗らず、板を切り抜いただけの平たい見た目になるため */
const rounded = (w: number, h: number, d: number, r = 0.025, per = 1.2) =>
  boxMap(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999), per)

/** 断面（[半径, 高さ] の並び）を回した形。台座・たる・柱・取っ手など */
const lathe = (profile: [r: number, y: number][], per = 1, segments = 28) =>
  boxMap(
    new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      segments,
    ),
    per,
  )

function roundedRect(w: number, h: number, r: number, path: Path = new Shape()) {
  const [x, y] = [-w / 2, -h / 2]
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.quadraticCurveTo(x + w, y, x + w, y + r)
  path.lineTo(x + w, y + h - r)
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  path.lineTo(x + r, y + h)
  path.quadraticCurveTo(x, y + h, x, y + h - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  return path
}

/** 額縁: 内側に w × h の穴があいた、ふちの太さ border の枠。ふちは面取りする。奥行きの真ん中が原点 */
function frameGeometry(w: number, h: number, border: number, depth: number, per = 1.2) {
  const outer = roundedRect(w + border * 2, h + border * 2, border * 0.6) as Shape
  outer.holes.push(roundedRect(w, h, 0.01, new Path()))
  const bevel = Math.min(border * 0.35, depth * 0.45)
  const geometry = new ExtrudeGeometry(outer, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  })
  geometry.translate(0, 0, -(depth - bevel * 2) / 2)
  geometry.computeVertexNormals()
  return boxMap(geometry, per)
}

/** 真ん中が明るく、まわりへ消えていく丸。炎・明かりのにじみ・ほこりに使う */
function glowTexture() {
  const paper = sheet(128, 128)
  const fade = paper.createRadialGradient(64, 64, 0, 64, 64, 64)
  fade.addColorStop(0, 'rgb(255 255 255 / 1)')
  fade.addColorStop(0.35, 'rgb(255 255 255 / 0.45)')
  fade.addColorStop(1, 'rgb(255 255 255 / 0)')
  paper.fillStyle = fade
  paper.fillRect(0, 0, 128, 128)
  return textureOf(paper)
}

/** 部屋の床に重ねる、壁ぎわの暗がり。影を落とす設定（shadowMap）にしないのは、光源ごとに全体を描き直すことになり、古い端末で重くなるため */
function shadeTexture() {
  const paper = sheet(256, 256)
  for (const [x0, y0, x1, y1] of [
    [0, 0, 64, 0],
    [256, 0, 192, 0],
    [0, 0, 0, 64],
    [0, 256, 0, 192],
  ]) {
    const fade = paper.createLinearGradient(x0, y0, x1, y1)
    fade.addColorStop(0, 'rgb(0 0 0 / 0.6)')
    fade.addColorStop(1, 'rgb(0 0 0 / 0)')
    paper.fillStyle = fade
    paper.fillRect(0, 0, 256, 256)
  }
  return textureOf(paper)
}

// ---------------------------------------------------------------- 文字: 石板やブロックに描く

/** 幅に収まるように折り返した行。英単語の途中では折り返さない */
function wrapText(paper: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let line = ''
    for (const ch of raw) {
      if (!line || paper.measureText(line + ch).width <= width) {
        line += ch
        continue
      }
      const space = line.lastIndexOf(' ')
      if (space > 0 && /[!-~]/.test(ch) && /[!-~]$/.test(line)) {
        lines.push(line.slice(0, space))
        line = line.slice(space + 1) + ch
      } else {
        lines.push(line)
        line = ch === ' ' ? '' : ch
      }
    }
    lines.push(line)
  }
  return lines
}

/** 1 行に収まる大きさまで文字を小さくして描く。いちばん小さくしても収まらなければ、末尾を「…」にする */
function fitText(
  paper: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  font: (px: number) => string,
) {
  let px = size
  paper.font = font(px)
  while (px > size * 0.62 && paper.measureText(text).width > width) paper.font = font((px -= 1))
  let shown = text
  while (shown.length > 1 && paper.measureText(shown).width > width) shown = `${shown.slice(0, -2)}…`
  paper.fillText(shown, x, y)
}

// ---------------------------------------------------------------- 解答: 扉を開けて進むダンジョン

type Anchor = { x: number; z: number; turn: number }
type Torch = { at: Vector3; room: number; far: number }
/** 照準を合わせて押せるもの（玉・ブロック・レバーなど） */
type Handle = {
  id: string
  /** 何であるか。Tab キーで選ぶ目印の名前にもなる */
  name: string
  /** 押すと起きること。いまは押せないなら空 */
  act: () => string
  use: () => void
  /** 当たり判定の箱。照準が合ったときの枠も、この箱の大きさで出す */
  hit: Mesh
}
/** 手に持って運んでいるもの。tip は持っている間に出す案内、back は、置かずに手放したときに元へ戻す処理 */
type Held = { name: string; tip: string; item: Object3D; back: () => void }
/** 扉 1 つ分の問題を、部屋の中の実物として組んだもの。答えそのものは DOM のステージが持ち、ここは DOM を操作して、その状態を映す */
type Puzzle = {
  handles: Handle[]
  /** DOM の答えを読んで、置き物に映す */
  sync: () => void
  update: (dt: number, time: number) => void
  answered: () => boolean
}

const LETTERS = 'ABCDEFGH'
type Guide = { how: string; quest: string; missing: string }
/** 答え方ごとの、石板に書く答え方・画面の上の案内・答えずにレバーを引いたときのひとこと。形式の中で答え方が分かれるもの（複数選ぶ選択など）は別に持つ */
const GUIDES = {
  choice: {
    how: '答えだと思う玉を持ちあげて、扉の横の「こたえの台座」に置こう。',
    quest: '玉を「こたえの台座」に置いて、レバーを引こう',
    missing: 'まだ台座に玉がないよ。答えの玉を置いてから引こう',
  },
  choiceMany: {
    how: '正しいと思う玉を、ぜんぶ「こたえの台座」に置こう。台座をクリックすると、さいごに置いた玉がもどるよ。',
    quest: '正しい玉をぜんぶ台座に置いて、レバーを引こう',
    missing: 'まだ台座に玉がないよ。答えの玉を置いてから引こう',
  },
  short: {
    how: '左の黒板をクリックして、答えを書きこもう。',
    quest: '黒板に答えを書いて、レバーを引こう',
    missing: 'まだ黒板に何も書いていないよ',
  },
  essay: {
    how: '左の黒板をクリックして、自分のことばで答えを書こう。先生があとで採点してくれるよ。',
    quest: '黒板に答えを書いて、レバーを引こう',
    missing: 'まだ黒板に何も書いていないよ',
  },
  blank: {
    how: '左の表のますをクリックして、空欄に入るものを書きこもう。Enter でつぎのますへ。',
    quest: '空欄をうめて、レバーを引こう',
    missing: 'まだ空いているますがあるよ',
  },
  blankPick: {
    how: '左の表のますをクリックするたびに、入るものが入れかわるよ。正しいものにしよう。',
    quest: '空欄に入るものを選んで、レバーを引こう',
    missing: 'まだ選んでいないますがあるよ',
  },
  order: {
    how: '左のブロックを持ちあげて、入れたい場所のブロックをクリック。上から正しい順に並べよう。',
    quest: 'ブロックを正しい順に並べて、レバーを引こう',
    missing: 'ブロックを並べてから引こう',
  },
  orderIndent: {
    how: '左のブロックの右はしを押すと字下げが深く、左はしを押すと浅くなるよ。',
    quest: 'ブロックを左右に動かして字下げを直し、レバーを引こう',
    missing: 'ブロックを動かしてから引こう',
  },
  orderBoth: {
    how: 'ブロックのまん中を持ちあげて、入れたい場所のブロックをクリック。はしを押すと字下げが変わるよ。',
    quest: 'ブロックを並べて字下げも直し、レバーを引こう',
    missing: 'ブロックを並べてから引こう',
  },
  lines: {
    how: '左のブロックのうち、当てはまる行を押そう。',
    quest: '当てはまる行のブロックを押して、レバーを引こう',
    missing: 'まだ行を選んでいないよ',
  },
  linesMany: {
    how: '当てはまる行を、ぜんぶ押そう。もう一度押すと、えらぶのをやめるよ。',
    quest: '当てはまる行をぜんぶ押して、レバーを引こう',
    missing: 'まだ行を選んでいないよ',
  },
  linesSequence: {
    how: '実行される順に、左のブロックを押していこう。同じ行を何度押してもいいよ。',
    quest: '実行される順にブロックを押して、レバーを引こう',
    missing: 'まだブロックを押していないよ',
  },
  match: {
    how: '左の表の「こたえ」のますをクリックするたびに、こたえが入れかわるよ。合うものにしよう。',
    quest: '合うものを選んで、レバーを引こう',
    missing: 'まだ選んでいないところがあるよ',
  },
} satisfies Record<string, Guide>

/** ステージの DOM の形から、答え方の案内を決める */
function guideOf(kind: QuizKind, stage: HTMLElement | undefined): Guide {
  const has = (selector: string) => !!stage?.querySelector(selector)
  const order = stage?.querySelector('.quiz-order')
  const key: keyof typeof GUIDES =
    kind === 'choice' && has('input[type="checkbox"]')
      ? 'choiceMany'
      : kind === 'lines'
        ? has('[data-quiz-flow]')
          ? 'linesSequence'
          : has('input[type="checkbox"]')
            ? 'linesMany'
            : 'lines'
        : kind === 'blank' && has('select[data-quiz-blank]')
          ? 'blankPick'
          : kind === 'order' && order?.classList.contains('is-fixed')
            ? 'orderIndent'
            : kind === 'order' && order?.classList.contains('is-indent')
              ? 'orderBoth'
              : kind
  const guide = GUIDES[key]
  if (kind !== 'order' || !has('[data-quiz-line-use]')) return guide
  const extra = key === 'orderIndent' ? 'まん中を押すと、使う・使わないが切りかわるよ。' : '使わない行は、右の箱に入れよう。'
  return { ...guide, how: `${guide.how}${extra}` }
}

/**
 * 学生が一人称の視点で、部屋がランダムにつながったダンジョンを進むゲーム。
 * スタートからゴールまでの道は問題ごとの扉で区切られていて、扉の前の部屋に、その問題が実物（玉・ブロック・黒板など）として置いてある。
 * 実物を動かして答え、扉の横のレバーを引くと扉が開く。答えを持つのは 2D の DOM のステージ（.qg-panel）で、3D の側は DOM を操作して、その状態を映す
 */
function buildGame(host: HTMLElement, kinds: QuizKind[], kit: Kit): View | null {
  const root = host.closest<HTMLElement>('[data-quiz-game]')
  if (!root) return null
  const panel = root.querySelector<HTMLElement>('.qg-panel')
  const stages = [...root.querySelectorAll<HTMLElement>('[data-qg-stage]')]
  const guides = kinds.map((kind, i) => guideOf(kind, stages[i]))
  const count = kinds.length
  const { main, sides } = layout(count)
  const rooms = [...main, ...sides]
  const edges = edgesOf(main, sides)
  const goalAt = main[count]
  const roomIndex = new Map(rooms.map((r, i) => [`${r.gx},${r.gz}`, i]))
  /** その場所の部屋の番号（rooms の中の順番。スタートからゴールまでの部屋は、そのまま問題の番号になる）。部屋の外は -1 */
  const roomAt = (x: number, z: number) => roomIndex.get(`${Math.round(x / CELL)},${Math.round(z / CELL)}`) ?? -1

  const scene = new Scene()
  // ダンジョンは、ライトでもダークでも暗い石の部屋にする。遠くの部屋を霧で闇に沈めて、先が見通せない感じを出す
  scene.background = kit.night
  scene.fog = new Fog(kit.night, 9, 38)
  const lantern = new PointLight(kit.flame, 5, 15, 1.2)
  const glows = Array.from({ length: GLOWS }, () => ({
    light: new PointLight(kit.flame, 0, 14, 1.2),
    torch: null as Torch | null,
    level: 0,
  }))
  scene.add(new HemisphereLight(0xa9aee0, 0x2a2622, 0.8), lantern, ...glows.map((glow) => glow.light))
  const camera = new PerspectiveCamera(70, 2, 0.05, 90)

  const textures: Texture[] = []
  const skin = (base: Color, cells: Cell[], seed: number, gap: number) => {
    const made = surface(base, cells, seed, gap)
    textures.push(made.map, made.bump)
    return made
  }
  const rough = (made: Surface, tint = 1, bumpScale = 2.5) =>
    new MeshStandardMaterial({ map: made.map, bumpMap: made.bump, bumpScale, color: new Color().setScalar(tint), roughness: 0.92 })
  const wallSkin = skin(kit.rockDark.clone().lerp(kit.rock, 0.3), grid(3, 6, 7, true), 21, 5)
  const floorSkin = skin(kit.rock, grid(3, 4, 5, true), 22, 5)
  const woodSkin = skin(kit.wood, grid(5, 1, 11, false), 23, 3)
  const wallMat = rough(wallSkin)
  const trimMat = rough(floorSkin, 0.9)
  const floorMat = rough(floorSkin)
  const ceilMat = rough(wallSkin, 0.5)
  const woodMat = rough(woodSkin, 1, 1.5)
  const beamMat = rough(woodSkin, 0.55, 1.5)
  const iron = new MeshStandardMaterial({ color: kit.ink.clone().lerp(kit.rockDark, 0.25), roughness: 0.5, metalness: 0.5 })
  const glow = glowTexture()
  const shade = shadeTexture()
  textures.push(glow, shade)
  const shadeMat = new MeshBasicMaterial({ map: shade, transparent: true, depthWrite: false })
  const blobMat = new MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false })
  const flameMat = new SpriteMaterial({ map: glow, color: kit.flame, blending: AdditiveBlending, depthWrite: false })
  const hazeMat = new SpriteMaterial({ map: glow, color: kit.flame, blending: AdditiveBlending, depthWrite: false, opacity: 0.2 })
  const hitMat = new MeshBasicMaterial({ visible: false })
  // 回した形（台座・柱・泉）に石だたみの模様を貼らないのは、曲がった面で石の目地がゆがみ、筋のように見えるため
  const carved = new MeshStandardMaterial({
    color: kit.rock.clone().lerp(kit.white, 0.08),
    roughness: 0.82,
    bumpMap: floorSkin.bump,
    bumpScale: 0.6,
  })
  const brass = new MeshStandardMaterial({ color: kit.gold.clone().lerp(kit.wood, 0.35), roughness: 0.38, metalness: 0.7 })
  const soot = new MeshStandardMaterial({ color: kit.night, roughness: 0.95 })
  const blend = (color: Color) => color.clone().lerp(kit.rock, 0.45)
  const hex = (color: Color) => `#${color.getHexString()}`
  const water = kit.tones('order').main.clone().lerp(new Color('#ffffff'), 0.25)
  /** 文字を書く面の色（紙・黒板）と、玉の色 */
  const sheetTone = kit.white.clone().lerp(kit.wood, 0.42)
  const slateTone = kit.night.clone().lerp(kit.green, 0.22)
  const palette = [...(Object.keys(ANIMALS) as QuizKind[]).map((kind) => kit.tones(kind).main), kit.gold]
  const fontFamily = getComputedStyle(host).fontFamily
  const mono = getComputedStyle(host).getPropertyValue('--mono').trim() || 'monospace'
  const text = (px: number, weight = 600) => `${weight} ${Math.round(px)}px ${fontFamily}`
  const code = (px: number) => `600 ${Math.round(px)}px ${mono}`

  const BOX = new BoxGeometry(1, 1, 1)
  const FLAT = new PlaneGeometry(1, 1)
  const part = (parent: Object3D, geometry: BufferGeometry, material: Material, at: Triple, size: Triple | number = 1, turn?: Triple) => {
    const mesh = new Mesh(geometry, material)
    mesh.position.set(...at)
    if (typeof size === 'number') mesh.scale.setScalar(size)
    else mesh.scale.set(...size)
    if (turn) mesh.rotation.set(...turn)
    parent.add(mesh)
    return mesh
  }
  /** 足もとの丸い影 */
  const blob = (parent: Object3D, x: number, z: number, size: number) =>
    part(parent, FLAT, blobMat, [x, 0.02, z], size, [-Math.PI / 2, 0, 0])
  /** 文字を描く板。長さ 1 あたり PLATE px のキャンバスを貼り、描き直したら flush で絵を送り直す */
  const plate = (w: number, h: number, lit = 0.32) => {
    const paper = sheet(Math.round(w * PLATE), Math.round(h * PLATE))
    const texture = new CanvasTexture(paper.canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    textures.push(texture)
    // 光を受けるだけの面にしないのは、たいまつから遠い壁では、文字が暗がりに沈んで読めなくなるため
    const material = new MeshStandardMaterial({
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: lit,
      roughness: 0.9,
    })
    const mesh = new Mesh(new PlaneGeometry(w, h), material)
    return { mesh, paper, w: paper.canvas.width, h: paper.canvas.height, flush: () => (texture.needsUpdate = true) }
  }

  /** 遠くなったら丸ごと描かなくする、ひとまとまり（部屋・壁・扉） */
  const chunks: { x: number; z: number; group: Object3D }[] = []
  const chunk = (x: number, z: number, turn = 0) => {
    const group = new Group()
    group.position.set(x, 0, z)
    group.rotation.y = turn
    scene.add(group)
    chunks.push({ x, z, group })
    return group
  }
  /** 壁の向きに合わせた入れ物。中では x が壁に沿う向き、z の正の向きが「手前の部屋」になる */
  const stand = (edge: Edge) => chunk(edge.x, edge.z, edge.turn)
  /** 入れ物の中の場所を、ワールドの場所に直す */
  const outOf = (anchor: Anchor, x: number, z: number): Place => ({
    x: anchor.x + x * Math.cos(anchor.turn) + z * Math.sin(anchor.turn),
    z: anchor.z - x * Math.sin(anchor.turn) + z * Math.cos(anchor.turn),
  })
  const into = (anchor: Anchor, x: number, z: number): Place => ({
    x: (x - anchor.x) * Math.cos(anchor.turn) - (z - anchor.z) * Math.sin(anchor.turn),
    z: (x - anchor.x) * Math.sin(anchor.turn) + (z - anchor.z) * Math.cos(anchor.turn),
  })
  /** ぶつかる丸いもの（動物・台座・たる・柱・泉） */
  const solids: (Place & { r: number })[] = []

  // たいまつは数が多いので、形を 1 つずつ作らずに使いまわす
  const TORCH_PLATE = rounded(0.13, 0.22, 0.04, 0.012)
  const TORCH_ARM = rounded(0.045, 0.045, 0.14, 0.012)
  const TORCH_STICK = lathe(
    [
      [0, 0],
      [0.02, 0],
      [0.026, 0.12],
      [0.032, 0.34],
      [0, 0.34],
    ],
    0.4,
    10,
  )
  const TORCH_CUP = lathe(
    [
      [0, 0],
      [0.03, 0],
      [0.068, 0.07],
      [0.075, 0.12],
      [0.064, 0.125],
      [0.055, 0.09],
      [0, 0.08],
    ],
    0.3,
    14,
  )
  const flames: Sprite[] = []
  /** 壁掛けのたいまつ。face は、壁のどちら側の面に付けるか（1 か -1） */
  const torch = (parent: Object3D, x: number, y: number, z: number, face: number) => {
    part(parent, TORCH_PLATE, iron, [x, y, z])
    part(parent, TORCH_ARM, iron, [x, y - 0.04, z + face * 0.07])
    const stick = new Group()
    stick.position.set(x, y - 0.1, z + face * 0.12)
    stick.rotation.x = face * 0.32
    part(stick, TORCH_STICK, beamMat, [0, 0, 0])
    part(stick, TORCH_CUP, iron, [0, 0.32, 0])
    parent.add(stick)
    const fire = new Sprite(flameMat)
    fire.position.set(x, y + 0.42, z + face * 0.27)
    fire.scale.set(0.42, 0.6, 1)
    const haze = new Sprite(hazeMat)
    haze.position.copy(fire.position)
    haze.scale.setScalar(1.9)
    parent.add(fire, haze)
    flames.push(fire)
  }

  // ---- 置き物の 3D モデル（台座・書見台・玉・宝箱）
  /** 石の台座。top は上の面の高さ、wide は太さの倍率 */
  const pedestal = (parent: Object3D, x: number, z: number, top: number, wide = 1) => {
    const r = 0.2 * wide
    part(
      parent,
      lathe(
        [
          [0, 0],
          [r * 1.7, 0],
          [r * 1.7, 0.08],
          [r * 1.5, 0.11],
          [r * 1.4, 0.17],
          [r * 1.08, 0.23],
          [r, 0.32],
          [r * 0.9, top * 0.55],
          [r, top - 0.24],
          [r * 1.12, top - 0.16],
          [r * 1.45, top - 0.11],
          [r * 1.6, top - 0.05],
          [r * 1.6, top],
          [0, top],
        ],
        1.2,
      ),
      carved,
      [x, 0, z],
    )
    blob(parent, x, z, 1.5 * wide + 0.3)
  }
  /** 台座の上で、玉をのせる真ちゅうの皿 */
  const CRADLE = lathe(
    [
      [0, 0],
      [0.08, 0],
      [0.11, 0.02],
      [0.14, 0.07],
      [0.15, 0.1],
      [0.135, 0.105],
      [0.11, 0.06],
      [0, 0.045],
    ],
    0.4,
  )
  /** 斜めの板の書見台。札（plate）を前の面に貼る。y は板の真ん中の高さ */
  const lectern = (parent: Object3D, x: number, z: number, face: ReturnType<typeof plate>, w: number, h: number, y = 0.62) => {
    part(parent, rounded(0.09, y, 0.09, 0.02), woodMat, [x, y / 2, z - 0.06])
    const board = new Group()
    board.position.set(x, y, z)
    board.rotation.x = -0.55
    part(board, rounded(w + 0.08, h + 0.08, 0.035, 0.012), woodMat, [0, 0, -0.022])
    part(board, frameGeometry(w - 0.02, h - 0.02, 0.03, 0.035, 0.5), brass, [0, 0, 0])
    face.mesh.position.z = 0.002
    board.add(face.mesh)
    parent.add(board)
    return board
  }
  /** 選択肢の玉: 光る芯を、すき通った殻と、交差する 2 本の真ちゅうの輪で包む */
  const ORB_RING = new TorusGeometry(0.205, 0.011, 8, 40)
  const orbModel = (color: Color) => {
    const group = new Group()
    part(group, SPHERE, new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.3 }), [0, 0, 0], 0.11)
    const glass = new MeshStandardMaterial({
      color: color.clone().lerp(kit.white, 0.5),
      transparent: true,
      opacity: 0.3,
      roughness: 0.05,
      metalness: 0.25,
      depthWrite: false,
    })
    part(group, SPHERE, glass, [0, 0, 0], 0.19)
    part(group, ORB_RING, brass, [0, 0, 0], 1, [Math.PI / 2, 0, 0])
    part(group, ORB_RING, brass, [0, 0, 0], 1, [0, 0, 0.5])
    return group
  }
  /** 宝箱。ふた（返す Group）は奥のふちを軸にして開く。w・h・d は箱の幅・高さ・奥行き */
  const chestModel = (parent: Object3D, w: number, h: number, d: number) => {
    part(parent, rounded(w, h, d, 0.035), woodMat, [0, h / 2, 0])
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      part(parent, rounded(0.07, h + 0.01, 0.07, 0.015), iron, [sx * (w / 2 - 0.025), h / 2, sz * (d / 2 - 0.025)])
    for (const x of [-w * 0.3, w * 0.3]) part(parent, rounded(0.08, h + 0.012, d + 0.014, 0.01), iron, [x, h / 2, 0])
    const lid = new Group()
    lid.position.set(0, h, -d / 2)
    const dome = boxMap(new CylinderGeometry(d / 2, d / 2, w, 24, 1, false, 0, Math.PI), 1.2)
    part(lid, dome, woodMat, [0, 0, d / 2], 1, [0, 0, Math.PI / 2])
    const band = new TorusGeometry(d / 2 + 0.006, 0.028, 6, 24, Math.PI)
    for (const x of [-w * 0.3, w * 0.3]) part(lid, band, iron, [x, 0, d / 2], 1, [0, Math.PI / 2, 0])
    part(lid, rounded(w + 0.01, 0.06, d + 0.012, 0.012), iron, [0, 0.02, d / 2])
    part(lid, rounded(0.2, 0.24, 0.05, 0.02), brass, [0, -0.04, d + 0.02])
    part(lid, rounded(0.035, 0.08, 0.02, 0.008), soot, [0, -0.06, d + 0.046])
    parent.add(lid)
    return lid
  }

  // 部屋: 石だたみの床・天井・はり
  const roomGroups = rooms.map((r, i) => {
    const group = chunk(r.x, r.z)
    part(group, block(CELL, 0.6, CELL, 4), floorMat, [0, -0.3, 0])
    part(group, block(CELL, 0.3, CELL, 3), ceilMat, [0, HEDGE + 0.15, 0])
    part(group, FLAT, shadeMat, [0, 0.01, 0], [CELL, CELL, 1], [-Math.PI / 2, 0, 0])
    for (const s of [-1, 1]) {
      if (i % 2) part(group, block(0.32, 0.26, CELL, 1.6), beamMat, [s * 2.6, HEDGE - 0.13, 0])
      else part(group, block(CELL, 0.26, 0.32, 1.6), beamMat, [0, HEDGE - 0.13, s * 2.6])
    }
    return group
  })

  // 壁・通り道・扉
  const star = starGeometry(0.26)
  const gold = goldMaterial(kit)
  const gateEdges: Edge[] = []
  for (const edge of edges) {
    const group = stand(edge)
    const wall = (x: number, span: number, from = 0, to = HEDGE) =>
      part(group, block(span, to - from, WALL * 2, 3), wallMat, [x, (from + to) / 2, 0])
    const skirt = (x: number, span: number) => part(group, block(span + 0.02, 0.3, WALL * 2 + 0.12, 3), trimMat, [x, 0.15, 0])
    if (edge.kind === 'wall') {
      wall(0, CELL + WALL * 2)
      skirt(0, CELL + WALL * 2)
      if (Math.random() < 0.7) {
        const x = pick([-3.4, 0, 3.4])
        for (const face of [-1, 1]) torch(group, x, 1.5, face * (WALL + 0.05), face)
      }
      continue
    }
    const gate = edge.kind === 'gate'
    const gap = gate ? 1.25 : ARCH
    const span = CELL / 2 + WALL - gap
    both((s) => {
      wall(s * (gap + span / 2), span)
      skirt(s * (gap + span / 2), span)
    })
    wall(0, gap * 2, gate ? 3 : 2.7, HEDGE)
    if (gate) gateEdges[edge.gate] = edge
    else {
      part(group, block(ARCH * 2 + 0.9, 0.36, 0.8, 3), trimMat, [0, 2.78, 0])
      both((s) => {
        part(group, block(0.5, 2.6, 0.8, 3), trimMat, [s * (ARCH + 0.12), 1.3, 0])
        for (const face of [-1, 1]) torch(group, s * (ARCH + 0.12), 1.5, face * 0.45, face)
      })
    }
  }

  let current = 0
  let dirty = true
  let fall = 0
  let grounded = true
  let jump = false
  /** 向いている向き（左右。0 が北で、左へ回ると増える）と、見上げ・見下ろしの角度 */
  let yaw = 0
  let pitch = 0
  let stride = 0
  /** 画面全体のゲームを始めているか（data-play）・Esc などでマウスが外れて止まっているか（data-qg-paused）・ノートを開いているか（data-qg-open） */
  let playing = false
  let paused = false
  let open = false
  /** まちがえたあとに正解して、解説を出しているか（client.ts の qgExplain が data-qg-explaining を付ける）。relock は、出したときにマウスを固定していたか */
  let explaining = false
  let relock = false
  /** マウスの固定を自分で外したので、次に外れた知らせでは止めない */
  let quiet = false
  /** いまいる部屋（スタートからゴールまでの部屋の番号。寄り道の部屋と部屋の外は -1） */
  let live = -1
  /** 近くで読む場所まで歩かせている途中の行き先 */
  let glide: { x: number; z: number; yaw: number; pitch: number; left: number } | null = null
  let aspect = 2
  let tick = 0
  let gemCount = 0
  let flash = { text: '', left: 0 }
  let held: Held | null = null
  /** 照準（マウスを固定していないときはカーソル）が合っているものと、そこまでの距離 */
  let aimed: Handle | null = null
  let aimFar = 0
  let pointer: { x: number; y: number } | null = null
  /** 文字を打ちこんでいる欄。multiline でなければ、Enter で next（次のます）へ進む */
  let typing: { field: HTMLInputElement | HTMLTextAreaElement; multiline: boolean; next?: () => void } | null = null
  const seen = new Set<number>()
  const keys = new Set<string>()
  const stick = { x: 0, z: 0 }
  const pos = new Vector3()
  const actLabel = host.querySelector<HTMLElement>('[data-qg-act]')
  const actText = host.querySelector<HTMLElement>('[data-qg-act-label]')
  const quest = host.querySelector<HTMLElement>('[data-qg-quest]')
  const gemLabel = host.querySelector<HTMLElement>('[data-qg-gems]')
  const openedLabel = host.querySelector<HTMLElement>('[data-qg-opened]')
  const knob = host.querySelector<HTMLElement>('.qg-stick-knob')
  const map = host.querySelector<HTMLCanvasElement>('[data-qg-map]')
  const spots = host.querySelector<HTMLElement>('[data-qg-spots]')
  const typer = host.querySelector<HTMLTextAreaElement>('[data-qg-typer]')
  const screen = () => host.querySelector<HTMLElement>('.qg-world-canvas')
  const locked = () => !!document.pointerLockElement && document.pointerLockElement === screen()
  const announce = (message: string) => (flash = { text: message, left: 2.8 })

  // 手もとの明かりと、運んでいるもの。部屋とは別に描いて上に重ねるのは、壁に近づいたときに、壁にめり込んで欠けるため
  const hands = new Scene()
  const handCamera = new PerspectiveCamera(50, 2, 0.01, 10)
  const hand = new Group()
  const holder = new Group()
  const HAND: Triple = [0.42, -0.36, -0.8]
  /** 手もとの明かりを下げている度合い（0〜1） */
  let lowered = 0
  put(hand, kit, SPHERE, kit.yellow, [0.1, -0.2, 0.3], [0.085, 0.08, 0.34], [0.55, -0.3, 0])
  part(hand, new TorusGeometry(0.035, 0.007, 8, 16), iron, [0, 0.17, 0])
  part(hand, CONE, iron, [0, 0.12, 0], [0.06, 0.06, 0.06])
  part(hand, CYLINDER, new MeshBasicMaterial({ color: kit.flame }), [0, 0.03, 0], [0.04, 0.12, 0.04])
  part(hand, CYLINDER, iron, [0, -0.04, 0], [0.06, 0.025, 0.06])
  for (const [x, z] of [
    [0.045, 0.045],
    [-0.045, 0.045],
    [0.045, -0.045],
    [-0.045, -0.045],
  ])
    part(hand, CYLINDER, iron, [x, 0.03, z], [0.006, 0.13, 0.006])
  const shine = new Sprite(
    new SpriteMaterial({ map: glow, color: kit.flame, blending: AdditiveBlending, depthWrite: false, opacity: 0.55 }),
  )
  shine.scale.setScalar(0.42)
  shine.position.set(0, 0.03, 0)
  hand.add(shine)
  const handLight = new PointLight(kit.flame, 0.6, 3, 1)
  handLight.position.set(0, 0.03, 0.12)
  hand.add(handLight)
  put(holder, kit, SPHERE, kit.yellow, [-0.1, -0.16, 0.26], [0.085, 0.08, 0.3], [0.55, 0.3, 0])
  hands.add(new HemisphereLight(0xffffff, 0x3a3230, 1.1), hand, holder)

  /** 持っているものを、元に戻さずに手から外す（置くとき） */
  const take = () => {
    const was = held
    if (was) holder.remove(was.item)
    held = null
    return was
  }
  const release = () => take()?.back()
  const hold = (next: Held) => {
    release()
    held = next
    holder.add(next.item)
  }
  const handles: Handle[] = []
  const handle = (parent: Object3D, id: string, name: string, at: Triple, size: Triple, act: () => string, use: () => void): Handle => {
    const made = { id, name, act, use, hit: part(parent, BOX, hitMat, at, size) }
    handles.push(made)
    return made
  }
  /** 文字を打ちこむ。打つ先は、画面の外に置いた入力欄（typer）。答えの欄に直接フォーカスしないのは、ゲームの間は 2D のステージを隠していて、隠した欄にはフォーカスできないため */
  const type = (field: HTMLInputElement | HTMLTextAreaElement, multiline: boolean, next?: () => void) => {
    if (!typer) return
    typing = { field, multiline, next }
    keys.clear()
    typer.value = field.value
    typer.setAttribute('aria-label', field.getAttribute('aria-label') ?? '答え')
    typer.focus({ preventScroll: true })
    typer.setSelectionRange(typer.value.length, typer.value.length)
    dirty = true
  }
  const caretOf = (field: Element) => (typing?.field === field && typer ? (typer.selectionStart ?? typer.value.length) : -1)

  // ---- 問題を実物にする部品
  const tone = (i: number) => kit.tones(kinds[i]).main
  const kindNames = stages.map((stage) => stage.querySelector('.qg-kind')?.textContent ?? '')
  /** 左の壁の真ん中と、行のブロックの幅 */
  const RACK_X = -4.25
  const RACK_W = 2.5
  const RACK_KNOB = lathe(
    [
      [0, 0],
      [0.065, 0],
      [0.075, 0.03],
      [0.045, 0.06],
      [0.06, 0.1],
      [0, 0.13],
    ],
    0.3,
    16,
  )
  /** 行のブロックを並べる棚。行が多いほど 1 段を低くして、壁の高さに収める */
  const rack = (frame: Group, rows: number) => {
    const rowH = Math.min(0.34, 2.6 / rows)
    const tall = rows * rowH
    const top = Math.min(2.85, 1.55 + tall / 2)
    const mid = top - tall / 2
    part(frame, rounded(RACK_W + 0.26, tall + 0.26, 0.05, 0.02, 1.6), beamMat, [RACK_X, mid, WALL + 0.025])
    both((s) => {
      const x = RACK_X + s * (RACK_W / 2 + 0.17)
      part(frame, rounded(0.12, tall + 0.4, 0.17, 0.03), woodMat, [x, mid, WALL + 0.085])
      part(frame, RACK_KNOB, brass, [x, mid + tall / 2 + 0.2, WALL + 0.085])
    })
    part(frame, rounded(RACK_W + 0.56, 0.08, 0.22, 0.025), woodMat, [RACK_X, top + 0.17, WALL + 0.11])
    part(frame, rounded(RACK_W + 0.56, 0.1, 0.24, 0.025), woodMat, [RACK_X, top - tall - 0.17, WALL + 0.12])
    // 段ごとの棚板。ブロックが宙に浮いて見えないように、1 段ずつ下に置く
    for (let k = 0; k < rows; k++)
      part(frame, rounded(RACK_W + 0.06, 0.024, 0.11, 0.008), beamMat, [RACK_X, top - rowH * (k + 1) + 0.008, WALL + 0.09])
    return { rowH, y: (slot: number) => top - rowH * (slot + 0.5) }
  }
  type Mark = { fill?: Color; badges?: number[]; arrows?: boolean }
  /** コードの 1 行を書いたブロック。no は行の番号（出さないなら 0） */
  const lineBlock = (frame: Group, width: number, rowH: number, line: string, no: number) => {
    const group = new Group()
    const h = rowH * 0.84
    part(group, rounded(width, h, 0.1, Math.min(0.024, h * 0.2)), woodMat, [0, 0, 0.05])
    const face = plate(width - 0.05, h - 0.04)
    face.mesh.position.z = 0.1015
    group.add(face.mesh)
    const draw = ({ fill = sheetTone, badges = [], arrows = false }: Mark = {}) => {
      const { paper, w, h: tall } = face
      const px = Math.min(27, tall * 0.56)
      paper.fillStyle = hex(fill)
      paper.fillRect(0, 0, w, tall)
      paper.textBaseline = 'middle'
      paper.textAlign = 'left'
      let left = 14
      let right = w - 14
      paper.fillStyle = hex(kit.ink.clone().lerp(fill, 0.45))
      if (no) {
        paper.font = code(px * 0.8)
        paper.fillText(String(no), left, tall / 2)
        left += px * 1.9
      }
      if (arrows) {
        paper.font = text(px)
        paper.fillText('◀', left, tall / 2)
        paper.textAlign = 'right'
        paper.fillText('▶', right, tall / 2)
        paper.textAlign = 'left'
        left += px * 1.4
        right -= px * 1.4
      }
      // 押した順番の印は、右から並べる
      for (const order of [...badges].reverse()) {
        const r = px * 0.62
        paper.fillStyle = hex(kit.gold)
        paper.beginPath()
        paper.arc(right - r, tall / 2, r, 0, Math.PI * 2)
        paper.fill()
        paper.fillStyle = hex(kit.ink)
        paper.font = text(px * 0.72, 800)
        paper.textAlign = 'center'
        paper.fillText(String(order), right - r, tall / 2 + 1)
        paper.textAlign = 'left'
        right -= r * 2 + 4
      }
      paper.fillStyle = hex(kit.ink)
      fitText(paper, line, left, tall / 2, right - left, px, code)
      face.flush()
    }
    frame.add(group)
    return { group, face, draw, h }
  }
  /** 黒板やますに、打ちこんだ文字を書く。caret は文字を打つ位置（打っていないなら -1） */
  const chalk = (paper: CanvasRenderingContext2D, value: string, caret: number, x: number, y: number, w: number, h: number, px: number) => {
    const shown = caret < 0 ? value : `${value.slice(0, caret)}▏${value.slice(caret)}`
    paper.font = code(px)
    const lines = wrapText(paper, shown, w)
    const fit = Math.max(1, Math.floor(h / (px * 1.3)))
    // 収まらない分は、打っている位置に近い末尾の行を残す
    lines.slice(-fit).forEach((line, k) => paper.fillText(line, x, y + k * px * 1.3))
  }

  /** 問題文を書いた石板。扉の右の壁に掛ける。クリックすると、読みやすい場所まで歩く */
  const signboard = (frame: Group, edge: Edge, i: number) => {
    const stage = stages[i]
    const prompt = stage.querySelector('.quiz-prompt')?.textContent ?? ''
    const listing = [...stage.querySelectorAll('pre.quiz-code')]
      .map((pre) => {
        const copy = pre.cloneNode(true) as Element
        for (const blank of copy.querySelectorAll('.quiz-blank'))
          blank.replaceWith(`［${blank.querySelector('.quiz-blank-no')?.textContent ?? ''}］`)
        return (copy.textContent ?? '').replace(/\n+$/, '')
      })
      .join('\n\n')
    const lines = listing ? listing.split('\n') : []
    const w = 2.9
    const h = lines.length ? 2.3 : 1.7
    const y = 0.5 + h / 2
    const face = plate(w, h)
    const ink = tone(i).clone().lerp(kit.ink, 0.55)
    /** 文字の大きさを scale 倍にして書く。収まらずに切ったら true を返す。more は、切った続きがノートで読めることを書き添える */
    const draw = (scale: number, more: boolean) => {
      const { paper, w: W, h: H } = face
      const pad = 34
      const body = 28 * scale
      const small = 22 * scale
      const mark = 23 * scale
      paper.fillStyle = hex(sheetTone)
      paper.fillRect(0, 0, W, H)
      paper.strokeStyle = hex(tone(i))
      paper.lineWidth = 10
      paper.strokeRect(9, 9, W - 18, H - 18)
      paper.textBaseline = 'top'
      paper.textAlign = 'left'
      paper.fillStyle = hex(ink)
      paper.font = text(30 * scale, 800)
      paper.fillText(`ステージ ${i + 1}　${kindNames[i]}`, pad, pad)
      paper.font = text(small)
      const how = wrapText(paper, `${guides[i].how}${more ? '（つづきは N キーのノートで読めるよ）' : ''}`, W - pad * 2)
      const foot = how.length * small * 1.4 + 12
      how.forEach((line, k) => paper.fillText(line, pad, H - pad - foot + 12 + k * small * 1.4))
      const listed = lines.length * mark * 1.36 + (lines.length ? 30 : 0)
      const top = pad + 30 * scale + 18
      const space = H - pad - foot - listed - top
      paper.fillStyle = hex(kit.ink)
      paper.font = text(body)
      const wrapped = wrapText(paper, prompt, W - pad * 2)
      const fit = Math.max(1, Math.floor(space / (body * 1.45)))
      const cut = wrapped.length > fit
      wrapped
        .slice(0, fit)
        .forEach((line, k) => paper.fillText(cut && k === fit - 1 ? `${line.slice(0, -1)}…` : line, pad, top + k * body * 1.45))
      if (lines.length) {
        const from = top + Math.min(wrapped.length, fit) * body * 1.45 + 10
        paper.fillStyle = hex(kit.ink.clone().lerp(sheetTone, 0.9))
        paper.fillRect(pad - 8, from, W - pad * 2 + 16, listed - 14)
        lines.forEach((line, k) => {
          const at = from + 10 + k * mark * 1.36
          paper.fillStyle = hex(kit.ink.clone().lerp(sheetTone, 0.5))
          paper.font = code(mark * 0.8)
          paper.fillText(String(k + 1), pad, at + mark * 0.1)
          paper.fillStyle = hex(kit.ink)
          fitText(paper, line, pad + mark * 1.9, at, W - pad * 2 - mark * 1.9, mark, code)
        })
      }
      face.flush()
      return cut || space < body * 1.45
    }
    // 文字を小さくしていっても収まらない長い問題は、切って、続きをノートで読めるようにする
    if (![1.3, 1.15, 1, 0.88, 0.78, 0.68].some((scale) => !draw(scale, false))) draw(0.6, true)
    face.mesh.position.set(BOARD_X, y, WALL + 0.1)
    frame.add(face.mesh)
    part(frame, rounded(w + 0.12, h + 0.12, 0.06, 0.02, 1.4), beamMat, [BOARD_X, y, WALL + 0.05])
    part(frame, frameGeometry(w, h, 0.13, 0.1, 1.4), trimMat, [BOARD_X, y, WALL + 0.1])
    both((s) => {
      part(frame, rounded(0.07, 0.36, 0.05, 0.012), iron, [BOARD_X + s * (w / 2 - 0.2), y + h / 2 + 0.2, WALL + 0.07])
      for (const t of [-1, 1]) part(frame, SPHERE, brass, [BOARD_X + s * (w / 2 + 0.065), y + t * (h / 2 + 0.065), WALL + 0.16], 0.028)
    })
    handle(
      frame,
      `board-${i}`,
      '問題の石板',
      [BOARD_X, y, WALL + 0.08],
      [w, h, 0.06],
      () => '近くで読む',
      () => {
        const half = Math.tan((camera.fov * Math.PI) / 360)
        const far = Math.max(h / 2 / half, w / 2 / (half * aspect)) * 1.2
        glide = { ...outOf(edge, BOARD_X, WALL + 0.07 + far), yaw: edge.turn, pitch: Math.atan2(y - EYE, far), left: 1.4 }
      },
    )
  }

  /** 選択: 玉を持ちあげて、こたえの台座に置く。複数選ぶ問題では、正しいと思う玉をすべて置く */
  const choicePuzzle = (frame: Group, edge: Edge, i: number): Puzzle => {
    const labels = [...stages[i].querySelectorAll<HTMLElement>('label.quiz-choice')]
    const inputs = labels.map((label) => label.querySelector<HTMLInputElement>('input'))
    const multiple = inputs[0]?.type === 'checkbox'
    const perRow = Math.ceil(labels.length / (labels.length > 4 ? 2 : 1))
    /** 台座に置いてある玉の番号（最初は、まだ DOM を読んでいない印の null） */
    let placed: number[] | null = null
    const altar: Triple = [1.95, 1.24, 1.75]
    /** 台座の上の、k 番の玉を置く位置。複数あるときは輪に並べる */
    const spot = (k: number): Triple => {
      const at = placed?.indexOf(k) ?? -1
      const count = placed?.length ?? 0
      if (count <= 1 || at < 0) return altar
      const a = (at / count) * Math.PI * 2
      return [altar[0] + Math.cos(a) * 0.2, altar[1], altar[2] + Math.sin(a) * 0.2]
    }
    pedestal(frame, altar[0], altar[2], 0.95, 1.45)
    part(frame, CRADLE, brass, [altar[0], 0.95, altar[2]], 1.5)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4
      part(frame, rounded(0.07, 0.34, 0.07, 0.02), brass, [altar[0] + Math.cos(a) * 0.4, 1.05, altar[2] + Math.sin(a) * 0.4], 1, [0, -a, 0])
    }
    const ring = part(frame, new TorusGeometry(0.26, 0.022, 10, 36), gold, [altar[0], 1.24, altar[2]], 1, [Math.PI / 2, 0, 0])
    solids.push({ ...outOf(edge, altar[0], altar[2]), r: 0.5 })
    const note = plate(1, 0.34)
    lectern(frame, altar[0], altar[2] + 0.62, note, 1, 0.34, 0.55)
    solids.push({ ...outOf(edge, altar[0], altar[2] + 0.65), r: 0.3 })
    const drawNote = () => {
      const { paper, w, h } = note
      paper.fillStyle = hex(kit.gold.clone().lerp(sheetTone, 0.55))
      paper.fillRect(0, 0, w, h)
      paper.fillStyle = hex(kit.ink)
      paper.textBaseline = 'middle'
      paper.textAlign = 'left'
      const now = placed ?? []
      const words =
        now.length === 0
          ? 'こたえの台座'
          : now.length === 1
            ? `こたえ　${LETTERS[now[0]]}　${labels[now[0]].textContent?.trim() ?? ''}`
            : `こたえ　${now.map((k) => LETTERS[k]).join('・')}`
      fitText(paper, words, 18, h / 2, w - 36, 30, (px) => text(px, 800))
      note.flush()
    }
    const orbs = labels.map((label, k) => {
      const x = -2.3 - (k % perRow) * 1.05
      const z = 2.3 + Math.floor(k / perRow) * 1.5
      const color = palette[k % palette.length]
      pedestal(frame, x, z, 0.92)
      part(frame, CRADLE, brass, [x, 0.92, z])
      solids.push({ ...outOf(edge, x, z), r: 0.37 })
      const tag = plate(0.9, 0.48)
      lectern(frame, x, z + 0.52, tag, 0.9, 0.48, 0.5)
      solids.push({ ...outOf(edge, x, z + 0.55), r: 0.3 })
      tag.paper.fillStyle = hex(sheetTone)
      tag.paper.fillRect(0, 0, tag.w, tag.h)
      tag.paper.fillStyle = hex(color)
      tag.paper.fillRect(0, 0, 62, tag.h)
      tag.paper.textBaseline = 'middle'
      tag.paper.textAlign = 'center'
      tag.paper.fillStyle = hex(kit.ink)
      tag.paper.font = text(40, 800)
      tag.paper.fillText(LETTERS[k], 31, tag.h / 2 + 2)
      tag.paper.textAlign = 'left'
      // 短い選択肢は大きな字で 1〜2 行に、長い選択肢は小さな字で 3 行までにして、続きは「…」にする（全文はノートで読める）
      const choice = label.textContent?.trim() ?? ''
      const sizes = [52, 42, 34, 27]
      const size = sizes.find((px) => {
        tag.paper.font = text(px)
        return wrapText(tag.paper, choice, tag.w - 62 - 28).length <= (px > 40 ? 1 : px > 30 ? 2 : 3)
      })
      tag.paper.font = text(size ?? 27)
      const words = wrapText(tag.paper, choice, tag.w - 62 - 28)
      const shown = words.slice(0, 3)
      if (words.length > 3) shown[2] = `${shown[2].slice(0, -1)}…`
      shown.forEach((line, row) => tag.paper.fillText(line, 62 + 14, tag.h / 2 + (row - (shown.length - 1) / 2) * (size ?? 27) * 1.35))
      tag.flush()
      const home: Triple = [x, 1.18, z]
      const orb = orbModel(color)
      orb.position.set(...home)
      frame.add(orb)
      const halo = new Sprite(new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, depthWrite: false, opacity: 0.45 }))
      halo.scale.setScalar(0.85)
      orb.add(halo)
      const twin = orbModel(color)
      twin.scale.setScalar(0.43)
      const name = `${LETTERS[k]} の玉`
      const onAltar = () => !!placed?.includes(k)
      handle(
        frame,
        `orb-${i}-${k}`,
        `選択肢 ${LETTERS[k]}「${label.textContent?.trim() ?? ''}」の玉`,
        [x, 1.08, z],
        [0.56, 0.7, 0.56],
        () => (held?.item === twin ? 'もどす' : onAltar() ? '' : held ? 'この玉に持ちかえる' : 'もちあげる'),
        () => {
          if (held?.item === twin) return release()
          if (onAltar()) return
          release()
          orb.visible = false
          hold({ name, tip: '扉の横の「こたえの台座」に置こう', item: twin, back: () => (orb.visible = true) })
        },
      )
      return { orb, twin, home }
    })
    handle(
      frame,
      `altar-${i}`,
      'こたえの台座',
      [altar[0], 0.7, altar[2]],
      [0.84, 1.4, 0.84],
      () =>
        orbs.some(({ twin }) => twin === held?.item) ? 'こたえの台座に置く' : multiple && placed?.length ? 'さいごに置いた玉をもどす' : '',
      () => {
        const k = orbs.findIndex(({ twin }) => twin === held?.item)
        if (k < 0) {
          // 複数選ぶ問題では、置いた玉を台座から 1 つずつもどせるようにする（元の場所の玉は、台座に動いていて押せないため）
          const last = multiple ? placed?.[placed.length - 1] : undefined
          if (last === undefined) return
          inputs[last]?.click()
          dirty = true
          return
        }
        take()
        orbs[k].orb.visible = true
        orbs[k].orb.position.set(altar[0], altar[1] + 0.7, altar[2])
        if (!inputs[k]?.checked) inputs[k]?.click()
        dirty = true
      },
    )
    return {
      handles: [],
      sync() {
        const now = inputs.flatMap((input, k) => (input?.checked ? [k] : []))
        if (placed && now.length === placed.length && now.every((k) => placed!.includes(k))) return
        // 置いた順を残すのは、「さいごに置いた玉をもどす」で、最後に置いたものから外すため
        placed = [...(placed ?? []).filter((k) => now.includes(k)), ...now.filter((k) => !placed?.includes(k))]
        drawNote()
      },
      update(dt, time) {
        orbs.forEach(({ orb, twin, home }, k) => {
          orb.rotation.y = time * 0.6 + k
          twin.rotation.y = time * 0.9
          const on = !!placed?.includes(k)
          const to = on ? spot(k) : home
          orb.scale.setScalar(on && (placed?.length ?? 0) > 1 ? 0.7 : 1)
          orb.position.x += (to[0] - orb.position.x) * ease(dt, 6)
          orb.position.y += (to[1] + Math.sin(time * 2 + k) * 0.03 - orb.position.y) * ease(dt, 6)
          orb.position.z += (to[2] - orb.position.z) * ease(dt, 6)
        })
        ring.rotation.z = time * 0.8
      },
      answered: () => (placed?.length ?? 0) > 0,
    }
  }

  /** 並べ替え: ブロックを持ちあげて、入れたい場所のブロックを押す。字下げを答える問題では、ブロックの左右のはしを押して字下げを変え、使わない行は箱に入れる */
  const orderPuzzle = (frame: Group, edge: Edge, i: number): Puzzle => {
    const list = stages[i].querySelector<HTMLElement>('[data-quiz-order]')
    const lines = [...stages[i].querySelectorAll<HTMLElement>('[data-quiz-line]')]
    const reorder = !list?.classList.contains('is-fixed')
    const indent = !!list?.classList.contains('is-indent')
    const optional = !!stages[i].querySelector('[data-quiz-line-use]')
    const shelf = rack(frame, lines.length)
    const width = indent ? RACK_W - MAX_QUIZ_INDENT * NOTCH : RACK_W
    const left = indent ? RACK_X - RACK_W / 2 + width / 2 : RACK_X
    if (indent)
      for (let level = 1; level <= MAX_QUIZ_INDENT; level++)
        part(
          frame,
          BOX,
          iron,
          [RACK_X - RACK_W / 2 + level * NOTCH, shelf.y((lines.length - 1) / 2), WALL + 0.052],
          [0.012, lines.length * shelf.rowH, 0.004],
        )
    const unusedTone = kit.stone.clone().lerp(sheetTone, 0.35)
    const blocks = lines.map((line, k) => {
      const words = line.dataset.line ?? line.querySelector('code')?.textContent ?? ''
      const made = lineBlock(frame, width, shelf.rowH, words, 0)
      made.group.position.set(left, shelf.y(k), WALL + 0.055)
      made.draw({ arrows: indent })
      const twin = new Group()
      const tall = (0.32 * made.h) / width
      part(twin, rounded(0.34, tall + 0.02, 0.03, 0.006), woodMat, [0, 0, -0.016])
      twin.add(new Mesh(new PlaneGeometry(0.32, tall), made.face.mesh.material))
      const item = { ...made, line, twin, slot: k, level: 0, unused: false }
      const useButton = () => line.querySelector<HTMLElement>('[data-quiz-line-use]')
      handle(
        made.group,
        `line-${i}-${k}`,
        `ブロック「${words}」`,
        [0, 0, 0.05],
        [indent ? width / 2 : width, shelf.rowH, 0.12],
        () => {
          if (held?.item === twin) return 'もどす'
          if (blocks.some((other) => other.twin === held?.item)) return 'ここに入れる'
          if (reorder) return 'もちあげる'
          return optional ? (item.unused ? 'この行を使う' : 'この行を使わない') : ''
        },
        () => {
          if (held?.item === twin) return release()
          const from = blocks.find((other) => other.twin === held?.item)
          if (from) {
            take()
            from.group.visible = true
            // 並べ替えは、2D のステージの「上へ／下へ」のボタンを、動かす段の数だけ押したことにする（client.ts）
            const button = from.line.querySelector<HTMLElement>(`[data-quiz-line-move="${item.slot < from.slot ? 'up' : 'down'}"]`)
            for (let step = Math.abs(item.slot - from.slot); step > 0; step--) button?.click()
          } else if (reorder) {
            release()
            made.group.visible = false
            hold({
              name: 'ブロック',
              tip: optional ? '入れたい場所のブロックを押そう。使わない行は、右の箱に入れよう' : '入れたい場所のブロックを押そう',
              item: twin,
              back: () => (made.group.visible = true),
            })
            return
          } else useButton()?.click()
          dirty = true
        },
      )
      if (indent) {
        const ends: [side: number, label: string, name: string][] = [
          [-1, '左へ（字下げを浅く）', '浅くする'],
          [1, '右へ（字下げを深く）', '深くする'],
        ]
        for (const [side, label, name] of ends)
          handle(
            made.group,
            `${side < 0 ? 'out' : 'in'}-${i}-${k}`,
            `ブロック「${words}」の字下げを${name}`,
            [(side * width * 3) / 8, 0, 0.05],
            [width / 4, shelf.rowH, 0.12],
            () => (held ? '' : (side < 0 ? item.level > 0 : item.level < MAX_QUIZ_INDENT) ? label : ''),
            () => {
              line.querySelector<HTMLElement>(`[data-quiz-indent-move="${side}"]`)?.click()
              dirty = true
            },
          )
      }
      return item
    })
    // 使わない行の箱: 棚の右の床に置く。持っているブロックを入れると「使わない」に、もう一度入れると「使う」に戻る
    if (reorder && optional) {
      const x = RACK_X + RACK_W / 2 + 0.85
      const z = WALL + 0.45
      part(frame, rounded(0.8, 0.5, 0.6, 0.04), woodMat, [x, 0.25, z])
      part(frame, rounded(0.84, 0.06, 0.64, 0.02), iron, [x, 0.48, z])
      const sign = plate(0.8, 0.22)
      sign.paper.fillStyle = hex(sheetTone)
      sign.paper.fillRect(0, 0, sign.w, sign.h)
      sign.paper.fillStyle = hex(kit.ink)
      sign.paper.textBaseline = 'middle'
      sign.paper.textAlign = 'center'
      sign.paper.font = text(26, 800)
      sign.paper.fillText('使わない行の箱', sign.w / 2, sign.h / 2 + 1)
      sign.flush()
      sign.mesh.position.set(x, 0.75, WALL + 0.03)
      frame.add(sign.mesh)
      solids.push({ ...outOf(edge, x, z), r: 0.5 })
      handle(
        frame,
        `crate-${i}`,
        '使わない行の箱',
        [x, 0.3, z],
        [0.9, 0.7, 0.7],
        () => {
          const from = blocks.find((other) => other.twin === held?.item)
          return from ? (from.unused ? '箱から出して、この行を使う' : '箱に入れて、この行を使わない') : ''
        },
        () => {
          const from = blocks.find((other) => other.twin === held?.item)
          if (!from) return
          take()
          from.group.visible = true
          from.line.querySelector<HTMLElement>('[data-quiz-line-use]')?.click()
          dirty = true
        },
      )
    }
    return {
      handles: [],
      sync() {
        const order = list ? [...list.children] : []
        for (const item of blocks) {
          item.slot = Math.max(0, order.indexOf(item.line))
          item.level = Number(item.line.dataset.level) || 0
          const unused = item.line.hasAttribute('data-unused')
          if (unused === item.unused) continue
          item.unused = unused
          item.draw({ arrows: indent, fill: unused ? unusedTone : sheetTone })
        }
      },
      update(dt) {
        for (const item of blocks) {
          item.group.position.y += (shelf.y(item.slot) - item.group.position.y) * ease(dt, 9)
          item.group.position.x += (left + item.level * NOTCH - item.group.position.x) * ease(dt, 10)
          item.group.position.z += (WALL + (item.unused ? 0.02 : 0.055) - item.group.position.z) * ease(dt, 9)
        }
      },
      answered: () => blocks.some((item) => !item.unused),
    }
  }

  /** コードの行を、番号付きのブロックにして棚に並べる（行を選ぶ問題）。空の行は押せない */
  const codeRows = (frame: Group, rows: HTMLElement[]) => {
    const shelf = rack(frame, rows.length)
    return rows.map((row, k) => {
      const made = lineBlock(frame, RACK_W, shelf.rowH, row.querySelector('code')?.textContent ?? '', k + 1)
      made.group.position.set(RACK_X, shelf.y(k), WALL + 0.05)
      made.draw()
      return { ...made, row, rowH: shelf.rowH, y: shelf.y(k) }
    })
  }

  /** 虫の模型。行を選ぶ問題で、選んだ行のブロックにとまらせる */
  const bugModel = () => {
    const bug = new Group()
    put(bug, kit, SPHERE, kit.red, [0, 0, 0], [0.075, 0.05, 0.095])
    put(bug, kit, SPHERE, kit.ink, [0, 0.01, 0.085], 0.04)
    for (const [x, z] of [
      [0.035, 0.02],
      [-0.035, 0.02],
      [0.03, -0.045],
      [-0.03, -0.045],
    ])
      put(bug, kit, SPHERE, kit.ink, [x, 0.04, z], 0.014)
    bug.rotation.x = Math.PI / 2
    bug.visible = false
    return bug
  }

  /** 行を選ぶ（1 行・当てはまる行すべて）: 当てはまる行のブロックを押す。選んだブロックは手前にせり出して、虫がとまる */
  const pickPuzzle = (frame: Group, i: number): Puzzle => {
    const blocks = codeRows(frame, [...stages[i].querySelectorAll<HTMLElement>('.quiz-lines > .quiz-line')])
    const inputs = blocks.map(({ row }) => row.querySelector<HTMLInputElement>('input'))
    const multiple = inputs.some((input) => input?.type === 'checkbox')
    let picked = new Set<number>()
    let read = false
    const bugs = blocks.map(() => {
      const bug = bugModel()
      frame.add(bug)
      return bug
    })
    blocks.forEach((item, k) => {
      const input = inputs[k]
      if (!input) return
      handle(
        item.group,
        `line-${i}-${k}`,
        `${k + 1} 行目のブロック「${item.row.querySelector('code')?.textContent ?? ''}」`,
        [0, 0, 0.05],
        [RACK_W, item.rowH, 0.12],
        () => (picked.has(k) ? (multiple ? 'えらぶのをやめる' : '') : 'この行をえらぶ'),
        () => {
          input.click()
          dirty = true
        },
      )
    })
    return {
      handles: [],
      sync() {
        const now = new Set(inputs.flatMap((input, k) => (input?.checked ? [k] : [])))
        if (read && now.size === picked.size && [...now].every((k) => picked.has(k))) return
        const before = picked
        picked = now
        read = true
        blocks.forEach((block, k) => {
          if (before.has(k) !== now.has(k)) block.draw({ fill: now.has(k) ? kit.red.clone().lerp(sheetTone, 0.62) : sheetTone })
        })
      },
      update(dt, time) {
        blocks.forEach((item, k) => {
          item.group.position.z += (WALL + 0.05 + (picked.has(k) ? 0.07 : 0) - item.group.position.z) * ease(dt, 9)
          const bug = bugs[k]
          bug.visible = picked.has(k)
          if (!bug.visible) return
          bug.position.set(RACK_X + RACK_W / 2 - 0.22 + Math.sin(time * 1.3 + k) * 0.05, item.y, item.group.position.z + 0.09)
          bug.rotation.z = Math.sin(time * 1.3 + k) * 0.5
        })
      },
      answered: () => picked.size > 0,
    }
  }

  /** 石の押しボタン: 壁に埋めた縁と、押すと沈む頭 */
  const BUTTON_BEZEL = lathe(
    [
      [0.12, 0],
      [0.19, 0],
      [0.2, 0.03],
      [0.17, 0.06],
      [0.12, 0.06],
    ],
    0.6,
  )
  const BUTTON_CAP = lathe(
    [
      [0, 0],
      [0.11, 0],
      [0.115, 0.04],
      [0.1, 0.075],
      [0, 0.085],
    ],
    0.5,
  )
  /** 行を選ぶ（実行される順に）: 実行される順にブロックを押す。押した順番がブロックに付き、光の玉が最後に押した行へ移る */
  const flowPuzzle = (frame: Group, i: number): Puzzle => {
    const flow = stages[i].querySelector<HTMLElement>('[data-quiz-flow]')
    const value = flow?.querySelector<HTMLInputElement>('[data-quiz-flow-value]')
    const blocks = codeRows(frame, [...stages[i].querySelectorAll<HTMLElement>('.quiz-lines > .quiz-line')])
    let steps: number[] = []
    let shown = '-'
    const spark = new Sprite(new SpriteMaterial({ map: glow, color: kit.gold, blending: AdditiveBlending, depthWrite: false }))
    spark.scale.setScalar(0.34)
    spark.position.set(RACK_X - RACK_W / 2 - 0.02, 1.5, WALL + 0.2)
    spark.visible = false
    frame.add(spark)
    blocks.forEach((item, k) => {
      const button = item.row.querySelector<HTMLElement>('[data-quiz-flow-line]')
      if (!button) return
      handle(
        item.group,
        `line-${i}-${k}`,
        `${k + 1} 行目のブロック「${item.row.querySelector('code')?.textContent ?? ''}」`,
        [0, 0, 0.05],
        [RACK_W, item.rowH, 0.12],
        () => 'この行を、つぎに実行する',
        () => {
          button.click()
          dirty = true
        },
      )
    })
    // 「1 つ戻す」「やり直す」の石のボタン。棚の右に、上下に並べる
    const buttons: [id: string, label: string, selector: string, y: number][] = [
      ['undo', '1 つもどす', '[data-quiz-flow-undo]', 1.85],
      ['clear', 'やりなおす', '[data-quiz-flow-clear]', 1.2],
    ]
    const caps: { cap: Mesh; push: number }[] = []
    for (const [id, label, selector, y] of buttons) {
      const x = RACK_X + RACK_W / 2 + 0.6
      part(frame, BUTTON_BEZEL, carved, [x, y, WALL], 1, [Math.PI / 2, 0, 0])
      const press = { cap: part(frame, BUTTON_CAP, kit.mat(tone(i)), [x, y, WALL + 0.03], 1, [Math.PI / 2, 0, 0]), push: 0 }
      caps.push(press)
      const sign = plate(0.5, 0.16)
      sign.mesh.position.set(x, y - 0.28, WALL + 0.03)
      frame.add(sign.mesh)
      part(frame, frameGeometry(0.48, 0.14, 0.025, 0.03, 0.5), brass, [x, y - 0.28, WALL + 0.03])
      sign.paper.fillStyle = hex(sheetTone)
      sign.paper.fillRect(0, 0, sign.w, sign.h)
      sign.paper.fillStyle = hex(kit.ink)
      sign.paper.textBaseline = 'middle'
      sign.paper.textAlign = 'center'
      sign.paper.font = text(24, 800)
      sign.paper.fillText(label, sign.w / 2, sign.h / 2 + 1)
      sign.flush()
      handle(
        frame,
        `${id}-${i}`,
        label,
        [x, y - 0.1, WALL + 0.08],
        [0.5, 0.5, 0.14],
        () => (steps.length ? label : ''),
        () => {
          press.push = 0.25
          flow?.querySelector<HTMLElement>(selector)?.click()
          dirty = true
        },
      )
    }
    return {
      handles: [],
      sync() {
        const now = value?.value ?? ''
        if (now === shown) return
        const before = steps
        shown = now
        steps = now ? now.split(',').map(Number) : []
        blocks.forEach((item, k) => {
          const badges = steps.flatMap((no, at) => (no === k + 1 ? [at + 1] : []))
          if (badges.length || before.includes(k + 1)) item.draw({ badges })
        })
      },
      update(dt, time) {
        for (const press of caps) {
          press.push = Math.max(0, press.push - dt)
          press.cap.position.z = WALL + 0.03 - (press.push > 0 ? 0.025 : 0)
        }
        const last = blocks[steps[steps.length - 1] - 1]
        spark.visible = !!last
        if (!last) return
        spark.position.y += (last.y - spark.position.y) * ease(dt, 8)
        spark.scale.setScalar(0.34 + Math.sin(time * 6) * 0.04)
      },
      answered: () => steps.length > 0,
    }
  }

  /** 左の壁に掛けた、黒板や表の額縁と裏板。中の絵（plate）は WALL + 0.08 に置く */
  const framed = (frame: Group, w: number, h: number, y: number, material: Material) => {
    part(frame, rounded(w + 0.1, h + 0.1, 0.05, 0.015), beamMat, [RACK_X, y, WALL + 0.045])
    part(frame, frameGeometry(w, h, 0.09, 0.08, 1.2), material, [RACK_X, y, WALL + 0.09])
    both((s) => part(frame, rounded(0.06, 0.24, 0.04, 0.01), iron, [RACK_X + s * (w / 2 - 0.3), y + h / 2 + 0.16, WALL + 0.05]))
  }
  /** 短答と記述: 黒板をクリックして、答えを書きこむ */
  const slatePuzzle = (frame: Group, i: number): Puzzle => {
    const field = stages[i].querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-quiz-text]')
    const multiline = field instanceof HTMLTextAreaElement
    const w = 2.7
    const h = 1.3
    const y = 1.5
    const slate = plate(w, h, 0.4)
    slate.mesh.position.set(RACK_X, y, WALL + 0.08)
    frame.add(slate.mesh)
    framed(frame, w, h, y, woodMat)
    const tray = y - h / 2 - 0.17
    part(frame, rounded(w + 0.3, 0.035, 0.17, 0.012), woodMat, [RACK_X, tray, WALL + 0.12])
    part(frame, rounded(w + 0.3, 0.05, 0.022, 0.008), woodMat, [RACK_X, tray + 0.03, WALL + 0.2])
    both((s) => part(frame, rounded(0.04, 0.14, 0.15, 0.01), woodMat, [RACK_X + s * (w / 2 + 0.05), tray - 0.06, WALL + 0.1]))
    const sticks: [x: number, color: Color, turn: number][] = [
      [0.55, kit.white, 0.1],
      [0.75, kit.yellow, -0.2],
      [0.9, kit.cheek, 0.35],
    ]
    for (const [x, color, turn] of sticks)
      part(frame, CYLINDER, kit.mat(color), [RACK_X + x, tray + 0.035, WALL + 0.13], [0.016, 0.13, 0.016], [0, turn, Math.PI / 2])
    part(frame, rounded(0.24, 0.05, 0.09, 0.012), woodMat, [RACK_X - 0.8, tray + 0.045, WALL + 0.13])
    part(frame, rounded(0.24, 0.03, 0.09, 0.008), kit.mat(kit.stone), [RACK_X - 0.8, tray + 0.012, WALL + 0.13])
    let shown = '\u0000'
    if (field)
      handle(
        frame,
        `slate-${i}`,
        '答えを書く黒板',
        [RACK_X, y, WALL + 0.08],
        [w, h, 0.06],
        () => (typing?.field === field ? '' : '書きこむ'),
        () => type(field, multiline),
      )
    return {
      handles: [],
      sync() {
        const caret = field ? caretOf(field) : -1
        const now = `${caret}:${field?.value ?? ''}`
        if (now === shown) return
        shown = now
        const { paper, w: W, h: H } = slate
        paper.fillStyle = hex(slateTone)
        paper.fillRect(0, 0, W, H)
        paper.textBaseline = 'top'
        paper.textAlign = 'left'
        paper.fillStyle = hex(kit.white.clone().lerp(slateTone, 0.45))
        paper.font = text(24, 800)
        paper.fillText('こたえ', 28, 22)
        paper.fillStyle = hex(kit.white)
        if (field?.value || caret >= 0) chalk(paper, field?.value ?? '', caret, 28, 66, W - 56, H - 86, 34)
        else {
          paper.fillStyle = hex(kit.white.clone().lerp(slateTone, 0.5))
          paper.font = text(28)
          paper.fillText('ここをクリックして、答えを書こう', 28, 70)
        }
        slate.flush()
      },
      update() {},
      answered: () => !!field?.value.trim(),
    }
  }

  type GridField = HTMLInputElement | HTMLSelectElement
  /** 表のマス 1 つ。field は答えを入れる欄（なければ、書いてあるだけのマス）。read は、マスに書く文字 */
  type GridCell = { field: GridField | null; read: (active: GridField | null, caret: number) => string }
  const fieldText = (field: GridField, caret: number) => {
    if (field instanceof HTMLSelectElement) return field.value ? (field.selectedOptions[0]?.textContent ?? '') : '？'
    return caret < 0 ? field.value : `${field.value.slice(0, caret)}▏${field.value.slice(caret)}`
  }
  /** DOM のマスの文字。空欄の番号は書かず、空欄の欄は入っている値にする */
  const cellText = (node: Node, active: GridField | null, caret: number): string => {
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) return fieldText(node, node === active ? caret : -1)
    if (node instanceof Element && node.matches('.quiz-blank-no')) return ''
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    return [...node.childNodes].map((child) => cellText(child, active, caret)).join('')
  }
  const domCell = (el: Element): GridCell => ({
    field: el.querySelector<GridField>('[data-quiz-blank], [data-quiz-match]'),
    read: (active, caret) => cellText(el, active, caret).trim(),
  })
  const textCell = (words: string): GridCell => ({ field: null, read: () => words })
  const fieldCell = (field: GridField): GridCell => ({ field, read: (active, caret) => fieldText(field, field === active ? caret : -1) })
  /** ステージの表（穴埋め・組み合わせ）を、見出しとマスにする */
  function gridOf(stage: HTMLElement): { heads: string[]; rows: GridCell[][]; widths?: number[] } {
    const table = stage.querySelector('.quiz-table')
    if (table)
      return {
        heads: [...table.querySelectorAll('thead th')].map((th) => cellText(th, null, -1).trim()),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(domCell)),
      }
    const pairs = [...stage.querySelectorAll('.quiz-match-row')]
    if (pairs.length)
      return {
        heads: ['', 'こたえ'],
        rows: pairs.map((row) => {
          const field = row.querySelector<GridField>('[data-quiz-match]')
          return [textCell(row.querySelector('.quiz-match-left')?.textContent ?? ''), field ? fieldCell(field) : textCell('')]
        }),
        widths: [0.5, 0.5],
      }
    return {
      heads: ['空欄', 'こたえ'],
      rows: [...stage.querySelectorAll<GridField>('[data-quiz-blank]')].map((field, n) => [textCell(`［${n + 1}］`), fieldCell(field)]),
      widths: [0.25, 0.75],
    }
  }
  /** 穴埋めと組み合わせ: 表のますをクリックして、値を書きこむ。選んで答えるますは、クリックするたびに次の選択肢になる */
  const gridPuzzle = (frame: Group, i: number): Puzzle => {
    const { heads, rows, widths } = gridOf(stages[i])
    const columns = Math.max(1, heads.length, ...rows.map((cells) => cells.length))
    const share = widths ?? Array.from({ length: columns }, () => 1 / columns)
    const lefts = share.map((_, col) => share.slice(0, col).reduce((sum, v) => sum + v, 0))
    const fields = rows.flatMap((cells) => cells.flatMap((cell) => (cell.field ? [cell.field] : [])))
    const w = 2.7
    const rowH = Math.min(0.3, 2.6 / (rows.length + 1))
    const h = rowH * (rows.length + 1)
    const y = Math.min(2.85 - h / 2, 1.55)
    const chart = plate(w, h, 0.45)
    const board = new Group()
    board.position.set(RACK_X, y, WALL + 0.08)
    board.add(chart.mesh)
    frame.add(board)
    framed(frame, w, h, y, woodMat)
    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
    ])
      part(frame, SPHERE, kit.mat(kit.red), [RACK_X + sx * (w / 2 + 0.045), y + sy * (h / 2 + 0.045), WALL + 0.14], 0.025)
    let shown = '\u0000'
    const cycle = (field: HTMLSelectElement) => {
      field.selectedIndex = (field.selectedIndex + 1) % field.options.length
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
      dirty = true
    }
    rows.forEach((cells, row) =>
      cells.forEach((cell, col) => {
        const field = cell.field
        if (!field) return
        const k = fields.indexOf(field)
        handle(
          board,
          `cell-${i}-${k}`,
          field.getAttribute('aria-label') ?? 'ます',
          [-w / 2 + (lefts[col] + share[col] / 2) * w, h / 2 - (row + 1.5) * rowH, 0.02],
          [share[col] * w, rowH, 0.06],
          () => (field instanceof HTMLSelectElement ? 'つぎの選択肢にする' : typing?.field === field ? '' : '書きこむ'),
          () => {
            if (field instanceof HTMLSelectElement) return cycle(field)
            // Enter で次のますへ進めるのは、1 ますごとに照準を合わせ直さずに、続けて打てるようにするため
            const next = fields[k + 1]
            type(
              field,
              false,
              next instanceof HTMLInputElement ? () => handles.find((other) => other.id === `cell-${i}-${k + 1}`)?.use() : undefined,
            )
          },
        )
      }),
    )
    return {
      handles: [],
      sync() {
        const active = fields.find((field) => typing?.field === field) ?? null
        const caret = active ? caretOf(active) : -1
        const now = `${fields.indexOf(active!)}:${caret}:${fields.map((field) => field.value).join('\u0001')}`
        if (now === shown) return
        shown = now
        const { paper, w: W, h: H } = chart
        const line = H / (rows.length + 1)
        const px = Math.min(30, line * 0.5)
        const xOf = (col: number) => lefts[col] * W
        const spanOf = (col: number) => share[col] * W
        paper.fillStyle = hex(sheetTone)
        paper.fillRect(0, 0, W, H)
        paper.fillStyle = hex(tone(i).clone().lerp(sheetTone, 0.6))
        paper.fillRect(0, 0, W, line)
        paper.textBaseline = 'middle'
        paper.textAlign = 'center'
        paper.fillStyle = hex(kit.ink)
        heads.forEach((head, col) =>
          fitText(paper, head, xOf(col) + spanOf(col) / 2, line / 2, spanOf(col) - 14, px, (size) => text(size, 800)),
        )
        rows.forEach((cells, row) =>
          cells.forEach((cell, col) => {
            const top = (row + 1) * line
            if (cell.field && cell.field === active) {
              paper.fillStyle = hex(kit.gold.clone().lerp(sheetTone, 0.5))
              paper.fillRect(xOf(col), top, spanOf(col), line)
            } else if (cell.field && !cell.field.value) {
              paper.fillStyle = hex(tone(i).clone().lerp(sheetTone, 0.85))
              paper.fillRect(xOf(col), top, spanOf(col), line)
            }
            paper.fillStyle = hex(kit.ink)
            fitText(paper, cell.read(active, caret), xOf(col) + spanOf(col) / 2, top + line / 2, spanOf(col) - 14, px, code)
          }),
        )
        paper.strokeStyle = hex(kit.ink.clone().lerp(sheetTone, 0.45))
        paper.lineWidth = 3
        for (let row = 1; row <= rows.length; row++) paper.strokeRect(0, row * line, W, 0)
        for (let col = 1; col < columns; col++) paper.strokeRect(xOf(col), 0, 0, H)
        chart.flush()
      },
      update() {},
      answered: () => fields.length > 0 && fields.every((field) => !!field.value.trim()),
    }
  }

  const DOOR_PLANK = rounded(0.225, 2.54, 0.13, 0.02)
  const DOOR_STRAP = rounded(0.96, 0.09, 0.16, 0.015)
  const DOOR_BAND = rounded(0.96, 0.2, 0.17, 0.02)
  const DOOR_RING = new TorusGeometry(0.08, 0.016, 8, 24)
  const LEVER_GRIP = lathe(
    [
      [0, 0],
      [0.032, 0],
      [0.038, 0.03],
      [0.032, 0.06],
      [0.038, 0.09],
      [0.032, 0.12],
      [0.038, 0.15],
      [0.034, 0.18],
      [0, 0.18],
    ],
    0.3,
    16,
  )
  const gates = kinds.map((kind, i) => {
    const edge = gateEdges[i]
    const tones = kit.tones(kind)
    const frame = stand(edge)
    both((s) => {
      part(frame, block(0.56, 3, 0.84, 3), trimMat, [s * 1.22, 1.5, 0])
      part(frame, rounded(0.72, 0.24, 1, 0.05, 1.2), trimMat, [s * 1.22, 0.12, 0])
      part(frame, rounded(0.66, 0.14, 0.94, 0.04, 1.2), trimMat, [s * 1.22, 2.53, 0])
      for (const face of [-1, 1]) torch(frame, s * 1.22, 1.75, face * 0.42, face)
    })
    part(frame, block(3, 0.5, 0.84, 3), trimMat, [0, 2.85, 0])
    part(frame, rounded(3.16, 0.12, 0.98, 0.04, 1.2), trimMat, [0, 3.1, 0])
    part(frame, rounded(1.56, 0.36, 0.05, 0.02), brass, [0, 2.85, 0.43])
    part(frame, rounded(1.46, 0.27, 0.05, 0.02), kit.mat(tones.main), [0, 2.85, 0.45])
    const leaves = [-1, 1].map((s) => {
      const hinge = new Group()
      hinge.position.x = s * DOORWAY
      // 1 枚の板にしないのは、継ぎ目のない扉は木の板に見えず、張りぼてのように見えるため
      for (let k = 0; k < 4; k++) part(hinge, DOOR_PLANK, woodMat, [-s * (0.12 + k * 0.235), 1.28, 0])
      for (const y of [0.42, 2.14]) {
        part(hinge, DOOR_STRAP, iron, [-s * 0.47, y, 0])
        for (let k = 0; k < 4; k++)
          for (const face of [-1, 1]) part(hinge, SPHERE, brass, [-s * (0.12 + k * 0.235), y, face * 0.085], 0.022)
      }
      part(hinge, DOOR_BAND, kit.mat(tones.main), [-s * 0.47, 1.3, 0])
      for (const face of [-1, 1]) {
        part(hinge, CYLINDER, brass, [-s * 0.8, 1.12, face * 0.085], [0.06, 0.02, 0.06], [Math.PI / 2, 0, 0])
        part(hinge, DOOR_RING, iron, [-s * 0.8, 1.03, face * 0.1])
      }
      frame.add(hinge)
      return hinge
    })
    const done = new Mesh(star, gold)
    done.position.set(0, 2.85, 0.5)
    done.scale.setScalar(0)
    frame.add(done)
    const actor = makeActor(kit, kind, 0.9)
    const at = outOf(edge, -1.8, 1.15)
    actor.island.position.set(at.x, 0, at.z)
    scene.add(actor.island)
    chunks.push({ ...at, group: actor.island })
    solids.push({ ...at, r: 0.45 })

    const from = handles.length
    signboard(frame, edge, i)
    const puzzles: Record<QuizKind, () => Puzzle> = {
      choice: () => choicePuzzle(frame, edge, i),
      short: () => slatePuzzle(frame, i),
      essay: () => slatePuzzle(frame, i),
      order: () => orderPuzzle(frame, edge, i),
      lines: () => (stages[i].querySelector('[data-quiz-flow]') ? flowPuzzle(frame, i) : pickPuzzle(frame, i)),
      blank: () => gridPuzzle(frame, i),
      match: () => gridPuzzle(frame, i),
    }
    const puzzle = puzzles[kind]()
    // レバー: 右の柱の前。引くと、答えを決めて扉を開ける
    const lever = new Group()
    lever.position.set(1.22, 1.08, 0.53)
    part(frame, rounded(0.3, 0.62, 0.06, 0.02), iron, [1.22, 1.1, 0.45])
    for (const [x, y] of [
      [-0.1, -0.24],
      [0.1, -0.24],
      [-0.1, 0.26],
      [0.1, 0.26],
    ])
      part(frame, SPHERE, brass, [1.22 + x, 1.1 + y, 0.48], 0.02)
    part(frame, rounded(0.07, 0.44, 0.02, 0.008), soot, [1.22, 1.1, 0.481])
    part(lever, CYLINDER, iron, [0, 0, 0], [0.065, 0.16, 0.065], [0, 0, Math.PI / 2])
    part(lever, CYLINDER, iron, [0, 0.2, 0], [0.02, 0.4, 0.02])
    part(lever, LEVER_GRIP, woodMat, [0, 0.36, 0])
    put(lever, kit, SPHERE, kit.red, [0, 0.58, 0], 0.07)
    frame.add(lever)
    /** frown は、まちがえたときに動物が首を振っている残り時間（秒） */
    const gate = { edge, frame, at, actor, leaves, star: done, lever, puzzle, passed: false, open: 0, shake: 0, frown: 0 }
    const checking = () => !!stages[i]?.hasAttribute('data-qg-checking')
    handle(
      frame,
      `lever-${i}`,
      'こたえを決めるレバー',
      [1.22, 1.15, 0.66],
      [0.4, 0.8, 0.5],
      () => (gate.passed ? '' : checking() ? 'たしかめています…' : 'レバーを引く'),
      () => {
        if (checking()) return
        if (!puzzle.answered()) {
          gate.shake = 0.5
          announce(guides[i].missing)
          return
        }
        // 2D のステージの「こたえる！」を押したことにする。client.ts がサーバーで確かめ、正解ならステージに data-qg-passed を付け、まちがいなら qg:wrong を送る
        root.querySelector<HTMLElement>('[data-qg-answer]')?.click()
      },
    )
    handle(
      frame,
      `door-${i}`,
      '閉じている扉',
      [0, 1.3, 0.14],
      [1.9, 2.6, 0.2],
      () => (gate.passed ? '' : 'しらべる'),
      () => announce('この扉は、問題に答えて右の柱のレバーを引き、正解すると開くよ'),
    )
    handle(
      frame,
      `host-${i}`,
      '扉の番をしている動物',
      [-1.8, 0.7, 1.15],
      [0.9, 1.4, 0.9],
      () => 'はなしかける',
      () => announce(guides[i].how),
    )
    puzzle.handles = handles.slice(from)
    return gate
  })

  // ゴール: 入ってきた扉の向かいに、こたえあわせの宝箱を置く
  const entry = gateEdges[count - 1]
  const desk: Anchor = {
    x: goalAt.x + ((goalAt.x - entry.x) / (CELL / 2)) * 2.4,
    z: goalAt.z + ((goalAt.z - entry.z) / (CELL / 2)) * 2.4,
    turn: entry.turn,
  }
  const goal = chunk(desk.x, desk.z, desk.turn)
  part(goal, rounded(2.7, 0.12, 1.9, 0.04, 1.2), trimMat, [0, 0.06, 0])
  part(goal, rounded(2.4, 0.1, 1.6, 0.04, 1.2), trimMat, [0, 0.16, 0])
  const base = new Group()
  base.position.y = 0.21
  goal.add(base)
  const goalLid = chestModel(base, 1.7, 0.78, 1.05)
  const treasure = new Sprite(new SpriteMaterial({ map: glow, color: kit.gold, blending: AdditiveBlending, depthWrite: false, opacity: 0 }))
  treasure.position.set(0, 1.1, 0)
  treasure.scale.setScalar(2.4)
  goal.add(treasure)
  solids.push({ ...outOf(desk, -0.5, 0), r: 0.62 }, { ...outOf(desk, 0.5, 0), r: 0.62 })
  // 床にはめこんだ、金のふちの丸い石。ゴールの部屋だと分かる目印
  part(
    roomGroups[count],
    lathe(
      [
        [0, 0],
        [2.05, 0],
        [2.05, 0.025],
        [1.98, 0.035],
        [0, 0.035],
      ],
      2,
      48,
    ),
    trimMat,
    [0, 0, 0],
  )
  part(roomGroups[count], new TorusGeometry(1.86, 0.03, 6, 64), gold, [0, 0.035, 0], 1, [Math.PI / 2, 0, 0])
  part(roomGroups[count], new TorusGeometry(1.2, 0.02, 6, 48), gold, [0, 0.035, 0], 1, [Math.PI / 2, 0, 0])
  const cloth = new PlaneGeometry(0.85, 0.54, 14, 4)
  cloth.translate(0.425, 0, 0)
  const rest = Float32Array.from(cloth.attributes.position.array)
  const flag = new Mesh(cloth, new MeshStandardMaterial({ color: kit.red, side: DoubleSide, roughness: 0.75 }))
  flag.position.set(1.64, 1.78, 0)
  part(
    goal,
    lathe(
      [
        [0, 0],
        [0.1, 0],
        [0.1, 0.05],
        [0.05, 0.09],
        [0.032, 0.14],
        [0.028, 2.0],
        [0.045, 2.03],
        [0, 2.05],
      ],
      0.6,
      16,
    ),
    brass,
    [1.6, 0, 0],
  )
  part(goal, SPHERE, gold, [1.6, 2.1, 0], 0.06)
  solids.push({ ...outOf(desk, 1.6, 0), r: 0.15 })
  const prize = new Mesh(starGeometry(0.34), gold)
  prize.position.set(0, 2.6, 0)
  goal.add(flag)
  roomGroups[count].add(prize)
  /** 宝箱を開けてからの時間（秒）。開けていなければ 0 */
  let lifted = 0
  const submit = root.querySelector<HTMLElement>('[data-qg-submit]')
  const chest = handle(
    goal,
    'chest',
    'こたえあわせの宝箱',
    [0, 0.7, 0],
    [1.9, 1.3, 1.3],
    () => 'あける（こたえあわせ）',
    () => {
      lifted = 0.01
      if (submit) submit.click()
      else announce('学生には、ここで「こたえあわせ」ができます')
    },
  )

  // 置き物: 部屋の四すみに、たる・木箱・石の柱・がれきをランダムに置く。真ん中の十字には置かないので、出入り口への道はふさがない
  const BARREL = lathe(
    [
      [0, 0.02],
      [0.29, 0.02],
      [0.3, 0],
      [0.34, 0.16],
      [0.37, 0.4],
      [0.34, 0.64],
      [0.3, 0.8],
      [0.29, 0.78],
      [0, 0.78],
    ],
    0.9,
    24,
  )
  const HOOP = new TorusGeometry(0.345, 0.016, 6, 32)
  const COLUMN = lathe(
    [
      [0, 0],
      [0.44, 0],
      [0.44, 0.12],
      [0.38, 0.17],
      [0.32, 0.24],
      [0.28, 0.36],
      [0.25, 1.2],
      [0.24, HEDGE - 0.36],
      [0.28, HEDGE - 0.26],
      [0.36, HEDGE - 0.17],
      [0.44, HEDGE - 0.12],
      [0.44, HEDGE],
      [0, HEDGE],
    ],
    1.2,
    24,
  )
  const CRATE = rounded(0.64, 0.64, 0.64, 0.02, 0.7)
  const CRATE_EDGE = rounded(0.08, 0.72, 0.08, 0.015, 0.7)
  const ROCK = boxMap(new DodecahedronGeometry(1, 0), 0.8)
  const props: ((group: Object3D, x: number, z: number) => number)[] = [
    (group, x, z) => {
      part(group, BARREL, woodMat, [x, 0, z], 1, [0, Math.random() * 6, 0])
      for (const y of [0.16, 0.64]) part(group, HOOP, iron, [x, y, z], 1, [Math.PI / 2, 0, 0])
      part(group, HOOP, iron, [x, 0.4, z], [1.07, 1.07, 1.07], [Math.PI / 2, 0, 0])
      blob(group, x, z, 1.5)
      return 0.4
    },
    (group, x, z) => {
      const crate = new Group()
      crate.position.set(x, 0.36, z)
      crate.rotation.y = Math.random()
      part(crate, CRATE, woodMat, [0, 0, 0])
      // 角の 4 本の柱と、上下のふちの 4 本ずつの角材で、木箱の枠を組む
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        part(crate, CRATE_EDGE, beamMat, [sx * 0.33, 0, sz * 0.33])
      for (const y of [-0.33, 0.33])
        for (const side of [-1, 1]) {
          part(crate, CRATE_EDGE, beamMat, [0, y, side * 0.33], 1, [0, 0, Math.PI / 2])
          part(crate, CRATE_EDGE, beamMat, [side * 0.33, y, 0], 1, [Math.PI / 2, 0, 0])
        }
      group.add(crate)
      blob(group, x, z, 1.7)
      return 0.45
    },
    (group, x, z) => {
      part(group, COLUMN, carved, [x, 0, z])
      blob(group, x, z, 1.9)
      return 0.45
    },
    (group, x, z) => {
      for (let k = 0; k < 4; k++) {
        const size = 0.1 + Math.random() * 0.12
        part(
          group,
          ROCK,
          pick([wallMat, trimMat]),
          [x + Math.random() * 0.7 - 0.35, size * 0.6, z + Math.random() * 0.7 - 0.35],
          [size * 1.3, size, size * 1.1],
          [Math.random() * 3, Math.random() * 3, Math.random() * 3],
        )
      }
      blob(group, x, z, 1.5)
      return 0.4
    },
  ]
  /** 扉の前（問題の実物を置く場所と、それを読んだり運んだりする場所） */
  const reserved = (x: number, z: number) =>
    gates.some((gate) => {
      const here = into(gate.edge, x, z)
      return here.z > 0 && here.z < 5.4 && Math.abs(here.x) < CELL / 2
    })
  rooms.forEach((r, i) => {
    if (r === goalAt) return
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      for (let k = 0; k < 2; k++) {
        if (Math.random() < 0.3) continue
        const x = sx * (2.6 + Math.random() * 2.1)
        const z = sz * (2.6 + Math.random() * 2.1)
        if (reserved(r.x + x, r.z + z)) continue
        solids.push({ x: r.x + x, z: r.z + z, r: pick(props)(roomGroups[i], x, z) })
      }
    }
  })
  // 寄り道の部屋には、真ん中に宝箱か泉を置いて、道の先に何かがある場所にする
  const chests: { x: number; z: number; lid: Group; found: boolean }[] = []
  sides.forEach((r, i) => {
    const group = roomGroups[main.length + i]
    if (Math.random() < 0.5) {
      part(
        group,
        lathe(
          [
            [0, 0],
            [1.95, 0],
            [2, 0.06],
            [2, 0.42],
            [1.94, 0.46],
            [1.82, 0.46],
            [1.78, 0.4],
            [1.76, 0.2],
            [0, 0.2],
          ],
          1.5,
          48,
        ),
        carved,
        [0, 0, 0],
      )
      const pool = new MeshStandardMaterial({
        color: water,
        emissive: water,
        emissiveIntensity: 0.25,
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85,
      })
      part(group, CYLINDER, pool, [0, 0.34, 0], [1.77, 0.02, 1.77])
      part(
        group,
        lathe(
          [
            [0, 0],
            [0.3, 0],
            [0.24, 0.12],
            [0.15, 0.24],
            [0.12, 0.9],
            [0.16, 0.96],
            [0.42, 1.02],
            [0.44, 1.1],
            [0.38, 1.1],
            [0.3, 1.04],
            [0, 1.03],
          ],
          1,
        ),
        carved,
        [0, 0.2, 0],
      )
      part(group, CYLINDER, pool, [0, 1.27, 0], [0.37, 0.02, 0.37])
      solids.push({ x: r.x, z: r.z, r: 1.95 })
      return
    }
    const lid = chestModel(group, 1.2, 0.56, 0.8)
    blob(group, 0, 0, 2.6)
    solids.push({ x: r.x, z: r.z, r: 0.85 })
    chests.push({ x: r.x, z: r.z, lid, found: false })
  })

  const torches = flames.map((fire): Torch => {
    const at = fire.getWorldPosition(new Vector3())
    const room = roomAt(at.x, at.z)
    // 炎の位置にそのまま置かないのは、すぐ後ろの壁だけが白く飛んで、部屋には光が届かなくなるため
    if (room >= 0) at.add(new Vector3(rooms[room].x - at.x, 0, rooms[room].z - at.z).setLength(0.9))
    return { at, room, far: 0 }
  })

  const xs = rooms.map((r) => r.x)
  const zs = rooms.map((r) => r.z)
  const box = {
    left: Math.min(...xs) - CELL / 2,
    right: Math.max(...xs) + CELL / 2,
    top: Math.min(...zs) - CELL / 2,
    bottom: Math.max(...zs) + CELL / 2,
  }
  /** 壁や扉をはさんだ、両側の部屋の番号 */
  const links = edges.map((edge) => {
    const dx = edge.across ? CELL / 2 : 0
    const dz = edge.across ? 0 : CELL / 2
    return [roomAt(edge.x - dx, edge.z - dz), roomAt(edge.x + dx, edge.z + dz)]
  })

  // 宙をただようほこり
  const scatter = seeded(31)
  const motes = new Float32Array(DUST * 3)
  const dustGeometry = new BufferGeometry()
  dustGeometry.setAttribute('position', new BufferAttribute(motes, 3))
  const dust = new Points(
    dustGeometry,
    new PointsMaterial({
      map: glow,
      color: kit.flame,
      size: 0.06,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  // 点の集まりの外枠は最初の位置で決まるので、歩いた先で「画面の外」と判定されて消えないようにする
  dust.frustumCulled = false
  scene.add(dust)

  // 照準が合っているものを囲む枠
  const selector = new Group()
  selector.add(
    new Mesh(BOX, new MeshBasicMaterial({ color: kit.gold, transparent: true, opacity: 0.14, depthWrite: false, fog: false })),
    new LineSegments(new EdgesGeometry(BOX), new LineBasicMaterial({ color: kit.gold, fog: false })),
  )
  selector.visible = false
  scene.add(selector)

  /** いまいる部屋で押せるもの。Tab キーでも選べるように、同じ数の目印（ボタン）を画面に重ねておく */
  let active: Handle[] = []
  let hitList: Mesh[] = []
  let marks: HTMLButtonElement[] = []
  const setActive = (list: Handle[]) => {
    active = list
    hitList = list.map((item) => item.hit)
    aimed = null
    marks = list.map((item) => {
      const mark = document.createElement('button')
      mark.type = 'button'
      mark.className = 'qg-spot'
      mark.dataset.qgSpot = item.id
      mark.setAttribute('aria-label', item.name)
      return mark
    })
    spots?.replaceChildren(...marks)
  }
  const ray = new Raycaster()
  const spot = new Vector2()
  const probe = new Vector3()
  /** 画面のその位置（ビューポートの px。省くと画面の真ん中）にある、押せるもの */
  const pickAt = (at: { x: number; y: number } | null) => {
    const area = screen()?.getBoundingClientRect()
    if (!area || !hitList.length) return null
    if (at) spot.set(((at.x - area.left) / area.width) * 2 - 1, 1 - ((at.y - area.top) / area.height) * 2)
    else spot.set(0, 0)
    ray.setFromCamera(spot, camera)
    const found = ray.intersectObjects(hitList, false).flatMap((hit) => {
      const item = active.find((other) => other.hit === hit.object)
      return item ? [{ item, far: hit.distance }] : []
    })
    // いちばん手前のものを選ぶだけにしないのは、いまは押せないもの（何も持っていないときの台座など）の箱が、奥のレバーやブロックをふさいでしまうため
    return found.find(({ item }) => item.act()) ?? found[0] ?? null
  }
  const use = (at: { x: number; y: number } | null) => {
    const found = pickAt(at)
    const usable = !!found && found.far <= REACH && !!found.item.act()
    // 文字を打っている途中で、打っている欄のほかを押したら、打つのを終える
    if (typing && (usable || !found || found.far > REACH)) typer?.blur()
    if (!found) return false
    if (found.far > REACH) announce('もっと近づこう')
    else if (usable) found.item.use()
    return true
  }

  /** マウスを画面に閉じ込めて、動かした分だけ視点を回せるようにする。使えない端末（タッチなど）では、画面をなぞって回す */
  const grab = (closing = false) => {
    // タッチ端末でも固定できるブラウザがあるが、固定すると、タップした場所ではなく画面の真ん中を押したことになってしまう
    if (coarse.matches) return
    // 正解でノートが閉じるのと同時に解説が開くので、解説の「つづける」を押すまでは固定しない
    if (!closing && root.hasAttribute('data-qg-explaining')) return
    try {
      // 新しいブラウザは Promise を返す。Esc で外した直後などに断られても、画面をクリックすればやり直せるので、失敗は捨てる
      void Promise.resolve(screen()?.requestPointerLock?.()).catch(() => {})
    } catch {
      // 対応していない端末
    }
  }
  const letGo = () => {
    if (document.pointerLockElement) document.exitPointerLock()
  }
  const setPaused = (value: boolean) => {
    paused = value
    root.toggleAttribute('data-qg-paused', value)
    keys.clear()
    if (value) host.querySelector<HTMLElement>('[data-qg-resume]')?.focus()
    else if (playing) {
      screen()?.focus()
      grab()
    }
  }
  /** ノート: 2D のステージを、画面の真ん中に重ねて開く。石板に収まらない長い問題を読むときと、キーボードだけで答えるときに使う */
  const setOpen = (value: boolean) => {
    if (open === value) return
    open = value
    root.toggleAttribute('data-qg-open', value)
    keys.clear()
    release()
    if (value) {
      // ノートの中を押せるようにマウスを放す。自分で外したので、止まったことにはしない
      quiet = locked()
      letGo()
      panel?.focus()
    } else {
      screen()?.focus()
      if (playing) grab()
    }
  }
  const setPlay = (value: boolean) => {
    root.toggleAttribute('data-play', value)
    // 次のフレームの sync を待たずに覚えるのは、始めた直後に押した移動のキーを、まだ始めていないものとして捨ててしまうため
    playing = value
    keys.clear()
    if (value) {
      screen()?.focus()
      grab()
    } else {
      release()
      setOpen(false)
      setPaused(false)
      letGo()
    }
  }
  /** ノートと答えの対象にするステージは、2D の道のりのボタンを押したことにして切り替える（client.ts の qgShow） */
  const showStage = (to: number) => {
    if (to !== current) root.querySelector<HTMLElement>(`[data-qg-to="${to}"]`)?.click()
  }
  const sync = () => {
    dirty = false
    playing = root.hasAttribute('data-play')
    current = Math.max(
      0,
      stages.findIndex((stage) => !stage.hidden),
    )
    gates.forEach((gate, i) => {
      const passed = !!stages[i]?.hasAttribute('data-qg-passed')
      if (passed && !gate.passed) {
        gate.actor.spin = SPIN
        if (playing) {
          setOpen(false)
          announce('正解！ 扉がひらいた')
        }
      }
      gate.passed = passed
      gate.puzzle.sync()
    })
    if (openedLabel) openedLabel.textContent = String(gates.filter((gate) => gate.passed).length)
    const showing = root.hasAttribute('data-qg-explaining')
    if (showing !== explaining) {
      explaining = showing
      keys.clear()
      if (showing) {
        // 解説の「つづける」を押せるようにマウスを放す。自分で外したので、止まったことにはしない
        // 固定していなくても、ノートから正解したときは、閉じたあとにまた固定し直したいので、止まった画面を出す
        relock = !coarse.matches
        quiet = locked()
        letGo()
      } else {
        if (relock && playing && !locked()) setPaused(true)
        relock = false
      }
    }
    // 採点で「まだ答えていない問題」へ切り替わったときも、いまいる部屋の問題を対象にしたままにする
    if (playing && live >= 0) showStage(live)
  }
  // client.ts から直接呼ばせないのは、three.js を読み込む前の解答を、読み込んだあとで取りこぼさないため
  const watcher = new MutationObserver(() => (dirty = true))
  // ゲームの枠ごと見張らないのは、画面に重ねた案内や目印を書き換えるたびに、自分の書き換えで読み直しが走るため
  if (panel) watcher.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-qg-passed'] })
  watcher.observe(root, { attributes: true, attributeFilter: ['data-play', 'data-qg-explaining'] })
  // 入力欄の値は属性ではないので、ノートで答えたときは、入力のイベントで気づく
  const onInput = () => (dirty = true)
  root.addEventListener('input', onInput)
  root.addEventListener('change', onInput)
  const onClick = (e: Event) => {
    const target = e.target as Element
    const mark = target.closest<HTMLElement>('[data-qg-spot]')
    if (target.closest('[data-qg-start]')) setPlay(true)
    else if (target.closest('[data-qg-exit]')) setPlay(false)
    else if (target.closest('[data-qg-resume]')) setPaused(false)
    else if (target.closest('[data-qg-note]')) setOpen(!open)
    else if (target.closest('[data-qg-close]')) setOpen(false)
    else if (target.closest('[data-qg-jump]')) jump = true
    else if (target.closest('[data-qg-explain-close]')) {
      // マウスの固定は、押したその場でしか頼めないので、client.ts が解説を閉じるのを待たずにここで頼む
      relock = false
      screen()?.focus()
      if (playing) grab(true)
    } else if (mark) {
      // Tab キーで選んだ目印は、近づいて照準を合わせなくても押せる。マウスを使えない人が、同じ問題に答えられるようにするため
      const item = active.find((other) => other.id === mark.dataset.qgSpot)
      if (!item?.act()) return
      // 文字を打っている途中でほかのものを押したら、打つのを終える。終えないと、歩くキーが文字として入り続ける
      typer?.blur()
      item.use()
    }
    dirty = true
  }
  root.addEventListener('click', onClick)
  // Tab キーで目印を選んだら、視点をそのものへ向ける。選んだものが画面の外や後ろにあっても、どれを選んでいるかが見えるようにするため
  const onFocus = (e: Event) => {
    const mark = (e.target as Element).closest<HTMLElement>('[data-qg-spot]')
    const item = mark && active.find((other) => other.id === mark.dataset.qgSpot)
    if (!item || !playing || paused || open) return
    probe.setFromMatrixPosition(item.hit.matrixWorld)
    const dx = probe.x - pos.x
    const dz = probe.z - pos.z
    glide = {
      x: pos.x,
      z: pos.z,
      yaw: Math.atan2(-dx, -dz),
      pitch: clamp(Math.atan2(probe.y - EYE - pos.y, Math.hypot(dx, dz)), -1, 1),
      left: 1,
    }
  }
  root.addEventListener('focusin', onFocus)
  // マウスが外れたら止める。止めずに続けると、Esc を押したあと、マウスを動かしても視点が回らない理由が分からないため
  const onLock = () => {
    if (document.pointerLockElement || !playing) return
    if (quiet) quiet = false
    else if (!open && !explaining) setPaused(true)
  }
  document.addEventListener('pointerlockchange', onLock)
  // まちがえたときは、トーストではなく、扉の前の動物とレバーで知らせる（client.ts の qgCheck）
  const onWrong = (e: Event) => {
    const gate = gates[stages.indexOf(e.target as HTMLElement)]
    if (!gate || !playing || open) return
    e.preventDefault()
    gate.shake = 0.6
    gate.frown = 2.2
    announce('ざんねん、ちがうみたい。もう一度考えてみよう')
  }
  root.addEventListener('qg:wrong', onWrong)
  const onType = (e: Event) => {
    if (!typing || !typer) return
    const limit = typing.multiline ? MAX_QUIZ_ESSAY_LENGTH : MAX_QUIZ_OUTPUT_LENGTH
    const value = (typing.multiline ? typer.value : typer.value.replace(/\n/g, '')).slice(0, limit)
    // 変換の途中で欄を書き換えないのは、日本語の入力が途中で確定されてしまうため
    if (!(e as InputEvent).isComposing && typer.value !== value) typer.value = value
    typing.field.value = value
    typing.field.dispatchEvent(new Event('input', { bubbles: true }))
    dirty = true
  }
  const onTypeKey = (e: KeyboardEvent) => {
    if (!typing || e.isComposing) return
    dirty = true
    if (e.key === 'Escape') typer?.blur()
    else if (e.key === 'Enter' && !typing.multiline) {
      e.preventDefault()
      const { next } = typing
      typer?.blur()
      next?.()
    }
  }
  const onTypeEnd = () => {
    typing = null
    dirty = true
  }
  typer?.addEventListener('input', onType)
  typer?.addEventListener('keydown', onTypeKey)
  typer?.addEventListener('keyup', onInput)
  typer?.addEventListener('blur', onTypeEnd)
  /** スティックを倒している指。中心の位置と、端までの長さ（px）も覚えておく */
  let grip: { id: number; x: number; y: number; reach: number } | null = null
  const onStick = (e: PointerEvent) => {
    if (e.type === 'pointerdown') {
      const pad = (e.target as Element).closest<HTMLElement>('[data-qg-stick]')
      if (!pad) return
      const area = pad.getBoundingClientRect()
      grip = { id: e.pointerId, x: area.left + area.width / 2, y: area.top + area.height / 2, reach: area.width / 2 }
      e.preventDefault()
    }
    if (!grip || e.pointerId !== grip.id) return
    const down = e.type !== 'pointerup' && e.type !== 'pointercancel'
    const x = down ? (e.clientX - grip.x) / grip.reach : 0
    const z = down ? (e.clientY - grip.y) / grip.reach : 0
    const far = Math.max(1, Math.hypot(x, z))
    stick.x = x / far
    stick.z = z / far
    if (knob) knob.style.translate = `${stick.x * grip.reach * 0.6}px ${stick.z * grip.reach * 0.6}px`
    if (!down) grip = null
  }
  const STICK_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const
  // スティックの要素でだけ受け取らないのは、倒した指がスティックの外へはみ出すと、動きが届かなくなるため。
  // setPointerCapture を使わないのは、指を離したあとの pointerup が届かない端末で、歩き続けたままになるのを避けるため
  for (const type of STICK_EVENTS) addEventListener(type, onStick)
  sync()
  // 答え終えた扉があれば、その先の部屋から始める
  const cleared = gates.findIndex((gate) => !gate.passed)
  const begin = main[cleared < 0 ? count : cleared]
  // 部屋の真ん中から少し下がった所に立たせて、次の扉（すべて開けていればゴールの宝箱）のほうを向かせる。最初にどちらへ進むかで迷わせないため
  const ahead = cleared < 0 ? desk : gates[cleared].edge
  const toward = Math.hypot(ahead.x - begin.x, ahead.z - begin.z) || 1
  pos.set(begin.x - ((ahead.x - begin.x) / toward) * 1.2, 0, begin.z - ((ahead.z - begin.z) / toward) * 1.2)
  yaw = Math.atan2(-(ahead.x - pos.x), -(ahead.z - pos.z))
  for (const gate of gates) gate.open = gate.passed ? 1 : 0
  for (let i = 0; i < DUST; i++) motes.set([pos.x + (scatter() - 0.5) * 14, 0.3 + scatter() * 2.8, pos.z + (scatter() - 0.5) * 14], i * 3)

  /** 壁・閉じた扉・置き物などにぶつかるか。開いた扉と通り道の間だけは通れる */
  const blocked = (x: number, z: number, body = BODY) =>
    edges.some((edge) => {
      const along = edge.across ? z - edge.z : x - edge.x
      const off = edge.across ? x - edge.x : z - edge.z
      if (Math.abs(off) >= WALL + body || Math.abs(along) > CELL / 2 + WALL) return false
      const gap = edge.kind === 'arch' ? ARCH : edge.kind === 'gate' && gates[edge.gate].open > 0.8 ? DOORWAY : 0
      return Math.abs(along) >= gap - body
    }) || solids.some((solid) => Math.hypot(x - solid.x, z - solid.z) < solid.r + body)

  // 宝石: 集めても点数にはならない。部屋を見てまわる楽しみとして、ところどころに浮かべておく
  const GEM = new OctahedronGeometry(0.17)
  const gemMats = [kit.gold, kit.green, kit.red, kit.tones('order').main].map(
    (color) => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.2 }),
  )
  const gems: { mesh: Mesh; x: number; z: number; taken: number }[] = []
  rooms.forEach((r, i) => {
    // 置けなかったら次の場所を試す回数を決めておくのは、置き物で埋まった部屋で、いつまでも探し続けないようにするため
    for (let tries = 0, placed = 0; tries < 8 && placed < 3; tries++) {
      const x = r.x + random(-4.6, 4.6)
      const z = r.z + random(-4.6, 4.6)
      if (
        blocked(x, z, 0.6) ||
        reserved(x, z) ||
        Math.hypot(x - pos.x, z - pos.z) < 2 ||
        gems.some((gem) => Math.hypot(x - gem.x, z - gem.z) < 1.5)
      )
        continue
      const mesh = part(roomGroups[i], GEM, pick(gemMats), [x - r.x, 0.75, z - r.z], [1, 1.35, 1])
      gems.push({ mesh, x, z, taken: 0 })
      placed++
    }
  })

  // ミニマップ: 歩いた部屋と、そこから見える出入り口だけを描く。まだ行っていない所は、歩いて確かめる楽しみとして残す
  const paper = map?.getContext('2d')
  const drawMap = () => {
    if (!map || !paper) return
    const size = map.clientWidth * Math.min(devicePixelRatio, 2)
    if (!size) return
    if (map.width !== size) map.width = map.height = size
    const scale = (size * 0.86) / Math.max(box.right - box.left, box.bottom - box.top)
    const px = (x: number) => size / 2 + (x - (box.left + box.right) / 2) * scale
    const pz = (z: number) => size / 2 + (z - (box.top + box.bottom) / 2) * scale
    const room = CELL * scale
    const hinted = new Set<number>()
    edges.forEach((edge, i) => {
      if (edge.kind === 'wall') return
      const [a, b] = links[i]
      if (seen.has(a)) hinted.add(b)
      if (seen.has(b)) hinted.add(a)
    })
    paper.clearRect(0, 0, size, size)
    rooms.forEach((r, i) => {
      if (!seen.has(i) && !hinted.has(i)) return
      paper.globalAlpha = seen.has(i) ? 1 : 0.35
      paper.fillStyle = r === goalAt ? hex(blend(kit.gold)) : hex(r.parent >= 0 ? kit.rockDark : kit.rock)
      paper.fillRect(px(r.x) - room / 2 + 1, pz(r.z) - room / 2 + 1, room - 2, room - 2)
    })
    paper.globalAlpha = 1
    edges.forEach((edge, i) => {
      if (edge.kind === 'wall' || !links[i].some((r) => seen.has(r))) return
      const gate = gates[edge.gate]
      paper.fillStyle = !gate ? hex(kit.wood) : gate.passed ? hex(kit.gold) : hex(kit.tones(kinds[edge.gate]).main)
      const long = room * (gate ? 0.42 : 0.3)
      const thick = Math.max(3, room * 0.14)
      paper.fillRect(
        px(edge.x) - (edge.across ? thick : long) / 2,
        pz(edge.z) - (edge.across ? long : thick) / 2,
        edge.across ? thick : long,
        edge.across ? long : thick,
      )
    })
    if (seen.has(count) || hinted.has(count)) {
      paper.fillStyle = hex(kit.red)
      paper.beginPath()
      paper.arc(px(goalAt.x), pz(goalAt.z), room * 0.2, 0, Math.PI * 2)
      paper.fill()
    }
    paper.fillStyle = hex(kit.yellow)
    paper.strokeStyle = hex(kit.ink)
    paper.lineWidth = Math.max(2, room * 0.06)
    // 自分は、向いているほうがとがった三角で描く
    const tip = Math.max(6, room * 0.3)
    paper.save()
    paper.translate(px(pos.x), pz(pos.z))
    paper.rotate(-yaw)
    paper.beginPath()
    paper.moveTo(0, -tip)
    paper.lineTo(tip * 0.7, tip * 0.75)
    paper.lineTo(-tip * 0.7, tip * 0.75)
    paper.closePath()
    paper.fill()
    paper.stroke()
    paper.restore()
  }

  return {
    scene,
    camera,
    filmic: true,
    update(time, dt) {
      if (dirty) sync()
      const control = playing && !paused && !open && !explaining
      // 前後と左右の入力。向いている向きを基準にして歩く
      let forward = control ? -stick.z : 0
      let strafe = control ? stick.x : 0
      let turning = 0
      let nodding = 0
      if (control && !typing)
        for (const key of keys) {
          forward += MOVES[key]?.[0] ?? 0
          strafe += MOVES[key]?.[1] ?? 0
          turning += TURNS_BY_KEY[key] ?? 0
          nodding += NODS_BY_KEY[key] ?? 0
        }
      else jump = false
      if (glide && control && !forward && !strafe && !turning && !nodding) {
        const k = ease(dt, 7)
        pos.x += (glide.x - pos.x) * k
        pos.z += (glide.z - pos.z) * k
        yaw = turnTo(yaw, glide.yaw, k)
        pitch += (glide.pitch - pitch) * k
        glide.left -= dt
        if (glide.left <= 0) glide = null
      } else glide = null
      yaw += turning * TURN * dt
      pitch = clamp(pitch + nodding * TURN * dt, -1, 1)
      const dx = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe
      const dz = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe
      const far = Math.hypot(dx, dz)
      if (far > 0) {
        const step = WALK * dt * Math.min(1, far)
        const x = pos.x + (dx / far) * step
        const z = pos.z + (dz / far) * step
        // 斜めにぶつかったときに止めてしまわないのは、壁に沿って横へすべれないと、扉の間を通りにくいため
        if (!blocked(x, z)) pos.set(x, pos.y, z)
        else if (!blocked(x, pos.z)) pos.x = x
        else if (!blocked(pos.x, z)) pos.z = z
        stride += dt * 11
      }
      if (jump && grounded) {
        fall = JUMP
        grounded = false
      }
      jump = false
      if (!grounded) {
        fall -= GRAVITY * dt
        pos.y += fall * dt
        if (pos.y <= 0) {
          pos.y = fall = 0
          grounded = true
        }
      }

      // いまいる部屋の問題だけを、押せるもの・答えの対象にする
      const here = roomAt(pos.x, pos.z)
      if (here >= 0) seen.add(here)
      const now = playing && here >= 0 && here <= count ? here : -1
      if (now !== live) {
        live = now
        // 持ったまま部屋を出たものは、元の場所へ戻す
        release()
        typer?.blur()
        setActive(live < 0 ? [] : live === count ? [chest] : gates[live].puzzle.handles)
        if (live >= 0) showStage(live)
      }
      if (control && tick++ % 2 === 0) {
        // 照準は、マウスを閉じ込めている間は画面の真ん中、そうでなければカーソルの位置。タッチでは、押した場所がそのまま選ばれるので出さない
        const found = locked() ? pickAt(null) : pointer && !coarse.matches ? pickAt(pointer) : null
        aimed = found?.item ?? null
        aimFar = found?.far ?? 0
      } else if (!control) aimed = null
      const reachable = !!aimed && aimFar <= REACH
      const act = aimed ? (reachable ? aimed.act() : 'もっと近づこう') : ''
      if (actLabel) {
        actLabel.hidden = !act
        actLabel.toggleAttribute('data-far', !!act && !reachable)
        if (act && actText && actText.textContent !== act) actText.textContent = act
      }
      root.toggleAttribute('data-qg-aim', reachable && !!act)
      selector.visible = reachable && !!act
      if (selector.visible && aimed) {
        aimed.hit.matrixWorld.decompose(selector.position, selector.quaternion, selector.scale)
        selector.scale.multiplyScalar(1.03)
      }
      // Tab キーで選ぶ目印を、それぞれのものが見えている場所に重ねる。
      // 画面の外や後ろにあるものの目印を消さずに、画面のふちへ寄せておくのは、消すと Tab キーで選べなくなるため（選ぶと、視点がそちらへ向く）
      if (control && tick % 3 === 0) {
        const { clientWidth: width, clientHeight: height } = host
        active.forEach((item, i) => {
          probe.setFromMatrixPosition(item.hit.matrixWorld)
          const away = probe.distanceTo(camera.position)
          probe.applyMatrix4(camera.matrixWorldInverse)
          const behind = probe.z > -0.05
          const side = Math.sign(probe.x) || 1
          probe.applyMatrix4(camera.projectionMatrix)
          const mark = marks[i]
          const off = behind || Math.abs(probe.x) > 1 || Math.abs(probe.y) > 1
          mark.toggleAttribute('data-qg-off', off)
          const x = behind ? side : clamp(probe.x, -1, 1)
          const y = behind ? 0 : clamp(probe.y, -1, 1)
          mark.style.translate = `${((x + 1) / 2) * width}px ${((1 - y) / 2) * height}px`
          const range = away.toFixed(1)
          if (mark.dataset.qgFar !== range) mark.dataset.qgFar = range
        })
      }
      // 押せるかどうかは、場所と違って毎フレーム確かめる。玉を持った直後に、台座の目印がまだ押せないままになるのを避けるため
      active.forEach((item, i) => {
        const usable = !!item.act()
        if (marks[i].disabled === usable) marks[i].disabled = !usable
      })

      const next = gates.findIndex((gate) => !gate.passed)
      flash.left -= dt
      const goalText = here === count ? 'ゴール！ 宝箱をあけて、こたえあわせをしよう' : 'ぜんぶの扉がひらいた！ ゴールの部屋へすすもう'
      const message =
        flash.left > 0
          ? flash.text
          : typing
            ? typing.multiline
              ? '入力中。おわったら、ほかの場所をおしてね'
              : '入力中。Enter でつぎのますへ。おわったら、ほかの場所をおしてね'
            : held
              ? `${held.name}を持っているよ。${held.tip}`
              : next < 0
                ? goalText
                : `${here === next ? guides[next].quest : 'つぎの扉をさがそう'}（${next + 1} / ${count}）`
      if (quest && quest.textContent !== message) quest.textContent = message

      gates.forEach((gate, i) => {
        gate.open += ((gate.passed ? 1 : 0) - gate.open) * ease(dt, 3.5)
        gate.leaves[0].rotation.y = gate.open * 1.9
        gate.leaves[1].rotation.y = -gate.open * 1.9
        gate.shake = Math.max(0, gate.shake - dt)
        gate.frown = Math.max(0, gate.frown - dt)
        // レバーは、上に起きた形から、手前へ倒れる。答えが足りないときは、少し揺れて戻る
        gate.lever.rotation.x +=
          ((gate.passed ? 2.2 : 0.75) + Math.sin(gate.shake * 30) * gate.shake * 0.5 - gate.lever.rotation.x) * ease(dt, 9)
        gate.actor.facing = turnTo(gate.actor.facing, Math.atan2(pos.x - gate.at.x, pos.z - gate.at.z), ease(dt, 6))
        moveActor(gate.actor, i === next && !gate.frown ? (time / HOP) % 1 : null, time, dt)
        setMood(gate.actor.mouth, !gate.frown)
        if (gate.frown) gate.actor.animal.rotation.y += Math.sin(gate.frown * 14) * 0.4 * Math.min(1, gate.frown)
        gate.star.scale.setScalar(gate.star.scale.x + ((gate.passed ? 1 : 0) - gate.star.scale.x) * ease(dt, 7))
        gate.star.rotation.y = time * 1.6 + i
        if (i === live || Math.abs(i - live) === 1) gate.puzzle.update(dt, time)
      })
      if (live === count) {
        // 旗は、竿から離れるほど大きく波打たせる
        const wave = cloth.attributes.position
        for (let k = 0; k < wave.count; k++) {
          const x = rest[k * 3]
          wave.setZ(k, Math.sin(x * 7 - time * 5) * 0.07 * x + Math.sin(time * 2.3) * 0.04 * x)
        }
        wave.needsUpdate = true
        cloth.computeVertexNormals()
      }
      prize.rotation.y = time * 1.4
      prize.position.y = 2.6 + Math.sin(time * 2) * 0.06
      if (lifted) lifted = lifted > 2.5 ? 0 : lifted + dt
      goalLid.rotation.x += ((lifted ? -1.2 : 0) - goalLid.rotation.x) * ease(dt, 5)
      treasure.material.opacity += ((lifted ? 0.9 : 0) - treasure.material.opacity) * ease(dt, 5)

      for (const gem of gems) {
        if (gem.taken >= 1) continue
        if (!gem.taken && control && Math.hypot(pos.x - gem.x, pos.z - gem.z) < GEM_REACH) {
          gem.taken = 0.01
          gemCount++
        }
        if (gem.taken) gem.taken = Math.min(1, gem.taken + dt * 3)
        gem.mesh.rotation.y = time * 2 + gem.x
        gem.mesh.position.y = 0.75 + Math.sin(time * 2.4 + gem.z) * 0.08 + gem.taken * 0.9
        gem.mesh.scale.set(1 - gem.taken, (1 - gem.taken) * 1.35, 1 - gem.taken)
        gem.mesh.visible = gem.taken < 1
      }
      for (const found of chests) {
        if (!found.found && control && Math.hypot(pos.x - found.x, pos.z - found.z) < CHEST_REACH) {
          found.found = true
          gemCount += CHEST_GEMS
          announce(`宝箱を見つけた！ 宝石 +${CHEST_GEMS}`)
        }
        found.lid.rotation.x += ((found.found ? -1.15 : 0) - found.lid.rotation.x) * ease(dt, 5)
      }
      if (gemLabel && gemLabel.textContent !== String(gemCount)) gemLabel.textContent = String(gemCount)

      // たいまつ: 近いものから GLOWS 本だけに光源を回す。入れ替えるときは、いったん暗くしてから移して、明かりが飛び移って見えないようにする
      for (const t of torches) t.far = Math.hypot(t.at.x - pos.x, t.at.z - pos.z) + (t.room === here ? 0 : 7)
      torches.sort((a, b) => a.far - b.far)
      const wanted = torches.slice(0, GLOWS)
      const limit = (wanted[GLOWS - 1]?.far ?? Infinity) + 1.5
      glows.forEach((lit, i) => {
        if (lit.torch && (wanted.includes(lit.torch) || lit.torch.far < limit)) lit.level = Math.min(1, lit.level + dt * 3)
        else {
          lit.level = Math.max(0, lit.level - dt * 4)
          if (!lit.level) lit.torch = wanted.find((t) => !glows.some((other) => other.torch === t)) ?? null
        }
        if (lit.torch) lit.light.position.copy(lit.torch.at)
        lit.light.intensity = lit.level * (5.5 + Math.sin(time * 9 + i * 2.1) * 0.6 + Math.sin(time * 15.3 + i) * 0.35)
      })
      flames.forEach((fire, i) => fire.scale.set(0.42 + Math.sin(time * 11 + i * 1.3) * 0.04, 0.6 + Math.sin(time * 9 + i * 1.7) * 0.07, 1))
      // 手もとの明かりを目の前ではなく少し後ろの上に置くのは、近づいた壁や扉が白く飛ぶため
      lantern.position.set(pos.x + Math.sin(yaw) * 0.5, 2.2, pos.z + Math.cos(yaw) * 0.5)
      lantern.intensity = 5 + Math.sin(time * 7) * 0.35
      for (const { x, z, group } of chunks) group.visible = Math.hypot(x - pos.x, z - pos.z) < FAR
      for (let i = 0; i < DUST; i++) {
        const at = i * 3
        motes[at] += Math.sin(time * 0.31 + i) * dt * 0.07
        motes[at + 1] += Math.sin(time * 0.23 + i * 1.7) * dt * 0.05
        motes[at + 2] += Math.cos(time * 0.27 + i) * dt * 0.07
        // 歩いて離れた分は、反対側へ回して使いまわす。部屋ごとに置かないのは、広いマップで点の数が増えて重くなるため
        if (Math.abs(motes[at] - pos.x) > 7) motes[at] += motes[at] > pos.x ? -14 : 14
        if (Math.abs(motes[at + 2] - pos.z) > 7) motes[at + 2] += motes[at + 2] > pos.z ? -14 : 14
        motes[at + 1] = clamp(motes[at + 1], 0.2, HEDGE - 0.3)
      }
      dustGeometry.attributes.position.needsUpdate = true

      // 一人称の視点。歩いている間は、目の高さと手もとを少しゆらして足どりを出す
      const walking = grounded && far > 0
      camera.position.set(pos.x, EYE + pos.y + (walking ? Math.sin(stride) * 0.035 : 0), pos.z)
      camera.rotation.set(pitch, yaw, 0, 'YXZ')
      const sway = walking ? Math.cos(stride * 0.5) * 0.014 : 0
      const dip = (walking ? -Math.abs(Math.sin(stride * 0.5)) * 0.02 : 0) + Math.sin(time * 1.6) * 0.004 - fall * 0.006
      // 縦に長い画面では、左右の手を内側へ寄せる。寄せないと、明かりも持ったものも画面の外に出て見えなくなる
      const narrow = Math.min(1, aspect / 1.3)
      // 何かに手が届く所で照準を合わせている間と、文字を打っている間は、明かりを下げる。下げないと、棚や表の右下が明かりの後ろに隠れる
      lowered += ((selector.visible || typing ? 1 : 0) - lowered) * ease(dt, 5)
      hand.position.set(HAND[0] * narrow + sway, HAND[1] + dip - lowered * 0.3, HAND[2])
      hand.rotation.z = Math.sin(time * 1.1) * 0.03 + (walking ? Math.sin(stride * 0.5) * 0.05 : 0)
      holder.position.set(-0.3 * narrow - sway, -0.2 + dip, -0.75)
      holder.scale.setScalar(0.55 + 0.45 * narrow)
      holder.rotation.y = Math.sin(time * 0.9) * 0.2
      holder.visible = !!held
      shine.scale.setScalar(0.42 + Math.sin(time * 8) * 0.02)
      if (playing) drawMap()
    },
    after(renderer) {
      if (!playing) return
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(hands, handCamera)
      renderer.autoClear = true
    },
    frame(ratio) {
      aspect = ratio
      // 縦に長い画面で画角を広げるのは、左右の壁と出入り口が見えず、どこにいるかが分かりにくくなるため
      camera.fov = ratio < 0.8 ? 92 : ratio < 1.4 ? 80 : 70
      handCamera.aspect = ratio
      handCamera.updateProjectionMatrix()
    },
    look(dx, dy) {
      if (!playing || paused || open || explaining) return
      if (Math.abs(dx) + Math.abs(dy) > 3) glide = null
      yaw -= dx * LOOK
      pitch = clamp(pitch - dy * LOOK, -1, 1)
    },
    tap(x, y, touch) {
      if (!playing || paused || open || explaining) return
      if (touch && locked()) {
        // マウスを閉じ込めたまま画面に触ったとき（タッチできるパソコン）は、止めずに固定だけを外して、次のタップから触った場所を押せるようにする
        quiet = true
        letGo()
        return
      }
      // マウスを閉じ込めている間は、カーソルではなく、画面の真ん中の照準が指しているものを押す
      const hit = use(locked() ? null : { x, y })
      if (!hit && !locked() && !touch) grab()
    },
    pointing(x, y) {
      pointer = { x, y }
      return !locked() && !!aimed && aimFar <= REACH && !!aimed.act()
    },
    key(code, down) {
      if (!playing || paused || explaining) return false
      if (open) {
        // ノートの入力欄で打った N は文字として残し、ノートを閉じるキーにはしない
        const closes = code === 'Escape' || (code === 'KeyN' && !document.activeElement?.matches('input, textarea'))
        if (closes && down) setOpen(false)
        return closes
      }
      if (typing) return false
      if (code === 'KeyE' || code === 'KeyN') {
        if (down && code === 'KeyE') use(locked() ? null : pointer)
        else if (down) setOpen(true)
        return true
      }
      if (code === 'Space') {
        if (down) jump = true
        return true
      }
      if (!(code in MOVES) && !(code in TURNS_BY_KEY) && !(code in NODS_BY_KEY)) return false
      if (down) keys.add(code)
      else keys.delete(code)
      return true
    },
    release: () => keys.clear(),
    stop() {
      watcher.disconnect()
      root.removeEventListener('click', onClick)
      root.removeEventListener('focusin', onFocus)
      root.removeEventListener('qg:wrong', onWrong)
      root.removeEventListener('input', onInput)
      root.removeEventListener('change', onInput)
      document.removeEventListener('pointerlockchange', onLock)
      typer?.removeEventListener('input', onType)
      typer?.removeEventListener('keydown', onTypeKey)
      typer?.removeEventListener('keyup', onInput)
      typer?.removeEventListener('blur', onTypeEnd)
      for (const type of STICK_EVENTS) removeEventListener(type, onStick)
      letGo()
      spots?.replaceChildren()
      root.removeAttribute('data-play')
      root.removeAttribute('data-qg-open')
      root.removeAttribute('data-qg-paused')
      dispose(hands)
      dustGeometry.dispose()
      for (const texture of textures) texture.dispose()
    },
  }
}

// ---------------------------------------------------------------- 結果: 動物と星と紙吹雪

function buildResult(host: HTMLElement, kinds: QuizKind[], kit: Kit): View {
  const scene = new Scene()
  lights(scene, kit)
  const camera = new PerspectiveCamera(FOV, 2, 0.1, 80)
  const passed = host.dataset.passed !== undefined
  const earned = Number(host.dataset.stars) || 0
  const step = 1.3
  const half = ((kinds.length - 1) / 2) * step

  const actors = kinds.map((kind, i) => {
    const actor = makeActor(kit, kind, 0.85)
    actor.island.position.x = i * step - half
    setMood(actor.mouth, passed)
    // 不合格のときにうつむかせるだけにするのは、泣く・怒るなどの強い表現だと、間違えた学生を責めているように受け取られるため
    if (!passed) actor.animal.rotation.x = 0.16
    scene.add(actor.island)
    return actor
  })
  const floor = passed ? kit.gold.clone().lerp(new Color(kit.dark ? '#2a2b30' : '#ffffff'), kit.dark ? 0.55 : 0.6) : kit.stone
  put(scene, kit, CYLINDER, floor, [0, -0.06, 0], [half + 1.3, 0.12, 1.25])
  put(scene, kit, CYLINDER, floor.clone().multiplyScalar(0.86), [0, -0.3, 0], [half + 1.1, 0.4, 1.05])

  const starForm = starGeometry(0.34)
  const gold = goldMaterial(kit)
  const empty = new MeshStandardMaterial({ color: kit.stone, transparent: true, opacity: 0.6, roughness: 0.8 })
  const stars = [0, 1, 2].map((i) => {
    const mesh = new Mesh(starForm, i < earned ? gold : empty)
    mesh.position.set((i - 1) * 0.95, i === 1 ? 2.75 : 2.55, 0)
    if (i < earned) mesh.scale.setScalar(0)
    scene.add(mesh)
    return mesh
  })

  const pieces = passed
    ? Array.from({ length: CONFETTI }, () => ({ at: new Vector3(), fall: 0, turn: new Vector3(), angle: new Vector3(), alive: false }))
    : []
  const confetti = new InstancedMesh(
    new BoxGeometry(0.09, 0.15, 0.02),
    new MeshStandardMaterial({ roughness: 0.7, side: DoubleSide }),
    CONFETTI,
  )
  const colors = [kit.gold, kit.red, ...kinds.map((kind) => kit.tones(kind).main)]
  const drop = (piece: (typeof pieces)[number], y: number) => {
    piece.at.set(random(-half - 1.6, half + 1.6), y, random(-1.2, 1.6))
    piece.fall = random(1.3, 2.6)
    piece.turn.set(random(-4, 4), random(-4, 4), random(-4, 4))
    piece.alive = true
  }
  pieces.forEach((piece, i) => {
    drop(piece, random(3.4, 8))
    confetti.setColorAt(i, colors[i % colors.length])
  })
  confetti.visible = passed
  scene.add(confetti)
  const slot = new Object3D()

  return {
    scene,
    camera,
    update(time, dt) {
      actors.forEach((actor, i) => moveActor(actor, passed ? (time / HOP + i * 0.14) % 1 : null, time, dt))
      stars.forEach((mesh, i) => {
        if (i >= earned) return
        // 星を 1 つずつ順に出すのは、いくつ取れたかを数えながら見られるようにするため
        const p = Math.min(1, Math.max(0, (time - 0.35 - i * 0.4) / 0.5))
        mesh.scale.setScalar(p < 0.7 ? (p / 0.7) * 1.3 : 1.3 - ((p - 0.7) / 0.3) * 0.3)
        mesh.rotation.y = (1 - p) * Math.PI * 2 + Math.sin(time * 1.5 + i) * 0.35
        mesh.position.y = (i === 1 ? 2.75 : 2.55) + Math.sin(time * 2 + i) * 0.05
      })
      pieces.forEach((piece, i) => {
        if (piece.alive) {
          piece.at.y -= piece.fall * dt
          piece.at.x += Math.sin(time * 2 + i) * dt * 0.3
          piece.angle.addScaledVector(piece.turn, dt)
          if (piece.at.y < -0.6) {
            if (time < CONFETTI_SECONDS) drop(piece, 3.6)
            else piece.alive = false
          }
        }
        slot.position.copy(piece.at)
        slot.rotation.set(piece.angle.x, piece.angle.y, piece.angle.z)
        slot.scale.setScalar(piece.alive ? 1 : 0)
        slot.updateMatrix()
        confetti.setMatrixAt(i, slot.matrix)
      })
      confetti.instanceMatrix.needsUpdate = true
    },
    frame(aspect) {
      // 距離を固定しないのは、スマホ幅で両端の動物が枠の外へはみ出すため
      const distance = Math.max(9.6, (half + 1.5) / (Math.tan((FOV * Math.PI) / 360) * aspect))
      camera.position.set(0, 2.3, distance)
      camera.lookAt(0, 1.3, 0)
      for (const actor of actors) actor.facing = Math.atan2(-actor.island.position.x, distance)
    },
  }
}

// ---------------------------------------------------------------- 描画

type World = { host: HTMLElement; destroy: () => void }
const worlds = new Set<World>()

function dispose(root: Object3D) {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    ;(node.geometry as BufferGeometry).dispose()
    for (const material of [node.material].flat() as Material[]) material.dispose()
  })
}

const isKind = (v: string): v is QuizKind => v in ANIMALS

function create(host: HTMLElement): World | null {
  const kinds = (host.dataset.kinds ?? '').split(',').filter(isKind)
  if (!kinds.length) return null
  // 世界を組み立てる前に作るのは、WebGL を使えない端末で、組み立てた世界と画面の見張りを残したまま失敗しないようにするため
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  const kit = readKit(host)
  const view = host.dataset.qgWorld === 'result' ? buildResult(host, kinds, kit) : buildGame(host, kinds, kit)
  if (!view) {
    renderer.dispose()
    return null
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  if (view.filmic) {
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
  }
  const canvas = renderer.domElement
  canvas.classList.add('qg-world-canvas')
  if (view.key) {
    canvas.tabIndex = 0
    canvas.setAttribute(
      'aria-label',
      'ゲームの画面。W A S D キーか矢印キーで歩き、スペースキーでジャンプ。部屋に置いてある玉やブロックに照準を合わせて、クリックか E キーで動かして答えます。Tab キーで、動かせるものを順に選べます。N キーで、問題を文字で読んで答えるノートが開きます',
    )
  } else canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)
  const { scene, camera } = view

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    view.frame(camera.aspect)
    camera.updateProjectionMatrix()
  }
  let time = 0
  let last = performance.now()
  const loop = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt
    view.update(time, dt)
    renderer.render(scene, camera)
    view.after?.(renderer)
  }
  const sizes = new ResizeObserver(resize)
  sizes.observe(host)
  // 見えていない間は止めるのは、ふりかえりを読んでいる間も描き続けて、電池を減らさないようにするため
  const seen = new IntersectionObserver(([entry]) => {
    last = performance.now()
    renderer.setAnimationLoop(entry.isIntersecting ? loop : null)
  })
  seen.observe(host)

  // 視点: マウスを画面に閉じ込めている間は、動かした分だけ回す。
  // 閉じ込めていないとき（タッチ端末や、Esc で外したあと）も見まわせるように、押したままなぞった分でも回す
  let drag: { id: number; x: number; y: number } | null = null
  /** 押してから離すまでに動かした量（px）。なぞったあとの click を、押したことにしないために使う */
  let dragged = 0
  /** 最後に押したのが指か。click からは分からないブラウザがあるので、pointerdown で覚える */
  let touch = false
  const locked = () => document.pointerLockElement === canvas
  canvas.addEventListener('pointermove', (e) => canvas.classList.toggle('is-pointing', !!view.pointing?.(e.clientX, e.clientY)))
  canvas.addEventListener('click', (e) => {
    if (dragged <= 8) view.tap?.(e.clientX, e.clientY, touch)
  })
  const onMouse = (e: MouseEvent) => {
    if (locked()) view.look?.(e.movementX, e.movementY)
  }
  const onDrag = (e: PointerEvent) => {
    if (e.type === 'pointerdown') {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
      dragged = 0
      touch = e.pointerType === 'touch'
    } else if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (e.type === 'pointermove' && !locked()) {
        dragged += Math.abs(dx) + Math.abs(dy)
        view.look?.(dx * 1.6, dy * 1.6)
      }
      drag = e.type === 'pointermove' ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null
    }
  }
  if (view.look) {
    document.addEventListener('mousemove', onMouse)
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) canvas.addEventListener(type, onDrag)
  }
  // キャンバスにフォーカスがあるときだけにしないのは、ゲームの途中でボタンを押したあとなどに、画面をクリックし直さないと歩けなくなるため。
  // 文字を打っている間とノートを開いている間は、view.key が Esc のほかを受け取らないので、入力欄のキー操作は奪わない
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const down = e.type === 'keydown'
    // ボタンにフォーカスがあるときの Enter とスペースは、そのボタンを押すために残す
    if (down && (e.code === 'Enter' || e.code === 'Space') && (e.target as Element).closest?.('button, a')) return
    if (view.key?.(e.code, down)) e.preventDefault()
  }
  const release = () => view.release?.()
  if (view.key) {
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    addEventListener('blur', release)
  }

  resize()
  loop()
  host.dataset.ready = ''
  const world: World = {
    host,
    destroy() {
      renderer.setAnimationLoop(null)
      sizes.disconnect()
      seen.disconnect()
      view.stop?.()
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKey)
      removeEventListener('blur', release)
      document.removeEventListener('mousemove', onMouse)
      dispose(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      delete host.dataset.ready
    },
  }
  // 「3D を使わずに答える」: 3D を片付けて、下の 2D のステージで答える形に切り替える。3D が重い端末や、マウスを使えない人のための逃げ道
  host.querySelector('[data-qg-flat]')?.addEventListener('click', () => {
    world.destroy()
    worlds.delete(world)
    host.dataset.flat = ''
  })
  return world
}

/** 再読み込みなしの遷移で画面から消えた 3D の世界を片付ける */
export function releaseDetachedQuizWorlds() {
  for (const world of worlds) {
    if (world.host.isConnected) continue
    world.destroy()
    worlds.delete(world)
  }
}

/** 小テストのゲームの見た目の枠（[data-qg-world]）に、3D の世界を描く。WebGL を使えなければ、枠の中の 2D の表示をそのまま残す */
export function mountQuizWorld(host: HTMLElement) {
  // data-flat は、3D を描けなかった枠と、学生が「3D を使わずに答える」を選んだ枠。どちらも、もう一度 3D にはしない
  if (still.matches || host.dataset.ready !== undefined || host.dataset.flat !== undefined) return
  try {
    const world = create(host)
    if (world) worlds.add(world)
  } catch {
    host.querySelector('.qg-world-canvas')?.remove()
    // 3D を描けないと分かったら、3D のために空けておいた高さを、2D の表示の分まで縮める（quiz-game.css）
    host.dataset.flat = ''
  }
}
