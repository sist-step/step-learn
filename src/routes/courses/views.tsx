import {
  CourseForm,
  CompletionField,
  CourseHeader,
  CourseLiveSync,
  CreateCourseButton,
  ItemIcon,
  LinkTargetField,
  linkOpenAttrs,
  nextActionLabel,
  type CourseFormErrors,
  type CourseFormValues,
} from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Card, DangerRow } from '../../components/card'
import {
  FileField,
  ImageField,
  SearchBox,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
  validateWith,
} from '../../components/form'
import { cx } from '../../components/cx'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { MarkdownEditor } from '../../components/markdown'
import { MenuItem, Modal, Popover } from '../../components/overlay'
import { Styles } from '../../components/style'
import { Chip, CourseCard, EmptyState, PageHeader, TabPanel, shownByDefault, type CourseCardData } from '../../components/ui'
import { courseImageUrl, type CourseImageKind } from '../../lib/course-images'
import type { CourseAccess } from '../../lib/courses'
import { MAX_IMAGE_SIZE } from '../../lib/images'
import { previewKind } from '../../lib/preview'
import { formatBytes } from '../../lib/bytes'
import { COMPLETION_LABELS, ITEM_TYPE_LABELS, type Completion, type Item, type ItemType, type Section } from '../../lib/types'

export type ItemLite = Pick<
  Item,
  'id' | 'sectionId' | 'type' | 'title' | 'url' | 'linkTarget' | 'fileName' | 'fileSize' | 'fileType' | 'hidden' | 'completion'
>

// ---------------------------------------------------------------- 一覧

const CourseScopeControl = ({ showsOthers }: { showsOthers: boolean }) => (
  <div class="course-scope">
    <SegmentedControl
      name="course_scope"
      label="表示するコース"
      options={[
        { value: 'current', label: '進行中', icon: 'calendar' },
        { value: 'all', label: 'すべて', icon: 'layers' },
      ]}
      value="current"
      data-course-scope
    />
    {showsOthers && (
      <Button icon="plus" aria-pressed="false" data-courses-others-toggle>
        登録外も表示
      </Button>
    )}
  </div>
)

export const CoursesPage = ({
  q,
  isAdmin,
  showsOthers,
  canCreate,
  results,
}: {
  q: string
  isAdmin: boolean
  showsOthers: boolean
  canCreate: boolean
  results: CourseCardData[]
}) => (
  <AppShell>
    <Styles use={['/src/routes/courses/courses.css']} />
    <PageHeader
      title="コース一覧"
      description={showsOthers ? '「すべて」では、登録していないコースも表示できます。' : '参加しているコースです。'}
      actions={canCreate && <CreateCourseButton />}
    />
    <div class="toolbar courses-toolbar">
      <form method="get" class="toolbar-grow">
        <SearchBox label="コースを検索" value={q} placeholder="コース名・コード・概要で検索" />
      </form>
      <CourseScopeControl showsOthers={showsOthers} />
    </div>
    {results.length === 0 ? (
      <EmptyState
        icon="book"
        title={q ? `「${q}」に一致するコースはありません` : isAdmin ? 'まだコースがありません' : 'まだ参加しているコースはありません'}
        text={
          q
            ? '別のキーワードで検索してみてください。'
            : isAdmin
              ? '「コースを作成」から最初のコースを作りましょう。'
              : 'コースに追加されると、ここに表示されます。'
        }
        action={q && <Button href="/courses">検索をクリア</Button>}
      />
    ) : (
      <div data-course-list>
        <div class="course-grid">
          {results.map((course) => (
            <CourseCard course={course} showProgress={course.role === 'student' && (course.total ?? 0) > 0} />
          ))}
        </div>
        <FilteredEmpty hidden={results.some(shownByDefault)} showsOthers={showsOthers} />
      </div>
    )}
  </AppShell>
)

