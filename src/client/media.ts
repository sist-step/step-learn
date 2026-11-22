/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 動画のプレイヤーと画像のビューアー（components/media.tsx）。client.ts が読み込む

import { getSetting, setSetting } from '../lib/settings'
import { $$, reducedMotion } from './dom'

// ---------------------------------------------------------------- 動画のプレイヤー

const IDLE_AFTER = 2_500
const SKIP_SECONDS = 10
const STEP_SECONDS = 5

type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

const playerOf = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>('[data-video-player]') : null)
const videoOf = (player: HTMLElement) => player.querySelector<HTMLVideoElement>('video')!

function formatTime(seconds: number) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function spokenTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h > 0 ? `${h} 時間 ` : ''}${m} 分 ${s % 60} 秒`
}

const percent = (value: number, total: number) => `${total > 0 ? Math.min(100, (value / total) * 100) : 0}%`

const seeking = new WeakSet<HTMLInputElement>()

function syncTime(player: HTMLElement) {
  const video = videoOf(player)
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  const seek = player.querySelector<HTMLInputElement>('[data-video-seek]')!
  seek.max = String(duration)
  if (!seeking.has(seek)) seek.value = String(video.currentTime)
  seek.style.setProperty('--done', percent(Number(seek.value), duration))
  seek.setAttribute('aria-valuetext', `${spokenTime(Number(seek.value))} / ${spokenTime(duration)}`)
  player.querySelector('[data-video-current]')!.textContent = formatTime(Number(seek.value))
  player.querySelector('[data-video-duration]')!.textContent = formatTime(duration)
  syncBuffered(player)
}

function syncBuffered(player: HTMLElement) {
  const video = videoOf(player)
  const { buffered, currentTime, duration } = video
  let end = 0
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.5) end = Math.max(end, buffered.end(i))
  }
  player.querySelector<HTMLElement>('[data-video-seek]')!.style.setProperty('--buffered', percent(end, duration))
}

function syncVolume(player: HTMLElement) {
  const video = videoOf(player)
  const level = video.muted ? 0 : video.volume
  const range = player.querySelector<HTMLInputElement>('[data-video-volume]')!
  range.value = String(level)
  range.style.setProperty('--done', `${level * 100}%`)
  range.setAttribute('aria-valuetext', `${Math.round(level * 100)}%`)
  player.toggleAttribute('data-muted', level === 0)
}

function syncRate(player: HTMLElement) {
  const rate = videoOf(player).playbackRate
  player.querySelector('[data-video-rate-label]')!.textContent = `${rate}x`
  $$<HTMLElement>('[data-video-rate]', player).forEach((el) =>
    el.setAttribute('aria-checked', String(Number(el.dataset.videoRate) === rate)),
  )
}

function syncPlaying(player: HTMLElement) {
  const video = videoOf(player)
  player.toggleAttribute('data-playing', !video.paused)
  if (video.paused) wake(player)
  else scheduleIdle(player)
}

const idleTimers = new WeakMap<HTMLElement, number>()

function wake(player: HTMLElement) {
  player.removeAttribute('data-idle')
  scheduleIdle(player)
}

function scheduleIdle(player: HTMLElement) {
  clearTimeout(idleTimers.get(player))
  idleTimers.set(
    player,
    window.setTimeout(() => {
      const video = videoOf(player)
      // キーボードで操作の帯を選んでいるときに隠さないのは、選んでいるボタンが見えなくなるため
      const active = document.activeElement
      const focusedInBar = !!active?.closest('.video-player-controls') && player.contains(active) && active.matches(':focus-visible')
      if (!video.paused && !focusedInBar && !player.querySelector('details[open]')) player.setAttribute('data-idle', '')
    }, IDLE_AFTER),
  )
}

const osdTimers = new WeakMap<HTMLElement, number>()

function showOsd(player: HTMLElement, text: string) {
  const osd = player.querySelector<HTMLElement>('[data-video-osd]')!
  osd.textContent = text
  osd.setAttribute('data-show', '')
  clearTimeout(osdTimers.get(player))
  osdTimers.set(
    player,
    window.setTimeout(() => osd.removeAttribute('data-show'), 900),
  )
}

function togglePlay(player: HTMLElement) {
  const video = videoOf(player)
  if (video.paused) void video.play().catch(() => {})
  else video.pause()
}

function skip(player: HTMLElement, seconds: number) {
  const video = videoOf(player)
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  video.currentTime = Math.min(duration, Math.max(0, video.currentTime + seconds))
  showOsd(player, `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} 秒`)
  syncTime(player)
}

function setVolume(player: HTMLElement, level: number) {
  const video = videoOf(player)
  video.volume = Math.min(1, Math.max(0, level))
  video.muted = video.volume === 0
}

function toggleMute(player: HTMLElement) {
  const video = videoOf(player)
  if (video.muted || video.volume === 0) {
    if (video.volume === 0) video.volume = 0.5
    video.muted = false
  } else {
    video.muted = true
  }
}

function toggleFullscreen(player: HTMLElement) {
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {})
  if (document.fullscreenEnabled) return void player.requestFullscreen().catch(() => {})
  // iPhone の Safari は要素の全画面に対応せず、動画だけを OS のプレイヤーで全画面にできる
  ;(videoOf(player) as IosVideo).webkitEnterFullscreen?.()
}

function togglePip(player: HTMLElement) {
  const video = videoOf(player)
  if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {})
  else void video.requestPictureInPicture().catch(() => {})
}

const VIDEO_ACTIONS: Record<string, (player: HTMLElement) => void> = {
  play: (player) => togglePlay(player),
  pause: (player) => videoOf(player).pause(),
  back: (player) => skip(player, -SKIP_SECONDS),
  forward: (player) => skip(player, SKIP_SECONDS),
  mute: toggleMute,
  unmute: toggleMute,
  fullscreen: toggleFullscreen,
  'exit-fullscreen': toggleFullscreen,
  pip: togglePip,
}

// 前の操作の pointerType を覚えるのは、Safari の click が PointerEvent ではなく、タッチかどうかを click から読めないため
let lastPointer = 'mouse'
document.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true)

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const player = playerOf(target)
  if (!player) return
  const action = target.closest<HTMLElement>('[data-video-action]')?.dataset.videoAction
  if (action) {
    VIDEO_ACTIONS[action]?.(player)
    return wake(player)
  }
  const rate = target.closest<HTMLElement>('[data-video-rate]')?.dataset.videoRate
  if (rate) {
    const video = videoOf(player)
    video.playbackRate = video.defaultPlaybackRate = Number(rate)
    setSetting('mediaRate', Number(rate))
    showOsd(player, `${rate}x`)
    target.closest('details')?.removeAttribute('open')
    // 閉じたメニューの中にフォーカスを残さないのは、フォーカスが外れてキー操作が効かなくなるため
    player.querySelector<HTMLElement>('.video-player-rate-label')?.focus({ preventScroll: true })
    return wake(player)
  }
  if (!target.matches('video')) return
  // タッチで隠れた操作の帯をたたいたときに止めないのは、帯を出したいだけの人の再生が止まってしまうため
  if (lastPointer === 'touch' && player.hasAttribute('data-idle')) return wake(player)
  togglePlay(player)
  wake(player)
})

document.addEventListener('dblclick', (e) => {
  const target = e.target as Element
  if (target.matches('[data-video-player] video')) toggleFullscreen(playerOf(target)!)
})

document.addEventListener('pointermove', (e) => {
  const player = playerOf(e.target)
  if (player && e.pointerType === 'mouse') wake(player)
})
document.addEventListener('pointerout', (e) => {
  const player = playerOf(e.target)
  if (!player || player.contains(e.relatedTarget as Node | null)) return
  if (!videoOf(player).paused && !player.querySelector('details[open]')) player.setAttribute('data-idle', '')
})
document.addEventListener('focusin', (e) => {
  const player = playerOf(e.target)
  if (player) wake(player)
})

document.addEventListener('input', (e) => {
  const input = e.target
  if (!(input instanceof HTMLInputElement)) return
  const player = playerOf(input)
  if (!player) return
  if (input.matches('[data-video-seek]')) {
    videoOf(player).currentTime = Number(input.value)
    syncTime(player)
  } else if (input.matches('[data-video-volume]')) {
    setVolume(player, Number(input.value))
  }
})

// つまみを動かしている間、再生位置で値を書き戻さない（書き戻すと、つかんでいるつまみが再生位置へ跳ね返るため）
document.addEventListener('pointerdown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.matches('[data-video-seek]')) seeking.add(e.target)
})
document.addEventListener('pointerup', () => $$<HTMLInputElement>('[data-video-seek]').forEach((el) => seeking.delete(el)))
document.addEventListener('pointercancel', () => $$<HTMLInputElement>('[data-video-seek]').forEach((el) => seeking.delete(el)))

document.addEventListener('pointermove', (e) => {
  const area = (e.target as Element).closest<HTMLElement>('[data-video-seek-area]')
  const player = playerOf(area)
  if (!area || !player) return
  const duration = videoOf(player).duration
  const tip = area.querySelector<HTMLElement>('[data-video-tip]')!
  if (!Number.isFinite(duration) || duration <= 0) return
  const rect = area.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  tip.textContent = formatTime(ratio * duration)
  const half = tip.offsetWidth / 2
  tip.style.setProperty('--tip-x', `${Math.min(rect.width - half, Math.max(half, ratio * rect.width))}px`)
  tip.hidden = false
})
document.addEventListener('pointerout', (e) => {
  const area = (e.target as Element).closest<HTMLElement>('[data-video-seek-area]')
  if (area && !area.contains(e.relatedTarget as Node | null)) area.querySelector<HTMLElement>('[data-video-tip]')!.hidden = true
})

const isTyping = (el: Element) => el.matches('input:not([type=range]), textarea, select, [contenteditable]')

document.addEventListener('keydown', (e) => {
  const target = e.target as Element
  const player = playerOf(target)
  if (!player || e.metaKey || e.ctrlKey || e.altKey || isTyping(target) || target.closest('details[open]')) return
  const onButton = !!target.closest('button, summary, a')
  const video = videoOf(player)
  const onVolume = target.matches('[data-video-volume]')
  const handled = (() => {
    switch (e.key) {
      case ' ':
        if (onButton) return false
        togglePlay(player)
        return true
      case 'k':
        togglePlay(player)
        return true
      case 'j':
        skip(player, -SKIP_SECONDS)
        return true
      case 'l':
        skip(player, SKIP_SECONDS)
        return true
      case 'ArrowLeft':
        if (onVolume) return false
        skip(player, -STEP_SECONDS)
        return true
      case 'ArrowRight':
        if (onVolume) return false
        skip(player, STEP_SECONDS)
        return true
      case 'ArrowUp':
      case 'ArrowDown':
        if (onVolume) return false
        setVolume(player, (video.muted ? 0 : video.volume) + (e.key === 'ArrowUp' ? 0.1 : -0.1))
        showOsd(player, `音量 ${Math.round(video.volume * 100)}%`)
        return true
      case 'm':
        toggleMute(player)
        return true
      case 'f':
        toggleFullscreen(player)
        return true
      default:
        if (!/^[0-9]$/.test(e.key) || !Number.isFinite(video.duration)) return false
        video.currentTime = (video.duration * Number(e.key)) / 10
        return true
    }
  })()
  if (!handled) return
  e.preventDefault()
  wake(player)
})

const MEDIA_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked'] as const
// メディアのイベントは伝わってこないので、捕捉の段階で拾う
MEDIA_EVENTS.forEach((type) =>
  document.addEventListener(
    type,
    (e) => {
      const player = playerOf(e.target)
      if (!player) return
      if (type === 'loadedmetadata') syncRatio(player)
      syncTime(player)
    },
    true,
  ),
)
;(['play', 'pause', 'ended'] as const).forEach((type) =>
  document.addEventListener(
    type,
    (e) => {
      const player = playerOf(e.target)
      if (player) syncPlaying(player)
    },
    true,
  ),
)
document.addEventListener(
  'volumechange',
  (e) => {
    const player = playerOf(e.target)
    if (!player) return
    const video = videoOf(player)
    setSetting('mediaVolume', video.volume)
    setSetting('mediaMuted', video.muted)
    syncVolume(player)
  },
  true,
)
document.addEventListener(
  'ratechange',
  (e) => {
    const player = playerOf(e.target)
    if (!player) return
    syncRate(player)
  },
  true,
)
;(['waiting', 'playing', 'canplay'] as const).forEach((type) =>
  document.addEventListener(
    type,
    (e) => {
      const player = playerOf(e.target)
      if (player) player.toggleAttribute('data-waiting', type === 'waiting')
    },
    true,
  ),
)

document.addEventListener('fullscreenchange', () => {
  $$<HTMLElement>('[data-video-player]').forEach((player) =>
    player.toggleAttribute('data-fullscreen', document.fullscreenElement === player),
  )
})

function syncRatio(player: HTMLElement) {
  const { videoWidth, videoHeight } = videoOf(player)
  if (videoWidth > 0 && videoHeight > 0) player.style.setProperty('--vp-ratio', `${videoWidth} / ${videoHeight}`)
}

export function initVideoPlayers() {
  $$<HTMLElement>('[data-video-player]:not([data-video-ready])').forEach((player) => {
    player.setAttribute('data-video-ready', '')
    const video = videoOf(player)
    video.volume = getSetting('mediaVolume')
    video.muted = getSetting('mediaMuted')
    video.playbackRate = video.defaultPlaybackRate = getSetting('mediaRate')
    const pip = player.querySelector<HTMLElement>('[data-video-action="pip"]')!
    pip.hidden = !document.pictureInPictureEnabled || video.disablePictureInPicture
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) syncRatio(player)
    syncTime(player)
    syncVolume(player)
    syncRate(player)
    syncPlaying(player)
  })
}

// ---------------------------------------------------------------- 画像のビューアー

const ZOOM_STEP = 1.5
const MAX_ZOOM = 8
const DOUBLE_TAP_MS = 300
// 上下を広く空けるのは、全体を表示したときに画像が上の名前と下の操作の帯に隠れないようにするため
const FIT_GAP_X = 48
const FIT_GAP_Y = 144

type View = { scale: number; x: number; y: number; rotate: number }

const views = new WeakMap<HTMLElement, View>()

const lightboxOf = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>('[data-image-lightbox]') : null)
const imageOf = (box: HTMLElement) => box.querySelector<HTMLImageElement>('[data-image-zoom]')!
const stageOf = (box: HTMLElement) => box.querySelector<HTMLElement>('[data-image-stage]')!

/** 回転を含めた画像の幅と高さ（実寸） */
function turnedSize(box: HTMLElement, rotate: number) {
  const { naturalWidth: w, naturalHeight: h } = imageOf(box)
  return rotate % 180 === 0 ? { w, h } : { w: h, h: w }
}

function fitScale(box: HTMLElement, rotate: number) {
  const { w, h } = turnedSize(box, rotate)
  const stage = stageOf(box).getBoundingClientRect()
  if (!w || !h) return 1
  // 小さな画像を引き伸ばさないのは、ぼやけた画像を実寸より大きく見せてしまうため
  return Math.min(1, (stage.width - FIT_GAP_X) / w, (stage.height - FIT_GAP_Y) / h)
}

function clampView(box: HTMLElement, view: View): View {
  const fit = fitScale(box, view.rotate)
  const scale = Math.min(Math.max(MAX_ZOOM, fit), Math.max(fit, view.scale))
  const { w, h } = turnedSize(box, view.rotate)
  const stage = stageOf(box).getBoundingClientRect()
  const limitX = Math.max(0, (w * scale - stage.width) / 2)
  const limitY = Math.max(0, (h * scale - stage.height) / 2)
  return {
    scale,
    rotate: view.rotate,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  }
}

function applyView(box: HTMLElement, next: View, animate = false) {
  const view = clampView(box, next)
  views.set(box, view)
  const stage = stageOf(box)
  stage.toggleAttribute('data-animate', animate && !reducedMotion())
  imageOf(box).style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${view.rotate}deg) scale(${view.scale})`
  box.querySelector('[data-image-level]')!.textContent = `${Math.round(view.scale * 100)}%`
}

