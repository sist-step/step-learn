import { Button, IconButton } from './button'
import { cx } from './cx'
import { Icon } from './icons'
import { Popover } from './overlay'
import { useStyle } from './style'
import { Chip } from './ui'
import { formatBytes } from '../lib/bytes'
import { EXCLUDED_NAMES, fileTree, type FileTreeNode, type TreeFile, type TreeLink } from '../lib/file-tree'
import { MAX_FILE_SIZE } from '../lib/storage'

type TreeOptions = {
  deleteAction?: string
  linkOf?: (path: string) => TreeLink | null
  /** フォルダーを開け閉めできるようにし、最初に開いておくか。なければ開け閉めせず、すべてを並べる */
  open?: boolean
}

const countFiles = (node: FileTreeNode): number => (node.file ? 1 : node.children.reduce((n, c) => n + countFiles(c), 0))

const DeleteButton = ({ action, name, value, label }: { action: string; name: 'path' | 'folder'; value: string; label: string }) => (
  <form method="post" action={action} data-confirm={`「${value}」を削除しますか？`} data-confirm-ok="削除する">
    <input type="hidden" name={name} value={value} />
    <IconButton type="submit" icon="trash" label={label} danger />
  </form>
)

const Entry = ({ node, link }: { node: FileTreeNode; link: TreeLink | null }) => {
  const inner = (
    <>
      <Icon name={node.file ? 'file' : 'folder'} size={16} />
      <span class="file-tree-name truncate">{node.name}</span>
      <span class="file-tree-meta muted small">{node.file ? formatBytes(node.file.size) : `${countFiles(node)} 個`}</span>
    </>
  )
  if (!link) return <span class="file-tree-entry">{inner}</span>
  return (
    <a
      href={link.href}
      class="file-tree-entry"
      data-no-prefetch
      {...(link.download ? { download: node.name } : { target: '_blank', rel: 'noopener' })}
    >
      {inner}
    </a>
  )
}

const TreeNodes = ({ nodes, options }: { nodes: FileTreeNode[]; options: TreeOptions }) => (
  <ul>
    {nodes.map((n) => {
      const { deleteAction, linkOf, open } = options
      const row = (
        <>
          <Entry node={n} link={n.file && linkOf ? linkOf(n.path) : null} />
          {deleteAction && (
            <DeleteButton
              action={deleteAction}
              name={n.file ? 'path' : 'folder'}
              value={n.path}
              label={n.file ? `「${n.name}」を削除` : `フォルダー「${n.name}」を削除`}
            />
          )}
        </>
      )
      if (n.file)
        return (
          <li class="file-tree-file">
            <div class="file-tree-row">{row}</div>
          </li>
        )
      if (open === undefined)
        return (
          <li class="file-tree-folder">
            <div class="file-tree-row">{row}</div>
            <TreeNodes nodes={n.children} options={options} />
          </li>
        )
      return (
        <li class="file-tree-folder">
          <details open={open}>
            <summary class="file-tree-row">
              <Icon name="chevronRight" size={14} class="file-tree-chevron" />
              {row}
            </summary>
            <TreeNodes nodes={n.children} options={options} />
          </details>
        </li>
      )
    })}
  </ul>
)

/** フォルダーの木の形に並べたファイルの一覧。cls の kind-* でフォルダーの色が変わる */
export const FileTree = ({ files, class: cls, ...options }: TreeOptions & { files: TreeFile[]; class?: string }) => {
  useStyle('/src/components/file-tree.css', '/src/components/course.css')
  return (
    <div class={cx('file-tree', options.open !== undefined && 'is-collapsible', cls)}>
      <TreeNodes nodes={fileTree(files)} options={options} />
    </div>
  )
}

/**
 * フォルダー・ファイル・zip を選ぶか、ドラッグ＆ドロップしてアップロードするフォーム。送るのは client.ts（data-tree-upload）で、
 * 受け取るのは lib/tree-upload.ts の readTreeUploads
 */
export const TreeUploadForm = ({ action, maxFiles, maxSize }: { action: string; maxFiles: number; maxSize: number }) => {
  useStyle('/src/components/file-tree.css')
  return (
    <form
      method="post"
      action={action}
      enctype="multipart/form-data"
      class="tree-upload"
      data-tree-upload
      data-max-files={maxFiles}
      data-max-size={MAX_FILE_SIZE}
    >
      <input type="file" webkitdirectory multiple hidden data-tree-input="folder" />
      <input type="file" multiple hidden data-tree-input="files" />
      <div class="tree-drop" data-tree-drop>
        <span class="tree-drop-icon">
          <Icon name="upload" size={18} />
        </span>
        <span class="tree-drop-text">
          <span class="tree-drop-drag">フォルダーやファイル、zip をここにドラッグ＆ドロップ</span>
          <span class="muted small">または</span>
        </span>
        <span class="row tree-drop-actions">
          <Button size="sm" icon="folder" data-tree-pick="folder">
            フォルダーを選択
          </Button>
          <Button size="sm" icon="file" data-tree-pick="files">
            ファイル・zip を選択
          </Button>
        </span>
        <span class="tree-drop-limit muted small">
          最大 {maxFiles} 個・合計 {formatBytes(maxSize)}
          <span>（1 回のアップロードは {formatBytes(MAX_FILE_SIZE)}）まで</span>
        </span>
        <span class="tree-drop-busy" role="status">
          アップロードしています…
        </span>
      </div>
      <Popover
        class="tree-excluded"
        panelClass="tree-excluded-panel"
        trigger={
          <summary class="tree-excluded-trigger">
            <Chip icon="info">除外されるファイル</Chip>
          </summary>
        }
      >
        <p class="small">次の名前のフォルダーとファイルは、アップロードしても自動で外します。</p>
        <ul class="tree-excluded-list">
          {EXCLUDED_NAMES.map((name) => (
            <li>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </Popover>
    </form>
  )
}
