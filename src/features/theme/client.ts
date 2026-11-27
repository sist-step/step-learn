/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { DEFAULT_THEME, THEME_LABELS, isThemeName, type ThemeName, type ThemeScript } from './theme'
import { toast } from '../../client/core'
import { reducedMotion } from '../../client/dom'

// 今のテーマ以外を最初の読み込みに含めないのは、使わないテーマの分まで全員が毎回ダウンロードすることになるため
const SCRIPTS: Record<ThemeName, (() => Promise<{ default: ThemeScript }>) | null> = {
  glass: null,
  soft: null,
  cute: () => import('./themes/cute'),
}

const themeOf = (doc: Document): ThemeName => {
  const theme = doc.documentElement.dataset.uiTheme
  return isThemeName(theme) ? theme : DEFAULT_THEME
}

let running: ThemeScript | null = null
let requested: ThemeName = DEFAULT_THEME

async function loadScript(theme: ThemeName) {
  const load = SCRIPTS[theme]
  return load ? (await load()).default : null
}

/** 最初の表示で、サーバーが描いたテーマの JS を動かす */
export function startTheme() {
  const theme = (requested = themeOf(document))
  loadScript(theme)
    .then((script) => {
      if (requested !== theme || !script) return
      running = script
      script.start()
      script.page()
    })
    .catch(() => {})
}

export const themePage = () => running?.page()

// <link> を外さないのは、テーマの CSS は <html data-ui-theme> で範囲を絞ってあり、残しても効かないうえ、戻したときにすぐ切り替えられるため
function loadSheet(next: HTMLLinkElement) {
  const href = next.getAttribute('href')
  if ([...document.head.querySelectorAll('link[data-theme-sheet]')].some((el) => el.getAttribute('href') === href)) return Promise.resolve()
  const link = document.importNode(next)
  document.head.append(link)
  return new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => (link.remove(), reject(new Error(`${href} を読み込めませんでした`))), { once: true })
  })
}

/**
 * 遷移先のページのテーマが今と違えば、そのテーマの CSS と JS を読み込み終えてから、当てる関数を返す。
 * 当てるのは本文を差し替えるときにするので、ここでは当てない（client.ts の visit）
 */
export async function prepareTheme(doc: Document): Promise<(() => void) | null> {
  const next = themeOf(doc)
  if (next === themeOf(document)) return null
  requested = next
  const sheet = doc.head.querySelector<HTMLLinkElement>('link[data-theme-sheet]')
  const loading = shown?.theme === next ? shown : null
  loading?.plan([...(sheet ? (['style'] as const) : []), ...(SCRIPTS[next] ? (['script'] as const) : [])])
  let script: ThemeScript | null = null
  try {
    ;[, script] = await Promise.all([
      sheet && loadSheet(sheet).then(() => loading?.done('style')),
      loadScript(next).then((s) => (loading?.done('script'), s)),
    ])
  } catch {
    toast('テーマを読み込めませんでした。ページを再読み込みしてください。', 'error')
  }
  loading?.applying()
  return () => {
    if (requested !== next) return
    running?.stop()
    running = script
    document.documentElement.dataset.uiTheme = next
    script?.start()
  }
}

// --- 切り替えの待ち時間に出す画面
// 本文（body）の中に置かないのは、遷移で body ごと差し替わり、読み込みの途中で消えてしまうため
type Step = 'style' | 'script'

const STEP_LABELS: Record<Step | 'save' | 'apply', string> = {
  save: 'テーマを保存しています',
  style: '見た目を読み込んでいます',
  script: '動きを読み込んでいます',
  apply: '切り替えています',
}

// 一瞬で消さないのは、読み込み済みのテーマに戻すときなどに、何が起きたかわからないまま画面がちらつくため
const MIN_SHOWN = 900

type Loading = {
  theme: ThemeName
  plan(steps: readonly Step[]): void
  done(step: Step): void
  applying(): void
}

let shown: Loading | null = null

function showLoading(theme: ThemeName, preview: Element | null) {
  const root = document.createElement('div')
  root.className = 'theme-loading'
  root.setAttribute('role', 'status')
  root.innerHTML = `<div class="theme-loading-panel"><div class="theme-loading-stage"></div><p class="theme-loading-title"></p><div class="theme-loading-bar"><span></span></div><p class="theme-loading-step small muted"></p></div>`
  const stage = root.querySelector('.theme-loading-stage')!
  if (preview) stage.append(preview.cloneNode(true))
  root.querySelector('.theme-loading-title')!.textContent = `「${THEME_LABELS[theme]}」に切り替えます`
  const bar = root.querySelector<HTMLElement>('.theme-loading-bar > span')!
  const label = root.querySelector('.theme-loading-step')!
  document.documentElement.append(root)

  const at = performance.now()
  let steps: Step[] = []
  let finished = 0
  const progress = (ratio: number, text: string) => {
    bar.style.setProperty('--progress', String(ratio))
    label.textContent = `${text}…`
  }
  progress(0.1, STEP_LABELS.save)

  const loading: Loading = {
    theme,
    plan(planned) {
      steps = [...planned]
      progress(0.25, STEP_LABELS[steps[0] ?? 'apply'])
    },
    done(step) {
      if (!steps.includes(step)) return
      finished += 1
      const rest = steps.find((s, i) => i >= finished)
      progress(0.25 + (0.65 * finished) / steps.length, STEP_LABELS[rest ?? 'apply'])
    },
    applying() {
      progress(1, STEP_LABELS.apply)
    },
  }
  shown = loading

  // 遷移の終わり（成功でも失敗でも client.ts が aria-busy を外す）で閉じるのは、送信に失敗したときにこの画面が残り続けないようにするため
  const observer = new MutationObserver(() => {
    if (document.documentElement.hasAttribute('aria-busy')) return
    observer.disconnect()
    if (shown === loading) shown = null
    const leave = () => {
      root.classList.add('is-leaving')
      if (reducedMotion()) return root.remove()
      root.addEventListener('animationend', (e) => e.target === root && root.remove())
    }
    setTimeout(leave, Math.max(0, MIN_SHOWN - (performance.now() - at)))
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['aria-busy'] })
}

// preventDefault して自分で送らないのは、送信と遷移は client.ts の再読み込みなしの遷移が行い、ここでは読み込みの画面を出すだけで済むため
document.addEventListener('submit', (e) => {
  const form = (e.target as Element).closest('form[data-theme-form]')
  const theme = (e.submitter as HTMLButtonElement | null)?.value
  if (!form || !isThemeName(theme) || theme === themeOf(document)) return
  showLoading(theme, form.querySelector(`[data-theme-preview="${theme}"]`))
})
