/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 全ページ共通のクライアント処理。JS が無効な環境では renderer の noscript がアプリを使えなくする。

import checkSvg from 'heroicons/24/outline/check.svg?raw'

const $$ = <T extends Element>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)]

// --- モバイルのサイドバー
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest('[data-nav-toggle]')
  if (t) document.body.classList.toggle('nav-open')
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.body.classList.remove('nav-open')
})

// --- サイドバーを畳む（クッキーでサーバーにも伝え、次の表示から同じ状態で描く）
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLButtonElement>('[data-sidebar-toggle]')
  const app = t?.closest('.app')
  if (!t || !app) return
  e.preventDefault()
  const collapsed = app.classList.toggle('is-collapsed')
  document.cookie = `sidebar=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  const label = collapsed ? 'サイドバーを開く' : 'サイドバーを畳む'
  t.setAttribute('aria-expanded', String(!collapsed))
  t.setAttribute('aria-label', label)
  t.title = label
})

// --- テーマの切り替え（クッキーでサーバーにも伝え、次の表示から同じテーマで描く）
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLButtonElement>('[data-theme-toggle]')
  if (!t) return
  e.preventDefault()
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', theme)
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`
})

// --- トースト
function toast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  const host = document.querySelector('.toasts')
  if (!host) return
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.setAttribute('role', 'status')
  el.textContent = message
  host.appendChild(el)
  dismissLater(el)
}
function dismissLater(el: Element, ms = 4000) {
  setTimeout(() => {
    el.classList.add('leaving')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }, ms)
}
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('[data-toast-close]')
  btn?.closest('.toast')?.remove()
})

// --- パスワード表示切り替え
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-toggle-password]')
  if (!btn) return
  const input = btn.parentElement?.querySelector('input')
  if (!input) return
  const show = input.type === 'password'
  input.type = show ? 'text' : 'password'
  btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示')
  btn.classList.toggle('on', show)
})

// --- 確認ダイアログ（ネイティブ confirm の代わり）
let dialog: HTMLDialogElement | null = null
function confirmDialog(message: string): Promise<boolean> {
  if (!dialog?.isConnected) {
    dialog = document.createElement('dialog')
    dialog.className = 'dialog'
    dialog.innerHTML = `<form method="dialog"><p class="dialog-msg"></p><div class="form-actions">
      <button value="cancel" class="btn btn-ghost">キャンセル</button>
      <button value="ok" class="btn btn-danger">実行する</button></div></form>`
    document.body.appendChild(dialog)
    dialog.addEventListener('click', (e) => e.target === dialog && dialog!.close('cancel'))
  }
  dialog.querySelector('.dialog-msg')!.textContent = message
  dialog.returnValue = ''
  dialog.showModal()
  ;(dialog.querySelector('[value=cancel]') as HTMLButtonElement).focus()
  return new Promise((resolve) => dialog!.addEventListener('close', () => resolve(dialog!.returnValue === 'ok'), { once: true }))
}

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement
  const msg = form.dataset.confirm
  if (msg && form.dataset.confirmed !== '1') {
    e.preventDefault()
    if (await confirmDialog(msg)) {
      form.dataset.confirmed = '1'
      form.requestSubmit()
    }
    return
  }
  if (form.hasAttribute('data-complete')) return handleComplete(e, form)

  // 二重送信防止とローディング表示
  if (form.hasAttribute('data-loading-form')) {
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])')
    if (btn) {
      setTimeout(() => {
        btn.disabled = true
        btn.classList.add('loading')
      })
    }
  }
})

// --- select 変更で自動送信
document.addEventListener('change', (e) => {
  const form = (e.target as Element).closest<HTMLFormElement>('form[data-autosubmit]')
  form?.requestSubmit()
})

// --- 完了トグルを画面遷移なしで反映
async function handleComplete(e: SubmitEvent, form: HTMLFormElement) {
  e.preventDefault()
  const btn = form.querySelector('button')!
  const next = btn.getAttribute('aria-pressed') !== 'true'
  setCompleteUI(form, next) // 楽観的更新
  try {
    const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error()
    const data: { completed: boolean; done: number; total: number } = await res.json()
    setCompleteUI(form, data.completed)
    updateProgress(data.done, data.total)
    if (data.completed && data.done === data.total && data.total > 0) toast('🎉 コースのすべてのアイテムを完了しました！')
  } catch {
    setCompleteUI(form, !next)
    toast('更新できませんでした。通信状況を確認してください。', 'error')
  }
}

function setCompleteUI(form: HTMLFormElement, done: boolean) {
  const btn = form.querySelector('button')!
  btn.setAttribute('aria-pressed', String(done))
  btn.setAttribute('aria-label', done ? '未完了に戻す' : '完了にする')
  form.closest('.item-row')?.classList.toggle('is-done', done)
  const label = form.querySelector('[data-complete-label]')
  if (label) {
    label.textContent = done ? '完了済み' : '完了にする'
    btn.classList.toggle('btn-success', done)
    btn.classList.toggle('btn-primary', !done)
  }
  const id = form.action.match(/items\/(\d+)\/complete/)?.[1]
  const dot = id && document.querySelector(`[data-outline-dot="${id}"]`)
  if (dot) {
    dot.classList.toggle('done', done)
    dot.innerHTML = done
      ? checkSvg.replace('<svg ', '<svg class="icon" width="10" height="10" ')
      : ''
  }
}

