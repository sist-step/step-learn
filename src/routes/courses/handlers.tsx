import { and, desc, eq, isNotNull, or } from 'drizzle-orm'
import type { Context } from 'hono'
import type { CourseFormErrors, CourseFormValues } from '../../components/course'
import type { CourseCardData } from '../../components/ui'
import { canCreateCourse } from '../../lib/auth'
import {
  courseImagePrefix,
  courseRevision,
  getCourseAccess,
  memberCount,
  teacherNames,
  visibleItem,
  type CourseImageKind,
} from '../../lib/courses'
import { contains, db } from '../../lib/db'
import { field, fileField, intParam, readForm, redirectWith, type Form } from '../../lib/http'
import { imageName, putImage, serveImage } from '../../lib/images'
import { completions, courses, enrollments, items, sections } from '../../lib/schema'
import { isSharing } from '../../lib/screen-share'
import { deleteCourseFiles, deleteKeys, inBackground } from '../../lib/storage'
import { COURSE_COLORS, type AppEnv, type Course } from '../../lib/types'
import { CoursePage, CoursesPage, SettingsPage, type ItemLite } from './views'

function parseCourseForm(form: Form) {
  const color = field(form, 'color')
  const values = {
    title: field(form, 'title', 120),
    code: field(form, 'code', 30),
    summary: field(form, 'summary', 2000),
    color: (COURSE_COLORS as readonly string[]).includes(color) ? color : 'cyan',
  } satisfies CourseFormValues
  const errors: CourseFormErrors = {}
  if (!values.title) errors.title = 'コース名を入力してください。'
  return { values, errors, ok: Object.keys(errors).length === 0 }
}

export async function list(c: Context<AppEnv>) {
  const user = c.var.user!
  const isAdmin = user.role === 'admin'
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const results: CourseCardData[] = db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      summary: courses.summary,
      color: courses.color,
      heroImage: courses.heroImage,
      iconImage: courses.iconImage,
      role: enrollments.role,
      members: memberCount(),
      teachers: teacherNames(),
    })
    .from(courses)
    .leftJoin(enrollments, and(eq(enrollments.courseId, courses.id), eq(enrollments.userId, user.id)))
    .where(
      and(
        isAdmin ? undefined : isNotNull(enrollments.role),
        q ? or(contains(courses.title, q), contains(courses.code, q), contains(courses.summary, q)) : undefined,
      ),
    )
    .orderBy(desc(courses.createdAt))
    .all()

  return c.render(<CoursesPage q={q} isAdmin={isAdmin} canCreate={canCreateCourse(user)} results={results} />, { title: 'コース一覧' })
}

export async function create(c: Context<AppEnv>) {
  const user = c.var.user!
  if (!canCreateCourse(user)) return c.notFound()
  const { values, errors, ok } = parseCourseForm(await readForm(c))
  // 入力欄の横にエラーを出さないのは、作成フォームが一覧画面のモーダルにあって描き直せないため
  if (!ok) return redirectWith(c, '/courses', Object.values(errors)[0], 'error')

  const course = db.transaction((tx) => {
    const created = tx
      .insert(courses)
      .values({ ...values, createdBy: user.id })
      .returning({ id: courses.id })
      .get()
    tx.insert(sections).values({ courseId: created.id, title: 'はじめに', position: 1 }).run()
    return created
  })
  return redirectWith(c, `/courses/${course.id}`, 'コースを作成しました。参加者タブから教師と学生を追加しましょう。')
}

export async function show(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const user = c.var.user!
  // 読み出しの後で取らないのは、その間に変わったときに古い内容へ新しい版を付けてしまい、変更を取りこぼすため
  const revision = courseRevision(id)

  const manage = access.canManage
  const sectionList = db
    .select()
    .from(sections)
    .where(and(eq(sections.courseId, id), manage ? undefined : eq(sections.hidden, 0)))
    .orderBy(sections.position, sections.id)
    .all()
  const itemList: ItemLite[] = db
    .select({
      id: items.id,
      sectionId: items.sectionId,
      type: items.type,
      title: items.title,
      url: items.url,
      fileName: items.fileName,
      fileSize: items.fileSize,
      hidden: items.hidden,
    })
    .from(items)
    .where(and(eq(items.courseId, id), manage ? undefined : visibleItem()))
    .orderBy(items.position, items.id)
    .all()
  const doneRows = db
    .select({ itemId: completions.itemId })
    .from(completions)
    .where(and(eq(completions.userId, user.id), eq(completions.courseId, id)))
    .all()
  const done = new Set(doneRows.map((r) => r.itemId))
  const sharing = new Set(itemList.filter((it) => it.type === 'screen' && isSharing(it.id)).map((it) => it.id))

  return c.render(
    <CoursePage access={access} sectionList={sectionList} itemList={itemList} done={done} sharing={sharing} revision={revision} />,
    {
      title: access.course.title,
    },
  )
}

