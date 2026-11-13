/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 全ページ共通のクライアント処理。JS が無効な環境では renderer の noscript がアプリを使えなくする。

import checkSvg from 'heroicons/24/outline/check.svg?raw'
import chevronLeftSvg from 'heroicons/24/outline/chevron-left.svg?raw'
import chevronRightSvg from 'heroicons/24/outline/chevron-right.svg?raw'
import { bundlePath, isExcludedPath } from './lib/bundle'
import type { AiAgentEvent } from './lib/ai-agent'
import { formatBytes } from './lib/bytes'
import { formatDateTimeInput } from './lib/course-period'
import { isFormName, validate, type FieldErrors, type FormInput } from './lib/forms'
import { renderMarkdown } from './lib/markdown'
import { AI_PANEL_DOCKED, getSetting, setSetting, updateSetting, type Theme } from './lib/settings'

const $$ = <T extends Element>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)]

// --- モバイルのメニュー
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest('[data-nav-toggle]')
  if (t) document.body.classList.toggle('nav-open')
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.body.classList.remove('nav-open')
})

// --- テーマの切り替え（端末ごと。最初の描画前に当てるのは lib/settings.ts の BOOT_SCRIPT）
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  $$('[data-theme-toggle]').forEach((el) => el.setAttribute('aria-checked', String(theme === 'dark')))
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', theme)
  syncThemeColor()
}
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLButtonElement>('[data-theme-toggle]')
  if (!t) return
  e.preventDefault()
  const theme = getSetting('theme') === 'dark' ? 'light' : 'dark'
  setSetting('theme', theme)
  applyTheme(theme)
})

// --- 表示するコースの絞り込み（端末ごと）
// サーバーに伝えないのは、絞り込む候補のコースをすべて描いてあり、ここでは見せるかどうかを切り替えるだけで済むため
function applyCourseFilter() {
  const all = getSetting('coursesAll')
  const others = getSetting('coursesOthers')
  const root = document.documentElement
  root.toggleAttribute('data-courses-all', all)
  root.toggleAttribute('data-courses-others', others)
  $$('[data-courses-others-toggle]').forEach((el) => el.setAttribute('aria-pressed', String(others)))
  $$<HTMLInputElement>('[data-course-scope] input').forEach((input) => (input.checked = input.value === (all ? 'all' : 'current')))
  const shown = (el: Element) =>
    (all || !el.hasAttribute('data-course-ended')) && (!el.hasAttribute('data-course-unenrolled') || (all && others))
  $$('[data-course-list]').forEach((list) => {
    const count = $$('.course-card', list).filter(shown).length
    $$('[data-course-count]', list).forEach((el) => (el.textContent = String(count)))
    $$<HTMLElement>('[data-courses-empty]', list).forEach((el) => (el.hidden = count > 0))
  })
}
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest('[data-courses-others-toggle]')
  if (!t) return
  setSetting('coursesOthers', t.getAttribute('aria-pressed') !== 'true')
  applyCourseFilter()
})
document.addEventListener('change', (e) => {
  const input = e.target
  const scope = input instanceof HTMLInputElement && input.closest('[data-course-scope]')
  if (!scope) return
  const inputs = $$<HTMLInputElement>('input', scope)
  const from = inputs.find((i) => i.value === (getSetting('coursesAll') ? 'all' : 'current'))
  setSetting('coursesAll', input.value === 'all')
  if (!from || from === input || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return applyCourseFilter()
  }
  slideSegment(from, input)
  const root = document.documentElement
  const direction = inputs.indexOf(input) > inputs.indexOf(from) ? 'next' : 'prev'
  root.dataset.scopeSlide = direction
  void document.startViewTransition(applyCourseFilter).finished.finally(() => {
    if (root.dataset.scopeSlide === direction) delete root.dataset.scopeSlide
  })
})

// つまみを CSS の transition に任せないのは、選択中の背景が選択肢ごとの疑似要素で、要素をまたいで位置を補間できないため
function slideSegment(from: HTMLInputElement, to: HTMLInputElement) {
  const fromSpan = from.nextElementSibling
  const toSpan = to.nextElementSibling
  if (!(fromSpan instanceof HTMLElement) || !(toSpan instanceof HTMLElement)) return
  const f = fromSpan.getBoundingClientRect()
  const t = toSpan.getBoundingClientRect()
  fromSpan.classList.remove('is-entering')
  toSpan.classList.remove('is-entering')
  toSpan.style.setProperty('--segment-from-left', `${f.left - t.left}px`)
  toSpan.style.setProperty('--segment-from-right', `${t.right - f.right}px`)
  void toSpan.offsetWidth
  toSpan.classList.add('is-entering')
  toSpan.addEventListener('animationend', () => toSpan.classList.remove('is-entering'), { once: true })
}

// --- PDF の表示方法（components/pdf.tsx の PdfBar / PdfStage。再読み込みするとビューアーに戻る）
let pdfMode: 'viewer' | 'browser' = 'viewer'
function applyPdfMode() {
  $$<HTMLInputElement>('[data-pdf-mode] input').forEach((input) => (input.checked = input.value === pdfMode))
  $$<HTMLElement>('[data-pdf-viewer]').forEach((el) => (el.hidden = pdfMode !== 'viewer'))
  $$<HTMLIFrameElement>('iframe[data-pdf-frame]').forEach((frame) => {
    frame.hidden = pdfMode !== 'browser'
    if (!frame.hidden && !frame.getAttribute('src')) frame.src = frame.dataset.pdfFrame!
  })
}
document.addEventListener('change', (e) => {
  const input = e.target
  if (!(input instanceof HTMLInputElement) || !input.closest('[data-pdf-mode]')) return
  pdfMode = input.value === 'browser' ? 'browser' : 'viewer'
  applyPdfMode()
  initPdfViewers()
})

function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg)
}

// --- 編集モード（端末ごと）
// サーバーに伝えないのは、編集用の部品は管理できる人にだけ描いてあり、ここでは見せるかどうかを切り替えるだけで済むため
function applyEditMode(on: boolean) {
  const switches = $$('[data-edit-mode-toggle]')
  document.documentElement.toggleAttribute('data-edit-mode', on && switches.length > 0)
  switches.forEach((el) => el.setAttribute('aria-checked', String(on)))
}
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest('[data-edit-mode-toggle]')
  if (!t) return
  const on = t.getAttribute('aria-checked') !== 'true'
  applyEditMode(on)
  setSetting('editMode', on)
})

