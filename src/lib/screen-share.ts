import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { config } from './config'
import {
  MAX_FRAME_BYTES,
  MAX_HEIGHT,
  MAX_WIDTH,
  type ClientToServerEvents,
  type FrameMeta,
  type ServerToClientEvents,
  type ShareError,
  type ShareMode,
  type StreamConfig,
} from './screen-share-protocol'

export type Sharer = { id: number; name: string }

// このファイルで DB を読まないのは、Moodle モードでも読み込むので、step-learn.db を開くと Moodle モードでも作られてしまうため
/** 通常モード（src/lib/screen-share-access.ts）と Moodle モード（src/moodle-mode/screen-share.ts）で違う部分 */
export type ShareBackend = {
  /** その時点で接続してよいなら利用者を、だめなら null を返す */
  authorize: (cookie: string | undefined, courseId: number, itemId: number, mode: ShareMode) => Promise<Sharer | null>
  /** 共有が始まった・終わったとき。開いているコースの画面に「配信中」を出し入れする */
  onChange: (courseId: number) => void
}

type SocketData = { user: Sharer; courseId: number; itemId: number; mode: ShareMode }
type ShareServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type ShareSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

type Viewer = { socket: ShareSocket; inFlight: number; needsKeyframe: boolean }

type Room = {
  presenter: ShareSocket | null
  stream: StreamConfig | null
  viewers: Map<string, Viewer>
  keyframeRequestedAt: number
  keyframeTimer: NodeJS.Timeout | null
}

// 遅い視聴者にも送り続けないのは、TCP の上では遅延が際限なく積み上がり、ほかの視聴者のメモリも圧迫するため
const MAX_IN_FLIGHT = 10
const ACK_TIMEOUT = 10_000
const KEYFRAME_INTERVAL = 1_000
// 権限を変える各処理から接続を切らないのは、受講の取り消し・ロールの変更・非表示・ログアウト・パスワードの再設定と経路が多く、
// 処理を足したときに切り忘れると、権限をなくした人に映像が届き続けるため
const RECHECK_INTERVAL = 10_000

const rooms = new Map<number, Room>()

export const isSharing = (itemId: number) => !!rooms.get(itemId)?.presenter

function roomOf(itemId: number) {
  let room = rooms.get(itemId)
  if (!room) {
    room = { presenter: null, stream: null, viewers: new Map(), keyframeRequestedAt: 0, keyframeTimer: null }
    rooms.set(itemId, room)
  }
  return room
}

function releaseRoom(itemId: number, room: Room) {
  if (room.presenter || room.viewers.size > 0) return
  if (room.keyframeTimer) clearTimeout(room.keyframeTimer)
  rooms.delete(itemId)
}

// 要求をすぐ送らずにまとめるのは、視聴者が続けて入室したときにキーフレームが連発されて帯域を食うのを避けるため
function requestKeyframe(room: Room) {
  if (room.keyframeTimer) return
  const wait = Math.max(0, room.keyframeRequestedAt + KEYFRAME_INTERVAL - Date.now())
  room.keyframeTimer = setTimeout(() => {
    room.keyframeTimer = null
    room.keyframeRequestedAt = Date.now()
    room.presenter?.emit('keyframe')
  }, wait)
}

const isMode = (m: unknown): m is ShareMode => m === 'present' || m === 'view'

const isId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

const isDimension = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= max

function parseStreamConfig(v: unknown): StreamConfig | null {
  if (typeof v !== 'object' || v === null) return null
  const { codec, width, height } = v as Record<string, unknown>
  if (typeof codec !== 'string' || !/^[\w.-]{1,64}$/.test(codec)) return null
  if (!isDimension(width, MAX_WIDTH) || !isDimension(height, MAX_HEIGHT)) return null
  return { codec, width, height }
}

