import { and, eq, isNotNull, or } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { RequestContext } from 'hono/jsx-renderer'
import { CourseHeader } from '../components/course'
import { Button, IconButton } from '../components/button'
import { Block, Table } from '../components/card'
import { Input, SegmentedControl, Select } from '../components/form'
import { AppShell } from '../components/layout'
import { Modal } from '../components/overlay'
import { Styles } from '../components/style'
import { Avatar, Chip, Person, Progress, formatDate } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { field, intParam, readForm, redirectWith } from '../lib/http'
import { COURSE_ROLE_LABELS, type AppEnv, type CourseRole } from '../lib/types'
import { contains, db } from '../lib/db'
import { completions, enrollments, items, users } from '../lib/schema'

const ROLE_OPTIONS = (['student', 'teacher'] as CourseRole[]).map((r) => ({ value: r, label: COURSE_ROLE_LABELS[r] }))

const app = new Hono<AppEnv>()
app.use(requireAuth)

type Participant = {
  id: number
  name: string
  email: string
  role: CourseRole
  createdAt: number
  done: number
}

type Candidate = {
  id: number
  name: string
  email: string
  role: CourseRole | null
}

const CANDIDATE_LIMIT = 20
const ADD_MODAL = 'add-participant'
const ADD_RESULTS = 'add-participant-results'

const isCourseRole = (r: string): r is CourseRole => r === 'teacher' || r === 'student'

const Candidates = ({ q, users }: { q: string; users: Candidate[] }) => {
  if (!q) return <p class="candidates-note muted small">名前またはメールアドレスの一部を入力してください。</p>
  if (users.length === 0) return <p class="candidates-note muted small">「{q}」に一致するユーザーはいません。</p>
  return (
    <>
      <ul class="candidates">
        {users.slice(0, CANDIDATE_LIMIT).map((u) => (
          <li class="candidate">
            <Person avatar={<Avatar name={u.name} />} name={u.name} meta={u.email} />
            {u.role ? (
              <Chip>{COURSE_ROLE_LABELS[u.role]}として参加中</Chip>
            ) : (
              <Button type="submit" size="sm" icon="plus" name="user_id" value={String(u.id)} aria-label={`${u.name} さんを追加`}>
                追加
              </Button>
            )}
          </li>
        ))}
      </ul>
      {users.length > CANDIDATE_LIMIT && <p class="candidates-note muted small">ほかにも一致するユーザーがいます。さらに絞り込んでください。</p>}
    </>
  )
}

const AddParticipant = ({ courseId }: { courseId: number }) => (
  <div class="participants-toolbar">
    <Button variant="primary" icon="plus" popovertarget={ADD_MODAL}>
      参加者を追加
    </Button>
    <Modal id={ADD_MODAL} heading="参加者を追加" description="登録済みのユーザーを検索して、このコースに追加します。">
      <div class="stack">
        <Input
          type="search"
          placeholder="名前・メールアドレスで検索"
          aria-label="ユーザーを検索"
          aria-controls={ADD_RESULTS}
          autocomplete="off"
          autofocus
          data-user-search={`/courses/${courseId}/participants/candidates`}
        />
        <form method="post" action={`/courses/${courseId}/participants`} class="stack" data-loading-form>
          <SegmentedControl name="role" label="追加するロール" options={ROLE_OPTIONS} value="student" />
          <div id={ADD_RESULTS} class="candidates-box" aria-live="polite">
            <Candidates q="" users={[]} />
          </div>
        </form>
      </div>
    </Modal>
  </div>
)

app.get('/:id/participants', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const me = c.var.user!

  const people: Participant[] = db
    .select({
      id: users.id,
      name: users.name,
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
  const teachers = people.filter((p) => p.role === 'teacher')
  const students = people.filter((p) => p.role === 'student')
  const manage = access.canManage

  const Row = ({ p }: { p: Participant }) => (
    <tr>
      <td>
        <Person
          avatar={<Avatar name={p.name} />}
          name={
            <>
              {p.name}
              {p.id === me.id && <span class="muted small">（あなた）</span>}
            </>
          }
          meta={manage && p.email}
        />
      </td>
      {manage && (
        <td class="hide-sm progress-cell">{p.role === 'student' ? <Progress done={p.done} total={totalItems} /> : <span class="muted">—</span>}</td>
      )}
      <td class="hide-sm muted">{formatDate(p.createdAt)}</td>
      <td>
        {manage ? (
          <div class="row-actions">
            <form method="post" action={`/courses/${id}/participants/${p.id}/role`} data-autosubmit>
              <Select name="role" compact options={ROLE_OPTIONS} value={p.role} aria-label={`${p.name} のロール`} />
            </form>
            <form method="post" action={`/courses/${id}/participants/${p.id}/remove`} data-confirm={`${p.name} さんをコースから外しますか？`}>
              <IconButton type="submit" icon="x" label="コースから外す" danger />
            </form>
          </div>
        ) : (
          <Chip tone={p.role === 'teacher' ? 'accent' : 'default'}>{COURSE_ROLE_LABELS[p.role]}</Chip>
        )}
      </td>
    </tr>
  )

  const ParticipantTable = ({ title, list }: { title: string; list: Participant[] }) => (
    <Block heading={title} count={list.length}>
      {list.length === 0 ? (
        <p class="muted small">まだいません。</p>
      ) : (
        <Table
          columns={[
            { label: '名前' },
            manage && { label: '進捗', class: 'hide-sm' },
            { label: '参加日', class: 'hide-sm' },
            { label: manage ? '操作' : 'ロール' },
          ]}
        >
          {list.map((p) => (
            <Row p={p} />
          ))}
        </Table>
      )}
    </Block>
  )

  return c.render(
    <AppShell>
      <Styles use={['/src/routes/participants.css']} />
      <CourseHeader access={access} tab="participants" />
      {manage && <AddParticipant courseId={id} />}
      <ParticipantTable title="教師" list={teachers} />
      <ParticipantTable title="学生" list={students} />
    </AppShell>,
    { title: `参加者 - ${access.course.title}` },
  )
})

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

app.get('/:id/participants/candidates', async (c) => {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const candidates: Candidate[] = q
    ? db
        .select({ id: users.id, name: users.name, email: users.email, role: enrollments.role })
        .from(users)
        .leftJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.courseId, access.course.id)))
        .where(or(contains(users.name, q), contains(users.email, q)))
        .orderBy(isNotNull(enrollments.role), users.name)
        .limit(CANDIDATE_LIMIT + 1)
        .all()
    : []
  // c.render で返さないのは、モーダルの中身だけを差し替えるのにページ全体のレイアウトは要らないため
  return c.html(
    <RequestContext.Provider value={c}>
      <Candidates q={q} users={candidates} />
    </RequestContext.Provider>,
  )
})

app.post('/:id/participants', async (c) => {
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
})

app.post('/:id/participants/:uid/role', async (c) => {
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
})

app.post('/:id/participants/:uid/remove', async (c) => {
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
})

export default app
