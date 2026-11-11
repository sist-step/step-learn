import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { deleteKeys, inBackground } from '../lib/storage'
import { forgetCourse } from './cache'
import { isTokenError, type Api } from './client'
import { db } from './db'
import { extraKindOf, extraTypeOfModule, type ExtraData } from './extra-kinds'
import type { MItem } from './mapping'
import { bundleFiles, extraItems } from './schema'

export const newExtraKey = () => crypto.randomBytes(16).toString('base64url')

/** 専用の活動に置き換える前の形（/m/<key> の URL の活動）で残っているアイテム。もう開けないので、Moodle からも消す */
export type RetiredItem = { cmid: number; key: string }

/**
 * extra のアイテムに中身を付ける。ほかのコースで作った中身（Moodle でコピーされた活動）と、なくなった種類の中身は付けない。
 * 専用の活動でまだ中身がないもの（Moodle の画面で作った・コピーした活動）には、空の中身を作る。
 * 専用の活動に置き換えた種類の、URL の活動のままのアイテムは一覧から外し、retired で返す
 */
export function withExtras<T extends { items: MItem[] }>(courseId: number, outline: T): T & { retired: RetiredItem[] } {
  const keys = outline.items.flatMap((it) => (it.extraKey ? [it.extraKey] : []))
  if (!keys.length) return { ...outline, retired: [] }
  // コースで絞らないのは、ほかのコースで作った中身と、まだ中身がない鍵を見分けるため
  const rows = db
    .select({ key: extraItems.key, courseId: extraItems.courseId, type: extraItems.type, data: extraItems.data })
    .from(extraItems)
    .where(inArray(extraItems.key, keys))
    .all()
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const retired: RetiredItem[] = []
  const items = outline.items.flatMap((it) => {
    if (!it.extraKey) return [it]
    const ownType = extraTypeOfModule(it.modname)
    let row = byKey.get(it.extraKey)
    if (!row && ownType) {
      row = { key: it.extraKey, courseId, type: ownType, data: {} }
      insertExtra({ ...row, cmid: it.id })
      byKey.set(row.key, row)
    }
    const kind = row && extraKindOf(row.type)
    if (!row || !kind) return [it]
    if (kind.module && kind.module.name !== it.modname) {
      retired.push({ cmid: it.id, key: it.extraKey })
      return []
    }
    if (row.courseId !== courseId || (ownType && ownType !== row.type)) return [it]
    return [{ ...it, extra: { type: row.type, data: row.data, live: !!kind.isLive?.(it.id) } }]
  })
  return { ...outline, items, retired }
}

/** 専用の活動に置き換える前の形のアイテムを、Moodle と moodle-mode.db から消す。Moodle の活動を消せる人（教師）が開いたときに呼ぶ */
export async function removeRetired(moodle: Api, courseId: number, retired: RetiredItem[]) {
  try {
    await moodle.updateCourse(
      courseId,
      'cm_delete',
      retired.map((r) => r.cmid),
    )
  } catch (e) {
    // コースの画面ごと失敗させないのは、同時に開いた別の画面が先に消していることがあり、消せなくても一覧からは外してあるため
    if (isTokenError(e)) throw e
    console.error('[moodle] remove retired items', e)
    return
  }
  // このコースで作った中身だけを消すのは、コピーされた活動の鍵が指す中身は、コピー元のコースのものなため
  const own = and(
    eq(extraItems.courseId, courseId),
    inArray(
      extraItems.key,
      retired.map((r) => r.key),
    ),
  )
  const stored = db
    .select({ fileKey: bundleFiles.fileKey })
    .from(bundleFiles)
    .innerJoin(extraItems, eq(extraItems.key, bundleFiles.key))
    .where(own)
    .all()
  db.delete(extraItems).where(own).run()
  inBackground(deleteKeys(stored.map((f) => f.fileKey)))
  forgetCourse(courseId)
}

export const findExtra = (key: string) =>
  db
    .select({ courseId: extraItems.courseId, cmid: extraItems.cmid, type: extraItems.type })
    .from(extraItems)
    .where(eq(extraItems.key, key))
    .get()

export const insertExtra = (row: { key: string; courseId: number; cmid: number; type: string; data: ExtraData }) =>
  db.insert(extraItems).values(row).run()

export const updateExtraData = (key: string, courseId: number, data: ExtraData) =>
  db
    .update(extraItems)
    .set({ data })
    .where(and(eq(extraItems.key, key), eq(extraItems.courseId, courseId)))
    .run()
