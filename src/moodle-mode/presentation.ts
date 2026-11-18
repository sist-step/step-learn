import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { intParam } from '../lib/http'
import { PRESENTATION_KIND } from '../lib/presentation'
import type { PresentationBackend } from '../routes/presentation/handlers'
import { storedToken, type MoodleEnv } from './auth'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { loadCourse, loadCourseAs, outlineOf, type LoadedCourse, type Viewer } from './data'
import { db } from './db'
import { findExtra } from './extra'
import type { MItem } from './mapping'
import { presentationStore } from './presentation-store'
import { users } from './schema'

const REF_PREFIX = 'presentation-m-'

/** コースを開いた人が開ける、発表ファイルのアイテム */
const presentationItemOf = (loaded: LoadedCourse, match: (it: MItem) => boolean) =>
  outlineOf(loaded).find((it) => match(it) && !it.locked && it.extra?.type === PRESENTATION_KIND && !!it.extraKey)

/** viewer がコースを開けなければ null。Moodle に接続できないときなどは例外のまま投げる */
async function loadIfAllowed(viewer: Viewer, courseId: number) {
  try {
    return await loadCourseAs(viewer, courseId)
  } catch (e) {
    if (isNotFound(e) || isTokenError(e) || isAccessDenied(e)) return null
    throw e
  }
}

/** Moodle モード: PDF と公開の状態を moodle-mode.db に置き、開けるか・編集できるかを Moodle のコースから確かめる */
export const presentationBackend: PresentationBackend = {
  // 通常モードと同じ courses/ に置かないのは、Moodle のコース ID と STEP Learn のコース ID がぶつかり、通常モードでコースを消したときに一緒に消えてしまうため
  keyPrefix: (courseId) => `moodle-mode/courses/${courseId}/`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  // 学生の画面が数秒おきに呼ぶが、Moodle には毎回聞かない（loadCourse が 30 秒キャッシュする）
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const item = presentationItemOf(loaded, (it) => it.id === itemId)
    if (!item?.extraKey) return null
    return {
      access: loaded.access,
      itemId,
      title: item.title,
      ref: `${REF_PREFIX}${item.extraKey}`,
      store: presentationStore(item.extraKey),
    }
  },
  // 中身の行があるかだけで決めないのは、Moodle のごみ箱から戻せるよう、活動を消しても中身を残しているため。
  // Moodle の画面で消した活動や、教師から外れた人も止められるよう、Moodle で今も編集できるかで確かめる
  async targetOf(ref, userId) {
    const key = ref.slice(REF_PREFIX.length)
    const found = ref.startsWith(REF_PREFIX) && key ? findExtra(key) : undefined
    const token = found?.type === PRESENTATION_KIND ? storedToken(userId) : null
    const loaded = found && token ? await loadIfAllowed({ token, userId }, found.courseId) : null
    const item = loaded && presentationItemOf(loaded, (it) => it.extraKey === key)
    const user = db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get()
    if (!found || !loaded || !item || !user || !loaded.access.canManage) return null
    return { courseId: found.courseId, course: loaded.access.course.title, title: item.title, user, store: presentationStore(key) }
  },
}
