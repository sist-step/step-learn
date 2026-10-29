import type { Child } from 'hono/jsx'
import type { CourseAccess } from '../lib/courses'
import { isSharing } from '../lib/screen-share'
import { COURSE_COLORS, type Course } from '../lib/types'
import { Icon } from './icons'
import { Field, ProgressRing, TextArea } from './ui'

type Tab = 'content' | 'participants' | 'screen' | 'settings'

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
  const { course, canManage, canView } = access
  const base = `/courses/${course.id}`
  return (
    <>
      <nav class="crumbs" aria-label="パンくず">
        <a href="/courses">コース</a>
        <Icon name="chevronRight" size={14} />
        <span>{course.code || course.title}</span>
      </nav>
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
      {canView && tab && (
        <nav class="tabs" aria-label="コースメニュー">
          <a href={base} class={tab === 'content' ? 'tab active' : 'tab'} aria-current={tab === 'content' ? 'page' : undefined}>
            コンテンツ
          </a>
          <a
            href={`${base}/participants`}
            class={tab === 'participants' ? 'tab active' : 'tab'}
            aria-current={tab === 'participants' ? 'page' : undefined}
          >
            参加者
          </a>
          <a href={`${base}/screen`} class={tab === 'screen' ? 'tab active' : 'tab'} aria-current={tab === 'screen' ? 'page' : undefined}>
            画面共有
            {isSharing(course.id) && (
              <span class="live-dot">
                <span class="sr-only">配信中</span>
              </span>
            )}
          </a>
          {canManage && (
            <a
              href={`${base}/settings`}
              class={tab === 'settings' ? 'tab active' : 'tab'}
              aria-current={tab === 'settings' ? 'page' : undefined}
            >
              設定
            </a>
          )}
        </nav>
      )}
    </>
  )
}

export type CourseFormValues = Partial<Pick<Course, 'title' | 'code' | 'summary' | 'color' | 'enroll_key'>> & {
  visible?: boolean
}
export type CourseFormErrors = Partial<Record<'title' | 'code' | 'summary' | 'enroll_key', string>>

export const CourseForm = ({
  action,
  values,
  errors = {},
  submitLabel,
  cancelHref,
}: {
  action: string
  values: CourseFormValues
  errors?: CourseFormErrors
  submitLabel: string
  cancelHref: string
}) => (
  <form method="post" action={action} class="card stack course-form" data-loading-form>
    <div class="grid-2">
      <Field label="コース名" name="title" value={values.title} error={errors.title} required maxlength={120} placeholder="例：情報リテラシー入門" autofocus={!values.title} />
      <Field label="コースコード（任意）" name="code" value={values.code} error={errors.code} maxlength={30} placeholder="例：INFO101" hint="一覧やカードに表示される短い識別名" />
    </div>
    <TextArea label="概要" name="summary" value={values.summary} error={errors.summary} rows={3} placeholder="このコースで学べることを簡潔に" />

    <fieldset class="field">
      <legend>カラー</legend>
      <div class="swatches">
        {COURSE_COLORS.map((color) => (
          <label class={`swatch tone-${color}`} title={color}>
            <input type="radio" name="color" value={color} checked={(values.color ?? 'indigo') === color} />
            <span class="swatch-dot">
              <Icon name="check" size={14} />
            </span>
            <span class="sr-only">{color}</span>
          </label>
        ))}
      </div>
    </fieldset>

    <div class="grid-2">
      <Field
        label="登録キー（任意）"
        name="enroll_key"
        value={values.enroll_key ?? ''}
        error={errors.enroll_key}
        maxlength={50}
        hint="設定すると、キーを知っている人だけが自己登録できます"
        autocomplete="off"
      />
      <div class="field">
        <span class="label">公開設定</span>
        <label class="switch">
          <input type="checkbox" name="visible" value="1" checked={values.visible ?? true} />
          <span class="switch-track" />
          <span>コース一覧に公開する</span>
        </label>
        <p class="field-hint">オフにすると教師と管理者だけが閲覧できます</p>
      </div>
    </div>

    <div class="form-actions">
      <a href={cancelHref} class="btn btn-ghost">
        キャンセル
      </a>
      <button type="submit" class="btn btn-primary">
        {submitLabel}
      </button>
    </div>
  </form>
)

export const ItemIcon = ({ type }: { type: string }) => (
  <span class={`item-icon kind-${type}`}>
    <Icon name={type === 'link' ? 'link' : type === 'file' ? 'file' : 'page'} size={16} />
  </span>
)
