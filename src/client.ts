/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 全ページ共通のクライアント処理。JS が無効な環境では renderer の noscript がアプリを使えなくする。

import checkSvg from 'heroicons/24/outline/check.svg?raw'
import sparklesSvg from 'heroicons/24/outline/sparkles.svg?raw'
import { bundlePath, isExcludedPath } from './features/bundle/bundle'
import type { AiTouched } from './features/ai/ai-tool-kit'
import { formatBytes } from './lib/bytes'
import { getSetting, setSetting, updateSetting, type Theme } from './lib/settings'
import { applyEditMode, carriesFiles, codeEditor, confirmDialog, confirmNear, dismissLater, initCodeEditors, toast } from './client/core'
import { initRestrictionEditors } from './client/restriction'
import './features/quiz/client'
import './client/datetime'
import { initMascots, initWalkers } from './client/mascot'
import { aiDocked, aiHooks, initAiPanel, setAiOpen } from './features/ai/client'
import { initAgentModelPickers } from './features/agent/client'
import { $$, fetchJson, reducedMotion } from './client/dom'

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
  if (!from || from === input || !document.startViewTransition || reducedMotion()) {
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

// --- 目次の開閉（端末ごと・アイテムの種類ごと。最初の描画前に当てるのは lib/settings.ts の BOOT_SCRIPT）
const outlineKind = () => document.querySelector<HTMLElement>('.reader[data-outline-kind]')?.dataset.outlineKind
function applyOutline() {
  const kind = outlineKind()
  const closed = !!kind && getSetting('outlineHidden').includes(kind)
  const label = closed ? '目次を表示' : '目次を隠す'
  document.documentElement.toggleAttribute('data-outline-closed', closed)
  $$('[data-outline-toggle]').forEach((el) => {
    el.setAttribute('aria-expanded', String(!closed))
    el.setAttribute('aria-label', label)
    el.setAttribute('title', label)
  })
}
document.addEventListener('click', (e) => {
  const kind = outlineKind()
  if (!kind || !(e.target as Element).closest('[data-outline-toggle]')) return
  const close = !document.documentElement.hasAttribute('data-outline-closed')
  updateSetting('outlineHidden', (kinds) => [...kinds.filter((k) => k !== kind), ...(close ? [kind] : [])])
  applyOutline()
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

const formKey = (form: HTMLFormElement) =>
  JSON.stringify([form.action, ...[...new FormData(form)].map(([k, v]) => [k, typeof v === 'string' ? v : v.name])])

/** 聞いているあいだに form が描き直されていたら、描き直した先の同じ送り先・同じ値のフォーム */
const currentForm = (form: HTMLFormElement) =>
  form.isConnected ? form : $$<HTMLFormElement>('form[data-confirm]').find((f) => formKey(f) === formKey(form))

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement
  const submitter = (e as SubmitEvent).submitter
  // ボタンにも data-confirm を書けるのは、保存と一緒に取り消せない操作をするボタン（問題の確定など）を、同じフォームに置くため
  const confirmer = submitter instanceof HTMLElement && submitter.dataset.confirm ? submitter : form
  const msg = confirmer.dataset.confirm
  if (msg && form.dataset.confirmed !== '1') {
    e.preventDefault()
    const ok = confirmer.dataset.confirmOk
    if (!(await (submitter ? confirmNear(submitter, [msg], { ok }) : confirmDialog(msg)))) return
    const target = currentForm(form)
    if (!target) return
    target.dataset.confirmed = '1'
    target.requestSubmit(confirmer !== form && submitter instanceof HTMLButtonElement && submitter.isConnected ? submitter : undefined)
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
    const res = await fetchJson(form.action, { method: 'POST' })
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
    const res = await fetchJson(url, {
      method: 'POST',
      body: new URLSearchParams({ on }),
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

// --- 「アイテムを追加」を押したセクションと、行の間のプラスなら入れる位置を、モーダルの欄に入れておく
// セクションごとにモーダルを置かないのは、セクションの数だけ同じフォームが HTML に並ぶため
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-add-item-section]')
  const modal = btn && document.getElementById(btn.getAttribute('popovertarget') ?? '')
  const select = modal?.querySelector<HTMLSelectElement>('select[name=section_id]')
  const before = modal?.querySelector<HTMLInputElement>('input[name=before]')
  if (btn && select) select.value = btn.dataset.addItemSection ?? ''
  if (btn && before) before.value = btn.dataset.addItemBefore ?? ''
})

// 位置を残さないのは、別のセクションに移すと、選んだ行の前という位置がそのセクションにないため
document.addEventListener('change', (e) => {
  const select = e.target as HTMLElement
  if (select.matches('select[name=section_id]')) {
    const before = select.closest('form')?.querySelector<HTMLInputElement>('input[name=before]')
    if (before) before.value = ''
  }
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
  if (!chosen || !fromBox || reducedMotion()) return

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
  panel.classList.remove('is-above', 'is-start')
  if (panel.getBoundingClientRect().left < POPOVER_MARGIN) panel.classList.add('is-start')
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
  if (!(d instanceof HTMLDetailsElement)) return
  if (d.matches('[data-hover-open]') && (e as PointerEvent).pointerType === 'mouse') return e.preventDefault()
  if (d.open) return
  e.preventDefault()
  d.open = true
  placePopoverPanel(d)
})

// --- data-hover-open のポップオーバーは、マウスが乗っている間だけ開く。タッチとキーボードではクリックで開閉する
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return
  const d = (e.target as Element).closest('details.popover[data-hover-open] > summary')?.parentElement
  if (!(d instanceof HTMLDetailsElement) || d.open) return
  d.open = true
  placePopoverPanel(d)
})
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return
  const d = (e.target as Element).closest<HTMLDetailsElement>('details.popover[data-hover-open]')
  if (d?.open && !d.contains(e.relatedTarget as Node | null)) d.open = false
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

// --- 編集モードでアイテムをドラッグして移す（components/course.tsx の ItemGrip）
type ItemDrop = { zone: HTMLElement; list: HTMLElement | null; before: HTMLElement | null; anchor: HTMLElement | null }

const ITEM_DRAG_THRESHOLD = 5
const ITEM_DRAG_EDGE = 72
const ITEM_DRAG_SPEED = 14
const ITEM_DRAG_IGNORE = 'button, summary, form, details.popover, .item-insert, .check, .row-actions > a'
const itemDragging = () => document.documentElement.hasAttribute('data-item-dragging')
const itemIdOf = (entry: Element) =>
  (entry.matches('[data-item]') ? entry : entry.querySelector(':scope > [data-item]'))?.getAttribute('data-item')
const isItemTile = (box: DOMRect, list: HTMLElement) => box.width < list.clientWidth * 0.6

function itemDropZone(entry: HTMLElement, x: number, y: number) {
  const zones = entry.matches('.item-subsection') ? '[data-item-drop]:not(.item-subsection)' : '[data-item-drop]'
  // 真下だけで探さないのは、カードの間の隙間を通るたびに移動先が消えてちらつくため
  for (const dy of [0, -8, 8]) {
    const over = document.elementFromPoint(x, y + dy)
    const head = over?.closest('.subsection-head')
    const box = head?.getBoundingClientRect()
    // 見出し全体をサブセクションの中として扱わないのは、サブセクションのすぐ前へ入れる場所がなくなるため
    const from = head && box && y < box.top + box.height / 2 ? head.closest('li')?.parentElement : over
    const zone = from?.closest<HTMLElement>(zones)
    if (zone) return zone
  }
  return null
}

function itemDropAt(entry: HTMLElement, x: number, y: number): ItemDrop | null {
  const zone = itemDropZone(entry, x, y)
  if (!zone) return null
  const list = zone.querySelector<HTMLElement>(':scope > .items')
  const closed = zone instanceof HTMLDetailsElement && !zone.open
  const rows = list && !closed ? $$<HTMLElement>(':scope > li', list).filter((row) => row !== entry && row.getClientRects().length > 0) : []
  const before =
    rows.find((row) => {
      const box = row.getBoundingClientRect()
      if (isItemTile(box, list!)) return y < box.top || (y <= box.bottom && x < box.left + box.width / 2)
      return y < box.top + box.height / 2
    }) ?? null
  return { zone, list, before, anchor: before ?? rows.at(-1) ?? null }
}

function drawItemDropLine(line: HTMLElement, drop: ItemDrop | null, moves: boolean) {
  line.hidden = !moves || !drop?.anchor
  if (line.hidden || !drop?.anchor || !drop.list) return
  const box = drop.anchor.getBoundingClientRect()
  const edge = (start: number, end: number) => (drop.before ? start : end) - 1
  const rect = isItemTile(box, drop.list)
    ? { left: edge(box.left, box.right) - 3, top: box.top, width: 2, height: box.height }
    : { left: box.left + 12, top: edge(box.top, box.bottom), width: box.width - 24, height: 2 }
  Object.assign(line.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
}

function itemDragGhost(row: HTMLElement) {
  const ghost = document.createElement('div')
  ghost.className = 'item-drag-ghost'
  const icon = row.querySelector('.item-icon')
  if (icon) ghost.append(icon.cloneNode(true))
  const label = row.querySelector('.item-title') ?? row.querySelector('.item-text')
  ghost.append(Object.assign(document.createElement('span'), { textContent: label?.textContent?.trim() ?? '' }))
  return ghost
}

function submitItemDrop(entry: HTMLElement, action: string, drop: ItemDrop) {
  const [parent, next] = [entry.parentElement, entry.nextSibling]
  // 応答を待ってから動かさないのは、Moodle モードでは保存に数秒かかり、その間ドロップが効いていないように見えるため
  drop.list?.insertBefore(entry, drop.before)
  void visit(new URL(action, location.href), {
    method: 'POST',
    body: new URLSearchParams({ section_id: drop.zone.dataset.itemDrop ?? '', before: (drop.before && itemIdOf(drop.before)) ?? '' }),
    onFail: () => parent?.insertBefore(entry, next),
  })
}

// HTML のドラッグ＆ドロップ（draggable）を使わないのは、タッチ端末で動かせないため
document.addEventListener('pointerdown', (e) => {
  const root = document.documentElement
  const target = e.target as Element
  const row = target.closest<HTMLElement>('.item-row')
  const grip = row?.querySelector<HTMLElement>(':scope > .row-actions > [data-item-grip]')
  const entry = row?.closest('li')
  const main = row?.closest('main')
  if (!row || !grip || !entry || !main || !root.hasAttribute('data-edit-mode')) return
  if (e.button !== 0 || e.ctrlKey || e.metaKey || target.closest(ITEM_DRAG_IGNORE)) return
  // 行全体で受けないのは、タッチでは行をなぞるスクロールとぶつかるため
  if (e.pointerType !== 'mouse' && !grip.contains(target)) return

  const { pointerId, clientX: startX, clientY: startY } = e
  const action = grip.dataset.itemGrip ?? ''
  const home = entry.parentElement?.closest<HTMLElement>('[data-item-drop]')
  const ghost = itemDragGhost(row)
  const line = Object.assign(document.createElement('div'), { className: 'item-drop-line', hidden: true })
  let [x, y] = [startX, startY]
  let started = false
  let frame = 0
  let drop: ItemDrop | null = null
  let marked: HTMLElement | null = null

  const moves = () => !!drop && !(drop.zone === home && drop.before === entry.nextElementSibling)
  const mark = (zone: HTMLElement | null) => {
    if (zone === marked) return
    marked?.classList.remove('is-item-drop')
    zone?.classList.add('is-item-drop')
    marked = zone
  }
  const swallowClick = (click: MouseEvent) => {
    click.preventDefault()
    click.stopPropagation()
  }
  const stop = (commit: boolean, held = false) => {
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointercancel', onCancel)
    document.removeEventListener('keydown', onKey)
    if (!started) return
    root.removeAttribute('data-item-dragging')
    entry.classList.remove('is-item-dragging')
    mark(null)
    ghost.remove()
    line.remove()
    // すぐに外さないのは、ブラウザによってクリックが pointerup の次のタスクで届き、アイテムが開いてしまうため
    document.addEventListener('click', swallowClick, { capture: true, once: true })
    const allowClick = () => setTimeout(() => document.removeEventListener('click', swallowClick, true), 100)
    // Esc のあとすぐに許さないのは、まだ押したままで、同じ行の上で離すとアイテムが開いてしまうため
    if (held) document.addEventListener('pointerup', allowClick, { once: true })
    else allowClick()
    if (commit && drop && moves()) submitItemDrop(entry, action, drop)
  }
  const tick = () => {
    if (!entry.isConnected) return stop(false)
    const speed = y < ITEM_DRAG_EDGE ? -1 : y > innerHeight - ITEM_DRAG_EDGE ? 1 : 0
    if (speed) scrollBy(0, speed * ITEM_DRAG_SPEED)
    // タッチでポインターの右下に出さないのは、指に隠れて何を動かしているか見えなくなるため
    const ghostY = e.pointerType === 'mouse' ? y + 12 : Math.max(8, y - ghost.offsetHeight - 24)
    ghost.style.translate = `${Math.max(8, Math.min(x + 12, innerWidth - ghost.offsetWidth - 8))}px ${ghostY}px`
    drop = itemDropAt(entry, x, y)
    mark(drop && drop.zone !== home ? drop.zone : null)
    drawItemDropLine(line, drop, moves())
    frame = requestAnimationFrame(tick)
  }
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== pointerId) return
    ;[x, y] = [move.clientX, move.clientY]
    if (started || Math.hypot(x - startX, y - startY) < ITEM_DRAG_THRESHOLD) return
    started = true
    getSelection()?.removeAllRanges()
    root.toggleAttribute('data-item-dragging', true)
    entry.classList.add('is-item-dragging')
    main.append(ghost, line)
    tick()
  }
  const onUp = (up: PointerEvent) => {
    if (up.pointerId === pointerId) stop(true)
  }
  const onCancel = (cancel: PointerEvent) => {
    if (cancel.pointerId === pointerId) stop(false)
  }
  const onKey = (key: KeyboardEvent) => {
    if (key.key === 'Escape') stop(false, true)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onCancel)
  document.addEventListener('keydown', onKey)
})

