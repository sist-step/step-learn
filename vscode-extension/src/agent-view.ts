import crypto from 'node:crypto'
import path from 'node:path'
import * as vscode from 'vscode'
import { ChangeHistory, currentText, writeDocument, type ChangeSet } from './agent-changes'
import { ChatStore, type Entry, type StoredChat } from './agent-chats'
import {
  AgentTokenError,
  SUPPORTED_TOOLS,
  createToolRunner,
  editorLabel,
  fetchAgentStatus,
  matchFiles,
  revokeAgent,
  sendAgentMessages,
  summarizeAgent,
  summaryMessage,
  withEditorContext,
  type AgentGrant,
  type AgentStatus,
  type Diagnostic,
  type EditorContext,
} from './agent-core'
import { TerminalRecorder } from './agent-terminal'
import { agentHtml } from './agent-webview'
import { EXCLUDED_GLOB, isExcluded, relativePath } from './history'
import { SyncError, parseServer } from './sync'

/** globalState のキー。値は「サーバー アイテムの ref」ごとのつないだアイテム */
const CONNECTIONS_KEY = 'agentConnections'
const tokenKey = (key: string) => `agentToken:${key}`

/** globalState のキー。値は、開いているファイルを依頼に付けるか（入力欄の上の表示で切り替える） */
const ATTACH_KEY = 'agentAttachEditor'

/** サイドバーを出すかを決める when 句のキー（package.json の views） */
const CONTEXT_KEY = 'stepLearn.agentAvailable'

/** 左のバーに出すサイドバーの ID と、右側のサイドバーに出すサイドバーの ID（package.json の views） */
const VIEW_ID = 'stepLearn.agent'
const SECONDARY_VIEW_ID = 'stepLearn.agentSecondary'

// 「右側に出せる」ではなく「出せない」のキーにするのは、キーを決める前（起動した直後）に、新しい VS Code で左のバーに一瞬出るのを避けるため
/** 右側のサイドバーに出せない VS Code のときに立てる when 句のキー */
const NO_SECONDARY_KEY = 'stepLearn.noSecondarySidebar'

/** 拡張機能が右側のサイドバーに出せるのは VS Code 1.106 から */
function supportsSecondarySidebar() {
  const [major = 0, minor = 0] = vscode.version.split('.').map(Number)
  return major > 1 || (major === 1 && minor >= 106)
}

/** @ の候補に出すファイルを調べ直すまでの時間。文字を打つたびにフォルダーを調べ直さない */
const FILES_TTL = 5000
const MAX_MENTION_FILES = 5000

// 使える期間とその前後だけ短くするのは、期間の始まりと終わりですぐに出し入れしつつ、授業のない日に STEP Learn を何度も呼ばないため
const REFRESH_SOON = 60_000
const REFRESH_IDLE = 15 * 60_000
const SOON = 30 * 60

/** 期間が終わってからこれだけたったアイテムは、つないだ記録ごと消す。先生が期間を延ばすことがあるので、すぐには消さない */
const FORGET_AFTER = 30 * 24 * 60 * 60

/** 1 回の依頼で AI とやり取りする回数の上限。ツールを呼び続けて止まらなくなるのを防ぐ */
const MAX_TURNS = 40

/** ファイルを書き換えてから「問題」を読むまでに空ける時間。言語の拡張機能が調べ直すまでは、前の内容の結果が残っている */
const DIAGNOSTICS_DELAY = 1500

/** 依頼の途中で会話を要約に置き換えたあと、作業を続けさせる発言 */
const RESUME = '要約をもとに、作業の続きを進めてください。'

type Saved = { server: string; ref: string; course: string; title: string; user: { id: number; name: string } }

type Chat = StoredChat & { running?: AbortController }

const newChat = (): Chat => ({ messages: [], entries: [], contextTokens: 0, notes: [] })

const nowSec = () => Math.floor(Date.now() / 1000)

