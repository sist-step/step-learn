import { agentStore, findAgentToken, findAgentUser, getAgentItem, revokeAgentToken, touchAgentToken } from '../../lib/agent-items'
import { canOpenItem } from '../../lib/availability'
import { getCourseAccess, getCourseAccessFor, isVisibleItem, type CourseAccess } from '../../lib/courses'
import { intParam } from '../../lib/http'
import type { User } from '../../lib/types'
import type { AgentBackend, AgentTarget } from './handlers'

const REF_PREFIX = 'agent-'

const refOf = (itemId: number) => `${REF_PREFIX}${itemId}`

/** user がアイテムを開けるなら、そのアイテム。access を渡さなければ、ここでコースの権限を確かめる */
async function openableItem(
  user: User,
  itemId: number,
  access?: CourseAccess | null,
): Promise<(AgentTarget & { courseId: number }) | null> {
  const item = getAgentItem(itemId)
  if (!item) return null
  const granted = access ?? (await getCourseAccessFor(user, item.courseId))
  if (!granted || granted.course.id !== item.courseId || !canOpenItem(user, granted, itemId, isVisibleItem(itemId))) return null
  return { courseId: item.courseId, course: granted.course.title, title: item.title, instructions: item.body, store: agentStore(itemId) }
}

/** 通常モード: 設定と使用量を step-learn.db に置き、権限をコースの参加者とアイテムのアクセス制限から確かめる */
export const backend: AgentBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    const item = access && (await openableItem(c.var.user!, itemId, access))
    return item ? { ...item, itemId, ref: refOf(itemId) } : null
  },
  async targetOf(ref, userId) {
    const itemId = Number(ref.slice(REF_PREFIX.length))
    const user = ref.startsWith(REF_PREFIX) && Number.isSafeInteger(itemId) && findAgentUser(userId)
    return user ? openableItem(user, itemId) : null
  },
  findUser: findAgentUser,
  findToken(token) {
    const found = findAgentToken(token)
    return found && { id: found.id, ref: refOf(found.itemId), userId: found.userId }
  },
  touchToken: touchAgentToken,
  revokeToken: revokeAgentToken,
}
