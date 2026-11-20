import { collabStore, getCollabSettings } from '../../lib/collab-items'
import { openItem } from '../../lib/item-access'
import type { CollabBackend } from './handlers'

/** 通常モード: 設定とファイルを step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: CollabBackend = {
  async resolve(c) {
    const opened = await openItem(c, 'collab')
    if (!opened) return null
    const { access, itemId, item } = opened
    const settings = getCollabSettings(itemId)
    return settings && { access, item: { id: itemId, title: item.title }, settings, store: collabStore(item.courseId, itemId) }
  },
}
