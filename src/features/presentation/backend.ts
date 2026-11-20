import { getCourseAccessFor } from '../../lib/courses'
import { findUser, getItemOfType, itemIdOfRef, openItem } from '../../lib/item-access'
import { PRESENTATION_REF_PREFIX as REF_PREFIX, presentationStore } from './presentation-items'
import type { PresentationBackend } from './handlers'

/** 通常モード: PDF と公開の状態を step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: PresentationBackend = {
  keyPrefix: (courseId) => `courses/${courseId}/`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const opened = await openItem(c, 'presentation')
    if (!opened) return null
    const { access, itemId, item } = opened
    return { access, itemId, title: item.title, ref: `${REF_PREFIX}${itemId}`, store: presentationStore(itemId) }
  },
  async targetOf(ref, userId) {
    const itemId = itemIdOfRef(REF_PREFIX, ref)
    const item = itemId ? getItemOfType('presentation', itemId) : undefined
    const user = item && findUser(userId)
    const access = item && user ? await getCourseAccessFor(user, item.courseId) : null
    if (!item || !user || !itemId || !access?.canManage) return null
    return {
      courseId: item.courseId,
      course: access.course.title,
      title: item.title,
      user: { id: user.id, name: user.name },
      store: presentationStore(itemId),
    }
  },
}
