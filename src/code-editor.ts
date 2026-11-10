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
import { CODE_FILE_KEYS, buildWebDocument, isPreviewMessage, type CodeFiles, type PreviewMessage } from './lib/code'
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

type Mounted = { root: HTMLElement; release: () => void }
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
  mounted.add({ root, release: () => view.destroy() })
  return view
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

async function mountCodeWorkspace(root: HTMLElement, toast: Toast) {
  const base = root.dataset.codeBase
  const form = root.querySelector<HTMLFormElement>('form.code-edit')
  if (!base || !form || root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
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

  const views = new Map<string, EditorView>()
  for (const input of root.querySelectorAll<HTMLElement>('[data-code-input]')) {
    const view = mountCodeInput(input, runButton ? () => void run() : undefined)
    const key = input.closest<HTMLElement>('[data-code-file]')?.dataset.codeFile
    if (view && key) views.set(key, view)
  }

  // --- ファイルのタブ
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

/** 画面から外れたエディターを片づける。保存を待っている書きかけのコードは、その場で送る */
export function releaseDetachedCodeEditors() {
  for (const entry of mounted) {
    if (entry.root.isConnected) continue
    entry.release()
    mounted.delete(entry)
  }
}

export function mountCodeEditors(toast: Toast) {
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-workspace]:not([data-code-ready])'))
    void mountCodeWorkspace(root, toast)
  for (const input of document.querySelectorAll<HTMLElement>('[data-code-input]:not([data-code-ready])')) {
    if (!input.closest('[data-code-workspace]')) mountCodeInput(input)
  }
}
