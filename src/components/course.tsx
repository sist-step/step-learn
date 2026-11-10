import type { Child } from 'hono/jsx'
import { courseImageUrl } from '../lib/course-images'
import type { CourseAccess } from '../lib/courses'
import { completionChoices } from '../lib/forms'
import {
  COMPLETION_LABELS,
  COMPLETIONS,
  COURSE_COLORS,
  LINK_TARGET_LABELS,
  LINK_TARGETS,
  type Completion,
  type Course,
  type ItemType,
  type LinkTarget,
} from '../lib/types'
import { Button } from './button'
import { Card } from './card'
import { cx } from './cx'
import { SegmentedControl, SelectField, Switch, TextAreaField, TextField, validateWith } from './form'
import { Icon, type IconName } from './icons'
import { Modal } from './overlay'
import { Breadcrumbs, Chip, CourseIcon, ProgressRing, Tabs, courseInitials, type Crumb, type TabItem } from './ui'
import { useStyle } from './style'

type Tab = 'content' | 'participants' | 'settings'

export const nextActionLabel = (done: number) => (done > 0 ? '続きから' : '学習を始める')

export const CourseHeader = ({
  access,
  tab,
  progress,
  actions,
  tabActions,
  editSwitch: showEditSwitch = true,
}: {
  access: CourseAccess
  tab?: Tab
  progress?: { done: number; total: number }
  actions?: Child
  tabActions?: Child
  editSwitch?: boolean
}) => {
  useStyle('/src/components/course.css')
  const { course, canManage } = access
  const base = `/courses/${course.id}`
  const hero = courseImageUrl(course.id, 'hero', course.heroImage)
  const editSwitch = showEditSwitch && tab === 'content' && canManage
  const compact = tab === 'participants' || tab === 'settings'
  return (
    <>
      <a href="/courses" class="back-link">
        <Icon name="chevronLeft" size={16} />
        コース一覧
      </a>
      {!compact && (hero ? <img class="course-hero-cover" src={hero} alt="" /> : <div class={`course-hero-cover tone-${course.color}`} />)}
      <section class={cx('course-hero', `tone-${course.color}`, compact && 'is-compact')}>
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
        <div class="course-tabs">
          <Tabs
            label="コースメニュー"
            items={(
              [
                { href: base, label: '教材', active: tab === 'content' },
                { href: `${base}/participants`, label: '参加者', active: tab === 'participants' },
                canManage && { href: `${base}/settings`, label: '設定', active: tab === 'settings' },
              ] satisfies (TabItem | false)[]
            ).filter((t) => t !== false)}
          />
          {(editSwitch || tabActions) && (
            <div class="course-tabs-actions">
              {editSwitch && <Switch class="course-edit-switch" icon="pencil" label="編集モード" checked={false} data-edit-mode-toggle />}
              {tabActions}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export type CourseFormValues = Partial<Pick<Course, 'title' | 'code' | 'summary' | 'color' | 'completionEnabled'>> & {
  startDate?: string
  endDate?: string
}
export type CourseFormErrors = Partial<Record<'title' | 'code' | 'summary' | 'start_date' | 'end_date', string>>

const COLOR_LABELS: Record<(typeof COURSE_COLORS)[number], string> = {
  cyan: 'シアン',
  indigo: 'インディゴ',
  sky: 'スカイ',
  emerald: 'エメラルド',
  amber: 'アンバー',
  rose: 'ローズ',
  violet: 'バイオレット',
  teal: 'ティール',
  slate: 'スレート',
}

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
      <div class="grid-2">
        <TextField
          label="開始日（任意）"
          name="start_date"
          type="date"
          value={values.startDate}
          error={errors.start_date}
          hint="空欄なら、開始前の期間を区切りません"
        />
        <TextField
          label="終了日（任意）"
          name="end_date"
          type="date"
          value={values.endDate}
          error={errors.end_date}
          hint="終了日を過ぎると、ダッシュボードやコース一覧の「進行中」に出なくなります"
        />
      </div>

      <fieldset class="field">
        <legend>カラー</legend>
        <div class="swatches">
          {COURSE_COLORS.map((color) => (
            <label class={`swatch tone-${color}`} title={COLOR_LABELS[color]}>
              <input type="radio" name="color" value={color} checked={(values.color ?? 'cyan') === color} />
              <span class="swatch-dot">
                <Icon name="check" size={14} />
              </span>
              <span class="sr-only">{COLOR_LABELS[color]}</span>
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
  heading,
  description,
}: {
  id?: string
  action: string
  values: CourseFormValues
  errors?: CourseFormErrors
  submitLabel: string
  cancelHref: string
  heading?: Child
  description?: Child
}) => (
  <Card
    as="form"
    id={id}
    method="post"
    action={action}
    class="stack course-form"
    heading={heading}
    description={description}
    data-loading-form
    {...validateWith('course')}
  >
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

export const ITEM_ICONS: Record<ItemType, IconName> = { page: 'page', link: 'link', file: 'file', screen: 'monitor', code: 'terminal' }

export const ItemIcon = ({ type }: { type: ItemType }) => {
  useStyle('/src/components/course.css')
  return (
    <span class={`item-icon kind-${type}`}>
      <Icon name={ITEM_ICONS[type]} size={16} />
    </span>
  )
}

/** アイテムを画面いっぱいに出すとき（PDF・コード）に、AppShell の topbar に渡す帯 */
export const ItemBar = ({
  type,
  crumbs,
  title,
  hiddenNote,
  children,
}: {
  type: ItemType
  crumbs: readonly Crumb[]
  title: string
  hiddenNote?: string
  children?: Child
}) => {
  useStyle('/src/components/course.css')
  return (
    <div class="item-bar">
      <ItemIcon type={type} />
      <div class="item-bar-text">
        <Breadcrumbs items={crumbs} />
        <h1 class="truncate" title={title}>
          {title}
        </h1>
      </div>
      {hiddenNote && (
        <Chip icon="eyeSlash" class="item-bar-hidden" title={hiddenNote}>
          非表示
        </Chip>
      )}
      <div class="item-bar-actions">{children}</div>
    </div>
  )
}

export const CourseLiveSync = ({ courseId, revision }: { courseId: number; revision: string }) => (
  <span hidden data-live={`/courses/${courseId}/revision`} data-live-rev={revision} />
)

export const LinkTargetField = ({
  id,
  value = 'new',
  hint = '埋め込むと、アイテムの画面の中にサイトを表示します。埋め込みを許可していないサイトは表示されません。',
  fieldClass,
}: {
  id?: string
  value?: string
  hint?: Child
  fieldClass?: string
}) => (
  <SelectField
    label="開き方"
    name="link_target"
    id={id}
    options={LINK_TARGETS.map((t) => ({ value: t, label: LINK_TARGET_LABELS[t] }))}
    value={value}
    hint={hint}
    fieldClass={fieldClass}
  />
)

/** リンクのアイテムを開く a 要素の属性。埋め込むものは、STEP Learn のアイテムの画面（itemHref）で開く */
export function linkOpenAttrs(url: string, target: LinkTarget, itemHref: string) {
  if (target === 'embed') return { href: itemHref }
  // 同じタブでも noreferrer を外さないのは、コースやアイテムの URL をリンク先のサイトに知らせないため
  if (target === 'same') return { href: url, rel: 'noreferrer' }
  return { href: url, target: '_blank', rel: 'noopener noreferrer', 'data-no-prefetch': '' }
}

// sandbox に allow-top-navigation を入れないのは、埋め込んだサイトが STEP Learn の画面ごと別のページへ移動させないため
export const LinkEmbed = ({ url, title }: { url: string; title: string }) => (
  <div class="link-embed">
    <iframe
      src={url}
      title={title}
      referrerpolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation"
      allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
      allowfullscreen
    />
    <p class="muted small">
      表示されないときは
      <a href={url} target="_blank" rel="noopener noreferrer" data-no-prefetch>
        新しいタブで開く
        <Icon name="external" size={12} />
      </a>
    </p>
  </div>
)

const COMPLETION_HINTS: Record<ItemType | 'any', string> = {
  page: '「開いたら完了」は、学生がこのページを開いたときに完了になります。',
  link: '「開いたら完了」は、学生がリンクを開いたときに完了になります。',
  file: '「開いたら完了」はプレビューを表示するかダウンロードしたとき、「最後まで再生したら完了」は動画・音声を最後まで再生したときに完了になります。',
  screen: '画面共有では「なし」か「学生が自分で完了にする」を選べます。',
  code: '「開いたら完了」は、学生がこのアイテムを開いたときに完了になります。',
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
  view: {
    page: 'このページを開くと完了になります',
    link: 'リンクを開くと完了になります',
    file: 'ファイルを開くと完了になります',
    code: 'このアイテムを開くと完了になります',
  },
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
