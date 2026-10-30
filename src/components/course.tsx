import type { Child } from 'hono/jsx'
import type { CourseAccess } from '../lib/courses'
import { COURSE_COLORS, type Course, type ItemType } from '../lib/types'
import { Button } from './button'
import { Card } from './card'
import { TextAreaField, TextField } from './form'
import { Icon, type IconName } from './icons'
import { Modal } from './overlay'
import { Breadcrumbs, ProgressRing, Tabs, type TabItem } from './ui'
import { useStyle } from './style'

type Tab = 'content' | 'participants' | 'settings'

export const CourseHeader = ({
  access,
  tab,
  meta,
  progress,
  actions,
}: {
  access: CourseAccess
  tab?: Tab
  meta?: Child
  progress?: { done: number; total: number }
  actions?: Child
}) => {
  useStyle('/src/components/course.css')
  const { course, canManage } = access
  const base = `/courses/${course.id}`
  return (
    <>
      <Breadcrumbs items={[{ href: '/courses', label: 'コース' }, { label: course.code || course.title }]} />
      <section class={`course-hero tone-${course.color}`}>
        <span class="course-hero-mono" aria-hidden="true">
          {[...(course.code || course.title)].slice(0, 2).join('')}
        </span>
        <div class="course-hero-body">
          <h1>{course.title}</h1>
          {course.summary && <p class="course-hero-summary">{course.summary}</p>}
          {meta && <div class="course-hero-meta">{meta}</div>}
        </div>
        {(actions || (progress && progress.total > 0)) && (
          <div class="course-hero-side">
            {progress && progress.total > 0 && (
              <div class="course-hero-progress">
                <ProgressRing done={progress.done} total={progress.total} />
                <span class="muted small">
                  <span data-progress-done>{progress.done}</span> / {progress.total} 完了
                </span>
              </div>
            )}
            {actions && <div class="course-hero-actions">{actions}</div>}
          </div>
        )}
      </section>
      {tab && (
        <Tabs
          label="コースメニュー"
          items={(
            [
              { href: base, label: 'コンテンツ', active: tab === 'content' },
              { href: `${base}/participants`, label: '参加者', active: tab === 'participants' },
              canManage && { href: `${base}/settings`, label: '設定', active: tab === 'settings' },
            ] satisfies (TabItem | false)[]
          ).filter((t) => t !== false)}
        />
      )}
    </>
  )
}

export type CourseFormValues = Partial<Pick<Course, 'title' | 'code' | 'summary' | 'color'>>
export type CourseFormErrors = Partial<Record<'title' | 'code' | 'summary', string>>

const CourseFields = ({ values, errors = {} }: { values: CourseFormValues; errors?: CourseFormErrors }) => {
  useStyle('/src/components/course.css')
  return (
    <>
      <div class="grid-2">
        <TextField label="コース名" name="title" value={values.title} error={errors.title} required maxlength={120} placeholder="例：情報リテラシー入門" autofocus={!values.title} />
        <TextField label="コースコード（任意）" name="code" value={values.code} error={errors.code} maxlength={30} placeholder="例：INFO101" hint="一覧やカードに表示される短い識別名" />
      </div>
      <TextAreaField label="概要" name="summary" value={values.summary} error={errors.summary} rows={3} placeholder="このコースで学べることを簡潔に" />

      <fieldset class="field">
        <legend>カラー</legend>
        <div class="swatches">
          {COURSE_COLORS.map((color) => (
            <label class={`swatch tone-${color}`} title={color}>
              <input type="radio" name="color" value={color} checked={(values.color ?? 'cyan') === color} />
              <span class="swatch-dot">
                <Icon name="check" size={14} />
              </span>
              <span class="sr-only">{color}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

export const CourseForm = ({
  action,
  values,
  errors,
  submitLabel,
  cancelHref,
}: {
  action: string
  values: CourseFormValues
  errors?: CourseFormErrors
  submitLabel: string
  cancelHref: string
}) => (
  <Card as="form" method="post" action={action} class="stack course-form" data-loading-form>
    <CourseFields values={values} errors={errors} />
    <div class="form-actions">
      <Button href={cancelHref} variant="ghost">
        キャンセル
      </Button>
      <Button type="submit" variant="primary">
        {submitLabel}
      </Button>
    </div>
  </Card>
)

const CREATE_COURSE_MODAL = 'create-course'

export const CreateCourseButton = () => (
  <>
    <Button variant="primary" icon="plus" popovertarget={CREATE_COURSE_MODAL}>
      コースを作成
    </Button>
    <Modal
      id={CREATE_COURSE_MODAL}
      heading="コースを作成"
      description="作成後に参加者タブから教師と学生を追加します。基本情報はあとからいつでも変更できます。"
    >
      <form method="post" action="/courses" class="stack" data-loading-form>
        <CourseFields values={{}} />
        <div class="form-actions">
          <Button variant="ghost" popovertarget={CREATE_COURSE_MODAL} popovertargetaction="hide">
            キャンセル
          </Button>
          <Button type="submit" variant="primary">
            コースを作成
          </Button>
        </div>
      </form>
    </Modal>
  </>
)

const ITEM_ICONS: Record<ItemType, IconName> = { page: 'page', link: 'link', file: 'file', screen: 'monitor' }

export const ItemIcon = ({ type }: { type: ItemType }) => {
  useStyle('/src/components/course.css')
  return (
    <span class={`item-icon kind-${type}`}>
      <Icon name={ITEM_ICONS[type]} size={16} />
    </span>
  )
}
