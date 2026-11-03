import { and, desc, eq, ne, notInArray } from 'drizzle-orm'
import type { Context } from 'hono'
import type { CourseCardData } from '../../components/ui'
import { canCreateCourse } from '../../lib/auth'
import { memberCount, trackedDoneCount, trackedItemCount, visibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { completions, courses, enrollments, items, sections } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { DashboardPage, featuredCourse } from './views'

function nextItemOf(userId: number, course: CourseCardData) {
  const tracked = (course.total ?? 0) > 0
  return db
    .select({ id: items.id, title: items.title })
    .from(items)
    .innerJoin(sections, eq(sections.id, items.sectionId))
    .where(
      and(
        eq(items.courseId, course.id),
        visibleItem(),
        tracked ? ne(items.completion, 'none') : undefined,
        tracked
          ? notInArray(
              items.id,
              db
                .select({ id: completions.itemId })
                .from(completions)
                .where(and(eq(completions.userId, userId), eq(completions.courseId, course.id))),
            )
          : undefined,
      ),
    )
    .orderBy(sections.position, sections.id, items.position, items.id)
    .limit(1)
    .get()
}

export async function show(c: Context<AppEnv>) {
  const user = c.var.user!
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
      total: trackedItemCount(courses.id),
      done: trackedDoneCount(user.id, courses.id),
      members: memberCount(),
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.userId, user.id))
    .orderBy(desc(enrollments.createdAt))
    .all()
  const featured = featuredCourse(results)

  return c.render(
    <DashboardPage
      name={user.name}
      canCreate={canCreateCourse(user)}
      isAdmin={user.role === 'admin'}
      results={results}
      nextItem={featured && nextItemOf(user.id, featured)}
    />,
    {
      title: 'ダッシュボード',
    },
  )
}
