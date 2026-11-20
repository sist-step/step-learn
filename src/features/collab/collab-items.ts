import { and, eq } from 'drizzle-orm'
import { ownerUserId, startsFromTemplate, type CollabOwner, type CollabSettings, type CollabStore } from './collab'
import { db } from '../../lib/db'
import { collabDocs, collabItems, enrollments, users } from '../../lib/schema'

/** 行がない（作ったときに保存しそこねた）アイテムは null。開けないものとして扱う */
export const getCollabSettings = (itemId: number): CollabSettings | null =>
  db.select({ kind: collabItems.kind, scope: collabItems.scope }).from(collabItems).where(eq(collabItems.itemId, itemId)).get() ?? null

const loadState = (itemId: number, owner: CollabOwner) =>
  db
    .select({ state: collabDocs.state })
    .from(collabDocs)
    .where(and(eq(collabDocs.itemId, itemId), eq(collabDocs.owner, owner)))
    .get()?.state ?? null

const roomKey = (itemId: number, owner: CollabOwner) => `${itemId}:${owner}`

/** 通常モード（step-learn.db）の、アイテム 1 つのファイル */
export function collabStore(courseId: number, itemId: number): CollabStore {
  return {
    doc: (owner) => ({
      key: roomKey(itemId, owner),
      load: () => loadState(itemId, owner),
      save(state, userId) {
        const values = { state: Buffer.from(state), updatedBy: userId || null }
        db.insert(collabDocs)
          .values({ itemId, owner, userId: ownerUserId(owner), ...values })
          .onConflictDoUpdate({ target: [collabDocs.itemId, collabDocs.owner], set: values })
          .run()
      },
      template: startsFromTemplate(owner) ? { key: roomKey(itemId, 'template'), load: () => loadState(itemId, 'template') } : undefined,
    }),
    students: () =>
      db
        .select({ id: users.id, name: users.name, updatedAt: collabDocs.updatedAt })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .leftJoin(collabDocs, and(eq(collabDocs.itemId, itemId), eq(collabDocs.userId, users.id)))
        .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'student')))
        .orderBy(users.name)
        .limit(1000)
        .all(),
    isStudent: (userId) =>
      !!db
        .select({ userId: enrollments.userId })
        .from(enrollments)
        .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId), eq(enrollments.role, 'student')))
        .get(),
    imagePrefix: `courses/${courseId}/collab/${itemId}`,
  }
}
