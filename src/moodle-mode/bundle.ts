import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { BUNDLE_KIND } from '../lib/bundle'
import { intParam } from '../lib/http'
import type { BundleBackend } from '../routes/bundle/handlers'
import type { MoodleEnv } from './auth'
import { bundleStore } from './bundle-store'
import { loadCourse, outlineOf } from './data'
import { db } from './db'
import { extraItems } from './schema'

const REF_PREFIX = 'm-'

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
    return { access: loaded.access, itemId, title: item.title, ref: `${REF_PREFIX}${item.extraKey}`, store: bundleStore(item.extraKey) }
  },
  storeOf(ref) {
    const key = ref.slice(REF_PREFIX.length)
    if (!ref.startsWith(REF_PREFIX) || !key) return null
    const found = db
      .select({ key: extraItems.key })
      .from(extraItems)
      .where(and(eq(extraItems.key, key), eq(extraItems.type, BUNDLE_KIND)))
      .get()
    return found ? bundleStore(key) : null
  },
}
