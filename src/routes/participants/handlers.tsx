import { and, eq, isNotNull, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { RequestContext } from 'hono/jsx-renderer'
import { getCourseAccess } from '../../lib/courses'
import { contains, db } from '../../lib/db'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { completions, enrollments, items, users } from '../../lib/schema'
import { COURSE_ROLE_LABELS, type AppEnv, type CourseRole } from '../../lib/types'
import { CANDIDATE_LIMIT, Candidates, ParticipantsPage, type Candidate, type Participant } from './views'

const isCourseRole = (r: string): r is CourseRole => r === 'teacher' || r === 'student'

async function manageAccess(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  return access && access.canManage ? access : null
}

/** 最後の教師を外す・学生に変える操作を防ぐ */
async function isLastTeacher(courseId: number, userId: number) {
  const target = db
    .select({ role: enrollments.role })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId)))
    .get()
  if (target?.role !== 'teacher') return false
  return (await db.$count(enrollments, and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'teacher')))) <= 1
}

export async function list(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()

  const people: Participant[] = db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      role: enrollments.role,
      createdAt: enrollments.createdAt,
      done: db.$count(completions, and(eq(completions.userId, users.id), eq(completions.courseId, enrollments.courseId))),
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(enrollments.courseId, id))
    .orderBy(users.name)
    .all()
  const totalItems = await db.$count(items, eq(items.courseId, id))

  return c.render(<ParticipantsPage access={access} people={people} meId={c.var.user!.id} totalItems={totalItems} />, {
    title: `参加者 - ${access.course.title}`,
  })
}

export async function candidates(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const found: Candidate[] = q
    ? db
        .select({ id: users.id, name: users.name, username: users.username, email: users.email, role: enrollments.role })
        .from(users)
        .leftJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.courseId, access.course.id)))
        .where(or(contains(users.name, q), contains(users.username, q), contains(users.email, q)))
        .orderBy(isNotNull(enrollments.role), users.name)
        .limit(CANDIDATE_LIMIT + 1)
        .all()
    : []
  // c.render で返さないのは、モーダルの中身だけを差し替えるのにページ全体のレイアウトは要らないため
  return c.html(
    <RequestContext.Provider value={c}>
      <Candidates q={q} users={found} />
    </RequestContext.Provider>,
  )
}

export async function add(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const id = access.course.id
  const back = `/courses/${id}/participants`
  const form = await readForm(c)
  const userId = Number(field(form, 'user_id', 20))
  const role = field(form, 'role')
  if (!isCourseRole(role)) return c.notFound()

  const user =
    Number.isSafeInteger(userId) && userId > 0
      ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get()
      : undefined
  if (!user) return redirectWith(c, back, 'ユーザーが見つかりませんでした。', 'error')

  const res = db.insert(enrollments).values({ courseId: id, userId: user.id, role }).onConflictDoNothing().run()
  if (!res.changes) return redirectWith(c, back, `${user.name} さんはすでに参加しています。`, 'info')
  return redirectWith(c, back, `${user.name} さんを${COURSE_ROLE_LABELS[role]}として追加しました。`)
}

export async function changeRole(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const uid = intParam(c, 'uid')
  if (!access || !uid) return c.notFound()
  const id = access.course.id
  const back = `/courses/${id}/participants`
  const role = field(await readForm(c), 'role')
  if (!isCourseRole(role)) return c.notFound()
  if (role === 'student' && (await isLastTeacher(id, uid))) {
    return redirectWith(c, back, 'コースには少なくとも1人の教師が必要です。', 'error')
  }
  db.update(enrollments)
    .set({ role })
    .where(and(eq(enrollments.courseId, id), eq(enrollments.userId, uid)))
    .run()
  return redirectWith(c, back, 'ロールを変更しました。')
}

export async function remove(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const uid = intParam(c, 'uid')
  if (!access || !uid) return c.notFound()
  const id = access.course.id
  const back = `/courses/${id}/participants`
  if (await isLastTeacher(id, uid)) return redirectWith(c, back, 'コースには少なくとも1人の教師が必要です。', 'error')
  db.transaction((tx) => {
    tx.delete(enrollments).where(and(eq(enrollments.courseId, id), eq(enrollments.userId, uid))).run()
    tx.delete(completions).where(and(eq(completions.courseId, id), eq(completions.userId, uid))).run()
  })
  return redirectWith(c, back, 'コースから外しました。', 'info')
}
