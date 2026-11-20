import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MAX_COLLAB_STATE, MAX_COLLAB_UPDATE, type CollabDocStore } from './collab'
import {
  COLLAB_SOCKET_PATH,
  type ClientToServerEvents,
  type CollabAuth,
  type CollabError,
  type ServerToClientEvents,
} from './collab-protocol'
import { config } from '../../lib/config'

// このファイルで DB を読まないのは、Moodle モードでも読み込むので、step-learn.db を開くと Moodle モードでも作られてしまうため

export type CollabUser = { id: number; name: string }

/** 通常モード（src/features/collab/collab-access.ts）と Moodle モード（src/moodle-mode/collab.ts）で違う部分 */
export type CollabSocketBackend = {
  /** その時点でそのファイルを開いてよいなら利用者とファイルを、だめなら null を返す */
  authorize: (cookie: string | undefined, auth: CollabAuth) => Promise<{ user: CollabUser; doc: CollabDocStore } | null>
}

type SocketData = { user: CollabUser; auth: CollabAuth; doc: CollabDocStore }
type CollabServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type CollabSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

type Room = {
  doc: Y.Doc
  awareness: Awareness
  store: CollabDocStore
  sockets: Map<string, { socket: CollabSocket; clients: Set<number> }>
  /** 保存したときの大きさに、そのあと受けた変更の大きさを足したもの。上限を確かめるための見積もりで、実際より大きい */
  size: number
  dirtySince: number
  lastEditor: number
  timer: NodeJS.Timeout | null
}

// 変更のたびに保存しないのは、1 文字ごとに状態全体を DB に書くことになるため。止まって少し待つか、書き続けても一定の間隔で保存する
const SAVE_DELAY = 2_000
const MAX_SAVE_DELAY = 10_000
const MAX_AWARENESS_UPDATE = 64 * 1024
// 権限を変える各処理から接続を切らないのは、受講の取り消し・ロールの変更・非表示・ログアウトなど経路が多く、
// 処理を足したときに切り忘れると、権限をなくした人が編集し続けられるため（src/features/screen/screen-share.ts と同じ）
const RECHECK_INTERVAL = 10_000

const rooms = new Map<string, Room>()

function initialState(store: CollabDocStore) {
  const saved = store.load()
  if (saved || !store.template) return saved
  const live = rooms.get(store.template.key)
  return live ? Y.encodeStateAsUpdate(live.doc) : store.template.load()
}

function roomOf(store: CollabDocStore) {
  const found = rooms.get(store.key)
  if (found) return found
  const doc = new Y.Doc()
  const state = initialState(store)
  if (state) Y.applyUpdate(doc, state)
  const awareness = new Awareness(doc)
  awareness.setLocalState(null)
  const room: Room = { doc, awareness, store, sockets: new Map(), size: state?.byteLength ?? 0, dirtySince: 0, lastEditor: 0, timer: null }
  // 初期の中身をひな形から写したときに保存しておかないのは、開いただけで編集していない学生のファイルを作らないため
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    room.size += update.byteLength
    for (const entry of room.sockets.values()) if (entry.socket !== origin) entry.socket.emit('update', update)
    scheduleSave(room)
  })
  awareness.on('update', ({ added, updated, removed }: Record<'added' | 'updated' | 'removed', number[]>, origin: unknown) => {
    const changed = [...added, ...updated, ...removed]
    const sender = [...room.sockets.values()].find((entry) => entry.socket === origin)
    if (sender) {
      for (const id of [...added, ...updated]) sender.clients.add(id)
      for (const id of removed) sender.clients.delete(id)
    }
    const update = encodeAwarenessUpdate(awareness, changed)
    for (const entry of room.sockets.values()) if (entry.socket !== origin) entry.socket.emit('awareness', update)
  })
  rooms.set(store.key, room)
  return room
}

function scheduleSave(room: Room) {
  const now = Date.now()
  if (!room.dirtySince) room.dirtySince = now
  if (room.timer) clearTimeout(room.timer)
  const wait = Math.max(0, Math.min(SAVE_DELAY, room.dirtySince + MAX_SAVE_DELAY - now))
  room.timer = setTimeout(() => saveRoom(room), wait)
}

