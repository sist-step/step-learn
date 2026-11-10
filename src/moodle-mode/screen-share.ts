import type { Server as HttpServer } from 'node:http'
import { attachScreenShare } from '../lib/screen-share'
import type { ShareMode } from '../lib/screen-share-protocol'
import { sessionFromCookieHeader } from './auth'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { loadCourseAs, outlineOf, type LoadedCourse } from './data'

/** 画面共有の画面を開けるアイテム。開けなければ null */
export const findScreenItem = (loaded: LoadedCourse, itemId: number) =>
  outlineOf(loaded).find((it) => it.id === itemId && !it.locked && it.extra?.type === 'screen') ?? null

async function authorize(cookie: string | undefined, courseId: number, itemId: number, mode: ShareMode) {
  const found = await sessionFromCookieHeader(cookie)
  if (!found) return null
  try {
    const loaded = await loadCourseAs({ token: found.token, userId: found.user.id }, courseId)
    if (mode === 'present' && !loaded.access.canManage) return null
    return findScreenItem(loaded, itemId) ? found.user : null
  } catch (e) {
    // Moodle が一時的に止まっただけで切らないのは、授業中に全員の映像が途切れるため。権限がないと分かったときだけ切る
    if (isTokenError(e) || isNotFound(e) || isAccessDenied(e)) return null
    throw e
  }
}

// onChange で何もしないのは、Moodle モードのコースの版（revisionOf）は配信中かどうかも含めて内容から計算するため
export const attach = (httpServer: HttpServer) => attachScreenShare(httpServer, { authorize, onChange: () => {} })
