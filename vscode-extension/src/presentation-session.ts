import fs from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { PowerPointError, type PowerPoint, type ShowState } from './powerpoint'
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

const keyOf = (p: Position) => `${p.slideId}:${p.complete}`

const messageOf = (e: unknown, fallback: string) =>
  e instanceof SyncError || e instanceof PowerPointError ? e.message : `${fallback}（${e instanceof Error ? e.message : String(e)}）。`

/**
 * 発表ファイルのアイテム 1 つとの同期。PowerPoint で開いているファイルを PDF にして上げ、
 * スライドショーで映しているスライドを STEP Learn に送り続ける
 */
export class PresentationSession {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  private watcher: { dispose: () => void } | null = null
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

  /** PowerPoint で開いているファイルを PDF にして上げる。notices は、公開の範囲とアニメーションの扱いを知らせるか */
  async publish(notices: boolean): Promise<boolean> {
    if (this.exporting || this.disposed) return false
    this.exporting = true
    this.render()
    try {
      // いつも同じ場所に書き出すのは、Mac の PowerPoint がフォルダーごとに許可を求め、場所を変えるたびに先生に聞くことになるため
      const target = path.join(this.context.globalStorageUri.fsPath, 'presentation', 'slides.pdf')
      await fs.mkdir(path.dirname(target), { recursive: true })
      const deck = await this.powerPoint.exportPdf(target, () => void vscode.window.showInformationMessage(WAITING_HINT))
      const meta = metaOf(deck)
      if (meta.slideIds.length === 0) throw new SyncError('表示するスライドがありません。')
      this.summary = await uploadPdf(this.server, this.grant, new Uint8Array(await fs.readFile(target)), deck)
      this.tracker = new PositionTracker(deck)
      this.exportedAt = Date.now()
      this.dirty = false
      this.toldDirty = false
      this.warnedSlides.clear()
      // 上げ直すと STEP Learn は先生のページを忘れるので、同じスライドのままでも送り直す
      this.lastKey = null
      if (notices) {
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
      void vscode.window.showInformationMessage(
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
      void vscode.window.showInformationMessage(
        `クリックで進むアニメーションのあるスライドが ${animatedPages.length} 枚あります。Mac では、これらのスライドは次のスライドへ進んだときに学生に表示されます。`,
      )
  }

  start() {
    if (this.disposed) return
    this.watcher = this.powerPoint.watch(
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
    const saved = state.state === 'closed' ? null : state.saved
    if (saved === false && this.wasSaved === true) {
      this.dirty = true
      if (inShow && !this.toldDirty) {
        this.toldDirty = true
        void vscode.window.showInformationMessage('スライドが変わりました。スライドショーを終えたら、PDF を書き出し直します。')
      }
    }
    if (saved !== null) this.wasSaved = saved
    const started = inShow && !this.wasInShow
    const ended = !inShow && this.wasInShow
    this.wasInShow = inShow
    // 保存していない変更があるときに始まったスライドショーでも書き出し直すのは、保存済みから変わった瞬間しか変更に気づけず、
    // 保存しないまま直し続けたスライドは、書き出したときのままかどうかが分からないため
    const stale = this.dirty || (saved === false && Date.now() - this.exportedAt > FRESH_EXPORT)
    if (this.tracker && ((started && stale) || (ended && this.dirty))) void this.publish(false)

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

  private render() {
    const { state } = this
    this.status.text = this.exporting
      ? '$(sync~spin) PDF を書き出しています'
      : !state || state.state === 'closed'
        ? '$(debug-pause) PowerPoint を待っています'
        : state.state === 'error'
          ? '$(warning) PowerPoint を読めません'
          : state.state === 'idle'
            ? '$(debug-pause) スライドショーを待っています'
            : `$(broadcast) スライド同期中 ${this.page ?? '-'} / ${this.summary.pages}`
    this.status.tooltip = `STEP Learn「${this.grant.title}」\n公開 ${this.summary.released} / ${this.summary.pages} ページ\nクリックすると、PDF の書き出し直しと、同期の停止ができます`
  }

  async menu() {
    const again = 'PDF を書き出し直す'
    const stop = '同期を止める'
    const picked = await vscode.window.showQuickPick([again, stop], {
      placeHolder: `「${this.grant.title}」と同期しています（公開 ${this.summary.released} / ${this.summary.pages} ページ）`,
    })
    if (picked === again && (await this.publish(false)))
      void vscode.window.showInformationMessage(`PDF を書き出し直しました（${this.summary.pages} ページ）。`)
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
    this.dispose()
    try {
      const summary = await endSync(this.server, this.grant.token, answer === releaseAll)
      void vscode.window.showInformationMessage(
        summary.all ? '同期を止め、すべてのページを公開しました。' : `同期を止めました（${summary.released} ページ目まで公開しています）。`,
      )
    } catch (e) {
      void vscode.window.showErrorMessage(
        `同期は止めましたが、STEP Learn に伝えられませんでした。公開の範囲は STEP Learn の画面で確かめてください（${messageOf(e, '失敗')}）`,
      )
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
