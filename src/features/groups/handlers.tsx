import { and, eq, ne } from 'drizzle-orm'
import type { Context } from 'hono'
import { manageAccess, type CourseAccess } from '../../lib/courses'
import { db } from '../../lib/db'
import { validate, type FieldErrors } from '../../lib/forms'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { courseGroups, enrollments, users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { MAX_GROUPS_PER_COURSE, findGroup, groupsOf, memberIdsOf, setGroupMembers } from './group-items'
import { GroupPage, GroupsPage, type GroupCandidate } from './views'

const NAME_TAKEN = 'このコースには同じ名前のグループがあります。'

const nameTaken = (courseId: number, name: string, except?: number) =>
  !!db
    .select({ id: courseGroups.id })
    .from(courseGroups)
    .where(and(eq(courseGroups.courseId, courseId), eq(courseGroups.name, name), except ? ne(courseGroups.id, except) : undefined))
    .get()

const renderGroups = (c: Context<AppEnv>, access: CourseAccess, name?: string, errors?: FieldErrors) =>
  c.render(<GroupsPage access={access} groups={groupsOf(access.course.id)} name={name} errors={errors} />, {
    title: `グループ - ${access.course.title}`,
  })

export async function list(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  return renderGroups(c, access)
}

export async function create(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const courseId = access.course.id
  const form = await readForm(c)
  const result = validate('courseGroup', form)
  const invalid = (errors: FieldErrors) => {
    c.status(422)
    return renderGroups(c, access, field(form, 'name', 100), errors)
  }
  if (!result.ok) return invalid(result.errors)
  const { name } = result.values
  if ((await db.$count(courseGroups, eq(courseGroups.courseId, courseId))) >= MAX_GROUPS_PER_COURSE)
    return invalid({ name: `グループは 1 つのコースに${MAX_GROUPS_PER_COURSE}個までです。` })
  // 事前の確認だけに頼らないのは、確認と INSERT の間に同じ名前で作られると UNIQUE 制約違反になるため
  const created = db.insert(courseGroups).values({ courseId, name }).onConflictDoNothing().returning({ id: courseGroups.id }).get()
  if (!created) return invalid({ name: NAME_TAKEN })
  return redirectWith(c, `/courses/${courseId}/groups/${created.id}`, `「${name}」を作成しました。メンバーを選んでください。`)
}

const candidatesOf = (courseId: number): GroupCandidate[] =>
  db
    .select({ id: users.id, name: users.name, username: users.username, role: enrollments.role })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(eq(enrollments.courseId, courseId))
    .orderBy(users.name)
    .all()

async function groupAccess(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const gid = intParam(c, 'gid')
  const group = access && gid ? findGroup(access.course.id, gid) : undefined
  return access && group ? { access, group } : null
}

export async function show(c: Context<AppEnv>) {
  const found = await groupAccess(c)
  if (!found) return c.notFound()
  const { access, group } = found
  return c.render(
    <GroupPage access={access} group={group} people={candidatesOf(access.course.id)} members={memberIdsOf(group.id)} name={group.name} />,
    { title: `${group.name} - ${access.course.title}` },
  )
}

export async function update(c: Context<AppEnv>) {
  const found = await groupAccess(c)
  if (!found) return c.notFound()
  const { access, group } = found
  const courseId = access.course.id
  const form = await readForm(c, { all: true })
  const result = validate('courseGroupEdit', form)
  const invalid = (errors: FieldErrors, members: Set<number>) => {
    c.status(422)
    return c.render(
      <GroupPage
        access={access}
        group={group}
        people={candidatesOf(courseId)}
        members={members}
        name={field(form, 'name', 100)}
        errors={errors}
      />,
      { title: `${group.name} - ${access.course.title}` },
    )
  }
  if (!result.ok) return invalid(result.errors, memberIdsOf(group.id))
  const { name, members } = result.values
  if (nameTaken(courseId, name, group.id)) return invalid({ name: NAME_TAKEN }, new Set(members))

  db.update(courseGroups).set({ name }).where(eq(courseGroups.id, group.id)).run()
  setGroupMembers(courseId, group.id, members)
  return redirectWith(c, `/courses/${courseId}/groups`, `「${name}」を保存しました。`)
}

export async function remove(c: Context<AppEnv>) {
  const found = await groupAccess(c)
  if (!found) return c.notFound()
  const { access, group } = found
  db.delete(courseGroups).where(eq(courseGroups.id, group.id)).run()
  return redirectWith(c, `/courses/${access.course.id}/groups`, `「${group.name}」を削除しました。`, 'info')
}