// 止めないと、リンクをつかんだときにブラウザのドラッグが始まり、pointermove が届かなくなる
document.addEventListener('dragstart', (e) => {
  const row = e.target instanceof Element ? e.target.closest('.item-row') : null
  if (row?.querySelector(':scope > .row-actions > [data-item-grip]') && document.documentElement.hasAttribute('data-edit-mode'))
    e.preventDefault()
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
    void fetchJson(url, {
      method: 'POST',
      body: new URLSearchParams({ open: ids(true).join(','), closed: ids(false).join(',') }),
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
  if (!animate || reducedMotion()) {
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
  const behavior = reducedMotion() ? 'auto' : 'smooth'
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
  !!document.startViewTransition && !reducedMotion() && tileSlides.get(from)?.playState !== 'running'

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

// --- 右下のボタンで前回・今回のセクションを選ぶ
// CSS のクラスで光らせないのは、今日の回のカードに付けた animation を上書きして止めてしまうため
function flashSection(el: HTMLElement) {
  if (reducedMotion()) return
  const color = getComputedStyle(el).getPropertyValue('--c1').trim() || getComputedStyle(el).getPropertyValue('--accent').trim()
  el.animate(
    [
      { outline: `3px solid ${color}`, outlineOffset: '4px' },
      { outline: '3px solid transparent', outlineOffset: '4px' },
    ],
    {
      duration: 1600,
      delay: 300,
      easing: 'ease-in',
      fill: 'backwards',
    },
  )
}

document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-lesson-jump]')
  if (!button) return
  const id = button.dataset.lessonJump!
  const behavior = reducedMotion() ? 'auto' : 'smooth'
  const tile = document.querySelector<HTMLElement>(`#tile-${id} .sec-tile`)
  if (tile) {
    tile.scrollIntoView({ block: 'start', behavior })
    if (tile.matches('a[data-tile]') && tile.getAttribute('aria-expanded') !== 'true') tile.click()
    return flashSection(tile)
  }
  const section = document.getElementById(`section-${id}`)
  if (!(section instanceof HTMLDetailsElement)) return
  section.open = true
  section.scrollIntoView({ block: 'start', behavior })
  flashSection(section)
})

// --- ファイル選択時にタイトルが空なら自動入力
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file' || !input.files?.[0]) return
  const title = input.form?.querySelector<HTMLInputElement>('input[name=title]')
  if (title && !title.value) title.value = input.files[0].name.replace(/\.[^.]+$/, '')
})