// --- トースト
function toast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  const host = document.querySelector('.toasts')
  const template = document.querySelector<HTMLTemplateElement>(`template[data-toast-template="${type}"]`)
  const el = template?.content.firstElementChild?.cloneNode(true)
  if (!host || !(el instanceof HTMLElement)) return
  el.querySelector('[data-toast-message]')!.textContent = message
  host.appendChild(el)
  dismissLater(el)
}
function dismiss(el: Element) {
  if (el.classList.contains('leaving')) return
  el.classList.add('leaving')
  el.addEventListener('animationend', () => el.remove(), { once: true })
}
function dismissLater(el: Element, ms = 4000) {
  setTimeout(() => dismiss(el), ms)
}
document.addEventListener('click', (e) => {
  const toastEl = (e.target as Element).closest('[data-toast-close]')?.closest('.toast')
  if (toastEl) dismiss(toastEl)
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

// --- 入力の検証（components/form.tsx の validateWith を付けたフォーム）
function formInput(form: HTMLFormElement) {
  const input: FormInput = {}
  for (const [key, value] of new FormData(form)) {
    const prev = input[key]
    input[key] = prev === undefined ? value : [...(Array.isArray(prev) ? prev : [prev]), value]
  }
  return input
}

function checkForm(form: HTMLFormElement): FieldErrors | null {
  const name = form.dataset.validate
  if (!isFormName(name)) return null
  const result = validate(name, formInput(form))
  return result.ok ? {} : result.errors
}

const fieldNames = (form: HTMLFormElement) => new Set($$<HTMLInputElement>('[name]', form).map((el) => el.name))

function setFieldError(form: HTMLFormElement, name: string, message?: string) {
  const control = form.elements.namedItem(name)
  const slot = control instanceof HTMLElement && control.id ? document.getElementById(`${control.id}-error`) : null
  if (!(control instanceof HTMLElement) || !slot) return false
  if (message) control.setAttribute('aria-invalid', 'true')
  else control.removeAttribute('aria-invalid')
  control.closest('.field')?.classList.toggle('has-error', !!message)
  slot.querySelector('[data-field-error]')!.textContent = message ?? ''
  slot.hidden = !message
  return true
}

document.addEventListener(
  'submit',
  (e) => {
    const form = e.target as HTMLFormElement
    const errors = checkForm(form)
    if (!errors) return
    form.dataset.validated = ''
    const unplaced = Object.entries(errors).filter(([name, message]) => !setFieldError(form, name, message))
    for (const name of fieldNames(form)) if (!errors[name]) setFieldError(form, name)
    if (Object.keys(errors).length === 0) return
    // 送信の処理（確認ダイアログ・再読み込みなしの遷移）より先に止めるため、捕捉の段階で伝わるのを止める
    e.preventDefault()
    e.stopImmediatePropagation()
    unplaced.forEach(([, message]) => toast(message!, 'error'))
    const invalid = $$<HTMLElement>('[aria-invalid="true"]', form)
    for (const control of invalid) {
      const details = control.closest('details')
      if (details) details.open = true
    }
    const hiddenPanel = invalid[0]?.closest<HTMLElement>('[role="tabpanel"][hidden]')
    if (hiddenPanel) document.querySelector<HTMLElement>(`[role="tab"][aria-controls="${hiddenPanel.id}"]`)?.click()
    else if (invalid[0]) {
      invalid[0].focus()
      // フォーカスできない要素（行をまとめた fieldset など）は、エラーが見える位置まで動かすだけにする
      if (document.activeElement !== invalid[0]) invalid[0].scrollIntoView({ block: 'center' })
    }
  },
  true,
)

// 送信しようとする前は、エラーを出している欄しか確かめ直さないのは、入力し始めたばかりの欄にエラーを出してしまうため
const recheck = (e: Event) => {
  const control = e.target as HTMLInputElement
  const form = control.form
  const errors = form && checkForm(form)
  if (!form || !errors || !control.name) return
  if ('validated' in form.dataset) fieldNames(form).forEach((name) => setFieldError(form, name, errors[name]))
  else if (control.getAttribute('aria-invalid') === 'true') setFieldError(form, control.name, errors[control.name])
}
document.addEventListener('input', recheck)
document.addEventListener('change', recheck)

// --- 日時の選択（components/form.tsx の DateTimeField）
// ブラウザ標準の日時の入力欄を使わないのは、ブラウザや OS ごとに見た目も操作もばらばらで、パソコンでは年・月・日・時・分を小さな枠で 1 つずつ打つことになるため
type DtParts = { y: number; m: number; d: number; h: number; min: number }
type DtState = {
  field: HTMLElement
  panel: HTMLElement
  trigger: HTMLElement
  input: HTMLInputElement
  withTime: boolean
  sheet: boolean
  draft: DtParts | null
  view: { y: number; m: number }
  focus: { y: number; m: number; d: number }
  quietUntil: number
}

// 幅だけで決めないのは、幅の広いタブレットでも指で操作するので、小さな一覧より下から出すホイールのほうが選びやすいため
const DT_SHEET = '(max-width: 640px), (pointer: coarse)'
const DT_WEEK = ['日', '月', '火', '水', '木', '金', '土']
const DT_MINUTE_STEP = 5
let dt: DtState | null = null
let dtWasOpen = false

const pad2 = (n: number) => String(n).padStart(2, '0')
const dayKey = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`
const dtValueOf = (p: DtParts, withTime: boolean) => `${dayKey(p.y, p.m, p.d)}${withTime ? `T${pad2(p.h)}:${pad2(p.min)}` : ''}`

function parseDt(value: string): DtParts | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/)
  return m ? { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, min: m[5] ? +m[5] : 0 } : null
}

// 空のときの時刻を 0:00 にしないのは、今から始める期間を決めることが多く、次のちょうどの時刻のほうが選び直す手間が少ないため
function nextHour(): DtParts {
  const n = new Date()
  n.setHours(n.getHours() + 1, 0, 0, 0)
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), min: 0 }
}

const dtButton = (attrs: string, label: string, cls = 'btn btn-ghost btn-sm') =>
  `<button type="button" class="${cls}" ${attrs}>${label}</button>`

const dtIcon = (svg: string) => svg.replace('<svg ', '<svg class="icon" width="18" height="18" ')

function dtTemplate(withTime: boolean, sheet: boolean, optional: boolean) {
  const time = withTime
    ? `<div class="dt-time"><span class="dt-time-label">時刻</span><div class="dt-cols">
        <div class="dt-col" role="listbox" aria-label="時" data-dt-col="h"></div><span class="dt-colon" aria-hidden="true">:</span>
        <div class="dt-col" role="listbox" aria-label="分" data-dt-col="min"></div></div></div>`
    : ''
  const done = withTime || !sheet ? dtButton('data-dt-done', sheet ? '決定' : '完了', 'btn btn-primary btn-sm dt-done') : ''
  return `<div class="dt-head"><span class="dt-head-label" data-dt-title></span><span class="dt-head-value" data-dt-summary></span></div>
    <div class="dt-body"><div class="dt-cal">
      <div class="dt-cal-nav">
        <button type="button" class="icon-btn" data-dt-month="-1" aria-label="前の月">${dtIcon(chevronLeftSvg)}</button>
        <span class="dt-cal-title" aria-live="polite" data-dt-month-label></span>
        <button type="button" class="icon-btn" data-dt-month="1" aria-label="次の月">${dtIcon(chevronRightSvg)}</button>
      </div>
      <div class="dt-week" aria-hidden="true">${DT_WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="dt-days" role="group" data-dt-days></div>
    </div>${time}</div>
    <div class="dt-foot">${dtButton('data-dt-today', '今日')}${optional ? dtButton('data-dt-reset', 'クリア') : ''}${done}</div>`
}

function renderDtDays() {
  if (!dt) return
  const { y, m } = dt.view
  dt.panel.querySelector('[data-dt-month-label]')!.textContent = `${y}年${m}月`
  const first = new Date(y, m - 1, 1)
  const now = new Date()
  const today = dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const picked = dt.draft && dayKey(dt.draft.y, dt.draft.m, dt.draft.d)
  const focused = dayKey(dt.focus.y, dt.focus.m, dt.focus.d)
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(y, m - 1, 1 - first.getDay() + i)
    const key = dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
    const cls = ['dt-day', date.getMonth() !== m - 1 && 'is-outside', date.getDay() === 0 && 'is-sun', date.getDay() === 6 && 'is-sat']
    cells.push(
      `<button type="button" class="${cls.filter(Boolean).join(' ')}" data-dt-day="${key}" aria-label="${formatDateTimeInput(key)}"` +
        ` aria-pressed="${key === picked}"${key === today ? ' aria-current="date"' : ''} tabindex="${key === focused ? 0 : -1}">${date.getDate()}</button>`,
    )
  }
  dt.panel.querySelector('[data-dt-days]')!.innerHTML = cells.join('')
}

function buildDtCols() {
  if (!dt?.withTime) return
  const base = dt.draft ?? nextHour()
  const minutes = Array.from({ length: 60 / DT_MINUTE_STEP }, (_, i) => i * DT_MINUTE_STEP)
  if (!minutes.includes(base.min)) minutes.push(base.min)
  const options = (unit: 'h' | 'min', values: number[]) =>
    values
      .sort((a, b) => a - b)
      .map(
        (v) =>
          `<button type="button" role="option" class="dt-opt" data-dt-pick="${unit}" data-v="${v}" aria-selected="false">${pad2(v)}</button>`,
      )
      .join('')
  dt.panel.querySelector('[data-dt-col="h"]')!.innerHTML = options(
    'h',
    Array.from({ length: 24 }, (_, i) => i),
  )
  dt.panel.querySelector('[data-dt-col="min"]')!.innerHTML = options('min', minutes)
}

function markDtCols() {
  if (!dt?.withTime) return
  const draft = dt.draft
  $$<HTMLElement>('[data-dt-pick]', dt.panel).forEach((b) => {
    const unit = b.dataset.dtPick as 'h' | 'min'
    b.setAttribute('aria-selected', String(!!draft && draft[unit] === Number(b.dataset.v)))
  })
}

function scrollDtCols(smooth = false) {
  if (!dt?.withTime) return
  const base = dt.draft ?? nextHour()
  $$<HTMLElement>('[data-dt-col]', dt.panel).forEach((col) => {
    const unit = col.dataset.dtCol as 'h' | 'min'
    const target = col.querySelector<HTMLElement>(`[data-v="${base[unit]}"]`)
    if (!target) return
    const top = target.offsetTop - (col.clientHeight - target.offsetHeight) / 2
    col.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' })
  })
}

function updateDtSummary() {
  if (!dt) return
  const summary = dt.panel.querySelector('[data-dt-summary]')!
  summary.textContent = dt.draft ? formatDateTimeInput(dtValueOf(dt.draft, dt.withTime)) : '日付を選んでください'
  summary.classList.toggle('is-empty', !dt.draft)
}

function setDtField(field: HTMLElement, value: string) {
  const input = field.querySelector<HTMLInputElement>('[data-dt-value]')
  const text = field.querySelector<HTMLElement>('[data-dt-text]')
  if (!input || !text || input.value === value) return
  input.value = value
  text.textContent = value ? formatDateTimeInput(value) : (text.dataset.dtPlaceholder ?? '')
  text.classList.toggle('is-empty', !value)
  const clear = field.querySelector<HTMLElement>('[data-dt-clear]')
  if (clear) clear.hidden = !value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const commitDt = () => dt && setDtField(dt.field, dt.draft ? dtValueOf(dt.draft, dt.withTime) : '')

// パソコンでは選んだそばから欄に入れ、スマホでは「決定」まで入れないのは、ホイールを回している途中の値で欄を書き換えないため
function changeDt(next: DtParts | null) {
  if (!dt) return
  dt.draft = next
  if (next) dt.focus = { y: next.y, m: next.m, d: next.d }
  renderDtDays()
  markDtCols()
  updateDtSummary()
  if (!dt.sheet) commitDt()
}

function placeDt() {
  if (!dt || dt.sheet) return
  const r = dt.trigger.getBoundingClientRect()
  const { offsetWidth: w, offsetHeight: h } = dt.panel
  const margin = 12
  const below = r.bottom + 6
  const above = r.top - 6 - h
  const top = below + h <= innerHeight - margin || above < margin ? below : above
  dt.panel.style.top = `${Math.max(margin, Math.min(top, innerHeight - h - margin))}px`
  dt.panel.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - w - margin))}px`
}

function openDt(field: HTMLElement) {
  const trigger = field.querySelector<HTMLElement>('[data-dt-open]')
  const input = field.querySelector<HTMLInputElement>('[data-dt-value]')
  if (!trigger || !input) return
  let panel = field.querySelector<HTMLElement>(':scope > .dt-panel')
  if (!panel) {
    panel = document.createElement('div')
    panel.className = 'dt-panel'
    panel.setAttribute('popover', 'auto')
    panel.setAttribute('role', 'dialog')
    panel.tabIndex = -1
    field.append(panel)
  }
  const withTime = field.dataset.dt === 'datetime'
  const sheet = matchMedia(DT_SHEET).matches
  const draft = parseDt(input.value)
  const base = draft ?? nextHour()
  const label = field.querySelector(':scope > label')?.textContent?.trim() ?? ''
  dt = {
    field,
    panel,
    trigger,
    input,
    withTime,
    sheet,
    draft,
    view: { y: base.y, m: base.m },
    focus: { y: base.y, m: base.m, d: base.d },
    quietUntil: performance.now() + 300,
  }
  panel.setAttribute('aria-label', label)
  panel.classList.toggle('is-sheet', sheet)
  panel.classList.toggle('has-time', withTime)
  panel.removeAttribute('style')
  panel.innerHTML = dtTemplate(withTime, sheet, !!field.querySelector('[data-dt-clear]'))
  panel.querySelector('[data-dt-title]')!.textContent = label
  renderDtDays()
  buildDtCols()
  markDtCols()
  updateDtSummary()
  panel.showPopover()
  placeDt()
  scrollDtCols()
  // シートでは日付にフォーカスを置かないのは、指で開いただけで選んだように見えるフォーカスの枠が出るため
  if (sheet) panel.focus({ preventScroll: true })
  else panel.querySelector<HTMLElement>('[data-dt-day][tabindex="0"]')?.focus({ preventScroll: true })
}

const closeDt = () => dt?.panel.hidePopover()

document.addEventListener(
  'toggle',
  (e) => {
    const panel = e.target
    if (!(panel instanceof HTMLElement) || !panel.classList.contains('dt-panel')) return
    const open = (e as ToggleEvent).newState === 'open'
    panel.parentElement?.querySelector('[data-dt-open]')?.setAttribute('aria-expanded', String(open))
    if (open || dt?.panel !== panel) return
    const { trigger } = dt
    dt = null
    if (!document.activeElement || document.activeElement === document.body || panel.contains(document.activeElement)) trigger.focus()
  },
  true,
)

// 開いたまま押したかをここで覚えるのは、外側を押したことでパネルが先に閉じ、続く click でまた開いてしまうため
document.addEventListener(
  'pointerdown',
  (e) => {
    const trigger = (e.target as Element).closest('[data-dt-open]')
    dtWasOpen = !!trigger && dt?.trigger === trigger
  },
  true,
)

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const trigger = target.closest<HTMLElement>('[data-dt-open]')
  if (trigger) {
    const field = trigger.closest<HTMLElement>('[data-dt]')
    if (dtWasOpen || (dt && dt.trigger === trigger)) {
      dtWasOpen = false
      closeDt()
    } else if (field) openDt(field)
    return
  }
  const clear = target.closest('[data-dt-clear]')?.closest<HTMLElement>('[data-dt]')
  if (clear) {
    setDtField(clear, '')
    clear.querySelector<HTMLElement>('[data-dt-open]')?.focus()
    return
  }
  if (!dt || !dt.panel.contains(target)) return
  const state = dt
  const day = target.closest<HTMLElement>('[data-dt-day]')?.dataset.dtDay
  const month = target.closest<HTMLElement>('[data-dt-month]')?.dataset.dtMonth
  const pick = target.closest<HTMLElement>('[data-dt-pick]')
  if (day) {
    const [y, m, d] = day.split('-').map(Number)
    const time = state.draft ?? nextHour()
    state.view = { y, m }
    changeDt({ y, m, d, h: time.h, min: time.min })
    if (!state.withTime) {
      commitDt()
      closeDt()
    } else state.panel.querySelector<HTMLElement>(`[data-dt-day="${day}"]`)?.focus()
  } else if (month) {
    const next = new Date(state.view.y, state.view.m - 1 + Number(month), 1)
    state.view = { y: next.getFullYear(), m: next.getMonth() + 1 }
    const last = new Date(state.view.y, state.view.m, 0).getDate()
    state.focus = { ...state.view, d: Math.min(state.focus.d, last) }
    renderDtDays()
  } else if (pick) {
    const unit = pick.dataset.dtPick as 'h' | 'min'
    changeDt({ ...(state.draft ?? nextHour()), [unit]: Number(pick.dataset.v) })
    if (state.sheet) {
      state.quietUntil = performance.now() + 500
      scrollDtCols(true)
    }
  } else if (target.closest('[data-dt-today]')) {
    const now = new Date()
    const time = state.draft ?? nextHour()
    state.view = { y: now.getFullYear(), m: now.getMonth() + 1 }
    changeDt({ ...state.view, d: now.getDate(), h: time.h, min: time.min })
    if (!state.withTime) {
      commitDt()
      closeDt()
    }
  } else if (target.closest('[data-dt-reset]')) {
    state.draft = null
    commitDt()
    closeDt()
  } else if (target.closest('[data-dt-done]')) {
    commitDt()
    closeDt()
  }
})

document.addEventListener('keydown', (e) => {
  const day = (e.target as Element).closest?.<HTMLElement>('[data-dt-day]')?.dataset.dtDay
  if (!dt || !day) return
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [0, -7],
    ArrowDown: [0, 7],
    PageUp: [-1, 0],
    PageDown: [1, 0],
  }
  const move = moves[e.key]
  if (!move) return
  e.preventDefault()
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(y, m - 1 + move[0], d + move[1])
  dt.focus = { y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() }
  dt.view = { y: dt.focus.y, m: dt.focus.m }
  renderDtDays()
  dt.panel.querySelector<HTMLElement>('[data-dt-day][tabindex="0"]')?.focus()
})

// 隠した入力欄にフォーカスを残さないのは、検証のエラーで欄へ移動したときに、どこを直せばよいか見えなくなるため
document.addEventListener('focusin', (e) => {
  const value = (e.target as Element).closest?.('[data-dt-value]')
  value?.closest('[data-dt]')?.querySelector<HTMLElement>('[data-dt-open]')?.focus()
})

// スクロールのたびに選ばないのは、ホイールを回している途中に通り過ぎた項目まで選び、上に出す日時がちらつくため
let dtWheelTimer = 0
document.addEventListener(
  'scroll',
  (e) => {
    if (!dt) return
    const col = e.target
    if (!(col instanceof HTMLElement) || !col.matches('.dt-panel.is-sheet [data-dt-col]')) {
      placeDt()
      return
    }
    clearTimeout(dtWheelTimer)
    dtWheelTimer = window.setTimeout(() => {
      if (!dt || performance.now() < dt.quietUntil) return
      const center = col.scrollTop + col.clientHeight / 2
      const options = $$<HTMLElement>('[data-dt-pick]', col)
      const nearest = options.reduce((a, b) =>
        Math.abs(b.offsetTop + b.offsetHeight / 2 - center) < Math.abs(a.offsetTop + a.offsetHeight / 2 - center) ? b : a,
      )
      const unit = nearest.dataset.dtPick as 'h' | 'min'
      const v = Number(nearest.dataset.v)
      if (dt.draft?.[unit] === v) return
      changeDt({ ...(dt.draft ?? nextHour()), [unit]: v })
    }, 120)
  },
  true,
)
addEventListener('resize', placeDt)

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
    const btn =
      e.submitter instanceof HTMLButtonElement
        ? e.submitter
        : form.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])')
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
type CompleteResult = { completed: boolean; done: number; total: number }

async function handleComplete(e: SubmitEvent, form: HTMLFormElement) {
  e.preventDefault()
  const btn = form.querySelector('button[aria-pressed]')!
  const then = e.submitter?.getAttribute('data-complete-then')
  const next = btn.getAttribute('aria-pressed') !== 'true'
  setCompleteUI(form, next) // 楽観的更新
  try {
    const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error()
    const data: CompleteResult = await res.json()
    setCompleteUI(form, data.completed)
    showProgress(data)
    if (then && data.completed) void visit(new URL(then, location.href))
  } catch {
    setCompleteUI(form, !next)
    toast('更新できませんでした。通信状況を確認してください。', 'error')
  }
}

function setCompleteUI(form: HTMLFormElement, done: boolean) {
  const btn = form.querySelector('button[aria-pressed]')!
  btn.setAttribute('aria-pressed', String(done))
  btn.setAttribute('aria-label', done ? '未完了に戻す' : '完了にする')
  const label = form.querySelector('[data-complete-label]')
  if (label) {
    label.textContent = done ? '完了済み' : '完了にする'
    btn.classList.toggle('btn-success', done)
    if (!btn.hasAttribute('data-complete-secondary')) btn.classList.toggle('btn-primary', !done)
  }
  form.querySelector('[data-complete-then]')?.toggleAttribute('hidden', done)
  setItemDone(completeItemId(form.action), done)
}

const completeItemId = (url: string) => url.match(/items\/(\d+)\/complete/)?.[1] ?? ''

function setItemDone(id: string, done: boolean) {
  $$(`.item-row[data-item="${id}"]`).forEach((row) => row.classList.toggle('is-done', done))
  $$<HTMLElement>(`[data-complete-check="${id}"]`).forEach((el) => {
    el.dataset.done = String(done)
    if (done) el.setAttribute('aria-label', '完了済み')
  })
  $$(`[data-complete-status="${id}"]`).forEach((el) => {
    el.classList.toggle('is-done', done)
    if (done) el.querySelector('[data-complete-label]')!.textContent = '完了済み'
  })
  const dot = id && document.querySelector(`[data-outline-dot="${id}"]`)
  if (dot) {
    dot.classList.toggle('done', done)
    dot.innerHTML = done ? checkSvg.replace('<svg ', '<svg class="icon" width="10" height="10" ') : ''
  }
}

function showProgress(data: CompleteResult) {
  updateProgress(data.done, data.total)
  if (data.completed && data.done === data.total && data.total > 0) toast('🎉 コースのすべてのアイテムを完了しました！')
}

