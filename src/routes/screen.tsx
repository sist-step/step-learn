import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { Script } from 'vite-ssr-components/hono'
import { ItemIcon } from '../components/course'
import { Button } from '../components/button'
import { Icon } from '../components/icons'
import { Styles } from '../components/style'
import { Chip } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { intParam } from '../lib/http'
import type { AppEnv } from '../lib/types'
import { db } from '../lib/db'
import { items } from '../lib/schema'

const app = new Hono<AppEnv>()
app.use(requireAuth)

// AppShell で包まないのは、別タブで開いて映像をタブいっぱいに映すため
app.get('/:id/items/:iid/screen', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const item = db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(and(eq(items.id, iid), eq(items.courseId, id), eq(items.type, 'screen')))
    .get()
  if (!item) return c.notFound()

  return c.render(
    <div class="screen-page" data-screen-share={item.id} data-course={id} data-can-present={access.canManage ? '1' : undefined}>
      <Styles use={['/src/routes/screen.css']} />
      <header class="screen-head">
        <div class="screen-title">
          <ItemIcon type="screen" />
          <div class="screen-title-text">
            <h1 class="truncate">{item.title}</h1>
            <span class="muted small truncate">{access.course.title}</span>
          </div>
        </div>
        <Chip data-screen-state>待機中</Chip>
        {access.canManage && <span class="muted small truncate screen-stats" data-screen-stats />}
        <div class="screen-actions">
          <Button variant="ghost" size="sm" icon="maximize" data-screen-fullscreen hidden>
            全画面
          </Button>
          {access.canManage && (
            <>
              <Button variant="primary" size="sm" icon="monitor" data-screen-start hidden>
                共有を開始
              </Button>
              <Button variant="danger" size="sm" icon="x" data-screen-stop hidden>
                共有を停止
              </Button>
            </>
          )}
        </div>
      </header>
      <div class="screen-stage" data-screen-stage>
        <canvas class="screen-media" data-screen-canvas hidden />
        <video class="screen-media" data-screen-preview muted playsinline hidden />
        <div class="screen-placeholder" data-screen-placeholder>
          <Icon name="monitor" size={28} />
          <p data-screen-message>画面共有を利用するには JavaScript を有効にしてください。</p>
        </div>
        <p class="screen-error" role="alert" data-screen-error hidden />
      </div>
      <Script src="/src/screen-share.ts" />
    </div>,
    { title: item.title },
  )
})

export default app
