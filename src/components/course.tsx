import type { Child } from 'hono/jsx'
import { courseImageUrl, type CourseAccess } from '../lib/courses'
import { completionChoices } from '../lib/forms'
import { COMPLETION_LABELS, COMPLETIONS, COURSE_COLORS, type Completion, type Course, type ItemType } from '../lib/types'
import { Button } from './button'
import { Card } from './card'
import { cx } from './cx'
import { SegmentedControl, SelectField, TextAreaField, TextField, validateWith } from './form'
import { Icon, type IconName } from './icons'
import { Modal } from './overlay'
import { Breadcrumbs, CourseIcon, ProgressRing, Tabs, courseInitials, type TabItem } from './ui'
import { useStyle } from './style'

type Tab = 'content' | 'participants' | 'settings'

export const CourseHeader = ({
  access,
  tab,
  progress,
  actions,
}: {
  access: CourseAccess
  tab?: Tab
  progress?: { done: number; total: number }
  actions?: Child
}) => {
  useStyle('/src/components/course.css')
  const { course, canManage } = access
  const base = `/courses/${course.id}`
  const hero = courseImageUrl(course.id, 'hero', course.heroImage)
  return (
    <>
      <Breadcrumbs items={[{ href: '/courses', label: 'コース' }, { label: course.code || course.title }]} />
      {hero && <img class="course-hero-cover" src={hero} alt="" />}
      <section class={cx('course-hero', `tone-${course.color}`, hero && 'has-cover')}>
        <CourseIcon course={course} text={courseInitials(course)} class="course-hero-mono" />
        <div class="course-hero-body">
          <h1>{course.title}</h1>
          {course.summary && <p class="course-hero-summary">{course.summary}</p>}
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

export type CourseFormValues = Partial<Pick<Course, 'title' | 'code' | 'summary' | 'color' | 'completionEnabled'>>
export type CourseFormErrors = Partial<Record<'title' | 'code' | 'summary', string>>

const CourseFields = ({ values, errors = {} }: { values: CourseFormValues; errors?: CourseFormErrors }) => {
  useStyle('/src/components/course.css')
  return (
    <>
      <div class="grid-2">
        <TextField
          label="コース名"
          name="title"
          value={values.title}
          error={errors.title}
          placeholder="例：情報リテラシー入門"
          autofocus={!values.title}
        />
        <TextField
          label="コースコード（任意）"
          name="code"
          value={values.code}
          error={errors.code}
          placeholder="例：INFO101"
          hint="一覧やカードに表示される短い識別名"
        />
      </div>
      <TextAreaField
        label="概要"
        name="summary"
        value={values.summary}
        error={errors.summary}
        rows={3}
        placeholder="このコースで学べることを簡潔に"
      />

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
      <CourseCompletionField enabled={values.completionEnabled !== 0} />
    </>
  )
}

export const CourseForm = ({
  id,
  action,
  values,
  errors,
  submitLabel,
  cancelHref,
}: {
  id?: string
  action: string
  values: CourseFormValues
  errors?: CourseFormErrors
  submitLabel: string
  cancelHref: string
}) => (
  <Card as="form" id={id} method="post" action={action} class="stack course-form" data-loading-form {...validateWith('course')}>
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
      <form method="post" action="/courses" class="stack" data-loading-form {...validateWith('course')}>
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

export const CourseLiveSync = ({ courseId, revision }: { courseId: number; revision: string }) => (
  <span hidden data-live={`/courses/${courseId}/revision`} data-live-rev={revision} />
)

const COMPLETION_HINTS: Record<ItemType | 'any', string> = {
  page: '「開いたら完了」は、学生がこのページを開いたときに完了になります。',
  link: '「開いたら完了」は、学生がリンクを開いたときに完了になります。',
  file: '「開いたら完了」はプレビューを表示するかダウンロードしたとき、「最後まで再生したら完了」は動画・音声を最後まで再生したときに完了になります。',
  screen: '画面共有では「なし」か「学生が自分で完了にする」を選べます。',
  any: '「開いたら完了」はページ・リンク・ファイルで、「最後まで再生したら完了」は動画・音声のファイルで選べます。',
}

export const CompletionField = ({ type, id, value = 'none', error }: { type?: ItemType; id?: string; value?: string; error?: string }) => (
  <SelectField
    label="完了の条件"
    name="completion"
    id={id}
    options={(type ? completionChoices(type) : COMPLETIONS).map((c) => ({ value: c, label: COMPLETION_LABELS[c] }))}
    value={value}
    error={error}
    hint={COMPLETION_HINTS[type ?? 'any']}
  />
)

const COMPLETION_WAITING: Record<Exclude<Completion, 'none' | 'manual'>, Partial<Record<ItemType, string>>> = {
  view: { page: 'このページを開くと完了になります', link: 'リンクを開くと完了になります', file: 'ファイルを開くと完了になります' },
  play: { file: '最後まで再生すると完了になります' },
}

export const CompletionStatus = ({
  itemId,
  type,
  completion,
  done,
}: {
  itemId: number
  type: ItemType
  completion: Completion
  done: boolean
}) => {
  useStyle('/src/components/course.css')
  if (completion === 'none' || completion === 'manual') return null
  return (
    <p class={cx('completion-status', done && 'is-done')} data-complete-status={itemId}>
      <Icon name="check" size={16} />
      <span data-complete-label>{done ? '完了済み' : COMPLETION_WAITING[completion][type]}</span>
    </p>
  )
}

const CourseCompletionField = ({ enabled }: { enabled: boolean }) => (
  <fieldset class="field">
    <legend>完了ステータス</legend>
    <SegmentedControl
      name="completion_enabled"
      label="完了ステータス"
      options={[
        { value: '1', label: '使う', icon: 'check' },
        { value: '0', label: '使わない', icon: 'x' },
      ]}
      value={enabled ? '1' : '0'}
    />
    <p class="field-hint">使うと、アイテムごとに完了の条件を決めて、学生の進捗を表示します。</p>
  </fieldset>
)