function updateProgress(done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0
  $$('[data-progress-pct]').forEach((el) => (el.textContent = String(pct)))
  $$('[data-progress-done]').forEach((el) => (el.textContent = String(done)))
  $$<HTMLElement>('[data-ring]').forEach((el) => el.style.setProperty('--p', String(pct)))
  $$<HTMLElement>('[data-progress] .progress-bar').forEach((el) => (el.style.width = `${pct}%`))
}

// --- "/" で検索にフォーカス
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey) return
  const el = document.activeElement as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  const search = document.querySelector<HTMLInputElement>('[data-search]')
  if (search) {
    e.preventDefault()
    search.focus()
    search.select()
  }
})

// --- 開いた「アイテムを追加」の最初の入力にフォーカス
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement
    if (d.matches?.('[data-autofocus-details], .popover') && d.open) d.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]), textarea')?.focus()
  },
  true,
)

// --- ポップオーバーは外側クリックで閉じる
document.addEventListener('click', (e) => {
  $$<HTMLDetailsElement>('details.popover[open]').forEach((d) => {
    if (!d.contains(e.target as Node)) d.open = false
  })
})

// --- セクションの開閉状態を記憶（端末ごと）
const KEY = 'sl:collapsed'
const readCollapsed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
const collapsed = new Set(readCollapsed())
const restoreCollapsed = () =>
  $$<HTMLDetailsElement>('details.section-card').forEach((d) => {
    if (collapsed.has(d.id) && location.hash !== `#${d.id}`) d.open = false
  })
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement
    if (!d.matches?.('details.section-card')) return
    d.open ? collapsed.delete(d.id) : collapsed.add(d.id)
    try {
      localStorage.setItem(KEY, JSON.stringify([...collapsed].slice(-200)))
    } catch {}
  },
  true,
)

// --- ファイル選択時にタイトルが空なら自動入力
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file' || !input.files?.[0]) return
  const title = input.form?.querySelector<HTMLInputElement>('input[name=title]')
  if (title && !title.value) title.value = input.files[0].name.replace(/\.[^.]+$/, '')
})

// --- ページ遷移を再読み込みなしで行う（JS がなければ通常のリンク・フォーム送信で遷移する）
type Page = { url: string; redirected: boolean; isHtml: boolean; html: string }
type Visit = { method?: 'GET' | 'POST'; body?: FormData | URLSearchParams; pop?: boolean; onFail?: () => void }

const PREFETCH_TTL = 10_000
const prefetched = new Map<string, { at: number; page: Promise<Page> }>()
const urlKey = (url: URL) => url.origin + url.pathname + url.search
let renderedKey = urlKey(new URL(location.href))
let navController: AbortController | null = null

history.scrollRestoration = 'manual'
const saveScroll = () => history.replaceState({ ...history.state, scrollY }, '')
addEventListener('pagehide', saveScroll)
const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
if (navType && navType !== 'navigate' && history.state?.scrollY) scrollTo(0, history.state.scrollY)

function linkUrl(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-reload')) return null
  const url = new URL(a.href)
  if (url.origin !== location.origin) return null
  // 同じページ内のアンカーはブラウザに任せないとスクロールの挙動が変わる
  if (url.hash && urlKey(url) === urlKey(new URL(location.href))) return null
  return { a, url }
}

async function fetchPage(url: URL, init: RequestInit = {}): Promise<Page> {
  const res = await fetch(url, { ...init, headers: { Accept: 'text/html' } })
  const isHtml = (res.headers.get('content-type') ?? '').includes('text/html')
  if (!isHtml) await res.body?.cancel()
  return { url: res.url, redirected: res.redirected, isHtml, html: isHtml ? await res.text() : '' }
}

function takePrefetched(url: URL) {
  const hit = prefetched.get(urlKey(url))
  prefetched.delete(urlKey(url))
  return hit && Date.now() - hit.at < PREFETCH_TTL ? hit.page : null
}

// 遷移中に先読みしないのは、リダイレクト先で表示するはずのトースト（flash クッキー）を先読みが受け取ってしまうため
function prefetch(url: URL) {
  if (navController) return
  const hit = prefetched.get(urlKey(url))
  if (hit && Date.now() - hit.at < PREFETCH_TTL) return
  const page = fetchPage(url)
  page.catch(() => prefetched.delete(urlKey(url)))
  prefetched.set(urlKey(url), { at: Date.now(), page })
}

const assetSignature = (doc: Document) =>
  $$<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel=stylesheet]', doc.head)
    .map((el) => el.getAttribute('src') ?? el.getAttribute('href'))
    .join()
// 差し替えた body の script は実行されないので、専用スクリプトを持つページや、デプロイで CSS/JS が変わったときは読み込み直す
const needsFullLoad = (doc: Document) => doc.body.querySelector('script') !== null || assetSignature(doc) !== assetSignature(document)

