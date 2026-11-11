import fs from 'node:fs'
import devServer, { defaultOptions } from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

// プラグインの自動検出（ソース中の <Link href>）に任せないのは、部品が描画時に必要な CSS を登録する方式（src/components/style.tsx）でソースに <Link> が書かれず、ビルド対象として見つからないため
const stylesheets = fs.globSync('src/**/*.css').sort()

const PDFJS_DIR = 'node_modules/pdfjs-dist'
const PDFJS_ASSETS = ['cmaps', 'standard_fonts', 'wasm']
// 版のないパスにしないのは、/assets/ は長期キャッシュされるので、pdf.js を上げたあとも古い wasm を読み込み続けるため（src/pdf-viewer.ts が同じパスを組み立てる）
const pdfjsBase = `/assets/pdfjs-${JSON.parse(fs.readFileSync(`${PDFJS_DIR}/package.json`, 'utf8')).version}/`

export default defineConfig(({ command }) => ({
  plugins: [
    devServer({
      entry: 'src/index.tsx',
      adapter: nodeAdapter,
      exclude: [...defaultOptions.exclude, /^\/src\/.+/, new RegExp(`^${pdfjsBase}`)],
      // 既定の body への差し込みを使わないのは、専用スクリプトを持つページと見なされ、再読み込みなしで遷移できなくなるため（renderer の ViteClient が head で読み込む）
      injectClientScript: false,
    }),
    ssrPlugin(),
    {
      name: 'pdfjs-assets',
      configureServer(server) {
        server.middlewares.use(pdfjsBase, (req, res, next) => {
          const name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).slice(1)
          const [dir, file, ...rest] = name.split('/')
          if (!PDFJS_ASSETS.includes(dir) || !file || rest.length || file.startsWith('.')) return next()
          const path = `${PDFJS_DIR}/${dir}/${file}`
          if (!fs.existsSync(path)) return next()
          if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
          fs.createReadStream(path).pipe(res)
        })
      },
      generateBundle() {
        if (this.environment.name !== 'client') return
        for (const dir of PDFJS_ASSETS) {
          for (const file of fs.readdirSync(`${PDFJS_DIR}/${dir}`)) {
            this.emitFile({
              type: 'asset',
              fileName: `${pdfjsBase.slice(1)}${dir}/${file}`,
              source: fs.readFileSync(`${PDFJS_DIR}/${dir}/${file}`),
            })
          }
        }
      },
    },
    {
      name: 'screen-share',
      configureServer(server) {
        const httpServer = server.httpServer
        // ここで直接 import しないのは、アプリとは別のモジュールインスタンスになり、ページ側から配信中かどうかを参照できなくなるため
        httpServer?.once('listening', async () => {
          const { config } = await server.ssrLoadModule('/src/lib/config.ts')
          const { attach } = await server.ssrLoadModule(
            config.moodle ? '/src/moodle-mode/screen-share.ts' : '/src/lib/screen-share-access.ts',
          )
          attach(httpServer)
        })
      },
    },
  ],
  // 既定の監視範囲のままにしないのは、worktree の中の編集や npm ci にまでメインの開発サーバーが反応してしまうため
  server: { watch: { ignored: ['**/.claude/worktrees/**'] } },
  environments: {
    // `vite build` でクライアント（CSS/JS）→ サーバーの順にビルドされる
    client: {
      build: { outDir: 'dist/client', rollupOptions: { input: stylesheets } },
    },
    ssr: {
      build: {
        outDir: 'dist/server',
        ssr: true,
        copyPublicDir: false,
        rollupOptions: {
          input: { index: 'src/server.ts', cli: 'src/cli.ts' },
          output: {
            entryFileNames: '[name].js',
            // 既定のままにしないのは、共有のチャンク（lib/db.ts を含む auth など）を補助コードのために読み込んだだけで、そのチャンクの
            // モジュールの本体まで動き、Moodle モードでも step-learn.db を開こうとするため。使うモジュールの本体だけを動かす
            strictExecutionOrder: true,
          },
        },
      },
    },
  },
  // 依存もまとめて 1 ファイルにバンドルする。better-sqlite3 だけはネイティブアドオン（.node）を
  // 実行時に読み込むためバンドルできず、本番でも node_modules に置く
  // 開発時に socket.io・@anthropic-ai/sdk・yauzl もバンドルしないのは、Vite の SSR モジュールランナーが CommonJS
  // （SDK は依存の standardwebhooks）をそのまま評価できないため（本番ビルドでは rolldown が変換するのでバンドルできる）
  ssr: {
    noExternal: true,
    external: command === 'serve' ? ['better-sqlite3', 'socket.io', '@anthropic-ai/sdk', 'yauzl'] : ['better-sqlite3'],
  },
}))
