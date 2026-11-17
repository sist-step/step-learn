import { and, eq } from 'drizzle-orm'
import { canOpenItem } from '../../lib/availability'
import { COLLAB_KIND } from '../../lib/collab'
import { collabStore, getCollabSettings } from '../../lib/collab-items'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { items } from '../../lib/schema'
import type { CollabBackend } from './handlers'

/** 通常モード: 設定とファイルを step-learn.db に置き、権限をコースの参加者から確かめる */
export const backend: CollabBackend = {
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    const access = courseId && itemId && (await getCourseAccess(c, courseId))
    if (!access) return null
    const item = db
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, COLLAB_KIND)))
      .get()
    if (!item || !canOpenItem(c.var.user!, access, itemId, isVisibleItem(itemId))) return null
    const settings = getCollabSettings(itemId)
    return settings && { access, item, settings, store: collabStore(courseId, itemId) }
  },
}
