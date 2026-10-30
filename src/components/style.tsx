import type { HtmlEscapedCallback } from 'hono/utils/html'
import { raw } from 'hono/html'
import { useRequestContext } from 'hono/jsx-renderer'
import { Link } from 'vite-ssr-components/hono'
import type { AppEnv } from '../lib/types'

// 並びはカスケードの順。同じ詳細度のルールがぶつかると後ろのファイルが勝つので、ページごとに読み込む組み合わせが変わってもこの順で出す
export const STYLESHEETS = [
  '/src/styles/base.css',
  '/src/components/button.css',
  '/src/components/form.css',
  '/src/components/markdown.css',
  '/src/components/overlay.css',
  '/src/components/layout.css',
  '/src/components/toast.css',
  '/src/components/ui.css',
  '/src/components/card.css',
  '/src/components/course.css',
  '/src/components/art.css',
  '/src/components/auth.css',
  '/src/routes/dashboard/dashboard.css',
  '/src/routes/courses/courses.css',
  '/src/routes/participants/participants.css',
  '/src/routes/content/content.css',
  '/src/routes/account/account.css',
  '/src/routes/screen/screen.css',
] as const

export type StyleSheet = (typeof STYLESHEETS)[number]

const BASE: StyleSheet = '/src/styles/base.css'
const PLACEHOLDER = '<!--stylesheets-->'

export function useStyle(...sheets: StyleSheet[]) {
  const c = useRequestContext<AppEnv>()
  const used = c.get('styles') ?? new Set()
  sheets.forEach((s) => used.add(s))
  c.set('styles', used)
}

export const Styles = ({ use }: { use: StyleSheet[] }) => {
  useStyle(...use)
  return null
}

// <head> を書く時点ではまだ本文を描いておらず、どの部品が使われるか分からないので、<head> には目印だけを置き、本文の後ろで <link> に置き換える
export const StyleLinks = () => raw(PLACEHOLDER)

// <head> の中で置き換えないのは、hono が <head> の中身を本文より先に文字列にして、そこに置いたコールバックをすぐに実行するため
// 置き換えを同期で行うのは、描き終えた文字列をコールバックの完了を待たずに確定させる経路があるため
export const StyleLinksResolver = () => {
  const c = useRequestContext<AppEnv>()
  const replace: HtmlEscapedCallback = ({ buffer }) => {
    if (!buffer) return
    const used = c.get('styles') ?? new Set()
    const links = STYLESHEETS.filter((href) => href === BASE || used.has(href))
      // oxlint-disable-next-line typescript/no-base-to-string -- Link は非同期の子を持たないので、Promise ではなく描画済みの文字列が返る
      .map((href) => String(Link({ href, rel: 'stylesheet', 'data-style-order': String(STYLESHEETS.indexOf(href)) })))
      .join('')
    buffer[0] = buffer[0].replace(PLACEHOLDER, links)
  }
  return raw('', [replace])
}
