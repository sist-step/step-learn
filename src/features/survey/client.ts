/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { SURVEY_KEY_SLOT } from './survey'
import { toast } from '../../client/core'
import { $$ } from '../../client/dom'

// --- アンケートの問いの編集（features/survey/components/survey.tsx の SurveyEditor）
// 入力の検証より前に置くのは、検証が読む survey_questions を、送信と入力のたびに先に組み立て直すため
let svCount = 0

const svControl = <T extends HTMLElement>(row: HTMLElement, field: string) =>
  row.querySelector<T>(`[name="${CSS.escape(`${row.dataset.svKey}.${field}`)}"]`)

const svValue = (row: HTMLElement, field: string) => svControl<HTMLInputElement>(row, field)?.value ?? ''

const svReadQuestion = (row: HTMLElement) => ({
  k: row.dataset.svKey,
  kind: row.dataset.svQuestion,
  prompt: svValue(row, 'prompt'),
  required: !!svControl<HTMLInputElement>(row, 'required')?.checked,
  options: svValue(row, 'options'),
  points: svValue(row, 'points'),
  minLabel: svValue(row, 'minLabel'),
  maxLabel: svValue(row, 'maxLabel'),
})

function svSync(editor: HTMLElement) {
  const value = editor.querySelector<HTMLInputElement>('[data-sv-value]')
  if (value) value.value = JSON.stringify($$<HTMLElement>('[data-sv-question]', editor).map(svReadQuestion))
}

document.addEventListener('click', (e) => {
  const target = e.target as Element
  const editor = target.closest<HTMLElement>('[data-sv]')
  if (!editor) return
  const row = target.closest<HTMLElement>('[data-sv-question]')
  const add = target.closest<HTMLElement>('[data-sv-add]')
  const move = target.closest<HTMLElement>('[data-sv-move]')
  if (add) {
    const template = editor.querySelector<HTMLTemplateElement>(`template[data-sv-template="${add.dataset.svAdd}"]`)
    const list = editor.querySelector<HTMLElement>('[data-sv-list]')
    if (!template || !list) return
    list.insertAdjacentHTML('beforeend', template.innerHTML.replaceAll(SURVEY_KEY_SLOT, `q${Date.now().toString(36)}${svCount++}`))
    const added = list.lastElementChild as HTMLElement
    added.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    added.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  } else if (row && target.closest('[data-sv-remove]')) {
    const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null
    row.remove()
    ;(next?.querySelector<HTMLElement>('textarea') ?? editor.querySelector<HTMLElement>('[data-sv-add]'))?.focus()
  } else if (row && move) {
    const up = move.dataset.svMove === 'up'
    const other = up ? row.previousElementSibling : row.nextElementSibling
    if (!other) return
    other[up ? 'before' : 'after'](row)
    // 端まで動かすとボタンが隠れるので、反対向きのボタンへ移して、キーボードで続けて動かせるようにする
    const again = row.querySelector<HTMLElement>(`[data-sv-move="${move.dataset.svMove}"]`)
    const back = row.querySelector<HTMLElement>(`[data-sv-move="${up ? 'down' : 'up'}"]`)
    ;((up ? row.previousElementSibling : row.nextElementSibling) ? again : back)?.focus()
  } else return
  svSync(editor)
})

const svOnEdit = (e: Event) => {
  const editor = (e.target as Element).closest<HTMLElement>('[data-sv]')
  if (editor) svSync(editor)
}
document.addEventListener('input', svOnEdit, true)
document.addEventListener('change', svOnEdit, true)
document.addEventListener('submit', (e) => $$<HTMLElement>('[data-sv]', e.target as HTMLFormElement).forEach(svSync), true)

// --- アンケートに答える（SurveyPanel）: 必ず答えてもらう問いが空なら、送る前に止める
const svAnswered = (question: HTMLElement) =>
  !!question.querySelector('input:is([type="radio"], [type="checkbox"]):checked') ||
  !!question.querySelector<HTMLTextAreaElement>('textarea')?.value.trim()

document.addEventListener(
  'submit',
  (e) => {
    const form = e.target as HTMLFormElement
    if (!form.matches('[data-sv-form]')) return
    const questions = $$<HTMLElement>('[data-sv-answer]', form)
    const missing = questions.filter((q) => q.hasAttribute('data-sv-required') && !svAnswered(q))
    questions.forEach((q) => q.classList.toggle('is-missing', missing.includes(q)))
    if (missing.length === 0) return
    // 送信の処理（再読み込みなしの遷移）より先に止めるため、捕捉の段階で伝わるのを止める
    e.preventDefault()
    e.stopImmediatePropagation()
    toast(`まだ答えていない必須の問いが ${missing.length} つあります。`, 'error')
    missing[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    missing[0].querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true })
  },
  true,
)

document.addEventListener('input', (e) => (e.target as Element).closest('[data-sv-answer].is-missing')?.classList.remove('is-missing'))
document.addEventListener('change', (e) => (e.target as Element).closest('[data-sv-answer].is-missing')?.classList.remove('is-missing'))
