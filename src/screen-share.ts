/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 画面共有ページ専用。映像は WebCodecs でエンコード / デコードし、socket.io（WebSocket かロングポーリング）でサーバー経由で配る。

import { io, type Socket } from 'socket.io-client'
import {
  MAX_FPS,
  MAX_HEIGHT,
  MAX_WIDTH,
  type ClientToServerEvents,
  type FrameMeta,
  type ServerToClientEvents,
  type ShareAuth,
  type ShareMode,
  type StreamConfig,
} from './lib/screen-share-protocol'

type ShareSocket = Socket<ServerToClientEvents, ClientToServerEvents>

type TrackProcessor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> }

const FRAME_INTERVAL = 1000 / MAX_FPS
const ACK_TIMEOUT = 10_000
const MAX_IN_FLIGHT = 6
const MIN_BITRATE = 300_000
const BITS_PER_PIXEL = 0.08
const BITRATE_ADJUST_INTERVAL = 2_000
const MAX_DECODE_QUEUE = 30

const CODECS: { codec: string; avc?: AvcEncoderConfig }[] = [
  { codec: 'avc1.640028', avc: { format: 'annexb' } },
  { codec: 'vp09.00.40.08' },
  { codec: 'vp8' },
]

const root = document.querySelector<HTMLElement>('[data-screen-share]')
if (root) setup(root)

