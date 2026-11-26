import type { Context } from 'hono'
import { firstError, isFile, validate } from '../../lib/forms'
import { intParam, readFields, readForm, redirectWith } from '../../lib/http'
import { openItem } from '../../lib/item-access'
import { previewKind } from '../../lib/preview'
import { deleteKeys, inBackground, putCourseFile, storage, uploadProblem, type StoredFile } from '../../lib/storage'
import type { AppEnv } from '../../lib/types'
import { MAX_PUBLICATION_FILES, isPublic, publicationStateOf, uploadPeriodState, type PublicationState } from './publication'
import {
  addPublicationFiles,
  countUserFiles,
  deletePublicationFile,
  getPublicationFile,
  getPublicationSettings,
  publicationViewOf,
  setPublicationStatus,
} from './publication-items'

const nowUnix = () => Math.floor(Date.now() / 1000)

const itemUrl = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}`

const STATUS_DONE: Record<PublicationState, string> = {
  public: '公開しました',
  waiting: '承認待ちに戻しました',
  rejected: '非公開にしました',
}

const PERIOD_CLOSED = { before: 'まだ提出の期間が始まっていません。', after: '提出の期間は終わりました。' } as const

export async function upload(c: Context<AppEnv>) {
  const opened = await openItem(c, 'publication')
  if (!opened || opened.access.role !== 'student') return c.notFound()
  const { access, itemId } = opened
  const courseId = access.course.id
  const back = itemUrl(courseId, itemId)
  const period = uploadPeriodState(getPublicationSettings(itemId), nowUnix())
  if (period !== 'open') return redirectWith(c, back, PERIOD_CLOSED[period], 'error')

  // readFields を使わないのは、同じ名前の欄が並ぶとき、最後の 1 つしか受け取れないため
  const result = validate('publicationUpload', await readForm(c, { all: true }))
  if (!result.ok) return redirectWith(c, back, firstError(result.errors), 'error')
  const files = result.values.files.filter(isFile)
  const userId = c.var.user!.id
  const room = MAX_PUBLICATION_FILES - (await countUserFiles(itemId, userId))
  if (files.length > room)
    return redirectWith(
      c,
      back,
      `アップロードできるファイルは 1 人 ${MAX_PUBLICATION_FILES} 個までです（あと ${Math.max(0, room)} 個）。`,
      'error',
    )
  // 1 つずつ確かめるのは、どのファイルで止めたかを伝えるため
  for (const file of files) {
    const problem = await uploadProblem(file)
    if (problem) return redirectWith(c, back, `「${file.name}」: ${problem}`, 'error')
  }

  const stored: StoredFile[] = []
  for (const file of files) stored.push(await putCourseFile(courseId, file))
  // 失敗したまま置いたファイルを残さないのは、置いている間にアイテムが消されると行を足せず、DB から辿れないファイルになるため
  try {
    addPublicationFiles(itemId, userId, stored)
  } catch (err) {
    inBackground(deleteKeys(stored.map((f) => f.key)))
    throw err
  }
  const settings = getPublicationSettings(itemId)
  const message = settings.approval ? '先生が承認すると、ほかの学生に公開されます。' : 'ほかの学生にも公開されました。'
  return redirectWith(c, back, `${files.length} 個のファイルをアップロードしました。${message}`)
}

/** URL の :fid のファイルと、それを開いた人の権限 */
async function openFile(c: Context<AppEnv>) {
  const opened = await openItem(c, 'publication')
  const fileId = intParam(c, 'fid')
  const file = opened && fileId ? getPublicationFile(opened.itemId, fileId) : undefined
  return opened && file ? { ...opened, file, own: file.userId === c.var.user!.id } : null
}

export async function download(c: Context<AppEnv>) {
  const opened = await openFile(c)
  if (!opened) return c.notFound()
  const { access, file, own, itemId } = opened
  if (!access.canManage && !own && !isPublic(getPublicationSettings(itemId), file.status)) return c.notFound()
  const preview = c.req.query('inline') === '1' ? previewKind(file.type, file.name) : null
  // テキストをインラインで返さないのは、学生が上げた HTML や SVG を同一オリジンで描かせないため
  const res = await storage.serve(file.fileKey, {
    filename: file.name,
    contentType: file.type,
    inline: !!preview && preview !== 'text',
    range: c.req.header('range'),
  })
  return res ?? c.notFound()
}

export async function remove(c: Context<AppEnv>) {
  const opened = await openFile(c)
  if (!opened) return c.notFound()
  const { access, file, own, itemId } = opened
  const courseId = access.course.id
  const back = itemUrl(courseId, itemId)
  if (!access.canManage) {
    if (!own) return c.notFound()
    const period = uploadPeriodState(getPublicationSettings(itemId), nowUnix())
    if (period !== 'open') return redirectWith(c, back, `${PERIOD_CLOSED[period]}ファイルは削除できません。`, 'error')
  }
  const removed = deletePublicationFile(itemId, file.id)
  if (!removed) return c.notFound()
  inBackground(deleteKeys([removed.fileKey]))
  return redirectWith(c, back, `「${removed.name}」を削除しました。`, 'info')
}

export async function setStatus(c: Context<AppEnv>) {
  const opened = await openFile(c)
  if (!opened?.access.canManage) return c.notFound()
  const { access, file, itemId } = opened
  const fields = await readFields(c, 'publicationStatus')
  if (!fields) return c.notFound()
  setPublicationStatus(itemId, [file.id], fields.status)
  const state = publicationStateOf(getPublicationSettings(itemId), fields.status)
  return redirectWith(c, itemUrl(access.course.id, itemId), `「${file.name}」を${STATUS_DONE[state]}。`)
}

export async function approveAll(c: Context<AppEnv>) {
  const opened = await openItem(c, 'publication')
  if (!opened?.access.canManage) return c.notFound()
  const { access, itemId } = opened
  const pending = publicationViewOf(itemId, { id: c.var.user!.id, manage: true }, nowUnix()).others.filter((f) => f.status === 'pending')
  const changed = setPublicationStatus(
    itemId,
    pending.map((f) => f.id),
    'approved',
  )
  return redirectWith(c, itemUrl(access.course.id, itemId), `${changed} 個のファイルを承認しました。`)
}
