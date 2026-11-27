import type { TreeLink } from '../../lib/file-tree'
import { isHtmlFile, previewKind } from '../../lib/preview'

/** Moodle のフォルダーと同じ 4 つの設定。真偽は 0 / 1 */
export type FolderSettings = {
  /** コースのページに中身を並べる */
  showInline: number
  /** サブフォルダーを開いた状態で見せる */
  showExpanded: number
  /** まとめて zip でダウンロードするボタンを見せる */
  showDownload: number
  /** ファイルをブラウザで開かずに保存させる */
  forceDownload: number
}

export const DEFAULT_FOLDER_SETTINGS: FolderSettings = { showInline: 0, showExpanded: 1, showDownload: 1, forceDownload: 0 }

/** アイテム 1 つに置けるファイルの数と合計の大きさ */
export const MAX_FOLDER_FILES = 500
export const MAX_FOLDER_SIZE = 500 * 1024 * 1024

export type FolderFile = { id: number; path: string; size: number; type: string }

export type FolderView = { settings: FolderSettings; files: FolderFile[] }

/** アイテムの URL の下の、フォルダーの操作の URL（/courses/:id/items/:iid/folder） */
export const folderBase = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/folder`

/** ブラウザで開けるファイルか。開けないものと、ブラウザで開かない設定のものは保存させる */
export const opensInBrowser = (settings: Pick<FolderSettings, 'forceDownload'>, file: Pick<FolderFile, 'path' | 'type'>) =>
  !settings.forceDownload && (previewKind(file.type, file.path) !== null || isHtmlFile(file.type, file.path))

/** 木の中のファイルを開くリンク */
export function folderLinks(base: string, { settings, files }: FolderView) {
  const byPath = new Map(files.map((f) => [f.path, f]))
  return (path: string): TreeLink | null => {
    const file = byPath.get(path)
    return file ? { href: `${base}/files/${file.id}`, download: !opensInBrowser(settings, file) } : null
  }
}
