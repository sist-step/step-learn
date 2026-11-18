import { findAgentUser } from '../../lib/agent-items'
import { canOpenItem } from '../../lib/availability'
import { getCourseAccess, getCourseAccessFor, isVisibleItem } from '../../lib/courses'
import { intParam } from '../../lib/http'
import { getPresentationItem, presentationStore } from '../../lib/presentation-items'
import type { PresentationBackend } from './handlers'

const REF_PREFIX = 'presentation-'

/** 通常モード: PDF と公開の状態を step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: PresentationBackend = {
  keyPrefix: (courseId) => `courses/${courseId}/`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    if (!access) return null
    const item = getPresentationItem(itemId)
    if (!item || item.courseId !== courseId || !canOpenItem(c.var.user!, access, itemId, isVisibleItem(itemId))) return null
    return { access, itemId, title: item.title, ref: `${REF_PREFIX}${itemId}`, store: presentationStore(itemId) }
  },
  async targetOf(ref, userId) {
    const itemId = Number(ref.slice(REF_PREFIX.length))
    const item = ref.startsWith(REF_PREFIX) && Number.isSafeInteger(itemId) ? getPresentationItem(itemId) : undefined
    const user = item && findAgentUser(userId)
    const access = item && user ? await getCourseAccessFor(user, item.courseId) : null
    if (!item || !user || !access?.canManage) return null
    return {
      courseId: item.courseId,
      course: access.course.title,
      title: item.title,
      user: { id: user.id, name: user.name },
      store: presentationStore(itemId),
    }
  },
}
