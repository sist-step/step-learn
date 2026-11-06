import { CourseHeader, CourseLiveSync, ItemIcon, nextActionLabel } from '../components/course'
import { Button, IconButton } from '../components/button'
import { Card, DangerRow, LinkCard } from '../components/card'
import { cx } from '../components/cx'
import { FileField, FileInput, FormField, SegmentedControl, SelectField, TextAreaField, TextField, validateWith } from '../components/form'
import { Icon, type IconName } from '../components/icons'
import { AppShell, AuthShell } from '../components/layout'
import { Markdown } from '../components/markdown'
import { MenuItem, Modal, Popover } from '../components/overlay'
import { Styles, useStyle } from '../components/style'
import { Alert, Breadcrumbs, Chip, EmptyState, TabPanel } from '../components/ui'
import type { CourseAccess } from '../lib/courses'
import type { FieldErrors } from '../lib/forms'
import { previewKind } from '../lib/preview'
import { MAX_FILE_SIZE, formatBytes } from '../lib/storage'
import type { CourseLayout, ItemCompletion, MItem, MSection, TilesLayout, TopcollLayout } from './mapping'
import { isOpenable, isTracked, sectionHref } from './mapping'
import { TileIcon, tileNumber } from './tile-icons'

// ---------------------------------------------------------------- ログイン

