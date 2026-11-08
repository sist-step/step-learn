// 本番用の Node.js エントリ。開発時は Vite（@hono/vite-dev-server）が src/index.tsx を直接読み込む。
import type { Server as HttpServer } from 'node:http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import app from './index'
import { config } from './lib/config'

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
// route で組み込まないのは、app の notFound ではなく server の既定の notFound が使われ、404 が素のテキストになるため
server.all('*', (c) => app.fetch(c.req.raw, c.env))

const httpServer = serve({ fetch: server.fetch, port: config.port }, (info) => {
  console.log(`STEP Learn listening on http://localhost:${info.port}`)
})
// Moodle モードで読み込まないのは、画面共有を使わないうえ、読み込むと step-learn.db を開いてしまうため
const io = config.moodle ? null : (await import('./lib/screen-share')).attachScreenShare(httpServer as HttpServer)

// httpServer.close だけにしないのは、開いたままの socket.io の接続が残って終了できなくなるため
const shutdown = () => (io ? io.close(() => process.exit(0)) : httpServer.close(() => process.exit(0)))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
