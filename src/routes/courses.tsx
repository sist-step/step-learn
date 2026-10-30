import { Hono } from 'hono'
import { CourseForm, CourseHeader, CreateCourseButton, ItemIcon, type CourseFormErrors, type CourseFormValues } from '../components/course'
import { Button, IconButton } from '../components/button'
import { Bento, Card, DangerRow, Tile } from '../components/card'
import { FileField, SearchBox, SegmentedControl, TextAreaField, TextField } from '../components/form'
import { Icon, type IconName } from '../components/icons'
import { AppShell } from '../components/layout'
import { Popover } from '../components/overlay'
import { Styles } from '../components/style'
import { Chip, CourseCard, CourseRow, EmptyState, PageHeader, Progress, ProgressRing, type CourseCardData } from '../components/ui'
import { canCreateCourse, requireAuth } from '../lib/auth'
import { getCourseAccess, type CourseAccess } from '../lib/courses'
import { field, intParam, readForm, redirectWith, type Form } from '../lib/http'
import { isSharing } from '../lib/screen-share'
import { randomTip } from '../lib/tips'
import { deleteCourseFiles, formatBytes, inBackground } from '../lib/storage'
import { COURSE_COLORS, ITEM_TYPE_LABELS, type AppEnv, type Item, type ItemType, type Section } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth)

function parseCourseForm(form: Form) {
  const color = field(form, 'color')
  const values = {
    title: field(form, 'title', 120),
    code: field(form, 'code', 30),
    summary: field(form, 'summary', 2000),
    color: (COURSE_COLORS as readonly string[]).includes(color) ? color : 'cyan',
  } satisfies CourseFormValues
  const errors: CourseFormErrors = {}
  if (!values.title) errors.title = 'コース名を入力してください。'
  return { values, errors, ok: Object.keys(errors).length === 0 }
}

// ---------------------------------------------------------------- 一覧

app.get('/', async (c) => {
  const user = c.var.user!
  const isAdmin = user.role === 'admin'
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const { results } = await db.prepare(
    `SELECT c.id, c.code, c.title, c.summary, c.color, e.role,
            (SELECT COUNT(*) FROM enrollments x WHERE x.course_id = c.id) AS members,
            (SELECT group_concat(u.name, '、') FROM enrollments t JOIN users u ON u.id = t.user_id
              WHERE t.course_id = c.id AND t.role = 'teacher') AS teachers
     FROM courses c
     LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?1
     WHERE (e.role IS NOT NULL OR ?2)
       AND (?3 = '' OR c.title LIKE ?4 OR c.code LIKE ?4 OR c.summary LIKE ?4)
     ORDER BY c.created_at DESC`,
  )
    .bind(user.id, isAdmin ? 1 : 0, q, `%${q}%`)
    .all<CourseCardData>()

  return c.render(
    <AppShell>
      <PageHeader
        title="コース一覧"
        description={isAdmin ? 'すべてのコースを表示しています。' : '参加しているコースです。'}
        actions={canCreateCourse(user) && <CreateCourseButton />}
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
    </AppShell>,
    { title: 'コース一覧' },
  )
})

// ---------------------------------------------------------------- 作成

