import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../lib/db'
import { folderFiles, folderItems } from '../../lib/schema'
import { DEFAULT_FOLDER_SETTINGS, type FolderFile, type FolderSettings, type FolderView } from './folder'

/** フォルダーに置くファイル 1 つ。fileKey はストレージのキー */
export type NewFolderFile = { path: string; fileKey: string; size: number; type: string }

const settingsOf = ({ itemId: _, ...settings }: typeof folderItems.$inferSelect): FolderSettings => settings

export function getFolderSettings(itemId: number): FolderSettings {
  const row = db.select().from(folderItems).where(eq(folderItems.itemId, itemId)).get()
  return row ? settingsOf(row) : DEFAULT_FOLDER_SETTINGS
}

export function saveFolderSettings(itemId: number, settings: FolderSettings) {
  db.insert(folderItems)
    .values({ itemId, ...settings })
    .onConflictDoUpdate({ target: folderItems.itemId, set: settings })
    .run()
}

const FILE_COLUMNS = { id: folderFiles.id, path: folderFiles.path, size: folderFiles.fileSize, type: folderFiles.fileType }

export const listFolderFiles = (itemId: number): FolderFile[] =>
  db.select(FILE_COLUMNS).from(folderFiles).where(eq(folderFiles.itemId, itemId)).orderBy(folderFiles.path).all()

export const folderViewOf = (itemId: number): FolderView => ({ settings: getFolderSettings(itemId), files: listFolderFiles(itemId) })

/** コースのページに中身を並べるフォルダーの設定とファイル。itemIds のうち、並べる設定のものだけを返す */
export function inlineFolderViews(itemIds: number[]): Map<number, FolderView> {
  if (!itemIds.length) return new Map()
  const inline = db
    .select()
    .from(folderItems)
    .where(and(inArray(folderItems.itemId, itemIds), eq(folderItems.showInline, 1)))
    .all()
  if (!inline.length) return new Map()
  const files = db
    .select({ ...FILE_COLUMNS, itemId: folderFiles.itemId })
    .from(folderFiles)
    .where(
      inArray(
        folderFiles.itemId,
        inline.map((r) => r.itemId),
      ),
    )
    .orderBy(folderFiles.path)
    .all()
  return new Map(
    inline.map((row) => [
      row.itemId,
      { settings: settingsOf(row), files: files.filter((f) => f.itemId === row.itemId).map(({ itemId: _, ...f }) => f) },
    ]),
  )
}

/** アイテムの中のファイル 1 つ。ほかのアイテムの ID を URL に入れられても返さない */
export const getFolderFile = (itemId: number, fileId: number) =>
  db
    .select({ ...FILE_COLUMNS, fileKey: folderFiles.fileKey })
    .from(folderFiles)
    .where(and(eq(folderFiles.id, fileId), eq(folderFiles.itemId, itemId)))
    .get()

/** zip に入れる、ストレージのキー付きのファイル */
export const folderStoredFiles = (itemId: number) =>
  db
    .select({ path: folderFiles.path, size: folderFiles.fileSize, fileKey: folderFiles.fileKey })
    .from(folderFiles)
    .where(eq(folderFiles.itemId, itemId))
    .orderBy(folderFiles.path)
    .all()

/** 同じ場所のファイルは置き換える。置き換えて要らなくなったストレージのキーを返す */
export function putFolderFiles(itemId: number, files: NewFolderFile[]) {
  if (!files.length) return []
  return db.transaction((tx) => {
    const paths = files.map((f) => f.path)
    const ofPaths = and(eq(folderFiles.itemId, itemId), inArray(folderFiles.path, paths))
    // path は NOCASE なので、大文字と小文字だけが違う名前も置き換える対象として拾える
    const replaced = tx.select({ fileKey: folderFiles.fileKey }).from(folderFiles).where(ofPaths).all()
    tx.delete(folderFiles).where(ofPaths).run()
    tx.insert(folderFiles)
      .values(files.map((f) => ({ itemId, path: f.path, fileKey: f.fileKey, fileSize: f.size, fileType: f.type })))
      .run()
    return replaced.map((r) => r.fileKey)
  })
}

/** match に当てはまる場所のファイルを消す。消したファイルのストレージのキーを返す */
export function removeFolderFiles(itemId: number, match: (path: string) => boolean) {
  const targets = db
    .select({ id: folderFiles.id, path: folderFiles.path, fileKey: folderFiles.fileKey })
    .from(folderFiles)
    .where(eq(folderFiles.itemId, itemId))
    .all()
    .filter((f) => match(f.path))
  if (targets.length)
    db.delete(folderFiles)
      .where(
        and(
          eq(folderFiles.itemId, itemId),
          inArray(
            folderFiles.id,
            targets.map((f) => f.id),
          ),
        ),
      )
      .run()
  return targets.map((f) => f.fileKey)
}

/** アイテムを消すときに一緒に消す、置いたファイルのキー */
export const folderKeysOf = (itemId: number) =>
  db
    .select({ key: folderFiles.fileKey })
    .from(folderFiles)
    .where(eq(folderFiles.itemId, itemId))
    .all()
    .map((r) => r.key)
