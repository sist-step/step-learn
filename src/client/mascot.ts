/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { $$, reducedMotion } from './dom'

// --- マスコットの気まぐれな動き（components/mascot.tsx の Mascot）
// CSS のくり返しだけで動かさないのは、同じ間隔で同じ動きが続くと機械的に見えるため
const MASCOT_QUIRKS = { hop: 900, 'lean-l': 1400, 'lean-r': 1400, squish: 700, peek: 1600, tap: 1300 } as const
const MASCOT_REACTIONS = { surprised: 900, happy: 1600, thinking: 1500 } as const
const MASCOT_GLANCES = ['left', 'right', 'up', 'down'] as const
const livingMascots = new WeakSet<HTMLElement>()

const randomIn = (min: number, max: number) => min + Math.random() * (max - min)
const pickFrom = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
const pickKey = <T extends object>(table: T) => pickFrom(Object.keys(table) as (keyof T)[])

function repeatRandomly(el: HTMLElement, min: number, max: number, act: () => number) {
  const tick = () => {
    if (!el.isConnected) return
    const busy = document.hidden ? 0 : act()
    setTimeout(tick, busy + randomIn(min, max))
  }
  setTimeout(tick, randomIn(min, max))
}

function flagFor(el: HTMLElement, name: string, value: string, ms: number) {
  el.setAttribute(name, value)
  setTimeout(() => el.removeAttribute(name), ms)
  return ms
}

function animateMascot(el: HTMLElement) {
  livingMascots.add(el)
  repeatRandomly(el, 1500, 5500, () => {
    flagFor(el, 'data-blink', '', 130)
    if (Math.random() < 0.25) setTimeout(() => flagFor(el, 'data-blink', '', 130), 280)
    return 450
  })
  repeatRandomly(el, 1200, 4000, () => flagFor(el, 'data-glance', pickFrom(MASCOT_GLANCES), randomIn(700, 2200)))
  // data-steady のあいだ気まぐれに動かさないのは、AI のパネルのマスコットが作業の様子を見せているときに、関係のない表情や動きが混ざるため
  repeatRandomly(el, 3500, 9000, () => {
    if (el.hasAttribute('data-steady')) return 0
    const quirk = pickKey(MASCOT_QUIRKS)
    return flagFor(el, 'data-quirk', quirk, MASCOT_QUIRKS[quirk])
  })
  repeatRandomly(el, 6000, 14_000, () => {
    const mood = el.dataset.mood
    const reaction = pickKey(MASCOT_REACTIONS)
    if (!mood || mood === reaction || mood === 'sleepy' || el.hasAttribute('data-steady')) return 0
    el.dataset.mood = reaction
    setTimeout(() => {
      if (el.dataset.mood === reaction && !el.hasAttribute('data-steady')) el.dataset.mood = mood
    }, MASCOT_REACTIONS[reaction])
    return MASCOT_REACTIONS[reaction]
  })
  typeMascotSay(el)
}

// 同じ速さで打ち続けないのは、句読点でも息継ぎしないと機械が読み上げているように見えるため
const MASCOT_PAUSES: Record<string, number> = { '、': 220, '，': 220, '。': 420, '！': 420, '？': 420, '!': 420, '?': 420, '…': 380 }

function splitIntoChars(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  return texts.flatMap((node) => {
    const chars = [...node.data].map((ch) => Object.assign(document.createElement('span'), { className: 'mascot-char', textContent: ch }))
    node.replaceWith(...chars)
    return chars
  })
}

