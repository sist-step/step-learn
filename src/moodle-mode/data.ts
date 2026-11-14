import type { Context } from 'hono'
import type { MoodleEnv } from './auth'
import { cached, contentsKey, courseKey, coursesKey, otherCoursesKey, restrictionsKey } from './cache'
import { api, isTokenError, type MoodleFormat, type MoodleRestrictionOptions } from './client'
import { removeRetired, withExtras } from './extra'
import { isOpenable, isTracked, toAccess, toLayout, toOutline, withRestrictions } from './mapping'

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

const NO_OPTIONS: MoodleRestrictionOptions = { plugins: [], grades: [], profilefields: [], groups: [], groupings: [] }
const NO_RESTRICTIONS = { enabled: false, restrictions: [], options: NO_OPTIONS }

/** Moodle に問い合わせる利用者。Hono を通らない要求（画面共有の接続）でも使えるよう、Context から分けている */
export type Viewer = { token: string; userId: number }

const viewerOf = (c: Context<MoodleEnv>): Viewer => ({ token: c.var.token!, userId: c.var.user!.id })

async function restrictionsOf(viewer: Viewer, courseId: number, fresh: boolean) {
  const load = () => api(viewer.token).restrictions(courseId)
  try {
    return await (fresh ? load() : cached(restrictionsKey(courseId, viewer.userId), load))
  } catch (e) {
    // コースページごと失敗させないのは、プラグインを更新する前の Moodle にはこの API がなく、制限を出さなくても教材は編集できるため
    if (isTokenError(e)) throw e
    console.error('[moodle] restrictions', e)
    return NO_RESTRICTIONS
  }
}

/** コースとその教材。アクセスできなければ Moodle の notfound で例外になる（app.tsx の onError が 404 にする） */
export const loadCourse = (c: Context<MoodleEnv>, courseId: number, options?: { fresh?: boolean }) =>
  loadCourseAs(viewerOf(c), courseId, options)

export async function loadCourseAs({ token, userId }: Viewer, courseId: number, { fresh = false } = {}) {
  const moodle = api(token)
  const load = () => Promise.all([moodle.course(courseId), moodle.contents(courseId)])
  const [course, contents] = fresh
    ? await load()
    : await Promise.all([
        cached(courseKey(courseId, userId), () => moodle.course(courseId)),
        cached(contentsKey(courseId, userId), () => moodle.contents(courseId)),
      ])
  const access = toAccess(course)
  const outline = toOutline(contents, { tracking: course.completionenabled, manage: course.canmanage })
  // 学生に問い合わせないのは、制限の中身は編集できる人にしか返さず、学生には Moodle が開けない理由だけを返すため
  const restrictions = course.canmanage ? await restrictionsOf({ token, userId }, courseId, fresh) : NO_RESTRICTIONS
  const { retired, ...shown } = withExtras(courseId, withRestrictions(outline, restrictions.restrictions))
  // 学生が開いたときに消さないのは、Moodle の活動を消せるのが教師だけなため。学生には一覧から外すだけにする
  if (retired.length && course.canmanage) await removeRetired(moodle, courseId, retired)
  return {
    course,
    access,
    layout: toLayout(course.format),
    restrictable: restrictions.enabled,
    // 既定値を用意するのは、プラグインを更新する前の Moodle が options を返さないため
    restrictionOptions: restrictions.options ?? NO_OPTIONS,
    ...shown,
  }
}

export type LoadedCourse = Awaited<ReturnType<typeof loadCourseAs>>

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