// --- 開いた・最後まで再生したアイテムを自動で完了にする（components/course.tsx の CompletionStatus）
// 失敗してもエラーを出さないのは、学生が自分で操作したわけではなく、次に開いたときにもう一度送れるため
async function autoComplete(url: string, on: 'view' | 'ended') {
  $$(`[data-complete-on-open="${CSS.escape(url)}"]`).forEach((el) => el.removeAttribute('data-complete-on-open'))
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ on }),
      headers: { Accept: 'application/json' },
      // 新しいタブで開くリンクでも、この画面から離れる操作でも送り切るため
      keepalive: true,
    })
    if (!res.ok) return
    const data: CompleteResult = await res.json()
    setItemDone(completeItemId(url), data.completed)
    showProgress(data)
  } catch {}
}

const completeOnOpen = (e: MouseEvent) => {
  const url = (e.target as Element).closest<HTMLElement>('[data-complete-on-open]')?.dataset.completeOnOpen
  if (url && e.button <= 1) void autoComplete(url, 'view')
}
document.addEventListener('click', completeOnOpen)
document.addEventListener('auxclick', completeOnOpen)

// ended は伝わってこないので、捕捉の段階で拾う
document.addEventListener(
  'ended',
  (e) => {
    const media = e.target as HTMLElement
    const url = media.dataset?.completeOnEnded
    if (!url) return
    media.removeAttribute('data-complete-on-ended')
    void autoComplete(url, 'ended')
  },
  true,
)

function completeOnView() {
  $$<HTMLElement>('[data-complete-on-view]').forEach((el) => {
    const url = el.dataset.completeOnView!
    // 要素ごと消さないのは、ライブ同期が子の数で前回の内容と画面の要素を対応させているため
    el.removeAttribute('data-complete-on-view')
    void autoComplete(url, 'view')
  })
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

// --- 開いたポップオーバーの最初の入力にフォーカス
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement
    if (d.matches?.('.popover') && d.open) d.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]), textarea')?.focus()
  },
  true,
)

// --- 「アイテムを追加」を押したセクションを、モーダルのセクション欄で選んでおく
// セクションごとにモーダルを置かないのは、セクションの数だけ同じフォームが HTML に並ぶため
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-add-item-section]')
  const modal = btn && document.getElementById(btn.getAttribute('popovertarget') ?? '')
  const select = modal?.querySelector<HTMLSelectElement>('select[name=section_id]')
  if (btn && select) select.value = btn.dataset.addItemSection ?? ''
})

// --- アイテムの追加: 種類を選ぶと設定へ進み、選んだ種類のカードが設定の上の見出しに移る
type ItemStep = 'kind' | 'settings'
type StepMotion = { animations: Animation[]; settle: () => void }

const STEP_DURATION = 360
const STEP_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'
// 出ていく要素が消えきる前に選んだカードを動かしたり入ってくる要素を出したりしないのは、出ていく側を absolute で同じ場所に重ねているため、重なって見えるため
const FADE_OUT_DURATION = 120
const MOVE_DELAY = FADE_OUT_DURATION
let stepMotion: StepMotion | null = null

function settleStepMotion() {
  const motion = stepMotion
  stepMotion = null
  motion?.animations.forEach((a) => a.cancel())
  motion?.settle()
}

// transform の scale で縮めないのは、カードと見出しで縦横比が違い、文字が潰れて見えるため
function morphFrom(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect()
  return el.animate(
    [
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, width: `${from.width}px`, height: `${from.height}px` },
      { transform: 'none', width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: STEP_DURATION, delay: MOVE_DELAY, easing: STEP_EASE, fill: 'backwards' },
  )
}

const keepHidden = (el: Element) => el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: MOVE_DELAY + STEP_DURATION, fill: 'forwards' })

const fadeOut = (el: Element) =>
  el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], {
    duration: FADE_OUT_DURATION,
    easing: 'ease-out',
    fill: 'forwards',
  })

const riseIn = (el: Element, delay: number) =>
  el.animate(
    [
      { opacity: 0, transform: 'translateY(14px)' },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: 280,
      delay,
      easing: STEP_EASE,
      fill: 'backwards',
    },
  )

const visibleChildren = (el: Element, skip?: Element) =>
  [...el.children].filter((child) => child !== skip && child.getClientRects().length > 0)

// 種類ごとの欄を CSS だけで出し分けないのは、Moodle モードの extra の欄は種類の数だけあり、無効にして送らせないため
function setKindOnly(form: HTMLFormElement, kind: string) {
  for (const el of $$<HTMLElement>('[data-kind-only]', form)) {
    el.hidden = el.dataset.kindOnly !== kind
    if (el instanceof HTMLFieldSetElement) el.disabled = el.hidden
  }
  const validateAs = form.querySelector<HTMLElement>(`[data-pick-kind="${kind}"]`)?.dataset.kindValidate
  form.dataset.validateDefault ??= form.dataset.validate
  const name = validateAs ?? form.dataset.validateDefault
  if (name) form.dataset.validate = name
}

function setItemKind(form: HTMLFormElement, kind: string) {
  const input = form.elements.namedItem('type')
  form.dataset.kind = kind
  setKindOnly(form, kind)
  if (!(input instanceof HTMLInputElement) || input.value === kind) return
  input.value = kind
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function goToItemStep(form: HTMLFormElement, step: ItemStep, kind?: string) {
  settleStepMotion()
  const picker = form.querySelector<HTMLElement>('.kind-picker')
  const settings = form.querySelector<HTMLElement>('.kind-settings')
  const summary = form.querySelector<HTMLElement>('.kind-summary')
  if (!picker || !settings || !summary) return
  if (kind) setItemKind(form, kind)
  const chosen = form.querySelector<HTMLElement>(`[data-pick-kind="${form.dataset.kind}"]`)
  const forward = step === 'settings'
  const fromHeight = form.offsetHeight
  const fromBox = (forward ? chosen : summary)?.getBoundingClientRect()
  form.dataset.step = step
  const focusTarget = forward ? form.querySelector<HTMLElement>('input[name=title]') : chosen
  focusTarget?.focus({ preventScroll: true })
  if (!chosen || !fromBox || matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const leaving = forward ? picker : settings
  leaving.classList.add('is-leaving')
  form.classList.add('is-switching')
  const height = form.animate([{ height: `${fromHeight}px` }, { height: `${form.offsetHeight}px` }], {
    duration: STEP_DURATION,
    delay: MOVE_DELAY,
    easing: STEP_EASE,
    fill: 'backwards',
  })
  const others = $$<HTMLElement>('[data-pick-kind]', picker).filter((el) => el !== chosen)
  const animations = forward
    ? [
        height,
        keepHidden(chosen),
        ...others.map(fadeOut),
        morphFrom(summary, fromBox),
        ...$$('.kind-summary > .btn', settings).map((el) => riseIn(el, MOVE_DELAY + 160)),
        ...visibleChildren(settings, summary).map((el, i) => riseIn(el, MOVE_DELAY + 120 + i * 30)),
      ]
    : [
        height,
        keepHidden(summary),
        ...visibleChildren(settings, summary).map(fadeOut),
        morphFrom(chosen, fromBox),
        ...others.map((el, i) => riseIn(el, MOVE_DELAY + 160 + i * 40)),
      ]
  const motion: StepMotion = {
    animations,
    settle: () => {
      leaving.classList.remove('is-leaving')
      form.classList.remove('is-switching')
    },
  }
  stepMotion = motion
  void Promise.all(animations.map((a) => a.finished)).then(
    () => stepMotion === motion && settleStepMotion(),
    () => {},
  )
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const pick = target.closest<HTMLElement>('[data-pick-kind]')
  const back = target.closest('[data-kind-back]')
  const form = (pick ?? back)?.closest<HTMLFormElement>('[data-item-steps]')
  if (form) goToItemStep(form, pick ? 'settings' : 'kind', pick?.dataset.pickKind)
})

// 開き直したときに入力した値までは消さないのは、うっかり閉じただけで書きかけが失われないようにするため
document.addEventListener(
  'beforetoggle',
  (e) => {
    const form = (e as ToggleEvent).newState === 'open' ? (e.target as Element).querySelector?.<HTMLFormElement>('[data-item-steps]') : null
    if (!form) return
    settleStepMotion()
    form.dataset.step = 'kind'
  },
  true,
)

// --- ポップオーバーのパネルは、下に収まらなければボタンの上に開き、どちらにも収まらなければ全体が見えるまでスクロールする
// toggle イベントで置き直さないのは、発火が描画の後になり、下に開いたパネルが一瞬見えてから上へ跳ぶため
const POPOVER_MARGIN = 8
function placePopoverPanel(d: HTMLDetailsElement) {
  const panel = d.querySelector<HTMLElement>(':scope > .popover-panel')
  if (!panel) return
  panel.classList.remove('is-above')
  const anchor = d.getBoundingClientRect()
  const gap = panel.offsetTop - anchor.height
  const needed = panel.offsetHeight + gap + POPOVER_MARGIN
  const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  if (innerHeight - anchor.bottom >= needed) return
  if (anchor.top - topbarBottom >= needed) panel.classList.add('is-above')
  else panel.scrollIntoView({ block: 'nearest' })
}
document.addEventListener('click', (e) => {
  const d = (e.target as Element).closest('details.popover > summary')?.parentElement
  if (!(d instanceof HTMLDetailsElement) || d.open) return
  e.preventDefault()
  d.open = true
  placePopoverPanel(d)
})

// --- ポップオーバーは外側クリックと Esc で閉じる
document.addEventListener('click', (e) => {
  $$<HTMLDetailsElement>('details.popover[open]').forEach((d) => {
    if (!d.contains(e.target as Node)) d.open = false
  })
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  $$<HTMLDetailsElement>('details.popover[open]').forEach((d) => {
    d.open = false
    d.querySelector('summary')?.focus()
  })
})

// --- セクションの開閉状態を記憶（端末ごと。Moodle モードの折りたたみ型トピックは data-collapse-url に送って Moodle に記録する）
const collapseUrlOf = (d: HTMLDetailsElement) => d.parentElement?.closest<HTMLElement>('[data-collapse-url]')?.dataset.collapseUrl
const hashTarget = () => (location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null)
function restoreCollapsed() {
  const collapsed = new Set(getSetting('collapsedSections'))
  $$<HTMLDetailsElement>('details.section-card:not(.is-fixed)').forEach((d) => {
    if (!collapseUrlOf(d) && collapsed.has(d.id) && location.hash !== `#${d.id}`) d.open = false
  })
}
// 内容の差し替えのたびに開かないのは、URL の # のセクションを利用者が閉じても、確認のたびに開き直してしまうため
const openHashTarget = () => {
  const target = hashTarget()?.closest<HTMLDetailsElement>('details.section-card')
  if (target) target.open = true
}
addEventListener('hashchange', openHashTarget)

const pendingToggles = new Map<string, Map<string, boolean>>()
let toggleTimer = 0
// 失敗しても元に戻さないのは、開閉は画面には反映済みで、記録できなくても次に開いたときの状態が変わるだけのため
function flushToggles() {
  clearTimeout(toggleTimer)
  for (const [url, states] of pendingToggles) {
    const ids = (open: boolean) => [...states].filter(([, v]) => v === open).map(([id]) => id)
    void fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ open: ids(true).join(','), closed: ids(false).join(',') }),
      headers: { Accept: 'application/json' },
      keepalive: true,
    }).catch(() => {})
  }
  pendingToggles.clear()
}
addEventListener('pagehide', flushToggles)

document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement
    if (!d.matches?.('details.section-card:not(.is-fixed)')) return
    const url = collapseUrlOf(d)
    if (url && d.dataset.section) {
      const states = pendingToggles.get(url) ?? new Map<string, boolean>()
      pendingToggles.set(url, states.set(d.dataset.section, d.open))
      clearTimeout(toggleTimer)
      // まとめて送るのは、「すべて開く」や同時に 1 つだけ開く設定で、一度に多くのセクションが切り替わるため
      toggleTimer = window.setTimeout(flushToggles, 500)
      return
    }
    updateSetting('collapsedSections', (ids) => [...ids.filter((id) => id !== d.id), ...(d.open ? [] : [d.id])].slice(-200))
  },
  true,
)

document.addEventListener('click', (e) => {
  const summary = (e.target as Element).closest('summary')
  if (summary?.parentElement?.matches('details.section-card.is-fixed')) e.preventDefault()
  const btn = (e.target as Element).closest<HTMLElement>('[data-sections-toggle]')
  if (!btn) return
  const open = btn.dataset.sectionsToggle === 'open'
  $$<HTMLDetailsElement>('details.section-card:not(.is-fixed)').forEach((d) => (d.open = open))
})

// --- タイルのセクションをタイルの下に開く（同時に 1 つだけ）
const tileSlides = new WeakMap<HTMLElement, Animation>()

// CSS の transition にしないのは、hidden（display: none）と height: auto の間は transition で補間できないため
function slideTilePanel(panel: HTMLElement, open: boolean, animate: boolean) {
  const now = getComputedStyle(panel)
  const from = panel.hidden
    ? { height: '0px', marginTop: '0px', opacity: 0 }
    : { height: now.height, marginTop: now.marginTop, opacity: Number(now.opacity) }
  tileSlides.get(panel)?.cancel()
  panel.classList.remove('is-sliding')
  if (panel.hidden && !open) return
  panel.hidden = false
  const rest = getComputedStyle(panel)
  const to = open ? { height: rest.height, marginTop: rest.marginTop, opacity: 1 } : { height: '0px', marginTop: '0px', opacity: 0 }
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panel.hidden = !open
    return
  }
  panel.classList.add('is-sliding')
  const slide = panel.animate([from, to], { duration: 280, easing: STEP_EASE })
  tileSlides.set(panel, slide)
  slide.onfinish = () => {
    panel.classList.remove('is-sliding')
    panel.hidden = !open
  }
  return slide
}

// pushState にしないのは、タイルを開け閉めするたびに履歴が積まれ、戻るでコースの前の画面に戻れなくなるため
function markTile(id: string | null) {
  $$<HTMLElement>('a[data-tile]').forEach((a) => a.setAttribute('aria-expanded', String(a.dataset.tile === id)))
  const url = new URL(location.href)
  if (id) url.searchParams.set('section', id)
  else url.searchParams.delete('section')
  url.hash = ''
  history.replaceState(history.state, '', url)
}

function revealTilePanel(tile: HTMLElement, panel: HTMLElement) {
  const rect = panel.getBoundingClientRect()
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  if (tile.getBoundingClientRect().top < parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop))
    tile.scrollIntoView({ block: 'start', behavior })
  else if (rect.top > innerHeight * 0.6) panel.scrollIntoView({ block: 'start', behavior })
  else if (rect.bottom > innerHeight && rect.height < innerHeight) panel.scrollIntoView({ block: 'nearest', behavior })
}

