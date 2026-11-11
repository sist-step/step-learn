import { bundleStore, getBundleItem } from '../../lib/bundle-items'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { intParam } from '../../lib/http'
import type { BundleBackend } from './handlers'

const REF_PREFIX = 'item-'

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
    if (!item || item.courseId !== courseId || (!access.canManage && !isVisibleItem(itemId))) return null
    return { access, itemId, title: item.title, ref: `${REF_PREFIX}${itemId}`, store: bundleStore(itemId) }
  },
  storeOf(ref) {
    const itemId = Number(ref.slice(REF_PREFIX.length))
    return ref.startsWith(REF_PREFIX) && Number.isSafeInteger(itemId) && getBundleItem(itemId) ? bundleStore(itemId) : null
  },
}
