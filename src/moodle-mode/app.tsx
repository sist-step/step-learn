import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { Button } from '../components/button'
import { AppShell, AuthShell } from '../components/layout'
import { EmptyState } from '../components/ui'
import { config } from '../lib/config'
import { flashMiddleware, limitBody } from '../lib/http'
import { FILE_TOO_LARGE, MAX_FILE_SIZE } from '../lib/storage'
import { renderer } from '../renderer'
import { destroySession, requireAuth, session, type MoodleEnv } from './auth'
import { isNotFound, isTokenError, isUnavailable } from './client'
import * as h from './handlers'

const app = new Hono<MoodleEnv>()

// 全員に同じ上限をかけないのは、ログインしていなくても POST できるので、教材ファイル並みの大きさを受け付けると誰でもメモリを使わせられるため
const guestBodyLimit = limitBody(64 * 1024)
// ファイルの上限ちょうどにしないのは、同じフォームでタイトルなどの入力欄も一緒に送るため
const userBodyLimit = limitBody(MAX_FILE_SIZE + 1024 * 1024, FILE_TOO_LARGE)

app.use(secureHeaders())
// フォーム POST の Origin を検証（SameSite=Lax Cookie と合わせた CSRF 対策）。ログアウトの通知は JSON なので対象外になる
app.use(csrf(config.appOrigin ? { origin: config.appOrigin } : undefined))
app.use(flashMiddleware)
app.use(session)
app.use((c, next) => (c.var.user ? userBodyLimit : guestBodyLimit)(c, next))
app.use(renderer)

app.get('/', (c) => c.redirect(c.var.user ? '/dashboard' : '/login'))

app.get('/login', h.showLogin)
app.post('/auth/moodle/start', h.startLogin)
app.get('/auth/moodle/callback', h.finishLogin)
app.post('/auth/moodle/backchannel-logout', h.backchannelLogout)
app.post('/logout', h.logout)

const auth = new Hono<MoodleEnv>()
auth.use(requireAuth)
auth.get('/dashboard', h.dashboard)
auth.get(
  '/account',
  h.toMoodle(() => '/user/edit.php'),
)
auth.get(
  '/admin',
  h.toMoodle((c) => (c.var.user!.role === 'admin' ? '/admin/search.php' : null)),
)
auth.get('/courses', h.listCourses)
auth.get('/courses/:id', h.showCourse)
auth.get('/courses/:id/revision', h.revision)
auth.get(
  '/courses/:id/participants',
  h.toMoodle((c) => `/user/index.php?id=${Number(c.req.param('id')) || 0}`),
)
auth.get(
  '/courses/:id/settings',
  h.toMoodle((c) => `/course/edit.php?id=${Number(c.req.param('id')) || 0}`),
)
auth.get('/courses/:id/:kind{hero|icon}/:name', h.courseImage)
auth.post('/courses/:id/sections', h.createSection)
auth.post('/courses/:id/sections/:sid', h.updateSection)
auth.post('/courses/:id/sections/:sid/move', h.moveSection)
auth.post('/courses/:id/sections/:sid/delete', h.removeSection)
auth.post('/courses/:id/sections/:sid/visibility', h.setSectionHidden)
auth.post('/courses/:id/items', h.createItem)
auth.get('/courses/:id/items/:iid/edit', h.editItem)
auth.post('/courses/:id/items/:iid', h.updateItem)
auth.post('/courses/:id/items/:iid/move', h.moveItem)
auth.post('/courses/:id/items/:iid/delete', h.removeItem)
auth.post('/courses/:id/items/:iid/visibility', h.setItemHidden)
auth.get('/courses/:id/items/:iid', h.showItem)
auth.post('/courses/:id/items/:iid/complete', h.toggleComplete)
auth.get('/courses/:id/items/:iid/file', h.downloadFile)
app.route('/', auth)

const NotFound = ({ loggedIn }: { loggedIn: boolean }) => (
  <EmptyState
    page
    icon="search"
    title="ページが見つかりません"
    text="URL が間違っているか、閲覧する権限がありません。"
    action={
      loggedIn ? (
        <div class="row">
          <Button href="/courses" icon="book">
            コース一覧
          </Button>
          <Button href="/" variant="primary">
            ホームへ戻る
          </Button>
        </div>
      ) : (
        <Button href="/" variant="primary">
          ホームへ戻る
        </Button>
      )
    }
  />
)

app.notFound((c) => {
  c.status(404)
  return c.render(c.var.user ? <AppShell>{<NotFound loggedIn />}</AppShell> : <AuthShell>{<NotFound loggedIn={false} />}</AuthShell>, {
    title: '見つかりません',
  })
})

const ErrorPage = ({ title, text }: { title: string; text: string }) => (
  <AuthShell>
    <EmptyState
      page
      icon="alert"
      title={title}
      text={text}
      action={
        <Button href="/" variant="primary">
          ホームへ戻る
        </Button>
      }
    />
  </AuthShell>
)

app.onError(async (err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  if (isNotFound(err)) return c.notFound()
  if (isTokenError(err)) {
    await destroySession(c)
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? url.pathname + url.search : '/dashboard'
    return c.redirect(`/login?next=${encodeURIComponent(next)}`, 303)
  }
  if (isUnavailable(err)) {
    c.status(503)
    return c.render(<ErrorPage title="Moodle に接続できません" text="時間をおいて再度お試しください。" />, { title: 'エラー' })
  }
  console.error(err)
  c.status(500)
  return c.render(<ErrorPage title="エラーが発生しました" text="時間をおいて再度お試しください。" />, { title: 'エラー' })
})

export default app
