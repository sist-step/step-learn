import { Hono } from 'hono'
import { Script } from 'vite-ssr-components/hono'
import { CourseHeader } from '../components/course'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { intParam } from '../lib/http'
import { MAX_FPS, MAX_HEIGHT, MAX_WIDTH } from '../lib/screen-share-protocol'
import type { AppEnv } from '../lib/types'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/screen', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canView) return c.notFound()

  return c.render(
    <AppShell>
      <CourseHeader access={access} tab="screen" />
      <section class="screen-share" data-screen-share={id} data-can-present={access.canManage ? '1' : undefined}>
        <div class="screen-stage" data-screen-stage>
          <canvas class="screen-media" data-screen-canvas hidden />
          <video class="screen-media" data-screen-preview muted playsinline hidden />
          <div class="screen-placeholder" data-screen-placeholder>
            <Icon name="monitor" size={28} />
            <p data-screen-message>画面共有を利用するには JavaScript を有効にしてください。</p>
          </div>
        </div>
        <div class="screen-bar">
          <span class="chip" data-screen-state>
            待機中
          </span>
          <span class="muted small truncate" data-screen-stats />
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
        </div>
      </section>
      <p class="screen-error" role="alert" data-screen-error hidden />
      {access.canManage && (
        <p class="muted small screen-note">
          最大 {MAX_WIDTH}×{MAX_HEIGHT}・{MAX_FPS}fps で配信します。画質（ビットレート）は画面の動きと回線の混み具合に合わせて自動で変わります。
        </p>
      )}
      <Script src="/src/screen-share.ts" />
    </AppShell>,
    { title: `画面共有 - ${access.course.title}` },
  )
})

export default app
