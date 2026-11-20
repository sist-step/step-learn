/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 全ページ共通のクライアント処理。JS が無効な環境では renderer の noscript がアプリを使えなくする。

import checkSvg from 'heroicons/24/outline/check.svg?raw'
import chevronLeftSvg from 'heroicons/24/outline/chevron-left.svg?raw'
import chevronRightSvg from 'heroicons/24/outline/chevron-right.svg?raw'
import sparklesSvg from 'heroicons/24/outline/sparkles.svg?raw'
import { bundlePath, isExcludedPath } from './lib/bundle'
import { agentModelFacts, isAgentClaudeModel, type AgentModel } from './lib/agent'
import type { AiAgentEvent, AiUsageMeter } from './lib/ai-agent'
import { AI_BUDDY_LABELS, AI_BUDDY_LOOKS, type AiBuddyState } from './lib/ai-buddy'
import type { AiTouched } from './lib/ai-tool-kit'
import { formatBytes } from './lib/bytes'
import { formatClock } from './lib/clock'
import { formatDateTimeInput } from './lib/course-period'
import { isFormName, validate, type FieldErrors, type FormInput } from './lib/forms'
import { renderMarkdown } from './lib/markdown'
import { MAX_QUIZ_INDENT, MAX_QUIZ_STEPS, QUIZ_KEY_SLOT, lineAt, parseSteps } from './lib/quiz'
import { showsEach, type RestrictionOp } from './lib/restriction'
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

// --- アクセス制限の条件の編集（components/restriction.tsx の RestrictionEditor）
// 入力の検証より前に置くのは、検証が読む availability を、送信と入力のたびに先に組み立て直すため
const RS_FIELDS: Record<string, string[]> = {
  date: ['d', 't'],
  completion: ['cm', 'e'],
  grade: ['id', 'min', 'max'],
  profile: ['field', 'op', 'v'],
}
let rsCount = 0

const rsControl = <T extends HTMLElement>(row: HTMLElement, field: string) =>
  row.querySelector<T>(`[name="${CSS.escape(`${row.dataset.rsKey}.${field}`)}"]`)

const rsHidden = (eye: Element | null) => eye?.getAttribute('aria-pressed') === 'true'

function rsReadSet(set: HTMLElement, k: string, root: boolean): Record<string, unknown> {
  const rows = $$<HTMLElement>(':scope > .rs-list > [data-rs-node]', set)
  const node: Record<string, unknown> = {
    k,
    op: set.querySelector<HTMLSelectElement>(':scope > .rs-set-head > [data-rs-op]')!.value,
    c: rows.map(rsReadRow),
  }
  if (!root) return node
  return {
    ...node,
    show: !rsHidden(set.querySelector(':scope > .rs-set-head > [data-rs-eye]')),
    showc: rows.map((row) => !rsHidden(row.querySelector(':scope > [data-rs-eye]'))),
  }
}

function rsReadRow(row: HTMLElement): Record<string, unknown> {
  const k = row.dataset.rsKey!
  const kind = row.dataset.rsNode!
  if (kind === 'set') return rsReadSet(row.querySelector<HTMLElement>(':scope > .rs-set')!, k, false)
  if (kind === 'other') return { k, type: 'other', raw: JSON.parse(row.querySelector<HTMLElement>('[data-rs-raw]')!.dataset.rsRaw!) }
  const fields = RS_FIELDS[kind] ?? []
  return { k, type: kind, ...Object.fromEntries(fields.map((f) => [f, rsControl<HTMLInputElement>(row, f)?.value ?? ''])) }
}

function rsSync(editor: HTMLElement) {
  const root = editor.querySelector<HTMLElement>('[data-rs-set="root"]')
  const value = editor.querySelector<HTMLInputElement>('[data-rs-value]')
  if (root && value) value.value = JSON.stringify(rsReadSet(root, 'root', true))
}

// 合格・不合格を選べないアイテムでは選択肢を止めるのは、保存したあとでサーバーに断られるより先に気付けるようにするため
function rsApplyPassFail(row: HTMLElement) {
  const item = row.querySelector<HTMLSelectElement>('[data-rs-item]')
  const expect = row.querySelector<HTMLSelectElement>('[data-rs-pass-fail]')
  if (!item || !expect) return
  const allowed = (JSON.parse(expect.dataset.rsPassFail ?? '[]') as number[]).includes(Number(item.value))
  for (const option of expect.options) if (option.value === '2' || option.value === '3') option.disabled = !allowed
  if (expect.selectedOptions[0]?.disabled) expect.value = '1'
}

function rsApplyProfileOp(row: HTMLElement) {
  const op = row.querySelector<HTMLSelectElement>('[data-rs-profile-op]')
  const value = row.querySelector<HTMLInputElement>('[data-rs-profile-value]')
  if (op && value) value.disabled = op.value === 'isempty' || op.value === 'isnotempty'
}

const initRestrictionEditors = () => $$<HTMLElement>('[data-rs-node="completion"]').forEach(rsApplyPassFail)

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-rs]')
  if (!editor) return
  const add = target.closest<HTMLButtonElement>('[data-rs-add]')
  const remove = target.closest<HTMLElement>('[data-rs-remove]')
  const eye = target.closest<HTMLElement>('[data-rs-eye]')
  if (add) {
    const template = editor.querySelector<HTMLTemplateElement>(`template[data-rs-template="${add.dataset.rsAdd}"]`)
    const list = add.closest('.rs-set')?.querySelector<HTMLElement>(':scope > .rs-list')
    if (!template || !list) return
    const key = `c${Date.now().toString(36)}${rsCount++}`
    list.insertAdjacentHTML('beforeend', template.innerHTML.replaceAll('__K__', key))
    const row = list.lastElementChild as HTMLElement
    rsApplyPassFail(row)
    row.querySelector<HTMLElement>('.rs-fields :is(select, input:not([tabindex="-1"]), button), .rs-set-head select')?.focus()
  } else if (remove) {
    const row = remove.closest<HTMLElement>('[data-rs-node]')
    const parent = row?.parentElement?.closest<HTMLElement>('.rs-set')
    row?.remove()
    parent?.querySelector<HTMLElement>(':scope > .rs-add [data-rs-add]:not(:disabled)')?.focus()
  } else if (eye) {
    const hidden = !rsHidden(eye)
    eye.setAttribute('aria-pressed', String(hidden))
    eye.title = hidden ? '満たさない学生には表示しない（押すと表示する）' : '満たさない学生にも条件を表示する（押すと表示しない）'
  } else return
  rsSync(editor)
})

document.addEventListener(
  'change',
  (e) => {
    const target = e.target as HTMLElement
    const editor = target.closest<HTMLElement>('[data-rs]')
    if (!editor) return
    const row = target.closest<HTMLElement>('[data-rs-node]')
    const set = target.matches('[data-rs-op]') ? target.closest<HTMLElement>('.rs-set') : null
    if (set?.dataset.rsSet === 'root') set.dataset.rsEach = String(showsEach((target as HTMLSelectElement).value as RestrictionOp))
    if (row && target.matches('[data-rs-item]')) rsApplyPassFail(row)
    if (row && target.matches('[data-rs-profile-op]')) rsApplyProfileOp(row)
    rsSync(editor)
  },
  true,
)

document.addEventListener(
  'input',
  (e) => {
    const editor = (e.target as Element).closest<HTMLElement>('[data-rs]')
    if (editor) rsSync(editor)
  },
  true,
)

document.addEventListener('submit', (e) => $$<HTMLElement>('[data-rs]', e.target as HTMLFormElement).forEach(rsSync), true)

// --- 小テストの問題の編集（components/quiz.tsx の QuizEditor）
// 入力の検証より前に置くのは、検証が読む questions を、送信と入力のたびに先に組み立て直すため
let qzCount = 0

const qzControl = (row: HTMLElement, field: string) =>
  row.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(`${row.dataset.qzKey}.${field}`)}"]`)

function qzReadQuestion(row: HTMLElement) {
  const kind = row.dataset.qzQuestion
  const value = (field: string) => qzControl(row, field)?.value ?? ''
  const choices = $$<HTMLElement>('[data-qz-choice]', row)
  return {
    k: row.dataset.qzKey,
    kind,
    prompt: value('prompt'),
    code: value('code'),
    choices: choices.map((c) => c.querySelector<HTMLInputElement>('[data-qz-choice-text]')?.value ?? ''),
    answer:
      kind === 'choice'
        ? String(choices.findIndex((c) => c.querySelector<HTMLInputElement>('input[type="radio"]')?.checked))
        : value('answer'),
    lines: value('lines'),
    explanation: value('explanation'),
  }
}

function qzSync(editor: HTMLElement) {
  const value = editor.querySelector<HTMLInputElement>('[data-qz-value]')
  if (value) value.value = JSON.stringify($$<HTMLElement>('[data-qz-question]', editor).map(qzReadQuestion))
}

const qzLineNote = (line: string | null) => (line === null ? '' : line.trim() || '（空の行）')

/** バグ探しと実行の順番で、入力した行の番号の横に、その行の中身を出す */
function qzShowLines(row: HTMLElement) {
  const code = qzControl(row, 'code')?.value ?? ''
  const answer = qzControl(row, 'answer')?.value ?? ''
  const note = row.querySelector<HTMLElement>('[data-qz-bug-line]')
  if (note) note.textContent = qzLineNote(lineAt(code, answer))
  row.querySelector<HTMLElement>('[data-qz-flow-steps]')?.replaceChildren(
    ...(parseSteps(answer) ?? []).map((n) => {
      const item = document.createElement('li')
      const no = Object.assign(document.createElement('span'), { className: 'qz-flow-no', textContent: String(n) })
      const line = Object.assign(document.createElement('code'), {
        className: 'truncate',
        textContent: qzLineNote(lineAt(code, n)) || '（行がありません）',
      })
      item.append(no, line)
      return item
    }),
  )
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-qz]')
  if (!editor) return
  const row = target.closest<HTMLElement>('[data-qz-question]')
  const add = target.closest<HTMLElement>('[data-qz-add]')
  const move = target.closest<HTMLElement>('[data-qz-move]')
  const choiceRemove = target.closest<HTMLElement>('[data-qz-choice-remove]')
  if (add) {
    const template = editor.querySelector<HTMLTemplateElement>(`template[data-qz-template="${add.dataset.qzAdd}"]`)
    const list = editor.querySelector<HTMLElement>('[data-qz-list]')
    if (!template || !list) return
    list.insertAdjacentHTML('beforeend', template.innerHTML.replaceAll(QUIZ_KEY_SLOT, `q${Date.now().toString(36)}${qzCount++}`))
    const added = list.lastElementChild as HTMLElement
    added.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const first = added.querySelector<HTMLTextAreaElement>('textarea')
    first?.focus({ preventScroll: true })
    first?.select()
  } else if (row && target.closest('[data-qz-remove]')) {
    const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null
    row.remove()
    ;(next?.querySelector<HTMLElement>('textarea') ?? editor.querySelector<HTMLElement>('[data-qz-add]'))?.focus()
  } else if (row && move) {
    const up = move.dataset.qzMove === 'up'
    const other = up ? row.previousElementSibling : row.nextElementSibling
    if (!other) return
    other[up ? 'before' : 'after'](row)
    // 端まで動かすとボタンが隠れるので、反対向きのボタンへ移して、キーボードで続けて動かせるようにする
    const again = row.querySelector<HTMLElement>(`[data-qz-move="${move.dataset.qzMove}"]`)
    const back = row.querySelector<HTMLElement>(`[data-qz-move="${up ? 'down' : 'up'}"]`)
    ;((up ? row.previousElementSibling : row.nextElementSibling) ? again : back)?.focus()
  } else if (row && target.closest('[data-qz-choice-add]')) {
    const template = row.querySelector<HTMLTemplateElement>('[data-qz-choice-template]')
    const list = row.querySelector<HTMLElement>('[data-qz-choice-list]')
    if (!template || !list) return
    list.insertAdjacentHTML('beforeend', template.innerHTML)
    list.lastElementChild?.querySelector<HTMLElement>('[data-qz-choice-text]')?.focus()
  } else if (row && choiceRemove) {
    const choice = choiceRemove.closest<HTMLElement>('[data-qz-choice]')
    const next = (choice?.nextElementSibling ?? choice?.previousElementSibling) as HTMLElement | null
    choice?.remove()
    ;(next?.querySelector<HTMLElement>('[data-qz-choice-text]') ?? row.querySelector<HTMLElement>('[data-qz-choice-add]'))?.focus()
  } else return
  qzSync(editor)
})

const qzOnEdit = (e: Event) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-qz]')
  if (!editor) return
  const row = target.closest<HTMLElement>('[data-qz-question]')
  if (row && target.matches('[data-qz-code], [data-qz-bug-no], [data-qz-flow-answer]')) qzShowLines(row)
  qzSync(editor)
}
document.addEventListener('input', qzOnEdit, true)
document.addEventListener('change', qzOnEdit, true)

document.addEventListener('submit', (e) => $$<HTMLElement>('[data-qz]', e.target as HTMLFormElement).forEach(qzSync), true)

// --- 小テストを受ける（components/quiz.tsx の QuizPanel）
function quizMoveLine(line: HTMLElement, before: Element | null) {
  if (before === line || line.nextElementSibling === before) return false
  line.parentElement!.insertBefore(line, before)
  return true
}