// --- 上限（data-max-size）を超えたファイルは送信前に選択を取り消す。選んだ画像はプレビューに出す（取り消したら保存済みの画像に戻す）
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.type !== 'file' || !input.dataset.maxSize) return
  let file = input.files?.[0]
  if (file && file.size > Number(input.dataset.maxSize)) {
    input.value = ''
    file = undefined
    toast(input.dataset.tooLarge ?? '', 'error')
  }
  if (!input.matches('[data-image-input]')) return
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

// --- ファイル自動配布のアップロード（features/bundle/components/bundle.tsx の BundleFilesCard）
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

// --- VS Code で開く（features/bundle/components/bundle.tsx の BundleOpen）
// リンクを画面に描いておかないのは、中の鍵が数分で切れ、開いたままの画面から押すと使えなくなっているため
document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement
  if (!form.matches('[data-vscode-launch]')) return
  e.preventDefault()
  try {
    const res = await fetchJson(form.action, { method: 'POST' })
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
  toc.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' })
}
addEventListener('scroll', updateToc, { passive: true })
addEventListener('hashchange', updateToc)

// --- Markdown エディター（components/markdown.tsx の MarkdownEditor）
// ここに直接 import しないのは、CodeMirror が大きく、エディターのない画面でも毎回読み込むことになるため
// 閉じたモーダルの中は開くまで組み込まないのは、コースページの「アイテムを追加」のように開かずに終わることの多いモーダルのために、毎回 CodeMirror を読み込むことになるため
function initMarkdownEditors(root: ParentNode = document) {
  const fields = $$<HTMLElement>('[data-md-editor]:not([data-md-ready])', root).filter((el) => !el.closest('[popover]:not(:popover-open)'))
  if (!fields.length) return
  import('./markdown-editor')
    .then(({ mountMarkdownEditor }) => fields.forEach(mountMarkdownEditor))
    .catch(() => toast('エディターを読み込めませんでした。', 'error'))
}
// beforetoggle で組み込まないのは、その時点ではまだ :popover-open にならず、閉じたモーダルの中として飛ばされるため
document.addEventListener(
  'toggle',
  (e) => {
    const target = e.target
    if (target instanceof HTMLElement && target.matches('[popover]') && (e as ToggleEvent).newState === 'open') initMarkdownEditors(target)
  },
  true,
)