const setTransitionName = (el: HTMLElement, name: string | null) =>
  name ? el.style.setProperty('view-transition-name', name) : el.style.removeProperty('view-transition-name')

function nameTileParts(panel: HTMLElement, on: boolean) {
  const card = panel.querySelector<HTMLElement>('.section-card')
  if (!card) return
  const counts = new Map<string, number>()
  for (const part of [...card.children] as HTMLElement[]) {
    const key = part.classList[0] ?? part.tagName.toLowerCase()
    const n = counts.get(key) ?? 0
    counts.set(key, n + 1)
    setTransitionName(part, on ? `tile-part-${key}-${n}` : null)
    if (on) part.style.setProperty('view-transition-class', 'tile-part')
    else part.style.removeProperty('view-transition-class')
  }
  setTransitionName(card, on ? 'tile-panel' : null)
}

// 別の行へ移るときにパネルを動かさないのは、下へ移るパネルと上へ詰めるタイルが行き違い、重なって見えるため
function nameSwitchingPanel(panel: HTMLElement, sameRow: boolean, role: 'out' | 'in' | null) {
  if (sameRow) nameTileParts(panel, role !== null)
  else setTransitionName(panel, role && `tile-panel-${role}`)
}

// 閉じてから開き直さないのは、パネルが一度消えて下のタイルが上下に揺れ、どこからどこへ移ったのか追いにくいため
function switchTilePanel(tile: HTMLAnchorElement, from: HTMLElement, to: HTMLElement) {
  const root = document.documentElement
  const tiles = $$<HTMLAnchorElement>('a[data-tile]')
  const fromTile = tiles.find((a) => a.getAttribute('aria-expanded') === 'true')
  const direction = fromTile && tiles.indexOf(tile) < tiles.indexOf(fromTile) ? 'prev' : 'next'
  const sameRow = !!fromTile && Math.round(fromTile.getBoundingClientRect().top) === Math.round(tile.getBoundingClientRect().top)
  const cells = $$<HTMLElement>('.sec-tile-cell')
  root.dataset.tileSwitch = direction
  cells.forEach((cell) => {
    setTransitionName(cell, cell.id)
    cell.style.setProperty('view-transition-class', 'tile-cell')
  })
  nameSwitchingPanel(from, sameRow, 'out')
  const transition = document.startViewTransition(() => {
    nameSwitchingPanel(from, sameRow, null)
    from.hidden = true
    to.hidden = false
    nameSwitchingPanel(to, sameRow, 'in')
    markTile(tile.dataset.tile!)
  })
  void transition.finished.finally(() => {
    cells.forEach((cell) => {
      setTransitionName(cell, null)
      cell.style.removeProperty('view-transition-class')
    })
    nameSwitchingPanel(to, sameRow, null)
    if (root.dataset.tileSwitch === direction) delete root.dataset.tileSwitch
    revealTilePanel(tile, to)
  })
}

const canSwitchTile = (from: HTMLElement) =>
  !!document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches && tileSlides.get(from)?.playState !== 'running'

document.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const target = e.target as Element
  const closing = target.closest('[data-tile-close]')?.closest<HTMLElement>('.sec-tile-panel')
  const tile = closing
    ? document.querySelector<HTMLAnchorElement>(`a[data-tile="${closing.id.replace('tile-panel-', '')}"]`)
    : target.closest<HTMLAnchorElement>('a[data-tile]')
  const panel = tile && document.getElementById(`tile-panel-${tile.dataset.tile}`)
  if (!tile || !panel) return
  e.preventDefault()
  const opening = tile.getAttribute('aria-expanded') !== 'true'
  const shown = $$<HTMLElement>('.sec-tile-panel').filter((p) => !p.hidden)
  if (opening && shown.length === 1 && shown[0] !== panel && canSwitchTile(shown[0])) return switchTilePanel(tile, shown[0], panel)
  const before = tile.getBoundingClientRect().top
  // タイルより上のパネルを縮めて閉じないのは、縮むあいだ押したタイルが上へずれていき、押した場所を見失うため
  $$<HTMLElement>('.sec-tile-panel').forEach((other) => {
    if (other !== panel && !other.hidden) slideTilePanel(other, false, other.getBoundingClientRect().top > before)
  })
  const slide = slideTilePanel(panel, opening, true)
  markTile(opening ? tile.dataset.tile! : null)
  scrollBy(0, tile.getBoundingClientRect().top - before)
  if (!opening) return tile.focus()
  if (!slide) return revealTilePanel(tile, panel)
  slide.finished.then(() => revealTilePanel(tile, panel)).catch(() => {})
})

// --- ファイル選択時にタイトルが空なら自動入力
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file' || !input.files?.[0]) return
  const title = input.form?.querySelector<HTMLInputElement>('input[name=title]')
  if (title && !title.value) title.value = input.files[0].name.replace(/\.[^.]+$/, '')
})

// --- 選んだ画像をプレビューに出す（上限を超えていたら送信前に選択を取り消し、保存済みの画像に戻す）
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (!input.matches('[data-image-input]')) return
  let file = input.files?.[0]
  if (file && file.size > Number(input.dataset.maxSize)) {
    input.value = ''
    file = undefined
    toast(input.dataset.tooLarge ?? '', 'error')
  }
  const preview = input.closest('[data-file-drop]')?.querySelector<HTMLImageElement>('[data-image-preview]')
  if (!preview) return
  if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
  const src = file ? URL.createObjectURL(file) : preview.dataset.saved
  // 空文字を src に入れないのは、ページ自身の URL として読み込みが走るため
  if (src) preview.src = src
  else preview.removeAttribute('src')
  preview.hidden = !src
})

// --- 選んだファイルをファイル選択の下に出す（components/form.tsx の FileInput）
// 画像のプレビューより前に登録しないのは、上限を超えて選択を取り消したあとの状態を出すため
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file') return
  const drop = input.closest<HTMLElement>('[data-file-drop]')
  if (!drop) return
  const file = input.files?.[0]
  drop.toggleAttribute('data-has-file', !!file)
  if (!file) return
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : ''
  drop.querySelector('[data-file-name]')!.textContent = file.name
  drop.querySelector('[data-file-meta]')!.textContent = [ext, formatBytes(file.size)].filter(Boolean).join('・')
})

document.addEventListener('click', (e) => {
  const clear = (e.target as Element).closest('[data-file-clear]')
  const input = clear?.closest('[data-file-drop]')?.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) return
  input.value = ''
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.focus()
})

// --- ファイル選択へのドラッグ＆ドロップ
const dropZoneOf = (e: DragEvent) => (e.target instanceof Element ? e.target.closest<HTMLLabelElement>('.file-drop-zone') : null)
const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

// accept はブラウザがドロップでは確かめないので、ファイル選択の画面と同じ規則でここで確かめる
function acceptsFile(accept: string, file: File) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a))
}

document.addEventListener('dragover', (e) => {
  const zone = dropZoneOf(e)
  if (!zone || !carriesFiles(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  zone.toggleAttribute('data-dragging', true)
})
document.addEventListener('dragleave', (e) => dropZoneOf(e)?.removeAttribute('data-dragging'))
document.addEventListener('drop', (e) => {
  const zone = dropZoneOf(e)
  if (!zone || !carriesFiles(e)) return
  e.preventDefault()
  zone.removeAttribute('data-dragging')
  const input = document.getElementById(zone.htmlFor)
  const file = e.dataTransfer!.files[0]
  if (!(input instanceof HTMLInputElement) || !file) return
  if (!acceptsFile(input.accept, file)) return toast('この形式のファイルは選べません。', 'error')
  const files = new DataTransfer()
  files.items.add(file)
  input.files = files.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})

// --- ファイル自動配布のアップロード（components/bundle.tsx の BundleFilesCard）
// ファイル選択の部品（FileInput）を使わないのは、フォルダーの中の場所をファイルと一緒に送る必要があり、input の files ではそれを持てないため
// archive は、選んだりドロップしたりした zip（フォルダーの中の zip は、展開せずにそのまま配る）
type BundleUpload = { file: File; path: string; archive?: boolean }

const isZip = (file: File) => /\.zip$/i.test(file.name)

function uploadBundle(form: HTMLFormElement, files: BundleUpload[]) {
  if (form.hasAttribute('data-uploading')) return
  const usable = files.filter((f) => f.archive || (!!bundlePath(f.path) && !isExcludedPath(f.path)))
  const skipped = files.length - usable.length
  if (!usable.length)
    return toast(
      skipped
        ? 'アップロードできるファイルがありませんでした（.git や node_modules などは外しています）。'
        : 'アップロードするファイルがありません。',
      'error',
    )
  const maxFiles = Number(form.dataset.maxFiles)
  const maxSize = Number(form.dataset.maxSize)
  if (usable.length > maxFiles) return toast(`ファイルは ${maxFiles} 個までです。`, 'error')
  if (usable.reduce((sum, f) => sum + f.file.size, 0) > maxSize)
    return toast(`1 回にアップロードできるのは合計 ${formatBytes(maxSize)} までです。何回かに分けてアップロードしてください。`, 'error')
  const data = new FormData()
  for (const { file, path, archive } of usable) {
    if (archive) data.append('archives', file, file.name)
    else {
      data.append('files', file, file.name)
      data.append('paths', path)
    }
  }
  data.append('skipped', String(skipped))
  form.toggleAttribute('data-uploading', true)
  void visit(new URL(form.action), { method: 'POST', body: data, onFail: () => form.removeAttribute('data-uploading') })
}

// instanceof で見分けないのは、Chrome では FileSystemFileEntry・FileSystemDirectoryEntry がグローバルになく ReferenceError になるため
const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile
const isDirectoryEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory

async function readDropEntry(entry: FileSystemEntry, prefix: string): Promise<BundleUpload[]> {
  const path = `${prefix}${entry.name}`
  if (isFileEntry(entry)) return [{ file: await new Promise<File>((ok, ng) => entry.file(ok, ng)), path }]
  // 中を読む前に外すのは、node_modules のように数万のファイルを含むフォルダーを読み終えるまで待たせないため
  if (!isDirectoryEntry(entry) || isExcludedPath(entry.name)) return []
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  // readEntries は 1 回で全部を返すとは限らないので、空が返るまで読む
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, ng) => reader.readEntries(ok, ng))
    if (!batch.length) break
    children.push(...batch)
  }
  return (await Promise.all(children.map((child) => readDropEntry(child, `${path}/`)))).flat()
}

document.addEventListener('click', (e) => {
  const pick = (e.target as Element).closest<HTMLElement>('[data-bundle-pick]')
  const form = pick?.closest<HTMLFormElement>('[data-bundle-upload]')
  if (form && !form.hasAttribute('data-uploading'))
    form.querySelector<HTMLInputElement>(`[data-bundle-input="${pick!.dataset.bundlePick}"]`)?.click()
})

document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const form = input.closest<HTMLFormElement>('[data-bundle-upload]')
  if (!form || !input.matches('[data-bundle-input]') || !input.files) return
  // 選んだフォルダーの名前を外すのは、そのフォルダーの中身を配るため（学生の PC ではアイテムの名前のフォルダーに入る）
  const folder = input.dataset.bundleInput === 'folder'
  const files = [...input.files].map((file) =>
    folder ? { file, path: file.webkitRelativePath.split('/').slice(1).join('/') } : { file, path: file.name, archive: isZip(file) },
  )
  input.value = ''
  uploadBundle(form, files)
})

const bundleDropOf = (e: DragEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-bundle-drop]') : null)

document.addEventListener('dragover', (e) => {
  const zone = bundleDropOf(e)
  if (!zone || !carriesFiles(e)) return
  e.preventDefault()
  const busy = !!zone.closest('[data-uploading]')
  e.dataTransfer!.dropEffect = busy ? 'none' : 'copy'
  zone.toggleAttribute('data-dragging', !busy)
})
document.addEventListener('dragleave', (e) => {
  const zone = bundleDropOf(e)
  // ボタンなどの子要素に入ったときに外さないのは、強調がちらつくため
  if (zone && !(e.relatedTarget instanceof Node && zone.contains(e.relatedTarget))) zone.removeAttribute('data-dragging')
})
document.addEventListener('drop', (e) => {
  const zone = bundleDropOf(e)
  const form = zone?.closest<HTMLFormElement>('[data-bundle-upload]')
  if (!zone || !form || !carriesFiles(e)) return
  e.preventDefault()
  zone.removeAttribute('data-dragging')
  // ドロップのイベントの中で取り出すのは、イベントが終わると DataTransfer の中身が読めなくなるため
  // エントリーだけにしないのは、ドラッグ元によってはエントリーが取れず、ファイルを受け取れなくなるため
  const dropped = [...e.dataTransfer!.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry() ?? item.getAsFile())
    .filter((d) => !!d)
  const single = dropped.length === 1 && !(dropped[0] instanceof File) && isDirectoryEntry(dropped[0]) ? dropped[0] : null
  void (async () => {
    try {
      const files = single
        ? (await readDropEntry(single, '')).map((f) => ({ ...f, path: f.path.split('/').slice(1).join('/') }))
        : (await Promise.all(dropped.map((d) => (d instanceof File ? Promise.resolve([{ file: d, path: d.name }]) : readDropEntry(d, '')))))
            .flat()
            .map((f) => ({ ...f, archive: !f.path.includes('/') && isZip(f.file) }))
      uploadBundle(form, files)
    } catch {
      toast('ファイルを読み込めませんでした。', 'error')
    }
  })()
})

// --- VS Code で開く（components/bundle.tsx の BundleOpen）
// リンクを画面に描いておかないのは、中の鍵が数分で切れ、開いたままの画面から押すと使えなくなっているため
document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement
  if (!form.matches('[data-vscode-launch]')) return
  e.preventDefault()
  try {
    const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
    const body: unknown = await res.json()
    const url = typeof body === 'object' && body !== null && 'url' in body && typeof body.url === 'string' ? body.url : null
    if (!res.ok || !url) throw new Error('no url')
    location.href = url
    toast('VS Code を開いています。開かないときは、拡張機能が入っているか確かめてください。', 'info')
  } catch {
    toast('VS Code で開く準備ができませんでした。もう一度お試しください。', 'error')
  }
})

