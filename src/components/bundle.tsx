import { formatBytes } from '../lib/bytes'
import {
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_SIZE,
  VSCODE_EXTENSION_NAME,
  VSCODE_MARKETPLACE_URL,
  bundleSize,
  bundleTree,
  type BundleFile,
  type BundleTreeNode,
} from '../lib/bundle'
import { MAX_SYNC_FILE_SIZE, type BundleSyncState } from '../lib/bundle-sync'
import { MAX_FILE_SIZE } from '../lib/storage'
import { Button, IconButton } from './button'
import { Card, LinkCard } from './card'
import { cx } from './cx'
import { Icon } from './icons'
import { useStyle } from './style'
import { Chip, EmptyState } from './ui'

type Listed = Pick<BundleFile, 'path' | 'size'>

/** アイテムの画面と編集画面に出す、配るファイルと同期の状態 */
export type BundleView = { files: Listed[]; sync: BundleSyncState }

const countFiles = (node: BundleTreeNode): number => (node.file ? 1 : node.children.reduce((n, c) => n + countFiles(c), 0))

const DeleteButton = ({ action, name, value, label }: { action: string; name: 'path' | 'folder'; value: string; label: string }) => (
  <form method="post" action={action} data-confirm={`「${value}」を削除しますか？`}>
    <input type="hidden" name={name} value={value} />
    <IconButton type="submit" icon="trash" label={label} danger />
  </form>
)

const TreeNodes = ({ nodes, deleteAction }: { nodes: BundleTreeNode[]; deleteAction?: string }) => (
  <ul>
    {nodes.map((n) => (
      <li class={n.file ? 'bundle-file' : 'bundle-folder'}>
        <div class="bundle-row">
          <Icon name={n.file ? 'file' : 'folder'} size={16} />
          <span class="bundle-name truncate">{n.name}</span>
          <span class="bundle-meta muted small">{n.file ? formatBytes(n.file.size) : `${countFiles(n)} 個`}</span>
          {deleteAction && (
            <DeleteButton
              action={deleteAction}
              name={n.file ? 'path' : 'folder'}
              value={n.path}
              label={n.file ? `「${n.name}」を削除` : `フォルダー「${n.name}」を削除`}
            />
          )}
        </div>
        {n.children.length > 0 && <TreeNodes nodes={n.children} deleteAction={deleteAction} />}
      </li>
    ))}
  </ul>
)

export const BundleTree = ({ files, deleteAction }: { files: Listed[]; deleteAction?: string }) => {
  useStyle('/src/components/bundle.css', '/src/components/course.css')
  return (
    <div class="bundle-tree kind-bundle">
      <TreeNodes nodes={bundleTree(files)} deleteAction={deleteAction} />
    </div>
  )
}

const summaryOf = (files: Listed[]) => `${files.length} 個・${formatBytes(bundleSize(files))}`

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
  useStyle('/src/components/bundle.css', '/src/components/card.css')
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
        <BundleTree files={files} />
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
  useStyle('/src/components/bundle.css', '/src/components/card.css')
  return (
    <Card
      heading="配布するファイル"
      description={files.length ? summaryOf(files) : 'フォルダーごと、またはファイルを選んでアップロードします。'}
      class={cls}
      actions={
        files.length > 0 && (
          <form method="post" action={`${base}/files/delete`} data-confirm="すべてのファイルを削除しますか？">
            <input type="hidden" name="all" value="1" />
            <Button type="submit" size="sm" variant="danger-outline" icon="trash">
              すべて削除
            </Button>
          </form>
        )
      }
    >
      <div class="stack">
        <form
          method="post"
          action={`${base}/files`}
          enctype="multipart/form-data"
          class="bundle-upload"
          data-bundle-upload
          data-max-files={MAX_BUNDLE_FILES}
          data-max-size={MAX_FILE_SIZE}
        >
          <input type="file" webkitdirectory multiple hidden data-bundle-input="folder" />
          <input type="file" multiple hidden data-bundle-input="files" />
          <div class="bundle-drop" data-bundle-drop>
            <span class="bundle-drop-icon">
              <Icon name="upload" size={18} />
            </span>
            <span class="bundle-drop-text">
              <span class="bundle-drop-drag">フォルダーやファイルをここにドラッグ＆ドロップ</span>
              <span class="muted small">または</span>
            </span>
            <span class="row bundle-drop-actions">
              <Button size="sm" icon="folder" data-bundle-pick="folder">
                フォルダーを選択
              </Button>
              <Button size="sm" icon="file" data-bundle-pick="files">
                ファイルを選択
              </Button>
            </span>
          </div>
          <div class="bundle-pending" data-bundle-pending hidden>
            <Icon name="folder" size={16} />
            <span class="truncate" data-bundle-summary />
            <IconButton icon="x" label="選択を取り消す" data-bundle-clear />
            <Button type="submit" variant="primary" size="sm" icon="upload">
              アップロード
            </Button>
          </div>
          <p class="muted small">
            フォルダーを選ぶと、その中身をそのまま配ります。同じ場所にあるファイルは置き換わります。.git・node_modules・__pycache__・.venv
            などは自動で外します。最大 {MAX_BUNDLE_FILES} 個・合計 {formatBytes(MAX_BUNDLE_SIZE)}（1 回のアップロードは{' '}
            {formatBytes(MAX_FILE_SIZE)}）まで。
          </p>
        </form>
        {files.length > 0 && <BundleTree files={files} deleteAction={`${base}/files/delete`} />}
      </div>
    </Card>
  )
}