function typeMascotSay(el: HTMLElement) {
  const text = el.querySelector<HTMLElement>('.mascot-say-text')
  if (!text || el.dataset.typing !== '') return
  // 1 文字ずつの span を読み上げさせないのは、スクリーンリーダーが 1 文字ずつ区切って読んでしまうため
  text.after(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: text.textContent }))
  text.setAttribute('aria-hidden', 'true')
  const chars = splitIntoChars(text)
  el.dataset.typing = 'on'
  el.setAttribute('data-hush', '')
  let next = 0
  const typeNext = () => {
    if (!el.isConnected) return
    const ch = chars[next++]
    if (!ch) {
      el.removeAttribute('data-typing')
      el.removeAttribute('data-hush')
      el.removeAttribute('data-talking')
      if (/[！!]$/.test(chars.at(-1)?.textContent ?? '')) flagFor(el, 'data-quirk', 'hop', MASCOT_QUIRKS.hop)
      return
    }
    ch.classList.add('is-shown')
    const pause = MASCOT_PAUSES[ch.textContent] ?? 0
    el.toggleAttribute('data-hush', pause > 0)
    setTimeout(typeNext, pause || randomIn(40, 90))
  }
  setTimeout(typeNext, 450)
}

export function initMascots() {
  const still = reducedMotion()
  $$<HTMLElement>('[data-mascot]')
    .filter((el) => !livingMascots.has(el))
    .forEach((el) => {
      if (!still) {
        animateMascot(el)
        return
      }
      el.removeAttribute('data-typing')
      el.removeAttribute('data-talking')
    })
}

// --- コースページを歩き回るマスコット（components/mascot.tsx の WalkingMascot）
// 立つ場所や壁に目印の属性を付けないのは、コースヘッダーのマークアップにまで歩き回りの都合を持ち込むことになるため
// セクションのカードだけにしないのは、Moodle のタイル形式では全体のセクションがないと、見えているカードが 1 枚もないため
// 遊び場の足場を 1 つのセレクターにまとめないのは、セレクターごとに最初に見つかった 1 つだけが足場になるため
const WALKER_GROUNDS = [
  '.course-hero-cover',
  '.section-card, .sec-tile',
  '.mascot-yard-block.is-floor',
  '.mascot-yard-block.is-shelf',
  '.mascot-yard-block.is-box',
]
const WALKER_WALLS = '.back-link, .course-hero-side > *, .course-tabs .tabs, .course-tabs-actions > *, .section-toggles > *'
const WALKER_GAP = 6
// 端まで歩かせないのは、足場の角が丸く、端では足の下に何もないように見えるため
const WALKER_EDGE = 20
const WALKER_SINK = 2
const WALKER_SIGHT = 120
const WALKER_PUSH_REACH = 600
const WALKER_GAITS = {
  walk: { speed: 46, step: '0.56s' },
  run: { speed: 125, step: '0.28s' },
  search: { speed: 26, step: '0.8s' },
} as const

type Box = { x: number; y: number; w: number; h: number }
type WalkerState = 'idle' | 'walk' | 'busy' | 'bump' | 'greet' | 'pet' | 'held' | 'drop' | 'pop' | 'crouch' | 'jump' | 'land' | 'pushed'
type Ground = { left: number; right: number; y: number }
type WalkerLook = Partial<Record<'mood' | 'pose' | 'motion' | 'look' | 'prop', string>>
type WalkerActivity = { weight: number; ms: [number, number]; look: WalkerLook; sit?: boolean; cheer?: boolean }
const WALKER_ACTIVITIES: WalkerActivity[] = [
  { weight: 5, ms: [7000, 12_000], sit: true, cheer: true, look: { pose: 'type', motion: 'swing', look: 'down', prop: 'laptop' } },
  { weight: 3, ms: [6000, 10_000], sit: true, look: { pose: 'hold', motion: 'swing', look: 'down', prop: 'book' } },
  { weight: 3, ms: [6000, 9000], sit: true, look: { mood: 'happy', pose: 'sip', motion: 'swing', prop: 'mug' } },
  { weight: 2, ms: [4000, 7000], sit: true, look: { motion: 'swing' } },
  { weight: 2, ms: [2500, 4000], look: { mood: 'happy', pose: 'cheer', motion: 'wiggle', prop: 'notes' } },
  { weight: 2, ms: [5000, 9000], look: { mood: 'sleepy' } },
  { weight: 2, ms: [1800, 3000], look: { mood: 'thinking', motion: 'tilt', look: 'up' } },
  { weight: 4, ms: [1200, 3200], look: {} },
]
type Walker = {
  el: HTMLElement
  mascot: HTMLElement
  box: Box
  grounds: (Ground | null)[]
  level: number
  walls: Box[]
  jump: { fromX: number; fromY: number; to: Box; level: number; start: number; ms: number; arc: number } | null
  state: WalkerState
  until: number
  target: number | null
  speed: number
  greetedAt: number
  measuredAt: number
  grab: { dx: number; dy: number; startX: number; startY: number; moved: boolean } | null
  cheerAfter: boolean
}

