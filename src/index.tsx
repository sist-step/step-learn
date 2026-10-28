import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { Icon } from './components/icons'
import { AppShell, AuthShell } from './components/layout'
import { session } from './lib/auth'
import { config } from './lib/config'
import { flashMiddleware } from './lib/http'
import type { AppEnv } from './lib/types'
import { renderer } from './renderer'
import account from './routes/account'
import admin from './routes/admin'
import auth from './routes/auth'
import content from './routes/content'
import courses, { dashboard } from './routes/courses'
import participants from './routes/participants'

const app = new Hono<AppEnv>()

app.use(secureHeaders())
// フォーム POST の Origin を検証（SameSite=Lax Cookie と合わせた CSRF 対策）
app.use(csrf(config.appOrigin ? { origin: config.appOrigin } : undefined))
app.use(flashMiddleware)
app.use(session)
app.use(renderer)

app.get('/', (c) => c.redirect(c.var.user ? '/dashboard' : '/login'))

app.route('/', auth)
app.route('/dashboard', dashboard)
app.route('/courses', courses)
app.route('/courses', content)
app.route('/courses', participants)
app.route('/account', account)
app.route('/admin', admin)

const NotFound = () => (
  <div class="empty empty-page">
    <div class="empty-icon">
      <Icon name="compass" size={24} />
    </div>
    <h3>ページが見つかりません</h3>
    <p class="muted">URL が間違っているか、閲覧する権限がありません。</p>
    <div class="empty-action">
      <a href="/" class="btn btn-primary">
        ホームへ戻る
      </a>
    </div>
  </div>
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
      <div class="empty empty-page">
        <div class="empty-icon">
          <Icon name="alert" size={24} />
        </div>
        <h3>エラーが発生しました</h3>
        <p class="muted">時間をおいて再度お試しください。</p>
        <div class="empty-action">
          <a href="/" class="btn btn-primary">
            ホームへ戻る
          </a>
        </div>
      </div>
    </AuthShell>,
    { title: 'エラー' },
  )
})

export default app
