import fs from 'node:fs'
import devServer, { defaultOptions } from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

// プラグインの自動検出（ソース中の <Link href>）に任せないのは、部品が描画時に必要な CSS を登録する方式（src/components/style.tsx）でソースに <Link> が書かれず、ビルド対象として見つからないため
const stylesheets = fs.globSync('src/**/*.css').sort()

export default defineConfig(({ command }) => ({
  plugins: [
    devServer({
      entry: 'src/index.tsx',
      adapter: nodeAdapter,
      exclude: [...defaultOptions.exclude, /^\/src\/.+/],
      // 既定の body への差し込みを使わないのは、専用スクリプトを持つページと見なされ、再読み込みなしで遷移できなくなるため（renderer の ViteClient が head で読み込む）
      injectClientScript: false,
    }),
    ssrPlugin(),
    {
      name: 'screen-share',
      configureServer(server) {
        const httpServer = server.httpServer
        // ここで直接 import しないのは、アプリとは別のモジュールインスタンスになり、ページ側から配信中かどうかを参照できなくなるため
        httpServer?.once('listening', async () => {
          // Moodle モードで読み込まないのは、画面共有を使わないうえ、読み込むと step-learn.db を開いてしまうため
          const { config } = await server.ssrLoadModule('/src/lib/config.ts')
          if (config.moodle) return
          const { attachScreenShare } = await server.ssrLoadModule('/src/lib/screen-share.ts')
          attachScreenShare(httpServer)
        })
      },
    },
  ],
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
  // 開発時に socket.io もバンドルしないのは、Vite の SSR モジュールランナーが CommonJS をそのまま評価できないため
  // （本番ビルドでは rolldown が変換するのでバンドルできる）
  ssr: { noExternal: true, external: command === 'serve' ? ['better-sqlite3', 'socket.io'] : ['better-sqlite3'] },
}))