const walkerOf = new WeakMap<HTMLElement, Walker>()
let walkerPointer: { x: number; y: number; mouse: boolean } | null = null
let heldWalker: Walker | null = null
let walkerResizedAt = -Infinity

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
const lookToward = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'front')

// 画面上の座標をそのまま使わないのは、スクロールのたびに壁とマスコットの位置を測り直すことになるため
function walkerOrigin(el: HTMLElement) {
  const parent = el.offsetParent
  if (parent && parent !== document.body) {
    const r = parent.getBoundingClientRect()
    return { x: r.left, y: r.top }
  }
  return { x: -scrollX, y: -scrollY }
}

function measureWalker(w: Walker, now: number) {
  w.measuredAt = now
  const main = w.el.closest('main')
  if (!main) return
  const o = walkerOrigin(w.el)
  const rectOf = (el: HTMLElement) => el.getBoundingClientRect()
  w.grounds = WALKER_GROUNDS.map((selector) => {
    const r = $$<HTMLElement>(selector, main)
      .map(rectOf)
      .find((rect) => rect.width > 0 && rect.height > 0)
    return r ? { left: r.left - o.x + WALKER_EDGE, right: r.right - o.x - WALKER_EDGE, y: r.top - o.y - w.box.h + WALKER_SINK } : null
  })
  w.walls = $$<HTMLElement>(WALKER_WALLS, main)
    .map(rectOf)
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left - o.x - WALKER_GAP, y: r.top - o.y - WALKER_GAP, w: r.width + WALKER_GAP * 2, h: r.height + WALKER_GAP * 2 }))
}

const standAt = (w: Walker, level: number, x: number): Box => ({ x, y: w.grounds[level]?.y ?? NaN, w: w.box.w, h: w.box.h })

function levelOf(w: Walker, box: Box) {
  return w.grounds.findIndex((g) => !!g && box.y === g.y && box.x >= g.left && box.x + box.w <= g.right)
}

const isFree = (w: Walker, box: Box) => levelOf(w, box) >= 0 && !w.walls.some((wall) => overlaps(box, wall))

function visibleArea(w: Walker): Box {
  const o = walkerOrigin(w.el)
  const top = cssPx('--topbar-h')
  return { x: -o.x, y: top - o.y, w: innerWidth, h: innerHeight - top }
}

function freeSpots(w: Walker, area: Box) {
  return w.grounds.flatMap((g, level) => {
    const spots: Box[] = []
    for (let x = g?.left ?? 0; g && x + w.box.w <= g.right; x += 12) {
      const box = standAt(w, level, x)
      if (isFree(w, box) && overlaps(box, area)) spots.push(box)
    }
    return spots
  })
}

function nearestFree(w: Walker, level: number, maxDistance: number, fromX = w.box.x) {
  const g = w.grounds[level]
  if (!g) return null
  const from = Math.min(Math.max(fromX, g.left), g.right - w.box.w)
  for (let d = 0; d <= maxDistance; d += 6) {
    for (const x of [from - d, from + d]) {
      const box = standAt(w, level, x)
      if (isFree(w, box)) return box
    }
  }
  return null
}

