import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { Button } from './components/button'
import { AppShell, AuthShell } from './components/layout'
import { EmptyState } from './components/ui'
import { session } from './lib/auth'
import { AGENT_BODY_LIMIT } from './features/agent/agent'
import { SYNC_BODY_LIMIT } from './features/bundle/bundle-sync'
import { isAiTeacher } from './features/ai/ai-usage'
import { touchCourse } from './lib/courses'
import { csrfGuard, flashMiddleware, limitBody, readFields } from './lib/http'
import { operationLog, recordPrefetchedView } from './lib/operation-log'
import { FILE_TOO_LARGE, MAX_FILE_SIZE } from './lib/storage'
import type { AppEnv } from './lib/types'
import { renderer } from './renderer'
import account from './features/account'
import admin from './features/admin'
import agent, { isAgentRequest, api as agentApi } from './features/agent'
import ai, { renderAiPanel } from './features/ai'
import auth from './features/auth'
import bundle, { isSyncRequest, api as vscodeApi } from './features/bundle'
import code, { CODE_BODY_LIMIT, isCodeRequest, api as codeApi } from './features/code'
import content from './features/content'
import courses from './features/courses'
import dashboard from './features/dashboard'
import mcp from './features/mcp'
import participants from './features/participants'
import presentation, { isPresentationUpload, api as presentationApi } from './features/presentation'
import quiz from './features/quiz'
import collab from './features/collab'
import screen from './features/screen'

const app = new Hono<AppEnv>()

// 全員に同じ上限をかけないのは、ログインしていなくても POST できるので、教材ファイル並みの大きさを受け付けると誰でもメモリを使わせられるため
const guestBodyLimit = limitBody(64 * 1024)
// ファイルの上限ちょうどにしないのは、同じフォームで本文などの入力欄も一緒に送るため
const userBodyLimit = limitBody(MAX_FILE_SIZE + 1024 * 1024, FILE_TOO_LARGE)

app.use(secureHeaders())
app.use(csrfGuard)
app.use(flashMiddleware)
app.use(session)
const syncBodyLimit = limitBody(SYNC_BODY_LIMIT)
const agentBodyLimit = limitBody(AGENT_BODY_LIMIT)
const codeBodyLimit = limitBody(CODE_BODY_LIMIT)
app.use((c, next) =>
  (isAgentRequest(c)
    ? agentBodyLimit
    : c.var.user || isPresentationUpload(c)
      ? userBodyLimit
      : isSyncRequest(c)
        ? syncBodyLimit
        : isCodeRequest(c)
          ? codeBodyLimit
          : guestBodyLimit)(c, next),
)
app.use(renderer)
// 要求ごとに描いておかず、AppShell が呼ぶまで待つのは、JSON やファイルを返す要求のたびに会話を復号することになるため
app.use(async (c, next) => {
  c.set('aiPanel', () => renderAiPanel(c.var.user))
  if (c.var.user && c.req.method === 'GET') c.set('mcpApps', isAiTeacher(c.var.user))
  await next()
})

// 各ハンドラで呼ばないのは、内容を変える操作を足したときに呼び忘れると、開いている画面に反映されなくなるため
// 完了の切り替えと、コードのアイテムの実行・保存・提出と、VS Code で開くリンク（ファイル自動配布・コーディングエージェント・発表ファイル）の発行を除くのは、本人にしか関係がないのに、コースを開いている全員に取り直させることになるため
const PERSONAL_POST = /\/complete$|\/items\/\d+\/code\/|\/items\/\d+\/(bundle|agent|presentation)\/launch$/
app.post('/courses/:id/*', async (c, next) => {
  await next()
  const id = Number(c.req.param('id'))
  // ログインしていない要求を除くのは、requireAuth のログイン画面へのリダイレクト（302）も 400 未満なので、誰でも任意のコースを進められてしまうため
  if (c.var.user && Number.isSafeInteger(id) && c.res.status < 400 && !PERSONAL_POST.test(c.req.path)) touchCourse(id)
})

app.use(operationLog)
app.post('/views', async (c) => {
  const fields = await readFields(c, 'viewed')
  if (fields) recordPrefetchedView(c, fields.path)
  return c.body(null, 204)
})

app.get('/', (c) => c.redirect(c.var.user ? '/dashboard' : '/login'))

app.route('/', auth)
app.route('/', mcp)
app.route('/dashboard', dashboard)
app.route('/courses', courses)
app.route('/courses', content)
app.route('/courses', participants)
app.route('/courses', screen)
app.route('/courses', code)
app.route('/courses', quiz)
app.route('/courses', collab)
app.route('/courses', bundle)
app.route('/courses', agent)
app.route('/courses', presentation)
app.route('/api/vscode/agent', agentApi)
app.route('/api/vscode/code', codeApi)
app.route('/api/vscode/presentation', presentationApi)
app.route('/api/vscode', vscodeApi)
app.route('/account', account)
app.route('/admin', admin)
app.route('/ai', ai)

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

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  c.status(500)
  return c.render(
    <AuthShell>
      <EmptyState
        page
        icon="alert"
        title="エラーが発生しました"
        text="時間をおいて再度お試しください。"
        action={
          <Button href="/" variant="primary">
            ホームへ戻る
          </Button>
        }
      />
    </AuthShell>,
    { title: 'エラー' },
  )
})

export default app
