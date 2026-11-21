import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
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

// VS Code（src/features/code/vscode-workbench.ts）の部品。開発時に Vite の自動の検出に任せないのは、見つかるたびにまとめ直してページを読み込み直すうえ、
// まとめる前はファイルが数千あり、ブラウザが 1 つずつ読み込んで固まるため
const vscodePackages = Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).devDependencies).filter((name) =>
  name.startsWith('@codingame/monaco-vscode-'),
)

const VSCODE_CSS = /node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/
const VSCODE_JS = /\/node_modules\/@codingame\/monaco-vscode-.*\.js$/
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=\S+\s*$/

const COMPRESSIBLE = /\.(js|css|json|txt|svg|wasm|html)$/

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
      name: 'vscode-no-source-maps',
      apply: 'serve',
      enforce: 'pre',
      // 開発時にソースマップを読ませないのは、VS Code の部品のソースマップが同梱されていない元のファイルを指していて、
      // 開くたびに「points to a source file outside its package」の警告がサーバーのログを埋めるため（本番は drop-vscode-source-maps で配らない）
      async load(id) {
        // ?v= だけは受けるのは、Vite が先にまとめた部品から読むときに、版の印として付けるため（?worker などは別の読み方なので触らない）
        const [file, query] = id.split('?')
        if (!VSCODE_JS.test(file) || (query && !/^v=\w+$/.test(query))) return null
        const code = await fs.promises.readFile(file, 'utf8').catch(() => null)
        return code === null ? null : { code: code.replace(SOURCE_MAP_COMMENT, ''), map: null }
      },
    },
    {
      name: 'vscode-css-inline',
      enforce: 'pre',
      // ページの <head> に読み込ませず文字列で受け取るのは、VS Code を Shadow DOM の中に置き（src/features/code/vscode-workbench.ts）、
      // STEP Learn の CSS と互いに効かないようにするため。VS Code がその文字列を Shadow DOM に入れる
      async resolveId(source, importer, options) {
        const resolved = await this.resolve(source, importer, options)
        if (!resolved || !VSCODE_CSS.test(resolved.id)) return null
        return { ...resolved, id: `${resolved.id}?inline` }
      },
    },
    {
      name: 'drop-vscode-source-maps',
      // 配らないのは、VS Code の部品が同梱しているソースマップだけで約 50MB あり、利用者は使わないため
      generateBundle(_, bundle) {
        if (this.environment.name !== 'client') return
        for (const name of Object.keys(bundle)) if (name.endsWith('.map')) delete bundle[name]
      },
    },
    {
      name: 'precompress-assets',
      // 配信のたびに圧縮しないのは、VS Code の部品だけで数十 MB あり、開くたびにサーバーが圧縮し直すことになるため（src/server.ts の precompressed が返す）
      async writeBundle(options, bundle) {
        if (this.environment.name !== 'client' || !options.dir) return
        const brotli = promisify(zlib.brotliCompress)
        const targets = Object.keys(bundle).filter((name) => COMPRESSIBLE.test(name))
        await Promise.all(
          targets.map(async (name) => {
            const file = path.join(options.dir!, name)
            const source = await fs.promises.readFile(file)
            if (source.length < 1024) return
            const compressed = await brotli(source, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
            await fs.promises.writeFile(`${file}.br`, compressed)
          }),
        )
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
            config.moodle ? '/src/moodle-mode/screen-share.ts' : '/src/features/screen/screen-share-access.ts',
          )
          attach(httpServer)
          const collab = await server.ssrLoadModule(config.moodle ? '/src/moodle-mode/collab.ts' : '/src/features/collab/collab-access.ts')
          collab.attach(httpServer)
          const presentation = await server.ssrLoadModule(
            config.moodle ? '/src/moodle-mode/presentation.ts' : '/src/features/presentation/presentation-access.ts',
          )
          presentation.attach(httpServer)
        })
      },
    },
  ],
  optimizeDeps: {
    include: [...vscodePackages, '@codingame/monaco-vscode-api/extensions', 'vscode/localExtensionHost', 'marked'],
  },
  // VS Code の Worker が import を使うため
  worker: { format: 'es' },
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
          input: { index: 'src/server.ts', cli: 'src/cli.ts', backup: 'src/backup.ts' },
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
