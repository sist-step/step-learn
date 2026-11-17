import type { Server as HttpServer } from 'node:http'
import { and, eq } from 'drizzle-orm'
import { userFromCookieHeader } from './auth'
import { canOpenItem } from './availability'
import { COLLAB_KIND, ownerFor } from './collab'
import { collabStore, getCollabSettings } from './collab-items'
import type { CollabAuth } from './collab-protocol'
import { attachCollab } from './collab-server'
import { getCourseAccessFor, isVisibleItem } from './courses'
import { db } from './db'
import { items } from './schema'

const isCollabItem = (courseId: number, itemId: number) =>
  !!db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, COLLAB_KIND)))
    .get()

async function authorize(cookie: string | undefined, { courseId, itemId, owner: requested }: CollabAuth) {
  const user = await userFromCookieHeader(cookie)
  if (!user) return null
  const access = await getCourseAccessFor(user, courseId)
  if (!access || !isCollabItem(courseId, itemId) || !canOpenItem(user, access, itemId, isVisibleItem(itemId))) return null
  const settings = getCollabSettings(itemId)
  if (!settings) return null
  const store = collabStore(courseId, itemId)
  const owner = ownerFor(store, settings, { id: user.id, canManage: access.canManage }, requested)
  return owner ? { user: { id: user.id, name: user.name }, doc: store.doc(owner) } : null
}

export const attach = (httpServer: HttpServer) => attachCollab(httpServer, { authorize })
