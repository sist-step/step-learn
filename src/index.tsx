import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { Button } from './components/button'
import { AppShell, AuthShell } from './components/layout'
import { EmptyState } from './components/ui'
import { session } from './lib/auth'
import { config } from './lib/config'
import { touchCourse } from './lib/courses'
import { flashMiddleware, limitBody } from './lib/http'
import { FILE_TOO_LARGE, MAX_FILE_SIZE } from './lib/storage'
import type { AppEnv } from './lib/types'
import { renderer } from './renderer'
import account from './routes/account'
import admin from './routes/admin'
import auth from './routes/auth'
import content from './routes/content'
import courses from './routes/courses'
import dashboard from './routes/dashboard'
import participants from './routes/participants'
import screen from './routes/screen'

const app = new Hono<AppEnv>()

// 全員に同じ上限をかけないのは、ログインしていなくても POST できるので、教材ファイル並みの大きさを受け付けると誰でもメモリを使わせられるため
const guestBodyLimit = limitBody(64 * 1024)
// ファイルの上限ちょうどにしないのは、同じフォームで本文などの入力欄も一緒に送るため
const userBodyLimit = limitBody(MAX_FILE_SIZE + 1024 * 1024, FILE_TOO_LARGE)

app.use(secureHeaders())
// フォーム POST の Origin を検証（SameSite=Lax Cookie と合わせた CSRF 対策）
app.use(csrf(config.appOrigin ? { origin: config.appOrigin } : undefined))
app.use(flashMiddleware)
app.use(session)
app.use((c, next) => (c.var.user ? userBodyLimit : guestBodyLimit)(c, next))
app.use(renderer)

// 各ハンドラで呼ばないのは、内容を変える操作を足したときに呼び忘れると、開いている画面に反映されなくなるため
// 完了の切り替えを除くのは、本人にしか関係がないのに、コースを開いている全員に取り直させることになるため
app.post('/courses/:id/*', async (c, next) => {
  await next()
  const id = Number(c.req.param('id'))
  if (Number.isSafeInteger(id) && c.res.status < 400 && !c.req.path.endsWith('/complete')) touchCourse(id)
})

app.get('/', (c) => c.redirect(c.var.user ? '/dashboard' : '/login'))

app.route('/', auth)
app.route('/dashboard', dashboard)
app.route('/courses', courses)
app.route('/courses', content)
app.route('/courses', participants)
app.route('/courses', screen)
app.route('/account', account)
app.route('/admin', admin)

const NotFound = () => (
  <EmptyState
    page
    icon="globe"
    title="ページが見つかりません"
    text="URL が間違っているか、閲覧する権限がありません。"
    action={
      <Button href="/" variant="primary">
        ホームへ戻る
      </Button>
    }
  />
)

app.notFound((c) => {
  c.status(404)
  return c.render(c.var.user ? <AppShell>{<NotFound />}</AppShell> : <AuthShell>{<NotFound />}</AuthShell>, {
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
