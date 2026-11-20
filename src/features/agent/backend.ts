import { AGENT_KIND } from './agent'
import { agentStore, findAgentToken, revokeAgentToken, touchAgentToken } from './agent-items'
import { findUser, itemIdOfRef, openItem, openItemFor, type OpenedItem } from '../../lib/item-access'
import type { AgentBackend } from './handlers'

const REF_PREFIX = 'agent-'

const refOf = (itemId: number) => `${REF_PREFIX}${itemId}`

const targetOf = ({ access, itemId, item }: OpenedItem) => ({
  courseId: item.courseId,
  course: access.course.title,
  title: item.title,
  description: item.body,
  store: agentStore(itemId),
})

/** 通常モード: 設定と使用量を step-learn.db に置き、権限をコースの参加者とアイテムのアクセス制限から確かめる */
export const backend: AgentBackend = {
  async resolve(c) {
    const opened = await openItem(c, AGENT_KIND)
    return opened && { ...targetOf(opened), itemId: opened.itemId, ref: refOf(opened.itemId) }
  },
  async targetOf(ref, userId) {
    const itemId = itemIdOfRef(REF_PREFIX, ref)
    const user = itemId && findUser(userId)
    const opened = user && (await openItemFor(user, AGENT_KIND, itemId))
    return opened ? targetOf(opened) : null
  },
  findUser,
  findToken(token) {
    const found = findAgentToken(token)
    return found && { id: found.id, ref: refOf(found.itemId), userId: found.userId }
  },
  touchToken: touchAgentToken,
  revokeToken: revokeAgentToken,
}