// 真上の足場より真下の足場を選びやすくするのは、離したときに上へ吸い寄せられると落ちたように見えないため
function landingSpot(w: Walker) {
  const scored = w.grounds.flatMap((_, level) => {
    const spot = nearestFree(w, level, 400)
    if (!spot) return []
    const dy = spot.y - w.box.y
    return [{ spot, level, score: Math.abs(spot.x - w.box.x) + Math.abs(dy) * (dy < 0 ? 3 : 1) }]
  })
  return scored.sort((a, b) => a.score - b.score)[0] ?? null
}

function placeWalker(w: Walker, x: number, y: number) {
  w.box.x = x
  w.box.y = y
  w.el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
}

function dressWalker(w: Walker, look: WalkerLook, sit = false) {
  Object.assign(w.mascot.dataset, { mood: 'normal', pose: 'idle', motion: 'float', look: 'front', prop: 'none', ...look })
  w.el.toggleAttribute('data-sitting', sit)
}

function setWalkerState(w: Walker, state: WalkerState, now: number, ms: number) {
  w.state = state
  w.until = now + ms
  w.el.dataset.state = state
  if (state !== 'walk') delete w.el.dataset.heading
  if (state !== 'pushed') delete w.el.dataset.pushed
}

function spawnWalker(w: Walker, now: number) {
  const spots = freeSpots(w, visibleArea(w))
  if (spots.length === 0) {
    delete w.el.dataset.shown
    return false
  }
  const spot = pickFrom(spots)
  placeWalker(w, spot.x, spot.y)
  w.level = levelOf(w, spot)
  w.el.dataset.shown = ''
  w.target = null
  dressWalker(w, { mood: 'happy', pose: 'greet' })
  setWalkerState(w, 'pop', now, 1600)
  return true
}

function pickWalkTarget(w: Walker, direction?: -1 | 1) {
  const g = w.grounds[w.level]
  if (!g) return null
  for (let i = 0; i < 20; i++) {
    const x = Math.min(Math.max(w.box.x + (direction ?? pickFrom([-1, 1])) * randomIn(60, 400), g.left), g.right - w.box.w)
    const box = standAt(w, w.level, x)
    if (Math.abs(x - w.box.x) > 30 && isFree(w, box)) return x
  }
  return null
}

function startJump(w: Walker, now: number) {
  const levels = w.grounds.flatMap((g, level) => (g && level !== w.level ? [level] : []))
  if (levels.length === 0) return false
  const level = pickFrom(levels)
  const to = nearestFree(w, level, 260, w.box.x + randomIn(-120, 120))
  // 見えていない足場へ跳ばせないのは、画面の外へ消えていなくなったように見えるため
  if (!to || !overlaps(to, visibleArea(w))) return false
  const dy = to.y - w.box.y
  w.jump = { fromX: w.box.x, fromY: w.box.y, to, level, start: 0, ms: Math.min(1100, 520 + Math.abs(dy) * 0.9), arc: Math.abs(dy) / 4 + 36 }
  dressWalker(w, { mood: dy < 0 ? 'happy' : 'surprised', motion: 'none', look: dy < 0 ? 'up' : 'down' })
  setWalkerState(w, 'crouch', now, 280)
  return true
}

function flyWalker(w: Walker, now: number) {
  const jump = w.jump
  if (!jump) return startWalking(w, now)
  if (w.state === 'crouch') {
    const up = jump.to.y < jump.fromY
    dressWalker(w, { mood: up ? 'happy' : 'surprised', pose: up ? 'cheer' : 'open', motion: 'none', look: up ? 'up' : 'down' })
    setWalkerState(w, 'jump', now, jump.ms)
    jump.start = now
    w.el.toggleAttribute('data-spin', up && Math.random() < 0.5)
    if (Math.abs(jump.to.x - jump.fromX) > 8) w.el.dataset.heading = jump.to.x < jump.fromX ? 'left' : 'right'
    return
  }
  const t = Math.min(1, (now - jump.start) / jump.ms)
  if (t < 1) {
    placeWalker(w, jump.fromX + (jump.to.x - jump.fromX) * t, jump.fromY + (jump.to.y - jump.fromY) * t - jump.arc * 4 * t * (1 - t))
    return
  }
  placeWalker(w, jump.to.x, jump.to.y)
  w.level = jump.level
  w.jump = null
  w.el.removeAttribute('data-spin')
  dressWalker(w, { mood: 'happy', motion: 'none' })
  setWalkerState(w, 'land', now, 600)
}

