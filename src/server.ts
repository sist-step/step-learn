// 本番用の Node.js エントリ。開発時は Vite（@hono/vite-dev-server）が src/index.tsx を直接読み込む。
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
server.route('/', app)

const httpServer = serve({ fetch: server.fetch, port: config.port }, (info) => {
  console.log(`StepLearn listening on http://localhost:${info.port}`)
})

const shutdown = () => httpServer.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
