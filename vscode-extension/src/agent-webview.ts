// サイドバーのチャットの画面。拡張機能のパッケージにファイルを足さずに済むよう、HTML・CSS・JS を 1 つの文字列にまとめる
const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
.app { display: flex; flex-direction: column; height: 100vh; }
.head { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 6px; }
.head select { width: 100%; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 3px 4px; }
.title { font-weight: 600; }
.meta { color: var(--vscode-descriptionForeground); font-size: 0.92em; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.meter { display: flex; align-items: center; gap: 6px; }
.bar-wrap { position: relative; width: 64px; height: 4px; }
.bar-wrap .track { position: absolute; inset: 0; border-radius: 2px; background: var(--vscode-progressBar-background); opacity: 0.25; }
.bar-wrap .fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--vscode-progressBar-background); }
.bar-wrap.warn .fill { background: var(--vscode-editorWarning-foreground); }
.bar-wrap.full .fill { background: var(--vscode-editorError-foreground); }
.log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.empty { color: var(--vscode-descriptionForeground); line-height: 1.6; }
.empty ul { padding-left: 18px; margin: 6px 0 0; }
.empty button { all: unset; cursor: pointer; color: var(--vscode-textLink-foreground); }
.msg { line-height: 1.55; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; max-width: 90%; padding: 6px 10px; border-radius: 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); white-space: pre-wrap; }
.msg.user .attached { all: unset; display: block; margin-top: 4px; font-size: 0.88em; color: var(--vscode-descriptionForeground); cursor: pointer; }
.msg.user .attached:hover { color: var(--vscode-textLink-foreground); }
.msg.assistant p { margin: 0 0 6px; }
.msg.assistant p:last-child { margin-bottom: 0; }
.msg.assistant pre { margin: 6px 0; padding: 8px; overflow-x: auto; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
.msg.assistant code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
.msg.assistant :not(pre) > code { padding: 0 3px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
.msg.assistant ul, .msg.assistant ol { margin: 4px 0; padding-left: 20px; }
.msg.assistant h1, .msg.assistant h2, .msg.assistant h3, .msg.assistant h4, .msg.assistant h5, .msg.assistant h6 { margin: 10px 0 4px; font-size: 1em; font-weight: 600; }
.msg.assistant h1, .msg.assistant h2 { font-size: 1.1em; }
.msg.assistant > :first-child { margin-top: 0; }
.msg.assistant hr { margin: 8px 0; border: 0; border-top: 1px solid var(--vscode-panel-border); }
.msg.assistant .table { margin: 6px 0; overflow-x: auto; }
.msg.assistant table { border-collapse: collapse; }
.msg.assistant th, .msg.assistant td { padding: 3px 8px; border: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: top; }
.msg.assistant th { background: var(--vscode-textCodeBlock-background); font-weight: 600; }
.msg.assistant .center { text-align: center; }
.msg.assistant .right { text-align: right; }
.tool { color: var(--vscode-descriptionForeground); font-size: 0.92em; display: flex; gap: 6px; align-items: baseline; }
.tool.failed { color: var(--vscode-errorForeground); }
.tool button { all: unset; cursor: pointer; color: var(--vscode-textLink-foreground); }
.output { flex: none; margin: -4px 0 0; padding: 6px 8px; max-height: 200px; overflow: auto; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: 0.92em; white-space: pre-wrap; overflow-wrap: anywhere; }
.changes { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; font-size: 0.92em; }
.changes ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.changes li { display: flex; gap: 8px; align-items: baseline; }
.changes li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.changes li small { flex: none; color: var(--vscode-descriptionForeground); }
.changes li button { all: unset; flex: none; margin-left: auto; cursor: pointer; color: var(--vscode-textLink-foreground); }
.changes .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.notice { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.error { color: var(--vscode-errorForeground); }
.confirm { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.confirm code { display: block; padding: 6px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere; }
.confirm .row { display: flex; gap: 6px; }
.thinking { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.thinking::after { content: '…'; animation: dots 1.2s steps(3, end) infinite; display: inline-block; width: 1em; overflow: hidden; vertical-align: bottom; }
@keyframes dots { from { width: 0; } to { width: 1em; } }
.mention { position: absolute; left: 12px; right: 12px; bottom: 100%; max-height: 220px; overflow-y: auto; padding: 2px; border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editorSuggestWidget-background, var(--vscode-dropdown-background)); box-shadow: 0 2px 8px var(--vscode-widget-shadow); }
.mention[hidden] { display: none; }
.mention button { all: unset; box-sizing: border-box; display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 3px 6px; border-radius: 3px; cursor: pointer; }
.mention button span { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mention button small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.mention button.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
.mention button.active small { color: inherit; opacity: 0.8; }
.mention .none { padding: 3px 6px; color: var(--vscode-descriptionForeground); }
.foot { position: relative; padding: 8px 12px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 6px; }
.chip { all: unset; box-sizing: border-box; align-self: flex-start; max-width: 100%; display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; font-size: 0.92em; color: var(--vscode-descriptionForeground); cursor: pointer; }
.chip[hidden] { display: none; }
.chip:hover { color: var(--vscode-foreground); }
.chip:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.chip svg { flex: none; }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip.off span { text-decoration: line-through; opacity: 0.7; }
textarea { width: 100%; min-height: 60px; max-height: 200px; resize: vertical; padding: 6px 8px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; }
textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
button.primary, button.secondary { font: inherit; padding: 4px 12px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
`

const SCRIPT = `
const vscode = acquireVsCodeApi()
const $ = (s) => document.querySelector(s)
const log = $('#log'), input = $('#input'), send = $('#send'), head = $('#head'), hint = $('#hint'), chip = $('#chip'), mention = $('#mention')
let view = null
// 「変更を元に戻す」を押して、確認を出している依頼
let reverting = null

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Markdown のライブラリを使わないのは、拡張機能に実行時の依存を足さないため。コードブロック・インラインのコード・太字・箇条書きだけを、文字を逃がしてから組み立てる
function inline(s) {
  return esc(s).replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
}
const HEADING = /^(#{1,6})\\s+(.*)$/
const LIST = /^\\s*([-*]|\\d+\\.)\\s+/
const RULE = /^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/
// 表の 2 行目（|---|:--:|）。これが続いている行だけを表として扱う
const DIVIDER = /^\\s*\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$/

// 文字を逃がした | （\\|）と、コード（\`a | b\`）の中の | で列を分けないよう、いったん別の文字に置き換えてから分ける
function cells(line) {
  const row = line.trim().replace(/^\\|/, '').replace(/\\|$/, '')
  const kept = row.replace(/\\\\\\|/g, '\\u0000').replace(/\`[^\`]*\`/g, (code) => code.replace(/\\|/g, '\\u0000'))
  return kept.split('|').map((c) => c.replace(/\\u0000/g, '|').trim())
}

function table(head, divider, rows) {
  const aligns = cells(divider).map((c) => (/^:-+:$/.test(c) ? ' class="center"' : /-:$/.test(c) ? ' class="right"' : ''))
  const row = (tag, line) => '<tr>' + cells(line).map((c, i) => '<' + tag + (aligns[i] || '') + '>' + inline(c) + '</' + tag + '>').join('') + '</tr>'
  return '<div class="table"><table><thead>' + row('th', head) + '</thead><tbody>' + rows.map((r) => row('td', r)).join('') + '</tbody></table></div>'
}

function markdown(src) {
  const out = []
  const parts = src.split(/^\`\`\`.*$/m)
  parts.forEach((part, i) => {
    if (i % 2 === 1) { out.push('<pre><code>' + esc(part.replace(/^\\n|\\n$/g, '')) + '</code></pre>'); return }
    const lines = part.split('\\n')
    const isTable = (k) => lines[k].includes('|') && k + 1 < lines.length && lines[k + 1].includes('-') && DIVIDER.test(lines[k + 1])
    let k = 0
    while (k < lines.length) {
      const line = lines[k]
      const heading = HEADING.exec(line)
      if (!line.trim()) { k++ }
      else if (heading) { const tag = 'h' + heading[1].length; out.push('<' + tag + '>' + inline(heading[2]) + '</' + tag + '>'); k++ }
      else if (RULE.test(line)) { out.push('<hr>'); k++ }
      else if (isTable(k)) {
        const rows = []
        let end = k + 2
        while (end < lines.length && lines[end].trim() && lines[end].includes('|')) rows.push(lines[end++])
        out.push(table(line, lines[k + 1], rows))
        k = end
      } else if (LIST.test(line)) {
        const ordered = /^\\s*\\d+\\./.test(line)
        const items = []
        while (k < lines.length && LIST.test(lines[k])) items.push('<li>' + inline(lines[k++].replace(LIST, '')) + '</li>')
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'))
      } else {
        const text = []
        while (k < lines.length && lines[k].trim() && !HEADING.test(lines[k]) && !RULE.test(lines[k]) && !LIST.test(lines[k]) && !isTable(k)) text.push(inline(lines[k++]))
        out.push('<p>' + text.join('<br>') + '</p>')
      }
    }
  })
  return out.join('')
}

const time = (unix) => new Date(unix * 1000).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function meter(pct) {
  const cls = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''
  // style 属性で幅を書かないのは、CSP（style-src に nonce）でインラインの style 属性が弾かれるため
  return '<span class="bar-wrap ' + cls + '"><span class="track"></span><span class="fill" data-pct="' + pct + '"></span></span>'
}

function renderHead() {
  if (!view || !view.status) { head.innerHTML = ''; return }
  const s = view.status
  const select = view.options.length > 1
    ? '<select id="pick" aria-label="アイテム">' + view.options.map((o) => '<option value="' + esc(o.key) + '"' + (o.key === view.current ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>'
    : '<div class="title">' + esc(s.title) + '</div>'
  const meta = [
    '<span>' + esc(s.course) + '</span>',
    s.closesAt ? '<span>' + time(s.closesAt) + ' まで</span>' : '',
    '<span class="meter">利用 ' + meter(s.usage) + ' ' + s.usage + '%</span>',
    '<span class="meter">会話の長さ ' + meter(view.context) + ' ' + view.context + '%</span>',
  ].filter(Boolean).join('')
  head.innerHTML = select + '<div class="meta">' + meta + '</div>'
  head.querySelectorAll('[data-pct]').forEach((el) => { el.style.width = el.dataset.pct + '%' })
  const pick = $('#pick')
  if (pick) pick.onchange = () => vscode.postMessage({ type: 'select', key: pick.value })
}

const EYE = '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'
const eye = (on) => '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' + EYE + (on ? '' : '<path d="M2.5 2.5l11 11"/>') + '</svg>'

function renderChip() {
  const e = view && view.status && view.status.state === 'ok' ? view.editor : null
  chip.hidden = !e
  if (!e) return
  chip.className = e.on ? 'chip' : 'chip off'
  chip.setAttribute('aria-pressed', String(e.on))
  chip.title = e.on
    ? '開いているファイル（' + e.file + '）と選んでいる行を、依頼と一緒に AI に伝えます。押すと伝えません。'
    : '開いているファイル（' + e.file + '）を AI に伝えません。押すと伝えます。'
  chip.innerHTML = eye(e.on) + '<span>' + esc(e.label) + '</span>'
}

// 候補を出しているあいだの様子。start は入力欄の中の @ の位置、id は最後に頼んだ候補の番号（古い応答を捨てる）
let picking = null
let mentionSeq = 0

function closeMention() {
  picking = null
  mention.hidden = true
}

// 全角の ＠ も受け付けるのは、日本語を打っている途中で ＠ になることが多いため
function updateMention() {
  const before = input.value.slice(0, input.selectionStart)
  const m = view && view.hasFolder ? /(^|\\s)[@＠]([^\\s@＠]*)$/.exec(before) : null
  if (!m) { closeMention(); return }
  picking = { start: before.length - m[2].length - 1, items: picking ? picking.items : [], index: 0, id: ++mentionSeq }
  vscode.postMessage({ type: 'files', id: picking.id, query: m[2] })
}

function renderMention() {
  if (!picking) return
  mention.hidden = false
  mention.innerHTML = picking.items.length
    ? picking.items.map((f, i) => {
        const cut = f.lastIndexOf('/')
        return '<button type="button" role="option" data-file="' + esc(f) + '"' + (i === picking.index ? ' class="active" aria-selected="true"' : '') + '><span>' + esc(f.slice(cut + 1)) + '</span><small>' + esc(f.slice(0, Math.max(cut, 0))) + '</small></button>'
      }).join('')
    : '<div class="none">合うファイルがありません</div>'
  const active = mention.querySelector('.active')
  if (active) active.scrollIntoView({ block: 'nearest' })
}

function pickMention(file) {
  if (!picking) return
  const text = '@' + (/\\s/.test(file) ? '"' + file + '"' : file) + ' '
  const caret = picking.start + text.length
  input.value = input.value.slice(0, picking.start) + text + input.value.slice(input.selectionStart)
  input.setSelectionRange(caret, caret)
  closeMention()
  input.focus()
}

const EXAMPLES = ['このフォルダーのプログラムを説明して', '今のコードのエラーを直して', '入力した数の合計を出すプログラムを作って']

function entryHtml(e) {
  if (e.kind === 'user') return '<div class="msg user">' + esc(e.text) + (e.file ? '<button class="attached" data-open="' + esc(e.file) + '" title="依頼と一緒に AI に伝えたファイル">' + esc(e.detail || e.file) + '</button>' : '') + '</div>'
  if (e.kind === 'assistant') return '<div class="msg assistant" data-id="' + e.id + '">' + (e.text ? markdown(e.text) : '<span class="thinking">考えています</span>') + '</div>'
  if (e.kind === 'tool') return '<div class="tool' + (e.failed ? ' failed' : '') + '"><span>' + (e.failed ? '⚠' : '✓') + '</span><span>' + esc(e.text) + (e.file ? ' <button data-open="' + esc(e.file) + '">開く</button>' : '') + '</span></div>' + (e.detail ? '<pre class="output" tabindex="0" aria-label="コマンドの出力">' + esc(e.detail) + '</pre>' : '')
  if (e.kind === 'changes') {
    const files = e.files.map((f) => {
      const cut = f.file.lastIndexOf('/')
      const diff = e.state === 'active' ? '<button data-diff="' + e.id + '" data-file="' + esc(f.file) + '">差分を見る</button>' : ''
      return '<li><span title="' + esc(f.file) + '">' + esc(f.file.slice(cut + 1)) + '</span><small>' + (f.created ? '作成' : '変更') + '</small>' + diff + '</li>'
    }).join('')
    const foot = e.state === 'reverted' ? '<div class="notice">依頼の前の内容に戻しました</div>'
      : e.state !== 'active' ? ''
      : reverting === e.id ? '<div class="notice">依頼の前の内容に戻します。そのあとに自分で書き換えた内容も失われます。</div><div class="row"><button class="primary" data-revert="' + e.id + '">戻す</button><button class="secondary" data-cancel-revert="1">やめる</button></div>'
      : '<div class="row"><button class="secondary" data-ask-revert="' + e.id + '"' + (view.running ? ' disabled' : '') + '>変更を元に戻す</button></div>'
    return '<div class="changes"><div>この依頼で AI が書き換えたファイル</div><ul>' + files + '</ul>' + foot + '</div>'
  }
  if (e.kind === 'notice') return '<div class="notice">' + esc(e.text) + '</div>'
  if (e.kind === 'error') return '<div class="error">' + esc(e.text) + '</div>'
  if (e.kind === 'confirm') {
    const state = e.state === 'pending'
      ? '<div class="row"><button class="primary" data-confirm="' + e.id + '" data-ok="1">実行する</button><button class="secondary" data-confirm="' + e.id + '" data-ok="0">実行しない</button></div>'
      : '<div class="notice">' + (e.state === 'approved' ? '実行しました' : '実行しませんでした') + '</div>'
    return '<div class="confirm"><div>AI がコマンドを実行しようとしています' + (e.detail ? '（' + esc(e.detail) + '）' : '') + '</div><code>' + esc(e.text) + '</code>' + (e.input ? '<div class="notice">プログラムに渡す入力</div><code>' + esc(e.input) + '</code>' : '') + state + '</div>'
  }
  return ''
}

function render() {
  renderHead()
  renderChip()
  if (!view) return
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
  if (!view.entries.length) {
    log.innerHTML = '<div class="empty">' + (view.hasFolder
      ? '頼みたいことを書いて送ってください。AI が開いているフォルダーのファイルを読み書きしてプログラムを書きます。コマンドを実行するときは、毎回確認します。エディターで開いているファイルと選んでいる行も、依頼と一緒に AI に伝わります。<ul>' + EXAMPLES.map((x) => '<li><button data-example="' + esc(x) + '">' + esc(x) + '</button></li>').join('') + '</ul>'
      : 'フォルダーを開いてから使ってください。AI は開いているフォルダーの中のファイルを読み書きします。') + '</div>'
  } else {
    log.innerHTML = view.entries.map(entryHtml).join('')
  }
  if (atBottom || view.running) log.scrollTop = log.scrollHeight
  const blocked = !view.status || view.status.state !== 'ok'
  send.textContent = view.running ? '止める' : '送信'
  send.className = view.running ? 'secondary' : 'primary'
  send.disabled = !view.running && (blocked || !view.hasFolder)
  input.disabled = blocked
  hint.textContent = blocked ? (view.status ? view.status.message : '') : 'Enter で送信、Shift + Enter で改行'
}

window.addEventListener('message', (event) => {
  const m = event.data
  if (m.type === 'render') { view = m.view; render() }
  else if (m.type === 'editor' && view) { view.editor = m.editor; renderChip() }
  else if (m.type === 'files' && picking && m.id === picking.id) { picking.items = m.files; picking.index = 0; renderMention() }
  else if (m.type === 'delta' && view) {
    const entry = view.entries.find((e) => e.id === m.id)
    if (!entry) return
    entry.text += m.text
    const el = log.querySelector('[data-id="' + m.id + '"]')
    if (el) el.innerHTML = markdown(entry.text)
    log.scrollTop = log.scrollHeight
  }
})

function submit() {
  if (view && view.running) { vscode.postMessage({ type: 'stop' }); return }
  const text = input.value.trim()
  if (!text || send.disabled) return
  vscode.postMessage({ type: 'send', text })
  input.value = ''
  closeMention()
}

send.addEventListener('click', submit)
chip.addEventListener('click', () => vscode.postMessage({ type: 'toggleEditor' }))
input.addEventListener('keydown', (e) => {
  if (picking && !mention.hidden && !e.isComposing) {
    const n = picking.items.length
    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return }
    if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      picking.index = (picking.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      renderMention()
      return
    }
    if (n && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(picking.items[picking.index]); return }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!view || !view.running) submit() }
})
// 変換の途中で候補を出さないのは、確定の Enter で候補を選んでしまうため
input.addEventListener('input', (e) => { if (!e.isComposing) updateMention() })
input.addEventListener('compositionend', updateMention)
input.addEventListener('click', updateMention)
input.addEventListener('blur', closeMention)
// mousedown で止めるのは、入力欄からフォーカスが外れて、押す前に候補が閉じるのを防ぐため
mention.addEventListener('mousedown', (e) => {
  e.preventDefault()
  const t = e.target.closest('button')
  if (t) pickMention(t.dataset.file)
})
log.addEventListener('click', (e) => {
  const t = e.target.closest('button')
  if (!t) return
  if (t.dataset.open) vscode.postMessage({ type: 'openFile', file: t.dataset.open })
  else if (t.dataset.confirm) vscode.postMessage({ type: 'confirm', id: Number(t.dataset.confirm), ok: t.dataset.ok === '1' })
  else if (t.dataset.example) { input.value = t.dataset.example; input.focus() }
  else if (t.dataset.diff) vscode.postMessage({ type: 'diff', id: Number(t.dataset.diff), file: t.dataset.file })
  else if (t.dataset.askRevert) { reverting = Number(t.dataset.askRevert); render() }
  else if (t.dataset.cancelRevert) { reverting = null; render() }
  else if (t.dataset.revert) { reverting = null; vscode.postMessage({ type: 'revert', id: Number(t.dataset.revert) }) }
})
vscode.postMessage({ type: 'ready' })
`

export function agentHtml(cspSource: string, nonce: string) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="app">
  <div class="head" id="head"></div>
  <div class="log" id="log" aria-live="polite"></div>
  <div class="foot">
    <div id="mention" class="mention" role="listbox" aria-label="ファイルの候補" hidden></div>
    <button id="chip" class="chip" type="button" hidden></button>
    <textarea id="input" placeholder="AI に頼みたいことを書いてください（@ でファイルを指定）" aria-label="依頼"></textarea>
    <div class="actions"><span class="hint" id="hint"></span><button id="send" class="primary">送信</button></div>
  </div>
</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}