// --- 目次（data-toc）で、いま表示している節のリンクを強調する
function updateToc() {
  const toc = document.querySelector('[data-toc]')
  if (!toc) return
  const links = $$<HTMLAnchorElement>('a[href^="#"]', toc)
  const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  let current = links[0]
  for (const a of links) {
    const section = document.getElementById(a.hash.slice(1))
    if (section && section.getBoundingClientRect().top - offset <= 8) current = a
  }
  // 末尾まで来たら最後の節にしないと、短い節は上端まで届かず一度も強調されない
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2)
    current = links.find((a) => a.hash === location.hash) ?? links.at(-1)!
  const changed = !current.classList.contains('active')
  links.forEach((a) => a.classList.toggle('active', a === current))
  if (changed && toc.scrollWidth > toc.clientWidth) revealTocLink(toc, current)
}
// scrollIntoView を使わないのは、目次だけでなくページも縦にスクロールしてしまうため
function revealTocLink(toc: Element, link: HTMLElement) {
  const fade = 48
  const left = link.offsetLeft - 16
  const right = link.offsetLeft + link.offsetWidth + fade - toc.clientWidth
  const target = toc.scrollLeft > left ? left : toc.scrollLeft < right ? right : null
  if (target === null) return
  toc.scrollTo({ left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
addEventListener('scroll', updateToc, { passive: true })
addEventListener('hashchange', updateToc)

// --- Markdown エディター（components/markdown.tsx の MarkdownEditor）
// ここに直接 import しないのは、CodeMirror が大きく、エディターのない画面でも毎回読み込むことになるため
function initMarkdownEditors() {
  const fields = $$<HTMLElement>('[data-md-editor]:not([data-md-ready])')
  if (!fields.length) return
  import('./markdown-editor')
    .then(({ mountMarkdownEditor }) => fields.forEach(mountMarkdownEditor))
    .catch(() => toast('エディターを読み込めませんでした。', 'error'))
}

// --- コードのエディター（components/code.tsx の CodeInput / CodeWorkspace）
// ここに直接 import しないのは、CodeMirror と各言語の文法が大きく、コードの入力欄のない画面でも毎回読み込むことになるため
let codeEditor: Promise<typeof import('./code-editor')> | null = null
function initCodeEditors() {
  void codeEditor?.then(({ releaseDetachedCodeEditors }) => releaseDetachedCodeEditors())
  if (
    !document.querySelector(
      '[data-code-input]:not([data-code-ready]), [data-code-grade]:not([data-code-watching]), [data-code-submit-timer]:not([data-code-counting])',
    )
  )
    return
  codeEditor ??= import('./code-editor')
  codeEditor
    .then(({ mountCodeEditors }) => mountCodeEditors(toast, confirmDialog))
    .catch(() => {
      codeEditor = null
      toast('エディターを読み込めませんでした。', 'error')
    })
}

// --- ログイン画面の 3D アニメーション（components/layout.tsx の AuthShell）
// ここに直接 import しないのは、three.js が大きく、ログイン後の画面でも毎回読み込むことになるため
let authArt: Promise<typeof import('./auth-art')> | null = null
function initAuthArt() {
  const host = document.querySelector<HTMLElement>('[data-auth-art]')
  // 隠れているとき（スマホ幅）に読み込まないのは、見えない絵のために three.js を取りに行くことになるため
  if (!authArt && !host?.offsetWidth) return
  authArt ??= import('./auth-art')
  // 失敗してもトーストを出さないのは、飾りが出ないだけで操作には困らないため
  authArt.then(({ showAuthArt }) => showAuthArt(host)).catch(() => {})
}

// --- PDF ビューアー（components/pdf.tsx の PdfStage）
// ここに直接 import しないのは、pdf.js が大きく、PDF のない画面でも毎回読み込むことになるため
let pdfViewer: Promise<typeof import('./pdf-viewer')> | null = null
function initPdfViewers() {
  void pdfViewer?.then(({ releaseDetachedPdfViewers }) => releaseDetachedPdfViewers())
  const roots = $$<HTMLElement>('[data-pdf-viewer]:not([data-pdf-ready], [hidden])')
  if (!roots.length) return
  pdfViewer ??= import('./pdf-viewer')
  pdfViewer
    .then(({ mountPdfViewer }) => roots.forEach((root) => void mountPdfViewer(root)))
    .catch(() => {
      pdfViewer = null
      toast('PDF ビューアーを読み込めませんでした。', 'error')
    })
}

// --- マスコットの気まぐれな動き（components/mascot.tsx の Mascot）
// CSS のくり返しだけで動かさないのは、同じ間隔で同じ動きが続くと機械的に見えるため
const MASCOT_QUIRKS = { hop: 900, 'lean-l': 1400, 'lean-r': 1400, squish: 700, peek: 1600, tap: 1300 } as const
const MASCOT_REACTIONS = { surprised: 900, happy: 1600, thinking: 1500 } as const
const MASCOT_GLANCES = ['left', 'right', 'up', 'down'] as const
const livingMascots = new WeakSet<HTMLElement>()

const randomIn = (min: number, max: number) => min + Math.random() * (max - min)
const pickFrom = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
const pickKey = <T extends object>(table: T) => pickFrom(Object.keys(table) as (keyof T)[])

function repeatRandomly(el: HTMLElement, min: number, max: number, act: () => number) {
  const tick = () => {
    if (!el.isConnected) return
    const busy = document.hidden ? 0 : act()
    setTimeout(tick, busy + randomIn(min, max))
  }
  setTimeout(tick, randomIn(min, max))
}

function flagFor(el: HTMLElement, name: string, value: string, ms: number) {
  el.setAttribute(name, value)
  setTimeout(() => el.removeAttribute(name), ms)
  return ms
}

function animateMascot(el: HTMLElement) {
  livingMascots.add(el)
  repeatRandomly(el, 1500, 5500, () => {
    flagFor(el, 'data-blink', '', 130)
    if (Math.random() < 0.25) setTimeout(() => flagFor(el, 'data-blink', '', 130), 280)
    return 450
  })
  repeatRandomly(el, 1200, 4000, () => flagFor(el, 'data-glance', pickFrom(MASCOT_GLANCES), randomIn(700, 2200)))
  repeatRandomly(el, 3500, 9000, () => {
    const quirk = pickKey(MASCOT_QUIRKS)
    return flagFor(el, 'data-quirk', quirk, MASCOT_QUIRKS[quirk])
  })
  repeatRandomly(el, 6000, 14_000, () => {
    const mood = el.dataset.mood
    const reaction = pickKey(MASCOT_REACTIONS)
    if (!mood || mood === reaction || mood === 'sleepy') return 0
    el.dataset.mood = reaction
    setTimeout(() => {
      if (el.dataset.mood === reaction) el.dataset.mood = mood
    }, MASCOT_REACTIONS[reaction])
    return MASCOT_REACTIONS[reaction]
  })
  typeMascotSay(el)
}

// 同じ速さで打ち続けないのは、句読点でも息継ぎしないと機械が読み上げているように見えるため
const MASCOT_PAUSES: Record<string, number> = { '、': 220, '，': 220, '。': 420, '！': 420, '？': 420, '!': 420, '?': 420, '…': 380 }

function splitIntoChars(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  return texts.flatMap((node) => {
    const chars = [...node.data].map((ch) => Object.assign(document.createElement('span'), { className: 'mascot-char', textContent: ch }))
    node.replaceWith(...chars)
    return chars
  })
}

function typeMascotSay(el: HTMLElement) {
  const text = el.querySelector<HTMLElement>('.mascot-say-text')
  if (!text || el.dataset.typing !== '') return
  // 1 文字ずつの span を読み上げさせないのは、スクリーンリーダーが 1 文字ずつ区切って読んでしまうため
  text.after(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: text.textContent }))
  text.setAttribute('aria-hidden', 'true')
  const chars = splitIntoChars(text)
  el.dataset.typing = 'on'
  el.setAttribute('data-hush', '')
  let next = 0
  const typeNext = () => {
    if (!el.isConnected) return
    const ch = chars[next++]
    if (!ch) {
      el.removeAttribute('data-typing')
      el.removeAttribute('data-hush')
      el.removeAttribute('data-talking')
      if (/[！!]$/.test(chars.at(-1)?.textContent ?? '')) flagFor(el, 'data-quirk', 'hop', MASCOT_QUIRKS.hop)
      return
    }
    ch.classList.add('is-shown')
    const pause = MASCOT_PAUSES[ch.textContent] ?? 0
    el.toggleAttribute('data-hush', pause > 0)
    setTimeout(typeNext, pause || randomIn(40, 90))
  }
  setTimeout(typeNext, 450)
}

function initMascots() {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  $$<HTMLElement>('[data-mascot]')
    .filter((el) => !livingMascots.has(el))
    .forEach((el) => {
      if (!still) {
        animateMascot(el)
        return
      }
      el.removeAttribute('data-typing')
      el.removeAttribute('data-talking')
    })
}

// --- コースページを歩き回るマスコット（components/mascot.tsx の WalkingMascot）
// 立つ場所や壁に目印の属性を付けないのは、コースヘッダーのマークアップにまで歩き回りの都合を持ち込むことになるため
// セクションのカードだけにしないのは、Moodle のタイル形式では全体のセクションがないと、見えているカードが 1 枚もないため
const WALKER_GROUNDS = ['.course-hero-cover', '.section-card, .sec-tile']
const WALKER_WALLS = '.back-link, .course-hero-side > *, .course-tabs .tabs, .course-tabs-actions > *, .section-toggles > *'
const WALKER_GAP = 6
// 端まで歩かせないのは、足場の角が丸く、端では足の下に何もないように見えるため
const WALKER_EDGE = 20
const WALKER_SINK = 2
const WALKER_SIGHT = 120
const WALKER_GAITS = {
  walk: { speed: 46, step: '0.56s' },
  run: { speed: 125, step: '0.28s' },
  search: { speed: 26, step: '0.8s' },
} as const

type Box = { x: number; y: number; w: number; h: number }
type WalkerState = 'idle' | 'walk' | 'busy' | 'bump' | 'greet' | 'pet' | 'held' | 'drop' | 'pop' | 'crouch' | 'jump' | 'land'
type Ground = { left: number; right: number; y: number }
type WalkerLook = Partial<Record<'mood' | 'pose' | 'motion' | 'look' | 'prop', string>>
type WalkerActivity = { weight: number; ms: [number, number]; look: WalkerLook; sit?: boolean; cheer?: boolean }
const WALKER_ACTIVITIES: WalkerActivity[] = [
  { weight: 5, ms: [7000, 12_000], sit: true, cheer: true, look: { pose: 'type', motion: 'swing', look: 'down', prop: 'laptop' } },
  { weight: 3, ms: [6000, 10_000], sit: true, look: { pose: 'hold', motion: 'swing', look: 'down', prop: 'book' } },
  { weight: 3, ms: [6000, 9000], sit: true, look: { mood: 'happy', pose: 'sip', motion: 'swing', prop: 'mug' } },
  { weight: 2, ms: [4000, 7000], sit: true, look: { motion: 'swing' } },
  { weight: 2, ms: [2500, 4000], look: { mood: 'happy', pose: 'cheer', motion: 'wiggle', prop: 'notes' } },
  { weight: 2, ms: [5000, 9000], look: { mood: 'sleepy' } },
  { weight: 2, ms: [1800, 3000], look: { mood: 'thinking', motion: 'tilt', look: 'up' } },
  { weight: 4, ms: [1200, 3200], look: {} },
]
type Walker = {
  el: HTMLElement
  mascot: HTMLElement
  box: Box
  grounds: (Ground | null)[]
  level: number
  walls: Box[]
  jump: { fromX: number; fromY: number; to: Box; level: number; start: number; ms: number; arc: number } | null
  state: WalkerState
  until: number
  target: number | null
  speed: number
  greetedAt: number
  measuredAt: number
  grab: { dx: number; dy: number; startX: number; startY: number; moved: boolean } | null
  cheerAfter: boolean
}

const walkerOf = new WeakMap<HTMLElement, Walker>()
let walkerPointer: { x: number; y: number; mouse: boolean } | null = null
let heldWalker: Walker | null = null

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
const lookToward = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'front')

// 画面上の座標をそのまま使わないのは、スクロールのたびに壁とマスコットの位置を測り直すことになるため
function walkerOrigin(el: HTMLElement) {
  const parent = el.offsetParent
  if (parent && parent !== document.body) {
    const r = parent.getBoundingClientRect()
    return { x: r.left, y: r.top }
  }
  return { x: -scrollX, y: -scrollY }
}

function measureWalker(w: Walker, now: number) {
  w.measuredAt = now
  const main = w.el.closest('main')
  if (!main) return
  const o = walkerOrigin(w.el)
  const rectOf = (el: HTMLElement) => el.getBoundingClientRect()
  w.grounds = WALKER_GROUNDS.map((selector) => {
    const r = $$<HTMLElement>(selector, main)
      .map(rectOf)
      .find((rect) => rect.width > 0 && rect.height > 0)
    return r ? { left: r.left - o.x + WALKER_EDGE, right: r.right - o.x - WALKER_EDGE, y: r.top - o.y - w.box.h + WALKER_SINK } : null
  })
  w.walls = $$<HTMLElement>(WALKER_WALLS, main)
    .map(rectOf)
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left - o.x - WALKER_GAP, y: r.top - o.y - WALKER_GAP, w: r.width + WALKER_GAP * 2, h: r.height + WALKER_GAP * 2 }))
}

const standAt = (w: Walker, level: number, x: number): Box => ({ x, y: w.grounds[level]?.y ?? NaN, w: w.box.w, h: w.box.h })

function levelOf(w: Walker, box: Box) {
  return w.grounds.findIndex((g) => !!g && box.y === g.y && box.x >= g.left && box.x + box.w <= g.right)
}

const isFree = (w: Walker, box: Box) => levelOf(w, box) >= 0 && !w.walls.some((wall) => overlaps(box, wall))

function visibleArea(w: Walker): Box {
  const o = walkerOrigin(w.el)
  const top = cssPx('--topbar-h')
  return { x: -o.x, y: top - o.y, w: innerWidth, h: innerHeight - top }
}

function freeSpots(w: Walker, area: Box) {
  return w.grounds.flatMap((g, level) => {
    const spots: Box[] = []
    for (let x = g?.left ?? 0; g && x + w.box.w <= g.right; x += 12) {
      const box = standAt(w, level, x)
      if (isFree(w, box) && overlaps(box, area)) spots.push(box)
    }
    return spots
  })
}

function nearestFree(w: Walker, level: number, maxDistance: number, fromX = w.box.x) {
  const g = w.grounds[level]
  if (!g) return null
  const from = Math.min(Math.max(fromX, g.left), g.right - w.box.w)
  for (let d = 0; d <= maxDistance; d += 6) {
    for (const x of [from - d, from + d]) {
      const box = standAt(w, level, x)
      if (isFree(w, box)) return box
    }
  }
  return null
}

