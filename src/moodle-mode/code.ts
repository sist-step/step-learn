import type { Context } from 'hono'
import { intParam } from '../lib/http'
import type { CodeBackend } from '../routes/code/handlers'
import { storedToken, type MoodleEnv } from './auth'
import { isAccessDenied, isNotFound, isTokenError } from './client'
import { codePeriodOf, codeSettingsOf, codeStore, grader } from './code-store'
import { loadCourse, loadCourseAs, outlineOf, type LoadedCourse, type Viewer } from './data'
import { findExtra } from './extra'
import { CODE_KIND } from './extra-kinds'
import type { MItem } from './mapping'

const REF_PREFIX = 'code-m-'

/** コースを開いた人が開ける、条件に合うコードのアイテムと、その設定 */
function codeItemOf(loaded: LoadedCourse, match: (it: MItem) => boolean) {
  const item = outlineOf(loaded).find((it) => match(it) && !it.locked && it.extra?.type === CODE_KIND)
  const data = item?.extra?.data
  const settings = data && codeSettingsOf(data, item.title)
  if (!item?.extraKey || !data || !settings) return null
  return { cmid: item.id, key: item.extraKey, settings, period: codePeriodOf(data), store: codeStore(item.extraKey) }
}

/** viewer がコースを開けなければ null。Moodle に接続できないときなどは例外のまま投げる */
async function loadIfAllowed(viewer: Viewer, courseId: number) {
  try {
    return await loadCourseAs(viewer, courseId)
  } catch (e) {
    if (isNotFound(e) || isTokenError(e) || isAccessDenied(e)) return null
    throw e
  }
}

/** Moodle モード: 設定を extra_items に、書きかけのコードと提出を moodle-mode.db に置き、権限を Moodle のコースから確かめる */
export const codeBackend: CodeBackend = {
  grader,
  pageUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}/${CODE_KIND}`,
  itemUrl: (courseId, itemId) => `/courses/${courseId}/items/${itemId}`,
  async resolve(c) {
    const courseId = intParam(c, 'id')
    const itemId = intParam(c, 'iid')
    if (!courseId || !itemId) return null
    // このアプリのルートに組み込んで呼ばれるので、Context は Moodle モードのもの（トークンを持つ）
    const loaded = await loadCourse(c as Context<MoodleEnv>, courseId)
    const found = codeItemOf(loaded, (it) => it.id === itemId)
    if (!found) return null
    const { settings, period, store, key } = found
    return { settings, period, store, access: loaded.access, itemId, ref: `${REF_PREFIX}${key}` }
  },
  // 中身の行があるかだけで決めないのは、Moodle のごみ箱から戻せるよう、活動を消しても中身を残しているため。
  // Moodle の画面で消した・非表示にした活動や、コースから外れた学生も止められるよう、Moodle で今も開けるかで確かめる
  async targetOf(ref, userId) {
    const key = ref.slice(REF_PREFIX.length)
    const extra = ref.startsWith(REF_PREFIX) && key ? findExtra(key) : undefined
    const token = extra?.type === CODE_KIND ? storedToken(userId) : null
    const loaded = extra && token && (await loadIfAllowed({ token, userId }, extra.courseId))
    const found = loaded && codeItemOf(loaded, (it) => it.extraKey === key)
    if (!found) return null
    const { settings, period, store, cmid } = found
    const { access } = loaded
    return {
      settings,
      period,
      store,
      course: access.course.title,
      isStudent: access.role === 'student',
      courseId: access.course.id,
      itemId: cmid,
    }
  },
}
