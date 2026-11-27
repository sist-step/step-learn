/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { checkNames, checkPrefix, checkRoom, parseNames, serialUsername } from './user-batch'
import { normalizeUsername } from '../../lib/username'
import { $$, fetchJson } from '../../client/dom'

// --- ユーザーの一括作成: 作るユーザー名の見本（features/admin/views.tsx の BulkUsersPage）
const nextSerials = new Map<string, Promise<number | null>>()

function nextSerialOf(url: string, prefix: string) {
  let next = nextSerials.get(prefix)
  if (!next) {
    next = fetchJson(`${url}?${new URLSearchParams({ prefix })}`)
      .then((res) => (res.ok ? res.json() : { next: null }))
      .then((body: { next: number | null }) => body.next)
      .catch(() => null)
      .then((n) => {
        // 失敗を覚えておかないのは、通信が戻ったあとに打ち直しても見本が出ないままになるため
        if (n === null) nextSerials.delete(prefix)
        return n
      })
    nextSerials.set(prefix, next)
  }
  return next
}

const note = (text: string, cls = 'muted small') => Object.assign(document.createElement('p'), { className: cls, textContent: text })

function previewTable(prefix: string, start: number, names: string[]) {
  const table = document.createElement('table')
  table.className = 'table'
  const head = table.createTHead().insertRow()
  for (const label of ['ユーザー名', '氏名']) head.appendChild(Object.assign(document.createElement('th'), { textContent: label }))
  const body = table.createTBody()
  names.forEach((name, i) => {
    const row = body.insertRow()
    row.insertCell().textContent = serialUsername(prefix, start + i)
    row.insertCell().textContent = name
  })
  const wrap = document.createElement('div')
  wrap.className = 'table-card bulk-preview-table'
  wrap.appendChild(table)
  return wrap
}

let previewRun = 0

async function renderBulkPreview(form: HTMLFormElement) {
  const box = form.querySelector<HTMLElement>('[data-bulk-preview]')
  const url = form.dataset.bulkUsers
  if (!box || !url) return
  const run = ++previewRun
  const prefix = normalizeUsername(form.querySelector<HTMLInputElement>('[name="prefix"]')?.value ?? '')
  const names = parseNames(form.querySelector<HTMLTextAreaElement>('[name="names"]')?.value ?? '')
  const show = (...nodes: Node[]) => run === previewRun && box.replaceChildren(...nodes)

  if (!prefix || names.length === 0) return show(note('接頭辞と氏名を入れると、作るユーザー名がここに出ます。'))
  const problem = checkPrefix(prefix) ?? checkNames(names)
  if (problem) return show(note(problem, 'field-error'))
  const start = await nextSerialOf(url, prefix)
  if (start === null) return show(note('ユーザー名の見本を出せませんでした。作成すると、空いている番号から振ります。'))
  const room = checkRoom(start, names.length)
  if (room) return show(note(room, 'field-error'))
  const range =
    names.length === 1
      ? serialUsername(prefix, start)
      : `${serialUsername(prefix, start)}〜${serialUsername(prefix, start + names.length - 1)}`
  show(note(`${names.length}人を作ります（${range}）。`, 'small strong'), previewTable(prefix, start, names))
}

let previewTimer: ReturnType<typeof setTimeout> | undefined

document.addEventListener('input', (e) => {
  const form = (e.target as Element).closest<HTMLFormElement>('form[data-bulk-users]')
  if (!form) return
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderBulkPreview(form), 200)
})

/** 入力し直して戻ってきた画面（422）では、送った値の見本をすぐに出す */
export function initBulkPreview() {
  const forms = $$<HTMLFormElement>('form[data-bulk-users]')
  // 画面を開くたびに忘れるのは、作成したあとに戻ってくると、覚えていた連番がもう使われているため
  if (forms.length) nextSerials.clear()
  for (const form of forms) void renderBulkPreview(form)
}
