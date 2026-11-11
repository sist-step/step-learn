import { and, eq, inArray } from 'drizzle-orm'
import type { BundleFile, BundleStore } from './bundle'
import { db } from './db'
import { bundleFiles, items } from './schema'

const COLUMNS = { path: bundleFiles.path, fileKey: bundleFiles.fileKey, size: bundleFiles.size, sha256: bundleFiles.sha256 }

/** 通常モード（step-learn.db）の、アイテム 1 つの配布するファイル */
export function bundleStore(itemId: number): BundleStore {
  const ofItem = eq(bundleFiles.itemId, itemId)
  const list = () => db.select(COLUMNS).from(bundleFiles).where(ofItem).orderBy(bundleFiles.path).all()
  return {
    list,
    put: (files: BundleFile[]) =>
      db.transaction((tx) => {
        const paths = files.map((f) => f.path)
        // path は NOCASE なので、大文字と小文字だけが違う名前も置き換える対象として拾える
        const replaced = tx
          .select({ fileKey: bundleFiles.fileKey })
          .from(bundleFiles)
          .where(and(ofItem, inArray(bundleFiles.path, paths)))
          .all()
        tx.delete(bundleFiles)
          .where(and(ofItem, inArray(bundleFiles.path, paths)))
          .run()
        if (files.length)
          tx.insert(bundleFiles)
            .values(files.map((f) => ({ ...f, itemId })))
            .run()
        return replaced.map((r) => r.fileKey)
      }),
    remove(match) {
      const targets = list().filter((f) => match(f.path))
      if (targets.length)
        db.delete(bundleFiles)
          .where(
            and(
              ofItem,
              inArray(
                bundleFiles.fileKey,
                targets.map((f) => f.fileKey),
              ),
            ),
          )
          .run()
      return targets.map((f) => f.fileKey)
    },
  }
}

/** アイテムを消す前に、配布するファイルのストレージのキーを集める（DB の行は cascade で消える） */
export const bundleKeysOf = (itemIds: number[]) =>
  itemIds.length
    ? db
        .select({ fileKey: bundleFiles.fileKey })
        .from(bundleFiles)
        .where(inArray(bundleFiles.itemId, itemIds))
        .all()
        .map((r) => r.fileKey)
    : []

/** ファイル自動配布のアイテムなら、そのコースの ID とタイトル */
export const getBundleItem = (itemId: number) =>
  db
    .select({ courseId: items.courseId, title: items.title })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.type, 'bundle')))
    .get()