const FilteredEmpty = ({ hidden, showsOthers }: { hidden: boolean; showsOthers: boolean }) => (
  <div data-courses-empty hidden={hidden}>
    <EmptyState
      icon="calendar"
      title="表示するコースはありません"
      text={
        showsOthers
          ? '「すべて」に切り替えて「登録外も表示」を選ぶと、期間外や登録していないコースも表示できます。'
          : '「すべて」に切り替えると、期間外のコースも表示できます。'
      }
    />
  </div>
)

// ---------------------------------------------------------------- コースページ

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const ItemRow = ({
  item,
  courseId,
  done,
  sharing,
  completion,
  isStudent,
  manage,
}: {
  item: ItemLite
  courseId: number
  done: boolean
  sharing: boolean
  completion: Completion | null
  isStudent: boolean
  manage: boolean
}) => {
  const base = `/courses/${courseId}/items/${item.id}`
  const tracked = completion && completion !== 'none'
  const external = item.type === 'link' && item.linkTarget !== 'embed'
  const opensToComplete = isStudent && completion === 'view' && external && !done
  const pdf = item.type === 'file' && previewKind(item.fileType ?? '', item.fileName ?? '') === 'pdf'
  const newTab = item.type === 'screen' || pdf
  const href = item.type === 'screen' ? `${base}/screen` : base
  const meta =
    item.type === 'link'
      ? hostOf(item.url)
      : item.type === 'file'
        ? `${item.fileName ?? ''} · ${formatBytes(item.fileSize ?? 0)}`
        : ITEM_TYPE_LABELS[item.type]
  return (
    <li class={cx('item-row', tracked && done && 'is-done', !!item.hidden && 'is-hidden edit-only')} data-item={item.id}>
      <a
        href={href}
        class="item-link"
        {...(newTab ? { target: '_blank', rel: 'noopener', 'data-no-prefetch': '' } : {})}
        {...(item.type === 'link' ? linkOpenAttrs(item.url, item.linkTarget, base) : {})}
        {...(opensToComplete ? { 'data-complete-on-open': `${base}/complete` } : {})}
      >
        <ItemIcon type={item.type} />
        <span class="item-text">
          <span class="item-title">{item.title}</span>
          <span class="item-meta truncate">{meta}</span>
        </span>
        {item.hidden ? <HiddenChip /> : null}
        {manage && tracked && (
          <Chip icon="check" class="edit-only">
            {COMPLETION_LABELS[completion]}
          </Chip>
        )}
        {sharing && <Chip tone="live">配信中</Chip>}
        {newTab || external ? <Icon name="external" size={14} class="item-ext" /> : <Icon name="chevronRight" size={16} class="item-ext" />}
      </a>
      {manage && (
        <div class="row-actions edit-only">
          <IconButton href={`${base}/edit`} icon="pencil" label="編集" />
          <RowMenu base={base} moveAction={`${base}/move`} hidden={!!item.hidden} confirm={`「${item.title}」を削除しますか？`} />
        </div>
      )}
      {isStudent && tracked && completion !== 'manual' && (
        <span
          class="check check-auto"
          role="img"
          aria-label={done ? '完了済み' : COMPLETION_LABELS[completion]}
          title={done ? '完了済み' : COMPLETION_LABELS[completion]}
          data-complete-check={item.id}
          data-done={done ? 'true' : 'false'}
        >
          <Icon name="check" size={14} />
        </span>
      )}
      {isStudent && completion === 'manual' && (
        <form method="post" action={`${base}/complete`} class={manage ? 'view-only' : undefined} data-complete>
          <button
            type="submit"
            class="check"
            aria-pressed={done ? 'true' : 'false'}
            aria-label={done ? '未完了に戻す' : '完了にする'}
            title={done ? '完了済み' : '完了にする'}
          >
            <Icon name="check" size={14} />
          </button>
        </form>
      )}
    </li>
  )
}

const HiddenChip = () => <Chip icon="eyeSlash">学生に非表示</Chip>

