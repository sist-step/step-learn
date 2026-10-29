import devServer, { defaultOptions } from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

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
          const { attachScreenShare } = await server.ssrLoadModule('/src/lib/screen-share.ts')
          attachScreenShare(httpServer)
        })
      },
    },
  ],
  environments: {
    // `vite build` でクライアント（CSS/JS）→ サーバーの順にビルドされる
    client: {
      build: { outDir: 'dist/client' },
    },
    ssr: {
      build: {
        outDir: 'dist/server',
        ssr: true,
        copyPublicDir: false,
        rollupOptions: {
          input: { index: 'src/server.ts', cli: 'src/cli.ts' },
          output: { entryFileNames: '[name].js' },
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