export class AgentController implements vscode.WebviewViewProvider {
  private statuses = new Map<string, AgentStatus>()
  private chats = new Map<string, Chat>()
  private current: string | null = null
  private view: vscode.WebviewView | null = null
  private confirms = new Map<number, (ok: boolean) => void>()
  private nextId = 1
  private timer: NodeJS.Timeout | undefined
  private attach: boolean
  private postedEditor = ''
  private files: { at: number; root: string; list: Promise<string[]> } | null = null
  private readonly viewId = supportsSecondarySidebar() ? SECONDARY_VIEW_ID : VIEW_ID
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  private readonly history = new ChangeHistory()
  private readonly terminal = new TerminalRecorder()
  private readonly store: ChatStore
  private loaded: Promise<void> = Promise.resolve()
  private lastWrite = 0

  constructor(private readonly context: vscode.ExtensionContext) {
    this.attach = context.globalState.get(ATTACH_KEY, true)
    this.store = new ChatStore(context.storageUri?.fsPath)
  }

  start() {
    if (this.viewId === VIEW_ID) void vscode.commands.executeCommand('setContext', NO_SECONDARY_KEY, true)
    // 右側のサイドバーは閉じていると何も見えないので、使えるあいだはステータスバーから開けるようにする
    this.statusBar.text = '$(comment-discussion) STEP Learn AI'
    this.statusBar.tooltip = 'コーディングエージェントを開く'
    this.statusBar.command = 'stepLearn.agent.open'
    this.history.start(this.context)
    this.terminal.start(this.context)
    this.loaded = this.restore()
    this.context.subscriptions.push(
      this.statusBar,
      vscode.window.registerWebviewViewProvider(this.viewId, this),
      vscode.commands.registerCommand('stepLearn.agent.open', () => vscode.commands.executeCommand(`${this.viewId}.focus`)),
      vscode.window.onDidChangeWindowState((s) => s.focused && void this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.render()),
      vscode.window.onDidChangeActiveTextEditor(() => this.postEditor()),
      vscode.window.onDidChangeTextEditorSelection((e) => e.textEditor === vscode.window.activeTextEditor && this.postEditor()),
      vscode.commands.registerCommand('stepLearn.agent.newChat', () => this.resetChat()),
      vscode.commands.registerCommand('stepLearn.agent.disconnect', () => this.disconnect()),
      { dispose: () => clearTimeout(this.timer) },
    )
    void this.refresh()
  }

  private saved() {
    return this.context.globalState.get<Record<string, Saved>>(CONNECTIONS_KEY, {})
  }

  /** 前に VS Code を閉じたときの会話を戻す */
  private async restore() {
    for (const [key, chat] of await this.store.load()) this.chats.set(key, chat)
    const last = [...this.chats.values()].flatMap((c) => c.entries).reduce((max, e) => Math.max(max, e.id), 0)
    this.nextId = last + 1
  }

  private save() {
    this.store.save(new Map([...this.chats].map(([key, { running: _, ...chat }]) => [key, chat])))
  }

  /** STEP Learn の画面のリンクから受け取ったトークンを覚え、サイドバーを開く */
  async connect(server: URL, grant: AgentGrant) {
    const key = `${server.origin} ${grant.ref}`
    await this.context.secrets.store(tokenKey(key), grant.token)
    const saved = { server: server.origin, ref: grant.ref, course: grant.course, title: grant.title, user: grant.user }
    await this.context.globalState.update(CONNECTIONS_KEY, { ...this.saved(), [key]: saved })
    this.current = key
    await this.refresh()
    const status = this.statuses.get(key)
    if (status?.open) {
      await vscode.commands.executeCommand(`${this.viewId}.focus`)
      void vscode.window.showInformationMessage(`「${grant.title}」のコーディングエージェントを使えるようにしました。`)
    } else {
      void vscode.window.showInformationMessage(
        `「${grant.title}」のコーディングエージェントを登録しました。${status?.message ?? ''}使える期間になると、${this.viewId === VIEW_ID ? '左のバー' : '右側のサイドバー'}に STEP Learn が表示されます。`,
      )
    }
  }

  private async forget(key: string) {
    const { [key]: _, ...rest } = this.saved()
    await this.context.globalState.update(CONNECTIONS_KEY, rest)
    await this.context.secrets.delete(tokenKey(key))
    this.statuses.delete(key)
    this.chats.get(key)?.running?.abort()
    this.chats.delete(key)
    this.save()
  }