export async function leave(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.role) return c.notFound()
  const userId = c.var.user!.id

  if (access.role === 'teacher') {
    const teachers = await db.$count(enrollments, and(eq(enrollments.courseId, id), eq(enrollments.role, 'teacher')))
    if (teachers <= 1) return redirectWith(c, `/courses/${id}/settings`, '最後の教師はコースから退出できません。', 'error')
  }
  db.transaction((tx) => {
    tx.delete(enrollments)
      .where(and(eq(enrollments.courseId, id), eq(enrollments.userId, userId)))
      .run()
    tx.delete(completions)
      .where(and(eq(completions.courseId, id), eq(completions.userId, userId)))
      .run()
  })
  return redirectWith(c, '/dashboard', `「${access.course.title}」から退出しました。`, 'info')
}

export async function settings(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  return c.render(<SettingsPage access={access} values={access.course} />, {
    title: `設定 - ${access.course.title}`,
  })
}

export async function updateSettings(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  const { values, errors, ok } = parseCourseForm(await readForm(c))
  if (!ok) {
    c.status(422)
    return c.render(<SettingsPage access={access} values={values} errors={errors} />, { title: `設定 - ${access.course.title}` })
  }
  db.update(courses).set(values).where(eq(courses.id, id)).run()
  return redirectWith(c, `/courses/${id}/settings`, '設定を保存しました。')
}

const COURSE_IMAGE_LABELS: Record<CourseImageKind, string> = { hero: 'ヒーロー画像', icon: 'コースアイコン' }

const imageKind = (c: Context<AppEnv>): CourseImageKind | null => {
  const kind = c.req.param('kind')
  return kind === 'hero' || kind === 'icon' ? kind : null
}

const currentImage = (course: Course, kind: CourseImageKind) => (kind === 'hero' ? course.heroImage : course.iconImage)

const imageColumn = (kind: CourseImageKind, key: string | null) => (kind === 'hero' ? { heroImage: key } : { iconImage: key })

export async function courseImage(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const kind = imageKind(c)
  const access = id && kind && (await getCourseAccess(c, id))
  const key = kind && access && currentImage(access.course, kind)
  // 古い名前を受け付けないのは、差し替え前の URL をキャッシュしたブラウザに新しい画像を古い URL で返さないため
  if (!key || imageName(key) !== c.req.param('name')) return c.notFound()
  return (await serveImage(key)) ?? c.notFound()
}

export async function updateCourseImage(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const kind = imageKind(c)
  const access = id && kind && (await getCourseAccess(c, id))
  if (!kind || !access || !access.canManage) return c.notFound()
  const back = `/courses/${id}/settings`
  const file = fileField(await readForm(c), 'image')
  if (!file) return redirectWith(c, back, '画像を選択してください。', 'error')
  const result = await putImage(courseImagePrefix(id, kind), file)
  if ('error' in result) return redirectWith(c, back, result.error, 'error')
  db.update(courses).set(imageColumn(kind, result.key)).where(eq(courses.id, id)).run()
  inBackground(deleteKeys([currentImage(access.course, kind)]))
  return redirectWith(c, back, `${COURSE_IMAGE_LABELS[kind]}を設定しました。`)
}

export async function removeCourseImage(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const kind = imageKind(c)
  const access = id && kind && (await getCourseAccess(c, id))
  if (!kind || !access || !access.canManage) return c.notFound()
  db.update(courses).set(imageColumn(kind, null)).where(eq(courses.id, id)).run()
  inBackground(deleteKeys([currentImage(access.course, kind)]))
  return redirectWith(c, `/courses/${id}/settings`, `${COURSE_IMAGE_LABELS[kind]}を削除しました。`, 'info')
}

export async function remove(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  db.delete(courses).where(eq(courses.id, id)).run()
  inBackground(deleteCourseFiles(id))
  return redirectWith(c, '/dashboard', `「${access.course.title}」を削除しました。`, 'info')
}

export async function revision(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  return c.json({ revision: courseRevision(id) })
}
