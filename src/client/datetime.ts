/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import chevronLeftSvg from 'heroicons/24/outline/chevron-left.svg?raw'
import chevronRightSvg from 'heroicons/24/outline/chevron-right.svg?raw'
import { formatDateTimeInput } from '../lib/course-period'
import { $$ } from './dom'

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
export let dt: DtState | null = null
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