// 真上の足場より真下の足場を選びやすくするのは、離したときに上へ吸い寄せられると落ちたように見えないため
function landingSpot(w: Walker) {
  const scored = w.grounds.flatMap((_, level) => {
    const spot = nearestFree(w, level, 400)
    if (!spot) return []
    const dy = spot.y - w.box.y
    return [{ spot, level, score: Math.abs(spot.x - w.box.x) + Math.abs(dy) * (dy < 0 ? 3 : 1) }]
  })
  return scored.sort((a, b) => a.score - b.score)[0] ?? null
}

function placeWalker(w: Walker, x: number, y: number) {
  w.box.x = x
  w.box.y = y
  w.el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
}

function dressWalker(w: Walker, look: WalkerLook, sit = false) {
  Object.assign(w.mascot.dataset, { mood: 'normal', pose: 'idle', motion: 'float', look: 'front', prop: 'none', ...look })
  w.el.toggleAttribute('data-sitting', sit)
}

function setWalkerState(w: Walker, state: WalkerState, now: number, ms: number) {
  w.state = state
  w.until = now + ms
  w.el.dataset.state = state
  if (state !== 'walk') delete w.el.dataset.heading
}

function spawnWalker(w: Walker, now: number) {
  const spots = freeSpots(w, visibleArea(w))
  if (spots.length === 0) {
    delete w.el.dataset.shown
    return false
  }
  const spot = pickFrom(spots)
  placeWalker(w, spot.x, spot.y)
  w.level = levelOf(w, spot)
  w.el.dataset.shown = ''
  w.target = null
  dressWalker(w, { mood: 'happy', pose: 'greet' })
  setWalkerState(w, 'pop', now, 1600)
  return true
}

function pickWalkTarget(w: Walker, direction?: -1 | 1) {
  const g = w.grounds[w.level]
  if (!g) return null
  for (let i = 0; i < 20; i++) {
    const x = Math.min(Math.max(w.box.x + (direction ?? pickFrom([-1, 1])) * randomIn(60, 400), g.left), g.right - w.box.w)
    const box = standAt(w, w.level, x)
    if (Math.abs(x - w.box.x) > 30 && isFree(w, box)) return x
  }
  return null
}

function startJump(w: Walker, now: number) {
  const levels = w.grounds.flatMap((g, level) => (g && level !== w.level ? [level] : []))
  if (levels.length === 0) return false
  const level = pickFrom(levels)
  const to = nearestFree(w, level, 260, w.box.x + randomIn(-120, 120))
  // 見えていない足場へ跳ばせないのは、画面の外へ消えていなくなったように見えるため
  if (!to || !overlaps(to, visibleArea(w))) return false
  const dy = to.y - w.box.y
  w.jump = { fromX: w.box.x, fromY: w.box.y, to, level, start: 0, ms: Math.min(1100, 520 + Math.abs(dy) * 0.9), arc: Math.abs(dy) / 4 + 36 }
  dressWalker(w, { mood: dy < 0 ? 'happy' : 'surprised', motion: 'none', look: dy < 0 ? 'up' : 'down' })
  setWalkerState(w, 'crouch', now, 280)
  return true
}

function flyWalker(w: Walker, now: number) {
  const jump = w.jump
  if (!jump) return startWalking(w, now)
  if (w.state === 'crouch') {
    const up = jump.to.y < jump.fromY
    dressWalker(w, { mood: up ? 'happy' : 'surprised', pose: up ? 'cheer' : 'open', motion: 'none', look: up ? 'up' : 'down' })
    setWalkerState(w, 'jump', now, jump.ms)
    jump.start = now
    w.el.toggleAttribute('data-spin', up && Math.random() < 0.5)
    if (Math.abs(jump.to.x - jump.fromX) > 8) w.el.dataset.heading = jump.to.x < jump.fromX ? 'left' : 'right'
    return
  }
  const t = Math.min(1, (now - jump.start) / jump.ms)
  if (t < 1) {
    placeWalker(w, jump.fromX + (jump.to.x - jump.fromX) * t, jump.fromY + (jump.to.y - jump.fromY) * t - jump.arc * 4 * t * (1 - t))
    return
  }
  placeWalker(w, jump.to.x, jump.to.y)
  w.level = jump.level
  w.jump = null
  w.el.removeAttribute('data-spin')
  dressWalker(w, { mood: 'happy', motion: 'none' })
  setWalkerState(w, 'land', now, 600)
}

function moveOn(w: Walker, now: number) {
  if (Math.random() < 0.45 && startJump(w, now)) return
  startWalking(w, now)
}

function startWalking(w: Walker, now: number) {
  // 左へ歩くときに虫めがねを持たせないのは、虫めがねを持つ右手を右にしか向けられないため
  const searchTarget = Math.random() < 0.2 ? pickWalkTarget(w, 1) : null
  const target = searchTarget ?? pickWalkTarget(w)
  if (target === null) return idleWalker(w, now)
  const gait = searchTarget !== null ? WALKER_GAITS.search : Math.random() < 0.15 ? WALKER_GAITS.run : WALKER_GAITS.walk
  w.target = target
  w.speed = gait.speed
  w.mascot.style.setProperty('--mascot-step', gait.step)
  if (gait === WALKER_GAITS.search) dressWalker(w, { pose: 'point', motion: 'walk', prop: 'magnifier' })
  else dressWalker(w, { mood: gait === WALKER_GAITS.run ? 'happy' : 'normal', motion: 'walk' })
  setWalkerState(w, 'walk', now, 20_000)
}

function pickActivity() {
  let roll = Math.random() * WALKER_ACTIVITIES.reduce((sum, a) => sum + a.weight, 0)
  return WALKER_ACTIVITIES.find((a) => (roll -= a.weight) < 0) ?? WALKER_ACTIVITIES[0]
}

function idleWalker(w: Walker, now: number) {
  const activity = pickActivity()
  dressWalker(w, activity.look, activity.sit)
  w.cheerAfter = !!activity.cheer
  setWalkerState(w, 'busy', now, randomIn(...activity.ms))
}

function cheerWalker(w: Walker, now: number) {
  w.cheerAfter = false
  dressWalker(w, { mood: 'happy', pose: 'cheer', motion: 'hop' })
  setWalkerState(w, 'pet', now, 1300)
}

function stepWalker(w: Walker, dt: number, now: number) {
  if (w.target === null) return idleWalker(w, now)
  const dx = w.target - w.box.x
  if (Math.abs(dx) < 2) {
    w.target = null
    return idleWalker(w, now)
  }
  const step = Math.min(Math.abs(dx), w.speed * dt)
  const box = standAt(w, w.level, w.box.x + Math.sign(dx) * step)
  const heading = dx < 0 ? 'left' : 'right'
  w.el.dataset.heading = heading
  w.mascot.dataset.look = heading
  if (isFree(w, box)) {
    placeWalker(w, box.x, box.y)
    return
  }
  w.target = null
  dressWalker(w, { mood: 'surprised', motion: 'none', look: heading })
  setWalkerState(w, 'bump', now, randomIn(700, 1100))
}

function pointerNearWalker(w: Walker) {
  if (!walkerPointer?.mouse) return null
  const o = walkerOrigin(w.el)
  const dx = walkerPointer.x - o.x - (w.box.x + w.box.w / 2)
  const dy = walkerPointer.y - o.y - (w.box.y + w.box.h / 2)
  return Math.hypot(dx, dy) < WALKER_SIGHT ? { dx, dy } : null
}

function petWalker(w: Walker, now: number) {
  dressWalker(w, { mood: 'happy', pose: 'cheer', motion: 'hop' })
  setWalkerState(w, 'pet', now, 1500)
  const heart = w.el.querySelector<HTMLElement>('.mascot-walker-heart')
  if (!heart) return
  for (let i = 0; i < 3; i++) {
    const copy = heart.cloneNode(true) as HTMLElement
    copy.hidden = false
    copy.style.setProperty('--heart-x', `${randomIn(-110, 10)}%`)
    copy.style.setProperty('--heart-drift', `${randomIn(-14, 14)}px`)
    copy.style.animationDelay = `${i * 0.18}s`
    copy.addEventListener('animationend', () => copy.remove())
    w.el.append(copy)
  }
}

function settleWalker(w: Walker, now: number) {
  measureWalker(w, now)
  if (w.el.dataset.shown === undefined) return spawnWalker(w, now)
  const level = levelOf(w, w.box)
  if (level >= 0 && isFree(w, w.box)) {
    w.level = level
    return true
  }
  const landing = landingSpot(w)
  if (!landing) return spawnWalker(w, now)
  placeWalker(w, landing.spot.x, landing.spot.y)
  w.level = landing.level
  w.target = null
  return true
}

function tickWalker(w: Walker, dt: number, now: number) {
  if (w.state === 'held') {
    if (now > w.until && w.mascot.dataset.mood === 'surprised') w.mascot.dataset.mood = 'happy'
    return
  }
  if (w.state === 'crouch' || w.state === 'jump') {
    if (w.state === 'jump' || now >= w.until) flyWalker(w, now)
    return
  }
  if (now - w.measuredAt > 400 && !settleWalker(w, now)) return

  const near = pointerNearWalker(w)
  if (near && (w.state === 'walk' || w.state === 'busy') && now - w.greetedAt > 6000) {
    w.target = null
    w.greetedAt = now
    w.cheerAfter = false
    const wasSleeping = w.mascot.dataset.mood === 'sleepy'
    dressWalker(w, { mood: wasSleeping ? 'surprised' : 'happy', pose: 'wave', look: lookToward(near.dx, near.dy) })
    setWalkerState(w, 'greet', now, 1800)
  }
  if (w.state === 'greet' && near) {
    w.until = Math.max(w.until, now + 900)
    w.mascot.dataset.look = lookToward(near.dx, near.dy)
    if (now - w.greetedAt > 700) w.mascot.dataset.mood = 'happy'
  }

  if (w.state === 'walk') stepWalker(w, dt, now)
  if (now < w.until) return
  if (w.state === 'busy' && w.cheerAfter) cheerWalker(w, now)
  else if (w.state === 'busy' && Math.random() < 0.25) idleWalker(w, now)
  else moveOn(w, now)
}

function runWalker(w: Walker) {
  let last = performance.now()
  const frame = (now: number) => {
    if (!w.el.isConnected) {
      if (heldWalker === w) heldWalker = null
      return
    }
    tickWalker(w, Math.min((now - last) / 1000, 0.05), now)
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function initWalkers() {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  $$<HTMLElement>('[data-mascot-walker]')
    .filter((el) => !walkerOf.has(el))
    .forEach((el) => {
      const mascot = el.querySelector<HTMLElement>('[data-mascot]')
      if (!mascot) return
      el.hidden = false
      const { width, height } = el.getBoundingClientRect()
      const w: Walker = {
        el,
        mascot,
        box: { x: 0, y: 0, w: width, h: height },
        grounds: [],
        level: 0,
        walls: [],
        jump: null,
        state: 'idle',
        until: 0,
        target: null,
        speed: 0,
        greetedAt: 0,
        measuredAt: 0,
        grab: null,
        cheerAfter: false,
      }
      walkerOf.set(el, w)
      const now = performance.now()
      settleWalker(w, now)
      if (!still) return runWalker(w)
      dressWalker(w, { motion: 'none' })
      setWalkerState(w, 'idle', now, Infinity)
    })
}

document.addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-mascot-walker]')
  const w = el && walkerOf.get(el)
  if (!w || e.button !== 0) return
  // 既定の動作に任せないのは、ドラッグで文字が選ばれたり、タッチで画面がスクロールしたりするため
  e.preventDefault()
  const o = walkerOrigin(w.el)
  w.grab = { dx: e.clientX - o.x - w.box.x, dy: e.clientY - o.y - w.box.y, startX: e.clientX, startY: e.clientY, moved: false }
  heldWalker = w
})

document.addEventListener('pointermove', (e) => {
  walkerPointer = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' }
  const w = heldWalker
  if (!w?.grab) return
  if (!w.grab.moved) {
    if (Math.hypot(e.clientX - w.grab.startX, e.clientY - w.grab.startY) < 6) return
    w.grab.moved = true
    w.target = null
    w.jump = null
    w.el.removeAttribute('data-spin')
    dressWalker(w, { mood: 'surprised', pose: 'open', motion: 'none' })
    setWalkerState(w, 'held', performance.now(), 600)
  }
  const o = walkerOrigin(w.el)
  placeWalker(w, e.clientX - o.x - w.grab.dx, e.clientY - o.y - w.grab.dy)
})

document.addEventListener('pointerout', (e) => {
  if (!e.relatedTarget) walkerPointer = null
})

function releaseWalker(e: PointerEvent) {
  const w = heldWalker
  heldWalker = null
  if (!w?.grab) return
  const { moved } = w.grab
  w.grab = null
  const now = performance.now()
  if (!moved) {
    if (e.type === 'pointerup' && w.state !== 'crouch' && w.state !== 'jump') petWalker(w, now)
    return
  }
  w.greetedAt = now
  dressWalker(w, { mood: 'happy', motion: 'none' })
  setWalkerState(w, 'drop', now, 800)
  settleWalker(w, now)
}
document.addEventListener('pointerup', releaseWalker)
document.addEventListener('pointercancel', releaseWalker)

// --- ⌘S / Ctrl+S で保存（data-save-shortcut のボタンを押す）
document.addEventListener('keydown', (e) => {
  if (e.key !== 's' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
  const btn = document.querySelector<HTMLButtonElement>('[data-save-shortcut]')
  if (!btn) return
  e.preventDefault()
  if (!btn.disabled) btn.click()
})

// --- 参加者を追加するモーダルのユーザー検索
let userSearchTimer = 0
let userSearchController: AbortController | null = null
document.addEventListener('input', (e) => {
  const input = (e.target as Element).closest<HTMLInputElement>('[data-user-search]')
  if (!input) return
  clearTimeout(userSearchTimer)
  userSearchTimer = window.setTimeout(() => searchUsers(input), 200)
})

async function searchUsers(input: HTMLInputElement) {
  const results = document.getElementById(input.getAttribute('aria-controls') ?? '')
  if (!results) return
  userSearchController?.abort()
  const controller = (userSearchController = new AbortController())
  const url = new URL(input.dataset.userSearch!, location.href)
  url.searchParams.set('q', input.value)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error()
    results.innerHTML = await res.text()
  } catch {
    if (!controller.signal.aborted) toast('検索できませんでした。通信状況を確認してください。', 'error')
  }
}

// --- 追加したセクションへ、モーダルに入力した名前を飛ばし、ほかの部品を周りから集める
type TextStyle = Pick<CSSStyleDeclaration, 'fontSize' | 'fontWeight' | 'color' | 'letterSpacing'>
type Flight = { left: number; centerY: number; style: TextStyle; known: Set<string> }

