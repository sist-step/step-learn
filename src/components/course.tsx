import type { Child } from 'hono/jsx'
import type { CourseAccess } from '../lib/courses'
import { COURSE_COLORS, type Course, type ItemType } from '../lib/types'
import { Icon, type IconName } from './icons'
import { Field, ProgressRing, TextArea } from './ui'

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
  const { course, canManage } = access
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
      {tab && (
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

export type CourseFormValues = Partial<Pick<Course, 'title' | 'code' | 'summary' | 'color'>>
export type CourseFormErrors = Partial<Record<'title' | 'code' | 'summary', string>>

const CourseFields = ({ values, errors = {} }: { values: CourseFormValues; errors?: CourseFormErrors }) => (
  <>
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
  <form method="post" action={action} class="card stack course-form" data-loading-form>
    <CourseFields values={values} errors={errors} />
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

const CREATE_COURSE_MODAL = 'create-course'

// <dialog> を使わないのは、外側のクリックで閉じる処理や開くための showModal() を client.ts に書かずに済ませるため
export const CreateCourseButton = () => (
  <>
    <button type="button" class="btn btn-primary" popovertarget={CREATE_COURSE_MODAL}>
      <Icon name="plus" /> コースを作成
    </button>
    <div id={CREATE_COURSE_MODAL} popover="auto" class="modal" role="dialog" aria-labelledby={`${CREATE_COURSE_MODAL}-title`}>
      <form method="post" action="/courses" class="stack" data-loading-form>
        <div class="modal-head">
          <div>
            <h2 id={`${CREATE_COURSE_MODAL}-title`}>コースを作成</h2>
            <p class="muted small">作成後に参加者タブから教師と学生を追加します。基本情報はあとからいつでも変更できます。</p>
          </div>
          <button type="button" class="icon-btn" popovertarget={CREATE_COURSE_MODAL} popovertargetaction="hide" aria-label="閉じる" title="閉じる">
            <Icon name="x" />
          </button>
        </div>
        <CourseFields values={{}} />
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" popovertarget={CREATE_COURSE_MODAL} popovertargetaction="hide">
            キャンセル
          </button>
          <button type="submit" class="btn btn-primary">
            コースを作成
          </button>
        </div>
      </form>
    </div>
  </>
)

const ITEM_ICONS: Record<ItemType, IconName> = { page: 'page', link: 'link', file: 'file', screen: 'monitor' }

export const ItemIcon = ({ type }: { type: ItemType }) => (
  <span class={`item-icon kind-${type}`}>
    <Icon name={ITEM_ICONS[type]} size={16} />
  </span>
)