function moveOn(w: Walker, now: number) {
  if (Math.random() < 0.45 && startJump(w, now)) return
  startWalking(w, now)
}

function startWalking(w: Walker, now: number) {
  // 左へ歩くときに虫めがねを持たせないのは、虫めがねを持つ右手を右にしか向けられないため
  const searchTarget = Math.random() < 0.2 ? pickWalkTarget(w, 1) : null
  const target = searchTarget ?? pickWalkTarget(w)
  if (target === null) return idleWalker(w, now)
  const gait = searchTarget !== null ? WALKER_GAITS.search : Math.random() < 0.15 ? WALKER_GAITS.run : WALKER_GAITS.walk
  w.target = target
  w.speed = gait.speed
  w.mascot.style.setProperty('--mascot-step', gait.step)
  if (gait === WALKER_GAITS.search) dressWalker(w, { pose: 'point', motion: 'walk', prop: 'magnifier' })
  else dressWalker(w, { mood: gait === WALKER_GAITS.run ? 'happy' : 'normal', motion: 'walk' })
  setWalkerState(w, 'walk', now, 20_000)
}

function pickActivity() {
  let roll = Math.random() * WALKER_ACTIVITIES.reduce((sum, a) => sum + a.weight, 0)
  return WALKER_ACTIVITIES.find((a) => (roll -= a.weight) < 0) ?? WALKER_ACTIVITIES[0]
}

function idleWalker(w: Walker, now: number) {
  const activity = pickActivity()
  dressWalker(w, activity.look, activity.sit)
  w.cheerAfter = !!activity.cheer
  setWalkerState(w, 'busy', now, randomIn(...activity.ms))
}

function cheerWalker(w: Walker, now: number) {
  w.cheerAfter = false
  dressWalker(w, { mood: 'happy', pose: 'cheer', motion: 'hop' })
  setWalkerState(w, 'pet', now, 1300)
}

function stepWalker(w: Walker, dt: number, now: number) {
  if (w.target === null) return idleWalker(w, now)
  const dx = w.target - w.box.x
  if (Math.abs(dx) < 2) {
    w.target = null
    return idleWalker(w, now)
  }
  const step = Math.min(Math.abs(dx), w.speed * dt)
  const box = standAt(w, w.level, w.box.x + Math.sign(dx) * step)
  const heading = dx < 0 ? 'left' : 'right'
  w.el.dataset.heading = heading
  w.mascot.dataset.look = heading
  if (isFree(w, box)) {
    placeWalker(w, box.x, box.y)
    return
  }
  w.target = null
  dressWalker(w, { mood: 'surprised', motion: 'none', look: heading })
  setWalkerState(w, 'bump', now, randomIn(700, 1100))
}

function pointerNearWalker(w: Walker) {
  if (!walkerPointer?.mouse) return null
  const o = walkerOrigin(w.el)
  const dx = walkerPointer.x - o.x - (w.box.x + w.box.w / 2)
  const dy = walkerPointer.y - o.y - (w.box.y + w.box.h / 2)
  return Math.hypot(dx, dy) < WALKER_SIGHT ? { dx, dy } : null
}