function render(doc: Document, scroll: () => void) {
  // DOMParser はスクリプト無効として解析し noscript の中身を要素にするので、そのまま差し込むと表示されるブラウザがある
  $$('noscript', doc.body).forEach((el) => el.remove())
  const swap = () => {
    document.title = doc.title
    document.body.replaceWith(doc.body)
    initPage()
    document.querySelector<HTMLElement>('[autofocus]')?.focus()
    scroll()
  }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap()
  return document.startViewTransition(swap).updateCallbackDone
}

function scrollToHash(hash: string) {
  const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)))
  el ? el.scrollIntoView() : scrollTo(0, 0)
}

async function visit(url: URL, { method = 'GET', body, pop = false, onFail }: Visit = {}) {
  navController?.abort()
  const controller = (navController = new AbortController())
  if (!pop) saveScroll()
  document.documentElement.setAttribute('aria-busy', 'true')
  try {
    const page = await ((method === 'GET' && !pop && takePrefetched(url)) || fetchPage(url, { method, body, signal: controller.signal }))
    if (controller.signal.aborted) return
    if (!page.isHtml) return location.assign(page.url)
    const doc = new DOMParser().parseFromString(page.html, 'text/html')
    if (needsFullLoad(doc)) return location.assign(page.url)

    const next = new URL(page.url)
    if (!page.redirected) next.hash = url.hash
    const sameUrl = urlKey(next) === urlKey(new URL(location.href))
    // POST の結果をそのまま描画したときは URL を変えない。フォームの送信先に GET の画面があるとは限らないため
    if (!pop && (method === 'GET' || page.redirected)) {
      if (sameUrl) history.replaceState({ scrollY: 0 }, '', next)
      else history.pushState({ scrollY: 0 }, '', next)
    }
    renderedKey = urlKey(new URL(location.href))
    const keepScroll = method === 'POST' && sameUrl && !next.hash
    const y = scrollY
    await render(doc, () => (pop ? scrollTo(0, history.state?.scrollY ?? 0) : keepScroll ? scrollTo(0, y) : scrollToHash(next.hash)))
  } catch {
    if (controller.signal.aborted) return
    if (method === 'GET') return location.assign(url)
    onFail?.()
    toast('送信できませんでした。通信状況を確認してください。', 'error')
  } finally {
    if (navController === controller) {
      navController = null
      document.documentElement.removeAttribute('aria-busy')
    }
  }
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const link = linkUrl(e.target)
  if (!link) return
  e.preventDefault()
  visit(link.url)
})

document.addEventListener('submit', (e) => {
  prefetched.clear()
  if (e.defaultPrevented) return
  const form = e.target as HTMLFormElement
  const submitter = e.submitter as HTMLButtonElement | HTMLInputElement | null
  const method = submitter?.hasAttribute('formmethod') ? submitter.formMethod : form.method
  const target = (submitter?.getAttribute('formtarget') ?? form.getAttribute('target')) || '_self'
  if (method === 'dialog' || target !== '_self' || form.hasAttribute('data-reload')) return
  const url = new URL(submitter?.hasAttribute('formaction') ? submitter.formAction : form.action)
  if (url.origin !== location.origin) return
  e.preventDefault()

  const data = new FormData(form, submitter)
  const params = new URLSearchParams([...data].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]))
  if (method === 'get') {
    url.search = params.toString()
    return visit(url)
  }
  const enctype = submitter?.hasAttribute('formenctype') ? submitter.formEnctype : form.enctype
  visit(url, {
    method: 'POST',
    body: enctype === 'multipart/form-data' ? data : params,
    onFail: () => {
      delete form.dataset.confirmed
      $$<HTMLButtonElement>('button.loading', form).forEach((btn) => {
        btn.disabled = false
        btn.classList.remove('loading')
      })
    },
  })
})

addEventListener('popstate', () => {
  const url = new URL(location.href)
  if (urlKey(url) !== renderedKey) visit(url, { pop: true })
})

// --- ホバーしたリンクを先読みして、クリック後すぐに表示する
let hoverTimer = 0
const prefetchable = (target: EventTarget | null) => {
  const link = linkUrl(target)
  return link && !link.a.hasAttribute('data-no-prefetch') && urlKey(link.url) !== urlKey(new URL(location.href)) ? link.url : null
}
document.addEventListener('mouseover', (e) => {
  const url = prefetchable(e.target)
  clearTimeout(hoverTimer)
  if (url) hoverTimer = window.setTimeout(() => prefetch(url), 80)
})
document.addEventListener('mouseout', () => clearTimeout(hoverTimer))
document.addEventListener(
  'touchstart',
  (e) => {
    const url = prefetchable(e.target)
    if (url) prefetch(url)
  },
  { passive: true },
)

// --- 表示のたびに行う初期化（最初の表示と再読み込みなしの遷移の両方）
function initPage() {
  $$('[data-toast]').forEach((el) => dismissLater(el, 5000))
  restoreCollapsed()
}
initPage()

export {}
