import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type { BundleFile, BundleStore } from '../lib/bundle'
import { MAX_LISTED_VERSIONS, type BundleSyncStore } from '../lib/bundle-sync'
import { db } from './db'
import { bundleFiles, bundleItems, bundleSyncVersions, users } from './schema'

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

const VERSION = {
  id: bundleSyncVersions.id,
  path: bundleSyncVersions.path,
  deleted: bundleSyncVersions.deleted,
  sha256: bundleSyncVersions.sha256,
  size: bundleSyncVersions.size,
  added: bundleSyncVersions.added,
  removed: bundleSyncVersions.removed,
  createdAt: bundleSyncVersions.createdAt,
}

const STUDENT = { id: users.id, name: users.name, username: users.username, email: users.email }

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの同期の設定と、学生が VS Code で保存したファイルの記録。key は extra_items の key */
export function bundleSyncStore(key: string): BundleSyncStore {
  const ofItem = eq(bundleSyncVersions.key, key)
  const ofUser = (userId: number) => and(ofItem, eq(bundleSyncVersions.userId, userId))
  return {
    enabled: () => !!db.select({ sync: bundleItems.sync }).from(bundleItems).where(eq(bundleItems.key, key)).get()?.sync,
    setEnabled: (on) =>
      void db
        .insert(bundleItems)
        .values({ key, sync: Number(on) })
        .onConflictDoUpdate({ target: bundleItems.key, set: { sync: Number(on) } })
        .run(),
    // コースの学生を並べないのは、参加者が Moodle にあり、STEP Learn は自分にログインした人しか知らないため。記録がある人だけを並べる
    listStudents: () =>
      db
        .select({ student: STUDENT, versions: count(), lastAt: max(bundleSyncVersions.createdAt) })
        .from(bundleSyncVersions)
        .innerJoin(users, eq(users.id, bundleSyncVersions.userId))
        .where(ofItem)
        .groupBy(users.id)
        .orderBy(users.name)
        .limit(1000)
        .all(),
    findUser: (userId) => db.select(STUDENT).from(users).where(eq(users.id, userId)).get(),
    listVersions: (userId) =>
      db
        .select(VERSION)
        .from(bundleSyncVersions)
        .where(ofUser(userId))
        .orderBy(desc(bundleSyncVersions.id))
        .limit(MAX_LISTED_VERSIONS)
        .all(),
    getVersion: (userId, id) =>
      db
        .select({ ...VERSION, content: bundleSyncVersions.content })
        .from(bundleSyncVersions)
        .where(and(ofUser(userId), eq(bundleSyncVersions.id, id)))
        .get(),
    latest: (userId, path) =>
      db
        .select({ ...VERSION, content: bundleSyncVersions.content })
        .from(bundleSyncVersions)
        .where(and(ofUser(userId), eq(bundleSyncVersions.path, path)))
        .orderBy(desc(bundleSyncVersions.id))
        .limit(1)
        .get(),
    add(userId, versions) {
      if (versions.length)
        db.insert(bundleSyncVersions)
          .values(versions.map((v) => ({ ...v, key, userId })))
          .run()
    },
    usage: (userId) =>
      db
        .select({ total: sql<number>`coalesce(sum(${bundleSyncVersions.size}), 0)` })
        .from(bundleSyncVersions)
        .where(ofUser(userId))
        .get()!.total,
  }
}
