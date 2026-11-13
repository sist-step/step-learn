/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { CodeSyntax } from './components/code'
import {
  CODE_FILE_KEYS,
  DEFAULT_STARTER,
  buildWebDocument,
  formatWait,
  isPreviewMessage,
  type CodeConstraint,
  type CodeFiles,
  type PreviewMessage,
} from './lib/code'
import type { RunResult } from './lib/sandbox'

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: 'code-tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], class: 'code-tok-string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit, tags.color], class: 'code-tok-number' },
  { tag: tags.comment, class: 'code-tok-comment' },
  { tag: tags.tagName, class: 'code-tok-tag' },
  { tag: tags.attributeName, class: 'code-tok-attr' },
  { tag: [tags.propertyName, tags.className], class: 'code-tok-prop' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName), tags.function(tags.propertyName)], class: 'code-tok-def' },
  { tag: [tags.angleBracket, tags.punctuation, tags.operator], class: 'code-tok-punct' },
])

const LANGUAGES: Record<CodeSyntax, () => Extension[]> = {
  html: () => [html(), indentUnit.of('  ')],
  css: () => [css(), indentUnit.of('  ')],
  js: () => [javascript(), indentUnit.of('  ')],
  py: () => [python(), indentUnit.of('    ')],
  text: () => [],
}

const isSyntax = (s: string | undefined): s is CodeSyntax => !!s && s in LANGUAGES

type Mounted = { root: HTMLElement; release: () => void; view?: EditorView }
const mounted = new Set<Mounted>()

