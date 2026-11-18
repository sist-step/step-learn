import type { Server as HttpServer } from 'node:http'
import { userFromCookieHeader } from './auth'
import { canOpenItem } from './availability'
import { getCourseAccessFor, isVisibleItem } from './courses'
import type { PresentationTargetIds } from './presentation'
import { PRESENTATION_REF_PREFIX, getPresentationItem } from './presentation-items'
import { attachPresentationSocket } from './presentation-socket'

async function authorize(cookie: string | undefined, { courseId, itemId }: PresentationTargetIds) {
  const user = await userFromCookieHeader(cookie)
  if (!user) return null
  const access = await getCourseAccessFor(user, courseId)
  const item = getPresentationItem(itemId)
  if (!access || item?.courseId !== courseId || !canOpenItem(user, access, itemId, isVisibleItem(itemId))) return null
  return `${PRESENTATION_REF_PREFIX}${itemId}`
}

export const attach = (httpServer: HttpServer) => attachPresentationSocket(httpServer, { authorize })