document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-quiz-line-move]')
  const line = button?.closest<HTMLElement>('[data-quiz-line]')
  if (!button || !line) return
  const up = button.dataset.quizLineMove === 'up'
  const other = up ? line.previousElementSibling : line.nextElementSibling
  if (!other) return
  quizMoveLine(line, up ? other : other.nextElementSibling)
  const again = line.querySelector<HTMLElement>(`[data-quiz-line-move="${button.dataset.quizLineMove}"]`)
  const back = line.querySelector<HTMLElement>(`[data-quiz-line-move="${up ? 'down' : 'up'}"]`)
  ;((up ? line.previousElementSibling : line.nextElementSibling) ? again : back)?.focus()
})

// HTML のドラッグ＆ドロップ（draggable）を使わないのは、タッチ端末で動かせないため
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Element
  const line = target.closest<HTMLElement>('[data-quiz-line]')
  if (!line || e.button !== 0 || target.closest('button')) return
  // タッチでは、つまみ以外をなぞったときにページをスクロールできるように残す
  if (e.pointerType !== 'mouse' && !target.closest('[data-quiz-grip]')) return
  const list = line.parentElement!
  e.preventDefault()
  line.classList.add('is-dragging')
  const onMove = (move: PointerEvent) => {
    const others = $$<HTMLElement>('[data-quiz-line]', list).filter((el) => el !== line)
    const next = others.find((el) => {
      const box = el.getBoundingClientRect()
      return move.clientY < box.top + box.height / 2
    })
    quizMoveLine(line, next ?? null)
  }
  const onEnd = () => {
    line.classList.remove('is-dragging')
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onEnd)
    document.removeEventListener('pointercancel', onEnd)
  }
  // 行に setPointerCapture しないのは、並べ替えで行を DOM の中で動かすと、キャプチャが外れて続きの動きが届かなくなるため
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onEnd)
  document.addEventListener('pointercancel', onEnd)
})

// --- 小テストの「実行の順番」: 行を押すたびに、その行の番号を順番の最後に足す
const quizFlowSteps = (flow: HTMLElement) => parseSteps(flow.querySelector<HTMLInputElement>('[data-quiz-flow-value]')?.value ?? '') ?? []

function quizSetFlow(flow: HTMLElement, steps: number[]) {
  const value = flow.querySelector<HTMLInputElement>('[data-quiz-flow-value]')
  if (!value) return
  value.value = steps.join(',')
  for (const line of $$<HTMLElement>('[data-quiz-flow-line]', flow)) {
    const no = Number(line.dataset.quizFlowLine)
    const badges = steps.flatMap((n, i) => (n === no ? [i + 1] : []))
    line
      .querySelector('[data-quiz-flow-badges]')
      ?.replaceChildren(
        ...badges.map((at) => Object.assign(document.createElement('span'), { className: 'quiz-flow-badge', textContent: String(at) })),
      )
  }
  flow
    .querySelector('[data-quiz-flow-steps]')
    ?.replaceChildren(...steps.map((n) => Object.assign(document.createElement('li'), { className: 'quiz-step', textContent: String(n) })))
  for (const button of $$<HTMLButtonElement>('[data-quiz-flow-undo], [data-quiz-flow-clear]', flow)) button.disabled = steps.length === 0
  flow.closest('[data-quiz-q]')?.classList.remove('is-missing')
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const flow = target.closest<HTMLElement>('[data-quiz-flow]')
  if (!flow) return
  const steps = quizFlowSteps(flow)
  const line = target.closest<HTMLElement>('[data-quiz-flow-line]')
  if (line) {
    if (steps.length >= MAX_QUIZ_STEPS) return toast(`選べるのは ${MAX_QUIZ_STEPS} 行までです。`, 'error')
    quizSetFlow(flow, [...steps, Number(line.dataset.quizFlowLine)])
  } else if (target.closest('[data-quiz-flow-undo]')) quizSetFlow(flow, steps.slice(0, -1))
  else if (target.closest('[data-quiz-flow-clear]')) quizSetFlow(flow, [])
  else return
  // 空に戻すとボタンが押せなくなってフォーカスを失うので、行へ移して、キーボードで続けて選べるようにする
  if (!line && quizFlowSteps(flow).length === 0) flow.querySelector<HTMLElement>('[data-quiz-flow-line]')?.focus()
})

// --- 小テストの「字下げ」: 行ごとのボタンで、字下げを深く・浅くする
document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>('[data-quiz-indent-move]')
  const line = button?.closest<HTMLElement>('[data-quiz-indent-line]')
  const value = line?.querySelector<HTMLInputElement>('input[type="hidden"]')
  if (!button || !line || !value) return
  const level = Math.min(MAX_QUIZ_INDENT, Math.max(0, Number(value.value) + Number(button.dataset.quizIndentMove)))
  value.value = String(level)
  line.style.setProperty('--level', String(level))
  const [shallower, deeper] = [-1, 1].map((d) => line.querySelector<HTMLButtonElement>(`[data-quiz-indent-move="${d}"]`)!)
  shallower.disabled = level === 0
  deeper.disabled = level === MAX_QUIZ_INDENT
  // 端まで動かすとボタンが押せなくなってフォーカスを失うので、反対向きのボタンへ移す
  if (button.disabled) (button === shallower ? deeper : shallower).focus()
})

const quizAnswered = (question: HTMLElement) => {
  switch (question.dataset.quizQ) {
    case 'order':
    case 'indent':
      return true
    case 'output':
      return !!question.querySelector<HTMLTextAreaElement>('textarea')?.value.trim()
    case 'flow':
      return !!question.querySelector<HTMLInputElement>('[data-quiz-flow-value]')?.value
    case 'table':
      return $$<HTMLInputElement>('input.quiz-cell', question).every((cell) => !!cell.value.trim())
    default:
      return !!question.querySelector('input[type="radio"]:checked')
  }
}

document.addEventListener(
  'submit',
  (e) => {
    const form = e.target as HTMLFormElement
    if (!form.matches('[data-quiz-form]')) return
    const questions = $$<HTMLElement>('[data-quiz-q]', form)
    const game = form.matches('[data-quiz-game]')
    // ゲームの見た目では、一度も開いていないステージも止める。並べ替えと字下げは最初から答えが入っていて、見ないまま採点へ進めてしまうため
    const missing = questions.filter((q) => !quizAnswered(q) || (game && !q.hasAttribute('data-done')))
    questions.forEach((q) => q.classList.toggle('is-missing', missing.includes(q)))
    if (missing.length === 0) return
    // 送信の処理（再読み込みなしの遷移）より先に止めるため、捕捉の段階で伝わるのを止める
    e.preventDefault()
    e.stopImmediatePropagation()
    toast(`まだ答えていない問題が ${missing.length} 問あります。`, 'error')
    if (game) {
      $$<HTMLElement>('[data-qg-to]', form).forEach((node, i) => node.classList.toggle('is-missing', missing.includes(questions[i])))
      qgShow(form, questions.indexOf(missing[0]))
    }
    missing[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    missing[0].querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button')?.focus({ preventScroll: true })
  },
  true,
)

document.addEventListener('input', (e) => (e.target as Element).closest('[data-quiz-q].is-missing')?.classList.remove('is-missing'))

// --- 小テストのゲームの見た目（components/quiz.tsx の GameTake）: 1 問ずつのステージを、道のりと下のボタンで行き来する
function qgShow(game: HTMLElement, to: number) {
  const stages = $$<HTMLElement>('[data-qg-stage]', game)
  const at = Math.min(stages.length - 1, Math.max(0, to))
  const from = stages.findIndex((stage) => !stage.hidden)
  if (at === from) return
  // 並べ替えと字下げは触らなくても答えが入っているので、見てから離れたときにも「答えた」にする
  if (stages[from]) qgSettle(stages[from])
  game.dataset.qgDir = at < from ? '-1' : '1'
  stages.forEach((stage, i) => (stage.hidden = i !== at))
  const nodes = $$<HTMLElement>('[data-qg-to]', game)
  nodes.forEach((node, i) => (i === at ? node.setAttribute('aria-current', 'step') : node.removeAttribute('aria-current')))
  const track = nodes[at]?.closest<HTMLElement>('.qg-track')
  // scrollIntoView を使わないのは、道のりが画面の外にあるときに、ページまで縦に動いてしまうため
  if (track) track.scrollTo({ left: nodes[at].offsetLeft - (track.clientWidth - nodes[at].offsetWidth) / 2, behavior: 'smooth' })
  const [prev, next] = ['-1', '1'].map((d) => game.querySelector<HTMLButtonElement>(`[data-qg-go="${d}"]`))
  const submit = game.querySelector<HTMLButtonElement>('[data-qg-submit]')
  const goal = stages[at].hasAttribute('data-qg-goal')
  const focused = document.activeElement
  if (prev) prev.disabled = at === 0
  if (next) next.hidden = goal
  const now = game.querySelector('[data-qg-now]')
  if (now) now.textContent = goal ? 'ゴール' : String(at + 1)
  const of = game.querySelector<HTMLElement>('[data-qg-of]')
  if (of) of.hidden = goal
  // 押したボタンが消えたり押せなくなったりするとフォーカスを失うので、同じ向きに進める次のボタンへ移す
  if (focused === next && goal) (submit ?? prev)?.focus()
  else if (focused === prev && at === 0) next?.focus()
  if (game.getBoundingClientRect().top < 0) game.closest('.quiz-game')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const game = target.closest<HTMLElement>('[data-quiz-game]')
  if (!game) return
  const go = target.closest<HTMLElement>('[data-qg-go]')
  const to = target.closest<HTMLElement>('[data-qg-to]')
  const stages = $$<HTMLElement>('[data-qg-stage]', game)
  const at = stages.findIndex((stage) => !stage.hidden)
  if (go) qgShow(game, at + Number(go.dataset.qgGo))
  else if (to) qgShow(game, Number(to.dataset.qgTo))
  else if (target.closest('[data-qg-answer]') && stages[at]) void qgCheck(game, stages[at])
  else if (target.closest('[data-qg-explain-close]')) qgExplain(game, null)
})

/** ステージの答えの欄の、送る値（フォームの外のプレビューでも集められるように、FormData を使わずに読む） */
const qgEntries = (stage: HTMLElement) =>
  $$<HTMLInputElement | HTMLTextAreaElement>('input[name], textarea[name]', stage)
    .filter((el) => !el.disabled && el.name.startsWith('a.') && !(/^(radio|checkbox)$/.test(el.type) && !(el as HTMLInputElement).checked))
    .map((el): [string, string] => [el.name, el.value])

/**
 * 3D のゲームの「こたえる」（扉のレバー）: サーバーで答えを確かめ、正解ならステージに扉を開ける印（data-qg-passed）を付ける（src/quiz-world.ts が見て扉を開く）。
 * 最初に確かめた答えはサーバーが覚え、ゴールの採点に使う（routes/quiz/handlers.tsx の check）。まちがえたあとに正解したら、解説を出す
 */
async function qgCheck(game: HTMLElement, stage: HTMLElement) {
  qgSettle(stage)
  if (!stage.hasAttribute('data-done')) {
    stage.classList.add('is-missing')
    toast('まだ答えが入っていないよ。答えてから「こたえる！」を押してね。', 'error')
    return
  }
  const url = game.dataset.qgCheck
  const id = stage.dataset.quizId
  if (!url || !id || stage.hasAttribute('data-qg-passed') || stage.hasAttribute('data-qg-checking')) return
  const entries = qgEntries(stage)
  const body = new FormData()
  body.set('q', id)
  for (const [name, value] of entries) body.append(name, value)
  stage.setAttribute('data-qg-checking', '')
  let result: { correct: boolean; explanation?: string }
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(String(res.status))
    result = (await res.json()) as typeof result
  } catch {
    toast('答えを確かめられませんでした。通信を確かめて、もう一度ためしてね。', 'error')
    return
  } finally {
    stage.removeAttribute('data-qg-checking')
  }
  if (result.correct) {
    stage.setAttribute('data-qg-passed', '')
    if (stage.hasAttribute('data-qg-missed') && result.explanation) qgExplain(game, result.explanation)
    return
  }
  stage.setAttribute('data-qg-missed', '')
  // 3D のゲームは、扉の前で動物とレバーの動きで知らせる（preventDefault する）。ノートだけで答えているときはトーストで知らせる
  if (stage.dispatchEvent(new CustomEvent('qg:wrong', { bubbles: true, cancelable: true })))
    toast('ざんねん、ちがうみたい。もう一度考えてみよう。', 'error')
}

/** 解説を開く（text が null なら閉じる）。開いている間は src/quiz-world.ts がマウスを放す */
function qgExplain(game: HTMLElement, text: string | null) {
  const box = game.querySelector<HTMLElement>('[data-qg-explain]')
  if (!box) return
  const label = box.querySelector('[data-qg-explain-text]')
  if (label && text !== null) label.textContent = text
  box.hidden = text === null
  game.toggleAttribute('data-qg-explaining', text !== null)
  if (text !== null) box.querySelector<HTMLElement>('[data-qg-explain-close]')?.focus()
}

