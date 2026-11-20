import { credentialStampOf } from '../../lib/auth'
import { bundleStore, bundleSyncStore } from '../../lib/bundle-items'
import { findUser, itemIdOfRef, openItem, openItemFor } from '../../lib/item-access'
import type { BundleBackend } from './handlers'

const REF_PREFIX = 'item-'

/** 通常モード: 配布するファイルを step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: BundleBackend = {
  keyPrefix: (courseId) => `courses/${courseId}/`,
  editUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/edit`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const opened = await openItem(c, 'bundle')
    if (!opened) return null
    const { access, itemId, item } = opened
    return {
      access,
      itemId,
      title: item.title,
      ref: `${REF_PREFIX}${itemId}`,
      store: bundleStore(itemId),
      sync: bundleSyncStore(item.courseId, itemId),
    }
  },
  // アイテムがあるかだけで決めないのは、同期の鍵は半年使え、そのあいだにコースから外れたり、アイテムが非表示になったりするため
  async itemOf(ref, userId) {
    const itemId = itemIdOfRef(REF_PREFIX, ref)
    const user = itemId && findUser(userId)
    const opened = user && (await openItemFor(user, 'bundle', itemId))
    return opened ? { store: bundleStore(opened.itemId), sync: bundleSyncStore(opened.item.courseId, opened.itemId) } : null
  },
  stampOf: credentialStampOf,
}
