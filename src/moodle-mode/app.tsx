import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { secureHeaders } from 'hono/secure-headers'
import { config } from '../lib/config'
import { flashMiddleware, limitBody, wantsJson } from '../lib/http'
import { FILE_TOO_LARGE, MAX_FILE_SIZE } from '../lib/storage'
import { renderer } from '../renderer'
import { destroySession, requireAuth, session, type MoodleEnv } from './auth'
import { MoodleError, isAccessDenied, isNotFound, isTokenError, isUnavailable } from './client'
import * as h from './handlers'
import { ErrorPage, errorContent, type ErrorContent } from './views'

const app = new Hono<MoodleEnv>()

// 全員に同じ上限をかけないのは、ログインしていなくても POST できるので、教材ファイル並みの大きさを受け付けると誰でもメモリを使わせられるため
const guestBodyLimit = limitBody(64 * 1024)
// ファイルの上限ちょうどにしないのは、同じフォームでタイトルなどの入力欄も一緒に送るため
const userBodyLimit = limitBody(MAX_FILE_SIZE + 1024 * 1024, FILE_TOO_LARGE)

// 最初に置くのは、CSRF の検証など前のミドルウェアで起きたエラーも、エラーの画面で描けるようにするため
app.use(renderer)
app.use(secureHeaders())
// フォーム POST の Origin を検証（SameSite=Lax Cookie と合わせた CSRF 対策）。ログアウトの通知は JSON なので対象外になる
app.use(csrf(config.appOrigin ? { origin: config.appOrigin } : undefined))
app.use(flashMiddleware)
app.use(session)
app.use((c, next) => (c.var.user ? userBodyLimit : guestBodyLimit)(c, next))

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

// エラーの画面を HTML で返すのは、client.ts が HTML でない応答を受けると送信先の URL を GET で開き直してしまうため
function renderError(c: Context<MoodleEnv>, status: ContentfulStatusCode, content?: ErrorContent) {
  const shown = content ?? errorContent(status)
  if (wantsJson(c)) return c.json({ error: shown.title }, status)
  c.status(status)
  const url = new URL(c.req.url)
  const retry = status >= 500 && c.req.method === 'GET' ? url.pathname + url.search : undefined
  return c.render(<ErrorPage status={status} content={shown} loggedIn={!!c.var.user} retry={retry} />, { title: shown.title })
}

app.notFound((c) => renderError(c, 404))

const ACCESS_DENIED: ErrorContent = {
  icon: 'lock',
  title: 'このアカウントでは利用できません',
  text: '旧STEP Learn の設定で、このアカウントから STEP Learn を使うことが許可されていません。管理者にお問い合わせください。',
}

app.onError(async (err, c) => {
  if (err instanceof HTTPException) return renderError(c, err.status)
  if (isNotFound(err)) return renderError(c, 404)
  if (isTokenError(err)) {
    await destroySession(c)
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? url.pathname + url.search : '/dashboard'
    return c.redirect(`/login?next=${encodeURIComponent(next)}`, 303)
  }
  if (isUnavailable(err)) return renderError(c, 503)
  console.error(err)
  if (isAccessDenied(err)) return renderError(c, 403, ACCESS_DENIED)
  return renderError(c, err instanceof MoodleError ? 502 : 500)
})

export default app
