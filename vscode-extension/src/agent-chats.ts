import fs from 'node:fs/promises'
import path from 'node:path'
import { withoutUnanswered, type AgentMessage } from './agent-core'

/** 画面に出す会話の 1 行 */
export type Entry = {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'notice' | 'confirm' | 'changes'
  text: string
  /** user: 依頼に付けたファイルの表示 / tool: コマンドの出力 / confirm: 実行する理由 */
  detail?: string
  /** コマンドの確認に出す、プログラムに渡す入力 */
  input?: string
  file?: string
  failed?: boolean
  /** changes: この依頼で AI が書き換えたファイル（開いているフォルダーからの相対パス） */
  files?: { file: string; created: boolean }[]
  /** confirm: pending・approved・denied / changes: active（差分を見られ、戻せる）・reverted（戻した）・expired（VS Code を閉じて、前の内容が残っていない） */
  state?: 'pending' | 'approved' | 'denied' | 'active' | 'reverted' | 'expired'
}

/** notes は、次の依頼の前に付けて AI に伝えること（学生が変更を元に戻した、など） */
export type StoredChat = { messages: AgentMessage[]; entries: Entry[]; contextTokens: number; notes: string[] }

const FILE = 'agent-chats.json'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// 途中の様子をそのまま戻さないのは、確認を待っていたコマンドや、前の内容が残っていない変更を、押せるまま出さないため
function restoreEntry(entry: Entry): Entry {
  if (entry.kind === 'confirm' && entry.state === 'pending') return { ...entry, state: 'denied' }
  if (entry.kind === 'changes' && entry.state === 'active') return { ...entry, state: 'expired' }
  return entry
}

/**
 * 会話を、VS Code が開いているフォルダーごとに用意する保存場所（dir）に置く。
 * workspaceState に入れないのは、読んだファイルの中身やコマンドの出力を含む会話が数百 KB になり、VS Code の状態の保存に向かないため
 */
export class ChatStore {
  private writing: Promise<void> = Promise.resolve()

  /** dir は、フォルダーを開いていないときは undefined（保存しない） */
  constructor(private readonly dir: string | undefined) {}

  /** 保存してある会話。キーは「サーバー アイテムの ref」 */
  async load(): Promise<Map<string, StoredChat>> {
    const chats = new Map<string, StoredChat>()
    if (!this.dir) return chats
    const saved = await fs
      .readFile(path.join(this.dir, FILE), 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => null)
    if (!isObject(saved) || !isObject(saved.chats)) return chats
    for (const [key, chat] of Object.entries(saved.chats)) {
      if (!isObject(chat) || !Array.isArray(chat.messages) || !Array.isArray(chat.entries)) continue
      chats.set(key, {
        // 応答を作っている途中で VS Code が閉じたときの、結果のないツールの呼び出しと、中身のない応答の行を除く
        messages: withoutUnanswered(chat.messages as AgentMessage[]),
        entries: (chat.entries as Entry[]).filter((e) => e.kind !== 'assistant' || e.text).map(restoreEntry),
        contextTokens: typeof chat.contextTokens === 'number' ? chat.contextTokens : 0,
        notes: Array.isArray(chat.notes) ? chat.notes.filter((n): n is string => typeof n === 'string') : [],
      })
    }
    return chats
  }

  /** 続けて呼ばれても、書き込みは 1 つずつ順に行う */
  save(chats: Map<string, StoredChat>) {
    const dir = this.dir
    if (!dir) return
    const body = JSON.stringify({ chats: Object.fromEntries(chats) })
    this.writing = this.writing
      .then(async () => {
        await fs.mkdir(dir, { recursive: true })
        // 一度に書かないのは、書いている途中で VS Code が閉じたときに、前の会話まで壊さないため
        const temp = path.join(dir, `${FILE}.tmp`)
        await fs.writeFile(temp, body)
        await fs.rename(temp, path.join(dir, FILE))
      })
      .catch(() => undefined)
  }
}
