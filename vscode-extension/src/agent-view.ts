import crypto from 'node:crypto'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  AgentTokenError,
  createToolRunner,
  fetchAgentStatus,
  revokeAgent,
  sendAgentMessages,
  type AgentGrant,
  type AgentMessage,
  type AgentStatus,
} from './agent-core'
import { agentHtml } from './agent-webview'
import { SyncError, parseServer } from './sync'

/** globalState のキー。値は「サーバー アイテムの ref」ごとのつないだアイテム */
const CONNECTIONS_KEY = 'agentConnections'
const tokenKey = (key: string) => `agentToken:${key}`

/** サイドバーを出すかを決める when 句のキー（package.json の views） */
const CONTEXT_KEY = 'stepLearn.agentAvailable'

const VIEW_ID = 'stepLearn.agent'

// 使える期間とその前後だけ短くするのは、期間の始まりと終わりですぐに出し入れしつつ、授業のない日に STEP Learn を何度も呼ばないため
const REFRESH_SOON = 60_000
const REFRESH_IDLE = 15 * 60_000
const SOON = 30 * 60

/** 期間が終わってからこれだけたったアイテムは、つないだ記録ごと消す。先生が期間を延ばすことがあるので、すぐには消さない */
const FORGET_AFTER = 30 * 24 * 60 * 60

/** 1 回の依頼で AI とやり取りする回数の上限。ツールを呼び続けて止まらなくなるのを防ぐ */
const MAX_TURNS = 40

type Saved = { server: string; ref: string; course: string; title: string; user: { id: number; name: string } }

/** 画面に出す会話の 1 行 */
type Entry = {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'notice' | 'confirm'
  text: string
  detail?: string
  file?: string
  failed?: boolean
  state?: 'pending' | 'approved' | 'denied'
}

type Chat = { messages: AgentMessage[]; entries: Entry[]; contextTokens: number; running?: AbortController }

const newChat = (): Chat => ({ messages: [], entries: [], contextTokens: 0 })

const nowSec = () => Math.floor(Date.now() / 1000)

export class AgentController implements vscode.WebviewViewProvider {
  private statuses = new Map<string, AgentStatus>()
  private chats = new Map<string, Chat>()
  private current: string | null = null
  private view: vscode.WebviewView | null = null
  private confirms = new Map<number, (ok: boolean) => void>()
  private nextId = 1
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly context: vscode.ExtensionContext) {}

  start() {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEW_ID, this),
      vscode.window.onDidChangeWindowState((s) => s.focused && void this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.render()),
      vscode.commands.registerCommand('stepLearn.agent.newChat', () => this.resetChat()),
      vscode.commands.registerCommand('stepLearn.agent.disconnect', () => this.disconnect()),
      { dispose: () => clearTimeout(this.timer) },
    )
    void this.refresh()
  }

  private saved() {
    return this.context.globalState.get<Record<string, Saved>>(CONNECTIONS_KEY, {})
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
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      void vscode.window.showInformationMessage(`「${grant.title}」のコーディングエージェントを使えるようにしました。`)
    } else {
      void vscode.window.showInformationMessage(
        `「${grant.title}」のコーディングエージェントを登録しました。${status?.message ?? ''}使える期間になると、左のバーに STEP Learn が表示されます。`,
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
  }

  /** つないだアイテムの状態を確かめ直し、サイドバーを出すかを決める */
  async refresh() {
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
    const msg = m as { type: string; text?: unknown; key?: unknown; id?: unknown; ok?: unknown; file?: unknown }
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
    this.chats.set(this.current!, newChat())
    this.render()
  }

  private root() {
    return vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath ?? null
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
    this.post({
      type: 'render',
      view: {
        options,
        current: key,
        status: status ?? null,
        entries: chat?.entries ?? [],
        running: !!chat?.running,
        hasFolder: !!this.root(),
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
    if (status && chat.contextTokens >= status.contextLimit) {
      this.add(chat, { kind: 'notice', text: '会話が長くなりました。「新しいチャット」を押して、続きの依頼をしてください。' })
      return
    }

    const controller = new AbortController()
    chat.running = controller
    chat.messages.push({ role: 'user', content: text })
    this.add(chat, { kind: 'user', text })

    const run = createToolRunner(root, {
      unsaved: (file) => vscode.workspace.textDocuments.find((d) => d.isDirty && d.uri.fsPath === file)?.getText(),
      write: (file, content) => writeDocument(file, content),
      confirm: (command, reason) => this.confirm(chat, command, reason, controller.signal),
      signal: controller.signal,
    })

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const entry = this.add(chat, { kind: 'assistant', text: '' })
        const { reply, contextTokens, usage } = await sendAgentMessages(
          server,
          token,
          { messages: chat.messages, platform: process.platform },
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
          this.add(chat, { kind: 'tool', text: result.summary, file: result.isError ? undefined : result.file, failed: result.isError })
        }
        if (controller.signal.aborted) break
        if (turn === MAX_TURNS - 1)
          this.add(chat, { kind: 'notice', text: 'やり取りが長くなったため、いったん止めました。続けるときは「続けて」と送ってください。' })
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
      this.render()
    }
  }

  private confirm(chat: Chat, command: string, reason: string, signal: AbortSignal) {
    const entry = this.add(chat, { kind: 'confirm', text: command, detail: reason, state: 'pending' })
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

// ファイルに直接書かないのは、エディターで開いているファイルを書き換えたときに、元に戻す（Ctrl + Z）で戻せるようにするため
async function writeDocument(file: string, content: string) {
  const uri = vscode.Uri.file(file)
  const edit = new vscode.WorkspaceEdit()
  const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file)
  const exists =
    opened ??
    (await vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    ))
  if (!exists) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)))
    edit.createFile(uri, { contents: new TextEncoder().encode(content) })
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('ファイルを作れませんでした')
    return
  }
  const doc = opened ?? (await vscode.workspace.openTextDocument(uri))
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), content)
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('ファイルを書き換えられませんでした')
  await doc.save()
}
