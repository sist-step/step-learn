import { desc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { CourseCardData } from '../../components/ui'
import { canCreateCourse } from '../../lib/auth'
import { memberCount, trackedDoneCount, trackedItemCount } from '../../lib/courses'
import { db } from '../../lib/db'
import { courses, enrollments } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { DashboardPage } from './views'

export async function show(c: Context<AppEnv>) {
  const user = c.var.user!
  const results: CourseCardData[] = db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      summary: courses.summary,
      color: courses.color,
      iconImage: courses.iconImage,
      role: enrollments.role,
      total: trackedItemCount(courses.id),
      done: trackedDoneCount(user.id, courses.id),
      members: memberCount(),
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.userId, user.id))
    .orderBy(desc(enrollments.createdAt))
    .all()

  return c.render(<DashboardPage name={user.name} canCreate={canCreateCourse(user)} results={results} />, { title: 'ダッシュボード' })
}
