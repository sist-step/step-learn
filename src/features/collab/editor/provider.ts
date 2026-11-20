/// <reference lib="dom" />
import { io, type Socket } from 'socket.io-client'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  COLLAB_SOCKET_PATH,
  type ClientToServerEvents,
  type CollabAuth,
  type CollabError,
  type ServerToClientEvents,
} from '../collab-protocol'

export type ConnectionState = 'connecting' | 'synced' | 'offline' | 'revoked' | 'too_large'

type CollabSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const bytes = (v: ArrayBuffer | Uint8Array) => (v instanceof Uint8Array ? v : new Uint8Array(v))

// 状態ベクトルの差分が空のときの長さ（ブロックも削除もない更新）
const EMPTY_UPDATE = 2

const LATENCY_INTERVAL = 3_000
const LATENCY_TIMEOUT = 10_000

/** socket.io で Yjs の文書と参加者の情報（Awareness）をサーバーと同期する */
export class CollabProvider {
  readonly awareness: Awareness
  state: ConnectionState = 'connecting'
  readonly synced: Promise<void>
  private readonly socket: CollabSocket
  private readonly listeners = new Set<(state: ConnectionState) => void>()
  private readonly latencyListeners = new Set<(ms: number | null) => void>()
  private latencyTimer: ReturnType<typeof setInterval> | undefined
  private everSynced = false

  constructor(
    readonly doc: Y.Doc,
    auth: CollabAuth,
  ) {
    this.awareness = new Awareness(doc)
    this.socket = io({ path: COLLAB_SOCKET_PATH, auth, forceNew: true })
    let resolve = () => {}
    this.synced = new Promise((r) => (resolve = r))

    this.socket.on('sync', (state, vector) => {
      Y.applyUpdate(doc, bytes(state), this)
      const diff = Y.encodeStateAsUpdate(doc, bytes(vector))
      if (diff.byteLength > EMPTY_UPDATE) this.socket.emit('update', diff)
      this.everSynced = true
      this.setState('synced')
      this.startLatency()
      if (this.awareness.getLocalState()) this.socket.emit('awareness', encodeAwarenessUpdate(this.awareness, [doc.clientID]))
      resolve()
    })
    this.socket.on('update', (update) => Y.applyUpdate(doc, bytes(update), this))
    this.socket.on('awareness', (update) => applyAwarenessUpdate(this.awareness, bytes(update), this))
    this.socket.on('revoked', () => this.stop('revoked'))
    this.socket.on('rejected', (reason: CollabError) => this.stop(reason === 'too_large' ? 'too_large' : 'revoked'))
    this.socket.on('connect_error', (err) => {
      // not_found のときに試し続けないのは、権限がないかアイテムが消えていて、何度つなぎ直しても開けないため
      if (err.message === 'not_found') this.stop('revoked')
      else this.setState(this.everSynced ? 'offline' : 'connecting')
    })
    this.socket.on('disconnect', () => {
      this.stopLatency()
      if (this.state === 'revoked' || this.state === 'too_large') return
      this.setState('offline')
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== doc.clientID)
      if (others.length) removeAwarenessStates(this.awareness, others, this)
    })

    // つながっていない間の変更を送らないのは、つなぎ直したときに sync の差分としてまとめて送るため
    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    addEventListener('pagehide', this.onPageHide)
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this && this.state === 'synced') this.socket.emit('update', update)
  }

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: Record<'added' | 'updated' | 'removed', number[]>,
    origin: unknown,
  ) => {
    if (origin === this || this.state !== 'synced') return
    const changed = [...added, ...updated, ...removed]
    if (changed.includes(this.doc.clientID)) this.socket.emit('awareness', encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
  }

  private readonly onPageHide = () => removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')

  private measureLatency() {
    const started = performance.now()
    // 届かなかったときに null にしないのは、切れたなら disconnect が先に表示を戻し、遅いだけなら前の値のほうが実態に近いため
    this.socket.timeout(LATENCY_TIMEOUT).emit('latency', (err: Error | null) => {
      if (!err && this.latencyTimer !== undefined) this.setLatency(Math.round(performance.now() - started))
    })
  }

  private startLatency() {
    this.stopLatency()
    this.latencyTimer = setInterval(() => this.measureLatency(), LATENCY_INTERVAL)
    this.measureLatency()
  }

  private stopLatency() {
    clearInterval(this.latencyTimer)
    this.latencyTimer = undefined
    this.setLatency(null)
  }

  private setLatency(ms: number | null) {
    for (const listener of this.latencyListeners) listener(ms)
  }

  private setState(state: ConnectionState) {
    if (this.state === state) return
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  private stop(state: ConnectionState) {
    this.stopLatency()
    this.setState(state)
    this.socket.disconnect()
  }

  onState(listener: (state: ConnectionState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  /** サーバーとの往復の時間（ms）。測れていないあいだは null */
  onLatency(listener: (ms: number | null) => void) {
    this.latencyListeners.add(listener)
    return () => this.latencyListeners.delete(listener)
  }

  destroy() {
    this.stopLatency()
    removeEventListener('pagehide', this.onPageHide)
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.socket.disconnect()
    this.awareness.destroy()
    this.listeners.clear()
    this.latencyListeners.clear()
  }
}