/** ステージに答えが入っていれば「答えた」にして、道のりに星を付け、答えたステージの数を出し直す */
function qgSettle(stage: HTMLElement) {
  const game = stage.closest<HTMLElement>('[data-quiz-game]')
  if (!game || !stage.dataset.quizQ) return
  const done = quizAnswered(stage)
  stage.toggleAttribute('data-done', done)
  const node = game.querySelector<HTMLElement>(`[data-qg-to="${$$<HTMLElement>('[data-qg-stage]', game).indexOf(stage)}"]`)
  node?.toggleAttribute('data-done', done)
  if (done) node?.classList.remove('is-missing')
  const count = String($$('[data-qg-stage][data-done]', game).length)
  for (const el of $$('[data-qg-done]', game)) el.textContent = count
}

function qgMark(e: Event) {
  const target = e.target as Element
  const stage = target.closest<HTMLElement>('[data-qg-stage]')
  // 並べ替えと字下げは最初から答えが入っているので、問題文を押しただけでは「答えた」にしない
  if (stage && (e.type !== 'click' || target.closest('button, label, input, [data-quiz-line]'))) qgSettle(stage)
}
document.addEventListener('click', qgMark)
document.addEventListener('input', qgMark)

document.addEventListener('keydown', (e) => {
  const game = (e.target as Element).closest<HTMLElement>('[data-qg-explaining]')
  if (e.key === 'Escape' && game) qgExplain(game, null)
})

// Enter で送信させないのは、途中のステージの表を埋めている最中に、採点へ進んでしまうため
document.addEventListener('keydown', (e) => {
  const cell = e.target as Element
  if (e.key !== 'Enter' || e.isComposing || !cell.matches('[data-quiz-game] input.quiz-cell')) return
  e.preventDefault()
  const cells = $$<HTMLInputElement>('input.quiz-cell', cell.closest<HTMLElement>('[data-qg-stage]')!)
  cells[cells.indexOf(cell as HTMLInputElement) + 1]?.focus()
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
  if (!form || !control.name) return
  const all = 'validated' in form.dataset
  if (!all && control.getAttribute('aria-invalid') !== 'true') return
  const errors = checkForm(form)
  if (!errors) return
  if (all) fieldNames(form).forEach((name) => setFieldError(form, name, errors[name]))
  else setFieldError(form, control.name, errors[control.name])
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
const DIALOG_HTML = `<form method="dialog"><p class="dialog-msg"></p><div class="form-actions">
  <button value="cancel" class="btn btn-ghost">キャンセル</button>
  <button value="ok" class="btn btn-danger">実行する</button></div></form>`

function openDialog(dialog: HTMLDialogElement, message: string): Promise<boolean> {
  dialog.querySelector('.dialog-msg')!.textContent = message
  dialog.returnValue = ''
  dialog.showModal()
  ;(dialog.querySelector('[value=cancel]') as HTMLButtonElement).focus()
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }))
}

let dialog: HTMLDialogElement | null = null
function confirmDialog(message: string): Promise<boolean> {
  if (!dialog?.isConnected) {
    dialog = document.createElement('dialog')
    dialog.className = 'dialog'
    dialog.innerHTML = DIALOG_HTML
    document.body.appendChild(dialog)
    dialog.addEventListener('click', (e) => e.target === dialog && dialog!.close('cancel'))
  }
  return openDialog(dialog, message)
}

// --- ボタンのそばに出す確認のチップ（components/overlay.tsx の ConfirmChip）
// 画面の中央のダイアログにしないのは、押したボタンから目を離さずに続けるかを決められるようにするため。押したボタンが見えないときだけダイアログにする
type ConfirmNearOptions = { ok?: string; tone?: 'danger' | 'primary' }
let confirmChip: { panel: HTMLElement; anchor: HTMLElement } | null = null
let confirmChipCount = 0

function placeConfirmChip() {
  if (!confirmChip) return
  const { panel, anchor } = confirmChip
  const r = anchor.getBoundingClientRect()
  const { offsetWidth: w, offsetHeight: h } = panel
  const margin = 12
  const below = r.bottom + 8
  const above = r.top - 8 - h
  const isAbove = below + h > innerHeight - margin && above >= margin
  panel.classList.toggle('is-above', isAbove)
  panel.style.top = `${Math.max(margin, Math.min(isAbove ? above : below, innerHeight - h - margin))}px`
  const left = r.left + r.width / 2 < innerWidth / 2 ? r.left : r.right - w
  panel.style.left = `${Math.max(margin, Math.min(left, innerWidth - w - margin))}px`
}

function confirmNear(anchor: HTMLElement, messages: readonly string[], { ok = '実行する', tone = 'danger' }: ConfirmNearOptions = {}) {
  const template = document.querySelector<HTMLTemplateElement>('template[data-confirm-chip]')
  const panel = template?.content.firstElementChild?.cloneNode(true)
  const text = panel instanceof HTMLElement ? panel.querySelector<HTMLElement>('[data-confirm-chip-msg]') : null
  const cancel = panel instanceof HTMLElement ? panel.querySelector<HTMLButtonElement>('[data-confirm-chip-cancel]') : null
  const confirm = panel instanceof HTMLElement ? panel.querySelector<HTMLButtonElement>(`[data-confirm-chip-ok="${tone}"]`) : null
  if (!(panel instanceof HTMLElement) || !text || !cancel || !confirm || anchor.getClientRects().length === 0)
    return confirmDialog(messages.join('\n'))

  confirmChip?.panel.hidePopover()
  text.id = `confirm-chip-${++confirmChipCount}`
  text.append(...messages.map((m) => Object.assign(document.createElement('p'), { textContent: m })))
  panel.setAttribute('aria-describedby', text.id)
  confirm.textContent = ok
  panel.querySelectorAll('[data-confirm-chip-ok]').forEach((b) => b !== confirm && b.remove())
  let answer = false
  const close = (value: boolean) => {
    answer = value
    panel.hidePopover()
  }
  cancel.addEventListener('click', () => close(false))
  confirm.addEventListener('click', () => close(true))
  // いつも body に置かないのは、モーダルの外の popover とみなされ、開いたときにモーダルが閉じるため
  ;(anchor.closest('[popover]') ?? document.body).append(panel)
  confirmChip = { panel, anchor }
  panel.showPopover()
  placeConfirmChip()
  cancel.focus()
  return new Promise<boolean>((resolve) => {
    panel.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'closed') return
      if (confirmChip?.panel === panel) confirmChip = null
      const lost = document.activeElement === document.body || panel.contains(document.activeElement)
      panel.remove()
      if (!answer && lost && anchor.isConnected) anchor.focus()
      resolve(answer)
    })
  })
}
addEventListener('scroll', placeConfirmChip, { capture: true, passive: true })
addEventListener('resize', placeConfirmChip)

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

