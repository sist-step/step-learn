import { CourseForm, CourseHeader, CreateCourseButton, ItemIcon, type CourseFormErrors, type CourseFormValues } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { Card, DangerRow } from '../../components/card'
import { FileField, SearchBox, SegmentedControl, TextAreaField, TextField } from '../../components/form'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Popover } from '../../components/overlay'
import { Styles } from '../../components/style'
import { Chip, CourseCard, EmptyState, PageHeader, type CourseCardData } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { formatBytes } from '../../lib/storage'
import { ITEM_TYPE_LABELS, type Item, type ItemType, type Section } from '../../lib/types'

export type ItemLite = Pick<Item, 'id' | 'sectionId' | 'type' | 'title' | 'url' | 'fileName' | 'fileSize'>

export type CourseMeta = { members: number; teachers: string | null }

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
          q ? '別のキーワードで検索してみてください。' : isAdmin ? '「コースを作成」から最初のコースを作りましょう。' : 'コースに追加されると、ここに表示されます。'
        }
        action={
          q && (
            <Button href="/courses">検索をクリア</Button>
          )
        }
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
    <li class={done ? 'item-row is-done' : 'item-row'} data-item={item.id}>
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
        {sharing && <Chip tone="live">配信中</Chip>}
        {newTab && <Icon name="external" size={14} class="item-ext" />}
      </a>
      {manage && (
        <div class="row-actions edit-only">
          <IconButton href={`${base}/edit`} icon="pencil" label="編集" />
          <MoveButtons action={`${base}/move`} />
          <form method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`}>
            <IconButton type="submit" icon="trash" label="削除" danger />
          </form>
        </div>
      )}
      {showCheck && (
        <form method="post" action={`${base}/complete`} class={manage ? 'view-only' : undefined} data-complete>
          <button type="submit" class="check" aria-pressed={done ? 'true' : 'false'} aria-label={done ? '未完了に戻す' : '完了にする'} title={done ? '完了済み' : '完了にする'}>
            <Icon name="check" size={14} />
          </button>
        </form>
      )}
    </li>
  )
}

const ADD_ITEM_ICONS: Record<ItemType, IconName> = { page: 'page', link: 'link', file: 'upload', screen: 'monitor' }
const ADD_ITEM_OPTIONS = (['page', 'link', 'file', 'screen'] as const).map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t], icon: ADD_ITEM_ICONS[t] }))

const AddItemForm = ({ courseId, sectionId }: { courseId: number; sectionId: number }) => (
  <details class="add-item" data-autofocus-details>
    <summary>
      <Icon name="plus" size={16} /> アイテムを追加
    </summary>
    <form method="post" action={`/courses/${courseId}/items`} enctype="multipart/form-data" class="stack item-form" data-loading-form>
      <input type="hidden" name="section_id" value={String(sectionId)} />
      <SegmentedControl name="type" label="種類" options={ADD_ITEM_OPTIONS} />
      <TextField label="タイトル" name="title" id={`t-${sectionId}`} maxlength={200} placeholder="例：第1回 講義資料" required />
      <TextField label="URL" name="url" id={`u-${sectionId}`} type="url" placeholder="https://" fieldClass="when-link" />
      <FileField label="ファイル" name="file" id={`f-${sectionId}`} hint="最大 30MB。PDF・画像はブラウザでプレビューできます。" fieldClass="when-file" />
      <TextAreaField
        label={
          <>
            <span class="when-page-inline">本文</span>
            <span class="when-other-inline">説明（任意）</span>
          </>
        }
        name="body"
        id={`b-${sectionId}`}
        placeholder="Markdown が使えます（# 見出し、**太字**、- 箇条書き、[リンク](https://…)）"
      />
      <div class="form-actions">
        <Button type="submit" variant="primary" size="sm">
          追加
        </Button>
      </div>
    </form>
  </details>
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
  meta,
}: {
  access: CourseAccess
  sectionList: Section[]
  itemList: ItemLite[]
  done: Set<number>
  /** 画面共有を配信中のアイテムの ID */
  sharing: Set<number>
  meta: CourseMeta
}) => {
  const id = access.course.id
  const manage = access.canManage
  const isStudent = access.role === 'student'

  const bySection = new Map<number, ItemLite[]>()
  for (const it of itemList) bySection.set(it.sectionId, [...(bySection.get(it.sectionId) ?? []), it])

  const metaLine = (
    <>
      {meta.teachers && (
        <span>
          <Icon name="user" size={14} /> {meta.teachers}
        </span>
      )}
      <span>
        <Icon name="users" size={14} /> {meta.members}人
      </span>
      <span>
        <Icon name="layers" size={14} /> {itemList.length}アイテム
      </span>
    </>
  )

  return (
    <AppShell editable={manage}>
      <Styles use={['/src/routes/courses/courses.css']} />
      <CourseHeader
        access={access}
        tab="content"
        meta={metaLine}
        progress={isStudent ? { done: done.size, total: itemList.length } : undefined}
      />

      {manage && (
        <div class="edit-banner edit-only">
          <Icon name="pencil" size={16} />
          <span>編集モード — セクションやアイテムを追加・並べ替えできます。終了するまでほかのコースでも続きます。</span>
        </div>
      )}

      {sectionList.length === 0 ? (
        <div class="view-only">
          <EmptyState icon="layers" title="まだ教材がありません" text="教師が教材を追加するとここに表示されます。" />
        </div>
      ) : (
        <div class="sections">
          {sectionList.map((s, idx) => {
            const list = bySection.get(s.id) ?? []
            const doneCount = list.filter((it) => done.has(it.id)).length
            return (
              <details class="section-card" id={`section-${s.id}`} open>
                <summary class="section-head">
                  <span class="section-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span class="section-title-wrap">
                    <span class="section-title">{s.title}</span>
                    <span class="muted small">
                      {list.length} アイテム
                      {isStudent && list.length > 0 && ` · ${doneCount} 完了`}
                    </span>
                  </span>
                  {isStudent && list.length > 0 && doneCount === list.length && (
                    <Chip tone="success" icon="check">
                      完了
                    </Chip>
                  )}
                  <Icon name="chevronDown" class="section-caret" />
                </summary>
                {manage && <SectionEditBar courseId={id} section={s} />}
                {s.summary && <p class="section-summary">{s.summary}</p>}
                {list.length > 0 ? (
                  <ul class="items">
                    {list.map((it) => (
                      <ItemRow item={it} courseId={id} done={done.has(it.id)} sharing={sharing.has(it.id)} showCheck={isStudent} manage={manage} />
                    ))}
                  </ul>
                ) : (
                  <p class="muted small section-empty view-only">このセクションにはまだアイテムがありません。</p>
                )}
                {manage && <AddItemForm courseId={id} sectionId={s.id} />}
              </details>
            )
          })}
        </div>
      )}

      {manage && (
        <form method="post" action={`/courses/${id}/sections`} class="add-section edit-only" data-loading-form>
          <Icon name="plus" />
          <input class="add-section-input" name="title" placeholder="新しいセクション名（例：第2週 データの扱い方）" maxlength={120} required aria-label="新しいセクション名" />
          <Button type="submit" variant="primary" size="sm">
            セクションを追加
          </Button>
        </form>
      )}
    </AppShell>
  )
}

// ---------------------------------------------------------------- 設定

export const SettingsPage = ({ access, values, errors }: { access: CourseAccess; values: CourseFormValues; errors?: CourseFormErrors }) => {
  const id = access.course.id
  return (
    <AppShell>
      <CourseHeader access={access} tab="settings" />
      <div class="stack-lg">
        <CourseForm action={`/courses/${id}/settings`} values={values} errors={errors} submitLabel="変更を保存" cancelHref={`/courses/${id}`} />

        <Card tone="danger" heading="危険な操作" description="これらの操作は取り消せません。">
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
    </AppShell>
  )
}