export const LoginPage = ({ next = '', error }: { next?: string; error?: string }) => (
  <AuthShell>
    <div class="auth-card">
      <h1>おかえりなさい</h1>
      <div class="stack">
        {error && <Alert>{error}</Alert>}
        <p class="muted">旧STEP Learn のアカウントでログインします。Microsoft アカウントでログインしている方も、こちらからどうぞ。</p>
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

const KindIcon = ({ item }: { item: MItem }) => {
  if (item.kind === 'link' || item.kind === 'file') return <ItemIcon type={item.kind} />
  useStyle('/src/components/course.css', '/src/moodle-mode/moodle-mode.css')
  return (
    <span class="item-icon kind-moodle">
      <Icon name={item.locked ? 'lock' : 'academicCap'} size={16} />
    </span>
  )
}

const itemHref = (courseId: number, it: MItem) =>
  it.kind === 'link' || it.kind === 'moodle' ? it.url : `/courses/${courseId}/items/${it.id}`

const opensNewTab = (it: MItem) => it.kind === 'link' || it.kind === 'moodle'

const HiddenChip = () => <Chip icon="eyeSlash">学生に非表示</Chip>

const RowMenu = ({ base, hidden, confirm }: { base: string; hidden: boolean; confirm: string }) => (
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
      {(item.kind === 'link' || item.kind === 'file') && <IconButton href={`${base}/edit`} icon="pencil" label="編集" />}
      <RowMenu base={base} hidden={item.hidden} confirm={`「${item.title}」を削除しますか？`} />
    </div>
  )
  if (item.kind === 'label') {
    return (
      <li class={cx('item-row item-label', item.hidden && 'is-hidden edit-only')} data-item={item.id}>
        <div class="item-text">{item.body ? <Markdown source={item.body} /> : <span class="muted">{item.title}</span>}</div>
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
        : item.url
          ? '旧STEP Learnで開く'
          : ''
  const newTab = opensNewTab(item)
  const linkless = item.locked || !isOpenable(item)
  const body = (
    <>
      <KindIcon item={item} />
      <span class="item-text">
        <span class="item-title">{item.title}</span>
        <span class="item-meta truncate">{meta}</span>
      </span>
      {item.hidden && <HiddenChip />}
      {manage && tracked && (
        <Chip icon="check" class="edit-only">
          {COMPLETION_LABELS[item.completion]}
        </Chip>
      )}
      {!linkless &&
        (newTab ? <Icon name="external" size={14} class="item-ext" /> : <Icon name="chevronRight" size={16} class="item-ext" />)}
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
          href={itemHref(courseId, item)}
          class="item-link"
          {...(newTab ? { target: '_blank', rel: item.kind === 'link' ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' } : {})}
          {...(isStudent && item.kind === 'link' && item.completion === 'view' && !item.done
            ? { 'data-complete-on-open': `${base}/complete` }
            : {})}
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
          </span>
          {item.hidden && <HiddenChip />}
        </span>
        {manage && (
          <div class="row-actions edit-only">
            <RowMenu
              base={`/courses/${courseId}/items/${item.id}`}
              hidden={item.hidden}
              confirm={`サブセクション「${item.title}」と中のアイテムをすべて削除しますか？`}
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
const AddItemModal = ({ courseId, sections, tracking }: { courseId: number; sections: MSection[]; tracking: boolean }) => (
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
      </div>
      <div class="item-step kind-settings stack">
        <div class="kind-summary">
          {KINDS.map((t) => (
            <span class="kind-summary-body" data-kind-summary={t}>
              <KindOptionBody type={t} />
            </span>
          ))}
          <Button size="sm" variant="ghost" icon="chevronLeft" data-kind-back>
            種類を変える
          </Button>
        </div>
        <TextField label="タイトル" name="title" id="new-item-title" placeholder="例：第1回 講義資料" />
        <TextField label="URL" name="url" id="new-item-url" type="url" placeholder="https://" fieldClass="when-link" />
        <FileField
          label="ファイル"
          name="file"
          id="new-item-file"
          hint={`最大 ${formatBytes(MAX_FILE_SIZE)}。PDF・画像はブラウザでプレビューできます。`}
          fieldClass="when-file"
        />
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
          <Button type="submit" name="then" value="view">
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
        <RowMenu base={base} hidden={section.hidden} confirm={`セクション「${section.title}」と中のアイテムをすべて削除しますか？`} />
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
  const empty = !manage && shown.length === 0
  const emptyView = manage && shown.length === 0
  const { open = true, fixed = false, group, current = false, summaryInHead = false, subtiles = false, closable = false } = options
  return (
    <details
      class={cx(
        'section-card',
        s.hidden && 'is-hidden edit-only',
        empty && 'is-empty',
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
          {!empty && (
            <span class="muted small">
              {emptyView && <span class="view-only">{hiddenCount > 0 ? `非表示 ${hiddenCount}` : 'アイテムなし'}</span>}
              <span class={emptyView ? 'edit-only' : undefined}>{`${shown.length} アイテム`}</span>
              {isStudent && tracked.length > 0 && ` · ${done} 完了`}
              {hiddenCount > 0 && <span class="edit-only">{` · 非表示 ${hiddenCount}`}</span>}
            </span>
          )}
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
}: {
  s: MSection
  o: CourseOutline
  layout: TilesLayout
  courseId: number
  isStudent: boolean
  open: boolean
}) => {
  const tile = layout.tiles.get(s.id)
  const icon = tile?.icon || layout.defaultIcon
  const number = tileNumber(icon)
  const { shown, tracked, done } = o.statsOf(s.id)
  const locked = s.locked && isStudent
  const empty = isStudent && shown.length === 0
  const progress = isStudent && tracked.length > 0 ? layout.progress : 'none'
  const pct = tracked.length ? Math.round((done / tracked.length) * 100) : 0
  const complete = tracked.length > 0 && done === tracked.length
  const body = (
    <>
      <span class="sec-tile-media">
        {tile?.photo ? (
          <img src={`/courses/${courseId}/sections/${s.id}/photo/${encodeURIComponent(tile.photo)}`} alt="" loading="lazy" />
        ) : number ? (
          <span class="sec-tile-number">{number}</span>
        ) : (
          <TileIcon name={icon} />
        )}
      </span>
      <span class="sec-tile-body">
        <span class="sec-tile-eyebrow">
          <span class="sec-tile-num">{o.sectionNumber.get(s.id) ?? <Icon name="eyeSlash" size={12} />}</span>
          {s.hidden && <HiddenChip />}
          {isStudent && complete && <Icon name="checkCircle" size={16} class="sec-tile-done" />}
        </span>
        <span class="sec-tile-title">{s.title}</span>
        <span class="sec-tile-meta truncate">
          {locked ? (
            <>
              <Icon name="lock" size={12} /> {s.restriction || 'まだ開けません'}
            </>
          ) : empty ? (
            '準備中'
          ) : progress === 'fraction' ? (
            `${done} / ${tracked.length} 完了`
          ) : (
            `${shown.length} アイテム`
          )}
        </span>
      </span>
      {progress === 'percent' && !locked && (
        <span class="sec-tile-progress" role="img" aria-label={`${pct}% 完了`}>
          <span class="sec-tile-progress-bar" style={`--w:${pct}%`} />
          <span class="sec-tile-progress-label">{pct}%</span>
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
          {tiles.flatMap((s) => {
            const open = s.id === openSection && openable(s)
            const tile = <TileCard s={s} o={o} layout={layout} courseId={rest.courseId} isStudent={rest.isStudent} open={open} />
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
  openSection,
  revision,
  moodleCourseUrl,
}: {
  access: CourseAccess
  sections: MSection[]
  items: MItem[]
  layout: CourseLayout
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
  const openable = shownItems.filter((it) => isOpenable(it) && !it.locked)
  const nextItem = openable.find((it) => isTracked(it) && !it.done) ?? (trackedItems.length === 0 ? openable[0] : undefined)
  const props = { o, courseId: id, isStudent, manage }

  return (
    <AppShell editable={manage} tone={access.course.color}>
      <Styles use={['/src/routes/courses/courses.css', '/src/moodle-mode/moodle-mode.css']} />
      <CourseHeader
        access={access}
        tab="content"
        editSwitch={false}
        progress={isStudent ? { done: doneCount, total: trackedItems.length } : undefined}
        actions={
          isStudent &&
          nextItem && (
            <div class="course-next">
              <Button
                href={itemHref(id, nextItem)}
                variant="primary"
                iconEnd={opensNewTab(nextItem) ? 'external' : 'chevronRight'}
                {...(opensNewTab(nextItem) ? { target: '_blank', rel: 'noopener', 'data-no-prefetch': '' } : {})}
              >
                {nextActionLabel(doneCount)}
              </Button>
              <span class="course-next-meta muted small truncate">次: {nextItem.title}</span>
            </div>
          )
        }
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
        {manage && sections.length > 0 && <AddItemModal courseId={id} sections={sections} tracking={tracking} />}
      </TabPanel>
      <CourseLiveSync courseId={id} revision={revision} />
    </AppShell>
  )
}

// ---------------------------------------------------------------- アイテム

export const TEXT_PREVIEW_MAX = 200 * 1024

const COMPLETION_WAITING: Record<'view' | 'auto', Partial<Record<MItem['kind'], string>>> = {
  view: { link: 'リンクを開くと完了になります', file: 'ファイルを開くと完了になります' },
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
  const opensOnView = !!preview && (preview !== 'text' || textPreview !== null)
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
        {access.canManage && (item.kind === 'link' || item.kind === 'file') && (
          <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil">
            編集
          </Button>
        )}
        {pdf && (
          <Button href={fileUrl} size="sm" icon="download" aria-label="ダウンロード" data-no-prefetch download {...onOpen(item)}>
            <span class="hide-sm">ダウンロード</span>
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

  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/content/content.css', '/src/moodle-mode/moodle-mode.css']} />
      {pdf ? (
        <div class="pdf-stage">
          {crumbs}
          {head}
          <iframe class="file-preview" src={previewUrl} title={item.fileName} />
        </div>
      ) : (
        crumbs
      )}
      <div class="reader">
        <article class="reader-main">
          {!pdf && head}

          {item.kind === 'link' && (
            <LinkCard
              href={item.url}
              icon="link"
              class="link-card-lg kind-link"
              target="_blank"
              rel="noopener noreferrer"
              data-no-prefetch
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
                        href={o.kind === 'file' ? navHref(o) : o.url}
                        class={cx('outline-link', o.id === item.id && 'active', isHidden(o) && 'is-hidden')}
                        {...(opensNewTab(o)
                          ? { target: '_blank', rel: o.kind === 'link' ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' }
                          : {})}
                        aria-current={o.id === item.id ? 'page' : undefined}
                        {...(o.kind === 'link' ? onOpen(o) : {})}
                      >
                        {isTracked(o) ? (
                          <span class={cx('outline-dot', o.done && 'done')} data-outline-dot={o.id}>
                            {o.done && <Icon name="check" size={10} />}
                          </span>
                        ) : (
                          <Icon
                            name={o.kind === 'link' ? 'link' : o.kind === 'file' ? 'file' : 'academicCap'}
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

export type ItemEditValues = { title: string; url: string; hidden: number; sectionId: number; completion: string }

export const ItemEditPage = ({
  access,
  item,
  sections,
  layout,
  values,
  errors = {},
}: {
  access: CourseAccess
  item: MItem
  sections: MSection[]
  layout: CourseLayout
  values?: Partial<ItemEditValues>
  errors?: FieldErrors
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v: ItemEditValues = {
    title: item.title,
    url: item.url,
    hidden: item.hidden ? 1 : 0,
    sectionId: item.sectionId,
    completion: item.completion === 'auto' ? 'none' : item.completion,
    ...values,
  }
  const section = sections.find((s) => s.id === item.sectionId)
  const typeLabel = item.kind === 'link' ? 'リンク' : 'ファイル'
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
          {...validateWith('itemEdit')}
        >
          <input type="hidden" name="type" value={item.kind} />
          <Card class="editor-main stack">
            <TextField label="タイトル" name="title" value={v.title} error={errors.title} class="editor-title" />
            {item.kind === 'link' && (
              <TextField label="URL" name="url" type="url" value={v.url} error={errors.url} placeholder="https://" />
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
                <FormField
                  id="f-file"
                  error={errors.file}
                  label="差し替えるファイル"
                  hint={`選ばなければ今のファイルのまま（最大 ${formatBytes(MAX_FILE_SIZE)}）`}
                >
                  <div class="file-current">
                    <Icon name="file" />
                    <span class="truncate">{item.fileName}</span>
                    <span class="muted small">{formatBytes(item.fileSize)}</span>
                  </div>
                  <FileInput
                    id="f-file"
                    name="file"
                    aria-invalid={errors.file ? 'true' : undefined}
                    aria-describedby="f-file-error f-file-desc"
                  />
                </FormField>
              </Card>
            )}
          </aside>
        </form>

        <Card tone="danger" class="editor-danger">
          <DangerRow heading="アイテムを削除" description="旧STEP Learn からも削除され、学生の完了記録も消えます。">
            <form method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`}>
              <Button type="submit" variant="danger-outline" size="sm" icon="trash">
                削除
              </Button>
            </form>
          </DangerRow>
        </Card>
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
