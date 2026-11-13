/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html, htmlLanguage } from '@codemirror/lang-html'
import { javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import {
  HighlightStyle,
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  foldKeymap,
  getIndentUnit,
  indentOnInput,
  indentString,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { lintGutter, lintKeymap, linter, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Command,
} from '@codemirror/view'
import { abbreviationTracker, emmetCompletionSource } from '@emmetio/codemirror6-plugin'
import { tags } from '@lezer/highlight'
import type { CodeSyntax } from './components/code'
import {
  CODE_FILES,
  CODE_FILE_KEYS,
  DEFAULT_STARTER,
  buildWebDocument,
  formatWait,
  isPreviewMessage,
  type CodeConstraint,
  type CodeFileKey,
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

const PHRASES = {
  Find: '検索',
  Replace: '置換',
  next: '次へ',
  previous: '前へ',
  all: 'すべて選択',
  'match case': '大文字と小文字を区別',
  regexp: '正規表現',
  'by word': '単語単位',
  replace: '置換',
  'replace all': 'すべて置換',
  close: '閉じる',
  'current match': '現在の一致',
  'on line': '行目',
  'replaced $ matches': '$ 件を置換しました',
  'replaced match on line $': '$ 行目を置換しました',
  'Go to line': '移動する行',
  go: '移動',
  'Fold line': '折りたたむ',
  'Unfold line': '展開する',
  'folded code': '折りたたんだコード',
  unfold: '展開する',
  to: '〜',
  Diagnostics: '問題',
  'No diagnostics': '問題はありません',
  Completions: '候補',
  'Control character': '制御文字',
  'Selection deleted': '選んだ部分を消しました',
}

/** ほかのファイル（Web の HTML・CSS・JavaScript）の今の中身。候補に HTML の id や CSS のクラス名を出すのに使う */
type Peers = (key: CodeFileKey) => string

const fileName = (key: CodeFileKey) => CODE_FILES.web.find((f) => f.key === key)?.name ?? key

const unique = (values: Iterable<string>) => [...new Set(values)]

/** HTML に書かれたクラス名・id・タグ名 */
function htmlNames(source: string) {
  const attr = (name: string) =>
    [...source.matchAll(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi'))].flatMap((m) => (m[1] ?? m[2]).split(/\s+/))
  return {
    classes: unique(attr('class').filter(Boolean)),
    ids: unique(attr('id').filter(Boolean)),
    tags: unique([...source.matchAll(/<([a-z][\w-]*)/gi)].map((m) => m[1].toLowerCase())),
  }
}

const stripCssLiterals = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""')

/** CSS のセレクターに書かれたクラス名と id。{ } の中の値（#fff の色や url(a.png) など）は拾わない */
function cssNames(source: string) {
  const selectors = stripCssLiterals(source)
    .split(/[{}]/)
    .slice(0, -1)
    .map((part) => part.slice(part.lastIndexOf(';') + 1))
  const names = (prefix: string) =>
    unique(selectors.flatMap((s) => [...s.matchAll(new RegExp(`\\${prefix}(-?[_a-zA-Z][\\w-]*)`, 'g'))].map((m) => m[1])))
  return { classes: names('.'), ids: names('#') }
}

const nameOptions = (names: readonly string[], type: string, detail: string, prefix = ''): Completion[] =>
  names.map((name) => ({ label: prefix + name, type, detail }))

/** HTML の class="…" と id="…" の中で、CSS に書いたクラス名と id を出す */
const htmlAttributeSource =
  (peers: Peers): CompletionSource =>
  (context) => {
    const value = syntaxTree(context.state).resolveInner(context.pos, -1)
    const nameNode = value.name === 'AttributeValue' ? value.parent?.getChild('AttributeName') : null
    const attr = nameNode && context.state.sliceDoc(nameNode.from, nameNode.to).toLowerCase()
    const word = context.matchBefore(/[\w-]*/)
    if ((attr !== 'class' && attr !== 'id') || !word || word.from <= value.from) return null
    const { classes, ids } = cssNames(peers('css'))
    const options = attr === 'class' ? nameOptions(classes, 'class', fileName('css')) : nameOptions(ids, 'constant', fileName('css'))
    return options.length ? { from: word.from, options, validFor: /^[\w-]*$/ } : null
  }

/** CSS のセレクターで . や # を打ったときに、HTML に書いたクラス名と id を出す */
const cssSelectorSource =
  (peers: Peers): CompletionSource =>
  (context) => {
    const word = context.matchBefore(/[.#][\w-]*/)
    if (!word) return null
    // 構文の木で判断しないのは、書きかけの color: #f の #f が、{ } の外のセレクターとして読まれるため
    const before = stripCssLiterals(context.state.sliceDoc(0, word.from))
    const brace = Math.max(before.lastIndexOf('{'), before.lastIndexOf('}'))
    if (before[brace] === '{' && before.slice(Math.max(brace, before.lastIndexOf(';')) + 1).includes(':')) return null
    const { classes, ids } = htmlNames(peers('html'))
    const options =
      word.text[0] === '.' ? nameOptions(classes, 'class', fileName('html'), '.') : nameOptions(ids, 'constant', fileName('html'), '#')
    return options.length ? { from: word.from, options, validFor: /^[.#][\w-]*$/ } : null
  }

const DOM_QUERY =
  /\b(getElementById|getElementsByClassName|querySelector(?:All)?|closest|matches|classList\.(?:add|remove|toggle|contains|replace))\(\s*(?:(["'`])[^"'`]*\2\s*,\s*)?["'`]([^"'`]*)$/

/** JavaScript の getElementById('…') や querySelector('…') の文字列の中で、HTML の id・クラス名・タグ名を出す */
const jsDomSource =
  (peers: Peers): CompletionSource =>
  (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const match = DOM_QUERY.exec(line.text.slice(0, context.pos - line.from))
    if (!match) return null
    const [, method, , typed] = match
    const { classes, ids, tags } = htmlNames(peers('html'))
    const detail = fileName('html')
    if (method === 'getElementById' || method === 'getElementsByClassName' || method.startsWith('classList.')) {
      const word = /[\w-]*$/.exec(typed)?.[0] ?? ''
      const options = method === 'getElementById' ? nameOptions(ids, 'constant', detail) : nameOptions(classes, 'class', detail)
      return options.length ? { from: context.pos - word.length, options, validFor: /^[\w-]*$/ } : null
    }
    const word = /[#.]?[\w-]*$/.exec(typed)?.[0] ?? ''
    const options = [
      ...nameOptions(ids, 'constant', detail, '#'),
      ...nameOptions(classes, 'class', detail, '.'),
      ...nameOptions(tags, 'type', detail),
    ]
    return options.length ? { from: context.pos - word.length, options, validFor: /^[#.]?[\w-]*$/ } : null
  }

const scopeSource = scopeCompletionSource(globalThis)
// 古くて使わない API が、よく使う名前より先に並んでしまう（document.que で querySelector より queryCommandEnabled が先に出る）ので外す
const HIDDEN_GLOBALS = /^(__|queryCommand|webkit|onwebkit)|^(captureEvents|releaseEvents|execCommand)$/

/** ブラウザの window・document などにある名前を出す */
const jsGlobalSource: CompletionSource = async (context) => {
  const result = await scopeSource(context)
  return result && { ...result, options: result.options.filter((o) => !HIDDEN_GLOBALS.test(o.label)) }
}

const HTML_TAGS = new Set(
  (
    'a abbr address article aside audio b blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn ' +
    'dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input ins kbd label ' +
    'legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp ' +
    'script section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr ' +
    'track u ul var video wbr'
  ).split(' '),
)

type EmmetCompletion = Completion & { tracker?: { abbreviation: string } }

/**
 * Emmet の略記を、略記そのものを見出しにした候補にする。
 * タグ名でないただの単語は出さないのは、本文の英単語を打って Enter で改行すると <Hello></Hello> に展開されてしまうため
 */
function relabelEmmet(result: CompletionResult): CompletionResult | null {
  const options = result.options.flatMap((option: EmmetCompletion) => {
    const abbreviation = option.tracker?.abbreviation ?? ''
    if (/^[a-z][\w-]*$/i.test(abbreviation) && !HTML_TAGS.has(abbreviation.toLowerCase())) return []
    return [{ ...option, label: abbreviation || option.label, detail: 'Emmet' }]
  })
  if (!options.length) return null
  const { update } = result
  return {
    ...result,
    options,
    update:
      update &&
      ((current, from, to, context) => {
        const next = update(current, from, to, context)
        return next && relabelEmmet(next)
      }),
  }
}

const emmetSource: CompletionSource = (context) => {
  const result = emmetCompletionSource(context)
  return result && !(result instanceof Promise) ? relabelEmmet(result) : null
}

const VOID_TAGS = new Set('area base br col embed hr img input link meta source track wbr'.split(' '))
// 閉じタグを省ける要素は、閉じ忘れとして知らせない
const OPTIONAL_CLOSE_TAGS = new Set(
  'html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup rp rt caption'.split(' '),
)
const MAX_DIAGNOSTICS = 30
const SYNTAX_ERROR = '書き方に誤りがあります。かっこ・引用符の閉じ忘れや、記号の打ち間違いがないか確かめてください。'

/** 構文の木から、書き方の誤りと HTML の閉じタグの誤りを拾う */
function syntaxDiagnostics(view: EditorView): Diagnostic[] {
  const { state } = view
  const tree = ensureSyntaxTree(state, state.doc.length, 200)
  if (!tree) return []
  const found: Diagnostic[] = []
  const push = (from: number, to: number, message: string) => {
    const last = found.at(-1)
    if (last && last.message === message && from <= last.to + 1) last.to = Math.max(last.to, to)
    else found.push({ from, to, severity: 'error', message })
  }
  tree.iterate({
    enter: (node) => {
      if (found.length >= MAX_DIAGNOSTICS) return false
      if (node.type.isError) return push(node.from, node.to, SYNTAX_ERROR)
      if (node.name === 'MismatchedCloseTag') return push(node.from, node.to, '対応する開始タグのない閉じタグです。')
      if (node.name !== 'Element') return
      const open = node.node.firstChild
      const tagName = open?.name === 'OpenTag' ? open.getChild('TagName') : null
      if (!tagName || node.node.lastChild?.name === 'CloseTag') return
      const tag = state.sliceDoc(tagName.from, tagName.to).toLowerCase()
      if (!VOID_TAGS.has(tag) && !OPTIONAL_CLOSE_TAGS.has(tag)) push(tagName.from, tagName.to, `<${tag}> を閉じる </${tag}> がありません。`)
    },
  })
  return found
}

/** 選んでいないときは、カーソルの位置に字下げの空白を入れる（CodeMirror の既定は行の頭を字下げするが、VS Code と同じにする） */
const insertIndent: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view)
  const unit = getIndentUnit(state)
  view.dispatch(
    state.changeByRange((range) => {
      const column = range.head - state.doc.lineAt(range.head).from
      const insert = indentString(state, unit - (column % unit))
      return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
  return true
}

const LANGUAGES: Record<CodeSyntax, (peers: Peers) => Extension[]> = {
  html: (peers) => [
    html(),
    indentUnit.of('  '),
    abbreviationTracker({ mark: false, previewEnabled: false }),
    htmlLanguage.data.of({ autocomplete: emmetSource }),
    htmlLanguage.data.of({ autocomplete: htmlAttributeSource(peers) }),
  ],
  css: (peers) => {
    const data = [{ autocomplete: cssSelectorSource(peers) }]
    return [css(), indentUnit.of('  '), EditorState.languageData.of(() => data)]
  },
  js: (peers) => [
    javascript(),
    indentUnit.of('  '),
    javascriptLanguage.data.of({ autocomplete: jsGlobalSource }),
    javascriptLanguage.data.of({ autocomplete: jsDomSource(peers) }),
  ],
  py: () => [python(), indentUnit.of('    ')],
  text: () => [],
}

const LINTED: readonly CodeSyntax[] = ['html', 'css', 'js', 'py']

// --- 整形（Shift + Alt + F）
const PRETTIER_PARSERS: Partial<Record<CodeSyntax, string>> = { html: 'html', css: 'css', js: 'babel' }

// Prettier をここで import しないのは、整形するときにしか使わないのに大きく、エディターを開くたびに読み込むことになるため
const loadPrettier = () =>
  Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ]).then(([prettier, ...plugins]) => ({ formatWithCursor: prettier.formatWithCursor, plugins }))

let prettier: ReturnType<typeof loadPrettier> | null = null

/** 整形し、変わった部分だけを書き換える（全体を置き換えないのは、折りたたみやスクロールの位置が失われるため） */
async function formatEditor(view: EditorView, syntax: CodeSyntax, toast: Toast) {
  const parser = PRETTIER_PARSERS[syntax]
  if (!parser) return
  const source = view.state.doc.toString()
  let result: { formatted: string; cursorOffset: number }
  try {
    prettier ??= loadPrettier()
    const { formatWithCursor, plugins } = await prettier
    try {
      result = await formatWithCursor(source, { parser, plugins, cursorOffset: view.state.selection.main.head })
    } catch {
      return toast('書き方に誤りがあるため、整形できませんでした。赤い波線のところを直してから、もう一度お試しください。', 'error')
    }
  } catch {
    prettier = null
    return toast('整形の機能を読み込めませんでした。', 'error')
  }
  const { formatted, cursorOffset } = result
  if (formatted === source || view.state.doc.toString() !== source) return
  let start = 0
  while (start < source.length && source[start] === formatted[start]) start++
  let end = 0
  while (end < source.length - start && end < formatted.length - start && source.at(-1 - end) === formatted.at(-1 - end)) end++
  view.dispatch({
    changes: { from: start, to: source.length - end, insert: formatted.slice(start, formatted.length - end) },
    selection: { anchor: Math.min(Math.max(cursorOffset, 0), formatted.length) },
    scrollIntoView: true,
    userEvent: 'input.format',
  })
}

const isSyntax = (s: string | undefined): s is CodeSyntax => !!s && s in LANGUAGES

type Mounted = { root: HTMLElement; release: () => void; view?: EditorView }
const mounted = new Set<Mounted>()
const syntaxOf = new WeakMap<EditorView, CodeSyntax>()

type CodeInputOptions = { toast?: Toast; peers?: Peers; onRun?: () => void; onSave?: () => void }

function mountCodeInput(root: HTMLElement, { toast, peers = () => '', onRun, onSave }: CodeInputOptions = {}) {
  const source = root.querySelector<HTMLTextAreaElement>('.code-input-source')
  const host = root.querySelector<HTMLElement>('[data-code-host]')
  const syntax = root.dataset.codeInput
  if (!source || !host || !isSyntax(syntax) || root.hasAttribute('data-code-ready')) return null
  root.setAttribute('data-code-ready', '')

  const format: Command = (view) => {
    if (!toast || !PRETTIER_PARSERS[syntax]) return false
    void formatEditor(view, syntax, toast)
    return true
  }
  const view = new EditorView({
    parent: host,
    doc: source.value,
    extensions: [
      EditorState.phrases.of(PHRASES),
      EditorState.allowMultipleSelections.of(true),
      // Alt + クリックでカーソルを足すのは、VS Code と同じ操作にするため（CodeMirror の既定は Ctrl / ⌘ + クリック）
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
      lineNumbers(),
      foldGutter({ openText: '⌄', closedText: '›' }),
      ...(LINTED.includes(syntax) ? [lintGutter(), linter(syntaxDiagnostics, { delay: 600 })] : []),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ maxRenderedOptions: 60 }),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlight),
      // Emmet の Tab より先にするのは、候補を閉じたあとの Tab で、本文の英単語までタグに展開されてしまうため（Emmet は候補から確定する）
      Prec.high(
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          { key: 'Tab', run: insertIndent, shift: indentLess },
        ]),
      ),
      ...LANGUAGES[syntax](peers),
      keymap.of([
        ...(onRun ? [{ key: 'Mod-Enter', run: () => (onRun(), true) }] : []),
        // 押してもブラウザの「ページを保存」を開かせないのは、VS Code の癖で押した人を驚かせないため
        { key: 'Mod-s', run: () => (onSave?.(), true) },
        // Mac では Ctrl + Space が入力ソースの切り替えに取られるので、VS Code と同じ ⌘ + I でも出せるようにする
        { key: 'Mod-i', run: startCompletion },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
      // keymap の Shift-Alt-f にしないのは、Mac では Option を押すと Ï などの文字の入力として扱われ、キーの組み合わせとして届かないため
      EditorView.domEventHandlers({
        keydown: (e, view) => {
          if (e.code !== 'KeyF' || !e.shiftKey || !e.altKey || e.metaKey || e.ctrlKey || !format(view)) return false
          e.preventDefault()
          return true
        },
      }),
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
  syntaxOf.set(view, syntax)
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
function mountFileTabs(root: HTMLElement, options: Omit<CodeInputOptions, 'peers'>) {
  const views = new Map<string, EditorView>()
  const peers: Peers = (key) => root.querySelector<HTMLTextAreaElement>(`textarea[name="${key}"]`)?.value ?? ''
  for (const input of root.querySelectorAll<HTMLElement>('[data-code-input]')) {
    const view = mountCodeInput(input, { ...options, peers })
    const key = input.closest<HTMLElement>('[data-code-file]')?.dataset.codeFile
    if (view && key) views.set(key, view)
  }
  const visibleView = () => views.get(root.querySelector<HTMLElement>('[data-code-file]:not([hidden])')?.dataset.codeFile ?? '')
  root.querySelector('[data-code-format]')?.addEventListener('click', () => {
    const view = visibleView()
    const syntax = view && syntaxOf.get(view)
    if (!view || !syntax || !options.toast) return
    view.focus()
    void formatEditor(view, syntax, options.toast)
  })
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
function mountStarter(root: HTMLElement, toast: Toast, confirm: Confirm) {
  if (root.hasAttribute('data-code-ready')) return
  root.setAttribute('data-code-ready', '')
  mountFileTabs(root, { toast })

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

  mountFileTabs(root, { toast, onRun: runButton ? () => void run() : undefined, onSave: () => void save() })

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

const MAC_KEY_LABELS: Record<string, string> = { mod: '⌘', alt: '⌥', shift: '⇧', ctrl: '⌃' }

export function mountCodeEditors(toast: Toast, confirm: Confirm) {
  listenShowView()
  if (/Mac|iPhone|iPad/.test(navigator.userAgent))
    for (const key of document.querySelectorAll<HTMLElement>('[data-code-key]'))
      key.textContent = MAC_KEY_LABELS[key.dataset.codeKey ?? ''] ?? key.textContent
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-code-submit-timer]')) mountSubmitCountdown(button)
  for (const card of document.querySelectorAll<HTMLElement>('[data-code-grade]')) watchGrading(card, toast)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-code-suggest]')) mountSuggest(button, toast, confirm)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-starter]')) mountStarter(root, toast, confirm)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-constraints]')) mountConstraints(root)
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-workspace]:not([data-code-ready])'))
    void mountCodeWorkspace(root, toast)
  for (const input of document.querySelectorAll<HTMLElement>('[data-code-input]:not([data-code-ready])')) {
    if (!input.closest('[data-code-workspace]')) mountCodeInput(input, { toast })
  }
}
