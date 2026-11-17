import path from 'node:path'
import * as vscode from 'vscode'
import {
  CodeExpiredError,
  fetchCodeState,
  fetchResult,
  hashText,
  markSynced,
  planCode,
  readLocal,
  saveDraft,
  submitCode,
  writeLocal,
  type CodeFile,
  type CodeRecord,
  type CodeResult,
  type CodeSynced,
} from './code-item'

// 保存のたびにすぐ送らないのは、続けて保存したときや「すべて保存」でまとめて書き出されたファイルを 1 回にまとめるため
const DEBOUNCE = 1500
const RETRY = 60_000
const POLL = 3000
/** 判定を待つ長さ。これより長くかかったら、STEP Learn の画面で確かめてもらう */
const POLL_LIMIT = 5 * 60_000

/** secrets と globalState のキー。key は「サーバー アイテムの ref」 */
export const codeTokenKey = (key: string) => `code:${key}`
// 用意したフォルダーの記録（codeItems）に入れないのは、保存のたびに書き換えるので、ほかのウィンドウが足したアイテムの記録を古い内容で上書きしないようにするため
export const codeSyncedKey = (key: string) => `codeSynced:${key}`

/** 手元と STEP Learn の両方で書き換えたファイルを、どちらにそろえるかを聞く。やめたら null */
export async function chooseSide(title: string, conflicts: CodeFile[]): Promise<'server' | 'local' | null> {
  const server = 'STEP Learn の内容にする'
  const local = '手元のファイルを使う'
  const answer = await vscode.window.showWarningMessage(
    `「${title}」の ${conflicts.map((f) => f.path).join('・')} は、VS Code とブラウザエディターの両方で書き換えられています。`,
    {
      modal: true,
      detail: `「${server}」を選ぶと、ブラウザエディターで書いた内容でこのフォルダーのファイルを置き換えます。「${local}」を選ぶと、VS Code のファイルを STEP Learn に送ります。`,
    },
    server,
    local,
  )
  return answer === server ? 'server' : answer === local ? 'local' : null
}

const MARKS: Record<CodeResult['verdicts'][number]['verdict'], string> = { pass: '○', partial: '△', fail: '×' }

/** 判定の結果を見せる。詳しく見たいときは STEP Learn のブラウザエディターを開く */
async function showResult(result: CodeResult, title: string, page: string) {
  const open = 'STEP Learn で見る'
  const show = (message: string, detail: string) =>
    vscode.window.showInformationMessage(message, { modal: true, detail }, open).then((answer) => {
      if (answer === open) void vscode.env.openExternal(vscode.Uri.parse(page))
    })
  if (result.status === 'failed') {
    void vscode.window.showWarningMessage(`「${title}」を AI で判定できませんでした。少し待ってから出し直してください。`)
    return
  }
  const notes = [result.feedback && `AI の講評：${result.feedback}`, result.teacherComment && `教師のコメント：${result.teacherComment}`]
  if (!result.verdicts.length) {
    await show(`「${title}」を提出しました。`, notes.filter(Boolean).join('\n\n') || '教師が確認します。')
    return
  }
  const required = result.verdicts.filter((v) => !v.optional)
  const cleared = required.filter((v) => v.verdict === 'pass').length
  const lines = result.verdicts.map(
    (v) => `${MARKS[v.verdict]} ${v.label}${v.optional ? '（発展）' : ''}${v.reason ? `\n　${v.reason}` : ''}`,
  )
  const message =
    cleared === required.length
      ? `クリア！「${title}」は${required.length < result.verdicts.length ? '必須の' : 'すべての'}条件ができています。`
      : `「${title}」は ${cleared} / ${required.length} の条件ができています。`
  await show(message, [lines.join('\n'), ...notes].filter(Boolean).join('\n\n'))
}

type State = 'ok' | 'busy' | 'waiting' | 'expired'

const STATUS: Record<State, { text: string; tooltip: string }> = {
  ok: {
    text: '$(check) STEP Learn に保存済み',
    tooltip: '保存するたびに、STEP Learn のブラウザエディターの書きかけのコードに反映しています。',
  },
  busy: { text: '$(sync~spin) STEP Learn に保存中', tooltip: 'コードを STEP Learn に送っています。' },
  waiting: { text: '$(warning) STEP Learn に未保存', tooltip: 'しばらくしてから、もう一度送ります。' },
  expired: {
    text: '$(warning) STEP Learn に保存できません',
    tooltip: 'STEP Learn の画面の「VS Code で開く」をもう一度押してください。',
  },
}

