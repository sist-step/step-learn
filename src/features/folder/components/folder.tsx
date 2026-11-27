import { Button } from '../../../components/button'
import { Card } from '../../../components/card'
import { FileTree, TreeUploadForm } from '../../../components/file-tree'
import { SegmentedControl } from '../../../components/form'
import type { IconName } from '../../../components/icons'
import { useStyle } from '../../../components/style'
import { EmptyState } from '../../../components/ui'
import { formatBytes } from '../../../lib/bytes'
import { treeSize } from '../../../lib/file-tree'
import { MAX_FOLDER_FILES, MAX_FOLDER_SIZE, folderLinks, type FolderSettings, type FolderView } from '../folder'

const summaryOf = (files: FolderView['files']) => `${files.length} 個・${formatBytes(treeSize(files))}`

const ZipButton = ({ base }: { base: string }) => (
  <Button href={`${base}/zip`} size="sm" icon="download" data-no-prefetch download>
    zip でダウンロード
  </Button>
)

/** アイテムの画面の本体。置いたファイルの木と、まとめてダウンロードするボタン */
export const FolderPanel = ({
  base,
  view,
  editHref,
}: {
  base: string
  view: FolderView
  /** 編集画面。教師にだけ渡す */
  editHref?: string
}) => {
  useStyle('/src/features/folder/components/folder.css', '/src/components/card.css')
  const { settings, files } = view
  if (!files.length)
    return (
      <div class="folder-panel">
        <EmptyState
          icon="folder"
          title="まだファイルがありません"
          text={editHref ? '編集画面で、ファイルをアップロードしてください。' : '先生がファイルを置くまでお待ちください。'}
          action={
            editHref && (
              <Button href={editHref} variant="primary" icon="upload">
                ファイルをアップロード
              </Button>
            )
          }
        />
      </div>
    )
  return (
    <Card
      class="folder-panel"
      heading="ファイル"
      description={summaryOf(files)}
      actions={settings.showDownload ? <ZipButton base={base} /> : undefined}
    >
      <FileTree files={files} linkOf={folderLinks(base, view)} open={!!settings.showExpanded} class="kind-folder" />
    </Card>
  )
}

/** コースのページで、フォルダーの行の下に並べる中身 */
export const FolderInline = ({ base, view }: { base: string; view: FolderView }) => {
  useStyle('/src/features/folder/components/folder.css')
  const { settings, files } = view
  if (!files.length) return null
  return (
    <div class="folder-inline">
      <FileTree files={files} linkOf={folderLinks(base, view)} open={!!settings.showExpanded} class="kind-folder" />
      {settings.showDownload ? (
        <div class="folder-inline-foot">
          <ZipButton base={base} />
        </div>
      ) : null}
    </div>
  )
}

/** 編集画面の、保存のフォームの外に置くファイルのアップロードと一覧 */
export const FolderFilesCard = ({ base, view, class: cls }: { base: string; view: FolderView; class?: string }) => {
  useStyle('/src/features/folder/components/folder.css', '/src/components/card.css')
  const { files } = view
  return (
    <Card
      heading="フォルダーのファイル"
      description={files.length ? summaryOf(files) : 'フォルダーごと、またはファイルや zip を選んでアップロードします。'}
      class={cls}
      actions={
        files.length > 0 && (
          <form
            method="post"
            action={`${base}/files/delete`}
            data-confirm="すべてのファイルを削除しますか？"
            data-confirm-ok="すべて削除する"
          >
            <input type="hidden" name="all" value="1" />
            <Button type="submit" size="sm" variant="danger-outline" icon="trash">
              すべて削除
            </Button>
          </form>
        )
      }
    >
      <div class="stack">
        <TreeUploadForm action={`${base}/files`} maxFiles={MAX_FOLDER_FILES} maxSize={MAX_FOLDER_SIZE} />
        {files.length > 0 && (
          <FileTree files={files} linkOf={folderLinks(base, view)} deleteAction={`${base}/files/delete`} class="kind-folder" />
        )}
      </div>
    </Card>
  )
}

type Choice = { name: string; legend: string; on: [string, IconName]; off: [string, IconName]; hint: string }

const CHOICES: Record<keyof FolderSettings, Choice> = {
  showInline: {
    name: 'show_inline',
    legend: '中身を並べるページ',
    on: ['コース', 'listBullet'],
    off: ['アイテム', 'folder'],
    hint: '「コース」にすると、アイテムを開かなくても、コースのページでファイルを開けます。',
  },
  showExpanded: {
    name: 'show_expanded',
    legend: 'サブフォルダー',
    on: ['開いておく', 'folderOpen'],
    off: ['閉じておく', 'folder'],
    hint: '学生は、フォルダーの名前を押して開け閉めできます。',
  },
  showDownload: {
    name: 'show_download',
    legend: 'まとめてダウンロード',
    on: ['できる', 'download'],
    off: ['できない', 'eyeSlash'],
    hint: '「できる」にすると、すべてのファイルを zip でダウンロードするボタンを出します。',
  },
  forceDownload: {
    name: 'force_download',
    legend: 'ファイルを押したとき',
    on: ['ダウンロード', 'download'],
    off: ['表示する', 'eye'],
    hint: '「表示する」はブラウザの新しいタブで開きます。PDF・画像・動画・音声・テキスト・HTML 以外は、いつもダウンロードします。',
  },
}

/** 編集画面の、フォルダーの見せ方の設定 */
export const FolderSettingsCard = ({ settings }: { settings: FolderSettings }) => (
  <Card heading="見せ方">
    <div class="stack">
      {(Object.keys(CHOICES) as (keyof FolderSettings)[]).map((key) => {
        const { name, legend, on, off, hint } = CHOICES[key]
        return (
          <fieldset class="field">
            <legend>{legend}</legend>
            <SegmentedControl
              name={name}
              label={legend}
              options={[
                { value: '0', label: off[0], icon: off[1] },
                { value: '1', label: on[0], icon: on[1] },
              ]}
              value={String(settings[key])}
            />
            <p class="field-hint">{hint}</p>
          </fieldset>
        )
      })}
    </div>
  </Card>
)
