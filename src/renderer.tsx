import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response | Promise<Response>
  }
}

// ホバー時にページを先読みし、MPA でも瞬時に遷移させる（対応ブラウザのみ）
const speculationRules = JSON.stringify({
  prefetch: [{ where: { and: [{ href_matches: '/*' }, { not: { selector_matches: '[data-no-prefetch]' } }] }, eagerness: 'moderate' }],
})

export const renderer = jsxRenderer(({ children, title }) => {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{title ? `${title} | StepLearn` : 'StepLearn'}</title>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.png" type="image/png" sizes="160x160" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.ts" />
        <script type="speculationrules" dangerouslySetInnerHTML={{ __html: speculationRules }} />
      </head>
      <body>{children}</body>
    </html>
  )
})