  /** つないだアイテムの状態を確かめ直し、サイドバーを出すかを決める */
  async refresh() {
    // 会話を戻し終える前に進めないのは、戻す前に始めた会話が、戻した会話で上書きされるため
    await this.loaded
    for (const [key, saved] of Object.entries(this.saved())) {
      const server = parseServer(saved.server)
      const token = await this.context.secrets.get(tokenKey(key))
      if (!server || !token) {
        await this.forget(key)
        continue
      }
      try {
        const status = await fetchAgentStatus(server, token)
        if (status.closesAt !== null && status.closesAt + FORGET_AFTER < nowSec()) {
          await this.forget(key)
          continue
        }
        this.statuses.set(key, status)
      } catch (e) {
        if (e instanceof AgentTokenError) await this.forget(key)
        // つながらないときは前の状態のままにする。少しネットワークが切れただけで、会話の途中のサイドバーを消さないため
      }
    }
    const open = [...this.statuses].filter(([, s]) => s.open).map(([k]) => k)
    if (!this.current || !open.includes(this.current)) this.current = open[0] ?? null
    await vscode.commands.executeCommand('setContext', CONTEXT_KEY, open.length > 0)
    if (open.length > 0) this.statusBar.show()
    else this.statusBar.hide()
    this.terminal.setActive(open.length > 0)
    this.render()
    const soon = [...this.statuses.values()].some(
      (st) => st.open || (st.opensAt !== null && st.closesAt !== null && st.opensAt - SOON < nowSec() && nowSec() < st.closesAt + SOON),
    )
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), soon ? REFRESH_SOON : REFRESH_IDLE)
  }

  private async disconnect() {
    const entries = Object.entries(this.saved())
    if (!entries.length) {
      void vscode.window.showInformationMessage('つないでいるコーディングエージェントはありません。')
      return
    }
    const picked = await vscode.window.showQuickPick(
      entries.map(([key, s]) => ({ label: s.title, description: `${s.course}・${new URL(s.server).host}`, key })),
      { title: '接続を解除するアイテム', placeHolder: 'この PC で使えなくするアイテムを選んでください' },
    )
    if (!picked) return
    const token = await this.context.secrets.get(tokenKey(picked.key))
    const server = parseServer(this.saved()[picked.key]?.server ?? '')
    if (server && token) await revokeAgent(server, token)
    await this.forget(picked.key)
    await this.refresh()
    void vscode.window.showInformationMessage(`「${picked.label}」の接続を解除しました。`)
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    const nonce = crypto.randomBytes(16).toString('base64')
    view.webview.options = { enableScripts: true, localResourceRoots: [] }
    view.webview.html = agentHtml(view.webview.cspSource, nonce)
    view.webview.onDidReceiveMessage((m: unknown) => void this.receive(m))
    view.onDidChangeVisibility(() => view.visible && void this.refresh())
    view.onDidDispose(() => {
      if (this.view === view) this.view = null
    })
  }

  private async receive(m: unknown) {
    if (typeof m !== 'object' || m === null || !('type' in m)) return
    const msg = m as { type: string; text?: unknown; key?: unknown; id?: unknown; ok?: unknown; file?: unknown; query?: unknown }
    if (msg.type === 'ready') this.render()
    else if (msg.type === 'send' && typeof msg.text === 'string' && msg.text.trim()) await this.send(msg.text.trim())
    else if (msg.type === 'stop') this.chatOf(this.current)?.running?.abort()
    else if (msg.type === 'newChat') this.resetChat()
    else if (msg.type === 'select' && typeof msg.key === 'string' && this.statuses.get(msg.key)?.open) {
      this.current = msg.key
      this.render()
    } else if (msg.type === 'confirm' && typeof msg.id === 'number') {
      this.confirms.get(msg.id)?.(msg.ok === true)
      this.confirms.delete(msg.id)
    } else if (msg.type === 'openFile' && typeof msg.file === 'string') await this.openFile(msg.file)
    else if (msg.type === 'files' && typeof msg.id === 'number' && typeof msg.query === 'string')
      this.post({ type: 'files', id: msg.id, files: matchFiles(await this.workspaceFiles(), msg.query) })
    else if (msg.type === 'diff' && typeof msg.id === 'number' && typeof msg.file === 'string') await this.showDiff(msg.id, msg.file)
    else if (msg.type === 'revert' && typeof msg.id === 'number') await this.revert(msg.id)
    else if (msg.type === 'toggleEditor') {
      this.attach = !this.attach
      await this.context.globalState.update(ATTACH_KEY, this.attach)
      this.postEditor()
    }
  }

  private chatOf(key: string | null) {
    if (!key) return null
    let chat = this.chats.get(key)
    if (!chat) this.chats.set(key, (chat = newChat()))
    return chat
  }

  private resetChat() {
    const chat = this.chatOf(this.current)
    if (!chat) return
    chat.running?.abort()
    this.history.forget(chat.entries.map((e) => e.id))
    this.chats.set(this.current!, newChat())
    this.save()
    this.render()
  }

  private async showDiff(id: number, rel: string) {
    const root = this.root()
    if (root && !rel.split('/').includes('..')) await this.history.showDiff(id, path.join(root, ...rel.split('/')))
  }

  /** 依頼で AI が書き換えたファイルを、依頼の前の内容に戻す。確かめるのは画面の側（押したあとに「戻す」をもう一度押す） */
  private async revert(id: number) {
    const chat = this.chatOf(this.current)
    const entry = chat?.entries.find((e) => e.id === id && e.kind === 'changes')
    if (!chat || chat.running || entry?.state !== 'active' || !this.history.has(id)) return
    try {
      await this.history.revert(id)
    } catch (e) {
      this.add(chat, { kind: 'error', text: `元に戻せませんでした（${e instanceof Error ? e.message : String(e)}）。` })
      return
    }
    entry.state = 'reverted'
    const names = (entry.files ?? []).map((f) => f.file).join('、')
    chat.notes.push(`（学生が、前の依頼で AI が書き換えたファイル（${names}）を、その依頼の前の内容に戻した）`)
    this.save()
    this.render()
  }

  private async diagnostics(root: string): Promise<Diagnostic[]> {
    const wait = this.lastWrite + DIAGNOSTICS_DELAY - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    const severities = new Map([
      [vscode.DiagnosticSeverity.Error, 'error' as const],
      [vscode.DiagnosticSeverity.Warning, 'warning' as const],
    ])
    return vscode.languages.getDiagnostics().flatMap(([uri, list]) => {
      if (uri.scheme !== 'file' || !relativePath(root, uri.fsPath)) return []
      return list.flatMap((d) => {
        const severity = severities.get(d.severity)
        return severity ? [{ file: uri.fsPath, line: d.range.start.line + 1, severity, message: d.message, source: d.source }] : []
      })
    })
  }

  /** 長くなった会話を要約に置き換える。resume は、依頼の途中で、続きの作業が残っているとき。置き換えられなければ false */
  private async compact(chat: Chat, server: URL, token: string, status: AgentStatus | undefined, signal: AbortSignal, resume: boolean) {
    const note = this.add(chat, { kind: 'notice', text: '会話が長くなったので、これまでの内容を要約しています…' })
    try {
      const { summary, usage } = await summarizeAgent(server, token, chat.messages, signal)
      chat.messages = [summaryMessage(summary), ...(resume ? [{ role: 'user' as const, content: RESUME }] : [])]
      chat.contextTokens = 0
      if (status && usage !== null) status.usage = usage
      note.text = '会話が長くなったので、これまでの内容を要約して続けます。'
      return true
    } catch (e) {
      note.text = signal.aborted
        ? '会話の要約を止めました。'
        : '会話が長くなりましたが、要約できませんでした。「新しいチャット」を押して、続きの依頼をしてください。'
      if (signal.aborted) throw e
      return false
    } finally {
      this.render()
    }
  }

  private root() {
    return vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath ?? null
  }

  /** いま開いているファイルと選んでいる行。開いているフォルダーの外のファイルは、AI が読み書きできないので伝えない */
  private activeEditor() {
    const root = this.root()
    const editor = vscode.window.activeTextEditor
    if (!root || editor?.document.uri.scheme !== 'file') return null
    const file = relativePath(root, editor.document.uri.fsPath)
    if (!file) return null
    const { selection, document } = editor
    if (selection.isEmpty) return { file, document, selection: undefined }
    // 行の頭で終わる選択の最後の行を数えないのは、行を丸ごと選ぶとカーソルが次の行の頭に来て、選んでいない行まで入るため
    const last = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line
    return { file, document, selection: { start: selection.start.line + 1, end: last + 1 } }
  }

  private editorContext(): EditorContext | null {
    const active = this.activeEditor()
    if (!active) return null
    const { file, document, selection } = active
    if (!selection) return { file }
    const lines = Array.from({ length: selection.end - selection.start + 1 }, (_, i) => document.lineAt(selection.start - 1 + i).text)
    return { file, selection: { ...selection, lines } }
  }

  /** 入力欄の上に出す、開いているファイルの表示 */
  private editorChip() {
    const active = this.activeEditor()
    return active && { label: editorLabel(active), file: active.file, on: this.attach }
  }

  // カーソルを動かすたびに画面全体を描き直さないよう、表示が変わったときだけ送る
  private postEditor() {
    const editor = this.editorChip()
    const json = JSON.stringify(editor)
    if (json === this.postedEditor) return
    this.postedEditor = json
    this.post({ type: 'editor', editor })
  }

  /** 開いているフォルダーの中のファイル（/ 区切りの相対パス）。入力欄の @ の候補に使う */
  private workspaceFiles() {
    const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')
    if (!folder) return Promise.resolve([])
    const root = folder.uri.fsPath
    if (this.files?.root === root && Date.now() - this.files.at < FILES_TTL) return this.files.list
    const list = Promise.resolve(
      vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), EXCLUDED_GLOB, MAX_MENTION_FILES),
    ).then(
      // glob で除いたうえでもう一度確かめるのは、glob が除くのはフォルダーの中だけで、.DS_Store のようなファイルは残るため
      (uris) => uris.flatMap((uri) => relativePath(root, uri.fsPath) ?? []).filter((file) => !isExcluded(file)),
      (): string[] => [],
    )
    this.files = { at: Date.now(), root, list }
    return list
  }

  private async openFile(rel: string) {
    const root = this.root()
    if (!root || rel.split('/').includes('..')) return
    const uri = vscode.Uri.file(path.join(root, ...rel.split('/')))
    await vscode.window.showTextDocument(uri, { preview: true }).then(undefined, () => undefined)
  }

  private add(chat: Chat, entry: Omit<Entry, 'id'>) {
    const full = { ...entry, id: this.nextId++ }
    chat.entries.push(full)
    this.render()
    return full
  }

  private post(message: Record<string, unknown>) {
    void this.view?.webview.postMessage(message)
  }

  private render() {
    const key = this.current
    const status = key ? this.statuses.get(key) : undefined
    const chat = this.chatOf(key)
    const saved = this.saved()
    const options = [...this.statuses]
      .filter(([, s]) => s.open)
      .map(([k, s]) => ({ key: k, label: `${s.title}（${s.course}）`, server: saved[k] ? new URL(saved[k].server).host : '' }))
    const editor = this.editorChip()
    this.postedEditor = JSON.stringify(editor)
    this.post({
      type: 'render',
      view: {
        options,
        current: key,
        status: status ?? null,
        entries: chat?.entries ?? [],
        running: !!chat?.running,
        hasFolder: !!this.root(),
        editor,
        context: status && chat ? Math.min(100, Math.round((chat.contextTokens / status.contextLimit) * 100)) : 0,
      },
    })
  }

  private async send(text: string) {
    const key = this.current
    const chat = this.chatOf(key)
    const saved = key ? this.saved()[key] : undefined
    const server = parseServer(saved?.server ?? '')
    const token = key ? await this.context.secrets.get(tokenKey(key)) : undefined
    const root = this.root()
    const status = key ? this.statuses.get(key) : undefined
    if (!key || !chat || !server || !token || chat.running) return
    if (!root) {
      this.add(chat, {
        kind: 'notice',
        text: 'フォルダーを開いてから使ってください。AI は開いているフォルダーの中のファイルを読み書きします。',
      })
      return
    }

    const controller = new AbortController()
    chat.running = controller
    const changes: ChangeSet = new Map()
    const editor = this.attach ? this.editorContext() : null
    this.add(chat, { kind: 'user', text, detail: editor ? editorLabel(editor) : undefined, file: editor?.file })
    /** 会話が長くなっていたら、要約に置き換える。置き換えられなかったら false */
    const fits = async (resume: boolean) =>
      !status || chat.contextTokens < status.contextLimit || this.compact(chat, server, token, status, controller.signal, resume)

    const run = createToolRunner(root, {
      unsaved: (file) => vscode.workspace.textDocuments.find((d) => d.isDirty && d.uri.fsPath === file)?.getText(),
      write: async (file, content) => {
        if (!changes.has(file)) changes.set(file, await currentText(file))
        await writeDocument(file, content)
        this.lastWrite = Date.now()
      },
      confirm: (command, reason, stdin) => this.confirm(chat, command, reason, stdin, controller.signal),
      diagnostics: () => this.diagnostics(root),
      terminal: () => this.terminal.recent(),
      signal: controller.signal,
    })

    try {
      if (!(await fits(false))) return
      const request = editor ? withEditorContext(text, editor) : text
      chat.messages.push({ role: 'user', content: [...chat.notes.splice(0), request].join('\n\n') })
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const entry = this.add(chat, { kind: 'assistant', text: '' })
        const { reply, contextTokens, usage } = await sendAgentMessages(
          server,
          token,
          { messages: chat.messages, platform: process.platform, tools: SUPPORTED_TOOLS },
          {
            onText: (delta) => {
              entry.text += delta
              this.post({ type: 'delta', id: entry.id, text: delta })
            },
            signal: controller.signal,
          },
        )
        entry.text = reply.text
        if (!entry.text) chat.entries.splice(chat.entries.indexOf(entry), 1)
        chat.messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls, native: reply.native })
        chat.contextTokens = contextTokens
        if (status) status.usage = usage
        this.render()
        if (reply.stop === 'refusal') this.add(chat, { kind: 'notice', text: 'AI がこの依頼には応答できませんでした。' })
        if (!reply.toolCalls.length) break
        for (const call of reply.toolCalls) {
          // 実行しなかった呼び出しにも結果を返すのは、結果のないツールの呼び出しが会話に残ると、次の依頼が弾かれるため
          if (controller.signal.aborted || reply.stop !== 'tools') {
            const why = controller.signal.aborted ? '学生が止めました。' : '応答が長すぎて途中で切れたため、実行しませんでした。'
            chat.messages.push({ role: 'tool', toolCallId: call.id, content: why, isError: true })
            continue
          }
          const result = await run(call)
          chat.messages.push({ role: 'tool', toolCallId: call.id, content: result.content, isError: result.isError })
          this.add(chat, {
            kind: 'tool',
            text: result.summary,
            detail: result.output || undefined,
            file: result.isError ? undefined : result.file,
            failed: result.isError,
          })
        }
        if (controller.signal.aborted) break
        this.save()
        if (turn === MAX_TURNS - 1) {
          this.add(chat, { kind: 'notice', text: 'やり取りが長くなったため、いったん止めました。続けるときは「続けて」と送ってください。' })
          break
        }
        if (!(await fits(true))) break
      }
    } catch (e) {
      const last = chat.entries.at(-1)
      if (last?.kind === 'assistant' && !last.text) chat.entries.pop()
      if (controller.signal.aborted) this.add(chat, { kind: 'notice', text: '止めました。' })
      else {
        this.add(chat, {
          kind: 'error',
          text: e instanceof SyncError ? e.message : `失敗しました（${e instanceof Error ? e.message : String(e)}）。`,
        })
        void this.refresh()
      }
    } finally {
      chat.running = undefined
      for (const [id, resolve] of this.confirms) {
        resolve(false)
        this.confirms.delete(id)
      }
      if (changes.size) {
        const files = [...changes].map(([file, before]) => ({ file: relativePath(root, file) ?? file, created: before === null }))
        this.history.keep(this.add(chat, { kind: 'changes', text: '', files, state: 'active' }).id, changes)
      }
      this.save()
      this.render()
    }
  }

  private confirm(chat: Chat, command: string, reason: string, stdin: string | undefined, signal: AbortSignal) {
    const entry = this.add(chat, { kind: 'confirm', text: command, detail: reason, input: stdin, state: 'pending' })
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        entry.state = ok ? 'approved' : 'denied'
        this.render()
        resolve(ok)
      }
      this.confirms.set(entry.id, done)
      signal.addEventListener('abort', () => {
        if (this.confirms.delete(entry.id)) done(false)
      })
    })
  }
}