function resetView(box: HTMLElement, rotate = 0) {
  applyView(box, { scale: fitScale(box, rotate), x: 0, y: 0, rotate })
  const img = imageOf(box)
  if (img.naturalWidth) box.querySelector('[data-image-dims]')!.textContent = `${img.naturalWidth} × ${img.naturalHeight}`
}

/** 画面上の点（ステージの中心から）を動かさずに倍率を変える */
function zoomAt(box: HTMLElement, scale: number, px = 0, py = 0, animate = false) {
  const view = views.get(box) ?? { scale: 1, x: 0, y: 0, rotate: 0 }
  const target = clampView(box, { ...view, scale }).scale
  const k = target / view.scale
  applyView(box, { ...view, scale: target, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, animate)
}

const fromCenter = (box: HTMLElement, clientX: number, clientY: number) => {
  const rect = stageOf(box).getBoundingClientRect()
  return { px: clientX - rect.left - rect.width / 2, py: clientY - rect.top - rect.height / 2 }
}

function toggleZoom(box: HTMLElement, px = 0, py = 0) {
  const view = views.get(box)
  if (!view) return
  const fit = fitScale(box, view.rotate)
  const zoomed = view.scale > fit + 0.001
  if (zoomed) applyView(box, { ...view, scale: fit, x: 0, y: 0 }, true)
  else zoomAt(box, fit < 1 ? 1 : Math.min(MAX_ZOOM, fit * 2), px, py, true)
}

const IMAGE_ACTIONS: Record<string, (box: HTMLElement) => void> = {
  'zoom-in': (box) => zoomAt(box, (views.get(box)?.scale ?? 1) * ZOOM_STEP, 0, 0, true),
  'zoom-out': (box) => zoomAt(box, (views.get(box)?.scale ?? 1) / ZOOM_STEP, 0, 0, true),
  toggle: (box) => toggleZoom(box),
  fit: (box) =>
    applyView(box, { scale: fitScale(box, views.get(box)?.rotate ?? 0), x: 0, y: 0, rotate: views.get(box)?.rotate ?? 0 }, true),
  rotate: (box) => {
    const rotate = (views.get(box)?.rotate ?? 0) + 90
    applyView(box, { scale: fitScale(box, rotate), x: 0, y: 0, rotate }, true)
  },
}

document.addEventListener('click', (e) => {
  const action = (e.target as Element).closest<HTMLElement>('[data-image-action]')
  const box = lightboxOf(action)
  if (action && box) IMAGE_ACTIONS[action.dataset.imageAction!]?.(box)
})

// 開いたときに合わせ直すのは、閉じている間は大きさが 0 で、全体を表示する倍率を計れないため
document.addEventListener(
  'toggle',
  (e) => {
    const box = e.target
    if (!(box instanceof HTMLElement) || !box.matches('[data-image-lightbox]') || (e as ToggleEvent).newState !== 'open') return
    resetView(box)
  },
  true,
)
document.addEventListener(
  'load',
  (e) => {
    const box = lightboxOf(e.target)
    if (box?.matches(':popover-open') && (e.target as Element).matches('[data-image-zoom]')) resetView(box)
  },
  true,
)
addEventListener('resize', () => {
  $$<HTMLElement>('[data-image-lightbox]:popover-open').forEach((box) => {
    const view = views.get(box)
    if (view) applyView(box, view)
  })
})

document.addEventListener(
  'wheel',
  (e) => {
    const box = lightboxOf(e.target)
    if (!box || !(e.target as Element).closest('[data-image-stage]')) return
    e.preventDefault()
    const view = views.get(box)
    if (!view) return
    // トラックパッドのピンチは ctrlKey 付きの細かい wheel で届くので、ホイールより強く効かせる
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
    const { px, py } = fromCenter(box, e.clientX, e.clientY)
    zoomAt(box, view.scale * factor, px, py)
  },
  { passive: false },
)

type Gesture = { box: HTMLElement; pointers: Map<number, { x: number; y: number }>; moved: boolean }
let gesture: Gesture | null = null
let lastTap = { time: 0, x: 0, y: 0 }

const pinchOf = (pointers: Gesture['pointers']) => {
  const [a, b] = [...pointers.values()]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
}

document.addEventListener('pointerdown', (e) => {
  const stage = (e.target as Element).closest<HTMLElement>('[data-image-stage]')
  const box = lightboxOf(stage)
  if (!stage || !box || e.button !== 0) return
  if (gesture?.box !== box) gesture = { box, pointers: new Map(), moved: false }
  gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  stage.setPointerCapture(e.pointerId)
  stage.setAttribute('data-panning', '')
})

document.addEventListener('pointermove', (e) => {
  const prev = gesture?.pointers.get(e.pointerId)
  if (!gesture || !prev) return
  const { box, pointers } = gesture
  const view = views.get(box)
  if (!view) return
  const before = pointers.size === 2 ? pinchOf(pointers) : null
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) gesture.moved = true
  if (before) {
    const after = pinchOf(pointers)
    const { px, py } = fromCenter(box, after.x, after.y)
    zoomAt(box, view.scale * (after.d / before.d), px, py)
    const zoomed = views.get(box)!
    applyView(box, { ...zoomed, x: zoomed.x + after.x - before.x, y: zoomed.y + after.y - before.y })
  } else {
    applyView(box, { ...view, x: view.x + e.clientX - prev.x, y: view.y + e.clientY - prev.y })
  }
})

