import type { Child } from 'hono/jsx'
import { Button, IconButton } from '../../../components/button'
import { ItemBar } from '../../../components/course'
import { TextField, validateWith } from '../../../components/form'
import { Popover } from '../../../components/overlay'
import { PdfViewerBody } from '../../../components/pdf'
import { useStyle } from '../../../components/style'
import { Alert, Chip, formatDateTime, type Crumb } from '../../../components/ui'

const STYLES = ['/src/components/pdf.css', '/src/features/presentation/components/presentation.css'] as const

/**
 * 発表ファイルのアイテムの画面の帯。公開の状態（何ページ目まで公開しているか・同期中か）は pdf-viewer.ts が読んで書き込む。
 * HTML に書かないのは、コースの変更の反映（CourseLiveSync）が帯を差し替え、先生がスライドを送るたびに全員の画面を取り直すことになるため
 */
export const PresentationBar = ({
  crumbs,
  title,
  hiddenNote,
  base,
  canManage,
  children,
}: {
  crumbs: readonly Crumb[]
  title: string
  hiddenNote?: string
  /** アイテムの presentation の下の URL（features/presentation/presentation.ts の presentationBase） */
  base: string
  canManage: boolean
  children?: Child
}) => {
  useStyle(...STYLES)
  return (
    <ItemBar type="presentation" crumbs={crumbs} title={title} hiddenNote={hiddenNote}>
      {canManage && (
        <>
          <span class="presentation-state" role="status">
            <Chip tone="success" data-presentation-live hidden>
              同期中
            </Chip>
            <span class="presentation-count small" data-presentation-count />
          </span>
          <form method="post" action={`${base}/launch`} class="presentation-launch" data-vscode-launch>
            <Button type="submit" size="sm" variant="primary" icon="arrowPath" aria-label="PowerPoint と同期" data-presentation-launch>
              <span class="hide-sm">PowerPoint と同期</span>
            </Button>
          </form>
          <Popover
            class="presentation-release"
            panelClass="presentation-release-panel stack"
            trigger={<IconButton as="summary" icon="sliders" label="公開の範囲" />}
          >
            <form method="post" action={`${base}/released`} class="presentation-release-form" {...validateWith('presentationReleased')}>
              <TextField
                label="公開する最後のページ"
                name="page"
                id="presentation-page"
                inputmode="numeric"
                autocomplete="off"
                hint="0 にすると、どのページも見せません。"
                data-presentation-page
              />
              <Button type="submit" size="sm">
                変更
              </Button>
            </form>
            <form
              method="post"
              action={`${base}/release-all`}
              data-confirm="すべてのページを学生に公開しますか？"
              data-confirm-ok="すべて公開する"
            >
              <Button type="submit" size="sm" variant="primary" icon="eye" block>
                すべて公開
              </Button>
            </form>
            <form
              method="post"
              action={`${base}/reset`}
              data-confirm="1 ページ目だけを公開した状態に戻しますか？ 学生には、2 ページ目から先が見えなくなります。"
              data-confirm-ok="リセットする"
            >
              <Button type="submit" size="sm" icon="undo" block>
                公開をリセット
              </Button>
            </form>
          </Popover>
        </>
      )}
      {children}
      <Button
        href={`${base}/pdf?download=1`}
        size="sm"
        icon="download"
        aria-label="ダウンロード"
        data-no-prefetch
        download
        data-presentation-download
        hidden
      >
        <span class="hide-sm">ダウンロード</span>
      </Button>
    </ItemBar>
  )
}

/** 発表ファイルのビューアー。公開の範囲のページだけを描き、先生が映しているページに合わせて動かす（pdf-viewer.ts の mountPresentation） */
export const PresentationStage = ({ base, title, canManage }: { base: string; title: string; canManage: boolean }) => {
  useStyle(...STYLES)
  return (
    <div class="pdf-stage">
      <div class="pdf-viewer presentation-viewer" data-presentation={base} data-manage={canManage ? '' : undefined}>
        <PdfViewerBody
          title={title}
          tail={
            <p class="presentation-tail muted small" data-pdf-tail hidden>
              一番下です
            </p>
          }
        />
        <Button class="presentation-return" size="sm" variant="primary" icon="monitor" data-presentation-return hidden>
          先生のページに戻る
        </Button>
      </div>
    </div>
  )
}

export type PresentationSummary = { pages: number; sourceName: string; exportedAt: number | null }

/** 編集画面の、PDF の置き方の案内と今の PDF */
export const PresentationEditNote = ({ summary }: { summary: PresentationSummary }) => (
  <Alert tone="info">
    PDF は、アイテムの画面の「PowerPoint と同期」から、VS Code の拡張機能が PowerPoint で開いているファイルを書き出してアップロードします。
    {summary.pages > 0 && (
      <>
        <br />
        今の PDF：{summary.sourceName || '（名前なし）'}・{summary.pages} ページ
        {summary.exportedAt ? `・${formatDateTime(summary.exportedAt)} に書き出し` : ''}
      </>
    )}
  </Alert>
)
