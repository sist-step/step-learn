import { CourseHeader, CourseLiveSync, ItemIcon, LinkEmbed, LinkTargetField, linkOpenAttrs } from '../components/course'
import { Button, IconButton } from '../components/button'
import { Card, DangerRow, LinkCard } from '../components/card'
import { cx } from '../components/cx'
import {
  FileChip,
  FileField,
  FileInput,
  FormField,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
  validateWith,
} from '../components/form'
import { Icon, type IconName } from '../components/icons'
import { AppShell, AuthShell } from '../components/layout'
import { Markdown } from '../components/markdown'
import { MenuItem, Modal, Popover } from '../components/overlay'
import { PdfBar, PdfStage } from '../components/pdf'
import { Styles, useStyle } from '../components/style'
import { Alert, Breadcrumbs, Chip, EmptyState, TabPanel } from '../components/ui'
import type { CourseAccess } from '../lib/courses'
import type { FieldErrors } from '../lib/forms'
import { unixToDateTimeInput } from '../lib/course-period'
import { previewKind } from '../lib/preview'
import { formatBytes } from '../lib/bytes'
import { MAX_FILE_SIZE } from '../lib/storage'
import { MOODLE_DISPLAY_LABELS, isExactDisplay } from '../moodle/display'
import { extraKindOf, type ExtraKind, type ExtraKindEntry } from './extra-kinds'
import type { CourseLayout, ItemCompletion, MItem, MSection, Restriction, TilesLayout, TopcollLayout } from './mapping'
import { PREVIOUS_ITEM, isOpenable, isTracked, sectionHref } from './mapping'
import { TileArt } from './tile-art'

// ---------------------------------------------------------------- ログイン