function mountCodeInput(root: HTMLElement, onRun?: () => void) {
  const source = root.querySelector<HTMLTextAreaElement>('.code-input-source')
  const host = root.querySelector<HTMLElement>('[data-code-host]')
  const syntax = root.dataset.codeInput
  if (!source || !host || !isSyntax(syntax) || root.hasAttribute('data-code-ready')) return null
  root.setAttribute('data-code-ready', '')

  const view = new EditorView({
    parent: host,
    doc: source.value,
    extensions: [
      lineNumbers(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      syntaxHighlighting(highlight),
      ...LANGUAGES[syntax](),
      keymap.of([
        ...(onRun ? [{ key: 'Mod-Enter', run: () => (onRun(), true) }] : []),
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({
        'aria-multiline': 'true',
        ...(source.hasAttribute('aria-label') && { 'aria-label': source.getAttribute('aria-label')! }),
        ...(source.hasAttribute('aria-describedby') && { 'aria-describedby': source.getAttribute('aria-describedby')! }),
      }),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return
        source.value = u.state.doc.toString()
        source.dispatchEvent(new Event('input', { bubbles: true }))
      }),
    ],
  })
  source.hidden = true
  if (source.id) document.querySelector(`label[for="${source.id}"]`)?.addEventListener('click', () => view.focus())
  mounted.add({ root, release: () => view.destroy(), view })
  return view
}

/** 入力欄の値を書き換える。エディターに置き換えた欄は、エディターの中身ごと書き換える */
function setFieldValue(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const view = [...mounted].find((m) => m.view && m.root.contains(field))?.view
  if (view) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    return
  }
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

// --- 問題文から下書きを作る（components/code.tsx の CodeSuggest）
type Confirm = (message: string) => Promise<boolean>

type SuggestReply = { draft?: { starter: CodeFiles; stdin: string; constraints: CodeConstraint[] }; error?: string }

const DEFAULT_FILES: CodeFiles = { ...DEFAULT_STARTER.web, ...DEFAULT_STARTER.python }

function mountSuggest(button: HTMLButtonElement, toast: Toast, confirm: Confirm) {
  const action = button.dataset.codeSuggest
  const form = button.form
  if (!action || !form || button.hasAttribute('data-code-ready')) return
  button.setAttribute('data-code-ready', '')
  const fieldOf = (name: string) => {
    const control = form.elements.namedItem(name)
    return control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement ? control : null
  }

  button.addEventListener('click', async () => {
    if (button.disabled) return
    if (!fieldOf('body')?.value.trim()) return toast('先に問題文を書いてください。', 'error')
    const edited =
      [...form.querySelectorAll<HTMLInputElement>('[data-code-constraint] input')].some((input) => !!input.value.trim()) ||
      CODE_FILE_KEYS.some((key) => {
        const field = fieldOf(key)
        return !!field && field.value.trim() !== (DEFAULT_FILES[key] ?? '').trim()
      })
    if (edited && !(await confirm('今の最初のコードと制約を、AI が作った下書きで置き換えますか？'))) return

    const body = new FormData()
    for (const name of ['title', 'body']) body.set(name, fieldOf(name)?.value ?? '')
    const status = button.closest('.code-suggest')?.querySelector<HTMLElement>('[data-code-suggest-status]')
    const idleText = status?.textContent ?? ''
    if (status) status.textContent = 'AI が下書きを作っています。30 秒ほどお待ちください…'
    button.disabled = true
    button.classList.add('loading')
    try {
      const res = await fetch(action, { method: 'POST', body, headers: { Accept: 'application/json' } })
      const data = (await res.json().catch(() => null)) as SuggestReply | null
      if (!data?.draft) return toast(data?.error ?? '下書きを作れませんでした。', 'error')
      if (!button.isConnected) return
      const { starter, stdin, constraints } = data.draft
      for (const key of CODE_FILE_KEYS) {
        const field = fieldOf(key)
        if (field && typeof starter[key] === 'string') setFieldValue(field, starter[key])
      }
      const stdinField = fieldOf('stdin')
      if (stdinField) setFieldValue(stdinField, stdin)
      const constraintsRoot = form.querySelector<HTMLElement>('[data-code-constraints]')
      if (constraintsRoot) setConstraints(constraintsRoot, constraints)
      form
        .querySelector('.code-section')
        ?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
      toast('下書きを入れました。内容を確かめてから保存してください。')
    } catch {
      toast('下書きを作れませんでした。通信の状態を確かめて、もう一度お試しください。', 'error')
    } finally {
      if (status) status.textContent = idleText
      button.disabled = false
      button.classList.remove('loading')
    }
  })
}

// --- 編集画面の制約（components/code.tsx の CodeGradingCard）
function addConstraintRow(root: HTMLElement, { label, text }: CodeConstraint) {
  const template = root.querySelector<HTMLTemplateElement>('[data-code-constraint-template]')
  const row = template?.content.firstElementChild?.cloneNode(true)
  const labelInput = row instanceof HTMLElement ? row.querySelector<HTMLInputElement>('input[name="constraint_label[]"]') : null
  const textInput = row instanceof HTMLElement ? row.querySelector<HTMLInputElement>('input[name="constraint_text[]"]') : null
  if (!(row instanceof HTMLElement) || !labelInput || !textInput) return null
  labelInput.value = label
  textInput.value = text
  root.querySelector('[data-code-constraint-list]')?.append(row)
  return labelInput
}

/** 制約の行をすべて入れ替える。入力の検証は、fieldset への input イベントで取り直させる */
function setConstraints(root: HTMLElement, constraints: readonly CodeConstraint[]) {
  root.querySelector('[data-code-constraint-list]')?.replaceChildren()
  for (const c of constraints) addConstraintRow(root, c)
  root.dispatchEvent(new Event('input', { bubbles: true }))
}

function mountConstraints(root: HTMLElement) {
  if (root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
  root.addEventListener('click', (e) => {
    const target = e.target as Element
    if (target.closest('[data-code-constraint-add]')) {
      addConstraintRow(root, { label: '', text: '' })?.focus()
      root.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }
    const row = target.closest('[data-code-constraint-remove]')?.closest('[data-code-constraint]')
    if (!row) return
    const next = row.nextElementSibling ?? row.previousElementSibling
    row.remove()
    ;(next?.querySelector('input') ?? root.querySelector<HTMLElement>('[data-code-constraint-add]'))?.focus()
    root.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// --- ファイルのタブ（CodeWorkspace と CodeStarterCard）
/** root の中のコードの入力欄をエディターにし、ファイルのタブ（data-code-tab）で、対応する欄（data-code-file）を切り替えられるようにする */
function mountFileTabs(root: HTMLElement, onRun?: () => void) {
  const views = new Map<string, EditorView>()
  for (const input of root.querySelectorAll<HTMLElement>('[data-code-input]')) {
    const view = mountCodeInput(input, onRun)
    const key = input.closest<HTMLElement>('[data-code-file]')?.dataset.codeFile
    if (view && key) views.set(key, view)
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-code-tab]')]
  const selectTab = (tab: HTMLButtonElement, focusEditor: boolean) => {
    for (const t of tabs) {
      t.setAttribute('aria-selected', String(t === tab))
      t.tabIndex = t === tab ? 0 : -1
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-code-file]'))
      panel.hidden = panel.dataset.codeFile !== tab.dataset.codeTab
    const view = views.get(tab.dataset.codeTab ?? '')
    // 隠れている間は大きさを測れていないので、見えるようになってから測り直させる
    view?.requestMeasure()
    if (focusEditor) view?.focus()
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab, true))
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
      selectTab(next, false)
      next.focus()
    })
  }
}

// --- 編集画面の最初のコード（components/code.tsx の CodeStarterCard）
function mountStarter(root: HTMLElement, confirm: Confirm) {
  if (root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
  mountFileTabs(root)

  const fieldOf = (key: string) => root.querySelector<HTMLTextAreaElement>(`textarea[name="${key}"]`)
  const preview = root.querySelector<HTMLIFrameElement>('[data-code-preview]')
  let previewTimer = 0
  const renderPreview = () => {
    clearTimeout(previewTimer)
    if (preview) preview.srcdoc = buildWebDocument(Object.fromEntries(CODE_FILE_KEYS.map((key) => [key, fieldOf(key)?.value ?? ''])))
  }
  if (preview) {
    renderPreview()
    root.addEventListener('input', () => {
      clearTimeout(previewTimer)
      previewTimer = window.setTimeout(renderPreview, PREVIEW_DELAY)
    })
  }

  const reset = root.querySelector<HTMLButtonElement>('[data-code-starter-reset]')
  const language = reset?.dataset.codeStarterReset
  reset?.addEventListener('click', async () => {
    if (language !== 'web' && language !== 'python') return
    if (!(await confirm('最初のコードを消して、ひな形に戻しますか？'))) return
    for (const key of CODE_FILE_KEYS) {
      const field = fieldOf(key)
      if (field) setFieldValue(field, DEFAULT_STARTER[language][key] ?? '')
    }
    const stdin = fieldOf('stdin')
    if (stdin) setFieldValue(stdin, '')
  })
  mounted.add({ root, release: () => clearTimeout(previewTimer) })
}

// --- エディターと結果の画面（components/code.tsx の CodeWorkspace）
const SAVE_DELAY = 1500
const PREVIEW_DELAY = 500
const CONSOLE_MAX_LINES = 200

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

const RUN_STATUS: Record<RunResult['status'], { tone: 'ok' | 'warn' | 'error'; label: string }> = {
  exited: { tone: 'ok', label: '正常に終了しました' },
  timeout: { tone: 'warn', label: '時間切れで止めました（実行できるのは 10 秒、計算は 5 秒まで）' },
  output_limit: { tone: 'warn', label: '出力が多すぎるため、途中で止めました' },
  killed: { tone: 'error', label: '強制的に終了されました（メモリの使いすぎなど）' },
}

function showRunResult(output: HTMLElement, result: RunResult) {
  const failed = result.status === 'exited' && result.exitCode !== 0
  const { tone, label } = failed
    ? { tone: 'error', label: `エラーで終了しました（終了コード ${result.exitCode}）` }
    : RUN_STATUS[result.status]
  const status = el('p', `code-output-status is-${tone}`, label)
  status.append(el('span', 'muted', `${(result.durationMs / 1000).toFixed(2)} 秒`))
  const parts: HTMLElement[] = [status]
  if (result.stdout) parts.push(el('pre', '', result.stdout))
  if (result.stderr) parts.push(el('pre', 'is-error', result.stderr))
  if (!result.stdout && !result.stderr) parts.push(el('p', 'muted', '出力はありませんでした。'))
  output.replaceChildren(...parts)
}

function appendConsole(root: HTMLElement, message: PreviewMessage) {
  const lines = root.querySelector<HTMLElement>('[data-code-console-lines]')
  const count = root.querySelector<HTMLElement>('[data-code-console-count]')
  const panel = root.querySelector<HTMLDetailsElement>('[data-code-console]')
  if (!lines || !count || !panel) return
  if (lines.childElementCount >= CONSOLE_MAX_LINES) lines.firstElementChild?.remove()
  lines.append(el('div', `code-console-line is-${message.level}`, message.text))
  lines.scrollTop = lines.scrollHeight
  if (message.level !== 'error') return
  count.textContent = String(Number(count.textContent || 0) + 1)
  count.hidden = false
  panel.open = true
}

addEventListener('message', (e) => {
  if (!isPreviewMessage(e.data)) return
  // 送り主を確かめるのは、ほかのウィンドウや埋め込みから同じ形のメッセージを送れば、コンソールに好きな文字を出せるため
  const frame = [...document.querySelectorAll<HTMLIFrameElement>('[data-code-preview]')].find((f) => f.contentWindow === e.source)
  const root = frame?.closest<HTMLElement>('[data-code-workspace]')
  if (root) appendConsole(root, e.data)
})

/** 右の枠のタブ（data-code-view）で、プレビューか実行結果と、提出の表示（data-code-view-panel）を切り替えられるようにする */
function mountViewTabs(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-code-view]')]
  const select = (tab: HTMLButtonElement) => {
    const view = tab.dataset.codeView
    for (const t of tabs) {
      t.setAttribute('aria-selected', String(t === tab))
      t.tabIndex = t === tab ? 0 : -1
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-code-view-panel]')) panel.hidden = panel.dataset.codeViewPanel !== view
    for (const el of root.querySelectorAll<HTMLElement>('[data-code-view-only]')) el.hidden = el.dataset.codeViewOnly !== view
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
      select(next)
      next.focus()
    })
  }
}

