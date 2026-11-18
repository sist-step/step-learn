import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { PRESENTATION_SOCKET_PATH, parsePresentationBase, type PresentationServerEvents, type PresentationTargetIds } from './presentation'
import { isAllowedOrigin } from './screen-share'

// このファイルで DB を読まないのは、Moodle モードでも読み込むので、step-learn.db を開くと Moodle モードでも作られてしまうため

/** 通常モード（lib/presentation-access.ts）と Moodle モード（moodle-mode/presentation.ts）で違う部分 */
export type PresentationSocketBackend = {
  /** その時点でそのアイテムを開いてよいなら、アイテムの識別子（PresentationContext の ref）を返す */
  authorize: (cookie: string | undefined, target: PresentationTargetIds) => Promise<string | null>
}

type SocketData = { target: PresentationTargetIds; ref: string }
type PresentationServer = Server<Record<string, never>, PresentationServerEvents, Record<string, never>, SocketData>

// 権限を変える各処理から接続を切らないのは、受講の取り消し・非表示・ログアウトなど経路が多く、処理を足したときに切り忘れるため
const RECHECK_INTERVAL = 30_000

let io: PresentationServer | null = null

export const notifyPresentation = (ref: string) => void io?.to(ref).emit('changed')

export function attachPresentationSocket(httpServer: HttpServer, backend: PresentationSocketBackend) {
  const server: PresentationServer = new Server(httpServer, {
    path: PRESENTATION_SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: 1_024,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers)),
    // 既定の true にしないのは、開発時の Vite の HMR と画面共有・共同編集も同じサーバーで WebSocket を受けており、その接続まで切られるため
    destroyUpgrade: false,
  })

  server.use(async (socket, next) => {
    try {
      const { base } = socket.handshake.auth as Partial<Record<string, unknown>>
      const target = typeof base === 'string' ? parsePresentationBase(base) : null
      const ref = target && (await backend.authorize(socket.handshake.headers.cookie, target))
      if (!target || !ref) return next(new Error('not_found'))
      socket.data = { target, ref }
      next()
    } catch (err) {
      next(err instanceof Error ? err : new Error(String(err)))
    }
  })

  server.on('connection', (socket) => {
    const { target, ref } = socket.data
    void socket.join(ref)
    const timer = setInterval(() => {
      backend
        .authorize(socket.handshake.headers.cookie, target)
        .then((current) => {
          if (current !== ref) socket.disconnect(true)
        })
        .catch((err: unknown) => console.error('[presentation] recheck', err))
    }, RECHECK_INTERVAL)
    socket.on('disconnect', () => clearInterval(timer))
  })

  io = server
  return server
}
