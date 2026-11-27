import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '../../lib/db'
import { courseGroupMembers, courseGroups, enrollments } from '../../lib/schema'

export const MAX_GROUPS_PER_COURSE = 200

/** コースのグループ。名前の順 */
export const groupsOf = (courseId: number) =>
  db
    .select({
      id: courseGroups.id,
      name: courseGroups.name,
      members: db.$count(courseGroupMembers, eq(courseGroupMembers.groupId, courseGroups.id)),
    })
    .from(courseGroups)
    .where(eq(courseGroups.courseId, courseId))
    .orderBy(asc(courseGroups.name))
    .limit(MAX_GROUPS_PER_COURSE)
    .all()

export const findGroup = (courseId: number, groupId: number) =>
  db
    .select({ id: courseGroups.id, name: courseGroups.name })
    .from(courseGroups)
    .where(and(eq(courseGroups.id, groupId), eq(courseGroups.courseId, courseId)))
    .get()

export const memberIdsOf = (groupId: number) =>
  new Set(
    db
      .select({ userId: courseGroupMembers.userId })
      .from(courseGroupMembers)
      .where(eq(courseGroupMembers.groupId, groupId))
      .all()
      .map((r) => r.userId),
  )

/** userId の人が入っているコースのグループの ID */
export const groupIdsOf = (courseId: number, userId: number) =>
  new Set(
    db
      .select({ id: courseGroupMembers.groupId })
      .from(courseGroupMembers)
      .where(and(eq(courseGroupMembers.courseId, courseId), eq(courseGroupMembers.userId, userId)))
      .all()
      .map((r) => r.id),
  )

/** コースの参加者ごとの、入っているグループの ID */
export function membershipsOf(courseId: number) {
  const byUser = new Map<number, number[]>()
  for (const r of db
    .select({ userId: courseGroupMembers.userId, groupId: courseGroupMembers.groupId })
    .from(courseGroupMembers)
    .where(eq(courseGroupMembers.courseId, courseId))
    .all())
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.groupId])
  return byUser
}

/** グループのメンバーを userIds にする。コースの参加者でない人は入れない */
export function setGroupMembers(courseId: number, groupId: number, userIds: number[]) {
  db.transaction((tx) => {
    const enrolled = userIds.length
      ? tx
          .select({ userId: enrollments.userId })
          .from(enrollments)
          .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.userId, userIds)))
          .all()
          .map((r) => r.userId)
      : []
    tx.delete(courseGroupMembers)
      .where(and(eq(courseGroupMembers.groupId, groupId), enrolled.length ? notInArray(courseGroupMembers.userId, enrolled) : undefined))
      .run()
    if (enrolled.length)
      tx.insert(courseGroupMembers)
        .values(enrolled.map((userId) => ({ groupId, courseId, userId })))
        .onConflictDoNothing()
        .run()
  })
}