function setup(root: HTMLElement) {
  const courseId = Number(root.dataset.course)
  const itemId = Number(root.dataset.screenShare)
  const canPresent = root.dataset.canPresent === '1'
  const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!
  const stage = $<HTMLElement>('[data-screen-stage]')
  const canvas = $<HTMLCanvasElement>('[data-screen-canvas]')
  const preview = $<HTMLVideoElement>('[data-screen-preview]')
  const placeholder = $<HTMLElement>('[data-screen-placeholder]')
  const message = $<HTMLElement>('[data-screen-message]')
  const stateChip = $<HTMLElement>('[data-screen-state]')
  const statsText = root.querySelector<HTMLElement>('[data-screen-stats]')
  const errorText = $<HTMLElement>('[data-screen-error]')
  const fullscreenBtn = $<HTMLButtonElement>('[data-screen-fullscreen]')
  const startBtn = root.querySelector<HTMLButtonElement>('[data-screen-start]')
  const stopBtn = root.querySelector<HTMLButtonElement>('[data-screen-stop]')
  const ctx = canvas.getContext('2d')!

  const supported = 'VideoDecoder' in window && 'EncodedVideoChunk' in window
  const canCapture = supported && 'VideoEncoder' in window && !!navigator.mediaDevices?.getDisplayMedia

  // --- 表示の切り替え
  function showMessage(text: string) {
    message.textContent = text
    placeholder.hidden = false
    canvas.hidden = true
    preview.hidden = true
    fullscreenBtn.hidden = true
  }
  function showMedia(el: HTMLCanvasElement | HTMLVideoElement) {
    placeholder.hidden = true
    canvas.hidden = el !== canvas
    preview.hidden = el !== preview
    fullscreenBtn.hidden = false
  }
  function setState(label: string, live: boolean) {
    stateChip.textContent = label
    stateChip.classList.toggle('chip-live', live)
  }
  function showError(text: string) {
    errorText.textContent = text
    errorText.hidden = !text
  }
  function setPresenting(presenting: boolean) {
    if (startBtn) startBtn.hidden = presenting || !canCapture
    if (stopBtn) stopBtn.hidden = !presenting
  }

  const connect = (mode: ShareMode): ShareSocket => io({ auth: { courseId, itemId, mode } satisfies ShareAuth, forceNew: true })

  const stats = { frames: 0, bytes: 0, width: 0, height: 0 }
  if (statsText) {
    setInterval(() => {
      statsText.textContent = stats.width
        ? `${stats.width}×${stats.height} · ${stats.frames} fps · ${Math.round((stats.bytes * 8) / 1000)} kbps`
        : ''
      stats.frames = 0
      stats.bytes = 0
    }, 1000)
  }

  // --- 視聴
  let viewer: ShareSocket | null = null

  function startViewing() {
    const socket = connect('view')
    viewer = socket
    let decoder: VideoDecoder | null = null
    let decoderConfig: VideoDecoderConfig | null = null
    let waitingKey = true
    let decoded = false

    const closeDecoder = () => {
      if (decoder && decoder.state !== 'closed') decoder.close()
      decoder = null
    }
    const openDecoder = () => {
      closeDecoder()
      decoded = false
      waitingKey = true
      decoder = new VideoDecoder({
        output: (frame) => {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth
            canvas.height = frame.displayHeight
          }
          ctx.drawImage(frame, 0, 0)
          frame.close()
          decoded = true
          stats.frames++
          stats.width = canvas.width
          stats.height = canvas.height
          if (canvas.hidden) showMedia(canvas)
        },
        error: () => {
          if (!decoded) {
            closeDecoder()
            showMessage('このブラウザでは共有された画面を再生できません。最新の Chrome / Edge / Safari / Firefox でお試しください。')
            return
          }
          resync()
        },
      })
      decoder.configure(decoderConfig!)
    }
    // 差分フレームを捨てたまま続けないのは、参照先が欠けて映像が崩れるため
    const resync = () => {
      if (!decoderConfig) return
      openDecoder()
      socket.emit('keyframe')
    }

    socket.on('idle', () => {
      if (startBtn) startBtn.disabled = false
      closeDecoder()
      decoderConfig = null
      stats.width = 0
      showMessage('現在、画面共有は行われていません。始まると自動で表示されます。')
      setState('待機中', false)
    })
    socket.on('stream', ({ presenter, config }) => {
      if (startBtn) startBtn.disabled = true
      decoderConfig = { codec: config.codec, codedWidth: config.width, codedHeight: config.height, optimizeForLatency: true }
      openDecoder()
      if (canvas.hidden) showMessage(`${presenter} さんの画面を読み込んでいます…`)
      setState(`配信中 · ${presenter} さん`, true)
    })
    socket.on('frame', (meta, data, ack) => {
      ack()
      if (!decoder || decoder.state !== 'configured') return
      if (waitingKey && !meta.key) return
      if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) return resync()
      waitingKey = false
      stats.bytes += data.byteLength
      decoder.decode(new EncodedVideoChunk({ type: meta.key ? 'key' : 'delta', timestamp: meta.timestamp, data }))
    })
    socket.on('connect_error', () => {
      if (socket.active) return
      showMessage('画面共有に接続できませんでした。ページを再読み込みしてください。')
    })
    socket.on('disconnect', () => {
      if (socket === viewer) showMessage('接続が切れました。再接続しています…')
    })
  }

  function stopViewing() {
    const socket = viewer
    viewer = null
    socket?.disconnect()
  }

  // --- 共有（配信側）
  type Presentation = { stop: () => void }
  let presentation: Presentation | null = null

  async function pickCodec(width: number, height: number) {
    for (const candidate of CODECS) {
      const [enc, dec] = await Promise.all([
        VideoEncoder.isConfigSupported(encoderConfig(candidate, width, height, MIN_BITRATE)).catch(() => null),
        VideoDecoder.isConfigSupported({ codec: candidate.codec }).catch(() => null),
      ])
      if (enc?.supported && dec?.supported) return candidate
    }
    return null
  }

  async function startPresenting() {
    showError('')
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: MAX_WIDTH }, height: { max: MAX_HEIGHT }, frameRate: { max: MAX_FPS } },
        audio: false,
      })
    } catch {
      return
    }
    const track = media.getVideoTracks()[0]
    const codec = await pickCodec(MAX_WIDTH, MAX_HEIGHT)
    if (!track || !codec) {
      media.getTracks().forEach((t) => t.stop())
      showError('このブラウザでは画面を共有できません。最新の Chrome / Edge でお試しください。')
      return
    }

    stopViewing()
    const socket = connect('present')
    let config: StreamConfig | null = null
    let bitrate = 0
    let appliedBitrate = 0
    let inFlight = 0
    let forceKey = true
    let congested = false
    let calmWindows = 0
    let lastEncodedAt = -Infinity
    let lastAdjustedAt = performance.now()
    let lastFrame: VideoFrame | null = null
    let keyframeTimer: ReturnType<typeof setTimeout> | undefined
    let scaler: HTMLCanvasElement | null = null

    const encoder = new VideoEncoder({
      output: (chunk) => {
        // 切断中に emit しないのは、socket.io が送信待ちとして溜め込み、再接続時に古い映像をまとめて送ってしまうため
        if (!socket.connected) {
          forceKey = true
          return
        }
        const data = new ArrayBuffer(chunk.byteLength)
        chunk.copyTo(data)
        const meta: FrameMeta = { key: chunk.type === 'key', timestamp: chunk.timestamp }
        inFlight++
        socket.timeout(ACK_TIMEOUT).emit('frame', meta, data, () => {
          inFlight--
        })
        stats.frames++
        stats.bytes += chunk.byteLength
      },
      error: () => {
        showError('エンコード中にエラーが発生したため、共有を停止しました。')
        stop()
      },
    })

    const configure = (width: number, height: number) => {
      const max = maxBitrate(width, height)
      bitrate = Math.min(bitrate || max * 0.6, max)
      appliedBitrate = bitrate
      encoder.configure(encoderConfig(codec, width, height, bitrate))
      config = { codec: codec.codec, width, height }
      stats.width = width
      stats.height = height
      forceKey = true
      if (socket.connected) socket.emit('config', config)
    }

    const adjustBitrate = (now: number) => {
      if (!config || now - lastAdjustedAt < BITRATE_ADJUST_INTERVAL) return
      lastAdjustedAt = now
      const max = maxBitrate(config.width, config.height)
      if (congested || inFlight > MAX_IN_FLIGHT / 2) {
        bitrate = Math.max(MIN_BITRATE, bitrate * 0.7)
        calmWindows = 0
      } else if (++calmWindows >= 2) {
        bitrate = Math.min(max, bitrate * 1.15)
      }
      congested = false
      if (Math.abs(bitrate - appliedBitrate) / appliedBitrate > 0.1) {
        appliedBitrate = bitrate
        encoder.configure(encoderConfig(codec, config.width, config.height, bitrate))
      }
    }

    const encode = (source: VideoFrame, now: number) => {
      const { width, height } = fitSize(source.displayWidth, source.displayHeight)
      if (!config || config.width !== width || config.height !== height) configure(width, height)
      if (encoder.state !== 'configured') return
      if (encoder.encodeQueueSize > 2 || inFlight > MAX_IN_FLIGHT) {
        congested = true
        return
      }
      let image: CanvasImageSource = source
      if (source.displayWidth !== width || source.displayHeight !== height) {
        scaler ??= document.createElement('canvas')
        scaler.width = width
        scaler.height = height
        scaler.getContext('2d')!.drawImage(source, 0, 0, width, height)
        image = scaler
      }
      const frame = new VideoFrame(image, { timestamp: Math.round(now * 1000) })
      encoder.encode(frame, { keyFrame: forceKey })
      frame.close()
      forceKey = false
      lastEncodedAt = now
    }

    const onFrame = (frame: VideoFrame) => {
      lastFrame?.close()
      lastFrame = frame
      const now = performance.now()
      adjustBitrate(now)
      if (forceKey || now - lastEncodedAt >= FRAME_INTERVAL - 2) encode(frame, now)
    }

    const stopSource = startFrameSource(track, preview, onFrame)

    // 次のフレームを待つだけにしないのは、画面が止まっていると新しいフレームが来ないため
    const sendKeyframeSoon = () => {
      forceKey = true
      clearTimeout(keyframeTimer)
      keyframeTimer = setTimeout(() => {
        if (forceKey && lastFrame) encode(lastFrame, performance.now())
      }, 200)
    }

    socket.on('connect', () => {
      showError('')
      if (config) socket.emit('config', config)
      sendKeyframeSoon()
    })
    socket.on('keyframe', sendKeyframeSoon)
    socket.on('connect_error', (err) => {
      if (socket.active) return
      showError(
        err.message === 'busy' ? 'ほかの人が画面を共有しているため、共有を開始できませんでした。' : '画面共有を開始できませんでした。',
      )
      stop()
    })
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        showError('別のタブで共有が始まったため、このタブでの共有を停止しました。')
        stop()
      } else if (presentation) {
        showError('接続が切れました。再接続しています…')
      }
    })
    track.addEventListener('ended', () => stop())

    function stop() {
      if (presentation !== current) return
      presentation = null
      clearTimeout(keyframeTimer)
      stopSource()
      media.getTracks().forEach((t) => t.stop())
      if (encoder.state !== 'closed') encoder.close()
      lastFrame?.close()
      lastFrame = null
      preview.srcObject = null
      socket.disconnect()
      stats.width = 0
      setPresenting(false)
      startViewing()
    }

    const current: Presentation = { stop }
    presentation = current
    preview.srcObject = media
    preview.play().catch(() => {})
    showMedia(preview)
    setState('共有中', true)
    setPresenting(true)
  }

  // --- 操作
  startBtn?.addEventListener('click', () => {
    if (!presentation) startPresenting()
  })
  stopBtn?.addEventListener('click', () => presentation?.stop())
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else stage.requestFullscreen?.().catch(() => {})
  }
  fullscreenBtn.addEventListener('click', toggleFullscreen)
  stage.addEventListener('dblclick', () => {
    if (!fullscreenBtn.hidden) toggleFullscreen()
  })

  if (!supported) {
    showMessage('このブラウザは画面共有に対応していません。最新の Chrome / Edge / Safari / Firefox でお試しください。')
    return
  }
  showMessage('接続しています…')
  setPresenting(false)
  if (canPresent && !canCapture) showError('このブラウザでは画面の共有を開始できません（視聴はできます）。')
  startViewing()
}

