/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 全ページ共通の小さな進化的拡張。JS がなくてもすべての操作はフォーム送信で動く。

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

// --- サイドバーを畳む（送信せずに切り替え、同じクッキーでサーバーにも伝える）
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLButtonElement>('[data-sidebar-toggle]')
  const app = t?.closest('.app')
  if (!t || !app) return
  e.preventDefault()
  const collapsed = app.classList.toggle('is-collapsed')
  document.cookie = `sidebar=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  const label = collapsed ? 'サイドバーを開く' : 'サイドバーを畳む'
  t.value = collapsed ? '0' : '1'
  t.setAttribute('aria-expanded', String(!collapsed))
  t.setAttribute('aria-label', label)
  t.title = label
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
$$('[data-toast]').forEach((el) => dismissLater(el, 5000))
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
  if (!dialog) {
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

// --- コピー
document.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-copy]')
  if (!btn) return
  try {
    await navigator.clipboard.writeText(btn.dataset.copy!)
    toast('コピーしました')
  } catch {
    toast('コピーできませんでした', 'error')
  }
})

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
$$<HTMLDetailsElement>('details.section-card').forEach((d) => {
  if (collapsed.has(d.id) && location.hash !== `#${d.id}`) d.open = false
  d.addEventListener('toggle', () => {
    d.open ? collapsed.delete(d.id) : collapsed.add(d.id)
    try {
      localStorage.setItem(KEY, JSON.stringify([...collapsed].slice(-200)))
    } catch {}
  })
})

// --- ファイル選択時にタイトルが空なら自動入力
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file' || !input.files?.[0]) return
  const title = input.form?.querySelector<HTMLInputElement>('input[name=title]')
  if (title && !title.value) title.value = input.files[0].name.replace(/\.[^.]+$/, '')
})

export {}