export const LoginPage = ({ next = '', error }: { next?: string; error?: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <div class="stack">
        {error && <Alert>{error}</Alert>}
        <p class="muted">旧STEP Learn のアカウントでログインできます</p>
        {/* 再読み込みなしの遷移にしないのは、Moodle（別オリジン）のログイン画面に移り、fetch では追えないため */}
        <form method="post" action="/auth/moodle/start" data-reload>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="primary" size="lg" block iconEnd="external">
            旧STEP Learnでログイン
          </Button>
        </form>
      </div>
    </div>
  </AuthShell>
)

// ---------------------------------------------------------------- コースページ

const COMPLETION_LABELS: Record<ItemCompletion, string> = {
  none: 'なし',
  manual: '学生が自分で完了にする',
  view: '開いたら完了',
  auto: '旧STEP Learn の条件で完了',
}

const hostOf = (url: string) => URL.parse(url)?.host ?? url

const kindOfItem = (it: MItem) => (it.extra ? extraKindOf(it.extra.type) : null)

const ExtraIcon = ({ kind }: { kind: ExtraKind | null }) => {
  useStyle('/src/components/course.css', '/src/moodle-mode/moodle-mode.css')
  return (
    <span class="item-icon kind-extra">
      <Icon name={kind?.icon ?? 'academicCap'} size={16} />
    </span>
  )
}

const KindIcon = ({ item }: { item: MItem }) => {
  if (item.kind === 'link' || item.kind === 'file') return <ItemIcon type={item.kind} />
  if (item.kind === 'extra' && !item.locked) return <ExtraIcon kind={kindOfItem(item)} />
  useStyle('/src/components/course.css', '/src/moodle-mode/moodle-mode.css')
  return (
    <span class="item-icon kind-moodle">
      <Icon name={item.locked ? 'lock' : 'academicCap'} size={16} />
    </span>
  )
}

const hasEditPage = (it: MItem) => it.kind === 'link' || it.kind === 'file' || (it.kind === 'extra' && !!it.extra)

const isPdf = (it: MItem) => it.kind === 'file' && previewKind(it.fileType, it.fileName) === 'pdf'

const tabPathOf = (it: MItem) => kindOfItem(it)?.tabPath ?? null

/** アイテムを開く a 要素の属性 */
function openAttrs(courseId: number, it: MItem) {
  const page = `/courses/${courseId}/items/${it.id}`
  if (it.kind === 'link') return linkOpenAttrs(it.url, it.linkTarget, page)
  const newTab = { target: '_blank', rel: 'noopener', 'data-no-prefetch': '' }
  if (it.kind === 'moodle') return { href: it.url, ...newTab }
  const tabPath = tabPathOf(it)
  if (tabPath) return { href: `${page}/${tabPath}`, ...newTab }
  return isPdf(it) ? { href: page, ...newTab } : { href: page }
}

const leavesPage = (it: MItem) => it.kind === 'moodle' || (it.kind === 'link' && it.linkTarget !== 'embed') || isPdf(it) || !!tabPathOf(it)

const completesOnOpen = (it: MItem) =>
  ((it.kind === 'link' && it.linkTarget !== 'embed') || !!tabPathOf(it)) && it.completion === 'view' && !it.done

const HiddenChip = () => <Chip icon="eyeSlash">学生に非表示</Chip>

/** 教師に見せるアクセス制限。条件を満たした学生には Moodle が制限を返さないので、学生には locked のときの restriction を出す */
const RestrictionNote = ({ rule, class: cls }: { rule: Restriction; class?: string }) => {
  useStyle('/src/moodle-mode/moodle-mode.css')
  return (
    <span class={cx('section-restriction muted small', cls)}>
      <Icon name="lock" size={14} />
      <span>{rule.text || 'アクセス制限あり'}</span>
    </span>
  )
}

const RowMenu = ({ base, hidden, confirm, restriction }: { base: string; hidden: boolean; confirm: string; restriction: string }) => (
  <Popover class="row-menu" panelClass="row-menu-panel" trigger={<IconButton as="summary" icon="ellipsis" label="その他の操作" />}>
    <form method="post" action={`${base}/move`}>
      <input type="hidden" name="dir" value="up" />
      <MenuItem type="submit" icon="arrowUp">
        上へ移動
      </MenuItem>
    </form>
    <form method="post" action={`${base}/move`}>
      <input type="hidden" name="dir" value="down" />
      <MenuItem type="submit" icon="arrowDown">
        下へ移動
      </MenuItem>
    </form>
    <div class="menu-sep" role="separator" />
    <form method="post" action={`${base}/visibility`}>
      <input type="hidden" name="hidden" value={hidden ? '0' : '1'} />
      <MenuItem type="submit" icon={hidden ? 'eye' : 'eyeSlash'}>
        {hidden ? '学生に表示する' : '学生に非表示にする'}
      </MenuItem>
    </form>
    <MenuItem href={restriction} icon="lock">
      アクセス制限
    </MenuItem>
    <div class="menu-sep" role="separator" />
    <form method="post" action={`${base}/delete`} data-confirm={confirm}>
      <MenuItem type="submit" icon="trash" class="is-danger">
        削除
      </MenuItem>
    </form>
  </Popover>
)

const CompleteCheck = ({ item, base, manage }: { item: MItem; base: string; manage: boolean }) =>
  item.completion === 'manual' ? (
    <form method="post" action={`${base}/complete`} class={manage ? 'view-only' : undefined} data-complete>
      <button
        type="submit"
        class="check"
        aria-pressed={item.done ? 'true' : 'false'}
        aria-label={item.done ? '未完了に戻す' : '完了にする'}
        title={item.done ? '完了済み' : '完了にする'}
        disabled={item.locked}
      >
        <Icon name="check" size={14} />
      </button>
    </form>
  ) : (
    <span
      class="check check-auto"
      role="img"
      aria-label={item.done ? '完了済み' : COMPLETION_LABELS[item.completion]}
      title={item.done ? '完了済み' : COMPLETION_LABELS[item.completion]}
      data-complete-check={item.id}
      data-done={item.done ? 'true' : 'false'}
    >
      <Icon name="check" size={14} />
    </span>
  )

const ItemRow = ({ item, courseId, isStudent, manage }: { item: MItem; courseId: number; isStudent: boolean; manage: boolean }) => {
  const base = `/courses/${courseId}/items/${item.id}`
  const tracked = isTracked(item)
  const actions = manage && (
    <div class="row-actions edit-only">
      {hasEditPage(item) && <IconButton href={`${base}/edit`} icon="pencil" label="編集" />}
      <RowMenu base={base} hidden={item.hidden} confirm={`「${item.title}」を削除しますか？`} restriction={`${base}/restriction`} />
    </div>
  )
  if (item.kind === 'label') {
    return (
      <li class={cx('item-row item-label', item.hidden && 'is-hidden edit-only')} data-item={item.id}>
        <div class="item-text">
          {item.body ? <Markdown source={item.body} /> : <span class="muted">{item.title}</span>}
          {manage && item.rule && <RestrictionNote rule={item.rule} class="item-restriction" />}
        </div>
        {item.hidden && <HiddenChip />}
        {actions}
      </li>
    )
  }
  const meta = item.locked
    ? item.restriction || 'まだ開けません'
    : item.kind === 'link'
      ? hostOf(item.url)
      : item.kind === 'file'
        ? `${item.fileName} · ${formatBytes(item.fileSize)}`
        : item.kind === 'extra'
          ? (kindOfItem(item)?.label ?? 'コピー元のコースでだけ使えます')
          : item.url
            ? '旧STEP Learnで開く'
            : ''
  const linkless = item.locked || !isOpenable(item)
  const body = (
    <>
      <KindIcon item={item} />
      <span class="item-text">
        <span class="item-title">{item.title}</span>
        <span class="item-meta truncate">{meta}</span>
        {manage && item.rule && <RestrictionNote rule={item.rule} class="item-restriction" />}
      </span>
      {item.hidden && <HiddenChip />}
      {manage && tracked && (
        <Chip icon="check" class="edit-only">
          {COMPLETION_LABELS[item.completion]}
        </Chip>
      )}
      {item.extra?.live && <Chip tone="live">配信中</Chip>}
      {!linkless &&
        (leavesPage(item) ? <Icon name="external" size={14} class="item-ext" /> : <Icon name="chevronRight" size={16} class="item-ext" />)}
    </>
  )
  return (
    <li
      class={cx('item-row', tracked && item.done && 'is-done', item.hidden && 'is-hidden edit-only', item.locked && 'is-locked')}
      data-item={item.id}
    >
      {linkless ? (
        <span class="item-link">{body}</span>
      ) : (
        <a
          class="item-link"
          {...openAttrs(courseId, item)}
          {...(isStudent && completesOnOpen(item) ? { 'data-complete-on-open': `${base}/complete` } : {})}
        >
          {body}
        </a>
      )}
      {actions}
      {isStudent && tracked && <CompleteCheck item={item} base={base} manage={manage} />}
    </li>
  )
}

const AddItemButton = ({ sectionId }: { sectionId: number }) => (
  <button type="button" class="add-item edit-only" popovertarget={ADD_ITEM_MODAL} data-add-item-section={sectionId}>
    <Icon name="plus" size={16} /> アイテムを追加
  </button>
)

const SubsectionRow = ({
  item,
  contents,
  courseId,
  isStudent,
  manage,
}: {
  item: MItem
  contents: MItem[]
  courseId: number
  isStudent: boolean
  manage: boolean
}) => {
  const shown = contents.filter((it) => !it.hidden).length
  return (
    <li
      class={cx('item-subsection', item.hidden && 'is-hidden edit-only', item.locked && 'is-locked')}
      id={`section-${item.childSectionId}`}
    >
      <div class="item-row subsection-head" data-item={item.id}>
        <span class="item-link">
          <span class="item-icon kind-subsection">
            <Icon name={item.locked ? 'lock' : 'folder'} size={16} />
          </span>
          <span class="item-text">
            <span class="item-title">{item.title}</span>
            <span class="item-meta truncate">{item.locked ? item.restriction || 'まだ開けません' : `${shown} アイテム`}</span>
            {manage && item.rule && <RestrictionNote rule={item.rule} class="item-restriction" />}
          </span>
          {item.hidden && <HiddenChip />}
        </span>
        {manage && (
          <div class="row-actions edit-only">
            <RowMenu
              base={`/courses/${courseId}/items/${item.id}`}
              hidden={item.hidden}
              confirm={`サブセクション「${item.title}」と中のアイテムをすべて削除しますか？`}
              restriction={`/courses/${courseId}/sections/${item.childSectionId}/restriction`}
            />
          </div>
        )}
      </div>
      {contents.length > 0 && (
        <ul class="items subsection-items">
          {contents.map((it) => (
            <ItemRow item={it} courseId={courseId} isStudent={isStudent} manage={manage} />
          ))}
        </ul>
      )}
      {manage && item.childSectionId && <AddItemButton sectionId={item.childSectionId} />}
    </li>
  )
}

const ADD_ITEM_MODAL = 'add-item'
const ADD_SECTION_MODAL = 'add-section'

const sectionOptions = (sections: MSection[]) => {
  const titles = new Map(sections.map((s) => [s.id, s.title]))
  return sections.map((s) => ({ value: String(s.id), label: s.parentId ? `${titles.get(s.parentId)} › ${s.title}` : s.title }))
}

const KIND_DESCRIPTIONS = { link: '外部のサイトを紹介する', file: 'PDF や画像などを配る' } as const
const KINDS = ['link', 'file'] as const

const KindOptionBody = ({ type }: { type: (typeof KINDS)[number] }) => (
  <>
    <ItemIcon type={type} />
    <span class="kind-option-text">
      <span class="strong">{type === 'link' ? 'リンク' : 'ファイル'}</span>
      <span class="muted small">{KIND_DESCRIPTIONS[type]}</span>
    </span>
  </>
)

const ExtraOptionBody = ({ kind }: { kind: ExtraKind }) => (
  <>
    <ExtraIcon kind={kind} />
    <span class="kind-option-text">
      <span class="strong">{kind.label}</span>
      <span class="muted small">{kind.description}</span>
    </span>
  </>
)

const CHOICES = ['none', 'manual', 'view'] as const

export const MoodleCompletionField = ({ id, value = 'none', error }: { id?: string; value?: string; error?: string }) => (
  <SelectField
    label="完了の条件"
    name="completion"
    id={id}
    options={CHOICES.map((c) => ({ value: c, label: COMPLETION_LABELS[c] }))}
    value={value}
    error={error}
    hint="「開いたら完了」は、学生がリンクやファイルを開いたときに完了になります。変えると、学生の完了の記録は消えます。"
  />
)

// 課題などをここで追加できるようにしないのは、Moodle の活動の設定項目が多く、Moodle の編集画面で作るほうが確実なため
const AddItemModal = ({
  courseId,
  sections,
  tracking,
  kinds,
}: {
  courseId: number
  sections: MSection[]
  tracking: boolean
  kinds: ExtraKindEntry[]
}) => (
  <Modal
    id={ADD_ITEM_MODAL}
    heading="アイテムを追加"
    description="リンクとファイルを追加できます。課題や小テストは旧STEP Learn の画面で追加してください。"
  >
    <form
      method="post"
      action={`/courses/${courseId}/items`}
      enctype="multipart/form-data"
      class="item-form item-steps"
      data-loading-form
      data-item-steps
      data-step="kind"
      data-kind="link"
      {...validateWith('item')}
    >
      <input type="hidden" name="type" value="link" />
      <div class="item-step kind-picker" role="group" aria-label="種類">
        {KINDS.map((t) => (
          <button type="button" class="kind-option" data-pick-kind={t}>
            <KindOptionBody type={t} />
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
        {kinds.map(([t, kind]) => (
          <button type="button" class="kind-option" data-pick-kind={t} data-kind-validate={kind.form}>
            <ExtraOptionBody kind={kind} />
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
      </div>
      <div class="item-step kind-settings stack">
        <div class="kind-summary">
          {KINDS.map((t) => (
            <span class="kind-summary-body" data-kind-summary={t}>
              <KindOptionBody type={t} />
            </span>
          ))}
          {kinds.map(([t, kind]) => (
            <span class="kind-summary-body" data-kind-only={t} hidden>
              <ExtraOptionBody kind={kind} />
            </span>
          ))}
          <Button size="sm" variant="ghost" icon="chevronLeft" data-kind-back>
            種類を変える
          </Button>
        </div>
        <TextField label="タイトル" name="title" id="new-item-title" placeholder="例：第1回 講義資料" />
        <TextField label="URL" name="url" id="new-item-url" type="url" placeholder="https://" fieldClass="when-link" />
        <LinkTargetField id="new-item-link-target" fieldClass="when-link" />
        <FileField
          label="ファイル"
          name="file"
          id="new-item-file"
          hint={`最大 ${formatBytes(MAX_FILE_SIZE)}。PDF・画像はブラウザでプレビューできます。`}
          fieldClass="when-file"
        />
        {kinds.map(([t, kind]) => (
          <fieldset class="stack" data-kind-only={t} hidden disabled>
            <kind.Fields values={{}} errors={{}} idPrefix={`new-${t}`} />
            {kind.addNote && <p class="muted small">{kind.addNote}</p>}
          </fieldset>
        ))}
        <div class="grid-2">
          <SelectField label="セクション" name="section_id" id="new-item-section" options={sectionOptions(sections)} />
          <fieldset class="field">
            <legend>学生への表示</legend>
            <SegmentedControl
              name="hidden"
              label="学生への表示"
              options={[
                { value: '0', label: '表示', icon: 'eye' },
                { value: '1', label: '非表示', icon: 'eyeSlash' },
              ]}
            />
          </fieldset>
        </div>
        {tracking && <MoodleCompletionField id="new-item-completion" />}
        <div class="form-actions">
          <Button type="submit" name="then" value="view" class="unless-bundle">
            追加して表示
          </Button>
          <Button type="submit" variant="primary">
            追加
          </Button>
        </div>
      </div>
    </form>
  </Modal>
)

const AddSectionModal = ({ courseId }: { courseId: number }) => (
  <Modal id={ADD_SECTION_MODAL} heading="セクションを追加" description="コースの最後に追加されます。">
    <form
      method="post"
      action={`/courses/${courseId}/sections`}
      class="stack"
      data-loading-form
      data-add-section
      {...validateWith('section')}
    >
      <TextField label="セクション名" name="title" id="new-section-title" placeholder="例：第2週 データの扱い方" autofocus />
      <div class="form-actions">
        <Button variant="ghost" popovertarget={ADD_SECTION_MODAL} popovertargetaction="hide">
          キャンセル
        </Button>
        <Button type="submit" variant="primary">
          追加
        </Button>
      </div>
    </form>
  </Modal>
)

const SectionEditBar = ({ courseId, section }: { courseId: number; section: MSection }) => {
  const base = `/courses/${courseId}/sections/${section.id}`
  return (
    <div class="row-actions edit-only">
      <Popover trigger={<IconButton as="summary" icon="pencil" label="セクションを編集" title="編集" />}>
        <form method="post" action={base} class="stack" {...validateWith('section')}>
          <TextField label="セクション名" name="title" id={`st-${section.id}`} value={section.title} />
          <TextAreaField label="説明" name="summary" id={`ss-${section.id}`} value={section.summary || undefined} rows={3} />
          <div class="form-actions">
            <Button type="submit" variant="primary" size="sm">
              保存
            </Button>
          </div>
        </form>
      </Popover>
      {/* 一般（0 番）のセクションを動かしたり消したりさせないのは、Moodle では必ず先頭にあるため */}
      {section.number > 0 && (
        <RowMenu
          base={base}
          hidden={section.hidden}
          confirm={`セクション「${section.title}」と中のアイテムをすべて削除しますか？`}
          restriction={`${base}/restriction`}
        />
      )}
    </div>
  )
}

const courseOutline = (sections: MSection[], items: MItem[], layout: CourseLayout) => {
  const bySection = new Map<number, MItem[]>()
  for (const it of items) bySection.set(it.sectionId, [...(bySection.get(it.sectionId) ?? []), it])
  const childrenOf = (it: MItem) => (it.childSectionId ? (bySection.get(it.childSectionId) ?? []) : [])
  const topSections = sections.filter((s) => !s.parentId)
  const hiddenSubsections = new Set(sections.filter((s) => s.parentId && s.hidden).map((s) => s.id))
  const isShown = (it: MItem) => !it.hidden && !hiddenSubsections.has(it.sectionId)
  const contentsOf = (sectionId: number) =>
    (bySection.get(sectionId) ?? []).flatMap((it) => (it.kind === 'subsection' ? childrenOf(it) : [it]))
  const visibleSections = topSections.filter((s) => !s.hidden)
  // 学生にも同じ番号で見えるよう、表示しているセクションだけで数える。タイルと折りたたみ型トピックで一般セクションを数えないのは、Moodle の画面の「トピック 1」などと番号をそろえるため
  const numbered = layout.kind === 'list' ? visibleSections : visibleSections.filter((s) => s.number !== 0)
  const sectionNumber = new Map(numbered.map((s, i) => [s.id, String(i + 1).padStart(2, '0')]))
  const statsOf = (sectionId: number) => {
    const contents = contentsOf(sectionId)
    const shown = contents.filter(isShown)
    const tracked = shown.filter(isTracked)
    return { contents, shown, tracked, done: tracked.filter((it) => it.done).length }
  }
  return { bySection, childrenOf, topSections, isShown, contentsOf, visibleSections, sectionNumber, statsOf }
}

type CourseOutline = ReturnType<typeof courseOutline>

type CardOptions = {
  open?: boolean
  /** 開閉できない（タイルのセクションの画面と、折りたたみ型トピックの一般セクション） */
  fixed?: boolean
  /** 同時に 1 つだけ開くセクションの組（details の name） */
  group?: string
  current?: boolean
  summaryInHead?: boolean
  subtiles?: boolean
  /** タイルの下に開いたセクションの閉じるボタン */
  closable?: boolean
}

const SectionCard = ({
  s,
  o,
  courseId,
  isStudent,
  manage,
  options = {},
}: {
  s: MSection
  o: CourseOutline
  courseId: number
  isStudent: boolean
  manage: boolean
  options?: CardOptions
}) => {
  const list = o.bySection.get(s.id) ?? []
  const { contents, shown, tracked, done } = o.statsOf(s.id)
  const hiddenCount = contents.length - shown.length
  const locked = !manage && s.locked
  const empty = !manage && !locked && shown.length === 0
  const emptyView = manage && shown.length === 0
  const { open = true, fixed = false, group, current = false, summaryInHead = false, subtiles = false, closable = false } = options
  return (
    <details
      class={cx(
        'section-card',
        s.hidden && 'is-hidden edit-only',
        (empty || locked) && 'is-empty',
        locked && 'is-locked',
        emptyView && 'is-empty-view',
        fixed && 'is-fixed',
        current && 'is-current',
      )}
      id={`section-${s.id}`}
      open={open}
      name={group}
      data-section={s.id}
    >
      <summary class="section-head" tabindex={fixed ? -1 : undefined}>
        <span class="section-num">{o.sectionNumber.get(s.id) ?? <Icon name={s.number === 0 ? 'home' : 'eyeSlash'} size={14} />}</span>
        <span class="section-title-wrap">
          <span class="section-title">{s.title}</span>
          {locked && (
            <span class="section-restriction muted small">
              <Icon name="lock" size={14} />
              <span>{s.restriction || 'まだ開けません'}</span>
            </span>
          )}
          {!empty && !locked && (
            <span class="muted small">
              {emptyView && <span class="view-only">{hiddenCount > 0 ? `非表示 ${hiddenCount}` : 'アイテムなし'}</span>}
              <span class={emptyView ? 'edit-only' : undefined}>{`${shown.length} アイテム`}</span>
              {isStudent && tracked.length > 0 && ` · ${done} 完了`}
              {hiddenCount > 0 && <span class="edit-only">{` · 非表示 ${hiddenCount}`}</span>}
            </span>
          )}
          {manage && s.rule && <RestrictionNote rule={s.rule} />}
          {summaryInHead && s.summary && <span class="section-head-summary">{s.summary}</span>}
        </span>
        {current && <Chip tone="accent">現在のセクション</Chip>}
        {empty && <Chip>準備中</Chip>}
        {s.hidden && <HiddenChip />}
        {isStudent && tracked.length > 0 && done === tracked.length && (
          <Chip tone="success" icon="check">
            完了
          </Chip>
        )}
        {!fixed && <Icon name="chevronDown" class="section-caret" />}
        {closable && <IconButton icon="x" label="閉じる" class="section-close" data-tile-close />}
      </summary>
      {manage && <SectionEditBar courseId={courseId} section={s} />}
      {!summaryInHead && s.summary && <p class="section-summary">{s.summary}</p>}
      {list.length > 0 && (
        <ul class={cx('items', subtiles && 'is-subtiles')}>
          {list.map((it) =>
            it.kind === 'subsection' ? (
              <SubsectionRow item={it} contents={o.childrenOf(it)} courseId={courseId} isStudent={isStudent} manage={manage} />
            ) : (
              <ItemRow item={it} courseId={courseId} isStudent={isStudent} manage={manage} />
            ),
          )}
        </ul>
      )}
      {manage && <AddItemButton sectionId={s.id} />}
    </details>
  )
}

type SectionsProps = { o: CourseOutline; courseId: number; isStudent: boolean; manage: boolean }

const ListSections = ({ o, ...rest }: SectionsProps) => (
  <div class="sections">
    {o.topSections.map((s) => (
      <SectionCard s={s} o={o} {...rest} />
    ))}
  </div>
)

const TopcollSections = ({ o, layout, ...rest }: SectionsProps & { layout: TopcollLayout }) => {
  const general = o.topSections.find((s) => s.number === 0)
  const byId = new Map(o.topSections.map((s) => [s.id, s]))
  // 教師に Moodle の並べ方を使わないのは、「最新の週を先頭に」などでは未来のセクションが外れ、編集できなくなるため（Moodle でも編集中はそのまま並ぶ）
  const toggles = rest.manage ? o.topSections.filter((s) => s.number !== 0) : layout.order.flatMap((sid) => byId.get(sid) ?? [])
  const collapsed = new Set(layout.collapsed)
  const firstOpen = layout.oneSection ? (toggles.find((s) => s.id === layout.current) ?? toggles.find((s) => !collapsed.has(s.id))) : null
  const isOpen = (s: MSection) => (layout.oneSection ? s.id === firstOpen?.id : !collapsed.has(s.id))
  const shownCount = toggles.filter((s) => !s.hidden).length
  return (
    <div class="stack">
      {general && <SectionCard s={general} o={o} {...rest} options={{ fixed: true }} />}
      {layout.toggleAll && !layout.oneSection && shownCount > 1 && (
        <div class="section-toggles">
          <Button size="sm" variant="ghost" icon="chevronDown" data-sections-toggle="open">
            すべて開く
          </Button>
          <Button size="sm" variant="ghost" icon="chevronRight" data-sections-toggle="close">
            すべて閉じる
          </Button>
        </div>
      )}
      <div
        class={cx('sections', layout.columns > 1 && `sections-cols-${layout.columns}`)}
        data-collapse-url={layout.persistent ? `/courses/${rest.courseId}/sections/collapse` : undefined}
      >
        {toggles.map((s) => (
          <SectionCard
            s={s}
            o={o}
            {...rest}
            options={{
              open: isOpen(s),
              group: layout.oneSection ? `topcoll-${rest.courseId}` : undefined,
              current: s.id === layout.current,
              summaryInHead: layout.summaryWhenCollapsed,
            }}
          />
        ))}
      </div>
    </div>
  )
}

const tileHref = (courseId: number, s: MSection) => `/courses/${courseId}?section=${s.id}`

const TileCard = ({
  s,
  o,
  layout,
  courseId,
  isStudent,
  open,
  index,
}: {
  s: MSection
  o: CourseOutline
  layout: TilesLayout
  courseId: number
  isStudent: boolean
  open: boolean
  index: number
}) => {
  const tile = layout.tiles.get(s.id)
  const { shown, tracked, done } = o.statsOf(s.id)
  const locked = s.locked && isStudent
  const empty = isStudent && shown.length === 0
  const progress = isStudent && tracked.length > 0 ? layout.progress : 'none'
  const pct = tracked.length ? Math.round((done / tracked.length) * 100) : 0
  const complete = tracked.length > 0 && done === tracked.length
  const showPct = progress === 'percent' && !locked
  const body = (
    <>
      <span class="sec-tile-media">
        {tile?.photo ? (
          <img src={`/courses/${courseId}/sections/${s.id}/photo/${encodeURIComponent(tile.photo)}`} alt="" loading="lazy" />
        ) : (
          <TileArt index={index} seed={s.id} />
        )}
        <span class="sec-tile-num">{o.sectionNumber.get(s.id) ?? <Icon name="eyeSlash" size={12} />}</span>
        {locked ? (
          <span class="sec-tile-badge is-locked">
            <Icon name="lock" size={14} />
          </span>
        ) : isStudent ? (
          complete && (
            <span class="sec-tile-badge is-done" role="img" aria-label="完了">
              <Icon name="check" size={14} />
            </span>
          )
        ) : (
          s.rule && (
            <span class="sec-tile-badge is-locked" role="img" aria-label={s.rule.text} title={s.rule.text}>
              <Icon name="lock" size={14} />
            </span>
          )
        )}
      </span>
      <span class="sec-tile-body">
        <span class="sec-tile-title">{s.title}</span>
        {s.hidden && <HiddenChip />}
        <span class="sec-tile-meta">
          <span class="truncate">
            {locked
              ? s.restriction || 'まだ開けません'
              : empty
                ? '準備中'
                : progress === 'fraction'
                  ? `${done} / ${tracked.length} 完了`
                  : `${shown.length} アイテム`}
          </span>
          {showPct && pct > 0 && <span class="sec-tile-pct">{pct}%</span>}
        </span>
      </span>
      {showPct && (
        <span class="sec-tile-progress" role="img" aria-label={`${pct}% 完了`}>
          <span style={`--w:${pct}%`} />
        </span>
      )}
    </>
  )
  return (
    <li class={cx('sec-tile-cell', s.hidden && 'edit-only')} id={`tile-${s.id}`}>
      {locked || empty ? (
        <span class={cx('sec-tile', locked && 'is-locked', empty && 'is-empty')}>{body}</span>
      ) : (
        <a
          href={tileHref(courseId, s)}
          class={cx('sec-tile', s.hidden && 'is-hidden', isStudent && complete && 'is-done')}
          data-tile={s.id}
          data-no-prefetch
          aria-expanded={String(open)}
          aria-controls={`tile-panel-${s.id}`}
        >
          {body}
        </a>
      )}
    </li>
  )
}

// 開いたセクションをタイルの直後に置くのは、grid-auto-flow: dense で同じ行の残りのタイルを前に詰め、パネルをその行のすぐ下に出すため（列数に合わせて差し込む位置を JS で計算しなくて済む）
const TilesSections = ({ o, layout, openSection, ...rest }: SectionsProps & { layout: TilesLayout; openSection?: number }) => {
  const general = o.topSections.find((s) => s.number === 0)
  const tiles = o.topSections.filter((s) => s.number !== 0)
  const openable = (s: MSection) => !rest.isStudent || (!s.locked && o.statsOf(s.id).shown.length > 0)
  return (
    <div class="stack">
      {general && <SectionCard s={general} o={o} {...rest} options={{ fixed: true, subtiles: layout.subtilesZero }} />}
      {tiles.length > 0 && (
        <ul class="sec-tiles">
          {tiles.flatMap((s, index) => {
            const open = s.id === openSection && openable(s)
            const tile = (
              <TileCard s={s} o={o} layout={layout} courseId={rest.courseId} isStudent={rest.isStudent} open={open} index={index} />
            )
            if (!openable(s)) return [tile]
            return [
              tile,
              <li class={cx('sec-tile-panel', s.hidden && 'edit-only')} id={`tile-panel-${s.id}`} hidden={!open}>
                <SectionCard s={s} o={o} {...rest} options={{ fixed: true, subtiles: layout.subtiles, closable: true }} />
              </li>,
            ]
          })}
        </ul>
      )}
    </div>
  )
}

export const CoursePage = ({
  access,
  sections,
  items,
  layout,
  extraKinds,
  openSection,
  revision,
  moodleCourseUrl,
}: {
  access: CourseAccess
  sections: MSection[]
  items: MItem[]
  layout: CourseLayout
  /** アイテムを追加するときに選べる、リンクとファイル以外の種類 */
  extraKinds: ExtraKindEntry[]
  /** タイルで開いているセクション */
  openSection?: number
  revision: string
  moodleCourseUrl: string
}) => {
  const id = access.course.id
  const manage = access.canManage
  const isStudent = access.role === 'student'
  const tracking = !!access.course.completionEnabled

  const o = courseOutline(sections, items, layout)
  const shownItems = o.visibleSections.flatMap((s) => o.contentsOf(s.id).filter(o.isShown))
  const trackedItems = shownItems.filter(isTracked)
  const doneCount = trackedItems.filter((it) => it.done).length
  const props = { o, courseId: id, isStudent, manage }

  return (
    <AppShell editable={manage} tone={access.course.color}>
      <Styles use={['/src/routes/courses/courses.css', '/src/moodle-mode/moodle-mode.css']} />
      <CourseHeader
        access={access}
        tab="content"
        editSwitch={false}
        progress={isStudent ? { done: doneCount, total: trackedItems.length } : undefined}
        tabActions={
          <>
            <Button href={moodleCourseUrl} variant="ghost" icon="external" target="_blank" rel="noopener" data-no-prefetch>
              旧STEP Learnで開く
            </Button>
            {manage && (
              <Button variant="primary" icon="plus" class="edit-only" popovertarget={ADD_SECTION_MODAL}>
                セクションを追加
              </Button>
            )}
          </>
        }
      />
      <TabPanel>
        {o.visibleSections.length === 0 && (
          <div class={manage ? 'view-only' : undefined}>
            <EmptyState
              icon="layers"
              title={manage && o.topSections.length > 0 ? '学生に表示している教材はありません' : 'まだ教材がありません'}
              text={manage ? '編集モードにして、セクションやアイテムを追加しましょう。' : '教師が教材を追加するとここに表示されます。'}
            />
          </div>
        )}
        {o.topSections.length > 0 &&
          (layout.kind === 'topcoll' ? (
            <TopcollSections {...props} layout={layout} />
          ) : layout.kind === 'tiles' ? (
            <TilesSections {...props} layout={layout} openSection={openSection} />
          ) : (
            <ListSections {...props} />
          ))}
        {manage && <AddSectionModal courseId={id} />}
        {manage && sections.length > 0 && <AddItemModal courseId={id} sections={sections} tracking={tracking} kinds={extraKinds} />}
      </TabPanel>
      <CourseLiveSync courseId={id} revision={revision} />
    </AppShell>
  )
}

// ---------------------------------------------------------------- アイテム

export const TEXT_PREVIEW_MAX = 200 * 1024

const COMPLETION_WAITING: Record<'view' | 'auto', Partial<Record<MItem['kind'], string>>> = {
  view: { link: 'リンクを開くと完了になります', file: 'ファイルを開くと完了になります', extra: 'このページを開くと完了になります' },
  auto: { moodle: '旧STEP Learn の画面で条件を満たすと完了になります' },
}

export const ItemPage = ({
  access,
  item,
  section,
  sections,
  outline,
  prev,
  next,
  textPreview,
  revision,
  layout,
}: {
  access: CourseAccess
  item: MItem
  section?: MSection
  sections: MSection[]
  layout: CourseLayout
  outline: MItem[]
  prev?: MItem
  next?: MItem
  textPreview: string | null
  revision: string
}) => {
  const id = access.course.id
  const isStudent = access.role === 'student'
  const base = `/courses/${id}/items`
  const fileUrl = `${base}/${item.id}/file`
  const preview = item.kind === 'file' ? previewKind(item.fileType, item.fileName) : null
  const previewUrl = `${fileUrl}?inline=1`
  const completeUrl = (o: MItem) => `${base}/${o.id}/complete`
  // 完了済みなら付けないのは、開くたびに送って、すでに付いている完了を書き直さないため
  const waitsForView = (o: MItem) => isStudent && o.completion === 'view' && !o.done
  const onOpen = (o: MItem) => (waitsForView(o) ? { 'data-complete-on-open': completeUrl(o) } : {})
  const embedded = item.kind === 'link' && item.linkTarget === 'embed'
  const extraKind = kindOfItem(item)
  const opensOnView = embedded || item.kind === 'extra' || (!!preview && (preview !== 'text' || textPreview !== null))
  const tracked = outline.filter(isTracked)
  const hiddenSections = new Set(sections.filter((s) => s.hidden).map((s) => s.id))
  const isHidden = (o: MItem) => o.hidden || hiddenSections.has(o.sectionId)
  const siblings = outline.filter((o) => o.sectionId === item.sectionId)
  const position = siblings.findIndex((o) => o.id === item.id) + 1
  const sectionById = new Map(sections.map((s) => [s.id, s]))
  const topOf = (sectionId: number) => sectionById.get(sectionId)?.parentId ?? sectionId
  const outlineSections = sections
    .filter((s) => !s.parentId)
    .map((s) => ({ section: s, items: outline.filter((o) => topOf(o.sectionId) === s.id) }))
    .filter((s) => access.canManage || s.items.length > 0)
  // 入れ子のアイテムの前にだけ見出しを出すのは、親のセクションのアイテムと読む順のまま並べるため
  const startsSubsection = (list: MItem[], i: number) =>
    list[i].sectionId !== topOf(list[i].sectionId) && list[i - 1]?.sectionId !== list[i].sectionId
  const navHref = (o: MItem) => `${base}/${o.id}`
  const waiting = item.completion === 'view' || item.completion === 'auto' ? COMPLETION_WAITING[item.completion][item.kind] : undefined

  const pdf = preview === 'pdf'
  const crumbs = (
    <Breadcrumbs
      items={[
        { href: '/courses', label: 'コース一覧' },
        { href: `/courses/${id}`, label: access.course.title },
      ]}
    />
  )
  const head = (
    <>
      <header class="reader-head">
        {section && position > 0 && (
          <span class="eyebrow">
            <a href={sectionHref(id, layout, sections, section.id)}>{section.title}</a> · {position} / {siblings.length}
          </span>
        )}
        <KindIcon item={item} />
        <h1>{item.title}</h1>
        {access.canManage && hasEditPage(item) && (
          <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil">
            編集
          </Button>
        )}
      </header>
      {access.canManage && isHidden(item) && (
        <Alert tone="info">
          {item.hidden ? 'このアイテム' : 'このアイテムのセクション'}は学生に非表示です。学生のコース画面には表示されず、URL
          を開いても見つかりません。
        </Alert>
      )}
    </>
  )

  const pdfBar = pdf ? (
    <PdfBar
      crumbs={[
        { href: '/courses', label: 'コース一覧' },
        { href: `/courses/${id}`, label: access.course.title },
        ...(section && position > 0
          ? [{ href: sectionHref(id, layout, sections, section.id), label: `${section.title} · ${position} / ${siblings.length}` }]
          : []),
      ]}
      title={item.title}
      hiddenNote={
        access.canManage && isHidden(item) ? `${item.hidden ? 'このアイテム' : 'このアイテムのセクション'}は学生に非表示です。` : undefined
      }
    >
      {access.canManage && (
        <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil" aria-label="編集">
          <span class="hide-sm">編集</span>
        </Button>
      )}
      <Button href={fileUrl} size="sm" icon="download" aria-label="ダウンロード" data-no-prefetch download {...onOpen(item)}>
        <span class="hide-sm">ダウンロード</span>
      </Button>
    </PdfBar>
  ) : undefined

  return (
    <AppShell tone={access.course.color} topbar={pdfBar}>
      <Styles use={['/src/routes/content/content.css', '/src/moodle-mode/moodle-mode.css']} />
      {pdf ? <PdfStage src={previewUrl} title={item.fileName} /> : crumbs}
      <div class="reader">
        <article class="reader-main">
          {!pdf && head}

          {embedded && <LinkEmbed url={item.url} title={item.title} />}

          {item.kind === 'link' && !embedded && (
            <LinkCard
              icon="link"
              class="link-card-lg kind-link"
              {...linkOpenAttrs(item.url, item.linkTarget, navHref(item))}
              {...onOpen(item)}
            >
              <span class="file-name">
                <span class="strong">外部サイトを開く</span>
                <span class="muted small truncate">{hostOf(item.url)}</span>
              </span>
              <Button as="span" variant="primary" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.extra && extraKind && <extraKind.View item={item} data={item.extra.data} access={access} />}

          {item.kind === 'moodle' && (
            <LinkCard href={item.url} icon="academicCap" class="link-card-lg kind-moodle" target="_blank" rel="noopener" data-no-prefetch>
              <span class="file-name">
                <span class="strong">旧STEP Learnで開く</span>
                <span class="muted small truncate">この活動は旧STEP Learn の画面で使います</span>
              </span>
              <Button as="span" variant="primary" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.kind === 'file' && !pdf && (
            <>
              <LinkCard icon="file" class="link-card-lg kind-file">
                <span class="file-name">
                  <span class="strong">ファイルをダウンロード</span>
                  <span class="file-meta muted small">
                    <span class="truncate">{item.fileName}</span>
                    <span>{formatBytes(item.fileSize)}</span>
                  </span>
                </span>
                <Button href={fileUrl} variant="primary" icon="download" data-no-prefetch download {...onOpen(item)}>
                  ダウンロード
                </Button>
              </LinkCard>
              {textPreview !== null && (
                <div class="file-preview-text">
                  <pre>{textPreview}</pre>
                  {item.fileSize > TEXT_PREVIEW_MAX && (
                    <p class="muted small">
                      先頭の {formatBytes(TEXT_PREVIEW_MAX)} だけを表示しています。全体はダウンロードして確認してください。
                    </p>
                  )}
                </div>
              )}
              {preview === 'image' && <img class="file-preview-img" src={previewUrl} alt={item.title} loading="lazy" />}
              {preview === 'video' && <video class="file-preview-video" src={previewUrl} controls preload="metadata" />}
              {preview === 'audio' && <audio class="file-preview-audio" src={previewUrl} controls preload="metadata" />}
            </>
          )}

          {item.body && (
            <div class="reader-sheet">
              <Markdown source={item.body} />
            </div>
          )}

          {waitsForView(item) && opensOnView && <span hidden data-complete-on-view={completeUrl(item)} />}

          {isStudent && waiting && (
            <div class="complete-bar">
              <p class={cx('completion-status', item.done && 'is-done')} data-complete-status={item.id}>
                <Icon name="check" size={16} />
                <span data-complete-label>{item.done ? '完了済み' : waiting}</span>
              </p>
            </div>
          )}

          {isStudent && item.completion === 'manual' && (
            <form method="post" action={completeUrl(item)} class="complete-bar" data-complete>
              <Button
                type="submit"
                variant={item.done ? 'success' : next ? 'default' : 'primary'}
                size="lg"
                icon="check"
                aria-pressed={item.done ? 'true' : 'false'}
                data-complete-secondary={!item.done && next ? '' : undefined}
              >
                <span data-complete-label>{item.done ? '完了済み' : '完了にする'}</span>
              </Button>
              {!item.done && next && (
                <Button type="submit" variant="primary" size="lg" iconEnd="chevronRight" data-complete-then={navHref(next)}>
                  完了して次へ
                </Button>
              )}
            </form>
          )}

          <nav class="pager" aria-label="前後のアイテム">
            {prev && (
              <a href={navHref(prev)} class="pager-link pager-prev">
                <span class="pager-arrow">
                  <Icon name="chevronLeft" size={18} />
                </span>
                <span class="pager-text">
                  <span class="pager-label muted small">前へ</span>
                  <span class="pager-title truncate">{prev.title}</span>
                </span>
              </a>
            )}
            <a href={next ? navHref(next) : `/courses/${id}`} class="pager-link pager-next">
              <span class="pager-text">
                <span class="pager-label muted small">{next ? '次へ' : 'コースへ'}</span>
                <span class="pager-title truncate">{next ? next.title : access.course.title}</span>
              </span>
              <span class="pager-arrow">
                <Icon name="chevronRight" size={18} />
              </span>
            </a>
          </nav>
        </article>

        <aside class="reader-outline" aria-label="コースの目次">
          <div class="outline-head">
            <a href={`/courses/${id}`} class="strong truncate">
              {access.course.title}
            </a>
            {isStudent && tracked.length > 0 && (
              <span class="muted small">
                <span data-progress-done>{tracked.filter((o) => o.done).length}</span> / {tracked.length} 完了
              </span>
            )}
          </div>
          {outlineSections.map(({ section: s, items }) => (
            <div class={cx('outline-section', items.length === 0 && 'is-empty')}>
              <div class={cx('outline-title', s.hidden && 'is-hidden')}>
                {s.title}
                {s.hidden && <Icon name="eyeSlash" size={12} />}
                {items.length === 0 && <span class="outline-count">0</span>}
              </div>
              {items.length > 0 && (
                <ul>
                  {items.map((o, i) => (
                    <li class={o.sectionId !== s.id ? 'is-nested' : undefined}>
                      {startsSubsection(items, i) && (
                        <span class={cx('outline-sub', hiddenSections.has(o.sectionId) && 'is-hidden')}>
                          <Icon name="folder" size={12} />
                          <span class="truncate">{sectionById.get(o.sectionId)?.title}</span>
                        </span>
                      )}
                      <a
                        class={cx('outline-link', o.id === item.id && 'active', isHidden(o) && 'is-hidden')}
                        {...openAttrs(id, o)}
                        aria-current={o.id === item.id ? 'page' : undefined}
                        {...(isStudent && completesOnOpen(o) ? { 'data-complete-on-open': completeUrl(o) } : {})}
                      >
                        {isTracked(o) ? (
                          <span class={cx('outline-dot', o.done && 'done')} data-outline-dot={o.id}>
                            {o.done && <Icon name="check" size={10} />}
                          </span>
                        ) : (
                          <Icon
                            name={o.kind === 'link' ? 'link' : o.kind === 'file' ? 'file' : (kindOfItem(o)?.icon ?? 'academicCap')}
                            size={14}
                            class="outline-kind"
                          />
                        )}
                        <span class="truncate">{o.title}</span>
                        {o.hidden && <Icon name="eyeSlash" size={12} class="outline-hidden" />}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </aside>
      </div>
      <CourseLiveSync courseId={id} revision={revision} />
    </AppShell>
  )
}

// ---------------------------------------------------------------- 編集

export type ItemEditValues = { title: string; url: string; linkTarget: string; hidden: number; sectionId: number; completion: string }

export const ItemEditPage = ({
  access,
  item,
  sections,
  layout,
  values,
  extraValues,
  errors = {},
}: {
  access: CourseAccess
  item: MItem
  sections: MSection[]
  layout: CourseLayout
  values?: Partial<ItemEditValues>
  /** extra の種類ごとの欄に入れる値。省略すると保存済みの中身 */
  extraValues?: Record<string, unknown>
  errors?: FieldErrors
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v: ItemEditValues = {
    title: item.title,
    url: item.url,
    linkTarget: item.linkTarget,
    hidden: item.hidden ? 1 : 0,
    sectionId: item.sectionId,
    completion: item.completion === 'auto' ? 'none' : item.completion,
    ...values,
  }
  const section = sections.find((s) => s.id === item.sectionId)
  const extraKind = kindOfItem(item)
  const typeLabel = extraKind ? extraKind.label : item.kind === 'link' ? 'リンク' : 'ファイル'
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/content/content.css']} />
      <Breadcrumbs
        items={[
          { href: '/courses', label: 'コース一覧' },
          { href: `/courses/${courseId}`, label: access.course.title },
          section && { href: sectionHref(courseId, layout, sections, section.id), label: section.title },
          { href: base, label: item.title },
        ].filter((b) => !!b)}
      />
      <header class="editor-head">
        <KindIcon item={item} />
        <div class="editor-head-text">
          <span class="eyebrow">{typeLabel}を編集</span>
          <h1 class="truncate">{item.title}</h1>
        </div>
        <div class="editor-head-actions">
          <Button href={base} variant="ghost" icon="eye" aria-label="表示">
            <span class="hide-sm">表示</span>
          </Button>
          <Button type="submit" form="item-form" variant="primary" icon="check" title="保存（⌘S / Ctrl+S）" data-save-shortcut>
            保存
          </Button>
        </div>
      </header>

      <div class="editor">
        <form
          id="item-form"
          method="post"
          action={base}
          enctype="multipart/form-data"
          class="editor-form"
          data-loading-form
          {...validateWith(extraKind ? extraKind.form : 'itemEdit')}
        >
          <input type="hidden" name="type" value={item.extra?.type ?? item.kind} />
          <Card class="editor-main stack">
            <TextField label="タイトル" name="title" value={v.title} error={errors.title} class="editor-title" />
            {extraKind && <extraKind.Fields values={extraValues ?? item.extra?.data ?? {}} errors={errors} idPrefix="f" />}
            {item.kind === 'link' && (
              <TextField label="URL" name="url" type="url" value={v.url} error={errors.url} placeholder="https://" />
            )}
            {item.kind === 'link' && (
              <LinkTargetField
                id="f-link-target"
                value={v.linkTarget}
                hint={
                  item.display && !isExactDisplay(item.display)
                    ? `旧STEP Learn では表示方法が「${MOODLE_DISPLAY_LABELS[item.display]}」に設定されています。開き方を変えなければ、その設定のまま残ります。`
                    : undefined
                }
              />
            )}
            {item.completion === 'auto' && (
              <Alert tone="info">
                完了の条件は旧STEP Learn の画面で設定されているため、ここでは変えられません（保存してもそのまま残ります）。
              </Alert>
            )}
          </Card>

          <aside class="editor-side">
            <Card heading="公開と配置">
              <div class="stack">
                <fieldset class="field">
                  <legend>学生への表示</legend>
                  <SegmentedControl
                    name="hidden"
                    label="学生への表示"
                    options={[
                      { value: '0', label: '表示', icon: 'eye' },
                      { value: '1', label: '非表示', icon: 'eyeSlash' },
                    ]}
                    value={String(v.hidden)}
                  />
                </fieldset>
                <SelectField
                  label="セクション"
                  name="section_id"
                  id="f-section"
                  options={sectionOptions(sections)}
                  value={String(v.sectionId)}
                />
                {!!access.course.completionEnabled && item.completion !== 'auto' && (
                  <MoodleCompletionField id="f-completion" value={v.completion} error={errors.completion} />
                )}
              </div>
            </Card>
            {item.kind === 'file' && (
              <Card heading="ファイル">
                <div class="stack">
                  <FileChip name={item.fileName} meta={`現在のファイル・${formatBytes(item.fileSize)}`} />
                  <FormField
                    id="f-file"
                    error={errors.file}
                    label="差し替えるファイル"
                    hint={`選ばなければ今のファイルのまま（最大 ${formatBytes(MAX_FILE_SIZE)}）`}
                  >
                    <FileInput
                      id="f-file"
                      name="file"
                      aria-invalid={errors.file ? 'true' : undefined}
                      aria-describedby="f-file-error f-file-desc"
                    />
                  </FormField>
                </div>
              </Card>
            )}
            <Card tone="danger" class="editor-danger">
              <DangerRow heading="アイテムを削除" description="旧STEP Learn からも削除され、学生の完了記録も消えます。">
                <Button type="submit" form="item-delete-form" variant="danger-outline" size="sm" icon="trash">
                  削除
                </Button>
              </DangerRow>
            </Card>
          </aside>
        </form>

        {extraKind?.Panel && <extraKind.Panel item={item} access={access} />}

        <form id="item-delete-form" method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`} hidden />
      </div>
    </AppShell>
  )
}

export type RestrictionValues = { from: string; until: string; after: number[]; hideUnmet: number }

/** アクセス制限を編集するセクションかアイテム */
export type RestrictionTarget = {
  kind: 'section' | 'item'
  id: number
  title: string
  /** フォームの送信先 */
  action: string
  /** 保存したあとと、戻るボタンの移動先 */
  back: string
  /** Moodle の設定画面 */
  moodleUrl: string
  rule: Restriction | null
}

const RestrictionAfterField = ({
  target,
  sections,
  items,
  checked,
}: {
  target: RestrictionTarget
  sections: MSection[]
  items: MItem[]
  checked: number[]
}) => {
  const sectionLabels = new Map(sectionOptions(sections).map((o) => [Number(o.value), o.label]))
  const choices = [
    ...(target.kind === 'item'
      ? [{ id: PREVIOUS_ITEM, title: '直前のアイテム', meta: 'このアイテムより前にある、完了の条件があるアイテム' }]
      : []),
    ...items
      .filter((it) => isTracked(it) && !(target.kind === 'item' && it.id === target.id))
      .map((it) => ({ id: it.id, title: it.title, meta: sectionLabels.get(it.sectionId) ?? '' })),
  ]
  return (
    <fieldset class="field">
      <legend>完了が必要なアイテム（任意）</legend>
      {choices.length > 0 ? (
        <ul class="restriction-choices">
          {choices.map((ch) => (
            <li>
              <label class="restriction-choice">
                <input type="checkbox" name="after[]" value={String(ch.id)} checked={checked.includes(ch.id)} />
                <span class="restriction-choice-text">
                  <span class="truncate">{ch.title}</span>
                  {ch.meta && <span class="muted small truncate">{ch.meta}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted small">完了の条件があるアイテムがありません。</p>
      )}
    </fieldset>
  )
}

export const RestrictionPage = ({
  access,
  sections,
  items,
  target,
  restrictable,
  values,
  errors = {},
}: {
  access: CourseAccess
  sections: MSection[]
  items: MItem[]
  target: RestrictionTarget
  restrictable: boolean
  values?: RestrictionValues
  errors?: FieldErrors
}) => {
  useStyle('/src/components/course.css', '/src/moodle-mode/moodle-mode.css')
  const courseId = access.course.id
  const { rule } = target
  const editable = restrictable && (!rule || rule.editable)
  const v: RestrictionValues = values ?? {
    from: unixToDateTimeInput(rule?.from),
    until: unixToDateTimeInput(rule?.until),
    after: rule?.after ?? [],
    hideUnmet: rule?.hideUnmet ? 1 : 0,
  }
  const kindLabel = target.kind === 'section' ? 'セクション' : 'アイテム'
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/content/content.css']} />
      <Breadcrumbs
        items={[
          { href: '/courses', label: 'コース一覧' },
          { href: `/courses/${courseId}`, label: access.course.title },
          { href: target.back, label: target.title },
          { label: 'アクセス制限' },
        ]}
      />
      <header class="editor-head">
        <span class="item-icon kind-moodle">
          <Icon name="lock" size={20} />
        </span>
        <div class="editor-head-text">
          <span class="eyebrow">{kindLabel}のアクセス制限</span>
          <h1 class="truncate">{target.title}</h1>
        </div>
        <div class="editor-head-actions">
          <Button href={target.back} variant="ghost" icon="chevronLeft" aria-label="戻る">
            <span class="hide-sm">戻る</span>
          </Button>
          {editable && (
            <Button type="submit" form="restriction-form" variant="primary" icon="check" title="保存（⌘S / Ctrl+S）" data-save-shortcut>
              保存
            </Button>
          )}
        </div>
      </header>

      <div class="editor">
        {editable ? (
          <Card
            as="form"
            id="restriction-form"
            method="post"
            action={target.action}
            class="editor-main stack"
            heading="開ける条件"
            description="すべての条件を満たした学生だけが開けます。何も指定しなければ、制限なしになります。教師はいつでも開けます。"
            data-loading-form
            {...validateWith('restriction')}
          >
            <div class="grid-2">
              <TextField
                label="開始日時（任意）"
                name="from"
                type="datetime-local"
                value={v.from}
                error={errors.from}
                hint="この日時から開けるようになります"
              />
              <TextField
                label="終了日時（任意）"
                name="until"
                type="datetime-local"
                value={v.until}
                error={errors.until}
                hint="この日時になると開けなくなります"
              />
            </div>
            {access.course.completionEnabled ? (
              <RestrictionAfterField target={target} sections={sections} items={items} checked={v.after} />
            ) : (
              <p class="muted small">このコースでは完了ステータスを使っていないため、アイテムの完了は条件にできません。</p>
            )}
            <fieldset class="field">
              <legend>条件を満たしていない学生への表示</legend>
              <SegmentedControl
                name="hide_unmet"
                label="条件を満たしていない学生への表示"
                options={[
                  { value: '0', label: '条件を見せる', icon: 'lock' },
                  { value: '1', label: '表示しない', icon: 'eyeSlash' },
                ]}
                value={String(v.hideUnmet)}
              />
            </fieldset>
            {rule && (
              <div class="form-actions">
                <Button type="submit" name="clear" value="1" variant="ghost" icon="lockOpen">
                  制限をなくす
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <div class="editor-main stack">
            {restrictable ? (
              <Alert tone="info">
                この{kindLabel}には、STEP Learn では編集できない条件（グループ・評点・「いずれか」の組み合わせなど）が含まれています。旧STEP
                Learn の画面で編集してください。
              </Alert>
            ) : (
              <Alert tone="warning">旧STEP Learn のサイトの設定で、アクセス制限が使えないようになっています。</Alert>
            )}
          </div>
        )}

        <aside class="editor-side">
          <Card heading="現在の制限">
            <div class="stack">
              {rule ? <RestrictionNote rule={rule} /> : <p class="muted small">制限はありません。</p>}
              <Button href={target.moodleUrl} size="sm" iconEnd="external" target="_blank" rel="noopener" data-no-prefetch>
                旧STEP Learn で編集
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------- エラー

export type ErrorContent = { icon: IconName; title: string; text: string }

const SERVER_ERROR: ErrorContent = {
  icon: 'alert',
  title: 'エラーが発生しました',
  text: '時間をおいて再度お試しください。問題が続く場合は、管理者にお問い合わせください。',
}

const ERRORS: Partial<Record<number, ErrorContent>> = {
  400: { icon: 'alert', title: 'リクエストが正しくありません', text: 'URL や入力した内容を確かめて、もう一度お試しください。' },
  403: { icon: 'lock', title: 'この操作は受け付けられませんでした', text: 'ページを開き直してから、もう一度お試しください。' },
  404: { icon: 'search', title: 'ページが見つかりません', text: 'URL が間違っているか、閲覧する権限がありません。' },
  500: SERVER_ERROR,
  502: {
    icon: 'alert',
    title: '旧STEP Learn でエラーが発生しました',
    text: '旧STEP Learn が処理できませんでした。時間をおいて再度お試しください。',
  },
  503: {
    icon: 'alert',
    title: '旧STEP Learn に接続できません',
    text: '旧STEP Learn が停止しているか、混み合っています。時間をおいて再度お試しください。',
  },
}

export const errorContent = (status: number): ErrorContent =>
  ERRORS[status] ?? (status >= 500 ? SERVER_ERROR : (ERRORS[400] as ErrorContent))

export const ErrorPage = ({
  status,
  content = errorContent(status),
  loggedIn,
  retry,
}: {
  status: number
  content?: ErrorContent
  loggedIn: boolean
  retry?: string
}) => {
  const body = (
    <EmptyState
      page
      icon={content.icon}
      title={content.title}
      text={
        <>
          {content.text}
          <span class="error-code">エラーコード {status}</span>
        </>
      }
      action={
        <div class="row">
          {retry && (
            <Button href={retry} icon="arrowPath" data-reload>
              再読み込み
            </Button>
          )}
          {loggedIn && !retry && (
            <Button href="/courses" icon="book">
              コース一覧
            </Button>
          )}
          <Button href="/" variant="primary">
            ホームへ戻る
          </Button>
        </div>
      }
    />
  )
  useStyle('/src/moodle-mode/moodle-mode.css')
  return loggedIn ? <AppShell>{body}</AppShell> : <AuthShell>{body}</AuthShell>
}
