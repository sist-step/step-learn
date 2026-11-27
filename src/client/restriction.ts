/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { showsEach, type RestrictionOp } from '../lib/restriction'
import { $$ } from './dom'

// --- アクセス制限の条件の編集（components/restriction.tsx の RestrictionEditor）
// 入力の検証より前に置くのは、検証が読む availability を、送信と入力のたびに先に組み立て直すため
const RS_FIELDS: Record<string, string[]> = {
  date: ['d', 't'],
  completion: ['cm', 'e'],
  grade: ['id', 'min', 'max'],
  profile: ['field', 'op', 'v'],
  group: ['id'],
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

export const initRestrictionEditors = () => $$<HTMLElement>('[data-rs-node="completion"]').forEach(rsApplyPassFail)

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
