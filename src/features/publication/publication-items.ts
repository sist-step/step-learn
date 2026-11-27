import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../lib/db'
import { publicationFiles, publicationItems, users } from '../../lib/schema'
import type { StoredFile } from '../../lib/storage'
import {
  DEFAULT_PUBLICATION_SETTINGS,
  isPublic,
  uploadPeriodState,
  type PublicationFile,
  type PublicationSettings,
  type PublicationStatus,
  type PublicationView,
} from './publication'

export function getPublicationSettings(itemId: number): PublicationSettings {
  const row = db.select().from(publicationItems).where(eq(publicationItems.itemId, itemId)).get()
  if (!row) return DEFAULT_PUBLICATION_SETTINGS
  const { itemId: _, ...settings } = row
  return settings
}

export function savePublicationSettings(itemId: number, settings: PublicationSettings) {
  db.insert(publicationItems)
    .values({ itemId, ...settings })
    .onConflictDoUpdate({ target: publicationItems.itemId, set: settings })
    .run()
}

const fileColumns = {
  id: publicationFiles.id,
  userId: publicationFiles.userId,
  userName: users.name,
  name: publicationFiles.fileName,
  size: publicationFiles.fileSize,
  type: publicationFiles.fileType,
  status: publicationFiles.status,
  createdAt: publicationFiles.createdAt,
}

const listFiles = (itemId: number): PublicationFile[] =>
  db
    .select(fileColumns)
    .from(publicationFiles)
    .innerJoin(users, eq(users.id, publicationFiles.userId))
    .where(eq(publicationFiles.itemId, itemId))
    .orderBy(desc(publicationFiles.createdAt), desc(publicationFiles.id))
    .all()

/** アイテムの画面に出すファイル。学生には、自分のファイルと、ほかの学生の公開中のファイルだけを渡す */
export function publicationViewOf(itemId: number, viewer: { id: number; manage: boolean }, now: number): PublicationView {
  const settings = getPublicationSettings(itemId)
  const files = listFiles(itemId)
  const period = uploadPeriodState(settings, now)
  if (viewer.manage) return { settings, period, mine: [], others: files, manage: true }
  return {
    settings,
    period,
    mine: files.filter((f) => f.userId === viewer.id),
    others: files
      .filter((f) => f.userId !== viewer.id && isPublic(settings, f.status))
      .map((f) => (settings.showNames ? f : { ...f, userName: '' })),
    manage: false,
  }
}

export const countUserFiles = (itemId: number, userId: number) =>
  db.$count(publicationFiles, and(eq(publicationFiles.itemId, itemId), eq(publicationFiles.userId, userId)))

export function addPublicationFiles(itemId: number, userId: number, stored: StoredFile[]) {
  if (!stored.length) return
  db.insert(publicationFiles)
    .values(stored.map((f) => ({ itemId, userId, fileKey: f.key, fileName: f.name, fileSize: f.size, fileType: f.type })))
    .run()
}

/** アイテムの中のファイル 1 つ。ほかのアイテムの ID を URL に入れられても返さない */
export const getPublicationFile = (itemId: number, fileId: number) =>
  db
    .select({ ...fileColumns, fileKey: publicationFiles.fileKey })
    .from(publicationFiles)
    .innerJoin(users, eq(users.id, publicationFiles.userId))
    .where(and(eq(publicationFiles.id, fileId), eq(publicationFiles.itemId, itemId)))
    .get()

export const deletePublicationFile = (itemId: number, fileId: number) =>
  db
    .delete(publicationFiles)
    .where(and(eq(publicationFiles.id, fileId), eq(publicationFiles.itemId, itemId)))
    .returning({ fileKey: publicationFiles.fileKey, name: publicationFiles.fileName })
    .get()

export const setPublicationStatus = (itemId: number, fileIds: number[], status: PublicationStatus) =>
  fileIds.length
    ? db
        .update(publicationFiles)
        .set({ status })
        .where(and(eq(publicationFiles.itemId, itemId), inArray(publicationFiles.id, fileIds)))
        .run().changes
    : 0

/** アイテムを消すときに一緒に消す、学生のファイルのキー */
export const publicationKeysOf = (itemId: number) =>
  db
    .select({ key: publicationFiles.fileKey })
    .from(publicationFiles)
    .where(eq(publicationFiles.itemId, itemId))
    .all()
    .map((r) => r.key)

export const publicationKeysOfUser = (userId: number) =>
  db
    .select({ key: publicationFiles.fileKey })
    .from(publicationFiles)
    .where(eq(publicationFiles.userId, userId))
    .all()
    .map((r) => r.key)
