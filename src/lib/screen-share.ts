import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http'
import { and, eq } from 'drizzle-orm'
import { Server, type Socket } from 'socket.io'
import { userFromCookieHeader } from './auth'
import { config } from './config'
import { getCourseAccessFor, isVisibleItem, touchCourse } from './courses'
import { db } from './db'
import { items } from './schema'
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
import type { User } from './types'

type SocketData = { user: User; courseId: number; itemId: number; mode: ShareMode }
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

const isScreenItem = async (courseId: number, itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, 'screen')))
    .get()

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

function present(socket: ShareSocket, itemId: number, room: Room) {
  const previous = room.presenter
  room.presenter = socket
  room.stream = null
  if (!previous) touchCourse(socket.data.courseId)
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
    touchCourse(socket.data.courseId)
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

export function attachScreenShare(httpServer: HttpServer) {
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
      const user = await userFromCookieHeader(socket.handshake.headers.cookie)
      if (!user || !isId(courseId) || !isId(itemId) || !isMode(mode)) return next(shareError('not_found'))
      const access = await getCourseAccessFor(user, courseId)
      if (!access || (mode === 'present' && !access.canManage)) return next(shareError('not_found'))
      if (!(await isScreenItem(courseId, itemId))) return next(shareError('not_found'))
      if (!access.canManage && !isVisibleItem(itemId)) return next(shareError('not_found'))
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
    if (mode === 'present') present(socket, itemId, room)
    else view(socket, itemId, room)
  })

  return io
}