app.post('/', async (c) => {
  const user = c.var.user!
  if (!canCreateCourse(user)) return c.notFound()
  const { values, errors, ok } = parseCourseForm(await readForm(c))
  // 入力欄の横にエラーを出さないのは、作成フォームが一覧画面のモーダルにあって描き直せないため
  if (!ok) return redirectWith(c, '/courses', Object.values(errors)[0], 'error')

  const course = await db
    .prepare(
      `INSERT INTO courses (code, title, summary, color, created_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(values.code, values.title, values.summary, values.color, user.id)
    .first<{ id: number }>()
  await db.prepare(`INSERT INTO sections (course_id, title, position) VALUES (?, 'はじめに', 1)`).bind(course!.id).run()
  return redirectWith(c, `/courses/${course!.id}`, 'コースを作成しました。参加者タブから教師と学生を追加しましょう。')
})

// ---------------------------------------------------------------- コースページ

type ItemLite = Pick<Item, 'id' | 'section_id' | 'type' | 'title' | 'url' | 'file_name' | 'file_size'>

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
  showCheck,
  manage,
}: {
  item: ItemLite
  courseId: number
  done: boolean
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
        ? `${item.file_name ?? ''} · ${formatBytes(item.file_size ?? 0)}`
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
        {item.type === 'screen' && isSharing(item.id) && <Chip tone="live">配信中</Chip>}
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

app.get('/:id', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const user = c.var.user!
  const manage = access.canManage

  const [secRes, itemRes, doneRes, metaRes] = await db.batch([
    db.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY position, id').bind(id),
    db
      .prepare('SELECT id, section_id, type, title, url, file_name, file_size FROM items WHERE course_id = ? ORDER BY position, id')
      .bind(id),
    db.prepare('SELECT item_id FROM completions WHERE user_id = ? AND course_id = ?').bind(user.id, id),
    db
      .prepare(
        `SELECT COUNT(*) AS members,
                group_concat(CASE WHEN e.role = 'teacher' THEN u.name END, '、') AS teachers
         FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ?`,
      )
      .bind(id),
  ])
  const sections = secRes.results as Section[]
  const items = itemRes.results as ItemLite[]
  const done = new Set((doneRes.results as { item_id: number }[]).map((r) => r.item_id))
  const meta = metaRes.results[0] as { members: number; teachers: string | null }
  const isStudent = access.role === 'student'

  const bySection = new Map<number, ItemLite[]>()
  for (const it of items) bySection.set(it.section_id, [...(bySection.get(it.section_id) ?? []), it])

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
        <Icon name="layers" size={14} /> {items.length}アイテム
      </span>
    </>
  )

  return c.render(
    <AppShell editable={manage}>
      <Styles use={['/src/routes/courses.css']} />
      <CourseHeader
        access={access}
        tab="content"
        meta={metaLine}
        progress={isStudent ? { done: done.size, total: items.length } : undefined}
      />

      {manage && (
        <div class="edit-banner edit-only">
          <Icon name="pencil" size={16} />
          <span>編集モード — セクションやアイテムを追加・並べ替えできます。終了するまでほかのコースでも続きます。</span>
        </div>
      )}

      {sections.length === 0 ? (
        <div class="view-only">
          <EmptyState icon="layers" title="まだ教材がありません" text="教師が教材を追加するとここに表示されます。" />
        </div>
      ) : (
        <div class="sections">
          {sections.map((s, idx) => {
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
                {manage && <SectionEditBar courseId={id!} section={s} />}
                {s.summary && <p class="section-summary">{s.summary}</p>}
                {list.length > 0 ? (
                  <ul class="items">
                    {list.map((it) => (
                      <ItemRow item={it} courseId={id!} done={done.has(it.id)} showCheck={isStudent} manage={manage} />
                    ))}
                  </ul>
                ) : (
                  <p class="muted small section-empty view-only">このセクションにはまだアイテムがありません。</p>
                )}
                {manage && <AddItemForm courseId={id!} sectionId={s.id} />}
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
    </AppShell>,
    { title: access.course.title },
  )
})

// ---------------------------------------------------------------- 退出

app.post('/:id/leave', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.role) return c.notFound()
  const userId = c.var.user!.id

  if (access.role === 'teacher') {
    const t = await db.prepare(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND role = 'teacher'`).bind(id).first<{ n: number }>()
    if ((t?.n ?? 0) <= 1) return redirectWith(c, `/courses/${id}/settings`, '最後の教師はコースから退出できません。', 'error')
  }
  await db.batch([
    db.prepare('DELETE FROM enrollments WHERE course_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM completions WHERE course_id = ? AND user_id = ?').bind(id, userId),
  ])
  return redirectWith(c, '/dashboard', `「${access.course.title}」から退出しました。`, 'info')
})

// ---------------------------------------------------------------- 設定

const SettingsPage = ({ access, values, errors }: { access: CourseAccess; values: CourseFormValues; errors?: CourseFormErrors }) => {
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

app.get('/:id/settings', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  return c.render(<SettingsPage access={access} values={access.course} />, {
    title: `設定 - ${access.course.title}`,
  })
})

