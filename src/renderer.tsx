import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import { Script, ViteClient } from 'vite-ssr-components/hono'
import { StyleLinks, StyleLinksResolver } from './components/style'
import { getTheme } from './lib/http'

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response | Promise<Response>
  }
}

export const renderer = jsxRenderer(({ children, title }, c) => {
  const theme = getTheme(c)
  return (
    <html lang="ja" data-theme={theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content={theme} />
        <title>{title ? `${title} | StepLearn` : 'StepLearn'}</title>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.png" type="image/png" sizes="160x160" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <ViteClient />
        <StyleLinks />
        <Script src="/src/client.ts" />
        <noscript>
          <style>{raw('body > :not(noscript) { display: none !important; }')}</style>
        </noscript>
      </head>
      <body>
        {children}
        <StyleLinksResolver />
        <noscript>
          <div class="noscript">
            <img src="/favicon.png" alt="" width={48} height={48} />
            <h1>JavaScript を有効にしてください</h1>
            <p class="muted">StepLearn は JavaScript を使って動作します。ブラウザの設定で JavaScript を有効にしてから、ページを再読み込みしてください。</p>
          </div>
        </noscript>
      </body>
    </html>
  )
})
