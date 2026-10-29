import { Hono } from 'hono'
import { Script } from 'vite-ssr-components/hono'
import { ItemIcon } from '../components/course'
import { Icon } from '../components/icons'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { intParam } from '../lib/http'
import type { AppEnv, Item } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth)

// AppShell で包まないのは、別タブで開いて映像をタブいっぱいに映すため
app.get('/:id/items/:iid/screen', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || !access.canView) return c.notFound()
  const item = await db
    .prepare('SELECT id, title FROM items WHERE id = ? AND course_id = ? AND type = ?')
    .bind(iid, id, 'screen')
    .first<Pick<Item, 'id' | 'title'>>()
  if (!item) return c.notFound()

  return c.render(
    <div class="screen-page" data-screen-share={item.id} data-course={id} data-can-present={access.canManage ? '1' : undefined}>
      <header class="screen-head">
        <div class="screen-title">
          <ItemIcon type="screen" />
          <div class="screen-title-text">
            <h1 class="truncate">{item.title}</h1>
            <span class="muted small truncate">{access.course.title}</span>
          </div>
        </div>
        <span class="chip" data-screen-state>
          待機中
        </span>
        {access.canManage && <span class="muted small truncate screen-stats" data-screen-stats />}
        <div class="screen-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-screen-fullscreen hidden>
            <Icon name="maximize" size={16} /> 全画面
          </button>
          {access.canManage && (
            <>
              <button type="button" class="btn btn-sm btn-primary" data-screen-start hidden>
                <Icon name="monitor" size={16} /> 共有を開始
              </button>
              <button type="button" class="btn btn-sm btn-danger" data-screen-stop hidden>
                <Icon name="x" size={16} /> 共有を停止
              </button>
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
