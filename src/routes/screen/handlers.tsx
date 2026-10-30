import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCourseAccess } from '../../lib/courses'
import { db } from '../../lib/db'
import { intParam } from '../../lib/http'
import { items } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { ScreenPage } from './views'

export async function show(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const item = db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(and(eq(items.id, iid), eq(items.courseId, id), eq(items.type, 'screen')))
    .get()
  if (!item) return c.notFound()

  return c.render(<ScreenPage access={access} item={item} />, { title: item.title })
}