const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const GATHER_PARTS = '.section-num, .section-title-wrap > .small, .section-head > .chip, .section-caret, .row-actions .icon-btn, .add-item'
const GATHER_DISTANCE = 56

let pendingFlight: Flight | null = null

const textStyle = (el: Element): TextStyle => {
  const s = getComputedStyle(el)
  return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, letterSpacing: s.letterSpacing }
}

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  const input = form.matches('[data-add-section]') ? form.querySelector<HTMLInputElement>('input[name=title]') : null
  pendingFlight = null
  if (e.defaultPrevented || !input || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const r = input.getBoundingClientRect()
  const s = getComputedStyle(input)
  pendingFlight = {
    left: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft) - input.scrollLeft,
    centerY: r.top + r.height / 2,
    style: textStyle(input),
    known: new Set($$('.section-card').map((el) => el.id)),
  }
})

function takeFlight() {
  const flight = pendingFlight
  pendingFlight = null
  return flight
}

function arrivalScrollY(el: Element) {
  const r = el.getBoundingClientRect()
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  if (r.top >= top && r.bottom <= innerHeight) return scrollY
  const offset = Math.max(16, (innerHeight - top - r.height) / 2)
  return Math.min(document.documentElement.scrollHeight - innerHeight, Math.max(0, scrollY + r.top - top - offset))
}

// scrollTo の smooth に任せないのは、速さの曲線と終わる時刻を、名前が飛ぶアニメーションと揃えられないため
function easeScrollTo(y: number, duration: number) {
  const from = scrollY
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    scrollTo(0, from + (y - from) * easeInOut(t))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function gatherParts(card: HTMLElement, title: HTMLElement) {
  const t = title.getBoundingClientRect()
  const origin = { x: t.left + t.width / 2, y: t.top + t.height / 2 }
  const parts = $$<HTMLElement>(GATHER_PARTS, card)
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const dx = r.left + r.width / 2 - origin.x
      const dy = r.top + r.height / 2 - origin.y
      return { el, dx, dy, distance: Math.hypot(dx, dy) || 1 }
    })
    .sort((a, b) => a.distance - b.distance)
  const head = card.querySelector('.section-head')
  const frame = getComputedStyle(card)
  const animations = [
    card.animate(
      [
        { borderColor: 'transparent', backgroundColor: 'transparent', boxShadow: 'none' },
        { borderColor: frame.borderTopColor, backgroundColor: frame.backgroundColor, boxShadow: frame.boxShadow },
      ],
      { duration: 600, easing: 'ease-out', fill: 'backwards' },
    ),
    ...(head
      ? [
          head.animate([{ borderBottomColor: 'transparent' }, { borderBottomColor: getComputedStyle(head).borderBottomColor }], {
            duration: 600,
            fill: 'backwards',
          }),
        ]
      : []),
    ...parts.map(({ el, dx, dy, distance }, i) =>
      el.animate(
        [
          { opacity: 0, transform: `translate(${(dx / distance) * GATHER_DISTANCE}px, ${(dy / distance) * GATHER_DISTANCE}px) scale(0.6)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 520, delay: i * 40, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' },
      ),
    ),
  ]
  animations.forEach((a) => a.pause())
  return animations
}

// 追加したセクションをリダイレクト先の #section-ID で探さないのは、fetch の応答の URL からはフラグメントが落ちるため
function prepareArrival(flight: Flight) {
  const card = $$<HTMLElement>('.section-card').find((el) => !flight.known.has(el.id))
  const title = card?.querySelector<HTMLElement>('.section-title')
  if (!card || !title) return null
  const ghost = document.createElement('span')
  ghost.className = 'section-title-flight'
  ghost.textContent = title.textContent
  Object.assign(ghost.style, { left: `${flight.left}px`, top: `${flight.centerY}px`, ...flight.style })
  document.body.append(ghost)
  title.style.visibility = 'hidden'
  const gathering = gatherParts(card, title)
  return () => {
    const target = arrivalScrollY(card)
    const delta = target - scrollY
    const duration = Math.min(900, 520 + Math.abs(delta) * 0.4)
    const to = title.getBoundingClientRect()
    const flying = ghost.animate(
      [
        { left: `${flight.left}px`, top: `${flight.centerY}px`, ...flight.style },
        { left: `${to.left}px`, top: `${to.top + to.height / 2 - delta}px`, ...textStyle(title) },
      ],
      { duration, easing: EASE_IN_OUT, fill: 'forwards' },
    )
    easeScrollTo(target, duration)
    gathering.forEach((a) => a.play())
    flying.onfinish = () => {
      ghost.remove()
      title.style.removeProperty('visibility')
    }
  }
}

// --- AI アシスタントのパネル（components/ai-panel.tsx）
// 送信を再読み込みなしの遷移に任せないのは、応答を言い終えるまで待たずに、届いた分から画面に出すため
const aiPanel = () => document.getElementById('ai-panel')
const aiInput = () => aiPanel()?.querySelector<HTMLTextAreaElement>('.ai-textarea') ?? null
let aiSending = false
let aiPolling: ReturnType<typeof setTimeout> | null = null

function aiTemplate(kind: 'user' | 'assistant' | 'tool' | 'pending' | 'error', text?: string) {
  const template = aiPanel()?.querySelector<HTMLTemplateElement>(`template[data-ai-template="${kind}"]`)
  const el = template?.content.firstElementChild?.cloneNode(true)
  if (!(el instanceof HTMLElement)) throw new Error(`template ${kind} がありません`)
  if (text !== undefined) el.querySelector('[data-ai-text]')!.textContent = text
  return el
}

function scrollAiLog(force = false) {
  const log = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
  if (!log) return
  // 読み返しているときに最下部へ戻さないのは、応答が流れているあいだ、上の発言を読めなくなるため
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 80) log.scrollTop = log.scrollHeight
}

function fitAiInput(input: HTMLTextAreaElement) {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

const aiDocked = () => matchMedia(AI_PANEL_DOCKED).matches

function setAiOpen(open: boolean) {
  document.documentElement.toggleAttribute('data-ai-open', open)
  $$('.ai-panel-toggle').forEach((el) => el.setAttribute('aria-expanded', String(open)))
  setSetting('aiPanel', open)
  if (!open) return
  scrollAiLog(true)
  // 狭い画面で入力欄にフォーカスしないのは、開いただけでキーボードが出て会話が隠れるため
  if (aiDocked()) aiInput()?.focus()
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-toggle]')) return setAiOpen(!document.documentElement.hasAttribute('data-ai-open'))
  const suggestion = target.closest<HTMLElement>('[data-ai-suggest]')
  const input = aiInput()
  if (!suggestion || !input) return
  input.value = suggestion.dataset.aiSuggest ?? ''
  fitAiInput(input)
  input.form?.requestSubmit()
})

document.addEventListener('keydown', (e) => {
  const input = e.target as Element
  if (e.key === 'Escape' && !aiDocked() && aiPanel()?.contains(input)) return setAiOpen(false)
  if (!(input instanceof HTMLTextAreaElement) || !input.matches('.ai-textarea') || e.key !== 'Enter' || e.shiftKey) return
  // keyCode も見るのは、Safari では変換を確定した Enter の keydown で isComposing が false になるため
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  input.form?.requestSubmit()
})

document.addEventListener('input', (e) => {
  const input = e.target as Element
  if (input instanceof HTMLTextAreaElement && input.matches('.ai-textarea')) fitAiInput(input)
})

async function refreshAiPanel(draft = '') {
  if (aiPolling) clearTimeout(aiPolling)
  aiPolling = null
  const res = await fetch('/ai/chat', { headers: { Accept: 'text/html' } })
  const doc = res.ok ? new DOMParser().parseFromString(await res.text(), 'text/html') : null
  const next = doc?.getElementById('ai-panel')
  const current = aiPanel()
  if (!next || !current) return
  current.replaceWith(document.adoptNode(next))
  const input = aiInput()
  if (input && draft) {
    input.value = draft
    fitAiInput(input)
  }
  initMascots()
  scrollAiLog(true)
  watchAiBusy()
}

// 作成中の応答を開き直した画面に流し直さないのは、流れていた続きを受け取る手段がなく、言い終えて保存されたものを取り直せば足りるため
function watchAiBusy() {
  if (aiSending || aiPolling || !aiPanel()?.hasAttribute('data-busy')) return
  aiPolling = setTimeout(() => {
    aiPolling = null
    void refreshAiPanel()
  }, 3000)
}

type AiStreamHooks = { onRetract?: () => void; onChat?: (id: number) => void }

/** 応答を届いた分から会話に書き足す。closed はチャットがもうないこと、confirmed は確認カードを出したこと、errors は出したエラーの文言 */
async function streamAi(url: string, data: FormData, { onRetract, onChat }: AiStreamHooks = {}) {
  const panel = aiPanel()
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const outcome = { closed: false, retracted: false, confirmed: false, errors: [] as string[] }
  if (!panel || !log) return outcome
  data.set('page', location.pathname)
  aiSending = true
  panel.toggleAttribute('data-busy', true)
  const pending = aiTemplate('pending')
  log.append(pending)
  scrollAiLog(true)

  let bubble: HTMLElement | null = null
  let markdown = ''
  const handle = (event: AiAgentEvent) => {
    if (event.type === 'text') {
      if (!bubble) {
        bubble = aiTemplate('assistant')
        pending.before(bubble)
      }
      markdown += event.text
      bubble.querySelector('[data-ai-text]')!.innerHTML = renderMarkdown(markdown)
    } else if (event.type === 'tool' || event.type === 'confirm') {
      bubble = null
      markdown = ''
      if (event.type === 'tool') pending.before(aiTemplate('tool', event.label))
      else outcome.confirmed = true
    } else if (event.type === 'error') {
      if (event.retract) {
        outcome.retracted = true
        onRetract?.()
      }
      outcome.errors.push(event.message)
      pending.before(aiTemplate('error', event.message))
    } else if (event.type === 'chat') {
      panel.dataset.chat = String(event.id)
      onChat?.(event.id)
    } else if (event.type === 'closed') {
      outcome.closed = true
    } else {
      const note = panel.querySelector('[data-ai-quota]')
      if (note) note.textContent = event.quota
    }
    scrollAiLog()
  }

  try {
    const res = await fetch(url, { method: 'POST', body: data, headers: { Accept: 'application/x-ndjson' } })
    if (!res.ok || !res.body) throw new Error(`status ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AiAgentEvent)
    }
  } catch {
    pending.before(aiTemplate('error', 'AI と通信できませんでした。少し待ってから、もう一度お試しください。'))
  } finally {
    pending.remove()
    aiSending = false
    panel.removeAttribute('data-busy')
    scrollAiLog()
  }
  return outcome
}

async function sendAiMessage(form: HTMLFormElement) {
  const panel = aiPanel()
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const input = aiInput()
  if (!panel || !log || !input) return
  const text = input.value.trim()
  const data = new FormData(form)
  const intro = log.querySelector<HTMLElement>('[data-ai-intro]')
  const started = !panel.dataset.chat
  const dismissing = !!log.querySelector('.ai-card[data-state=pending]')
  if (intro) intro.hidden = true
  const sent = aiTemplate('user', text)
  log.append(sent)
  input.value = ''
  fitAiInput(input)

  const outcome = await streamAi(form.action, data, {
    onRetract: () => {
      sent.remove()
      if (intro && !log.querySelector('.ai-msg')) intro.hidden = false
      if (!input.value) input.value = text
      fitAiInput(input)
    },
    onChat: (id) => {
      const chatField = form.elements.namedItem('chat')
      if (chatField instanceof HTMLInputElement) chatField.value = String(id)
    },
  })
  // 新しく始めたチャットと確認カードを取り直すのは、ヘッダーのモデル名・「閉じる」ボタン・カードを、サーバーの描いたものにそろえるため
  if (outcome.closed || outcome.confirmed || dismissing || (started && panel.dataset.chat)) {
    await refreshAiPanel(outcome.retracted ? text : '')
    // 取り直したパネルだけにしないのは、送り直してもらう発言はサーバーに残らず、断った理由まで消えるため
    if (outcome.retracted) {
      const next = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
      for (const message of outcome.errors) next?.append(aiTemplate('error', message))
      scrollAiLog(true)
    }
  }
}

async function decideAiCard(form: HTMLFormElement, submitter: HTMLElement | null) {
  const data = new FormData(form, submitter)
  $$<HTMLButtonElement>('button', form).forEach((btn) => (btn.disabled = true))
  await streamAi(form.action, data)
  await refreshAiPanel()
}

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  if (e.defaultPrevented || !form.matches('[data-ai-form], [data-ai-close], [data-ai-confirm]')) return
  e.preventDefault()
  if (form.matches('[data-ai-form]')) {
    if (!aiSending) void sendAiMessage(form)
    return
  }
  if (form.matches('[data-ai-confirm]')) {
    if (!aiSending) void decideAiCard(form, e.submitter)
    return
  }
  delete form.dataset.confirmed
  fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`)
      return refreshAiPanel()
    })
    .then(() => aiDocked() && aiInput()?.focus())
    .catch(() => toast('チャットを閉じられませんでした。', 'error'))
})

function initAiPanel() {
  const open = document.documentElement.hasAttribute('data-ai-open')
  $$('.ai-panel-toggle').forEach((el) => el.setAttribute('aria-expanded', String(open)))
  watchAiBusy()
}

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

/** background は先読みと開いている画面の更新。サーバーは操作ログに数えない（lib/operation-log.ts） */
async function fetchPage(url: URL, init: RequestInit = {}, background = false): Promise<Page> {
  const res = await fetch(url, { ...init, headers: background ? { Accept: 'text/html', 'X-Background': '1' } : { Accept: 'text/html' } })
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
  const page = fetchPage(url, {}, true)
  page.catch(() => prefetched.delete(urlKey(url)))
  prefetched.set(urlKey(url), { at: Date.now(), page })
}

const assetSignature = (doc: Document) =>
  $$<HTMLScriptElement>('script[src]', doc.head)
    .map((el) => el.getAttribute('src'))
    .join()
// 差し替えた body の script は実行されないので、専用スクリプトを持つページや、デプロイで JS が変わったときは読み込み直す
const needsFullLoad = (doc: Document) => doc.body.querySelector('script') !== null || assetSignature(doc) !== assetSignature(document)

// --- 遷移しても残す部分（data-persist）
// body を丸ごと差し替えないのは、カーソルを乗せて開いているサイドバーが DOM から一度外れ、閉じてから開き直して見えるため
// ページ全体を差分で更新しないのは、入力途中のフォームの値などが新しいページに持ち越されるため
function syncAttributes(from: Element, to: Element) {
  ;[...from.attributes].forEach((a) => to.hasAttribute(a.name) || from.removeAttribute(a.name))
  ;[...to.attributes].forEach((a) => from.getAttribute(a.name) !== a.value && from.setAttribute(a.name, a.value))
}

function patch(from: Element, to: Element, persist: boolean) {
  syncAttributes(from, to)
  const olds = [...from.childNodes]
  const news = [...to.childNodes]
  news.forEach((node, i) => {
    const cur = olds[i]
    if (!cur) return from.append(node)
    if (cur.nodeName !== node.nodeName) return cur.replaceWith(node)
    if (!(cur instanceof Element) || !(node instanceof Element)) {
      if (persist) return cur.nodeValue !== node.nodeValue && (cur.nodeValue = node.nodeValue)
      return cur.replaceWith(node)
    }
    // 中身を新しいページに合わせないのは、AI のパネルのように、描いたあと client.ts が書き足していく部分を消さないため
    if (cur.hasAttribute('data-keep') && cur.id === node.id) return
    const inner = persist || cur.hasAttribute('data-persist')
    if (inner || cur.querySelector('[data-persist]')) return patch(cur, node, inner)
    cur.replaceWith(node)
  })
  olds.slice(news.length).forEach((n) => n.remove())
}

function swapBody(next: HTMLElement) {
  const kept = $$('[data-persist]').some((el) => el.id && next.querySelector(`#${CSS.escape(el.id)}[data-persist]`))
  if (!kept) return document.body.replaceWith(next)
  const immersive = (root: ParentNode) => !!root.querySelector('.app-immersive')
  const changesRail = immersive(document.body) !== immersive(next)
  patch(document.body, next, false)
  const rail = changesRail ? document.getElementById('rail') : null
  if (!rail) return
  // CSS だけで止めないのは、サイドバーが遷移しても同じ要素のまま残り、細いレールとヘッダーから開くサイドバーの間の幅と位置の transition を、CSS では開閉によるものと区別できないため
  // 差し替えの前に付けないのは、patch が新しいページに合わせて style 属性を消すため
  rail.style.setProperty('transition', 'none')
  // 次の描画を待たずにここで計算させ、戻すのも 2 フレーム後にするのは、View Transition の更新中は描画が止まっていて、新しい見た目を計算する前に戻すとその時点から transition が始まるため
  void getComputedStyle(rail).transform
  requestAnimationFrame(() => requestAnimationFrame(() => rail.style.removeProperty('transition')))
}

