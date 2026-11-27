/// <reference lib="dom" />
// テーマ「かわいい」の動き。features/theme/client.ts が、このテーマを選んだときだけ読み込む

import type { ThemeScript } from '../theme'
import { reducedMotion } from '../../../client/dom'

const COLORS = ['--cute-spark-1', '--cute-spark-2', '--cute-spark-3', '--cute-spark-4'] as const
const SHAPES = ['star', 'sparkle', 'dot'] as const
const PRESSABLE = 'a[href], button:not(:disabled), summary, label, [role="button"], .btn'
const STARS = 14
const SPARKS = 9

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]
const color = () => `var(${pick(COLORS)})`

// 本文（body）ではなく <html> の直下に置くのは、再読み込みなしの遷移で body ごと差し替わっても、弾けている途中で消えないようにするため
let sparks: HTMLElement | null = null

function burst(e: PointerEvent) {
  if (e.button !== 0 || reducedMotion() || !(e.target instanceof Element) || !e.target.closest(PRESSABLE)) return
  if (!sparks?.isConnected) {
    sparks = document.createElement('div')
    sparks.className = 'cute-sparks'
    sparks.setAttribute('aria-hidden', 'true')
    document.documentElement.append(sparks)
  }
  for (let i = 0; i < SPARKS; i++) {
    const angle = (Math.PI * 2 * i) / SPARKS + Math.random() * 0.5
    const distance = 28 + Math.random() * 34
    const spark = document.createElement('span')
    spark.className = `cute-spark cute-spark-${pick(SHAPES)}`
    spark.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;--size:${6 + Math.random() * 8}px;--c:${color()};--dx:${Math.cos(angle) * distance}px;--dy:${Math.sin(angle) * distance}px;--rot:${Math.random() * 360 - 180}deg`
    spark.addEventListener('animationend', () => spark.remove(), { once: true })
    sparks.append(spark)
  }
}

function sprinkleStars() {
  const app = document.querySelector('.app')
  if (!app || app.querySelector(':scope > .cute-sky')) return
  const sky = document.createElement('div')
  sky.className = 'cute-sky'
  sky.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < STARS; i++) {
    const star = document.createElement('span')
    star.className = 'cute-star'
    star.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;--size:${8 + Math.random() * 12}px;--c:${color()};--dur:${3 + Math.random() * 3}s;--delay:${-Math.random() * 6}s`
    sky.append(star)
  }
  app.prepend(sky)
}

const script: ThemeScript = {
  start() {
    document.addEventListener('pointerdown', burst)
  },
  stop() {
    document.removeEventListener('pointerdown', burst)
    sparks?.remove()
    sparks = null
    document.querySelectorAll('.cute-sky').forEach((el) => el.remove())
  },
  page: sprinkleStars,
}

export default script