function parseFrameMeta(v: unknown): FrameMeta | null {
  if (typeof v !== 'object' || v === null) return null
  const { key, timestamp } = v as Record<string, unknown>
  if (typeof key !== 'boolean' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  return { key, timestamp }
}

// Origin がない要求を拒否しないのは、ロングポーリングの同一オリジンの GET には Origin が付かないため
function isAllowedOrigin(headers: IncomingHttpHeaders) {
  const origin = headers.origin
  if (!origin) return true
  if (config.appOrigin) return origin === config.appOrigin
  try {
    return new URL(origin).host === headers.host
  } catch {
    return false
  }
}

const shareError = (code: ShareError) => new Error(code)

function recheckPeriodically(backend: ShareBackend, socket: ShareSocket) {
  const { courseId, itemId, mode } = socket.data
  const timer = setInterval(() => {
    backend
      .authorize(socket.handshake.headers.cookie, courseId, itemId, mode)
      .then((user) => {
        if (user) return
        socket.emit('revoked')
        socket.disconnect(true)
      })
      .catch((err: unknown) => console.error('[screen-share] recheck', err))
  }, RECHECK_INTERVAL)
  socket.on('disconnect', () => clearInterval(timer))
}

function forwardFrame(room: Room, meta: FrameMeta, data: Uint8Array) {
  for (const viewer of room.viewers.values()) {
    if (viewer.needsKeyframe && !meta.key) continue
    if (viewer.inFlight >= MAX_IN_FLIGHT) {
      viewer.needsKeyframe = true
      requestKeyframe(room)
      continue
    }
    viewer.needsKeyframe = false
    viewer.inFlight++
    viewer.socket.timeout(ACK_TIMEOUT).emit('frame', meta, data, () => {
      viewer.inFlight--
    })
  }
}

function present(backend: ShareBackend, socket: ShareSocket, itemId: number, room: Room) {
  const previous = room.presenter
  room.presenter = socket
  room.stream = null
  if (!previous) backend.onChange(socket.data.courseId)
  // 同じ人が別のタブや再接続で共有し直したときは、古い接続を閉じて引き継ぐ
  previous?.disconnect(true)

  socket.on('config', (raw) => {
    const stream = parseStreamConfig(raw)
    if (room.presenter !== socket || !stream) return
    room.stream = stream
    for (const viewer of room.viewers.values()) {
      viewer.needsKeyframe = true
      viewer.socket.emit('stream', { presenter: socket.data.user.name, config: stream })
    }
  })

  socket.on('frame', (rawMeta, data, ack) => {
    if (typeof ack === 'function') ack()
    const meta = parseFrameMeta(rawMeta)
    if (room.presenter !== socket || !room.stream || !meta) return
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_FRAME_BYTES) return
    forwardFrame(room, meta, data)
  })

  socket.on('disconnect', () => {
    if (room.presenter !== socket) return
    room.presenter = null
    room.stream = null
    for (const viewer of room.viewers.values()) viewer.socket.emit('idle')
    backend.onChange(socket.data.courseId)
    releaseRoom(itemId, room)
  })
}

function view(socket: ShareSocket, itemId: number, room: Room) {
  const viewer: Viewer = { socket, inFlight: 0, needsKeyframe: true }
  room.viewers.set(socket.id, viewer)
  if (room.presenter && room.stream) {
    socket.emit('stream', { presenter: room.presenter.data.user.name, config: room.stream })
    requestKeyframe(room)
  } else {
    socket.emit('idle')
  }

  socket.on('keyframe', () => {
    viewer.needsKeyframe = true
    requestKeyframe(room)
  })

  socket.on('disconnect', () => {
    room.viewers.delete(socket.id)
    releaseRoom(itemId, room)
  })
}

export function attachScreenShare(httpServer: HttpServer, backend: ShareBackend) {
  const io: ShareServer = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: MAX_FRAME_BYTES + 1_024,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers)),
    // 既定の true にしないのは、開発時は Vite の HMR も同じサーバーで WebSocket を受けており、その接続まで切られるため
    destroyUpgrade: false,
  })

  io.use(async (socket, next) => {
    try {
      const { courseId, itemId, mode } = socket.handshake.auth as Partial<Record<string, unknown>>
      if (!isId(courseId) || !isId(itemId) || !isMode(mode)) return next(shareError('not_found'))
      const user = await backend.authorize(socket.handshake.headers.cookie, courseId, itemId, mode)
      if (!user) return next(shareError('not_found'))
      const presenter = rooms.get(itemId)?.presenter
      if (mode === 'present' && presenter && presenter.data.user.id !== user.id) return next(shareError('busy'))
      socket.data = { user, courseId, itemId, mode }
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error(String(err)))
    }
  })

  io.on('connection', (socket) => {
    const { itemId, mode } = socket.data
    const room = roomOf(itemId)
    recheckPeriodically(backend, socket)
    if (mode === 'present') present(backend, socket, itemId, room)
    else view(socket, itemId, room)
  })

  return io
}