let showListening = false

/** ヘッダーの帯の提出の状況（data-code-show）を押すと、右の枠の対応するタブを開く。帯は採点が終わると差し替わるので、document で受ける */
function listenShowView() {
  if (showListening) return
  showListening = true
  document.addEventListener('click', (e) => {
    const trigger = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-code-show]') : null
    const tab = trigger && document.querySelector<HTMLButtonElement>(`[data-code-view="${trigger.dataset.codeShow}"]`)
    if (!tab) return
    tab.click()
    tab.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * 提出ボタン（data-code-submit-wait に描いた時点の、提出できるようになるまでの秒数、data-code-submit-close に受付が終わるまでの秒数）を、
 * 待つあいだと受付が終わったあとは押せなくし、ボタンと提出のタブ（data-code-countdown）に残りの時間を出す。
 * 提出のタブは採点が終わると差し替わるので、毎秒探し直す
 */
function mountSubmitCountdown(button: HTMLButtonElement) {
  if (button.hasAttribute('data-code-counting')) return
  button.setAttribute('data-code-counting', '')
  const started = Date.now()
  const opensAt = started + Number(button.dataset.codeSubmitWait ?? 0) * 1000
  const closesAt = button.dataset.codeSubmitClose ? started + Number(button.dataset.codeSubmitClose) * 1000 : null
  const text = button.querySelector<HTMLElement>('[data-code-submit-text]')
  const show = (buttonText: string, statusText: (status: HTMLElement) => string, blocked: boolean) => {
    button.disabled = blocked
    if (text) text.textContent = buttonText
    for (const status of document.querySelectorAll<HTMLElement>('[data-code-countdown]')) {
      status.toggleAttribute('data-waiting', blocked)
      const label = status.querySelector('[data-code-countdown-text]')
      if (label) label.textContent = statusText(status)
    }
  }
  const tick = () => {
    if (!button.isConnected) return
    const now = Date.now()
    if (closesAt !== null && now >= closesAt)
      return show(button.dataset.codeSubmitClosed ?? '', (s) => s.dataset.codeCountdownClosed ?? '', true)
    const left = Math.max(0, Math.ceil((opensAt - now) / 1000))
    if (left > 0) {
      const wait = `あと ${formatWait(left)}`
      show(wait, (s) => `${s.dataset.codeCountdownPrefix ?? ''}、${wait}`, true)
    } else show(button.dataset.codeSubmitLabel ?? '', (s) => s.dataset.codeCountdown ?? '', false)
    if (left === 0 && closesAt === null) return
    // 秒の変わり目に合わせて数え直す。待ち終わったあとは、受付が終わる時刻まで 1 秒ごとに確かめる
    window.setTimeout(tick, left > 0 ? opensAt - now - (left - 1) * 1000 : Math.min(1000, closesAt! - now))
  }
  tick()
}

async function mountCodeWorkspace(root: HTMLElement, toast: Toast) {
  const base = root.dataset.codeBase
  const form = root.querySelector<HTMLFormElement>('form.code-edit')
  if (!base || !form || root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
  mountViewTabs(root)
  const fieldOf = (name: string) => {
    const control = form.elements.namedItem(name)
    return control instanceof HTMLTextAreaElement ? control : null
  }
  const saveStatus = root.querySelector<HTMLElement>('[data-code-save]')
  const setStatus = (text: string) => saveStatus && (saveStatus.textContent = text)

  let loaded = false
  try {
    const res = await fetch(`${base}/state`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (res.ok) {
      const state = (await res.json()) as { files: CodeFiles; stdin: string }
      for (const key of CODE_FILE_KEYS) {
        const field = fieldOf(key)
        if (field && typeof state.files[key] === 'string') field.value = state.files[key]
      }
      const stdin = fieldOf('stdin')
      if (stdin) stdin.value = state.stdin
      loaded = true
    }
  } catch {}
  if (!root.isConnected) return
  if (!loaded) {
    // 保存を止めるのは、読み込めなかった書きかけのコードを、最初のコードで上書きしてしまうため
    toast('書きかけのコードを読み込めませんでした。ページを読み込み直してください。', 'error')
    setStatus('保存されません')
  }

  // --- 書きかけのコードの保存
  let dirty = false
  let saveTimer = 0
  const save = async (keepalive = false) => {
    clearTimeout(saveTimer)
    if (!dirty || !loaded) return
    dirty = false
    setStatus('保存中…')
    try {
      const res = await fetch(`${base}/draft`, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
        keepalive,
      })
      const data = (await res.json().catch(() => null)) as { saved?: boolean; error?: string } | null
      if (!res.ok || !data?.saved) {
        dirty = true
        setStatus(data?.error ?? '保存できませんでした')
      } else if (!dirty) {
        setStatus('保存しました')
      }
    } catch {
      dirty = true
      setStatus('保存できませんでした')
    }
  }
  const discardPending = () => {
    dirty = false
    clearTimeout(saveTimer)
  }

  // --- 実行（Python）
  const runButton = root.querySelector<HTMLButtonElement>('[data-code-run]')
  const output = root.querySelector<HTMLElement>('[data-code-output]')
  const run = async () => {
    if (!runButton || !output || runButton.disabled) return
    runButton.disabled = true
    runButton.classList.add('loading')
    // サーバーが実行の前に同じ内容を保存するので、重ねて送らない
    discardPending()
    try {
      const res = await fetch(`${base}/run`, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      const data = (await res.json()) as { result?: RunResult; error?: string }
      if (data.result) {
        showRunResult(output, data.result)
        if (loaded) setStatus('保存しました')
      } else output.replaceChildren(el('p', 'code-output-status is-error', data.error ?? 'コードを実行できませんでした。'))
    } catch {
      output.replaceChildren(
        el('p', 'code-output-status is-error', 'コードを実行できませんでした。通信の状態を確かめて、もう一度お試しください。'),
      )
    } finally {
      runButton.disabled = false
      runButton.classList.remove('loading')
    }
  }
  runButton?.addEventListener('click', () => void run())
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return
    e.preventDefault()
    void run()
  })

  mountFileTabs(root, runButton ? () => void run() : undefined)

  // --- プレビュー（Web）
  const preview = root.querySelector<HTMLIFrameElement>('[data-code-preview]')
  let previewTimer = 0
  const renderPreview = () => {
    clearTimeout(previewTimer)
    if (!preview) return
    root.querySelector('[data-code-console-lines]')?.replaceChildren()
    const count = root.querySelector<HTMLElement>('[data-code-console-count]')
    if (count) {
      count.textContent = ''
      count.hidden = true
    }
    preview.srcdoc = buildWebDocument(Object.fromEntries(CODE_FILE_KEYS.map((key) => [key, fieldOf(key)?.value ?? ''])))
  }
  root.querySelector('[data-code-refresh]')?.addEventListener('click', renderPreview)
  renderPreview()

  root.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLTextAreaElement) || e.target.form !== form) return
    dirty = true
    if (loaded) setStatus('')
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY)
    if (preview && e.target.name !== 'stdin') {
      clearTimeout(previewTimer)
      previewTimer = window.setTimeout(renderPreview, PREVIEW_DELAY)
    }
  })
  // 提出と「最初のコードに戻す」のあとに古い内容を保存しないのは、サーバーが書きかけのコードを書き換えたあとで、それを上書きしてしまうため。
  // 確認ダイアログの前の送信（client.ts が止める）では取り消さない
  root.addEventListener('submit', (e) => {
    const target = e.target as HTMLFormElement
    if (!target.dataset.confirm || target.dataset.confirmed === '1') discardPending()
  })

  mounted.add({
    root,
    release: () => {
      clearTimeout(previewTimer)
      void save(true)
    },
  })
}

