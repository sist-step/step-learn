import devServer, { defaultOptions } from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

export default defineConfig({
  plugins: [
    devServer({
      entry: 'src/index.tsx',
      adapter: nodeAdapter,
      exclude: [...defaultOptions.exclude, /^\/src\/.+/],
    }),
    ssrPlugin(),
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
        rollupOptions: { input: 'src/server.ts', output: { entryFileNames: 'index.js' } },
      },
    },
  },
  // 依存もまとめて 1 ファイルにバンドルし、本番では node_modules を不要にする
  ssr: { noExternal: true },
})
