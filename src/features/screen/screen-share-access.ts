import type { Server as HttpServer } from 'node:http'
import { userFromCookieHeader } from '../../lib/auth'
import { touchCourse } from '../../lib/courses'
import { openItemFor } from '../../lib/item-access'
import { attachScreenShare } from './screen-share'
import type { ShareMode } from './screen-share-protocol'

async function authorize(cookie: string | undefined, courseId: number, itemId: number, mode: ShareMode) {
  const user = await userFromCookieHeader(cookie)
  const opened = user && (await openItemFor(user, 'screen', itemId))
  if (!user || !opened || opened.item.courseId !== courseId) return null
  if (mode === 'present' && !opened.access.canManage) return null
  return user
}

export const attach = (httpServer: HttpServer) => attachScreenShare(httpServer, { authorize, onChange: touchCourse })