// --- 採点の終わりを待つ（components/code.tsx の CodeSubmissions）
const GRADING_INTERVAL = 3000

// サーバーから知らせを送らないのは、採点は本人にしか関係がなく、コースの版を進めると開いている全員が画面を取り直すことになるため
function watchGrading(card: HTMLElement, toast: Toast) {
  const url = card.dataset.codeGrade
  if (!url || card.hasAttribute('data-code-watching')) return
  card.setAttribute('data-code-watching', '')
  const check = async () => {
    if (!card.isConnected) return
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const { pending } = (await res.json()) as { pending: boolean }
      if (!pending) return await showGrade(card, toast)
    } catch {}
    window.setTimeout(() => void check(), GRADING_INTERVAL)
  }
  window.setTimeout(() => void check(), GRADING_INTERVAL)
}

// 結果を JSON で受け取って組み立てないのは、サーバーが描くカードと同じ見た目を、ここでもう一度作ることになるため
async function showGrade(card: HTMLElement, toast: Toast) {
  const res = await fetch(location.href, { headers: { Accept: 'text/html' } })
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  const next = doc.getElementById(card.id)
  if (!card.isConnected || !next) return
  card.replaceWith(document.importNode(next, true))
  const chip = document.querySelector('[data-code-grade-chip]')
  const nextChip = doc.querySelector('[data-code-grade-chip]')
  if (chip && nextChip) chip.replaceWith(document.importNode(nextChip, true))
  toast('採点が終わりました。')
}

/** 画面から外れたエディターを片づける。保存を待っている書きかけのコードは、その場で送る */
export function releaseDetachedCodeEditors() {
  for (const entry of mounted) {
    if (entry.root.isConnected) continue
    entry.release()
    mounted.delete(entry)
  }
}

export function mountCodeEditors(toast: Toast, confirm: Confirm) {
  listenShowView()
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-code-submit-timer]')) mountSubmitCountdown(button)
  for (const card of document.querySelectorAll<HTMLElement>('[data-code-grade]')) watchGrading(card, toast)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-code-suggest]')) mountSuggest(button, toast, confirm)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-starter]')) mountStarter(root, confirm)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-constraints]')) mountConstraints(root)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-workspace]:not([data-code-ready])'))
    void mountCodeWorkspace(root, toast)
  for (const input of document.querySelectorAll<HTMLElement>('[data-code-input]:not([data-code-ready])')) {
    if (!input.closest('[data-code-workspace]')) mountCodeInput(input)
  }
}
