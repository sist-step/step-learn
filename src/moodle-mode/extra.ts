import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { extraKindOf, type ExtraData } from './extra-kinds'
import type { MItem } from './mapping'
import { extraItems } from './schema'

export const newExtraKey = () => crypto.randomBytes(16).toString('base64url')

/** extra のアイテムに中身を付ける。ほかのコースで作った中身（Moodle でコピーされた活動）と、なくなった種類の中身は付けない */
export function withExtras<T extends { items: MItem[] }>(courseId: number, outline: T): T {
  const keys = outline.items.flatMap((it) => (it.extraKey ? [it.extraKey] : []))
  if (!keys.length) return outline
  const rows = db
    .select({ key: extraItems.key, type: extraItems.type, data: extraItems.data })
    .from(extraItems)
    .where(and(eq(extraItems.courseId, courseId), inArray(extraItems.key, keys)))
    .all()
  const byKey = new Map(rows.filter((r) => extraKindOf(r.type)).map((r) => [r.key, r]))
  return {
    ...outline,
    items: outline.items.map((it) => {
      const row = it.extraKey ? byKey.get(it.extraKey) : undefined
      return row ? { ...it, extra: { type: row.type, data: row.data } } : it
    }),
  }
}

export const findExtra = (key: string) =>
  db.select({ courseId: extraItems.courseId, cmid: extraItems.cmid }).from(extraItems).where(eq(extraItems.key, key)).get()

export const insertExtra = (row: { key: string; courseId: number; cmid: number; type: string; data: ExtraData }) =>
  db.insert(extraItems).values(row).run()

export const updateExtraData = (key: string, courseId: number, data: ExtraData) =>
  db
    .update(extraItems)
    .set({ data })
    .where(and(eq(extraItems.key, key), eq(extraItems.courseId, courseId)))
    .run()
