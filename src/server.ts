// 本番用の Node.js エントリ。開発時は Vite（@hono/vite-dev-server）が src/index.tsx を直接読み込む。
import fs from 'node:fs'
import type { Server as HttpServer } from 'node:http'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import app from './index'
import { config } from './lib/config'
import { closeDatabases } from './lib/sqlite'

// 両方を静的に import しないのは、読み込んだ時点でそれぞれの DB を開くため、使わないほうのモードの DB まで作られるため
const { db } = config.moodle ? await import('./moodle-mode/db') : await import('./lib/db')

const server = new Hono()

// ログイン画面を描いて確かめないのは、DB が読めなくなっても、ディスクがいっぱいでも、画面は描けてしまうため
server.get('/healthz', (c) => {
  try {
    db.run(sql`select 1`)
    fs.accessSync(path.dirname(config.databasePath), fs.constants.W_OK)
    return c.text('ok')
  } catch (e) {
    console.error('ヘルスチェックに失敗しました', e)
    return c.text('unhealthy', 503)
  }
})

// ビルド済みの CSS/JS はファイル名にハッシュが付くので長期キャッシュできる
server.use(
  '/assets/*',
  serveStatic({
    root: './dist/client',
    precompressed: true,
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
// 両方を静的に import しないのは、通常モードの権限の確認が step-learn.db を開くので、Moodle モードでも作られてしまうため
const { attach } = config.moodle ? await import('./moodle-mode/screen-share') : await import('./features/screen/screen-share-access')
const io = attach(httpServer as HttpServer)
const collab = config.moodle ? await import('./moodle-mode/collab') : await import('./features/collab/collab-access')
const collabIo = collab.attach(httpServer as HttpServer)
const presentation = config.moodle
  ? await import('./moodle-mode/presentation')
  : await import('./features/presentation/presentation-access')
const presentationIo = presentation.attach(httpServer as HttpServer)
const { flushCollabRooms } = await import('./features/collab/collab-server')

// 処理中の要求を待ち続けないのは、AI の応答のストリームなどが終わらないと、Docker が待ち切れずに強制終了し（compose.yaml の stop_grace_period）、DB を閉じられないため
const SHUTDOWN_DEADLINE = 20_000

const exit = () => {
  closeDatabases()
  process.exit(0)
}

let stopping = false
// httpServer.close だけにしないのは、開いたままの socket.io の接続が残って終了できなくなるため
const shutdown = () => {
  if (stopping) return
  stopping = true
  // 接続を閉じる前に保存するのは、閉じたあとの保存は部屋ごとに切断の順で走り、終わる前に process.exit が来ることがあるため
  flushCollabRooms()
  setTimeout(exit, SHUTDOWN_DEADLINE)
  void presentationIo.close()
  void collabIo.close()
  void io.close(exit)
  ;(httpServer as HttpServer).closeIdleConnections()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
