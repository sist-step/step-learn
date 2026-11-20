import type { Server as HttpServer } from 'node:http'
import { userFromCookieHeader } from './auth'
import { openItemFor } from './item-access'
import type { PresentationTargetIds } from './presentation'
import { PRESENTATION_REF_PREFIX } from './presentation-items'
import { attachPresentationSocket } from './presentation-socket'

async function authorize(cookie: string | undefined, { courseId, itemId }: PresentationTargetIds) {
  const user = await userFromCookieHeader(cookie)
  const opened = user && (await openItemFor(user, 'presentation', itemId))
  if (!opened || opened.item.courseId !== courseId) return null
  return `${PRESENTATION_REF_PREFIX}${itemId}`
}

export const attach = (httpServer: HttpServer) => attachPresentationSocket(httpServer, { authorize })
