import { MAX_BUNDLE_FILES, MAX_BUNDLE_SIZE, VSCODE_EXTENSION_NAME, VSCODE_MARKETPLACE_URL, type BundleFile } from '../bundle'
import { MAX_SYNC_FILE_SIZE, type BundleSyncState } from '../bundle-sync'
import { Button } from '../../../components/button'
import { Card, LinkCard } from '../../../components/card'
import { cx } from '../../../components/cx'
import { FileTree, TreeUploadForm } from '../../../components/file-tree'
import { Icon } from '../../../components/icons'
import { useStyle } from '../../../components/style'
import { Chip, EmptyState } from '../../../components/ui'
import { formatBytes } from '../../../lib/bytes'
import { treeSize } from '../../../lib/file-tree'

type Listed = Pick<BundleFile, 'path' | 'size'>

/** アイテムの画面と編集画面に出す、配るファイルと同期の状態 */
export type BundleView = { files: Listed[]; sync: BundleSyncState }

const summaryOf = (files: Listed[]) => `${files.length} 個・${formatBytes(treeSize(files))}`

/** アイテムの画面の、データの同期の案内と、変更履歴への入口 */
const BundleSyncNote = ({ sync, canManage }: { sync: BundleSyncState; canManage: boolean }) => (
  <Card
    class="bundle-sync-note"
    heading="データの同期"
    description={
      !sync.enabled
        ? 'データの同期は止まっています。これまでの変更履歴は残っています。'
        : canManage
          ? '学生が VS Code でファイルを保存するたびに、その内容が変更履歴として記録されます。'
          : 'VS Code でファイルを保存するたびに、その内容が STEP Learn に送られ、変更履歴として記録されます。記録は先生も見られます。'
    }
    actions={
      sync.historyHref && (
        <Button href={sync.historyHref} size="sm" iconEnd="chevronRight">
          {canManage ? '変更履歴' : '自分の変更履歴'}
        </Button>
      )
    }
  />
)

/** アイテムの画面の本体。VS Code で開くボタン・zip のダウンロード・配るファイルの一覧 */
export const BundleOpen = ({
  base,
  files,
  editHref,
  sync,
}: {
  base: string
  files: Listed[]
  /** 編集画面。教師にだけ渡す */
  editHref?: string
  sync: BundleSyncState
}) => {
  useStyle('/src/features/bundle/components/bundle.css', '/src/components/card.css')
  if (!files.length)
    return (
      <EmptyState
        icon="folder"
        title="まだファイルがありません"
        text={editHref ? '編集画面で、配るファイルをアップロードしてください。' : '先生がファイルを用意するまでお待ちください。'}
        action={
          editHref && (
            <Button href={editHref} variant="primary" icon="upload">
              ファイルをアップロード
            </Button>
          )
        }
      />
    )
  return (
    <div class="bundle-open stack">
      <LinkCard icon="code" class="link-card-lg kind-bundle">
        <span class="file-name">
          <span class="strong">VS Code で開く</span>
          <span class="muted small">ファイルを自動で用意して、VS Code でフォルダーを開きます</span>
        </span>
        <form method="post" action={`${base}/launch`} data-vscode-launch>
          <Button type="submit" variant="primary" iconEnd="external">
            VS Code で開く
          </Button>
        </form>
      </LinkCard>
      <div class="bundle-help muted small">
        <p>
          VS Code に拡張機能「{VSCODE_EXTENSION_NAME}」を入れてください。
          <a href={VSCODE_MARKETPLACE_URL} target="_blank" rel="noopener" data-no-prefetch>
            Marketplace で見る
            <Icon name="external" size={12} />
          </a>
        </p>
      </div>
      {(sync.enabled || sync.historyHref) && <BundleSyncNote sync={sync} canManage={!!editHref} />}
      <Card
        heading="配布するファイル"
        description={summaryOf(files)}
        actions={
          <Button href={`${base}/zip`} size="sm" icon="download" data-no-prefetch download>
            zip をダウンロード
          </Button>
        }
      >
        <FileTree files={files} class="kind-bundle" />
      </Card>
    </div>
  )
}

/** 編集画面の、データを同期するかの切り替え */
const BundleSyncCard = ({ base, sync }: { base: string; sync: BundleSyncState }) => (
  <Card
    heading={
      <span class="bundle-sync-heading">
        データを同期する
        <Chip tone={sync.enabled ? 'success' : 'default'}>{sync.enabled ? '有効' : '無効'}</Chip>
      </span>
    }
    description="有効にすると、学生が VS Code でファイルを保存するたびに、その内容が STEP Learn に送られ、変更履歴として残ります。学生には、アイテムの画面と VS Code で、記録されることを知らせます。"
    actions={
      sync.historyHref && (
        <Button href={sync.historyHref} size="sm" iconEnd="chevronRight">
          変更履歴
        </Button>
      )
    }
  >
    <form method="post" action={`${base}/sync`} class="bundle-sync-form" data-loading-form>
      <input type="hidden" name="sync" value={sync.enabled ? '0' : '1'} />
      <Button type="submit" variant={sync.enabled ? 'default' : 'primary'} icon="arrowPath">
        {sync.enabled ? '同期を止める' : '同期を有効にする'}
      </Button>
      <p class="muted small">
        {sync.enabled
          ? '止めても、これまでの変更履歴は残ります。'
          : `記録するのは文字のファイル（1 つ ${formatBytes(MAX_SYNC_FILE_SIZE)} まで）で、.git・node_modules などは除きます。`}
      </p>
    </form>
  </Card>
)

/** 編集画面の、保存のフォームの外に置く欄（配るファイルと、データの同期） */
export const BundleEditPanel = ({
  base,
  files,
  sync,
  class: cls,
}: {
  base: string
  files: Listed[]
  sync: BundleSyncState
  class?: string
}) => (
  <div class={cx('stack-lg', cls)}>
    <BundleFilesCard base={base} files={files} />
    <BundleSyncCard base={base} sync={sync} />
  </div>
)

/** 編集画面の、配るファイルのアップロードと一覧 */
const BundleFilesCard = ({ base, files, class: cls }: { base: string; files: Listed[]; class?: string }) => {
  useStyle('/src/features/bundle/components/bundle.css', '/src/components/card.css')
  return (
    <Card
      heading="配布するファイル"
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
        <TreeUploadForm action={`${base}/files`} maxFiles={MAX_BUNDLE_FILES} maxSize={MAX_BUNDLE_SIZE} />
        {files.length > 0 && <FileTree files={files} deleteAction={`${base}/files/delete`} class="kind-bundle" />}
      </div>
    </Card>
  )
}
