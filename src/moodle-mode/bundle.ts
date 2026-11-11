import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { BUNDLE_KIND } from '../lib/bundle'
import { intParam } from '../lib/http'
import type { BundleBackend } from '../routes/bundle/handlers'
import { storedToken, type MoodleEnv } from './auth'
import { bundleStore, bundleSyncStore } from './bundle-store'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { loadCourse, loadCourseAs, outlineOf, type Viewer } from './data'
import { db } from './db'
import { extraItems } from './schema'

const REF_PREFIX = 'm-'

/** viewer に、コースのその鍵のファイル自動配布の活動が Moodle で見えているか */
async function listedInMoodle(viewer: Viewer, courseId: number, key: string) {
  try {
    const { items } = await loadCourseAs(viewer, courseId)
    return items.some((it) => it.extraKey === key && it.extra?.type === BUNDLE_KIND)
  } catch (e) {
    if (isNotFound(e) || isTokenError(e) || isAccessDenied(e)) return false
    throw e
  }
}

/** Moodle モード: 配布するファイルを moodle-mode.db に置き、権限を Moodle のコースから確かめる */
export const bundleBackend: BundleBackend = {
  // 通常モードと同じ courses/ に置かないのは、Moodle のコース ID と STEP Learn のコース ID がぶつかり、通常モードでコースを消したときに一緒に消えてしまうため
  keyPrefix: (courseId) => `moodle-mode/courses/${courseId}/`,
  editUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/edit`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = outlineOf(loaded).find((it) => it.id === itemId && !it.locked && it.extra?.type === BUNDLE_KIND)
    if (!item?.extraKey) return null
    return {
      access: loaded.access,
      itemId,
      title: item.title,
      ref: `${REF_PREFIX}${item.extraKey}`,
      store: bundleStore(item.extraKey),
      sync: bundleSyncStore(item.extraKey),
    }
  },
  async itemOf(ref, userId) {
    const key = ref.slice(REF_PREFIX.length)
    if (!ref.startsWith(REF_PREFIX) || !key) return null
    const found = db
      .select({ courseId: extraItems.courseId })
      .from(extraItems)
      .where(and(eq(extraItems.key, key), eq(extraItems.type, BUNDLE_KIND)))
      .get()
    const token = found && storedToken(userId)
    if (!found || !token) return null
    // 中身の行があるかだけで決めないのは、Moodle のごみ箱から戻せるよう、活動を消しても中身を残しているため。
    // Moodle の画面から消した活動も止められるよう、STEP Learn で消したときの印ではなく、Moodle に今もあるかで確かめる
    if (!(await listedInMoodle({ token, userId }, found.courseId, key))) return null
    return { store: bundleStore(key), sync: bundleSyncStore(key) }
  },
}