function encoderConfig(candidate: (typeof CODECS)[number], width: number, height: number, bitrate: number): VideoEncoderConfig {
  return {
    codec: candidate.codec,
    width,
    height,
    bitrate: Math.round(bitrate),
    bitrateMode: 'variable',
    framerate: MAX_FPS,
    latencyMode: 'realtime',
    ...(candidate.avc && { avc: candidate.avc }),
  }
}

const maxBitrate = (width: number, height: number) => Math.max(MIN_BITRATE, Math.round(width * height * MAX_FPS * BITS_PER_PIXEL))

// 偶数にそろえるのは、4:2:0 の H.264 / VP9 は奇数の幅・高さを受け付けないエンコーダーがあるため
function fitSize(width: number, height: number) {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  }
}

/**
 * video 要素からの取り出しだけにしないのは、配信者が共有中のアプリへ切り替えてこのタブが裏に回ると、
 * requestVideoFrameCallback やタイマーが止まる・間引かれるため。使えるブラウザでは MediaStreamTrackProcessor で読む。
 */
function startFrameSource(track: MediaStreamTrack, video: HTMLVideoElement, onFrame: (frame: VideoFrame) => void) {
  const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor
  if (Processor) {
    const reader = new Processor({ track }).readable.getReader()
    ;(async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        onFrame(value)
      }
    })().catch(() => {})
    return () => {
      reader.cancel().catch(() => {})
    }
  }

  let active = true
  const grab = () => {
    if (active && video.readyState >= 2 && video.videoWidth > 0)
      onFrame(new VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) }))
  }
  if ('requestVideoFrameCallback' in video) {
    const loop = () => {
      if (!active) return
      grab()
      video.requestVideoFrameCallback(loop)
    }
    video.requestVideoFrameCallback(loop)
  }
  // 静止画面では新しいフレームが来ないうえ、裏のタブでは requestVideoFrameCallback が止まるので、タイマーでも拾う
  const timer = setInterval(grab, 1000)
  return () => {
    active = false
    clearInterval(timer)
  }
}
