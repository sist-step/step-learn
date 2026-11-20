import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { canOpenItem } from './availability'
import { getCourseAccess, getCourseAccessFor, isVisibleItem, type CourseAccess } from './courses'
import { db } from './db'
import { intParam } from './http'
import { items, users } from './schema'
import type { AppEnv, Completion, ItemType, User } from './types'

type TypedItem = { id: number; courseId: number; title: string; body: string; completion: Completion }

/** 種類が type のアイテム。ほかの種類なら undefined */
export const getItemOfType = (type: ItemType, itemId: number): TypedItem | undefined =>
  db
    .select({ id: items.id, courseId: items.courseId, title: items.title, body: items.body, completion: items.completion })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.type, type)))
    .get()

/** セッションのない要求（拡張機能・MCP）の持ち主 */
export const findUser = (userId: number): User | undefined =>
  db
    .select({ id: users.id, email: users.email, name: users.name, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()

/** 拡張機能に渡した参照（`item-12` など）のアイテムの ID。形が違えば null */
export function itemIdOfRef(prefix: string, ref: string): number | null {
  if (!ref.startsWith(prefix)) return null
  const itemId = Number(ref.slice(prefix.length))
  return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null
}

export type OpenedItem = { access: CourseAccess; itemId: number; item: TypedItem }

/** user が、種類が type のアイテムを開けるなら、コースの権限とアイテム。access を渡さなければ、ここでコースの権限を確かめる */
export async function openItemFor(user: User, type: ItemType, itemId: number, access?: CourseAccess | null): Promise<OpenedItem | null> {
  const item = getItemOfType(type, itemId)
  if (!item) return null
  const granted = access ?? (await getCourseAccessFor(user, item.courseId))
  if (!granted || granted.course.id !== item.courseId || !canOpenItem(user, granted, itemId, isVisibleItem(itemId))) return null
  return { access: granted, itemId, item }
}

/** URL の :id と :iid のアイテムを、ログイン中の利用者が開けるなら、コースの権限とアイテム */
export async function openItem(c: Context<AppEnv>, type: ItemType): Promise<OpenedItem | null> {
  const courseId = intParam(c, 'id')
  const itemId = intParam(c, 'iid')
  const access = courseId && itemId && (await getCourseAccess(c, courseId))
  return access ? openItemFor(c.var.user!, type, itemId, access) : null
}
