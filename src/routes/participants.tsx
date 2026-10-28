import { Hono, type Context } from 'hono'
import { CourseHeader } from '../components/course'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { Avatar, Progress, formatDate } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { field, intParam, isEmail, readForm, redirectWith } from '../lib/http'
import { COURSE_ROLE_LABELS, type AppEnv, type CourseRole } from '../lib/types'
import { db } from '../lib/db'

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
  if (!access || !access.canView) return c.notFound()
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
        <div class="person">
          <Avatar name={p.name} />
          <div class="person-meta">
            <span class="strong truncate">
              {p.name}
              {p.id === me.id && <span class="muted small">（あなた）</span>}
            </span>
            {manage && <span class="muted small truncate">{p.email}</span>}
          </div>
        </div>
      </td>
      {manage && (
        <td class="hide-sm progress-cell">{p.role === 'student' ? <Progress done={p.done} total={totalItems} /> : <span class="muted">—</span>}</td>
      )}
      <td class="hide-sm muted">{formatDate(p.created_at)}</td>
      <td>
        {manage ? (
          <div class="row-actions">
            <form method="post" action={`/courses/${id}/participants/${p.id}/role`} data-autosubmit>
              <select name="role" class="select-sm" aria-label={`${p.name} のロール`}>
                {(['student', 'teacher'] as CourseRole[]).map((r) => (
                  <option value={r} selected={p.role === r}>
                    {COURSE_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <noscript>
                <button class="btn btn-sm">変更</button>
              </noscript>
            </form>
            <form method="post" action={`/courses/${id}/participants/${p.id}/remove`} data-confirm={`${p.name} さんをコースから外しますか？`}>
              <button class="icon-btn danger" aria-label="コースから外す" title="コースから外す">
                <Icon name="x" size={16} />
              </button>
            </form>
          </div>
        ) : (
          <span class={p.role === 'teacher' ? 'chip chip-accent' : 'chip'}>{COURSE_ROLE_LABELS[p.role]}</span>
        )}
      </td>
    </tr>
  )

  const Table = ({ title, list }: { title: string; list: Participant[] }) => (
    <section class="block">
      <h2 class="block-title">
        {title} <span class="count">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p class="muted small">まだいません。</p>
      ) : (
        <div class="table-card">
          <table class="table">
            <thead>
              <tr>
                <th>名前</th>
                {manage && <th class="hide-sm">進捗</th>}
                <th class="hide-sm">参加日</th>
                <th>{manage ? '操作' : 'ロール'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <Row p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )

  return c.render(
    <AppShell>
      <CourseHeader access={access} tab="participants" />
      {manage && (
        <form method="post" action={`/courses/${id}/participants`} class="card invite" data-loading-form>
          <div class="invite-text">
            <h2>参加者を追加</h2>
            <p class="muted small">登録済みユーザーのメールアドレスを入力してください。</p>
          </div>
          <div class="invite-fields">
            <input name="email" type="email" placeholder="name@example.com" required aria-label="メールアドレス" autocomplete="off" />
            <select name="role" aria-label="ロール">
              <option value="student">学生</option>
              <option value="teacher">教師</option>
            </select>
            <button type="submit" class="btn btn-primary">
              <Icon name="plus" size={16} /> 追加
            </button>
          </div>
        </form>
      )}
      <Table title="教師" list={teachers} />
      <Table title="学生" list={students} />
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
