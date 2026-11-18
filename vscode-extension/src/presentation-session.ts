import fs from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { showNotice, showNoticeUntil } from './notice'
import { PowerPointError, type Deck, type PowerPoint, type ShowState } from './powerpoint'
import { MacPowerPoint } from './powerpoint-mac'
import { WindowsPowerPoint } from './powerpoint-win'
import {
  PositionTracker,
  PresentationTokenError,
  endSync,
  metaOf,
  sendPosition,
  uploadPdf,
  type Position,
  type PresentationGrant,
  type PresentationSummary,
} from './presentation-core'
import { SyncError } from './sync'

export const PRESENTATION_MENU_COMMAND = 'stepLearn.presentation.menu'

/** この OS の PowerPoint を読む部分。対応していない OS なら null */
export function powerPointFor(platform: NodeJS.Platform): PowerPoint | null {
  if (platform === 'win32') return new WindowsPowerPoint()
  if (platform === 'darwin') return new MacPowerPoint()
  return null
}

const IS_MAC = process.platform === 'darwin'

// Mac の PowerPoint は、自分の領域の外のフォルダーに初めて書き出すとき、フォルダーの許可を求める画面を出して、答えるまで書き出しを止める
const WAITING_HINT = IS_MAC
  ? 'PowerPoint に「Grant File Access」の画面が出ていたら、「Select…」を押し、開いたフォルダーのまま「Grant Access」を押してください（最初の 1 回だけです）。'
  : 'PowerPoint の応答を待っています。PowerPoint に確認の画面が出ていたら、答えてください。'

/** 読む役のプロセスが止まったときに、起動し直す回数の上限。続けて止まるなら、PowerPoint を読めない PC とみなす */
const MAX_RESTARTS = 3
/** 書き出した直後のスライドショーでは、書き出し直さない（ミリ秒） */
const FRESH_EXPORT = 10_000
/** PowerPoint とつながらない状態がこれだけ続いたら、PowerPoint を止めたとみなす（ミリ秒） */
const DISCONNECT_LIMIT = 300_000

const keyOf = (p: Position) => `${p.slideId}:${p.complete}`

const messageOf = (e: unknown, fallback: string) =>
  e instanceof SyncError || e instanceof PowerPointError ? e.message : `${fallback}（${e instanceof Error ? e.message : String(e)}）。`

/**
 * 発表ファイルのアイテム 1 つとの同期。同期を始めたときの PowerPoint のファイルを PDF にして上げ、
 * そのファイルのスライドショーで映しているスライドを STEP Learn に送り続ける
 */