app.post('/:id/settings', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  const { values, errors, ok } = parseCourseForm(await readForm(c))
  if (!ok) {
    c.status(422)
    return c.render(<SettingsPage access={access} values={values} errors={errors} />, { title: `設定 - ${access.course.title}` })
  }
  await db.prepare(
    `UPDATE courses SET code = ?, title = ?, summary = ?, color = ?, updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(values.code, values.title, values.summary, values.color, id)
    .run()
  return redirectWith(c, `/courses/${id}/settings`, '設定を保存しました。')
})

app.post('/:id/delete', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access || !access.canManage) return c.notFound()
  await db.prepare('DELETE FROM courses WHERE id = ?').bind(id).run()
  inBackground(deleteCourseFiles(id!))
  return redirectWith(c, '/dashboard', `「${access.course.title}」を削除しました。`, 'info')
})

export default app

// ---------------------------------------------------------------- ダッシュボード

export const dashboard = new Hono<AppEnv>()
dashboard.use(requireAuth)

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
}

dashboard.get('/', async (c) => {
  const user = c.var.user!
  const { results } = await db.prepare(
    `SELECT c.id, c.code, c.title, c.summary, c.color, e.role,
            (SELECT COUNT(*) FROM items i WHERE i.course_id = c.id) AS total,
            (SELECT COUNT(*) FROM completions k WHERE k.user_id = ?1 AND k.course_id = c.id) AS done,
            (SELECT COUNT(*) FROM enrollments x WHERE x.course_id = c.id) AS members
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = ?1
     ORDER BY e.created_at DESC`,
  )
    .bind(user.id)
    .all<CourseCardData>()

  const teaching = results.filter((r) => r.role === 'teacher')
  const learning = results.filter((r) => r.role === 'student')
  const totalItems = learning.reduce((n, r) => n + (r.total ?? 0), 0)
  const doneItems = learning.reduce((n, r) => n + (r.done ?? 0), 0)
  const next = learning.find((r) => (r.total ?? 0) > (r.done ?? 0))

  const members = teaching.reduce((n, r) => n + (r.members ?? 0), 0)

  return c.render(
    <AppShell>
      <Styles use={['/src/routes/dashboard.css']} />
      <Bento>
        <Tile span={2} class="tile-welcome">
          <div class="eyebrow">
            {new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
          </div>
          <h1>{`${greeting()}、${user.name}さん`}</h1>
          <p class="tile-tip">{randomTip()}</p>
          {canCreateCourse(user) && (
            <div class="tile-actions">
              <CreateCourseButton />
            </div>
          )}
        </Tile>
        {learning.length > 0 ? (
          <>
            <Tile class="tile-stat">
              <span class="stat-label">全体の進捗</span>
              <ProgressRing done={doneItems} total={totalItems} />
            </Tile>
            <Tile class="tile-stat">
              <span class="stat-label">完了したアイテム</span>
              <span class="stat-value">
                {doneItems}
                <small> / {totalItems}</small>
              </span>
            </Tile>
          </>
        ) : (
          <>
            <Tile class="tile-stat">
              <span class="stat-label">担当しているコース</span>
              <span class="stat-value">{teaching.length}</span>
            </Tile>
            <Tile class="tile-stat">
              <span class="stat-label">参加者（延べ）</span>
              <span class="stat-value">{members}</span>
            </Tile>
          </>
        )}
        {next && (
          <Tile href={`/courses/${next.id}`} rows={2} class={`tile-feature tone-${next.color}`}>
            <span class="tile-feature-label">続きから学習</span>
            <span class="course-mono">{[...(next.code || next.title)].slice(0, 2).join('')}</span>
            <strong class="tile-feature-title">{next.title}</strong>
            <Progress done={next.done ?? 0} total={next.total ?? 0} />
            <span class="tile-feature-cta">
              学習を再開 <Icon name="chevronRight" size={16} />
            </span>
          </Tile>
        )}
        <Tile span={next ? 3 : 4} rows={next ? 2 : 1} class="tile-courses">
          <div class="tile-head">
            <h2>
              マイコース <span class="count">{results.length}</span>
            </h2>
            <a href="/courses" class="tile-link">
              すべて見る <Icon name="chevronRight" size={14} />
            </a>
          </div>
          {results.length > 0 ? (
            <div class="course-rows">
              {results.map((course) => (
                <CourseRow course={course} />
              ))}
            </div>
          ) : (
            <EmptyState icon="book" title="まだ参加しているコースはありません" text="コースに追加されると、ここに表示されます。" />
          )}
        </Tile>
      </Bento>
    </AppShell>,
    { title: 'ダッシュボード' },
  )
})
