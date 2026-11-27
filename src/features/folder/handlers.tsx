import type { Context } from 'hono'
import { intParam, redirectWith } from '../../lib/http'
import { openItem } from '../../lib/item-access'
import { HTML_PAGE_CSP, isHtmlFile, previewKind, typeFromName } from '../../lib/preview'
import { deleteKeys, inBackground, putCourseFile, storage, type StoredFile } from '../../lib/storage'
import { readTreeRemove, readTreeUploads, treeUploadProblem, treeZip } from '../../lib/tree-upload'
import type { AppEnv } from '../../lib/types'
import { MAX_FOLDER_FILES, MAX_FOLDER_SIZE, opensInBrowser } from './folder'
import {
  folderStoredFiles,
  getFolderFile,
  getFolderSettings,
  listFolderFiles,
  putFolderFiles,
  removeFolderFiles,
  type NewFolderFile,
} from './folder-items'

const LIMITS = { maxFiles: MAX_FOLDER_FILES, maxSize: MAX_FOLDER_SIZE }

const editUrl = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/edit`

async function manage(c: Context<AppEnv>) {
  const opened = await openItem(c, 'folder')
  return opened?.access.canManage ? opened : null
}

export async function upload(c: Context<AppEnv>) {
  const opened = await manage(c)
  if (!opened) return c.notFound()
  const courseId = opened.access.course.id
  const { itemId } = opened
  const back = editUrl(courseId, itemId)
  const read = await readTreeUploads(c, LIMITS)
  if (!read.ok) return redirectWith(c, back, read.error, 'error')
  const { uploads, skipped } = read
  const problem = treeUploadProblem(listFolderFiles(itemId), uploads, LIMITS)
  if (problem) return redirectWith(c, back, problem, 'error')

  const stored: (StoredFile & { path: string })[] = []
  // 失敗したまま置いたファイルを残さないのは、置いている間にアイテムが消されると行を足せず、DB から辿れないファイルになるため
  try {
    for (const { path, file } of uploads) {
      // 受け取った種類だけに頼らないのは、zip から取り出したファイルには種類がなく、PDF や画像もブラウザで開けなくなるため
      const typed = file.type ? file : new File([file], file.name, { type: typeFromName(file.name) })
      stored.push({ ...(await putCourseFile(courseId, typed)), path })
    }
    const files: NewFolderFile[] = stored.map((f) => ({ path: f.path, fileKey: f.key, size: f.size, type: f.type }))
    inBackground(deleteKeys(putFolderFiles(itemId, files)))
  } catch (err) {
    inBackground(deleteKeys(stored.map((f) => f.key)))
    throw err
  }
  const note = skipped ? `（${skipped} 個は .git などの置かないファイルとして外しました）` : ''
  return redirectWith(c, back, `${stored.length} 個のファイルをアップロードしました。${note}`)
}

export async function remove(c: Context<AppEnv>) {
  const opened = await manage(c)
  if (!opened) return c.notFound()
  const target = await readTreeRemove(c)
  if (!target) return c.notFound()
  inBackground(deleteKeys(removeFolderFiles(opened.itemId, target.match)))
  return redirectWith(c, editUrl(opened.access.course.id, opened.itemId), target.message, 'info')
}

export async function download(c: Context<AppEnv>) {
  const opened = await openItem(c, 'folder')
  // 教師にはボタンを隠していても使わせるのは、学生に配る前に中身をまとめて確かめられるようにするため
  if (!opened || !(opened.access.canManage || getFolderSettings(opened.itemId).showDownload)) return c.notFound()
  const files = folderStoredFiles(opened.itemId).map((f) => ({
    path: f.path,
    read: async () => (f.size ? ((await storage.read(f.fileKey, f.size)) ?? new Uint8Array()) : new Uint8Array()),
  }))
  return treeZip(c, opened.item.title, files)
}

export async function open(c: Context<AppEnv>) {
  const opened = await openItem(c, 'folder')
  const fileId = intParam(c, 'fid')
  const file = opened && fileId ? getFolderFile(opened.itemId, fileId) : undefined
  if (!opened || !file) return c.notFound()
  const filename = file.path.split('/').pop()!
  const inBrowser = opensInBrowser(getFolderSettings(opened.itemId), file)
  if (inBrowser && isHtmlFile(file.type, file.path)) {
    const res = await storage.serve(file.fileKey, { filename, contentType: 'text/html', inline: true, csp: HTML_PAGE_CSP })
    return res ?? c.notFound()
  }
  const preview = inBrowser ? previewKind(file.type, file.path) : null
  // テキストを text/plain の sandbox で返すのは、HTML や SVG として同一オリジンで描かせずに、中身だけを読めるようにするため
  const res = await storage.serve(file.fileKey, {
    filename,
    contentType: preview === 'text' ? 'text/plain; charset=utf-8' : file.type,
    inline: !!preview,
    range: c.req.header('range'),
    ...(preview === 'text' && { csp: 'sandbox' }),
  })
  return res ?? c.notFound()
}
