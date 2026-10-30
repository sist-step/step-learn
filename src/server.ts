// 本番用の Node.js エントリ。開発時は Vite（@hono/vite-dev-server）が src/index.tsx を直接読み込む。
import type { Server as HttpServer } from 'node:http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import app from './index'
import { config } from './lib/config'
import { attachScreenShare } from './lib/screen-share'

const server = new Hono()

// ビルド済みの CSS/JS はファイル名にハッシュが付くので長期キャッシュできる
server.use(
  '/assets/*',
  serveStatic({
    root: './dist/client',
    onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
  }),
)
server.use('/favicon.ico', serveStatic({ path: './dist/client/favicon.ico' }))
server.use('/favicon.png', serveStatic({ path: './dist/client/favicon.png' }))
server.use('/apple-touch-icon.png', serveStatic({ path: './dist/client/apple-touch-icon.png' }))
server.route('/', app)

const httpServer = serve({ fetch: server.fetch, port: config.port }, (info) => {
  console.log(`STEP Learn listening on http://localhost:${info.port}`)
})
const io = attachScreenShare(httpServer as HttpServer)

// httpServer.close だけにしないのは、開いたままの socket.io の接続が残って終了できなくなるため
const shutdown = () => io.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
