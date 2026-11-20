import { eq } from 'drizzle-orm'
import { credentialStampOf } from '../../lib/auth'
import { canOpenItem } from '../../lib/availability'
import { bundleStore, bundleSyncStore, getBundleItem } from '../../lib/bundle-items'
import { getCourseAccess, getCourseAccessFor, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { users } from '../../lib/schema'
import type { BundleBackend } from './handlers'

const REF_PREFIX = 'item-'

const findUser = (userId: number) =>
  db
    .select({ id: users.id, email: users.email, name: users.name, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()

/** 通常モード: 配布するファイルを step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: BundleBackend = {
  keyPrefix: (courseId) => `courses/${courseId}/`,
  editUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/edit`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    if (!access) return null
    const item = getBundleItem(itemId)
    if (!item || item.courseId !== courseId || !canOpenItem(c.var.user!, access, itemId, isVisibleItem(itemId))) return null
    return {
      access,
      itemId,
      title: item.title,
      ref: `${REF_PREFIX}${itemId}`,
      store: bundleStore(itemId),
      sync: bundleSyncStore(courseId, itemId),
    }
  },
  // アイテムがあるかだけで決めないのは、同期の鍵は半年使え、そのあいだにコースから外れたり、アイテムが非表示になったりするため
  async itemOf(ref, userId) {
    const itemId = Number(ref.slice(REF_PREFIX.length))
    const item = ref.startsWith(REF_PREFIX) && Number.isSafeInteger(itemId) && getBundleItem(itemId)
    const user = item && findUser(userId)
    const access = user && (await getCourseAccessFor(user, item.courseId))
    if (!access || !canOpenItem(user, access, itemId, isVisibleItem(itemId))) return null
    return { store: bundleStore(itemId), sync: bundleSyncStore(item.courseId, itemId) }
  },
  stampOf: credentialStampOf,
}
