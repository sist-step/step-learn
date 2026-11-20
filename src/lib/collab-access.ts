import type { Server as HttpServer } from 'node:http'
import { userFromCookieHeader } from './auth'
import { ownerFor } from './collab'
import { collabStore, getCollabSettings } from './collab-items'
import type { CollabAuth } from './collab-protocol'
import { attachCollab } from './collab-server'
import { openItemFor } from './item-access'

async function authorize(cookie: string | undefined, { courseId, itemId, owner: requested }: CollabAuth) {
  const user = await userFromCookieHeader(cookie)
  const opened = user && (await openItemFor(user, 'collab', itemId))
  if (!user || !opened || opened.item.courseId !== courseId) return null
  const settings = getCollabSettings(itemId)
  if (!settings) return null
  const store = collabStore(courseId, itemId)
  const owner = ownerFor(store, settings, { id: user.id, canManage: opened.access.canManage }, requested)
  return owner ? { user: { id: user.id, name: user.name }, doc: store.doc(owner) } : null
}

export const attach = (httpServer: HttpServer) => attachCollab(httpServer, { authorize })
