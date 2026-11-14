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
.msg.assistant p { margin: 0 0 6px; }
.msg.assistant p:last-child { margin-bottom: 0; }
.msg.assistant pre { margin: 6px 0; padding: 8px; overflow-x: auto; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
.msg.assistant code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
.msg.assistant :not(pre) > code { padding: 0 3px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
.msg.assistant ul, .msg.assistant ol { margin: 4px 0; padding-left: 20px; }
.tool { color: var(--vscode-descriptionForeground); font-size: 0.92em; display: flex; gap: 6px; align-items: baseline; }
.tool.failed { color: var(--vscode-errorForeground); }
.tool button { all: unset; cursor: pointer; color: var(--vscode-textLink-foreground); }
.notice { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.error { color: var(--vscode-errorForeground); }
.confirm { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.confirm code { display: block; padding: 6px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere; }
.confirm .row { display: flex; gap: 6px; }
.thinking { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.thinking::after { content: '…'; animation: dots 1.2s steps(3, end) infinite; display: inline-block; width: 1em; overflow: hidden; vertical-align: bottom; }
@keyframes dots { from { width: 0; } to { width: 1em; } }
.foot { padding: 8px 12px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 6px; }
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
const log = $('#log'), input = $('#input'), send = $('#send'), head = $('#head'), hint = $('#hint')
let view = null

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Markdown のライブラリを使わないのは、拡張機能に実行時の依存を足さないため。コードブロック・インラインのコード・太字・箇条書きだけを、文字を逃がしてから組み立てる
function inline(s) {
  return esc(s).replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
}
function markdown(src) {
  const out = []
  const parts = src.split(/^\`\`\`.*$/m)
  parts.forEach((part, i) => {
    if (i % 2 === 1) { out.push('<pre><code>' + esc(part.replace(/^\\n|\\n$/g, '')) + '</code></pre>'); return }
    let list = null
    for (const block of part.split(/\\n{2,}/)) {
      const lines = block.split('\\n').filter((l) => l.trim())
      if (!lines.length) continue
      if (lines.every((l) => /^\\s*([-*]|\\d+\\.)\\s+/.test(l))) {
        const ordered = /^\\s*\\d+\\./.test(lines[0])
        out.push((ordered ? '<ol>' : '<ul>') + lines.map((l) => '<li>' + inline(l.replace(/^\\s*([-*]|\\d+\\.)\\s+/, '')) + '</li>').join('') + (ordered ? '</ol>' : '</ul>'))
      } else {
        out.push('<p>' + lines.map(inline).join('<br>') + '</p>')
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

const EXAMPLES = ['このフォルダーのプログラムを説明して', '今のコードのエラーを直して', '入力した数の合計を出すプログラムを作って']

function entryHtml(e) {
  if (e.kind === 'user') return '<div class="msg user">' + esc(e.text) + '</div>'
  if (e.kind === 'assistant') return '<div class="msg assistant" data-id="' + e.id + '">' + (e.text ? markdown(e.text) : '<span class="thinking">考えています</span>') + '</div>'
  if (e.kind === 'tool') return '<div class="tool' + (e.failed ? ' failed' : '') + '"><span>' + (e.failed ? '⚠' : '✓') + '</span><span>' + esc(e.text) + (e.file ? ' <button data-open="' + esc(e.file) + '">開く</button>' : '') + '</span></div>'
  if (e.kind === 'notice') return '<div class="notice">' + esc(e.text) + '</div>'
  if (e.kind === 'error') return '<div class="error">' + esc(e.text) + '</div>'
  if (e.kind === 'confirm') {
    const state = e.state === 'pending'
      ? '<div class="row"><button class="primary" data-confirm="' + e.id + '" data-ok="1">実行する</button><button class="secondary" data-confirm="' + e.id + '" data-ok="0">実行しない</button></div>'
      : '<div class="notice">' + (e.state === 'approved' ? '実行しました' : '実行しませんでした') + '</div>'
    return '<div class="confirm"><div>AI がコマンドを実行しようとしています' + (e.detail ? '（' + esc(e.detail) + '）' : '') + '</div><code>' + esc(e.text) + '</code>' + state + '</div>'
  }
  return ''
}

function render() {
  renderHead()
  if (!view) return
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
  if (!view.entries.length) {
    log.innerHTML = '<div class="empty">' + (view.hasFolder
      ? '頼みたいことを書いて送ってください。AI が開いているフォルダーのファイルを読み書きしてプログラムを書きます。コマンドを実行するときは、毎回確認します。<ul>' + EXAMPLES.map((x) => '<li><button data-example="' + esc(x) + '">' + esc(x) + '</button></li>').join('') + '</ul>'
      : 'フォルダーを開いてから使ってください。AI は開いているフォルダーの中のファイルを読み書きします。') + '</div>'
  } else {
    log.innerHTML = view.entries.map(entryHtml).join('')
  }
  if (atBottom || view.running) log.scrollTop = log.scrollHeight
  const full = view.context >= 100
  const blocked = !view.status || view.status.state !== 'ok'
  send.textContent = view.running ? '止める' : '送信'
  send.className = view.running ? 'secondary' : 'primary'
  send.disabled = !view.running && (blocked || full || !view.hasFolder)
  input.disabled = blocked || full
  hint.textContent = blocked ? (view.status ? view.status.message : '') : full ? '会話が長くなりました。右上の＋（新しいチャット）から続けてください。' : 'Enter で送信、Shift + Enter で改行'
}

window.addEventListener('message', (event) => {
  const m = event.data
  if (m.type === 'render') { view = m.view; render() }
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
}

send.addEventListener('click', submit)
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!view || !view.running) submit() }
})
log.addEventListener('click', (e) => {
  const t = e.target.closest('button')
  if (!t) return
  if (t.dataset.open) vscode.postMessage({ type: 'openFile', file: t.dataset.open })
  else if (t.dataset.confirm) vscode.postMessage({ type: 'confirm', id: Number(t.dataset.confirm), ok: t.dataset.ok === '1' })
  else if (t.dataset.example) { input.value = t.dataset.example; input.focus() }
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
    <textarea id="input" placeholder="AI に頼みたいことを書いてください" aria-label="依頼"></textarea>
    <div class="actions"><span class="hint" id="hint"></span><button id="send" class="primary">送信</button></div>
  </div>
</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}