// --- 右下のボタンで前回・今回のセクションを選ぶ
// CSS のクラスで光らせないのは、今日の回のカードに付けた animation を上書きして止めてしまうため
function flashSection(el: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
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
    .then(({ mountCodeEditors }) => mountCodeEditors(toast, confirmNear))
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

// --- 小テストのゲームの見た目の 3D の世界（components/quiz.tsx の GameTake / GameResult）
// ここに直接 import しないのは、three.js が大きく、小テストのない画面でも毎回読み込むことになるため
let quizWorld: Promise<typeof import('./quiz-world')> | null = null
function initQuizWorlds() {
  void quizWorld?.then(({ releaseDetachedQuizWorlds }) => releaseDetachedQuizWorlds())
  const hosts = $$<HTMLElement>('[data-qg-world]:not([data-ready])')
  // 動きを減らす設定で読み込まないのは、3D を描かずに 2D の表示を残すので、three.js を取りに行くだけ無駄になるため
  if (!hosts.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  quizWorld ??= import('./quiz-world')
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

// --- 発表ファイルのビューアー（components/presentation.tsx の PresentationStage）
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

// --- 共同編集のエディター（components/collab.tsx の CollabWorkspace）
// ここに直接 import しないのは、Yjs と種類ごとのエディター（TipTap や Office の形式の読み書き）が大きく、共同編集のない画面でも毎回読み込むことになるため
let collabApp: Promise<typeof import('./collab/app')> | null = null
function initCollabs() {
  void collabApp?.then(({ releaseDetachedCollabs }) => releaseDetachedCollabs())
  const roots = $$<HTMLElement>('[data-collab]:not([data-collab-ready])')
  if (!roots.length) return
  collabApp ??= import('./collab/app')
  collabApp
    .then(({ mountCollab }) => roots.forEach((root) => void mountCollab(root, toast, confirmNear)))
    .catch(() => {
      collabApp = null
      toast('エディターを読み込めませんでした。', 'error')
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
  // data-steady のあいだ気まぐれに動かさないのは、AI のパネルのマスコットが作業の様子を見せているときに、関係のない表情や動きが混ざるため
  repeatRandomly(el, 3500, 9000, () => {
    if (el.hasAttribute('data-steady')) return 0
    const quirk = pickKey(MASCOT_QUIRKS)
    return flagFor(el, 'data-quirk', quirk, MASCOT_QUIRKS[quirk])
  })
  repeatRandomly(el, 6000, 14_000, () => {
    const mood = el.dataset.mood
    const reaction = pickKey(MASCOT_REACTIONS)
    if (!mood || mood === reaction || mood === 'sleepy' || el.hasAttribute('data-steady')) return 0
    el.dataset.mood = reaction
    setTimeout(() => {
      if (el.dataset.mood === reaction && !el.hasAttribute('data-steady')) el.dataset.mood = mood
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
// 遊び場の足場を 1 つのセレクターにまとめないのは、セレクターごとに最初に見つかった 1 つだけが足場になるため
const WALKER_GROUNDS = [
  '.course-hero-cover',
  '.section-card, .sec-tile',
  '.mascot-yard-block.is-floor',
  '.mascot-yard-block.is-shelf',
  '.mascot-yard-block.is-box',
]
const WALKER_WALLS = '.back-link, .course-hero-side > *, .course-tabs .tabs, .course-tabs-actions > *, .section-toggles > *'
const WALKER_GAP = 6
// 端まで歩かせないのは、足場の角が丸く、端では足の下に何もないように見えるため
const WALKER_EDGE = 20
const WALKER_SINK = 2
const WALKER_SIGHT = 120
const WALKER_PUSH_REACH = 600
const WALKER_GAITS = {
  walk: { speed: 46, step: '0.56s' },
  run: { speed: 125, step: '0.28s' },
  search: { speed: 26, step: '0.8s' },
} as const

type Box = { x: number; y: number; w: number; h: number }
type WalkerState = 'idle' | 'walk' | 'busy' | 'bump' | 'greet' | 'pet' | 'held' | 'drop' | 'pop' | 'crouch' | 'jump' | 'land' | 'pushed'
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
let walkerResizedAt = -Infinity

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
  if (state !== 'pushed') delete w.el.dataset.pushed
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

// 近くの空いている場所へ移すだけにしないのは、迫ってきた壁の向こう側へすり抜けて瞬間移動したように見えるため
function pushedSpot(w: Walker): { box: Box; from: -1 | 0 | 1 } | null {
  const g = w.grounds[w.level]
  if (!g || w.state === 'drop') return null
  const box = standAt(w, w.level, w.box.x)
  if (isFree(w, box)) return { box, from: 0 }
  const wall = w.walls.find((wall) => overlaps(box, wall))
  const fromLeft = box.x + box.w > g.right ? false : box.x < g.left || (!!wall && wall.x + wall.w / 2 < box.x + box.w / 2)
  const from = fromLeft ? -1 : 1
  const start = Math.min(Math.max(box.x, g.left), g.right - box.w)
  for (let d = 0; d <= WALKER_PUSH_REACH; d += 2) {
    const spot = standAt(w, w.level, start - from * d)
    if (isFree(w, spot)) return { box: spot, from }
  }
  return null
}

function pushWalker(w: Walker, from: -1 | 1, now: number) {
  const side = from < 0 ? 'left' : 'right'
  w.target = null
  w.cheerAfter = false
  if (w.state !== 'pushed') dressWalker(w, { mood: 'surprised', pose: 'open', motion: 'none', look: side })
  setWalkerState(w, 'pushed', now, 900)
  w.el.dataset.pushed = side
}

function settleWalker(w: Walker, now: number) {
  measureWalker(w, now)
  if (w.el.dataset.shown === undefined) return spawnWalker(w, now)
  const level = levelOf(w, w.box)
  if (level >= 0 && isFree(w, w.box)) {
    w.level = level
    return true
  }
  const pushed = pushedSpot(w)
  if (pushed) {
    placeWalker(w, pushed.box.x, pushed.box.y)
    if (pushed.from !== 0) pushWalker(w, pushed.from, now)
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
  const resizing = now - walkerResizedAt < 400
  if ((resizing || now - w.measuredAt > 400) && !settleWalker(w, now)) return

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

// 縮めている間は毎フレーム測り直すのは、いつもの間隔では壁がめり込んでから飛びのいたように見えるため
addEventListener('resize', () => (walkerResizedAt = performance.now()))

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
let aiComposing = false
let aiStopping = false
let aiSync: Promise<void> | null = null
let aiSyncTimer = 0
const AI_SYNC_INTERVAL = 10_000
const AI_BUSY_SYNC_INTERVAL = 3000
const AI_THINKING_AFTER_TEXT = 1500
// サーバーへの問い合わせだけで済ませないのは、同じブラウザのほかのタブで言い終えた応答を、次の問い合わせまで待たずに出すため
const aiChannel = new BroadcastChannel('ai-panel')

function aiTemplate(
  kind:
    | 'user'
    | 'assistant'
    | 'tool'
    | 'replies'
    | 'reply'
    | 'suggestion'
    | 'suggestion-loading'
    | 'pending'
    | 'stopped'
    | 'compacted'
    | 'error',
  text?: string,
) {
  const template = aiPanel()?.querySelector<HTMLTemplateElement>(`template[data-ai-template="${kind}"]`)
  const el = template?.content.firstElementChild?.cloneNode(true)
  if (!(el instanceof HTMLElement)) throw new Error(`template ${kind} がありません`)
  if (text !== undefined) el.querySelector('[data-ai-text]')!.textContent = text
  return el
}

function aiToolLine(label: string, touched?: AiTouched) {
  const line = aiTemplate('tool', label)
  const link = line.querySelector<HTMLAnchorElement>('.ai-spot-link')
  if (link && touched) {
    link.href = touched.href
    link.dataset.aiSpot = JSON.stringify(touched)
    link.hidden = false
  }
  return line
}

function aiReplies(replies: string[]) {
  const group = aiTemplate('replies')
  for (const text of replies) {
    const button = aiTemplate('reply', text)
    button.dataset.aiSuggest = text
    group.append(button)
  }
  return group
}

const aiLogAtBottom = (log: HTMLElement) => log.scrollHeight - log.scrollTop - log.clientHeight < 80

function scrollAiLog(force = false) {
  const log = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
  if (!log) return
  // 読み返しているときに最下部へ戻さないのは、応答が流れているあいだ、上の発言を読めなくなるため
  if (force || aiLogAtBottom(log)) log.scrollTop = log.scrollHeight
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
  if (!open) {
    cancelAiVoice()
    return scheduleAiSync()
  }
  void fillAiSuggestions()
  void syncAiPanel()
  scrollAiLog(true)
  watchAiCards()
  // 狭い画面で入力欄にフォーカスしないのは、開いただけでキーボードが出て会話が隠れるため
  if (aiDocked()) aiInput()?.focus()
}

type AiModelLabels = Record<string, { label: string; hard: string | null; hardOff: string | null; images: boolean }>

const aiLabelsOf = (form: HTMLFormElement) => JSON.parse(form.dataset.aiLabels ?? '{}') as AiModelLabels

const chosenAiModel = (form: HTMLFormElement) =>
  (
    form.querySelector<HTMLInputElement>('input[name="model"]:checked') ??
    form.querySelector<HTMLInputElement>('input[type="hidden"][name="model"]')
  )?.value

/** 選んでいるモデルと「難しい依頼」に合わせて、ヘッダーのモデル名・送信する hard・入力欄の下の利用状況をそろえる */
function syncAiModel(form: HTMLFormElement) {
  const model = chosenAiModel(form)
  const entry = model ? aiLabelsOf(form)[model] : undefined
  $$<HTMLElement>('[data-ai-usage]', form).forEach((el) => (el.hidden = el.dataset.aiUsage !== model))
  const imageButton = form.querySelector<HTMLButtonElement>('button[data-ai-image]')
  if (imageButton) imageButton.hidden = !entry?.images
  // 選んだ画像を残したまま隠さないのは、読めないモデルに選び直したあと、見えない画像が発言と一緒に送られて断られるため
  if (!entry?.images && aiImage) setAiImage(null)
  const toggle = form.querySelector<HTMLButtonElement>('button[data-ai-hard]')
  const hardField = form.elements.namedItem('hard')
  if (!toggle || !(hardField instanceof HTMLInputElement)) return
  toggle.hidden = !entry?.hard
  toggle.disabled = !!entry?.hardOff
  toggle.setAttribute('aria-label', entry?.hardOff ? `難しい依頼（${entry.hardOff}）` : '難しい依頼')
  const hard = !!entry?.hard && !entry.hardOff && toggle.getAttribute('aria-pressed') === 'true'
  toggle.setAttribute('aria-pressed', String(hard))
  hardField.value = hard ? '1' : ''
  const name = aiPanel()?.querySelector('[data-ai-model]')
  if (name && entry) name.textContent = hard ? entry.hard : entry.label
}

/** 応答のあとの利用状況を反映する。同じ枠（key）はどのモデルの欄でも同じなので、key の合う行をすべて書き換える */
function paintAiUsage(panel: HTMLElement, usage: AiUsageMeter[], hardOff: string | null) {
  for (const meter of usage) {
    $$<HTMLElement>(`[data-ai-meter="${CSS.escape(meter.key)}"]`, panel).forEach((el) => {
      el.dataset.state = meter.state
      el.toggleAttribute('data-high', meter.state === 'ok' && meter.percent >= 80)
      el.style.setProperty('--ai-used', `${meter.percent}%`)
      const percent = el.querySelector('[data-ai-meter-percent]')
      if (percent) percent.textContent = String(meter.percent)
      const note = el.querySelector('[data-ai-meter-note]')
      if (note) note.textContent = meter.note
      el.querySelector('[role=progressbar]')?.setAttribute('aria-valuenow', String(meter.percent))
    })
  }
  $$<HTMLElement>('[data-ai-usage-trigger]', panel).forEach((trigger) => {
    const main = trigger.closest('[data-ai-usage]')?.querySelector<HTMLElement>('.ai-meter')
    const percent = main?.querySelector('[data-ai-meter-percent]')?.textContent ?? '0'
    const label = main?.querySelector('.ai-meter-label')?.textContent ?? ''
    trigger.setAttribute('aria-label', `今週の利用状況（${label} ${percent}% 使用）`)
    const text = trigger.querySelector('[data-ai-usage-main]')
    if (text) text.textContent = percent
  })
  const form = panel.querySelector<HTMLFormElement>('[data-ai-form]')
  const model = form && chosenAiModel(form)
  if (!form || !model) return
  const labels = aiLabelsOf(form)
  if (labels[model]) labels[model].hardOff = hardOff
  form.dataset.aiLabels = JSON.stringify(labels)
  syncAiModel(form)
}

function paintAiContext(panel: HTMLElement, percent: number) {
  const meter = panel.querySelector<HTMLElement>('[data-ai-context]')
  if (!meter) return
  meter.style.setProperty('--ai-used', `${percent}%`)
  meter.querySelector('summary')?.setAttribute('aria-label', `会話の長さ（${percent}%）`)
  meter.querySelector('[role=progressbar]')?.setAttribute('aria-valuenow', String(percent))
  $$('[data-ai-context-percent]', meter).forEach((text) => (text.textContent = String(percent)))
}

document.addEventListener('change', (e) => {
  const input = e.target as Element
  if (input instanceof HTMLInputElement && input.name === 'model' && input.form?.matches('[data-ai-form]')) syncAiModel(input.form)
})

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-toggle]')) return setAiOpen(!document.documentElement.hasAttribute('data-ai-open'))
  const focusStart = target.closest<HTMLElement>('[data-ai-focus-start]')
  if (focusStart) return void startAiFocus(focusStart)
  if (target.closest('[data-ai-focus-clear]')) return clearAiFocus()
  if (target.closest('[data-ai-stop]')) return void stopAi()
  if (target.closest('[data-ai-approve-next]')) return showNextAiCard()
  const hardToggle = target.closest<HTMLElement>('[data-ai-hard]')
  const hardForm = hardToggle?.closest<HTMLFormElement>('[data-ai-form]')
  if (hardToggle && hardForm) {
    hardToggle.setAttribute('aria-pressed', String(hardToggle.getAttribute('aria-pressed') !== 'true'))
    return syncAiModel(hardForm)
  }
  const suggestion = target.closest<HTMLElement>('[data-ai-suggest]')
  const input = aiInput()
  if (!suggestion || !input) return
  input.value = suggestion.dataset.aiSuggest ?? ''
  fitAiInput(input)
  input.form?.requestSubmit()
})

document.addEventListener('keydown', (e) => {
  const input = e.target as Element
  if (e.key === 'Escape' && aiVoice) {
    e.preventDefault()
    return cancelAiVoice()
  }
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

document.addEventListener('compositionstart', (e) => {
  if ((e.target as Element).matches('.ai-textarea')) aiComposing = true
})

document.addEventListener('compositionend', (e) => {
  if ((e.target as Element).matches('.ai-textarea')) aiComposing = false
})

/** パネルを取り直す。入力中の文と選んでいたモデル・「難しい依頼」はそのまま残し、model を渡せば、新しいチャットのモデルにそれを選んでおく */
async function refreshAiPanel(model?: string) {
  window.clearTimeout(aiSyncTimer)
  const res = await fetch('/ai/chat', { headers: { Accept: 'text/html' } })
  const doc = res.ok ? new DOMParser().parseFromString(await res.text(), 'text/html') : null
  const next = doc?.getElementById('ai-panel')
  const current = aiPanel()
  if (!next || !current) return
  const draft = aiInput()?.value ?? ''
  const focused = document.activeElement === aiInput()
  const chosen = model ?? current.querySelector<HTMLInputElement>('input[name=model]:checked')?.value
  const hard = current.querySelector('[data-ai-hard]')?.getAttribute('aria-pressed')
  const focus = aiFocusField(current)?.value ? current.querySelector('[data-ai-focus]') : null
  const buddy = aiBuddy(current)
  const buddyBox = buddy && !buddy.hidden ? aiMascotBox(buddy) : null
  current.replaceWith(document.adoptNode(next))
  // 作業していたマスコットを持ち越すのは、描き直したものに替えると、見せていた反応や動きが途中で切れて、飛び移ったように見えるため
  const nextBuddy = aiBuddy(next)
  if (buddy && buddyBox && nextBuddy && !nextBuddy.hidden) nextBuddy.replaceWith(buddy)
  else if (buddyBox) {
    const introMascot = next.querySelector<HTMLElement>('[data-ai-intro]:not([hidden]) .mascot')
    if (introMascot) flyAiBuddy(buddyBox, introMascot)
  }
  settleAiBuddy(next)
  // 選ぼうとしているアイテムを持ち越すのは、最初の発言を断られて入力欄に戻ったとき、送り直すとアイテムを選ばずに始まるため
  const nextFocus = next.querySelector('[data-ai-focus]')
  const focusField = aiFocusField(next)
  if (focus && nextFocus && focusField) {
    focusField.value = aiFocusField(current)!.value
    nextFocus.replaceWith(focus)
  }
  const option = $$<HTMLInputElement>('input[type=radio][name=model]', next).find((r) => r.value === chosen)
  if (option) option.checked = true
  const form = next.querySelector<HTMLFormElement>('[data-ai-form]')
  if (hard) next.querySelector('[data-ai-hard]')?.setAttribute('aria-pressed', hard)
  if (form) syncAiModel(form)
  const input = aiInput()
  if (input && draft) {
    input.value = draft
    fitAiInput(input)
  }
  if (input && focused) input.focus()
  paintAiImage()
  showAiVoice()
  initMascots()
  void fillAiSuggestions()
  scrollAiLog(true)
  watchAiCards()
  scheduleAiSync()
}

const aiWatching = () => !!aiPanel() && !document.hidden && document.documentElement.hasAttribute('data-ai-open')

function scheduleAiSync() {
  window.clearTimeout(aiSyncTimer)
  if (!aiWatching()) return
  const delay = aiPanel()!.hasAttribute('data-busy') ? AI_BUSY_SYNC_INTERVAL : AI_SYNC_INTERVAL
  aiSyncTimer = window.setTimeout(() => void syncAiPanel(), delay)
}

/** ほかのタブや端末での発言や応答を、パネルがまだ反映していなければ true */
async function aiPanelOutdated() {
  const panel = aiPanel()
  if (!panel) return false
  const res = await fetch('/ai/chat/state', { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) return false
  const state = (await res.json()) as { revision: string; busy: boolean }
  return state.revision !== (panel.dataset.revision ?? '') || state.busy !== panel.hasAttribute('data-busy')
}

/** 古ければ取り直す。取り直したら true。model は refreshAiPanel と同じ */
async function refreshAiIfOutdated(model?: string) {
  try {
    if (!(await aiPanelOutdated())) return false
    await refreshAiPanel(model)
    return true
  } catch {
    return false
  }
}

// 作成中の応答を開き直した画面に流し直さないのは、流れていた続きを受け取る手段がなく、言い終えて保存されたものを取り直せば足りるため
// 変換中に取り直さないのは、入力欄が差し替わって、確定していない文字が消えるため。音声入力の途中も、入力欄を差し替えると録った文が消えるので取り直さない
function syncAiPanel() {
  if (aiSending) return Promise.resolve()
  if (aiComposing || aiVoice || !aiWatching()) {
    scheduleAiSync()
    return Promise.resolve()
  }
  aiSync ??= (async () => {
    try {
      if ((await aiPanelOutdated()) && !aiSending && !aiComposing) await refreshAiPanel()
    } catch {}
  })().finally(() => {
    aiSync = null
    if (!aiSending) scheduleAiSync()
  })
  return aiSync
}

aiChannel.addEventListener('message', () => void syncAiPanel())
document.addEventListener('visibilitychange', () => void syncAiPanel())
addEventListener('focus', () => void syncAiPanel())

// --- AI のパネルのヘッダーで作業するマスコット（components/ai-panel.tsx の AiBuddy）
// 状態を保存せずにクライアントで持つのは、応答を作っているあいだの細かな動きは、流れてくるイベントからしか分からないため
const AI_BUDDY_FLASH_MS: Partial<Record<AiBuddyState, number>> = { applied: 1400, done: 2200, error: 3000, stopped: 1400 }
const AI_BUDDY_BREAK_AFTER = 25_000
const AI_BUDDY_DOZE_AFTER = 120_000
const AI_BUDDY_FLY_MS = 750
// ツールを終えた時点で「考えています」に戻さないのは、ツールの多くは一瞬で終わり、何を見ていたのかが見えないまま次へ移るため
const AI_BUDDY_HOLD_MS = 1600
let aiBuddyBase: AiBuddyState = 'idle'
let aiBuddyFlashTimer = 0
let aiBuddyReady = false
const aiBuddyIdleTimers: number[] = []

const aiBuddy = (root: ParentNode | null = aiPanel()) => root?.querySelector<HTMLElement>('[data-ai-buddy]') ?? null

function paintAiBuddy(state: AiBuddyState) {
  const buddy = aiBuddy()
  const mascot = buddy?.querySelector<HTMLElement>('[data-mascot]')
  if (!buddy || !mascot || buddy.dataset.state === state) return
  buddy.dataset.state = state
  Object.assign(mascot.dataset, AI_BUDDY_LOOKS[state])
  mascot.toggleAttribute('data-steady', state !== 'idle')
  mascot.removeAttribute('data-quirk')
  for (const mark of $$<HTMLElement>('[data-ai-buddy-mark]', buddy)) mark.hidden = mark.dataset.aiBuddyMark !== state
}

/** マスコットの今の状態を決める。applied などの反応を見せているあいだは、反応を見せ終えてからこの状態に移る */
function setAiBuddy(state: AiBuddyState) {
  aiBuddyBase = state
  aiBuddyIdleTimers.splice(0).forEach((t) => clearTimeout(t))
  if (!aiBuddyFlashTimer) paintAiBuddy(state)
  if (state !== 'idle') return
  const rest = (next: AiBuddyState) => () => {
    if (aiBuddyBase === 'idle' && !aiBuddyFlashTimer) paintAiBuddy(next)
  }
  aiBuddyIdleTimers.push(window.setTimeout(rest('break'), AI_BUDDY_BREAK_AFTER), window.setTimeout(rest('doze'), AI_BUDDY_DOZE_AFTER))
}

/** 少しのあいだだけ反応を見せて、setAiBuddy で決めた状態に戻る */
function flashAiBuddy(state: keyof typeof AI_BUDDY_FLASH_MS) {
  clearTimeout(aiBuddyFlashTimer)
  paintAiBuddy(state)
  aiBuddyFlashTimer = window.setTimeout(() => {
    aiBuddyFlashTimer = 0
    setAiBuddy(aiBuddyBase)
  }, AI_BUDDY_FLASH_MS[state])
}

/** 確認やファイルを待つカードがあればそれを待つ状態に、なければ手が空いた状態にする */
function restAiBuddy(panel: HTMLElement) {
  const pending = $$<HTMLElement>('.ai-card[data-state=pending]', panel)
  setAiBuddy(pending.some((c) => !c.matches('.ai-file-card')) ? 'ask' : pending.length > 0 ? 'wait-file' : 'idle')
}

/** 描いたパネルの様子にマスコットを合わせる */
function settleAiBuddy(panel: HTMLElement) {
  if (panel.hasAttribute('data-busy')) setAiBuddy('think')
  else restAiBuddy(panel)
}

/** ヘッダーのマスコットを出すか隠す。チャットがないあいだは、代わりにアイコンを出す */
function showAiBuddy(panel: HTMLElement, shown: boolean) {
  const buddy = aiBuddy(panel)
  const mark = panel.querySelector<HTMLElement>('[data-ai-mark]')
  if (buddy) buddy.hidden = !shown
  if (mark) mark.hidden = shown
}

// 位置を変える要素そのものではなく見た目だけを動かすのは、ヘッダーとチャットの始まりの画面の並びを、飛んでいるあいだも崩さないため
/** from の位置から to のマスコットのいる場所まで、弧を描いて飛ばす */
function flyAiBuddy(from: DOMRect, to: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const end = to.getBoundingClientRect()
  if (!from.width || !end.width) return
  const dx = from.left - end.left
  const dy = from.top - end.top
  const scale = from.width / end.width
  const lift = Math.min(60, Math.abs(dy) / 3 + 20)
  to.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      {
        transformOrigin: '0 0',
        transform: `translate(${dx * 0.45}px, ${Math.min(dy, 0) * 0.45 - lift}px) scale(${(scale + 1) / 2}) rotate(-10deg)`,
        offset: 0.45,
      },
      { transformOrigin: '0 0', transform: 'scale(1.12, 0.88)', offset: 0.85 },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: AI_BUDDY_FLY_MS, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
  )
}

const aiMascotBox = (root: Element | null) => root?.querySelector('.mascot-svg')?.getBoundingClientRect() ?? null

type AiStreamHooks = { onRetract?: () => void; onChat?: (id: number) => void }

/**
 * 応答を届いた分から会話に書き足す。closed はチャットがもうないこと、confirmed は確認カードを出したこと、
 * outdated はパネルが古く、発言を受け付けられなかったこと、errors は出したエラーの文言
 */
async function streamAi(url: string, data: FormData, { onRetract, onChat }: AiStreamHooks = {}) {
  const panel = aiPanel()
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const outcome = { closed: false, retracted: false, confirmed: false, outdated: false, stopped: false, errors: [] as string[] }
  if (!panel || !log) return outcome
  data.set('page', location.pathname)
  data.set('revision', panel.dataset.revision ?? '')
  panel.toggleAttribute('data-busy', true)
  const pending = aiTemplate('pending')
  const pendingLabel = pending.querySelector('[data-ai-pending-label]')
  const thinkingText = pendingLabel?.textContent ?? ''
  log.append(pending)
  scrollAiLog(true)

  let bubble: HTMLElement | null = null
  let markdown = ''
  let thinkingTimer = 0
  let activity: AiBuddyState = 'think'
  let answered = false
  let failed = false
  let holdUntil = 0
  let holdTimer = 0
  const work = (next: AiBuddyState) => {
    clearTimeout(holdTimer)
    activity = next
    setAiBuddy(next)
    if (pendingLabel) pendingLabel.textContent = AI_BUDDY_LABELS[next] ?? thinkingText
  }
  work('think')
  // 本文が届いた時点で消したままにしないのは、本文のあとにツールを呼ぶあいだ、何も動いていないように見えるため
  const updateThinking = (writing: boolean) => {
    clearTimeout(thinkingTimer)
    pending.hidden = writing
    if (writing)
      thinkingTimer = window.setTimeout(() => {
        pending.hidden = false
        setAiBuddy(activity)
      }, AI_THINKING_AFTER_TEXT)
  }
  const handle = (event: AiAgentEvent) => {
    // 書き足したあとに最下部か確かめないのは、続きの依頼のような高さのある塊を足すと、最下部から離れたと見なされて止まるため
    const following = aiLogAtBottom(log)
    updateThinking(event.type === 'text')
    if (event.type === 'compacting') return work('summarize')
    if (event.type === 'working') {
      holdUntil = performance.now() + AI_BUDDY_HOLD_MS
      return work(event.activity)
    }
    if (event.type === 'text') {
      clearTimeout(holdTimer)
      answered = true
      activity = 'think'
      if (pendingLabel) pendingLabel.textContent = thinkingText
      setAiBuddy('write')
      if (!bubble) {
        bubble = aiTemplate('assistant')
        pending.before(bubble)
      }
      markdown += event.text
      bubble.querySelector('[data-ai-text]')!.innerHTML = renderMarkdown(markdown)
    } else if (event.type === 'tool' || event.type === 'confirm') {
      answered = true
      const left = holdUntil - performance.now()
      if (left > 0) holdTimer = window.setTimeout(() => work('think'), left)
      else work('think')
      bubble = null
      markdown = ''
      if (event.type === 'tool') pending.before(aiToolLine(event.label, event.touched))
      else outcome.confirmed = true
    } else if (event.type === 'error') {
      if (event.retract) {
        outcome.retracted = true
        onRetract?.()
      }
      outcome.errors.push(event.message)
      pending.before(aiTemplate('error', event.message))
      flashAiBuddy('error')
    } else if (event.type === 'chat') {
      panel.dataset.chat = String(event.id)
      onChat?.(event.id)
    } else if (event.type === 'closed') {
      outcome.closed = true
    } else if (event.type === 'outdated') {
      outcome.outdated = true
      onRetract?.()
    } else if (event.type === 'applied') {
      showAiChange(event.touched)
      if (activity === 'apply') work('think')
      flashAiBuddy('applied')
    } else if (event.type === 'replies') {
      pending.before(aiReplies(event.replies))
    } else if (event.type === 'compacted') {
      const sent = $$<HTMLElement>('.ai-msg-user', log).at(-1)
      sent?.before(aiTemplate('compacted'))
    } else if (event.type === 'stopped') {
      outcome.stopped = true
      flashAiBuddy('stopped')
      if (event.retract) {
        outcome.retracted = true
        onRetract?.()
      } else {
        pending.before(aiTemplate('stopped'))
      }
    } else {
      panel.dataset.revision = event.revision
      paintAiUsage(panel, event.usage, event.hardOff)
      paintAiContext(panel, event.context)
    }
    scrollAiLog(following)
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
    failed = true
    flashAiBuddy('error')
  } finally {
    clearTimeout(thinkingTimer)
    clearTimeout(holdTimer)
    pending.remove()
    restAiBuddy(panel)
    if (answered && !failed && !outcome.confirmed && !outcome.stopped && outcome.errors.length === 0) flashAiBuddy('done')
    // 入力欄に移すのは、押した停止のボタンが隠れてフォーカスが消え、キーボードで続きを打てなくなるため
    const stopFocused = !!document.activeElement?.matches('[data-ai-stop]')
    panel.removeAttribute('data-busy')
    if (stopFocused) aiInput()?.focus()
    scrollAiLog()
  }
  return outcome
}

/** 作成中の応答を止める。サーバーが止めて保存し終えると、流れていた応答もそこで終わる */
// 押したボタンを disabled にしないのは、フォーカスが外れて、止めたあとに入力欄へ戻せなくなるため
async function stopAi() {
  if (aiStopping) return
  aiStopping = true
  try {
    const res = await fetch('/ai/chat/stop', { method: 'POST', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`status ${res.status}`)
    aiChannel.postMessage('changed')
    // 応答を流しているのがほかのタブなら取り直すのは、次の問い合わせまで、止めたのに作成中のまま見えるため
    if (!aiSending) await refreshAiPanel()
  } catch {
    toast('生成を停止できませんでした。', 'error')
  } finally {
    aiStopping = false
  }
}

function noteAiProblem(message: string) {
  aiPanel()?.querySelector('[data-ai-log]')?.append(aiTemplate('error', message))
  scrollAiLog(true)
}

// --- AI のパネルの発言に添える画像（components/ai-panel.tsx の data-ai-image。送るのは発言と同じ /ai/chat）
// 縮めずに送らないのは、Claude は長い辺が 1568px を超える画像を縮めてから読むので、大きいまま送っても見え方は変わらず、送る量と保存する会話が膨らむだけのため
const AI_IMAGE_MAX_EDGE = 1568
const AI_IMAGE_MAX_SIZE = 5 * 1024 * 1024
const AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
// 入力欄の下に置かないのは、パネルを取り直すと選んだ画像が消え、送る前に外されたように見えるため
let aiImage: { file: File; url: string } | null = null

const aiImageButton = () => aiPanel()?.querySelector<HTMLButtonElement>('button[data-ai-image]') ?? null

async function shrinkAiImage(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  const scale = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= AI_IMAGE_MAX_SIZE && AI_IMAGE_TYPES.includes(file.type)) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')!
  const render = (type: 'image/png' | 'image/jpeg') => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    // 透明なまま JPEG にしないのは、透明な部分が黒く塗られて読めなくなるため
    if (type === 'image/jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
  }
  // 画面の写しを JPEG にしないのは、文字のまわりがにじんで、AI が細かい文字を読み違えるため
  let blob = file.type === 'image/png' ? await render('image/png') : null
  if (!blob || blob.size > AI_IMAGE_MAX_SIZE) blob = await render('image/jpeg')
  bitmap.close()
  if (!blob || blob.size > AI_IMAGE_MAX_SIZE) return null
  const base = file.name.replace(/\.[^.]*$/, '') || 'image'
  return new File([blob], `${base}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type })
}

/** 送る前の画像を出し直す。パネルを取り直したあとにも呼ぶ */
function paintAiImage() {
  const chip = aiPanel()?.querySelector<HTMLElement>('[data-ai-attach]')
  const thumb = chip?.querySelector<HTMLImageElement>('[data-ai-attach-thumb]')
  const name = chip?.querySelector('[data-ai-attach-name]')
  if (!chip || !thumb || !name) return
  chip.hidden = !aiImage
  if (aiImage) thumb.src = aiImage.url
  else thumb.removeAttribute('src')
  name.textContent = aiImage?.file.name ?? ''
}

/** 送る前の画像を替える。sent は、外す画像を送った発言がまだ画面で使っていること */
function setAiImage(file: File | null, sent = false) {
  if (aiImage && !sent) URL.revokeObjectURL(aiImage.url)
  aiImage = file && { file, url: URL.createObjectURL(file) }
  paintAiImage()
}

// 1 回の発言に何枚も選ばせないのは、1 回に添えられるのは 1 枚までで、2 枚目を選んだら替えたいのだと分かるため
async function attachAiImage(file: File) {
  const button = aiImageButton()
  if (!button || button.hidden || button.disabled) return
  if (!file.type.startsWith('image/')) return toast('画像のファイルを選んでください。', 'error')
  const shrunk = await shrinkAiImage(file)
  if (!shrunk) return toast('この画像は読み込めません。PNG・JPEG・WebP・GIF の画像を選んでください。', 'error')
  setAiImage(shrunk)
  aiInput()?.focus()
}

/** 画像を添えた発言を送れたら、このチャットで添えられる残りの枚数を減らす */
function countAiImageSent() {
  const button = aiImageButton()
  if (!button) return
  const left = Math.max(0, Number(button.dataset.left ?? 0) - 1)
  button.dataset.left = String(left)
  button.disabled = left === 0
  button.setAttribute(
    'aria-label',
    left > 0 ? `画像を添える（このチャットであと ${left} 枚）` : `画像は 1 つのチャットで ${button.dataset.max ?? ''} 枚まで送れます`,
  )
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-attach-clear]')) {
    setAiImage(null)
    return aiInput()?.focus()
  }
  if (target.closest('button[data-ai-image]')) aiPanel()?.querySelector<HTMLInputElement>('[data-ai-image-input]')?.click()
})

document.addEventListener('change', (e) => {
  const input = e.target as Element
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-ai-image-input]')) return
  const file = input.files?.[0]
  input.value = ''
  if (file) void attachAiImage(file)
})

// 文字と画像の両方が入っていれば文字を貼るのは、表計算や文書の範囲を写すと、文字と一緒にその範囲の画像も入るため
document.addEventListener('paste', (e) => {
  const input = e.target as Element
  if (!(input instanceof HTMLTextAreaElement) || !input.matches('.ai-textarea') || !e.clipboardData) return
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
  if (!file || e.clipboardData.types.includes('text/plain')) return
  e.preventDefault()
  void attachAiImage(file)
})

// ファイルを選ぶカードの上では受けないのは、カードのファイルの選択（.file-drop-zone）に落としたファイルまで、発言に添えることになるため
const aiImageDropOf = (e: DragEvent) =>
  e.target instanceof Element && carriesFiles(e) && !dropZoneOf(e) ? e.target.closest<HTMLElement>('[data-ai-panel]') : null

document.addEventListener('dragover', (e) => {
  const panel = aiImageDropOf(e)
  if (!panel || aiImageButton()?.hidden !== false || aiImageButton()?.disabled) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  panel.toggleAttribute('data-dragging', true)
})
document.addEventListener('dragleave', (e) => {
  const panel = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-ai-panel]') : null
  // 子要素に入ったときに外さないのは、強調がちらつくため
  if (panel && !(e.relatedTarget instanceof Node && panel.contains(e.relatedTarget))) panel.removeAttribute('data-dragging')
})
document.addEventListener('drop', (e) => {
  const panel = aiImageDropOf(e)
  if (!panel) return
  e.preventDefault()
  panel.removeAttribute('data-dragging')
  const file = [...e.dataTransfer!.files].find((f) => f.type.startsWith('image/')) ?? e.dataTransfer!.files[0]
  if (file) void attachAiImage(file)
})

/**
 * 入力欄の発言を送る。パネルが古ければ取り直してから送り、開いていたチャットがほかのタブで閉じられていれば、
 * 同じモデル（model）の新しいチャットで送る。retried は、送ったときにパネルが古かったために送り直した 2 回目であること
 */
async function sendAiMessage(retried = false, model = aiPanel()?.dataset.model) {
  await refreshAiIfOutdated(model)
  const panel = aiPanel()
  const form = panel?.querySelector<HTMLFormElement>('[data-ai-form]')
  const log = panel?.querySelector<HTMLElement>('[data-ai-log]')
  const input = aiInput()
  if (!panel || !form || !log || !input) return
  const text = input.value.trim()
  if (!text) return
  const data = new FormData(form)
  const image = aiImage
  if (image) data.set('image', image.file)
  const intro = log.querySelector<HTMLElement>('[data-ai-intro]')
  const started = !panel.dataset.chat
  const dismissing = !!log.querySelector('.ai-card[data-state=pending]')
  const replies = $$<HTMLElement>('[data-ai-replies]', log)
  replies.forEach((el) => (el.hidden = true))
  const introMascot = intro && !intro.hidden ? aiMascotBox(intro) : null
  if (intro) intro.hidden = true
  const buddy = aiBuddy(panel)
  if (started && buddy) {
    showAiBuddy(panel, true)
    if (introMascot) flyAiBuddy(introMascot, buddy)
  }
  const sent = aiTemplate('user', text)
  const sentImage = sent.querySelector<HTMLAnchorElement>('[data-ai-image-link]')
  if (image && sentImage) {
    sentImage.href = image.url
    sentImage.querySelector('img')!.src = image.url
    sentImage.hidden = false
  }
  log.append(sent)
  input.value = ''
  fitAiInput(input)
  if (image) setAiImage(null, true)

  const outcome = await streamAi(form.action, data, {
    onRetract: () => {
      sent.remove()
      replies.forEach((el) => (el.hidden = false))
      if (intro && !log.querySelector('.ai-msg')) {
        const from = aiMascotBox(aiBuddy(panel))
        intro.hidden = false
        showAiBuddy(panel, false)
        const to = intro.querySelector<HTMLElement>('.mascot')
        if (from && to) flyAiBuddy(from, to)
      }
      if (!input.value) input.value = text
      fitAiInput(input)
      if (image && !aiImage) {
        aiImage = image
        paintAiImage()
      }
    },
    onChat: (id) => {
      const chatField = form.elements.namedItem('chat')
      if (chatField instanceof HTMLInputElement) chatField.value = String(id)
    },
  })
  if (image && !outcome.retracted && !outcome.outdated) countAiImageSent()
  if (outcome.outdated) {
    await refreshAiPanel(model)
    if (!retried) return sendAiMessage(true, model)
    return noteAiProblem('ほかのタブで会話が進んだため、送れませんでした。会話を確かめて、もう一度送信してください。')
  }
  // 新しく始めたチャットと確認カードを取り直すのは、ヘッダーのモデル名・「閉じる」ボタン・カードを、サーバーの描いたものにそろえるため
  if (outcome.closed || outcome.confirmed || dismissing || (started && panel.dataset.chat)) {
    await refreshAiPanel()
    // 取り直したパネルだけにしないのは、送り直してもらう発言はサーバーに残らず、断った理由まで消えるため
    if (outcome.retracted) {
      const next = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
      for (const message of outcome.errors) next?.append(aiTemplate('error', message))
      scrollAiLog(true)
    }
  }
}

async function decideAiCard(form: HTMLFormElement, submitter: HTMLElement | null) {
  const call = new FormData(form).get('call')
  const decision = submitter instanceof HTMLButtonElement ? submitter.value : ''
  const fileInput = form.matches('[data-ai-file]') ? form.querySelector<HTMLInputElement>('input[type=file]') : null
  const file = fileInput?.files?.[0]
  if (fileInput && decision === 'approve' && !file) {
    toast('送るファイルを選んでください。', 'error')
    return fileInput.focus()
  }
  if (await refreshAiIfOutdated()) {
    const next = $$<HTMLFormElement>('[data-ai-confirm]', aiPanel() ?? document).find((f) => new FormData(f).get('call') === call)
    // 取り直したパネルでカードが確認を待っていなければ送らないのは、ほかのタブで決めたカードを決め直さないため
    if (!next) return
    form = next
    submitter = $$<HTMLButtonElement>('button[name=decision]', next).find((b) => b.value === decision) ?? null
  }
  const data = new FormData(form, submitter)
  // 選んだファイルを添え直すのは、パネルを取り直すと、新しいカードのファイルの選択は空になっているため
  if (file && decision === 'approve') data.set('file', file)
  $$<HTMLButtonElement>('button', form).forEach((btn) => (btn.disabled = true))
  $$('[data-ai-replies]', aiPanel() ?? document).forEach((el) => el.remove())
  const outcome = await streamAi(form.action, data)
  await refreshAiPanel()
  // 取り直したパネルだけにしないのは、受け取れなかったファイルのカードは選ぶ前に戻り、断った理由まで消えるため
  if (outcome.retracted) for (const message of outcome.errors) noteAiProblem(message)
}

// --- AI の確認カードをまとめて承認する（components/ai-panel.tsx の data-ai-approve-all。承認するのは /ai/chat/confirm-all）
// カードの先頭と末尾を別々に見るのは、パネルより高いカードは一度に収まらず、末尾までスクロールして読み終えたことを見るため
type AiCardEdge = 'top' | 'bottom'
const AI_CARD_EDGES: Record<AiCardEdge, string> = { top: '.ai-card-title', bottom: '.ai-card-actions' }
// 取り直しのたびに忘れないのは、応答のあとや、ほかのタブの発言でパネルを取り直しても、一度見たカードは見たままにするため
const aiCardEdgesSeen = new Map<string, Set<AiCardEdge>>()
let aiCardObserver: IntersectionObserver | null = null

const aiCardKey = (callId: string) => `${aiPanel()?.dataset.chat ?? ''}:${callId}`
const aiCardSeen = (callId: string) => aiCardEdgesSeen.get(aiCardKey(callId))?.size === Object.keys(AI_CARD_EDGES).length
const aiApproveAllForm = () => aiPanel()?.querySelector<HTMLFormElement>('[data-ai-approve-all]') ?? null
const aiApproveCalls = (form: HTMLFormElement) => new FormData(form).getAll('call[]').map(String)

function paintAiApproveAll() {
  const form = aiApproveAllForm()
  if (!form) return
  const unseen = aiApproveCalls(form).filter((call) => !aiCardSeen(call)).length
  if (form.dataset.unseen === String(unseen)) return
  const nextFocused = document.activeElement?.matches('[data-ai-approve-next]')
  form.dataset.unseen = String(unseen)
  const count = form.querySelector('[data-ai-unseen]')
  if (count) count.textContent = String(unseen)
  // 承認のボタンに移すのは、押していた「次の提案を見る」が隠れてフォーカスが消え、キーボードで続けられなくなるため
  if (nextFocused && unseen === 0) form.querySelector<HTMLButtonElement>('button[type=submit]')?.focus()
}

// パネルを開いたときにも呼ぶのは、閉じているあいだはカードを見たことにせず、開いた時点で見えているカードを数え直すため
function watchAiCards() {
  aiCardObserver?.disconnect()
  aiCardObserver = null
  const log = aiPanel()?.querySelector<HTMLElement>('[data-ai-log]')
  const cards = log ? $$<HTMLElement>('.ai-card[data-ai-card]', log) : []
  if (!log || !aiApproveAllForm() || cards.length === 0) return
  aiCardObserver = new IntersectionObserver(
    (entries) => {
      if (document.hidden || !document.documentElement.hasAttribute('data-ai-open')) return
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const callId = target.closest<HTMLElement>('[data-ai-card]')?.dataset.aiCard
        const edge = target.dataset.aiCardEdge as AiCardEdge | undefined
        if (!entry.isIntersecting || !callId || !edge) continue
        const key = aiCardKey(callId)
        aiCardEdgesSeen.set(key, (aiCardEdgesSeen.get(key) ?? new Set()).add(edge))
      }
      paintAiApproveAll()
    },
    { root: log, threshold: 0.9 },
  )
  for (const card of cards)
    for (const [edge, selector] of Object.entries(AI_CARD_EDGES)) {
      const target = card.querySelector<HTMLElement>(selector)
      if (!target) continue
      target.dataset.aiCardEdge = edge
      aiCardObserver.observe(target)
    }
  paintAiApproveAll()
}

/** まだ見ていない最初のカードへスクロールする。先頭を見たカードなら、残りの末尾までを見せる */
function showNextAiCard() {
  const panel = aiPanel()
  const form = aiApproveAllForm()
  if (!panel || !form) return
  const call = aiApproveCalls(form).find((c) => !aiCardSeen(c))
  const card = call ? $$<HTMLElement>('.ai-card[data-ai-card]', panel).find((el) => el.dataset.aiCard === call) : undefined
  if (!call || !card) return
  const topSeen = aiCardEdgesSeen.get(aiCardKey(call))?.has('top')
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  const target = (topSeen && card.querySelector<HTMLElement>(AI_CARD_EDGES.bottom)) || card
  target.scrollIntoView({ behavior, block: topSeen ? 'end' : 'start' })
  card.classList.remove('is-unseen-target')
  void card.offsetWidth
  card.classList.add('is-unseen-target')
  card.addEventListener('animationend', () => card.classList.remove('is-unseen-target'), { once: true })
}

/** 画面で見た確認カードをまとめて承認する。ほかのタブで決まったカードや、まだ見ていないカードがあれば送らない */
async function approveAllAiCards(form: HTMLFormElement) {
  const calls = aiApproveCalls(form)
  if (await refreshAiIfOutdated()) {
    const next = aiApproveAllForm()
    const pending = new Set(next ? aiApproveCalls(next) : [])
    // 取り直したパネルで残りだけを承認しないのは、ほかのタブで取り消したカードがあると、それを踏まえて決め直したいかもしれないため
    if (!next || !calls.every((call) => pending.has(call))) return
    form = next
  }
  if (calls.some((call) => !aiCardSeen(call))) return paintAiApproveAll()
  const data = new FormData(form)
  data.delete('call[]')
  for (const call of calls) data.append('call[]', call)
  const panel = aiPanel() ?? document
  $$<HTMLButtonElement>('[data-ai-confirm] button, [data-ai-approve-all] button', panel).forEach((btn) => (btn.disabled = true))
  $$('[data-ai-replies]', panel).forEach((el) => el.remove())
  await streamAi(form.action, data)
  await refreshAiPanel()
}

const AI_CLOSE_ARMED_MS = 3000
let aiCloseTimer = 0

function setAiCloseArmed(form: HTMLFormElement, armed: boolean) {
  const arm = form.querySelector<HTMLButtonElement>('[data-ai-close-arm]')
  const armedButton = form.querySelector<HTMLButtonElement>('[data-ai-close-armed]')
  if (!arm || !armedButton) return
  const refocus = document.activeElement === (armed ? arm : armedButton)
  arm.hidden = armed
  armedButton.hidden = !armed
  if (refocus) (armed ? armedButton : arm).focus()
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  // ダブルクリックの 2 回目で閉じないのは、1 回押したつもりの人の会話まで消えるため
  if (e.detail > 1 && target.closest('[data-ai-close-armed]')) return e.preventDefault()
  const form = target.closest<HTMLButtonElement>('[data-ai-close-arm]')?.form
  if (!form) return
  setAiCloseArmed(form, true)
  window.clearTimeout(aiCloseTimer)
  aiCloseTimer = window.setTimeout(() => setAiCloseArmed(form, false), AI_CLOSE_ARMED_MS)
})

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  if (e.defaultPrevented || !form.matches('[data-ai-form], [data-ai-close], [data-ai-confirm], [data-ai-approve-all]')) return
  e.preventDefault()
  if (form.matches('[data-ai-approve-all]')) return void runAiTask(() => approveAllAiCards(form))
  if (aiVoice && form.matches('[data-ai-form]')) return void finishAiVoice()
  if (form.matches('[data-ai-form], [data-ai-confirm]')) {
    const submitter = e.submitter
    void runAiTask(() => (form.matches('[data-ai-form]') ? sendAiMessage() : decideAiCard(form, submitter)))
    return
  }
  window.clearTimeout(aiCloseTimer)
  fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`)
      aiChannel.postMessage('changed')
      return refreshAiPanel()
    })
    .then(() => aiDocked() && aiInput()?.focus())
    .catch(() => {
      setAiCloseArmed(form, false)
      toast('チャットを閉じられませんでした。', 'error')
    })
})

async function runAiTask(task: () => Promise<void>) {
  if (aiSending) return
  aiSending = true
  try {
    // 問い合わせ中の取り直しを待たずに送らないのは、送っているあいだにパネルが差し替わり、流れてくる応答が画面から消えるため
    await aiSync
    await task()
  } finally {
    aiSending = false
    aiChannel.postMessage('changed')
    scheduleAiSync()
  }
}

function initAiPanel() {
  const panel = aiPanel()
  // 画面を移るたびに合わせ直さないのは、パネルは移っても残る（data-keep）ので、応答を作っている最中の動きを最初の状態に戻してしまうため
  if (panel && !aiBuddyReady) {
    aiBuddyReady = true
    settleAiBuddy(panel)
  }
  const open = document.documentElement.hasAttribute('data-ai-open')
  $$('.ai-panel-toggle').forEach((el) => el.setAttribute('aria-expanded', String(open)))
  showAiVoice()
  void fillAiSuggestions()
  watchAiCards()
  scheduleAiSync()
}

// --- コーディング問題の編集画面から、そのアイテムを選んだ新しいチャットを始める（components/code.tsx の CodeAiHelp）
type AiFocusStart = { focus: string; title: string; href: string; message: string }

/** 新しいチャットで選ぶアイテムの欄。チャットがあるときは描かれない */
const aiFocusField = (panel: HTMLElement) => panel.querySelector<HTMLInputElement>('[data-ai-form] input[name="focus"]')

function setAiFocus(start: AiFocusStart | null) {
  const panel = aiPanel()
  const field = panel && aiFocusField(panel)
  const chip = panel?.querySelector<HTMLElement>('[data-ai-focus]')
  const title = chip?.querySelector<HTMLAnchorElement>('[data-ai-focus-title]')
  if (!field || !chip || !title) return false
  field.value = start?.focus ?? ''
  title.textContent = start?.title ?? ''
  title.href = start?.href ?? '#'
  chip.hidden = !start
  return true
}

const clearAiFocus = () => void setAiFocus(null)

const AI_UNSAVED_CONFIRM = '保存していない変更があります。AI は保存した内容を読むので、先に保存しておくと確実です。'
const AI_RESTART_CONFIRM = '今のチャットを閉じて、このコーディング問題の新しいチャットを始めます。閉じた会話は開き直せません。'

/** パネルを開き、今のチャットを閉じてから、ボタンのアイテムを選んだ新しいチャットで最初の発言を送る */
async function startAiFocus(button: HTMLElement) {
  const start = JSON.parse(button.dataset.aiFocusStart ?? 'null') as AiFocusStart | null
  if (!start || !aiPanel() || aiSending) return
  const form = button.closest('form')
  const drawn = form?.id ? liveBase[0]?.querySelector<HTMLFormElement>(`form#${CSS.escape(form.id)}`) : null
  const unsaved = !!form && !!drawn && formValues(form) !== formValues(drawn)
  await refreshAiIfOutdated()
  const chatId = aiPanel()?.dataset.chat
  const notes = [...(unsaved ? [AI_UNSAVED_CONFIRM] : []), ...(chatId ? [AI_RESTART_CONFIRM] : [])]
  if (notes.length > 0 && !(await confirmNear(button, notes, { ok: '始める', tone: 'primary' }))) return
  await runAiTask(async () => {
    if (chatId) {
      const body = new FormData()
      body.set('chat', chatId)
      const res = await fetch('/ai/chat/close', { method: 'POST', body, headers: { Accept: 'application/json' } }).catch(() => null)
      if (!res?.ok) return toast('チャットを閉じられませんでした。', 'error')
      await refreshAiPanel()
    }
    if (!document.documentElement.hasAttribute('data-ai-open')) setAiOpen(true)
    const input = aiInput()
    if (!input || input.disabled) return toast('今は AI を使えません。', 'error')
    if (!setAiFocus(start)) return
    // 「難しい依頼」を外すのは、Sonnet では続きの依頼のボタンが出ず、質問に答える候補を出せないため
    const composer = input.form
    composer?.querySelector('[data-ai-hard]')?.setAttribute('aria-pressed', 'false')
    if (composer) syncAiModel(composer)
    input.value = start.message
    fitAiInput(input)
    await sendAiMessage()
  })
}

// --- AI のパネルの最初の候補（components/ai-panel.tsx の data-ai-suggestions。作るのは /ai/suggestions）
const AI_SUGGESTION_SLOTS = 3
// 画面ごとに覚えておくのは、同じ画面に戻るたびにサーバーへ問い合わせて、読み込み中の表示を挟まないため
const aiSuggestionCache = new Map<string, string[]>()
const aiSuggesting = new Set<string>()

const aiSuggestionBox = () => aiPanel()?.querySelector<HTMLElement>('[data-ai-suggestions]') ?? null

function paintAiSuggestions(box: HTMLElement, page: string, suggestions: string[]) {
  box.replaceChildren(
    ...suggestions.map((text) => {
      const button = aiTemplate('suggestion', text)
      button.dataset.aiSuggest = text
      return button
    }),
  )
  box.dataset.page = page
  box.removeAttribute('aria-busy')
}

// パネルを閉じているあいだに取りに行かないのは、開かない画面のために AI に候補を作らせることになるため
async function fillAiSuggestions() {
  const box = aiSuggestionBox()
  const page = location.pathname
  if (!box || box.dataset.page === page || !document.documentElement.hasAttribute('data-ai-open')) return
  const known = aiSuggestionCache.get(page)
  if (known) return paintAiSuggestions(box, page, known)
  if (!box.hasAttribute('aria-busy')) {
    box.replaceChildren(...Array.from({ length: AI_SUGGESTION_SLOTS }, () => aiTemplate('suggestion-loading')))
    box.setAttribute('aria-busy', 'true')
  }
  if (aiSuggesting.has(page)) return
  aiSuggesting.add(page)
  let suggestions: string[] | null = null
  try {
    const res = await fetch(`/ai/suggestions?${new URLSearchParams({ page })}`, { headers: { Accept: 'application/json' } })
    // 開けない画面（404）を失敗として取り直さないのは、パネルを開き直すたびに、候補を見せない画面へ問い合わせ直すことになるため
    if (res.status === 404) suggestions = []
    else if (res.ok) suggestions = ((await res.json()) as { suggestions: string[] }).suggestions
  } catch {
    // 失敗を知らせないのは、候補が出ないだけで、入力欄からは頼めるため
  } finally {
    aiSuggesting.delete(page)
  }
  if (suggestions) aiSuggestionCache.set(page, suggestions)
  const current = aiSuggestionBox()
  if (!current || location.pathname !== page) return
  if (suggestions) return paintAiSuggestions(current, page, suggestions)
  // 失敗したときに data-page を付けないのは、次にパネルを開いたときに取り直すため
  current.replaceChildren()
  current.removeAttribute('aria-busy')
}

// --- AI のパネルの音声入力（components/ai-panel.tsx の data-ai-voice。文字起こしは /ai/voice）
// 録った音声を区切って送らないのは、MediaRecorder の 2 つ目以降の断片はヘッダーがなく単独では読めず、
// 区切りで言葉が切れて起こし間違えるため。録り始めからの音声を毎回まとめて送り、返った文字で置き換える
type AiVoice = {
  state: 'recording' | 'finishing'
  recorder: MediaRecorder
  stream: MediaStream
  audio: AudioContext
  chunks: Blob[]
  /** 録り始めたときに入力欄にあった文。送るときは、この後ろに文字にした音声を続ける */
  base: string
  /** 最後に返った途中の文字起こし */
  text: string
  /** 途中の文字起こしに最後に送った時点の chunks の数 */
  sent: number
  /** 声らしい大きさの音を一度でも拾ったか */
  heard: boolean
  startedAt: number
  /** 1 回に録れる長さ（ミリ秒）と、文字にできる長さ（components/ai-panel.tsx の data-max-seconds / data-max-chars） */
  maxMs: number
  maxChars: number
  timer: number
  limitTimer: number
  frame: number
  inflight: AbortController | null
}

let aiVoice: AiVoice | null = null
const AI_VOICE_SLICE = 250
const AI_VOICE_INTERVAL = 1200
// 短すぎる音声を送らないのは、Whisper が 1 秒に満たない音声から、話していない言葉を作ることがあるため
const AI_VOICE_MIN_MS = 1000
const AI_VOICE_HEARD_LEVEL = 0.02
// 残りがこれを切ったら時間と文字数の色を変えるのは、急に止まって送られる前に、話をまとめられるようにするため
const AI_VOICE_NEAR_MS = 10_000
const AI_VOICE_NEAR_CHARS = 0.9
// Safari は webm を録れないので mp4 を、Firefox は ogg も録れるので最後の候補に入れる
const AI_VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

const aiVoiceSupported = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
const aiVoiceButton = () => aiPanel()?.querySelector<HTMLButtonElement>('[data-ai-voice]') ?? null

function showAiVoice() {
  const button = aiVoiceButton()
  if (button) button.hidden = !aiVoiceSupported()
}

/** 入力欄の下の、録音した時間と文字数 */
function paintAiVoiceStatus(voice: AiVoice | null) {
  const panel = aiPanel()
  const time = panel?.querySelector<HTMLElement>('[data-ai-voice-time]')
  const chars = panel?.querySelector<HTMLElement>('[data-ai-voice-chars]')
  const elapsed = voice ? Date.now() - voice.startedAt : 0
  if (time) {
    time.textContent = formatClock(elapsed / 1000)
    time.toggleAttribute('data-near', !!voice && voice.maxMs - elapsed <= AI_VOICE_NEAR_MS)
  }
  if (chars) {
    chars.textContent = String(voice?.text.length ?? 0)
    chars.toggleAttribute('data-near', !!voice && voice.text.length >= voice.maxChars * AI_VOICE_NEAR_CHARS)
  }
}

function paintAiVoice(voice: AiVoice | null) {
  const box = aiPanel()?.querySelector<HTMLElement>('.ai-input')
  const button = aiVoiceButton()
  if (!box || !button) return
  paintAiVoiceStatus(voice)
  if (!voice) {
    box.removeAttribute('data-voice')
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', '音声で入力')
    button.title = '音声で入力'
    button.disabled = false
    button.style.removeProperty('--ai-level')
    return
  }
  box.dataset.voice = voice.state
  const label = voice.state === 'finishing' ? '文字にしています' : '話し終えて送信'
  button.setAttribute('aria-pressed', 'true')
  button.setAttribute('aria-label', label)
  button.title = label
  button.disabled = voice.state === 'finishing'
  const base = box.querySelector('[data-ai-ghost-base]')
  const text = box.querySelector('[data-ai-ghost-text]')
  if (base) base.textContent = voice.base
  if (text) text.textContent = voice.text
  const ghost = box.querySelector<HTMLElement>('[data-ai-ghost]')
  if (ghost) ghost.scrollTop = ghost.scrollHeight
}

/** 音の大きさを録音ボタンの輪に出し、声らしい音を拾ったかを覚える */
function meterAiVoice(voice: AiVoice) {
  const analyser = voice.audio.createAnalyser()
  analyser.fftSize = 1024
  voice.audio.createMediaStreamSource(voice.stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const tick = () => {
    if (aiVoice !== voice || voice.state !== 'recording') return
    analyser.getFloatTimeDomainData(samples)
    const level = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)
    if (level >= AI_VOICE_HEARD_LEVEL) voice.heard = true
    aiVoiceButton()?.style.setProperty('--ai-level', String(Math.min(1, level * 8)))
    paintAiVoiceStatus(voice)
    voice.frame = requestAnimationFrame(tick)
  }
  voice.frame = requestAnimationFrame(tick)
}

async function transcribeAiVoice(voice: AiVoice, signal?: AbortSignal) {
  const data = new FormData()
  data.set('audio', new Blob(voice.chunks, { type: voice.recorder.mimeType || voice.chunks[0]?.type }), 'voice')
  const res = await fetch('/ai/voice', { method: 'POST', body: data, headers: { Accept: 'application/json' }, signal })
  const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null
  if (!res.ok || typeof body?.text !== 'string')
    throw new Error(typeof body?.error === 'string' ? body.error : '音声を文字にできませんでした。')
  return body.text
}

// 前の問い合わせが返る前に次を送らないのは、遅れて返った古い結果で、新しい結果を上書きしてしまうため
function scheduleAiVoice(voice: AiVoice) {
  voice.timer = window.setTimeout(async () => {
    const ready = voice.heard && voice.chunks.length > voice.sent && Date.now() - voice.startedAt >= AI_VOICE_MIN_MS
    if (ready) {
      voice.sent = voice.chunks.length
      const controller = new AbortController()
      voice.inflight = controller
      try {
        const text = await transcribeAiVoice(voice, controller.signal)
        if (aiVoice === voice && voice.state === 'recording') {
          voice.text = text
          paintAiVoice(voice)
          if (text.length >= voice.maxChars) void finishAiVoice(`音声入力は 1 回 ${voice.maxChars} 文字までのため、ここまでを送信します。`)
        }
      } catch {
        // 途中の失敗を知らせないのは、話し終えたときにまとめて送り直し、そこで失敗したときだけ伝えれば足りるため
      } finally {
        if (voice.inflight === controller) voice.inflight = null
      }
    }
    if (aiVoice === voice && voice.state === 'recording') scheduleAiVoice(voice)
  }, AI_VOICE_INTERVAL)
}

async function startAiVoice(button: HTMLButtonElement) {
  if (aiVoice || !aiVoiceSupported()) return
  const input = aiInput()
  if (!input) return
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    return toast(denied ? 'マイクの使用が許可されていません。ブラウザの設定で許可してください。' : 'マイクを使えませんでした。', 'error')
  }
  if (aiVoice) return stream.getTracks().forEach((t) => t.stop())
  const type = AI_VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const voice: AiVoice = {
    state: 'recording',
    recorder,
    stream,
    audio: new AudioContext(),
    chunks: [],
    base: input.value.trim(),
    text: '',
    sent: 0,
    heard: false,
    startedAt: Date.now(),
    maxMs: Number(button.dataset.maxSeconds) * 1000,
    maxChars: Number(button.dataset.maxChars),
    timer: 0,
    limitTimer: 0,
    frame: 0,
    inflight: null,
  }
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) voice.chunks.push(e.data)
  })
  recorder.start(AI_VOICE_SLICE)
  aiVoice = voice
  meterAiVoice(voice)
  scheduleAiVoice(voice)
  voice.limitTimer = window.setTimeout(
    () => void finishAiVoice(`音声入力は 1 回 ${voice.maxMs / 1000} 秒までのため、ここまでを送信します。`),
    voice.maxMs,
  )
  paintAiVoice(voice)
}

/** 録音を止めてマイクを手放す。最後の断片（dataavailable）は stop の前に届く */
async function releaseAiVoice(voice: AiVoice) {
  clearTimeout(voice.timer)
  clearTimeout(voice.limitTimer)
  cancelAnimationFrame(voice.frame)
  voice.inflight?.abort()
  if (voice.recorder.state !== 'inactive') {
    const stopped = new Promise((resolve) => voice.recorder.addEventListener('stop', resolve, { once: true }))
    voice.recorder.stop()
    await stopped
  }
  voice.stream.getTracks().forEach((t) => t.stop())
  void voice.audio.close()
}

function endAiVoice(voice: AiVoice) {
  if (aiVoice !== voice) return
  aiVoice = null
  paintAiVoice(null)
  if (aiDocked()) aiInput()?.focus()
  scheduleAiSync()
}

function cancelAiVoice() {
  const voice = aiVoice
  if (!voice) return
  endAiVoice(voice)
  void releaseAiVoice(voice)
}

const joinAiVoice = (base: string, text: string) => (base && text ? `${base} ${text}` : base || text)

/**
 * 話し終えた音声をまとめて文字にし、入力欄にあった文に続けてそのまま送る。失敗したら、途中までの文字を入力欄に残す。
 * limit は、1 回の上限に届いて止めたときに知らせる文言
 */
async function finishAiVoice(limit?: string) {
  const voice = aiVoice
  if (!voice || voice.state !== 'recording') return
  if (limit) toast(limit, 'info')
  voice.state = 'finishing'
  paintAiVoice(voice)
  await releaseAiVoice(voice)
  if (aiVoice !== voice) return
  let text = ''
  let problem = ''
  try {
    text = voice.heard && voice.chunks.length > 0 ? (await transcribeAiVoice(voice)).trim() : ''
    if (!text) problem = '声を聞き取れませんでした。もう一度お試しください。'
  } catch (e) {
    problem = e instanceof Error ? e.message : '音声を文字にできませんでした。'
  }
  if (aiVoice !== voice) return
  endAiVoice(voice)
  const input = aiInput()
  if (!input) return
  input.value = joinAiVoice(voice.base, problem ? voice.text : text)
  fitAiInput(input)
  if (problem) return toast(problem, 'error')
  input.form?.requestSubmit()
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  if (target.closest('[data-ai-voice-cancel]')) return cancelAiVoice()
  const button = target.closest<HTMLButtonElement>('[data-ai-voice]')
  if (!button || button.disabled) return
  if (aiVoice) return void finishAiVoice()
  void startAiVoice(button)
})

// --- AI が変えたところを、開いている画面にすぐ反映して強調する（lib/ai-tool-kit.ts の AiTouched）
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
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
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
  const workspace = watched.find((el) => el.matches('[data-code-workspace]'))
  if (workspace) void codeEditor?.then(({ reloadCodeWorkspace }) => reloadCodeWorkspace(workspace))
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
// --- コーディングエージェントのモデルの選択（components/agent.tsx の AgentModelPicker）
function agentModelOfRow(row: HTMLElement): AgentModel | null {
  const id = row.dataset.agentModel ?? ''
  if (isAgentClaudeModel(id)) return { provider: 'anthropic', id }
  const num = (v: string | undefined) => (v ? Number(v) : NaN)
  const [contextLength, prompt, completion] = [num(row.dataset.ctx), num(row.dataset.in), num(row.dataset.out)]
  if (!id || [contextLength, prompt, completion].some(Number.isNaN)) return null
  const maxOutput = row.dataset.max ? Number(row.dataset.max) : null
  return { provider: 'openrouter', id, name: row.dataset.name ?? id, contextLength, maxOutput, prompt, completion, tools: true }
}

function filterAgentModels(search: HTMLInputElement) {
  const picker = search.closest<HTMLElement>('[data-agent-models]')
  if (!picker) return
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  let shown = 0
  let group: HTMLElement | null = null
  let groupShown = 0
  const closeGroup = () => {
    if (!group) return
    group.hidden = groupShown === 0
    const count = group.querySelector('[data-agent-model-count]')
    if (count) count.textContent = `${groupShown} 件`
  }
  for (const el of $$<HTMLElement>('.agent-models-group, [data-agent-model]', picker)) {
    if (el.matches('.agent-models-group')) {
      closeGroup()
      group = el
      groupShown = 0
      continue
    }
    const hit = terms.every((t) => el.dataset.searchText?.includes(t))
    el.hidden = !hit
    if (hit) {
      shown++
      groupShown++
    }
  }
  closeGroup()
  const empty = picker.querySelector<HTMLElement>('[data-agent-model-empty]')
  if (empty) empty.hidden = shown > 0
  hideAgentModelTip(picker)
}

function showAgentModelTip(row: HTMLElement) {
  const picker = row.closest<HTMLElement>('[data-agent-models]')
  const tip = picker?.querySelector<HTMLElement>('[data-agent-model-tip]')
  const model = agentModelOfRow(row)
  if (!picker || !tip || !model) return
  const name = document.createElement('p')
  name.className = 'agent-model-tip-name'
  name.textContent = row.querySelector('.agent-model-name')?.textContent ?? model.id
  const facts = document.createElement('dl')
  for (const [term, value] of agentModelFacts(model)) {
    const dt = document.createElement('dt')
    dt.textContent = term
    const dd = document.createElement('dd')
    dd.textContent = value
    facts.append(dt, dd)
  }
  tip.replaceChildren(name, facts)
  tip.hidden = false
  // 一覧の外に置いて位置を測るのは、一覧の中に置くと、スクロールする一覧の縁で切れるため
  const box = picker.getBoundingClientRect()
  const at = row.getBoundingClientRect()
  const below = at.bottom + 6 + tip.offsetHeight <= window.innerHeight
  tip.style.top = `${(below ? at.bottom + 6 : at.top - 6 - tip.offsetHeight) - box.top}px`
  tip.classList.toggle('is-above', !below)
  row.querySelector('input')?.setAttribute('aria-describedby', tip.id)
}

function hideAgentModelTip(root: ParentNode) {
  const tip = root.querySelector<HTMLElement>('[data-agent-model-tip]')
  if (tip) tip.hidden = true
  $$('[data-agent-model] input[aria-describedby]', root).forEach((el) => el.removeAttribute('aria-describedby'))
}

document.addEventListener('input', (e) => {
  const search = (e.target as Element).closest<HTMLInputElement>('[data-agent-model-search]')
  if (search) filterAgentModels(search)
})
document.addEventListener('keydown', (e) => {
  // Enter で保存のフォームを送らないのは、検索のつもりで押しただけで、ほかの欄の書きかけごと保存されるため
  if (e.key === 'Enter' && (e.target as Element).closest?.('[data-agent-model-search]')) e.preventDefault()
})
document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const row = input.closest<HTMLElement>('[data-agent-model]')
  const current = row?.closest('[data-agent-models]')?.querySelector('[data-agent-model-current]')
  if (row && current) current.textContent = row.querySelector('.agent-model-name')?.textContent ?? input.value
})
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  if (row) showAgentModelTip(row)
})
document.addEventListener('pointerout', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  const picker = row?.closest<HTMLElement>('[data-agent-models]')
  if (picker && !row!.contains(e.relatedTarget as Node | null)) hideAgentModelTip(picker)
})
document.addEventListener('focusin', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('[data-agent-model]')
  if (row) showAgentModelTip(row)
})
document.addEventListener('focusout', (e) => {
  const picker = (e.target as Element).closest<HTMLElement>('[data-agent-model]')?.closest<HTMLElement>('[data-agent-models]')
  if (picker) hideAgentModelTip(picker)
})
document.addEventListener(
  'scroll',
  (e) => {
    const list = e.target instanceof Element && e.target.closest<HTMLElement>('[data-agent-models]')
    if (list) hideAgentModelTip(list)
  },
  true,
)

// 行の scrollIntoView を使わないのは、一覧だけでなくページまでスクロールして、編集画面を開いた位置がずれるため
/** 選んでいるモデルが見えるように、一覧をスクロールしておく */
function initAgentModelPickers() {
  for (const list of $$<HTMLElement>('.agent-models-list')) {
    const checked = list.querySelector<HTMLElement>('[data-agent-model]:has(input:checked)')
    if (checked && checked.offsetTop + checked.offsetHeight > list.clientHeight) list.scrollTop = checked.offsetTop - list.clientHeight / 3
  }
}

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
