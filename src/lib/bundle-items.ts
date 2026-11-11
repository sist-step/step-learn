import { and, count, desc, eq, inArray, max, or, sql } from 'drizzle-orm'
import type { BundleFile, BundleStore } from './bundle'
import { MAX_LISTED_VERSIONS, type BundleSyncStore } from './bundle-sync'
import { db } from './db'
import { bundleFiles, bundleItems, bundleSyncVersions, enrollments, items, users } from './schema'

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

/** 通常モード（step-learn.db）の、アイテム 1 つの同期の設定と、学生が VS Code で保存したファイルの記録 */
export function bundleSyncStore(courseId: number, itemId: number): BundleSyncStore {
  const ofItem = eq(bundleSyncVersions.itemId, itemId)
  const ofUser = (userId: number) => and(ofItem, eq(bundleSyncVersions.userId, userId))
  return {
    enabled: () => !!db.select({ sync: bundleItems.sync }).from(bundleItems).where(eq(bundleItems.itemId, itemId)).get()?.sync,
    setEnabled: (on) =>
      void db
        .insert(bundleItems)
        .values({ itemId, sync: Number(on) })
        .onConflictDoUpdate({ target: bundleItems.itemId, set: { sync: Number(on) } })
        .run(),
    listStudents() {
      const stats = db
        .select({ userId: bundleSyncVersions.userId, versions: count(), lastAt: max(bundleSyncVersions.createdAt) })
        .from(bundleSyncVersions)
        .where(ofItem)
        .groupBy(bundleSyncVersions.userId)
        .all()
      const byUser = new Map(stats.map((s) => [s.userId, s]))
      // 記録がある人も並べるのは、教師や管理者が試しに開いたときの記録が、どこからも見えなくならないようにするため
      const students = db
        .selectDistinct(STUDENT)
        .from(users)
        .leftJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.courseId, courseId)))
        .where(
          or(
            eq(enrollments.role, 'student'),
            inArray(
              users.id,
              stats.map((s) => s.userId),
            ),
          ),
        )
        .orderBy(users.name)
        .limit(1000)
        .all()
      return students.map((student) => ({
        student,
        versions: byUser.get(student.id)?.versions ?? 0,
        lastAt: byUser.get(student.id)?.lastAt ?? null,
      }))
    },
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
          .values(versions.map((v) => ({ ...v, itemId, userId })))
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