function endPointer(e: PointerEvent) {
  if (!gesture?.pointers.has(e.pointerId)) return
  const { box, pointers, moved } = gesture
  pointers.delete(e.pointerId)
  if (pointers.size > 0) return
  stageOf(box).removeAttribute('data-panning')
  gesture = null
  if (moved || e.type === 'pointercancel') return
  // dblclick を使わないのは、タッチ操作を止めたステージでは、ダブルタップで dblclick が届かないブラウザがあるため
  const now = performance.now()
  const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24
  if (now - lastTap.time < DOUBLE_TAP_MS && near) {
    const { px, py } = fromCenter(box, e.clientX, e.clientY)
    toggleZoom(box, px, py)
    lastTap = { time: 0, x: 0, y: 0 }
  } else {
    lastTap = { time: now, x: e.clientX, y: e.clientY }
  }
}
document.addEventListener('pointerup', endPointer)
document.addEventListener('pointercancel', endPointer)

const PAN_STEP = 80

document.addEventListener('keydown', (e) => {
  const box = $$<HTMLElement>('[data-image-lightbox]:popover-open')[0]
  if (!box || e.metaKey || e.ctrlKey || e.altKey) return
  const view = views.get(box)
  if (!view) return
  const pan = (dx: number, dy: number) => applyView(box, { ...view, x: view.x + dx, y: view.y + dy }, true)
  const keys: Record<string, (box: HTMLElement) => void> = {
    '+': IMAGE_ACTIONS['zoom-in'],
    '=': IMAGE_ACTIONS['zoom-in'],
    '-': IMAGE_ACTIONS['zoom-out'],
    '0': IMAGE_ACTIONS.fit,
    r: IMAGE_ACTIONS.rotate,
    ArrowLeft: () => pan(PAN_STEP, 0),
    ArrowRight: () => pan(-PAN_STEP, 0),
    ArrowUp: () => pan(0, PAN_STEP),
    ArrowDown: () => pan(0, -PAN_STEP),
  }
  const run = keys[e.key]
  if (!run) return
  e.preventDefault()
  run(box)
})
