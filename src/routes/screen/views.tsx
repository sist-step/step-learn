import { Script } from 'vite-ssr-components/hono'
import { ItemIcon } from '../../components/course'
import { Button } from '../../components/button'
import { Icon } from '../../components/icons'
import { Styles } from '../../components/style'
import { Chip } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'

// AppShell で包まないのは、別タブで開いて映像をタブいっぱいに映すため
export const ScreenPage = ({ access, item }: { access: CourseAccess; item: { id: number; title: string } }) => (
  <div class="screen-page" data-screen-share={item.id} data-course={access.course.id} data-can-present={access.canManage ? '1' : undefined}>
    <Styles use={['/src/routes/screen/screen.css']} />
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
  </div>
)