function petWalker(w: Walker, now: number) {
  dressWalker(w, { mood: 'happy', pose: 'cheer', motion: 'hop' })
  setWalkerState(w, 'pet', now, 1500)
  const heart = w.el.querySelector<HTMLElement>('.mascot-walker-heart')
  if (!heart) return
  for (let i = 0; i < 3; i++) {
    const copy = heart.cloneNode(true) as HTMLElement
    copy.hidden = false
    copy.style.setProperty('--heart-x', `${randomIn(-110, 10)}%`)
    copy.style.setProperty('--heart-drift', `${randomIn(-14, 14)}px`)
    copy.style.animationDelay = `${i * 0.18}s`
    copy.addEventListener('animationend', () => copy.remove())
    w.el.append(copy)
  }
}

// 近くの空いている場所へ移すだけにしないのは、迫ってきた壁の向こう側へすり抜けて瞬間移動したように見えるため
function pushedSpot(w: Walker): { box: Box; from: -1 | 0 | 1 } | null {
  const g = w.grounds[w.level]
  if (!g || w.state === 'drop') return null
  const box = standAt(w, w.level, w.box.x)
  if (isFree(w, box)) return { box, from: 0 }
  const wall = w.walls.find((wall) => overlaps(box, wall))
  const fromLeft = box.x + box.w > g.right ? false : box.x < g.left || (!!wall && wall.x + wall.w / 2 < box.x + box.w / 2)
  const from = fromLeft ? -1 : 1
  const start = Math.min(Math.max(box.x, g.left), g.right - box.w)
  for (let d = 0; d <= WALKER_PUSH_REACH; d += 2) {
    const spot = standAt(w, w.level, start - from * d)
    if (isFree(w, spot)) return { box: spot, from }
  }
  return null
}

function pushWalker(w: Walker, from: -1 | 1, now: number) {
  const side = from < 0 ? 'left' : 'right'
  w.target = null
  w.cheerAfter = false
  if (w.state !== 'pushed') dressWalker(w, { mood: 'surprised', pose: 'open', motion: 'none', look: side })
  setWalkerState(w, 'pushed', now, 900)
  w.el.dataset.pushed = side
}

function settleWalker(w: Walker, now: number) {
  measureWalker(w, now)
  if (w.el.dataset.shown === undefined) return spawnWalker(w, now)
  const level = levelOf(w, w.box)
  if (level >= 0 && isFree(w, w.box)) {
    w.level = level
    return true
  }
  const pushed = pushedSpot(w)
  if (pushed) {
    placeWalker(w, pushed.box.x, pushed.box.y)
    if (pushed.from !== 0) pushWalker(w, pushed.from, now)
    return true
  }
  const landing = landingSpot(w)
  if (!landing) return spawnWalker(w, now)
  placeWalker(w, landing.spot.x, landing.spot.y)
  w.level = landing.level
  w.target = null
  return true
}

function tickWalker(w: Walker, dt: number, now: number) {
  if (w.state === 'held') {
    if (now > w.until && w.mascot.dataset.mood === 'surprised') w.mascot.dataset.mood = 'happy'
    return
  }
  if (w.state === 'crouch' || w.state === 'jump') {
    if (w.state === 'jump' || now >= w.until) flyWalker(w, now)
    return
  }
  const resizing = now - walkerResizedAt < 400
  if ((resizing || now - w.measuredAt > 400) && !settleWalker(w, now)) return

  const near = pointerNearWalker(w)
  if (near && (w.state === 'walk' || w.state === 'busy') && now - w.greetedAt > 6000) {
    w.target = null
    w.greetedAt = now
    w.cheerAfter = false
    const wasSleeping = w.mascot.dataset.mood === 'sleepy'
    dressWalker(w, { mood: wasSleeping ? 'surprised' : 'happy', pose: 'wave', look: lookToward(near.dx, near.dy) })
    setWalkerState(w, 'greet', now, 1800)
  }
  if (w.state === 'greet' && near) {
    w.until = Math.max(w.until, now + 900)
    w.mascot.dataset.look = lookToward(near.dx, near.dy)
    if (now - w.greetedAt > 700) w.mascot.dataset.mood = 'happy'
  }

  if (w.state === 'walk') stepWalker(w, dt, now)
  if (now < w.until) return
  if (w.state === 'busy' && w.cheerAfter) cheerWalker(w, now)
  else if (w.state === 'busy' && Math.random() < 0.25) idleWalker(w, now)
  else moveOn(w, now)
}

