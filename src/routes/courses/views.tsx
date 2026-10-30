import {
  CourseForm,
  CourseHeader,
  CreateCourseButton,
  ItemIcon,
  type CourseFormErrors,
  type CourseFormValues,
} from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Card, DangerRow } from '../../components/card'
import { FileField, ImageField, SearchBox, SegmentedControl, SelectField, TextAreaField, TextField } from '../../components/form'
import { cx } from '../../components/cx'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { MarkdownEditor } from '../../components/markdown'
import { Modal, Popover } from '../../components/overlay'
import { Styles } from '../../components/style'
import { Chip, CourseCard, EmptyState, PageHeader, TabPanel, type CourseCardData } from '../../components/ui'
import { courseImageUrl, type CourseAccess, type CourseImageKind } from '../../lib/courses'
import { MAX_IMAGE_SIZE } from '../../lib/images'
import { formatBytes } from '../../lib/storage'
import { ITEM_TYPE_LABELS, type Item, type ItemType, type Section } from '../../lib/types'

export type ItemLite = Pick<Item, 'id' | 'sectionId' | 'type' | 'title' | 'url' | 'fileName' | 'fileSize' | 'hidden'>

// ---------------------------------------------------------------- 一覧

export const CoursesPage = ({
  q,
  isAdmin,
  canCreate,
  results,
}: {
  q: string
  isAdmin: boolean
  canCreate: boolean
  results: CourseCardData[]
}) => (
  <AppShell>
    <PageHeader
      title="コース一覧"
      description={isAdmin ? 'すべてのコースを表示しています。' : '参加しているコースです。'}
      actions={canCreate && <CreateCourseButton />}
    />
    <form method="get" class="toolbar">
      <SearchBox label="コースを検索" value={q} placeholder="コース名・コード・概要で検索" />
    </form>
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
      <div class="course-grid">
        {results.map((course) => (
          <CourseCard course={course} />
        ))}
      </div>
    )}
  </AppShell>
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
  showCheck,
  manage,
}: {
  item: ItemLite
  courseId: number
  done: boolean
  sharing: boolean
  showCheck: boolean
  manage: boolean
}) => {
  const base = `/courses/${courseId}/items/${item.id}`
  const external = item.type === 'link'
  const newTab = item.type === 'link' || item.type === 'screen'
  const href = item.type === 'link' ? item.url : item.type === 'screen' ? `${base}/screen` : base
  const meta =
    item.type === 'link'
      ? hostOf(item.url)
      : item.type === 'file'
        ? `${item.fileName ?? ''} · ${formatBytes(item.fileSize ?? 0)}`
        : ITEM_TYPE_LABELS[item.type]
  return (
    <li class={cx('item-row', done && 'is-done', !!item.hidden && 'is-hidden edit-only')} data-item={item.id}>
      <a
        href={href}
        class="item-link"
        {...(newTab ? { target: '_blank', rel: external ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' } : {})}
      >
        <ItemIcon type={item.type} />
        <span class="item-text">
          <span class="item-title">{item.title}</span>
          <span class="item-meta truncate">{meta}</span>
        </span>
        {item.hidden ? <HiddenChip /> : null}
        {sharing && <Chip tone="live">配信中</Chip>}
        {newTab && <Icon name="external" size={14} class="item-ext" />}
      </a>
      {manage && (
        <div class="row-actions edit-only">
          <IconButton href={`${base}/edit`} icon="pencil" label="編集" />
          <VisibilityButton action={`${base}/visibility`} hidden={!!item.hidden} />
          <MoveButtons action={`${base}/move`} />
          <form method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`}>
            <IconButton type="submit" icon="trash" label="削除" danger />
          </form>
        </div>
      )}
      {showCheck && (
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

const VisibilityButton = ({ action, hidden }: { action: string; hidden: boolean }) => (
  <form method="post" action={action}>
    <input type="hidden" name="hidden" value={hidden ? '0' : '1'} />
    <IconButton type="submit" icon={hidden ? 'eye' : 'eyeSlash'} label={hidden ? '学生に表示する' : '学生に非表示にする'} />
  </form>
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

const AddItemModal = ({ courseId, sections }: { courseId: number; sections: Section[] }) => (
  <Modal id={ADD_ITEM_MODAL} heading="アイテムを追加" description="種類を選んで、最初の設定をしてください。内容はあとから編集できます。">
    <form method="post" action={`/courses/${courseId}/items`} enctype="multipart/form-data" class="stack item-form" data-loading-form>
      <fieldset class="field">
        <legend>種類</legend>
        <div class="kind-options">
          {(['page', 'link', 'file', 'screen'] as const).map((t) => (
            <label class="kind-option">
              <input type="radio" name="type" value={t} checked={t === 'page'} />
              <ItemIcon type={t} />
              <span class="kind-option-text">
                <span class="strong">{ITEM_TYPE_LABELS[t]}</span>
                <span class="muted small">{ITEM_TYPE_DESCRIPTIONS[t]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="タイトル" name="title" id="new-item-title" maxlength={200} placeholder="例：第1回 講義資料" required autofocus />
      <TextField label="URL" name="url" id="new-item-url" type="url" placeholder="https://" fieldClass="when-link" />
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
      <div class="form-actions">
        <Button type="submit" name="then" value="view">
          追加して表示
        </Button>
        <Button type="submit" variant="primary">
          追加
        </Button>
      </div>
    </form>
  </Modal>
)

const MoveButtons = ({ action }: { action: string }) => (
  <>
    <form method="post" action={action}>
      <input type="hidden" name="dir" value="up" />
      <IconButton type="submit" icon="arrowUp" label="上へ" />
    </form>
    <form method="post" action={action}>
      <input type="hidden" name="dir" value="down" />
      <IconButton type="submit" icon="arrowDown" label="下へ" />
    </form>
  </>
)

const SectionEditBar = ({ courseId, section }: { courseId: number; section: Section }) => {
  const base = `/courses/${courseId}/sections/${section.id}`
  return (
    <div class="row-actions edit-only">
      <Popover trigger={<IconButton as="summary" icon="pencil" label="セクションを編集" title="編集" />}>
        <form method="post" action={base} class="stack">
          <TextField label="セクション名" name="title" id={`st-${section.id}`} value={section.title} maxlength={120} required />
          <TextAreaField label="説明" name="summary" id={`ss-${section.id}`} value={section.summary ?? undefined} rows={3} />
          <div class="form-actions">
            <Button type="submit" variant="primary" size="sm">
              保存
            </Button>
          </div>
        </form>
      </Popover>
      <VisibilityButton action={`${base}/visibility`} hidden={!!section.hidden} />
      <MoveButtons action={`${base}/move`} />
      <form method="post" action={`${base}/delete`} data-confirm={`セクション「${section.title}」と中のアイテムをすべて削除しますか？`}>
        <IconButton type="submit" icon="trash" label="削除" danger />
      </form>
    </div>
  )
}

export const CoursePage = ({
  access,
  sectionList,
  itemList,
  done,
  sharing,
}: {
  access: CourseAccess
  sectionList: Section[]
  itemList: ItemLite[]
  done: Set<number>
  /** 画面共有を配信中のアイテムの ID */
  sharing: Set<number>
}) => {
  const id = access.course.id
  const manage = access.canManage
  const isStudent = access.role === 'student'

  const bySection = new Map<number, ItemLite[]>()
  for (const it of itemList) bySection.set(it.sectionId, [...(bySection.get(it.sectionId) ?? []), it])
  const visibleSections = sectionList.filter((s) => !s.hidden)
  // 学生にも同じ番号で見えるよう、表示しているセクションだけで数える
  const sectionNumber = new Map(visibleSections.map((s, i) => [s.id, String(i + 1).padStart(2, '0')]))
  const visibleItems = itemList.filter((it) => !it.hidden && sectionNumber.has(it.sectionId))

  return (
    <AppShell wide editable={manage}>
      <Styles use={['/src/routes/courses/courses.css']} />
      <CourseHeader
        access={access}
        tab="content"
        progress={isStudent ? { done: visibleItems.filter((it) => done.has(it.id)).length, total: visibleItems.length } : undefined}
      />
      <TabPanel>
        {visibleSections.length === 0 && (
          <div class="view-only">
            <EmptyState icon="layers" title="まだ教材がありません" text="教師が教材を追加するとここに表示されます。" />
          </div>
        )}
        {sectionList.length > 0 && (
          <div class="sections">
            {sectionList.map((s) => {
              const list = bySection.get(s.id) ?? []
              const shown = list.filter((it) => !it.hidden)
              const hiddenCount = list.length - shown.length
              const doneCount = shown.filter((it) => done.has(it.id)).length
              return (
                <details class={cx('section-card', !!s.hidden && 'is-hidden edit-only')} id={`section-${s.id}`} open>
                  <summary class="section-head">
                    <span class="section-num">{sectionNumber.get(s.id) ?? <Icon name="eyeSlash" size={14} />}</span>
                    <span class="section-title-wrap">
                      <span class="section-title">{s.title}</span>
                      <span class="muted small">
                        {shown.length} アイテム
                        {isStudent && shown.length > 0 && ` · ${doneCount} 完了`}
                        {hiddenCount > 0 && <span class="edit-only">{` · 非表示 ${hiddenCount}`}</span>}
                      </span>
                    </span>
                    {s.hidden ? <HiddenChip /> : null}
                    {isStudent && shown.length > 0 && doneCount === shown.length && (
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
                          showCheck={isStudent}
                          manage={manage}
                        />
                      ))}
                    </ul>
                  )}
                  {shown.length === 0 && <p class="muted small section-empty view-only">このセクションにはまだアイテムがありません。</p>}
                  {manage && <AddItemButton sectionId={s.id} />}
                </details>
              )
            })}
          </div>
        )}

        {manage && (
          <form method="post" action={`/courses/${id}/sections`} class="add-section edit-only" data-loading-form>
            <Icon name="plus" />
            <input
              class="add-section-input"
              name="title"
              placeholder="新しいセクション名（例：第2週 データの扱い方）"
              maxlength={120}
              required
              aria-label="新しいセクション名"
            />
            <Button type="submit" variant="primary" size="sm">
              セクションを追加
            </Button>
          </form>
        )}
        {manage && sectionList.length > 0 && <AddItemModal courseId={id} sections={sectionList} />}
      </TabPanel>
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
      hint: '横長の画像が向いています（推奨 1600×400px）。',
      aspect: '4 / 1',
    },
  }

const CourseImageCard = ({ courseId, kind, imageKey }: { courseId: number; kind: CourseImageKind; imageKey: string | null }) => {
  const f = COURSE_IMAGE_FIELDS[kind]
  const action = `/courses/${courseId}/${kind}`
  return (
    <Card
      id={`settings-${kind}`}
      heading={f.heading}
      description={f.description}
      actions={
        imageKey && (
          <form method="post" action={`${action}/delete`} data-confirm={`${f.heading}を削除しますか？`}>
            <Button type="submit" variant="danger-outline" size="sm" icon="trash">
              削除
            </Button>
          </form>
        )
      }
    >
      <form method="post" action={action} enctype="multipart/form-data" class="stack" data-loading-form>
        <ImageField
          label="画像ファイル"
          name="image"
          id={`f-${kind}-image`}
          src={courseImageUrl(courseId, kind, imageKey)}
          aspect={f.aspect}
          width={f.width}
          hint={`${f.hint}PNG・JPEG・WebP・GIF、最大 ${formatBytes(MAX_IMAGE_SIZE)}。`}
          required
        />
        <div class="form-actions">
          <Button type="submit" variant="primary" icon="upload">
            {imageKey ? '画像を差し替える' : '画像を設定'}
          </Button>
        </div>
      </form>
    </Card>
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
    <AppShell wide>
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