// --- 開いているサイドバーを遷移中も開いたままにする
// :hover だけに任せないのは、遷移アニメーション中は画面がスナップショットの層で覆われてホバーが外れ、一瞬閉じてから開き直すため
let railHeld = false
function holdRail() {
  const rail = document.getElementById('rail')
  if (!railHeld && !rail?.matches(':hover')) return
  railHeld = true
  rail?.classList.add('is-held')
}
document.addEventListener('pointermove', (e) => {
  if (!railHeld) return
  const rail = document.getElementById('rail')
  const r = rail?.getBoundingClientRect()
  // 要素で判定しないのは、遷移アニメーション中のポインターイベントがサイドバーではなく画面全体に届くため
  if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return
  railHeld = false
  rail?.classList.remove('is-held')
})

// --- ページごとのスタイルシート（components/style.tsx が data-style-order 付きで出す）
// 差し替えたあとに読み込まないのは、新しい本文が見た目の付かないまま一瞬表示されるため
// 読み込み済みのものを外さないのは、別のページへ戻るたびに取り直すことになるため
function loadStyles(doc: Document) {
  const order = (el: HTMLLinkElement) => Number(el.dataset.styleOrder)
  const loaded = $$<HTMLLinkElement>('link[data-style-order]', document.head)
  const pending = $$<HTMLLinkElement>('link[data-style-order]', doc.head)
    .filter((next) => !loaded.some((el) => el.getAttribute('href') === next.getAttribute('href')))
    .map((next) => {
      const link = document.importNode(next)
      // 同じ順番の古いもの（デプロイで中身が変わったもの）の直後に置くのは、読み込みが終わるまで古い見た目を残すため
      const stale = loaded.find((el) => order(el) === order(next))
      const later = loaded.find((el) => order(el) > order(next))
      if (stale) stale.after(link)
      else if (later) later.before(link)
      else (loaded.at(-1) ?? document.head.lastElementChild)?.after(link)
      return new Promise<void>((resolve) => {
        link.addEventListener('load', () => (stale?.remove(), resolve()), { once: true })
        link.addEventListener('error', () => resolve(), { once: true })
      })
    })
  return Promise.all(pending)
}

// --- タブを切り替えたら、選択中の背景を前のタブの位置から滑らせ、中身を切り替えた向きに流す
// 背景を CSS の transition に任せないのは、遷移でタブごと差し替わり、前の状態の要素が残らないため
function markTabSwitch(doc: Document) {
  const prev = $$('[data-tabs] .tab.active').map((a) => a.getAttribute('href'))
  const from = $$<HTMLElement>('[data-tabs] .tab:not(.active)', doc).find((a) => prev.includes(a.getAttribute('href')))
  const tabs = from?.parentElement ? $$<HTMLElement>('.tab', from.parentElement) : []
  const to = tabs.find((a) => a.classList.contains('active'))
  if (!from || !to) return
  from.classList.add('is-leaving')
  to.classList.add('is-entering')
  return tabs.indexOf(to) > tabs.indexOf(from) ? 'next' : 'prev'
}

function slideTabIndicator() {
  const from = document.querySelector('.tab.is-leaving')
  const to = document.querySelector<HTMLElement>('.tab.is-entering')
  if (!from || !to) return
  const f = from.getBoundingClientRect()
  const t = to.getBoundingClientRect()
  to.style.setProperty('--tab-from-left', `${f.left - t.left}px`)
  to.style.setProperty('--tab-from-right', `${t.right - f.right}px`)
}

function render(doc: Document, scroll: () => void, settled?: () => void) {
  // DOMParser はスクリプト無効として解析し noscript の中身を要素にするので、そのまま差し込むと表示されるブラウザがある
  $$('noscript', doc.body).forEach((el) => el.remove())
  liveBase = cloneMain(doc)
  holdRail()
  const tabSlide = markTabSwitch(doc)
  const swap = () => {
    document.title = doc.title
    swapBody(doc.body)
    slideTabIndicator()
    holdRail()
    initPage()
    document.querySelector<HTMLElement>('[autofocus]')?.focus()
    scroll()
  }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swap()
    return settled?.()
  }
  const root = document.documentElement
  if (tabSlide) root.dataset.tabSlide = tabSlide
  const transition = document.startViewTransition(swap)
  void transition.finished.finally(() => {
    if (root.dataset.tabSlide === tabSlide) delete root.dataset.tabSlide
    settled?.()
  })
  return transition.updateCallbackDone
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
    const fromPrefetch = method === 'GET' && !pop && takePrefetched(url)
    const page = await (fromPrefetch || fetchPage(url, { method, body, signal: controller.signal }))
    if (controller.signal.aborted) return
    if (!page.isHtml) return location.assign(page.url)
    const doc = new DOMParser().parseFromString(page.html, 'text/html')
    if (needsFullLoad(doc)) return location.assign(page.url)
    if (fromPrefetch) navigator.sendBeacon('/views', new URLSearchParams({ path: new URL(page.url).pathname }))
    await loadStyles(doc)
    if (controller.signal.aborted) return

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
    const flight = method === 'POST' && page.redirected ? takeFlight() : null
    let arrive: (() => void) | null = null
    await render(
      doc,
      () => {
        arrive = flight && prepareArrival(flight)
        if (arrive) return scrollTo(0, y)
        if (pop) return scrollTo(0, history.state?.scrollY ?? 0)
        keepScroll ? scrollTo(0, y) : scrollToHash(next.hash)
      },
      () => arrive?.(),
    )
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
  void visit(link.url)
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
  void visit(url, {
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
  if (urlKey(url) !== renderedKey) void visit(url, { pop: true })
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

// --- 開いているコースの内容が変わったら、再読み込みなしで画面に反映する（components/course.tsx の CourseLiveSync）
// socket.io で知らせないのは、画面共有の画面だけが読み込んでいるクライアントを、すべての画面で読み込むことになるため
const LIVE_INTERVAL = 10_000
const EDITING = 'input, textarea, select, [contenteditable]'
const OPENED = 'details.popover[open], [popover]:popover-open'

const cloneMain = (doc: Document) => (doc.querySelector('main')?.cloneNode(true) as Element | undefined) ?? null
const liveMarker = (root: ParentNode = document) => root.querySelector<HTMLElement>('[data-live]')

// 画面の要素と新しい内容を直接比べないのは、開閉や完了の切り替えなど画面で変えた状態まで、サーバーでの変更として扱ってしまうため
let liveBase = cloneMain(document)
let liveRevision: string | null = null
let liveTimer = 0
let liveRun = 0

type LiveChange = {
  baseParent: Node
  liveParent: Node
  base: ChildNode[]
  live: ChildNode[]
  next: ChildNode[]
  baseAnchor: Node | null
  liveAnchor: Node | null
}

const sameShell = (a: Node, b: Node) =>
  a instanceof Element &&
  b instanceof Element &&
  a.tagName === b.tagName &&
  a.attributes.length === b.attributes.length &&
  [...a.attributes].every((attr) => b.getAttribute(attr.name) === attr.value)

// 子は位置で対応させるので、画面で子を足し引きした要素（エディターを組み込んだ入力欄など）は、中を比べず丸ごと置き換える
function diffChildren(base: Node, next: Node, live: Node, changes: LiveChange[]) {
  const b = [...base.childNodes]
  const n = [...next.childNodes]
  const l = [...live.childNodes]
  if (l.length !== b.length || b.some((node, i) => node.nodeName !== l[i].nodeName)) return false
  let start = 0
  while (start < b.length && start < n.length && b[start].isEqualNode(n[start])) start++
  let end = 0
  while (end < b.length - start && end < n.length - start && b[b.length - 1 - end].isEqualNode(n[n.length - 1 - end])) end++
  const bMid = b.slice(start, b.length - end)
  const nMid = n.slice(start, n.length - end)
  const lMid = l.slice(start, b.length - end)
  if (bMid.length !== nMid.length) {
    const baseAnchor = b[start] ?? null
    const liveAnchor = l[start] ?? null
    changes.push({ baseParent: base, liveParent: live, base: bMid, live: lMid, next: nMid, baseAnchor, liveAnchor })
    return true
  }
  bMid.forEach((node, i) => {
    if (node.isEqualNode(nMid[i]) || (sameShell(node, nMid[i]) && diffChildren(node, nMid[i], lMid[i], changes))) return
    changes.push({
      baseParent: base,
      liveParent: live,
      base: [node],
      live: [lMid[i]],
      next: [nMid[i]],
      baseAnchor: node,
      liveAnchor: lMid[i],
    })
  })
  return true
}

const isPlaying = (el: Element) => [el, ...$$('video, audio', el)].some((m) => m instanceof HTMLMediaElement && !m.paused)

// 使っている最中の部分をすぐ差し替えないのは、入力途中の値や開いているパネル、再生している位置が消えるため
function inUse(node: Node) {
  if (!(node instanceof Element)) return false
  const active = document.activeElement
  return (!!active?.matches(EDITING) && node.contains(active)) || node.matches(OPENED) || !!node.querySelector(OPENED) || isPlaying(node)
}

function applyChange(change: LiveChange) {
  change.next.forEach((node) => change.liveParent.insertBefore(document.importNode(node, true), change.liveAnchor))
  change.live.forEach((node) => node.remove())
  change.next.forEach((node) => change.baseParent.insertBefore(node.cloneNode(true), change.baseAnchor))
  change.base.forEach((node) => node.remove())
}

async function syncLive(run: number, revision: string | null) {
  const page = await fetchPage(new URL(location.href), {}, true)
  if (run !== liveRun || navController) return
  const doc = new DOMParser().parseFromString(page.html, 'text/html')
  // 読み込み直しが要るときやログイン画面などへ移されたときに切り替えないのは、見ている画面がいきなり別の画面になるため
  if (!page.isHtml || page.redirected || needsFullLoad(doc)) {
    liveRevision = revision
    return
  }
  $$('noscript', doc.body).forEach((el) => el.remove())
  await loadStyles(doc)
  const live = document.querySelector('main')
  if (run !== liveRun || navController || document.querySelector('dialog[open]') || !live) return

  const next = doc.querySelector('main')
  const changes: LiveChange[] = []
  if (!liveMarker(doc) || !next || !liveBase || !sameShell(liveBase, next) || !diffChildren(liveBase, next, live, changes)) {
    if (inUse(live)) return
    const y = scrollY
    return render(doc, () => scrollTo(0, y))
  }
  const ready = changes.filter((change) => !change.live.some(inUse))
  ready.forEach(applyChange)
  if (ready.length > 0) {
    document.title = doc.title
    initContent()
  }
  // 見送った部分があるときに版を進めないのは、次の確認でもう一度取り直して反映するため
  if (ready.length === changes.length) liveRevision = liveMarker(doc)!.dataset.liveRev ?? null
}

async function checkLive() {
  const run = liveRun
  const url = liveMarker()?.dataset.live
  if (!url) return
  try {
    if (!document.hidden && !navController) {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const revision = res.status === 404 ? null : ((await res.json()) as { revision: string }).revision
      if (run === liveRun && revision !== liveRevision) await syncLive(run, revision)
    }
  } catch {}
  if (run === liveRun) scheduleLive()
}

function scheduleLive(delay = LIVE_INTERVAL) {
  clearTimeout(liveTimer)
  if (liveMarker()) liveTimer = window.setTimeout(() => void checkLive(), delay)
}

function watchLive() {
  liveRun++
  liveRevision = liveMarker()?.dataset.liveRev ?? null
  scheduleLive()
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleLive(0)
})

// --- 表示のたびに行う初期化（最初の表示と再読み込みなしの遷移の両方）
function initPage() {
  $$('[data-toast]').forEach((el) => dismissLater(el, 5000))
  applyTheme(getSetting('theme'))
  initContent()
  openHashTarget()
  watchLive()
  initAuthArt()
  initAiPanel()
}

function initContent() {
  completeOnView()
  restoreCollapsed()
  applyEditMode(getSetting('editMode'))
  applyCourseFilter()
  updateToc()
  initMarkdownEditors()
  initCodeEditors()
  applyPdfMode()
  initPdfViewers()
  initMascots()
  initWalkers()
}
initPage()
