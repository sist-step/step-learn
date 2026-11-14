import type { Server as HttpServer } from 'node:http'
import { and, eq } from 'drizzle-orm'
import { userFromCookieHeader } from './auth'
import { canOpenItem } from './availability'
import { getCourseAccessFor, isVisibleItem, touchCourse } from './courses'
import { db } from './db'
import { items } from './schema'
import { attachScreenShare } from './screen-share'
import type { ShareMode } from './screen-share-protocol'

const isScreenItem = (courseId: number, itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, 'screen')))
    .get()

async function authorize(cookie: string | undefined, courseId: number, itemId: number, mode: ShareMode) {
  const user = await userFromCookieHeader(cookie)
  if (!user) return null
  const access = await getCourseAccessFor(user, courseId)
  if (!access || (mode === 'present' && !access.canManage)) return null
  if (!isScreenItem(courseId, itemId)) return null
  if (!canOpenItem(user, access, itemId, isVisibleItem(itemId))) return null
  return user
}

export const attach = (httpServer: HttpServer) => attachScreenShare(httpServer, { authorize, onChange: touchCourse })