// --- ログイン画面の 3D アニメーション（components/layout.tsx の AuthShell）
// ここに直接 import しないのは、three.js が大きく、ログイン後の画面でも毎回読み込むことになるため
let authArt: Promise<typeof import('./features/auth/art')> | null = null
function initAuthArt() {
  const host = document.querySelector<HTMLElement>('[data-auth-art]')
  // 隠れているとき（スマホ幅）に読み込まないのは、見えない絵のために three.js を取りに行くことになるため
  if (!authArt && !host?.offsetWidth) return
  authArt ??= import('./features/auth/art')
  // 失敗してもトーストを出さないのは、飾りが出ないだけで操作には困らないため
  authArt.then(({ showAuthArt }) => showAuthArt(host)).catch(() => {})
}

// --- 小テストのゲームの見た目の 3D の世界（features/quiz/components/quiz.tsx の GameTake / GameResult）
// ここに直接 import しないのは、three.js が大きく、小テストのない画面でも毎回読み込むことになるため
let quizWorld: Promise<typeof import('./features/quiz/world')> | null = null
function initQuizWorlds() {
  void quizWorld?.then(({ releaseDetachedQuizWorlds }) => releaseDetachedQuizWorlds())
  const hosts = $$<HTMLElement>('[data-qg-world]:not([data-ready])')
  // 動きを減らす設定で読み込まないのは、3D を描かずに 2D の表示を残すので、three.js を取りに行くだけ無駄になるため
  if (!hosts.length || reducedMotion()) return
  quizWorld ??= import('./features/quiz/world')
  // 失敗してもトーストを出さないのは、2D の道のりが残っていて、解答には困らないため
  quizWorld.then(({ mountQuizWorld }) => hosts.forEach(mountQuizWorld)).catch(() => hosts.forEach((host) => (host.dataset.flat = '')))
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

// --- 発表ファイルのビューアー（features/presentation/components/presentation.tsx の PresentationStage）
// PDF の表示方法（applyPdfMode）の対象にしないのは、「ブラウザ」での表示では、まだ公開していないページまで見えてしまうため
function initPresentations() {
  void pdfViewer?.then(({ releaseDetachedPdfViewers }) => releaseDetachedPdfViewers())
  const roots = $$<HTMLElement>('[data-presentation]:not([data-presentation-ready])')
  if (!roots.length) return
  pdfViewer ??= import('./pdf-viewer')
  pdfViewer
    .then(({ mountPresentation }) => roots.forEach(mountPresentation))
    .catch(() => {
      pdfViewer = null
      toast('PDF ビューアーを読み込めませんでした。', 'error')
    })
}

// --- 共同編集のエディター（features/collab/components/collab.tsx の CollabWorkspace）
// ここに直接 import しないのは、Yjs と種類ごとのエディター（TipTap や Office の形式の読み書き）が大きく、共同編集のない画面でも毎回読み込むことになるため
let collabApp: Promise<typeof import('./features/collab/editor/app')> | null = null
function initCollabs() {
  void collabApp?.then(({ releaseDetachedCollabs }) => releaseDetachedCollabs())
  const roots = $$<HTMLElement>('[data-collab]:not([data-collab-ready])')
  if (!roots.length) return
  collabApp ??= import('./features/collab/editor/app')
  collabApp
    .then(({ mountCollab }) => roots.forEach((root) => void mountCollab(root, toast, confirmNear)))
    .catch(() => {
      collabApp = null
      toast('エディターを読み込めませんでした。', 'error')
    })
}

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
  if (e.defaultPrevented || !input || reducedMotion()) return
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

// --- AI が変えたところを、開いている画面にすぐ反映して強調する（features/ai/ai-tool-kit.ts の AiTouched）
// 反映を CourseLiveSync の確認の間隔に任せないのは、頼んだ結果がどこに出たのかを、変えた直後に見せるため
/** touch は文字などを塗り、frame は大きな入れ物（差し替えたエディターのカードなど）を塗らずに縁だけ光らせる */
type AiMark = 'enter' | 'move' | 'touch' | 'frame' | 'spot'

const AI_MARK_MS = 2600
const AI_MARK_LABELS: Record<AiMark, string> = {
  enter: 'AI が追加',
  move: 'AI が移動',
  touch: 'AI が変更',
  frame: 'AI が変更',
  spot: 'AI が変更',
}
const AI_KEYED = '[data-item], details.section-card[id]'
// 大きな入れ物を塗らないのは、カード一面が色づくと、中のどこが変わったのかがかえって見えなくなるため
const AI_WIDE_HEIGHT = 160
// 編集のボタンやメニューの中に印を付けないのは、変わったのは閉じたフォームの初期値で、見えている教材ではないため
const AI_QUIET = '.row-actions, .row-menu, details.popover, [popover], button, select, template'
const aiMarkTimers = new WeakMap<Element, Map<AiMark, number>>()
let aiArrival: AiTouched | null = null

function flashAi(el: Element, mark: AiMark) {
  const timers = aiMarkTimers.get(el) ?? new Map<AiMark, number>()
  aiMarkTimers.set(el, timers)
  clearTimeout(timers.get(mark))
  el.classList.remove(`ai-${mark}`)
  // 付け直す前に描かせるのは、続けて変わったときに、光り始めからやり直させるため
  void (el as HTMLElement).offsetWidth
  el.classList.add(`ai-${mark}`)
  timers.set(
    mark,
    window.setTimeout(() => el.classList.remove(`ai-${mark}`), AI_MARK_MS),
  )
}

const keyOfLive = (el: Element) => (el instanceof HTMLElement && el.dataset.item ? `item:${el.dataset.item}` : el.id)

const keyedRects = () =>
  new Map($$(AI_KEYED, document.querySelector('main') ?? document).map((el) => [keyOfLive(el), el.getBoundingClientRect()]))

/** 差し替える前の位置 from から、今の位置へ滑らせる。動いていなければ false */
function slideFrom(el: Element, from: DOMRect) {
  const to = el.getBoundingClientRect()
  const dx = from.left - to.left
  const dy = from.top - to.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return false
  if (!reducedMotion())
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 560, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
  return true
}

function aiTarget({ item, section }: AiTouched) {
  const heading = item ? document.querySelector(`[data-ai-watch="item:${item}"] h1`) : null
  const row = item ? document.querySelector(`main [data-item="${item}"]`) : null
  // 目次の行より見出しを先にするのは、開いているアイテム自体が変わったときに、目次の小さな行ではなく本文の側を示すため
  return heading ?? row ?? (section ? document.getElementById(`section-${section}`) : null)
}

// 隠れたままにしないのは、AI が非表示で追加したものや、閉じたセクションの中を変えたとき、どこが変わったのか見えないため
function revealAiTarget(target: Element) {
  const section = target.parentElement?.closest<HTMLDetailsElement>('details.section-card')
  if (section && !section.open) section.open = true
  if (target.closest('.edit-only') && !document.documentElement.hasAttribute('data-edit-mode') && $$('[data-edit-mode-toggle]').length) {
    applyEditMode(true)
    setSetting('editMode', true)
    toast('AI が変えた非表示の教材を見せるため、編集モードにしました。', 'info')
  }
  const r = target.getBoundingClientRect()
  if (r.top < 0 || r.bottom > innerHeight) target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
}

function tagAiTarget(target: Element, mark: AiMark) {
  const r = target.getBoundingClientRect()
  if (!r.width) return
  const tag = document.createElement('span')
  tag.className = 'ai-tag'
  tag.setAttribute('aria-hidden', 'true')
  tag.innerHTML = sparklesSvg.replace('<svg ', '<svg class="icon" width="14" height="14" ')
  tag.append(AI_MARK_LABELS[mark])
  tag.style.left = `${r.right + scrollX - 12}px`
  tag.style.top = `${r.top + scrollY}px`
  document.body.append(tag)
  tag.addEventListener('animationend', () => tag.remove(), { once: true })
}

function spotAi(target: Element, mark: AiMark) {
  revealAiTarget(target)
  flashAi(target, 'spot')
  // スクロールを待ってから札を出すのは、動いている途中の位置に置くと、止まったあとの対象からずれるため
  window.setTimeout(() => tagAiTarget(target, mark), reducedMotion() ? 0 : 400)
}

/** 差分で差し込んだ inserted に、追加・移動・変更の印を付け、AI が変えたもの（touched）を強調する。before は差し替える前の位置 */
function markAiChanges(touched: AiTouched, inserted: Node[], before: Map<string, DOMRect>) {
  const marks = new Map<Element, AiMark>()
  const mark = (el: Element, kind: AiMark) => {
    marks.set(el, kind)
    flashAi(el, kind)
  }
  // 位置を測れなかったとき（丸ごと描き直したとき）に新しいものと決めないのは、すべての行が追加に見えてしまうため
  const isNew = (el: Element) => before.size > 0 && !before.has(keyOfLive(el))
  for (const node of inserted) {
    if (node instanceof Text && !node.data.trim()) continue
    const el = node instanceof Element ? node : node.parentElement
    if (!el || el.matches(LIVE_REGIONS.join()) || el.closest(AI_QUIET)) continue
    const keyed = node === el && el.matches(AI_KEYED)
    const from = keyed ? before.get(keyOfLive(el)) : undefined
    // 入れ物ごと差し替わったときに、中の新しい行だけを追加として見せるのは、入れ物全体を塗ると、どれが増えたのか分からないため
    const fresh = $$(AI_KEYED, el).filter(isNew)
    if (keyed && isNew(el)) mark(el, 'enter')
    else if (from && slideFrom(el, from)) mark(el, 'move')
    else if (fresh.length === 0) mark(el, el.getBoundingClientRect().height > AI_WIDE_HEIGHT ? 'frame' : 'touch')
    fresh.forEach((child) => mark(child, 'enter'))
  }
  const target = aiTarget(touched)
  if (!target) return
  const moved = [...marks].some(([el, kind]) => kind === 'move' && target.contains(el))
  spotAi(target, marks.get(target) ?? (moved ? 'move' : 'touch'))
}

const codeFields = () => $$<HTMLTextAreaElement>('main [data-code-input] textarea[name]')

function flashCodeFields(before: Map<string, string>) {
  const changed = codeFields().filter((f) => before.has(f.name) && before.get(f.name) !== f.value)
  if (changed.length === 0) return
  void codeEditor?.then(({ flashCodeChanges }) => changed.forEach((f) => flashCodeChanges(f, before.get(f.name)!)))
}

const formValues = (form: HTMLFormElement) => JSON.stringify([...new FormData(form)].filter(([, v]) => typeof v === 'string'))

function showAiChange(touched: AiTouched) {
  const keys = [`course:${touched.course}`, ...(touched.item ? [`item:${touched.item}`] : [])]
  const watched = $$<HTMLElement>('[data-ai-watch]').filter((el) => keys.includes(el.dataset.aiWatch ?? ''))
  if (watched.length === 0) return
  const form = watched.find((el) => el instanceof HTMLFormElement)
  const drawn = form?.id ? liveBase[0]?.querySelector<HTMLFormElement>(`form#${CSS.escape(form.id)}`) : null
  // 書き換えている途中の編集画面を差し替えないのは、まだ保存していない入力を消してしまうため
  if (form && (!drawn || formValues(form) !== formValues(drawn)))
    return toast(
      'AI がこのアイテムを変更しました。このまま保存すると AI の変更を上書きするので、読み込み直してから編集してください。',
      'info',
    )
  const codeBefore = new Map(codeFields().map((f) => [f.name, f.value]))
  void syncLive(liveRun, liveRevision, touched).then(() => flashCodeFields(codeBefore))
  const frame = watched.find((el): el is HTMLIFrameElement => el.matches('[data-code-vscode-frame]'))
  if (frame) void codeEditor?.then(({ reloadCodeFrame }) => reloadCodeFrame(frame))
}

document.addEventListener('click', (e) => {
  const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-ai-spot]')
  if (!link?.dataset.aiSpot || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const touched = JSON.parse(link.dataset.aiSpot) as AiTouched
  // 重ねて出すパネルを閉じるのは、開いた先の強調がパネルの下に隠れるため
  if (!aiDocked()) setAiOpen(false)
  const here = new URL(link.href).pathname === location.pathname ? aiTarget(touched) : null
  if (!here) {
    aiArrival = touched
    return
  }
  e.preventDefault()
  spotAi(here, 'spot')
})

function spotArrival() {
  const touched = aiArrival
  aiArrival = null
  if (!touched) return
  // 遷移のアニメーションと # へのスクロールが終わってから強調する
  window.setTimeout(() => {
    const target = aiTarget(touched)
    if (target) spotAi(target, 'spot')
  }, 350)
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

// <base target> を見るのは、ブラウザエディターの中の VS Code の画面（CodeVscodePage）が、リンクとフォームを親の画面で開かせるため
const baseTarget = () => document.querySelector('base[target]')?.getAttribute('target') || '_self'

function linkUrl(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
  if (!a || (a.target || baseTarget()) !== '_self' || a.hasAttribute('download') || a.hasAttribute('data-reload')) return null
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
  liveBase = cloneRegions(doc)
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
  if (!document.startViewTransition || reducedMotion()) {
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
  const target = (submitter?.getAttribute('formtarget') ?? form.getAttribute('target')) || baseTarget()
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

// ヘッダーの帯も比べるのは、コードや PDF のアイテムでは、タイトルが <main> ではなく帯にあるため
const LIVE_REGIONS = ['main', '.topbar-main'] as const
const cloneRegions = (doc: Document) => LIVE_REGIONS.map((sel) => (doc.querySelector(sel)?.cloneNode(true) as Element | undefined) ?? null)
const liveMarker = (root: ParentNode = document) => root.querySelector<HTMLElement>('[data-live]')

// 画面の要素と新しい内容を直接比べないのは、開閉や完了の切り替えなど画面で変えた状態まで、サーバーでの変更として扱ってしまうため
let liveBase = cloneRegions(document)
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

// エディターを組み込んだ入力欄は、変わっていたら中を比べず丸ごと置き換え、組み込み直させる。入力欄の文字だけを差し替えると、エディターが古い中身のまま残るため
const MOUNTED_EDITORS = '[data-code-input][data-code-ready], [data-code-starter][data-code-ready], [data-md-ready]'

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
    const mounted = lMid[i] instanceof Element && lMid[i].matches(MOUNTED_EDITORS)
    if (node.isEqualNode(nMid[i]) || (!mounted && sameShell(node, nMid[i]) && diffChildren(node, nMid[i], lMid[i], changes))) return
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

/** 差分を当て、画面に差し込んだ要素を返す */
function applyChange(change: LiveChange) {
  const inserted = change.next.map((node) => change.liveParent.insertBefore(document.importNode(node, true), change.liveAnchor))
  change.live.forEach((node) => node.remove())
  change.next.forEach((node) => change.baseParent.insertBefore(node.cloneNode(true), change.baseAnchor))
  change.base.forEach((node) => node.remove())
  return inserted
}

/** 同じ URL を取り直して差分を当てる。touched を渡すと（AI が変えたとき）、CourseLiveSync のない画面でも差分を当て、変わったところを強調する */
async function syncLive(run: number, revision: string | null, touched?: AiTouched) {
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
  // ドラッグ中に差分を当てないのは、つかんでいる行が置き換わって操作が切れるため
  if (run !== liveRun || navController || itemDragging() || document.querySelector('dialog[open]') || !live) return

  const changes: LiveChange[] = []
  const diffable =
    (!!touched || !!liveMarker(doc)) &&
    LIVE_REGIONS.every((sel, i) => {
      const base = liveBase[i]
      const next = doc.querySelector(sel)
      const current = document.querySelector(sel)
      if (!base || !next || !current) return !base && !next && !current
      return sameShell(base, next) && diffChildren(base, next, current, changes)
    })
  if (!diffable) {
    if (inUse(live)) return
    const y = scrollY
    await render(doc, () => scrollTo(0, y))
    if (touched) markAiChanges(touched, [], new Map())
    return
  }
  const ready = changes.filter((change) => !change.live.some(inUse))
  const before = touched ? keyedRects() : new Map<string, DOMRect>()
  const inserted = ready.flatMap(applyChange)
  if (ready.length > 0) {
    document.title = doc.title
    initContent()
  }
  if (touched) markAiChanges(touched, inserted, before)
  // 見送った部分があるときに版を進めないのは、次の確認でもう一度取り直して反映するため
  if (ready.length === changes.length) liveRevision = liveMarker(doc)?.dataset.liveRev ?? null
}

async function checkLive() {
  const run = liveRun
  const url = liveMarker()?.dataset.live
  if (!url) return
  try {
    if (!document.hidden && !navController) {
      const res = await fetchJson(url, { cache: 'no-store' })
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

aiHooks.showChange = showAiChange
aiHooks.isUnsaved = (form) => {
  const drawn = form.id ? liveBase[0]?.querySelector<HTMLFormElement>(`form#${CSS.escape(form.id)}`) : null
  return !!drawn && formValues(form) !== formValues(drawn)
}

// --- 表示のたびに行う初期化（最初の表示と再読み込みなしの遷移の両方）
function initPage() {
  $$('[data-toast]').forEach((el) => dismissLater(el, 5000))
  applyTheme(getSetting('theme'))
  initContent()
  openHashTarget()
  watchLive()
  initAuthArt()
  initAiPanel()
  spotArrival()
}

function initContent() {
  completeOnView()
  restoreCollapsed()
  applyEditMode(getSetting('editMode'))
  applyOutline()
  applyCourseFilter()
  updateToc()
  initMarkdownEditors()
  initCodeEditors()
  applyPdfMode()
  initPdfViewers()
  initPresentations()
  initQuizWorlds()
  initCollabs()
  initMascots()
  initWalkers()
  initRestrictionEditors()
  initAgentModelPickers()
}
initPage()
