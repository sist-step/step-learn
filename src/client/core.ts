/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// 画面のどこからでも使う部品（トースト・入力の検証・確認・ファイルのドロップ・コードのエディター）。入力の検証の submit を先に登録するため、ほかのモジュールより先に読み込む

import { isFormName, validate, type FieldErrors, type FormInput } from '../lib/forms'
import { setSetting } from '../lib/settings'

import { $$ } from './dom'
// --- 編集モード（端末ごと）
// サーバーに伝えないのは、編集用の部品は管理できる人にだけ描いてあり、ここでは見せるかどうかを切り替えるだけで済むため
export function applyEditMode(on: boolean) {
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
export function toast(message: string, type: 'success' | 'error' | 'info' = 'success') {
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
export function dismissLater(el: Element, ms = 4000) {
  setTimeout(() => dismiss(el), ms)
}
document.addEventListener('click', (e) => {
  const toastEl = (e.target as Element).closest('[data-toast-close]')?.closest('.toast')
  if (toastEl) dismiss(toastEl)
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
export function confirmDialog(message: string): Promise<boolean> {
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

export function confirmNear(
  anchor: HTMLElement,
  messages: readonly string[],
  { ok = '実行する', tone = 'danger' }: ConfirmNearOptions = {},
) {
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

// --- ファイル選択へのドラッグ＆ドロップ
export const dropZoneOf = (e: DragEvent) => (e.target instanceof Element ? e.target.closest<HTMLLabelElement>('.file-drop-zone') : null)
export const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

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

// --- コードのエディター（components/code.tsx の CodeInput / CodeWorkspace）
// ここに直接 import しないのは、CodeMirror と各言語の文法が大きく、コードの入力欄のない画面でも毎回読み込むことになるため
export let codeEditor: Promise<typeof import('../code-editor')> | null = null
export function initCodeEditors() {
  void codeEditor?.then(({ releaseDetachedCodeEditors }) => releaseDetachedCodeEditors())
  if (
    !document.querySelector(
      '[data-code-input]:not([data-code-ready]), [data-code-grade]:not([data-code-watching]), [data-code-submit-timer]:not([data-code-counting])',
    )
  )
    return
  codeEditor ??= import('../code-editor')
  codeEditor
    .then(({ mountCodeEditors }) => mountCodeEditors(toast, confirmNear))
    .catch(() => {
      codeEditor = null
      toast('エディターを読み込めませんでした。', 'error')
    })
}
