import type { Context } from 'hono'
import type { MoodleEnv } from './auth'
import { cached, contentsKey, courseKey, coursesKey, otherCoursesKey } from './cache'
import { api, isTokenError, type MoodleFormat } from './client'
import { isOpenable, isTracked, toAccess, toLayout, toOutline } from './mapping'

export const moodle = (c: Context<MoodleEnv>) => api(c.var.token!)

export const myCourses = (c: Context<MoodleEnv>) => cached(coursesKey(c.var.user!.id), () => moodle(c).myCourses())

export async function otherCourses(c: Context<MoodleEnv>) {
  try {
    return await cached(otherCoursesKey(c.var.user!.id), () => moodle(c).otherCourses())
  } catch (e) {
    // 一覧ごと失敗させないのは、プラグインを更新する前の Moodle にはこの API がなく、参加しているコースだけでも出せるため
    if (isTokenError(e)) throw e
    console.error('[moodle] other courses', e)
    return []
  }
}

/** コースとその教材。アクセスできなければ Moodle の notfound で例外になる（app.tsx の onError が 404 にする） */
export async function loadCourse(c: Context<MoodleEnv>, courseId: number, { fresh = false } = {}) {
  const userId = c.var.user!.id
  const load = () => Promise.all([moodle(c).course(courseId), moodle(c).contents(courseId)])
  const [course, contents] = fresh
    ? await load()
    : await Promise.all([
        cached(courseKey(courseId, userId), () => moodle(c).course(courseId)),
        cached(contentsKey(courseId, userId), () => moodle(c).contents(courseId)),
      ])
  const access = toAccess(course)
  const outline = toOutline(contents, { tracking: course.completionenabled, manage: course.canmanage })
  return { course, access, layout: toLayout(course.format), ...outline }
}

export type LoadedCourse = Awaited<ReturnType<typeof loadCourse>>

/** 学生に見える、完了の対象のアイテム（進捗の分母） */
export function progressOf({ sections, items }: Pick<LoadedCourse, 'sections' | 'items'>) {
  const shown = new Set(sections.filter((s) => !s.hidden).map((s) => s.id))
  const tracked = items.filter((it) => shown.has(it.sectionId) && !it.hidden && isTracked(it))
  return { total: tracked.length, done: tracked.filter((it) => it.done).length }
}

/** 前後のナビと目次に並べるアイテム */
export function outlineOf({ access, sections, items }: Pick<LoadedCourse, 'access' | 'sections' | 'items'>) {
  const hidden = new Set(sections.filter((s) => s.hidden).map((s) => s.id))
  return items.filter((it) => isOpenable(it) && (access.canManage || (!it.hidden && !hidden.has(it.sectionId))))
}

const enc = new TextEncoder()

const withoutToggles = (format: MoodleFormat | undefined) =>
  format?.topcoll ? { ...format, topcoll: { ...format.topcoll, collapsed: [] } } : format

// 完了やセクションの開閉の状態を含めないのは、学生が自分で切り替えるたびに、開いている画面を取り直させないため
export async function revisionOf({ course, sections, items }: Pick<LoadedCourse, 'course' | 'sections' | 'items'>) {
  const shape = JSON.stringify({
    course: { ...course, done: 0, format: withoutToggles(course.format) },
    sections,
    items: items.map(({ done, ...rest }) => rest),
  })
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(shape))
  return Buffer.from(digest).toString('base64url').slice(0, 16)
}