const RowMenu = ({ base, moveAction, hidden, confirm }: { base: string; moveAction: string; hidden: boolean; confirm: string }) => (
  <Popover class="row-menu" panelClass="row-menu-panel" trigger={<IconButton as="summary" icon="ellipsis" label="その他の操作" />}>
    <form method="post" action={moveAction}>
      <input type="hidden" name="dir" value="up" />
      <MenuItem type="submit" icon="arrowUp">
        上へ移動
      </MenuItem>
    </form>
    <form method="post" action={moveAction}>
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

const ADD_ITEM_MODAL = 'add-item'

const ITEM_TYPE_DESCRIPTIONS: Record<ItemType, string> = {
  page: '本文を書いて載せる',
  link: '外部のサイトを紹介する',
  file: 'PDF や画像などを配る',
  screen: '授業中に画面を配信する',
}

const AddItemButton = ({ sectionId }: { sectionId: number }) => (
  <button type="button" class="add-item edit-only" popovertarget={ADD_ITEM_MODAL} data-add-item-section={sectionId}>
    <Icon name="plus" size={16} /> アイテムを追加
  </button>
)

const ITEM_TYPES = ['page', 'link', 'file', 'screen'] as const

const KindOptionBody = ({ type }: { type: ItemType }) => (
  <>
    <ItemIcon type={type} />
    <span class="kind-option-text">
      <span class="strong">{ITEM_TYPE_LABELS[type]}</span>
      <span class="muted small">{ITEM_TYPE_DESCRIPTIONS[type]}</span>
    </span>
  </>
)

// 種類の選択と設定を別のフォームにしないのは、設定まで進んでから種類を選び直しても入力した値を残すため
const AddItemModal = ({ courseId, sections, tracking }: { courseId: number; sections: Section[]; tracking: boolean }) => (
  <Modal id={ADD_ITEM_MODAL} heading="アイテムを追加" description="種類を選んでから、最初の設定をします。内容はあとから編集できます。">
    <form
      method="post"
      action={`/courses/${courseId}/items`}
      enctype="multipart/form-data"
      class="item-form item-steps"
      data-loading-form
      data-item-steps
      data-step="kind"
      data-kind="page"
      {...validateWith('item')}
    >
      <input type="hidden" name="type" value="page" />
      <div class="item-step kind-picker" role="group" aria-label="種類">
        {ITEM_TYPES.map((t) => (
          <button type="button" class="kind-option" data-pick-kind={t}>
            <KindOptionBody type={t} />
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
      </div>
      <div class="item-step kind-settings stack">
        <div class="kind-summary">
          {ITEM_TYPES.map((t) => (
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
        <LinkTargetField id="new-item-link-target" fieldClass="when-link" />
        <FileField
          label="ファイル"
          name="file"
          id="new-item-file"
          hint="最大 30MB。PDF・画像はブラウザでプレビューできます。"
          fieldClass="when-file"
        />
        <MarkdownEditor
          label={
            <>
              <span class="when-page-inline">本文（任意）</span>
              <span class="when-other-inline">説明（任意）</span>
            </>
          }
          name="body"
          id="new-item-body"
          rows={4}
          placeholder="あとから編集画面でも書けます"
        />
        <div class="grid-2">
          <SelectField
            label="セクション"
            name="section_id"
            id="new-item-section"
            options={sections.map((s) => ({ value: String(s.id), label: s.title }))}
          />
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
        {tracking && <CompletionField id="new-item-completion" />}
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

const ADD_SECTION_MODAL = 'add-section'

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

const SectionEditBar = ({ courseId, section }: { courseId: number; section: Section }) => {
  const base = `/courses/${courseId}/sections/${section.id}`
  return (
    <div class="row-actions edit-only">
      <Popover trigger={<IconButton as="summary" icon="pencil" label="セクションを編集" title="編集" />}>
        <form method="post" action={base} class="stack" {...validateWith('section')}>
          <TextField label="セクション名" name="title" id={`st-${section.id}`} value={section.title} />
          <TextAreaField label="説明" name="summary" id={`ss-${section.id}`} value={section.summary ?? undefined} rows={3} />
          <div class="form-actions">
            <Button type="submit" variant="primary" size="sm">
              保存
            </Button>
          </div>
        </form>
      </Popover>
      <RowMenu
        base={base}
        moveAction={`${base}/move`}
        hidden={!!section.hidden}
        confirm={`セクション「${section.title}」と中のアイテムをすべて削除しますか？`}
      />
    </div>
  )
}

export const CoursePage = ({
  access,
  sectionList,
  itemList,
  done,
  sharing,
  revision,
}: {
  access: CourseAccess
  sectionList: Section[]
  itemList: ItemLite[]
  done: Set<number>
  /** 画面共有を配信中のアイテムの ID */
  sharing: Set<number>
  revision: string
}) => {
  const id = access.course.id
  const manage = access.canManage
  const isStudent = access.role === 'student'

  const bySection = new Map<number, ItemLite[]>()
  for (const it of itemList) bySection.set(it.sectionId, [...(bySection.get(it.sectionId) ?? []), it])
  const visibleSections = sectionList.filter((s) => !s.hidden)
  // 学生にも同じ番号で見えるよう、表示しているセクションだけで数える
  const sectionNumber = new Map(visibleSections.map((s, i) => [s.id, String(i + 1).padStart(2, '0')]))
  const tracking = !!access.course.completionEnabled
  const isTracked = (it: ItemLite) => tracking && it.completion !== 'none'
  const trackedItems = itemList.filter((it) => !it.hidden && sectionNumber.has(it.sectionId) && isTracked(it))
  const ordered = visibleSections.flatMap((s) => (bySection.get(s.id) ?? []).filter((it) => !it.hidden))
  const doneCount = trackedItems.filter((it) => done.has(it.id)).length
  const nextItem = ordered.find((it) => isTracked(it) && !done.has(it.id)) ?? (trackedItems.length === 0 ? ordered[0] : undefined)

  return (
    <AppShell editable={manage} tone={access.course.color}>
      <Styles use={['/src/routes/courses/courses.css']} />
      <CourseHeader
        access={access}
        tab="content"
        progress={isStudent ? { done: doneCount, total: trackedItems.length } : undefined}
        actions={
          isStudent &&
          nextItem && (
            <div class="course-next">
              <Button href={`/courses/${id}/items/${nextItem.id}`} variant="primary" iconEnd="chevronRight">
                {nextActionLabel(doneCount)}
              </Button>
              <span class="course-next-meta muted small truncate">次: {nextItem.title}</span>
            </div>
          )
        }
        tabActions={
          manage && (
            <Button variant="primary" icon="plus" class="edit-only" popovertarget={ADD_SECTION_MODAL}>
              セクションを追加
            </Button>
          )
        }
      />
      <TabPanel>
        {visibleSections.length === 0 && (
          <div class="view-only">
            {manage ? (
              <EmptyState
                icon="layers"
                title={sectionList.length > 0 ? '学生に表示している教材はありません' : 'まだ教材がありません'}
                text={
                  sectionList.length > 0
                    ? 'すべてのセクションが非表示です。編集モードで表示を切り替えられます。'
                    : '編集モードにして、最初のセクションを追加しましょう。'
                }
                action={
                  <Button variant="primary" icon="pencil" role="switch" aria-checked="false" data-edit-mode-toggle>
                    編集を始める
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="layers" title="まだ教材がありません" text="教師が教材を追加するとここに表示されます。" />
            )}
          </div>
        )}
        {manage && sectionList.length === 0 && (
          <div class="edit-only">
            <EmptyState
              icon="layers"
              title="最初のセクションを追加しましょう"
              text="セクションは「第1回」「第2週」のような教材のまとまりです。"
              action={
                <Button variant="primary" icon="plus" popovertarget={ADD_SECTION_MODAL}>
                  セクションを追加
                </Button>
              }
            />
          </div>
        )}
        {sectionList.length > 0 && (
          <div class="sections">
            {sectionList.map((s) => {
              const list = bySection.get(s.id) ?? []
              const shown = list.filter((it) => !it.hidden)
              const hiddenCount = list.length - shown.length
              const shownTracked = shown.filter(isTracked)
              const sectionDone = shownTracked.filter((it) => done.has(it.id)).length
              const empty = !manage && shown.length === 0
              const emptyView = manage && shown.length === 0
              return (
                <details
                  class={cx('section-card', !!s.hidden && 'is-hidden edit-only', empty && 'is-empty', emptyView && 'is-empty-view')}
                  id={`section-${s.id}`}
                  open
                >
                  <summary class="section-head">
                    <span class="section-num">{sectionNumber.get(s.id) ?? <Icon name="eyeSlash" size={14} />}</span>
                    <span class="section-title-wrap">
                      <span class="section-title">{s.title}</span>
                      {!empty && (
                        <span class="muted small">
                          {emptyView && <span class="view-only">{hiddenCount > 0 ? `非表示 ${hiddenCount}` : 'アイテムなし'}</span>}
                          <span class={emptyView ? 'edit-only' : undefined}>{`${shown.length} アイテム`}</span>
                          {isStudent && shownTracked.length > 0 && ` · ${sectionDone} 完了`}
                          {hiddenCount > 0 && <span class="edit-only">{` · 非表示 ${hiddenCount}`}</span>}
                        </span>
                      )}
                    </span>
                    {empty && <Chip>準備中</Chip>}
                    {s.hidden ? <HiddenChip /> : null}
                    {isStudent && shownTracked.length > 0 && sectionDone === shownTracked.length && (
                      <Chip tone="success" icon="check">
                        完了
                      </Chip>
                    )}
                    <Icon name="chevronDown" class="section-caret" />
                  </summary>
                  {manage && <SectionEditBar courseId={id} section={s} />}
                  {s.summary && <p class="section-summary">{s.summary}</p>}
                  {list.length > 0 && (
                    <ul class="items">
                      {list.map((it) => (
                        <ItemRow
                          item={it}
                          courseId={id}
                          done={done.has(it.id)}
                          sharing={sharing.has(it.id)}
                          completion={tracking ? it.completion : null}
                          isStudent={isStudent}
                          manage={manage}
                        />
                      ))}
                    </ul>
                  )}
                  {manage && <AddItemButton sectionId={s.id} />}
                </details>
              )
            })}
          </div>
        )}

        {manage && <AddSectionModal courseId={id} />}
        {manage && sectionList.length > 0 && <AddItemModal courseId={id} sections={sectionList} tracking={tracking} />}
      </TabPanel>
      <CourseLiveSync courseId={id} revision={revision} />
    </AppShell>
  )
}

// ---------------------------------------------------------------- 設定

const COURSE_IMAGE_FIELDS: Record<CourseImageKind, { heading: string; description: string; hint: string; aspect: string; width?: number }> =
  {
    icon: {
      heading: 'コースアイコン',
      description: 'コース名の横と、左のメニューに表示されます。未設定のときはコースコード（なければコース名）の頭文字を表示します。',
      hint: '正方形の画像が向いています（推奨 256×256px 以上）。',
      aspect: '1 / 1',
      width: 120,
    },
    hero: {
      heading: 'ヒーロー画像',
      description: 'コースページの上部と、コース一覧のカードに表示されます。',
      hint: '横長の画像が向いています（推奨 1600×400px）。表示する場所に合わせて端が切り取られるので、大事な部分は中央に置いてください。',
      aspect: '5 / 1',
    },
  }

const CourseImageCard = ({ courseId, kind, imageKey }: { courseId: number; kind: CourseImageKind; imageKey: string | null }) => {
  const f = COURSE_IMAGE_FIELDS[kind]
  const action = `/courses/${courseId}/${kind}`
  return (
    <>
      <Card id={`settings-${kind}`} heading={f.heading} description={f.description}>
        <form method="post" action={action} enctype="multipart/form-data" class="stack" data-loading-form {...validateWith('image')}>
          <ImageField
            label="画像ファイル"
            name="image"
            id={`f-${kind}-image`}
            src={courseImageUrl(courseId, kind, imageKey)}
            aspect={f.aspect}
            width={f.width}
            hint={`${f.hint}PNG・JPEG・WebP・GIF、最大 ${formatBytes(MAX_IMAGE_SIZE)}。`}
          />
          <div class="form-actions">
            {imageKey && (
              <Button type="submit" form={`${kind}-delete`} variant="ghost" icon="trash" class="image-delete">
                画像を削除
              </Button>
            )}
            <Button type="submit" icon="check" class="image-save">
              この画像を保存
            </Button>
          </div>
        </form>
      </Card>
      {imageKey && (
        <form id={`${kind}-delete`} method="post" action={`${action}/delete`} data-confirm={`${f.heading}を削除しますか？`} hidden />
      )}
    </>
  )
}

const SETTINGS_SECTIONS: { id: string; label: string; icon: IconName; danger?: boolean }[] = [
  { id: 'settings-basic', label: '基本情報', icon: 'pencil' },
  { id: 'settings-icon', label: 'コースアイコン', icon: 'photo' },
  { id: 'settings-hero', label: 'ヒーロー画像', icon: 'photo' },
  { id: 'settings-danger', label: '危険な操作', icon: 'alert', danger: true },
]

export const SettingsPage = ({ access, values, errors }: { access: CourseAccess; values: CourseFormValues; errors?: CourseFormErrors }) => {
  const id = access.course.id
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/courses/courses.css']} />
      <CourseHeader access={access} tab="settings" />
      <TabPanel>
        <div class="settings-layout">
          <nav class="settings-toc" aria-label="設定の目次" data-toc>
            <span class="settings-toc-title">設定の項目</span>
            {SETTINGS_SECTIONS.map((s) => (
              <a href={`#${s.id}`} class={s.danger ? 'is-danger' : undefined}>
                <Icon name={s.icon} size={16} />
                {s.label}
              </a>
            ))}
          </nav>
          <div class="stack-lg">
            <CourseForm
              id="settings-basic"
              heading="基本情報"
              description="一覧やコースページに表示される名前・説明・カラーと、完了ステータスの設定です。"
              action={`/courses/${id}/settings`}
              values={values}
              errors={errors}
              submitLabel="変更を保存"
              cancelHref={`/courses/${id}`}
            />

            <CourseImageCard courseId={id} kind="icon" imageKey={access.course.iconImage} />
            <CourseImageCard courseId={id} kind="hero" imageKey={access.course.heroImage} />

            <Card id="settings-danger" tone="danger" heading="危険な操作" description="これらの操作は取り消せません。">
              {access.role && (
                <DangerRow heading="コースから退出" description="自分の登録と進捗を削除します。">
                  <form method="post" action={`/courses/${id}/leave`} data-confirm="このコースから退出しますか？">
                    <Button type="submit" variant="danger-outline">
                      退出
                    </Button>
                  </form>
                </DangerRow>
              )}
              <DangerRow heading="コースを削除" description="セクション・教材・ファイル・参加者の登録がすべて削除されます。">
                <form method="post" action={`/courses/${id}/delete`} data-confirm={`「${access.course.title}」を完全に削除しますか？`}>
                  <Button type="submit" variant="danger">
                    コースを削除
                  </Button>
                </form>
              </DangerRow>
            </Card>
          </div>
        </div>
      </TabPanel>
    </AppShell>
  )
}
