import path from 'node:path'
import * as vscode from 'vscode'
import {
  SyncExpiredError,
  collectChanges,
  fetchStatus,
  isExcluded,
  markUploaded,
  pushChanges,
  relativePath,
  type Uploaded,
} from './history'

// 保存のたびにすぐ送らないのは、続けて保存したときや、まとめて書き出されたファイルを 1 回にまとめるため
const DEBOUNCE = 3000
const RETRY = 60_000
/** 同期が無効のアイテムで、教師があとから有効にしていないかを確かめ直す間隔 */
const RECHECK = 5 * 60_000

// 用意したフォルダーの記録（bundles）に入れないのは、保存のたびに書き換えるので、ほかのウィンドウが足したアイテムの記録を古い内容で上書きしないようにするため
/** globalState と secrets のキー。key は「サーバー アイテムの ref」 */
const uploadedKey = (key: string) => `uploaded:${key}`
const noticedKey = (key: string) => `syncNoticed:${key}`
export const tokenKey = (key: string) => `sync:${key}`

/** 内容が STEP Learn に送られることを知らせ、同意を得る。同意したことは覚えておき、次からは聞かない */
export async function confirmSync(context: vscode.ExtensionContext, key: string, name: string) {
  if (context.globalState.get(noticedKey(key), false)) return true
  const accept = '同期して続ける'
  const answer = await vscode.window.showWarningMessage(
    `「${name}」は、データを同期するアイテムです。`,
    {
      modal: true,
      detail:
        'このフォルダーのファイルを保存するたびに、その内容が STEP Learn に送られ、変更履歴として記録されます。記録は先生も見られます。',
    },
    accept,
  )
  if (answer !== accept) return false
  await context.globalState.update(noticedKey(key), true)
  return true
}

type State = 'ok' | 'busy' | 'full' | 'waiting' | 'expired' | 'declined'

const STATUS: Record<State, { text: string; tooltip: string }> = {
  ok: {
    text: '$(cloud-upload) STEP Learn 同期中',
    tooltip: 'ファイルを保存するたびに、その内容を変更履歴として STEP Learn に記録しています。',
  },
  busy: { text: '$(sync~spin) STEP Learn 同期中', tooltip: '変更を STEP Learn に送っています。' },
  full: {
    text: '$(warning) STEP Learn 記録の上限',
    tooltip: '変更履歴の記録が上限に達したため、新しい変更を記録できません。先生に知らせてください。',
  },
  waiting: { text: '$(warning) STEP Learn 同期待ち', tooltip: 'しばらくしてから、もう一度送ります。' },
  expired: {
    text: '$(warning) STEP Learn 同期できません',
    tooltip: 'STEP Learn の画面の「VS Code で開く」をもう一度押してください。',
  },
  declined: {
    text: '$(circle-slash) STEP Learn 同期していません',
    tooltip: '同期を始めるには、ウィンドウを開き直すか、STEP Learn の画面の「VS Code で開く」をもう一度押してください。',
  },
}

/** 開いているフォルダー 1 つの、変更履歴の同期。ファイルの変更を見張り、少し待ってからまとめて送る */
export class HistorySession implements vscode.Disposable {
  private readonly dirty = new Set<string>()
  private scanAll = true
  private maxFileSize = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private busy = false
  private stopped = false
  private watcher: vscode.FileSystemWatcher | undefined
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly key: string,
    private readonly folder: string,
    private readonly server: URL,
    private readonly token: string,
    /** 配られたときのファイルの中身のハッシュ。先生の更新を取り込むと変わるので、送るたびに読み直す */
    private readonly distributed: () => Record<string, string>,
  ) {}

  start() {
    void this.check()
  }

  dispose() {
    this.stopped = true
    clearTimeout(this.timer)
    this.watcher?.dispose()
    this.status.dispose()
  }

  /** ウィンドウを閉じる前に、まだ送っていない変更を送る */
  async flushNow() {
    clearTimeout(this.timer)
    if (this.watcher && this.dirty.size) await this.flush()
  }

  private later(ms: number, run: () => Promise<void>) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void run(), ms)
  }

  private show(state: State, detail?: string) {
    this.status.text = STATUS[state].text
    this.status.tooltip = [detail, STATUS[state].tooltip].filter(Boolean).join(' ')
    this.status.show()
  }

  private fail(e: unknown, retry: () => Promise<void>) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof SyncExpiredError) {
      this.stopped = true
      this.watcher?.dispose()
      this.show('expired', message)
      void vscode.window.showWarningMessage(`STEP Learn: ${message}`)
      return
    }
    this.show('waiting', message)
    this.later(RETRY, retry)
  }

  private async check() {
    if (this.stopped) return
    try {
      const status = await fetchStatus(this.server, this.token)
      if (!status.enabled) {
        this.status.hide()
        this.later(RECHECK, () => this.check())
        return
      }
      if (!(await confirmSync(this.context, this.key, path.basename(this.folder)))) {
        this.show('declined')
        return
      }
      this.maxFileSize = status.maxFileSize
      this.watch()
      this.show('ok')
      // 開いていないあいだに変わったファイルも送るので、最初はフォルダー全体を調べる
      this.scanAll = true
      await this.flush()
    } catch (e) {
      this.fail(e, () => this.check())
    }
  }

  private watch() {
    if (this.watcher) return
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.folder), '**/*'))
    const mark = (uri: vscode.Uri) => {
      const p = relativePath(this.folder, uri.fsPath)
      if (!p || isExcluded(p)) return
      this.dirty.add(p)
      this.later(DEBOUNCE, () => this.flush())
    }
    watcher.onDidCreate(mark)
    watcher.onDidChange(mark)
    watcher.onDidDelete(mark)
    this.watcher = watcher
  }

  private async flush() {
    if (this.stopped || this.busy) return
    this.busy = true
    const all = this.scanAll
    const paths = [...this.dirty]
    this.scanAll = false
    this.dirty.clear()
    try {
      let uploaded = this.context.globalState.get<Uploaded>(uploadedKey(this.key), {})
      const changes = await collectChanges(this.folder, this.distributed(), uploaded, this.maxFileSize, all ? undefined : paths)
      if (changes.length) {
        this.show('busy')
        const result = await pushChanges(this.server, this.token, changes, async (sent) => {
          uploaded = markUploaded(uploaded, sent)
          await this.context.globalState.update(uploadedKey(this.key), uploaded)
        })
        if (!result.enabled) {
          this.watcher?.dispose()
          this.watcher = undefined
          this.status.hide()
          this.later(RECHECK, () => this.check())
          return
        }
        this.show(result.full ? 'full' : 'ok')
      } else this.show('ok')
    } catch (e) {
      this.scanAll ||= all
      for (const p of paths) this.dirty.add(p)
      this.fail(e, () => this.flush())
      return
    } finally {
      this.busy = false
    }
    if (this.dirty.size) this.later(DEBOUNCE, () => this.flush())
  }
}
