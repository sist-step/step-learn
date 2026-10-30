import { Hono, type Context } from 'hono'
import { CourseHeader } from '../components/course'
import { Button, IconButton } from '../components/button'
import { Block, Card, Table } from '../components/card'
import { Input, Select } from '../components/form'
import { AppShell } from '../components/layout'
import { Styles } from '../components/style'
import { Avatar, Chip, Person, Progress, formatDate } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { field, intParam, isEmail, readForm, redirectWith } from '../lib/http'
import { COURSE_ROLE_LABELS, type AppEnv, type CourseRole } from '../lib/types'
import { db } from '../lib/db'

const ROLE_OPTIONS = (['student', 'teacher'] as CourseRole[]).map((r) => ({ value: r, label: COURSE_ROLE_LABELS[r] }))

const app = new Hono<AppEnv>()
app.use(requireAuth)

type Participant = {
  id: number
  name: string
  email: string
  role: CourseRole
  created_at: number
  done: number
}

const isCourseRole = (r: string): r is CourseRole => r === 'teacher' || r === 'student'

app.get('/:id/participants', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const me = c.var.user!

  const [pRes, tRes] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.name, u.email, e.role, e.created_at,
                (SELECT COUNT(*) FROM completions k WHERE k.user_id = u.id AND k.course_id = e.course_id) AS done
         FROM enrollments e JOIN users u ON u.id = e.user_id
         WHERE e.course_id = ?
         ORDER BY e.role = 'student', u.name`,
      )
      .bind(id),
    db.prepare('SELECT COUNT(*) AS n FROM items WHERE course_id = ?').bind(id),
  ])
  const people = pRes.results as Participant[]
  const totalItems = (tRes.results[0] as { n: number }).n
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
      <td class="hide-sm muted">{formatDate(p.created_at)}</td>
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
      {manage && (
        <Card as="form" method="post" action={`/courses/${id}/participants`} class="invite" data-loading-form>
          <div class="invite-text">
            <h2>参加者を追加</h2>
            <p class="muted small">登録済みユーザーのメールアドレスを入力してください。</p>
          </div>
          <div class="invite-fields">
            <Input name="email" type="email" placeholder="name@example.com" required aria-label="メールアドレス" autocomplete="off" />
            <Select name="role" options={ROLE_OPTIONS} aria-label="ロール" />
            <Button type="submit" variant="primary" icon="plus">
              追加
            </Button>
          </div>
        </Card>
      )}
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
  const row = await db
    .prepare(
      `SELECT (SELECT role FROM enrollments WHERE course_id = ?1 AND user_id = ?2) AS role,
              (SELECT COUNT(*) FROM enrollments WHERE course_id = ?1 AND role = 'teacher') AS teachers`,
    )
    .bind(courseId, userId)
    .first<{ role: CourseRole | null; teachers: number }>()
  return row?.role === 'teacher' && row.teachers <= 1
}

app.post('/:id/participants', async (c) => {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const id = access.course.id
  const back = `/courses/${id}/participants`
  const form = await readForm(c)
  const email = field(form, 'email', 254).toLowerCase()
  const role = field(form, 'role')
  if (!isEmail(email) || !isCourseRole(role)) return redirectWith(c, back, '有効なメールアドレスを入力してください。', 'error')

  const user = await db.prepare('SELECT id, name FROM users WHERE email = ?').bind(email).first<{ id: number; name: string }>()
  if (!user) return redirectWith(c, back, `${email} のユーザーは見つかりませんでした。先に新規登録してもらってください。`, 'error')

  const res = await db.prepare('INSERT OR IGNORE INTO enrollments (course_id, user_id, role) VALUES (?, ?, ?)')
    .bind(id, user.id, role)
    .run()
  if (!res.meta.changes) return redirectWith(c, back, `${user.name} さんはすでに参加しています。`, 'info')
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
  await db.prepare('UPDATE enrollments SET role = ? WHERE course_id = ? AND user_id = ?').bind(role, id, uid).run()
  return redirectWith(c, back, 'ロールを変更しました。')
})

app.post('/:id/participants/:uid/remove', async (c) => {
  const access = await manageAccess(c)
  const uid = intParam(c, 'uid')
  if (!access || !uid) return c.notFound()
  const id = access.course.id
  const back = `/courses/${id}/participants`
  if (await isLastTeacher(id, uid)) return redirectWith(c, back, 'コースには少なくとも1人の教師が必要です。', 'error')
  await db.batch([
    db.prepare('DELETE FROM enrollments WHERE course_id = ? AND user_id = ?').bind(id, uid),
    db.prepare('DELETE FROM completions WHERE course_id = ? AND user_id = ?').bind(id, uid),
  ])
  return redirectWith(c, back, 'コースから外しました。', 'info')
})

export default app
