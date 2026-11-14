import { count, desc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { canCreateCourse } from '../../lib/auth'
import { isInPeriod } from '../../lib/course-period'
import { memberCount, trackedDoneCount, trackedItemCount } from '../../lib/courses'
import { db } from '../../lib/db'
import { courses, enrollments, users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { DashboardPage, type DashboardCourse } from './views'

const countOf = (table: typeof users | typeof courses) => db.select({ n: count() }).from(table).get()?.n ?? 0

export async function show(c: Context<AppEnv>) {
  const user = c.var.user!
  const results: DashboardCourse[] = db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      summary: courses.summary,
      color: courses.color,
      heroImage: courses.heroImage,
      iconImage: courses.iconImage,
      role: enrollments.role,
      total: trackedItemCount(courses.id),
      done: trackedDoneCount(user.id, courses.id),
      members: memberCount(),
      startAt: courses.startAt,
      endAt: courses.endAt,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.userId, user.id))
    .orderBy(desc(enrollments.createdAt))
    .all()
    .map(({ startAt, ...course }) => ({ ...course, inProgress: isInPeriod({ startAt, endAt: course.endAt }) }))
    .filter((course) => course.inProgress)
  const isAdmin = user.role === 'admin'
  return c.render(
    <DashboardPage
      name={user.name}
      canCreate={canCreateCourse(user)}
      isAdmin={isAdmin}
      results={results}
      adminCounts={isAdmin ? { users: countOf(users), courses: countOf(courses) } : undefined}
    />,
    { title: 'ダッシュボード' },
  )
}