function runWalker(w: Walker) {
  let last = performance.now()
  const frame = (now: number) => {
    if (!w.el.isConnected) {
      if (heldWalker === w) heldWalker = null
      return
    }
    tickWalker(w, Math.min((now - last) / 1000, 0.05), now)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

export function initWalkers() {
  const still = reducedMotion()
  $$<HTMLElement>('[data-mascot-walker]')
    .filter((el) => !walkerOf.has(el))
    .forEach((el) => {
      const mascot = el.querySelector<HTMLElement>('[data-mascot]')
      if (!mascot) return
      el.hidden = false
      const { width, height } = el.getBoundingClientRect()
      const w: Walker = {
        el,
        mascot,
        box: { x: 0, y: 0, w: width, h: height },
        grounds: [],
        level: 0,
        walls: [],
        jump: null,
        state: 'idle',
        until: 0,
        target: null,
        speed: 0,
        greetedAt: 0,
        measuredAt: 0,
        grab: null,
        cheerAfter: false,
      }
      walkerOf.set(el, w)
      const now = performance.now()
      settleWalker(w, now)
      if (!still) return runWalker(w)
      dressWalker(w, { motion: 'none' })
      setWalkerState(w, 'idle', now, Infinity)
    })
}

document.addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-mascot-walker]')
  const w = el && walkerOf.get(el)
  if (!w || e.button !== 0) return
  // 既定の動作に任せないのは、ドラッグで文字が選ばれたり、タッチで画面がスクロールしたりするため
  e.preventDefault()
  const o = walkerOrigin(w.el)
  w.grab = { dx: e.clientX - o.x - w.box.x, dy: e.clientY - o.y - w.box.y, startX: e.clientX, startY: e.clientY, moved: false }
  heldWalker = w
})

document.addEventListener('pointermove', (e) => {
  walkerPointer = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' }
  const w = heldWalker
  if (!w?.grab) return
  if (!w.grab.moved) {
    if (Math.hypot(e.clientX - w.grab.startX, e.clientY - w.grab.startY) < 6) return
    w.grab.moved = true
    w.target = null
    w.jump = null
    w.el.removeAttribute('data-spin')
    dressWalker(w, { mood: 'surprised', pose: 'open', motion: 'none' })
    setWalkerState(w, 'held', performance.now(), 600)
  }
  const o = walkerOrigin(w.el)
  placeWalker(w, e.clientX - o.x - w.grab.dx, e.clientY - o.y - w.grab.dy)
})

document.addEventListener('pointerout', (e) => {
  if (!e.relatedTarget) walkerPointer = null
})

// 縮めている間は毎フレーム測り直すのは、いつもの間隔では壁がめり込んでから飛びのいたように見えるため
addEventListener('resize', () => (walkerResizedAt = performance.now()))

function releaseWalker(e: PointerEvent) {
  const w = heldWalker
  heldWalker = null
  if (!w?.grab) return
  const { moved } = w.grab
  w.grab = null
  const now = performance.now()
  if (!moved) {
    if (e.type === 'pointerup' && w.state !== 'crouch' && w.state !== 'jump') petWalker(w, now)
    return
  }
  w.greetedAt = now
  dressWalker(w, { mood: 'happy', motion: 'none' })
  setWalkerState(w, 'drop', now, 800)
  settleWalker(w, now)
}
document.addEventListener('pointerup', releaseWalker)
document.addEventListener('pointercancel', releaseWalker)