/** 開いているフォルダー 1 つの、コードのアイテムとのつながり。保存したら書きかけのコードとして送り、提出も受け持つ */
export class CodeSession implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined
  private busy = false
  private again = false
  private stopped = false
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101)
  private readonly submitButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  private readonly listener: vscode.Disposable

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly key: string,
    readonly record: CodeRecord,
    private readonly server: URL,
    private readonly token: string,
  ) {
    this.listener = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this.owns(doc.uri)) this.later(DEBOUNCE, () => this.flush())
    })
  }

  get title() {
    return this.record.title
  }

  start() {
    if (this.record.canSubmit) {
      this.submitButton.text = '$(cloud-upload) 提出'
      this.submitButton.tooltip = `「${this.record.title}」を STEP Learn に提出します`
      this.submitButton.command = { command: 'stepLearn.code.submit', title: '提出', arguments: [this.key] }
      this.submitButton.show()
    }
    void this.refresh()
  }

  dispose() {
    this.stopped = true
    clearTimeout(this.timer)
    this.listener.dispose()
    this.status.dispose()
    this.submitButton.dispose()
  }

  /** ウィンドウを閉じる前に、まだ送っていない変更を送る */
  async flushNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      await this.flush()
    }
  }

  /** uri がこのアイテムのファイルか。フォルダーの直下の、配られた名前のファイルだけを送る */
  owns(uri: vscode.Uri) {
    return uri.scheme === 'file' && path.dirname(uri.fsPath) === this.record.folder && this.record.files.includes(path.basename(uri.fsPath))
  }

  contains(uri: vscode.Uri) {
    const relative = path.relative(this.record.folder, uri.fsPath)
    return uri.scheme === 'file' && !relative.startsWith('..') && !path.isAbsolute(relative)
  }

  private synced() {
    return this.context.globalState.get<CodeSynced>(codeSyncedKey(this.key), {})
  }

  private later(ms: number, run: () => Promise<void>) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void run()
    }, ms)
  }

  private show(state: State, detail?: string) {
    this.status.text = STATUS[state].text
    this.status.tooltip = [detail, STATUS[state].tooltip].filter(Boolean).join(' ')
    this.status.show()
  }

  private fail(e: unknown, retry: () => Promise<void>) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof CodeExpiredError) {
      this.stopped = true
      this.submitButton.hide()
      this.show('expired', message)
      void vscode.window.showWarningMessage(`STEP Learn: ${message}`)
      return
    }
    this.show('waiting', message)
    this.later(RETRY, retry)
  }

  /** 開いていないあいだにブラウザエディターで書き換えた分を取り込み、手元だけで書き換えた分を送る */
  private async refresh() {
    if (this.stopped) return
    try {
      const state = await fetchCodeState(this.server, this.token)
      let synced = this.synced()
      const plan = await planCode(this.record.folder, state.files, synced)
      const side = plan.conflicts.length ? await chooseSide(state.title, plan.conflicts) : null
      const written = [...plan.write, ...(side === 'server' ? plan.conflicts : [])]
      if (written.length) {
        await writeLocal(this.record.folder, written)
        synced = markSynced(synced, written)
        await this.context.globalState.update(codeSyncedKey(this.key), synced)
      }
      // どちらにするか選ばずに閉じたときに送らないのは、ブラウザエディターで書いた内容を、確かめないまま手元のファイルで上書きしないため。次に保存したときに送る
      const undecided = plan.conflicts.length > 0 && side === null
      if (!undecided && (plan.ahead.length || side === 'local')) await this.flush()
      else this.show('ok')
    } catch (e) {
      this.fail(e, () => this.refresh())
    }
  }

  private async flush() {
    if (this.stopped) return
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      const files = await readLocal(this.record.folder, this.record.files)
      const synced = this.synced()
      if (files.every((f) => synced[f.path] === hashText(f.content))) {
        this.show('ok')
        return
      }
      this.show('busy')
      await saveDraft(this.server, this.token, files)
      await this.context.globalState.update(codeSyncedKey(this.key), markSynced(synced, files))
      this.show('ok')
    } catch (e) {
      this.fail(e, () => this.flush())
    } finally {
      this.busy = false
    }
    if (this.again) {
      this.again = false
      this.later(DEBOUNCE, () => this.flush())
    }
  }

  async submit() {
    if (this.stopped) {
      void vscode.window.showWarningMessage(`STEP Learn: ${STATUS.expired.tooltip}`)
      return
    }
    for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && this.owns(doc.uri)) await doc.save()
    const accept = '提出する'
    const answer = await vscode.window.showInformationMessage(
      `「${this.record.title}」を提出しますか？`,
      { modal: true, detail: `このフォルダーの ${this.record.files.join('・')} を STEP Learn に提出します。` },
      accept,
    )
    if (answer !== accept) return
    try {
      const files = await readLocal(this.record.folder, this.record.files)
      const { graded } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `STEP Learn: 「${this.record.title}」を提出しています` },
        () => submitCode(this.server, this.token, files),
      )
      clearTimeout(this.timer)
      this.timer = undefined
      await this.context.globalState.update(codeSyncedKey(this.key), markSynced(this.synced(), files))
      this.show('ok')
      if (!graded) {
        void vscode.window.showInformationMessage(`「${this.record.title}」を提出しました。教師が確認します。`)
        return
      }
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'STEP Learn: AI が判定しています', cancellable: true },
        (_, cancel) => this.waitForResult(cancel),
      )
      if (result) await showResult(result, this.record.title, this.record.page)
    } catch (e) {
      if (e instanceof CodeExpiredError) this.fail(e, () => this.flush())
      else void vscode.window.showErrorMessage(`STEP Learn: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 判定が終わるのを待つ。待ちきれなかったり、やめたりしたら null */
  private async waitForResult(cancel: vscode.CancellationToken): Promise<CodeResult | null> {
    const until = Date.now() + POLL_LIMIT
    while (Date.now() < until && !cancel.isCancellationRequested) {
      await new Promise((resolve) => setTimeout(resolve, POLL))
      const result = await fetchResult(this.server, this.token)
      if (result && result.status !== 'pending') return result
    }
    if (!cancel.isCancellationRequested)
      void vscode.window
        .showInformationMessage('判定に時間がかかっています。結果は STEP Learn の画面で確かめてください。', 'STEP Learn で見る')
        .then((answer) => answer && vscode.env.openExternal(vscode.Uri.parse(this.record.page)))
    return null
  }
}
