import { and, eq, inArray } from 'drizzle-orm'
import type { BundleFile, BundleStore } from '../lib/bundle'
import { db } from './db'
import { bundleFiles } from './schema'

const COLUMNS = { path: bundleFiles.path, fileKey: bundleFiles.fileKey, size: bundleFiles.size, sha256: bundleFiles.sha256 }

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの配布するファイル。key は extra_items の key */
export function bundleStore(key: string): BundleStore {
  const ofItem = eq(bundleFiles.key, key)
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
            .values(files.map((f) => ({ ...f, key })))
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