export class PresentationSession {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  private watcher: { dispose: () => void } | null = null
  /** 同期しているファイル。最初に PDF を上げたときに決まり、書き出し直しても変わらない */
  private deck: Deck | null = null
  private tracker: PositionTracker | null = null
  private summary: PresentationSummary
  private state: ShowState | null = null
  /** 先生が映しているページ（STEP Learn が PDF のページに直したもの） */
  private page: number | null = null
  private pending: Position | null = null
  private sending = false
  private lastKey: string | null = null
  private lastSentAt = 0
  private exporting = false
  private exportedAt = 0
  /** PDF を書き出したあとに、スライドが変わった */
  private dirty = false
  private toldDirty = false
  private wasSaved: boolean | null = null
  private wasInShow = false
  private readonly warnedSlides = new Set<number>()
  private toldError = ''
  private restarts = 0
  /** PowerPoint とつながらなくなった時刻 */
  private disconnectedAt: number | null = null
  private disposed = false

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly server: URL,
    private readonly grant: PresentationGrant,
    private readonly powerPoint: PowerPoint,
    private readonly onEnd: () => void,
  ) {
    this.summary = grant
    this.status.command = PRESENTATION_MENU_COMMAND
    this.render()
    this.status.show()
  }

  /** 同期するファイルを PDF にして上げる。notices は、同期するファイルと公開の範囲、アニメーションの扱いを知らせるか */
  async publish(notices: boolean): Promise<boolean> {
    if (this.exporting || this.disposed) return false
    this.exporting = true
    this.render()
    try {
      // いつも同じ場所に書き出すのは、Mac の PowerPoint がフォルダーごとに許可を求め、場所を変えるたびに先生に聞くことになるため
      const target = path.join(this.context.globalStorageUri.fsPath, 'presentation', 'slides.pdf')
      await fs.mkdir(path.dirname(target), { recursive: true })
      // 一定の時間で消さないのは、PowerPoint の確認の画面に答えるまで、この案内が必要なため
      const exported: Promise<Deck> = this.powerPoint.exportPdf(
        target,
        () =>
          showNoticeUntil(
            WAITING_HINT,
            exported.catch(() => null),
          ),
        this.deck,
      )
      const deck = await exported
      const meta = metaOf(deck)
      if (meta.slideIds.length === 0) throw new SyncError('表示するスライドがありません。')
      this.summary = await uploadPdf(this.server, this.grant, new Uint8Array(await fs.readFile(target)), deck)
      this.deck = deck
      this.tracker = new PositionTracker(deck)
      this.exportedAt = Date.now()
      this.dirty = false
      this.toldDirty = false
      this.warnedSlides.clear()
      // 上げ直すと STEP Learn は先生のページを忘れるので、同じスライドのままでも送り直す
      this.lastKey = null
      if (notices) {
        showNotice(`PowerPoint の「${deck.name}」を「${this.grant.title}」と同期します。`)
        this.tellReleased()
        this.tellAnimations(meta.animatedPages, meta.triggerPages)
      }
      return true
    } catch (e) {
      if (e instanceof PresentationTokenError) this.fail(e.message)
      else void vscode.window.showErrorMessage(messageOf(e, 'PDF をアップロードできませんでした'))
      return false
    } finally {
      this.exporting = false
      this.render()
    }
  }

  // 上げる前の範囲で知らせないのは、前と違う名前のファイルを上げると、公開の範囲が引き継がれないため
  private tellReleased() {
    const { pages, released, all } = this.summary
    const range = all ? `すべてのページ（${pages} ページ）` : released > 0 ? `${released} ページ目まで` : ''
    if (range)
      showNotice(
        `「${this.grant.title}」は、${range}を学生に公開しています。1 ページ目から見せ直すときは、STEP Learn のアイテムの画面で「公開をリセット」を押してください。`,
      )
  }

  private tellAnimations(animatedPages: number[], triggerPages: number[]) {
    if (triggerPages.length > 0)
      void vscode.window.showWarningMessage(
        `図形を押すと動くアニメーションが ${triggerPages.join('・')} ページ目にあります。PDF では動いたあとの状態で、先に学生に見えます。`,
      )
    // クリックの段階を読める Windows では、アニメーションが終わったときに出せるので、知らせることがない
    if (IS_MAC && animatedPages.length > 0)
      showNotice(
        `クリックで進むアニメーションのあるスライドが ${animatedPages.length} 枚あります。Mac では、これらのスライドは次のスライドへ進んだときに学生に表示されます。`,
      )
  }

  start() {
    if (this.disposed || !this.deck) return
    this.watcher = this.powerPoint.watch(
      this.deck.file,
      (state) => this.onState(state),
      () => this.onWatcherExit(),
    )
  }

  private onWatcherExit() {
    if (this.disposed) return
    this.watcher = null
    if (++this.restarts > MAX_RESTARTS) return this.fail('PowerPoint を読めなくなったため、同期を止めました。')
    setTimeout(() => this.start(), 2000)
  }

  private onState(state: ShowState) {
    if (this.disposed) return
    this.state = state
    if (this.disconnectedTooLong(state)) return this.stopDisconnected()
    if (state.state === 'error') {
      // 同じ理由を読むたびに出さないのは、0.5 秒おきに読んでいて、通知が積み上がるため
      if (state.message && state.message !== this.toldError && /許可/.test(state.message)) {
        this.toldError = state.message
        void vscode.window.showWarningMessage(state.message)
      }
      return this.render()
    }
    this.restarts = 0
    const inShow = state.state === 'show'
    const saved = state.state === 'idle' || state.state === 'show' ? state.saved : null
    if (saved === false && this.wasSaved === true) {
      this.dirty = true
      if (inShow && !this.toldDirty) {
        this.toldDirty = true
        showNotice('スライドが変わりました。スライドショーを終えたら、PDF を書き出し直します。')
      }
    }
    if (saved !== null) this.wasSaved = saved
    const started = inShow && !this.wasInShow
    const ended = !inShow && this.wasInShow
    this.wasInShow = inShow
    // 保存していない変更があるときに始まったスライドショーでも書き出し直すのは、保存済みから変わった瞬間しか変更に気づけず、
    // 保存しないまま直し続けたスライドは、書き出したときのままかどうかが分からないため
    const stale = this.dirty || (saved === false && Date.now() - this.exportedAt > FRESH_EXPORT)
    // ファイルを閉じたあとは書き出せないので、次にスライドショーを始めたときまで待つ
    if (this.tracker && ((started && stale) || (ended && this.dirty && state.state === 'idle'))) void this.publish(false)

    if (this.tracker) {
      const now = Date.now()
      const position = this.tracker.next(state, now)
      if (keyOf(position) !== this.lastKey || now - this.lastSentAt >= this.grant.heartbeat * 1000) {
        this.pending = position
        void this.flush()
      }
    }
    this.render()
  }

  // タイマーで測らないのは、PC がスリープから戻った直後に、眠っていた時間まで切れていた時間に数えて止めてしまうため
  private disconnectedTooLong(state: ShowState) {
    // 書き出し中を数えないのは、PowerPoint が許可の画面を出しているあいだは読めなくても、つながっているため
    if (this.exporting || (state.state !== 'closed' && state.state !== 'error')) {
      this.disconnectedAt = null
      return false
    }
    const now = Date.now()
    this.disconnectedAt ??= now
    return now - this.disconnectedAt >= DISCONNECT_LIMIT
  }

  // すべて公開しないのは、先生がいないところで、まだ見せていないページを学生に見せてしまうため
  private stopDisconnected() {
    void vscode.window.showWarningMessage(
      `PowerPoint との接続が切れたままのため、「${this.grant.title}」の同期を止めました。もう一度始めるときは、STEP Learn の「PowerPoint と同期」を押してください。`,
    )
    void this.end(false)
  }

  /** いちばん新しい位置だけを送る。送っているあいだに届いた位置は、終わってから送る */
  private async flush() {
    if (this.sending || this.exporting || this.disposed) return
    this.sending = true
    try {
      while (this.pending && !this.disposed) {
        const position = this.pending
        this.pending = null
        const result = await sendPosition(this.server, this.grant.token, position)
        this.lastKey = keyOf(position)
        this.lastSentAt = Date.now()
        this.summary = result
        this.page = result.page
        if (result.unknown && position.slideId !== null && !this.warnedSlides.has(position.slideId)) {
          this.warnedSlides.add(position.slideId)
          this.dirty = true
          void vscode.window.showWarningMessage(
            'PDF にないスライドを映しています（PDF を書き出したあとに足したスライドなど）。スライドショーを終えたら、PDF を書き出し直します。',
          )
        }
      }
    } catch (e) {
      if (e instanceof PresentationTokenError) return this.fail(e.message)
      // 次に PowerPoint を読んだときに、そのときの位置を送り直す
      this.lastKey = null
    } finally {
      this.sending = false
      this.render()
    }
  }

  private statusText() {
    const { state } = this
    if (this.exporting) return '$(sync~spin) PDF を書き出しています'
    if (!state || state.state === 'closed') return '$(debug-pause) PowerPoint を待っています'
    if (state.state === 'error') return '$(warning) PowerPoint を読めません'
    if (state.state === 'show') return `$(broadcast) スライド同期中 ${this.page ?? '-'} / ${this.summary.pages}`
    if (state.otherShow) return '$(warning) 別のファイルを映しています'
    return state.state === 'idle' ? '$(debug-pause) スライドショーを待っています' : '$(debug-pause) 同期するファイルを待っています'
  }

  private render() {
    this.status.text = this.statusText()
    const file = this.deck ? `PowerPoint「${this.deck.name}」\n` : ''
    this.status.tooltip = `STEP Learn「${this.grant.title}」\n${file}公開 ${this.summary.released} / ${this.summary.pages} ページ\nクリックすると、PDF の書き出し直しと、同期の停止ができます`
  }

  async menu() {
    const again = 'PDF を書き出し直す'
    const stop = '同期を止める'
    const picked = await vscode.window.showQuickPick([again, stop], {
      placeHolder: `「${this.grant.title}」と同期しています（公開 ${this.summary.released} / ${this.summary.pages} ページ）`,
    })
    if (picked === again && (await this.publish(false))) showNotice(`PDF を書き出し直しました（${this.summary.pages} ページ）。`)
    if (picked === stop) await this.stop()
  }

  /** 同期を止める。すべてのページを学生に公開するかを聞く */
  async stop() {
    if (this.disposed) return
    const releaseAll = 'すべて公開して止める'
    const keep = '公開せずに止める'
    const answer = await vscode.window.showInformationMessage(
      `「${this.grant.title}」の同期を止めます。学生にすべてのページを公開しますか？`,
      {
        modal: true,
        detail: `今は ${this.summary.pages} ページのうち ${this.summary.released} ページ目までを公開しています。あとから STEP Learn の画面でも変えられます。`,
      },
      releaseAll,
      keep,
    )
    if (!answer || this.disposed) return
    const summary = await this.end(answer === releaseAll)
    if (summary)
      showNotice(
        summary.all ? '同期を止め、すべてのページを公開しました。' : `同期を止めました（${summary.released} ページ目まで公開しています）。`,
      )
  }

  /** 同期を終えて STEP Learn に伝える。伝えられなかったときは、知らせて null を返す */
  private async end(releaseAll: boolean) {
    this.dispose()
    try {
      return await endSync(this.server, this.grant.token, releaseAll)
    } catch (e) {
      void vscode.window.showErrorMessage(
        `同期は止めましたが、STEP Learn に伝えられませんでした。公開の範囲は STEP Learn の画面で確かめてください（${messageOf(e, '失敗')}）`,
      )
      return null
    }
  }

  private fail(message: string) {
    if (this.disposed) return
    this.dispose()
    void vscode.window.showErrorMessage(message)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.watcher?.dispose()
    this.status.dispose()
    this.onEnd()
  }
}
