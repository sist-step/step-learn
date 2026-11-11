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
import { MAX_FILE_SIZE } from '../lib/storage'
import { Button, IconButton } from './button'
import { Card, LinkCard } from './card'
import { Icon } from './icons'
import { useStyle } from './style'
import { EmptyState } from './ui'

type Listed = Pick<BundleFile, 'path' | 'size'>

/** アイテムの URL の下の、ファイル自動配布の操作の URL（/courses/:id/items/:iid/bundle） */
export const bundleBase = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/bundle`

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

/** アイテムの画面の本体。VS Code で開くボタン・zip のダウンロード・配るファイルの一覧 */
export const BundleOpen = ({ base, files, editHref }: { base: string; files: Listed[]; editHref?: string }) => {
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

/** 編集画面の、配るファイルのアップロードと一覧 */
export const BundleFilesCard = ({ base, files, class: cls }: { base: string; files: Listed[]; class?: string }) => {
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