function saveRoom(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
  if (!room.dirtySince) return
  room.dirtySince = 0
  const state = Y.encodeStateAsUpdate(room.doc)
  room.size = state.byteLength
  try {
    room.store.save(state, room.lastEditor)
  } catch (err) {
    // 投げ直さないのは、開いている間にアイテムが消されたときは保存先がなく、残りの部屋の保存まで止めないため
    console.error('[collab] save', room.store.key, err)
  }
}

function releaseRoom(room: Room) {
  if (room.sockets.size > 0) return
  saveRoom(room)
  room.awareness.destroy()
  room.doc.destroy()
  rooms.delete(room.store.key)
}

/** 開いているすべてのファイルを保存する。サーバーを止める前に呼ぶ */
export function flushCollabRooms() {
  for (const room of rooms.values()) saveRoom(room)
}

const isId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

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

const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array

function reject(socket: CollabSocket, reason: CollabError) {
  socket.emit('rejected', reason)
  socket.disconnect(true)
}

function recheckPeriodically(backend: CollabSocketBackend, socket: CollabSocket) {
  const timer = setInterval(() => {
    backend
      .authorize(socket.handshake.headers.cookie, socket.data.auth)
      .then((found) => {
        if (found && found.doc.key === socket.data.doc.key) return
        socket.emit('revoked')
        socket.disconnect(true)
      })
      .catch((err: unknown) => console.error('[collab] recheck', err))
  }, RECHECK_INTERVAL)
  socket.on('disconnect', () => clearInterval(timer))
}

function join(socket: CollabSocket) {
  const room = roomOf(socket.data.doc)
  const entry = { socket, clients: new Set<number>() }
  room.sockets.set(socket.id, entry)
  socket.emit('sync', Y.encodeStateAsUpdate(room.doc), Y.encodeStateVector(room.doc))
  const present = [...room.awareness.getStates().keys()]
  if (present.length) socket.emit('awareness', encodeAwarenessUpdate(room.awareness, present))

  socket.on('update', (update) => {
    if (!isBytes(update) || update.byteLength === 0) return
    if (update.byteLength > MAX_COLLAB_UPDATE || room.size + update.byteLength > MAX_COLLAB_STATE) return reject(socket, 'too_large')
    try {
      room.lastEditor = socket.data.user.id
      Y.applyUpdate(room.doc, update, socket)
    } catch {
      socket.disconnect(true)
    }
  })

  socket.on('awareness', (update) => {
    if (!isBytes(update) || update.byteLength > MAX_AWARENESS_UPDATE) return
    try {
      applyAwarenessUpdate(room.awareness, update, socket)
    } catch {
      socket.disconnect(true)
    }
  })

  socket.on('latency', (ack) => {
    if (typeof ack === 'function') ack()
  })

  socket.on('disconnect', () => {
    room.sockets.delete(socket.id)
    if (entry.clients.size) removeAwarenessStates(room.awareness, [...entry.clients], null)
    releaseRoom(room)
  })
}

export function attachCollab(httpServer: HttpServer, backend: CollabSocketBackend) {
  const io: CollabServer = new Server(httpServer, {
    path: COLLAB_SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: MAX_COLLAB_UPDATE + 1_024,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers)),
    // 既定の true にしないのは、開発時の Vite の HMR と画面共有も同じサーバーで WebSocket を受けており、その接続まで切られるため
    destroyUpgrade: false,
  })

  io.use(async (socket, next) => {
    try {
      const { courseId, itemId, owner } = socket.handshake.auth as Partial<Record<string, unknown>>
      if (!isId(courseId) || !isId(itemId) || typeof owner !== 'string') return next(new Error('not_found'))
      const auth = { courseId, itemId, owner }
      const found = await backend.authorize(socket.handshake.headers.cookie, auth)
      if (!found) return next(new Error('not_found'))
      socket.data = { user: found.user, auth, doc: found.doc }
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error(String(err)))
    }
  })

  io.on('connection', (socket) => {
    recheckPeriodically(backend, socket)
    join(socket)
  })

  return io
}
