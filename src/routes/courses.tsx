import { Hono } from 'hono'
import { CourseForm, CourseHeader, CreateCourseButton, ItemIcon, type CourseFormErrors, type CourseFormValues } from '../components/course'
import { Icon, type IconName } from '../components/icons'
import { AppShell } from '../components/layout'
import { CourseCard, EmptyState, PageHeader, Progress, type CourseCardData } from '../components/ui'
import { canCreateCourse, requireAuth } from '../lib/auth'
import { getCourseAccess, type CourseAccess } from '../lib/courses'
import { field, intParam, isEditMode, readForm, redirectWith, setEditMode, type Form } from '../lib/http'
import { isSharing } from '../lib/screen-share'
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
        <label class="search">
          <Icon name="search" />
          <input type="search" name="q" value={q} placeholder="コース名・コード・概要で検索" data-search aria-label="コースを検索" />
          <kbd>/</kbd>
        </label>
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
              <a href="/courses" class="btn">
                検索をクリア
              </a>
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
  setEditMode(c, true)
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
  edit,
}: {
  item: ItemLite
  courseId: number
  done: boolean
  showCheck: boolean
  edit: boolean
}) => {
  const base = `/courses/${courseId}/items/${item.id}`
  const external = item.type === 'link' && !edit
  const newTab = (item.type === 'link' || item.type === 'screen') && !edit
  const href = edit ? `${base}/edit` : item.type === 'link' ? item.url : item.type === 'screen' ? `${base}/screen` : base
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
        {item.type === 'screen' && isSharing(item.id) && <span class="chip chip-live">配信中</span>}
        {newTab && <Icon name="external" size={14} class="item-ext" />}
      </a>
      {edit ? (
        <div class="row-actions">
          <a href={`${base}/edit`} class="icon-btn" aria-label="編集" title="編集">
            <Icon name="pencil" size={16} />
          </a>
          <form method="post" action={`${base}/move`}>
            <input type="hidden" name="dir" value="up" />
            <button class="icon-btn" aria-label="上へ" title="上へ">
              <Icon name="arrowUp" size={16} />
            </button>
          </form>
          <form method="post" action={`${base}/move`}>
            <input type="hidden" name="dir" value="down" />
            <button class="icon-btn" aria-label="下へ" title="下へ">
              <Icon name="arrowDown" size={16} />
            </button>
          </form>
          <form method="post" action={`${base}/delete`} data-confirm={`「${item.title}」を削除しますか？`}>
            <button class="icon-btn danger" aria-label="削除" title="削除">
              <Icon name="trash" size={16} />
            </button>
          </form>
        </div>
      ) : (
        showCheck && (
          <form method="post" action={`${base}/complete`} data-complete>
            <button type="submit" class="check" aria-pressed={done ? 'true' : 'false'} aria-label={done ? '未完了に戻す' : '完了にする'} title={done ? '完了済み' : '完了にする'}>
              <Icon name="check" size={14} />
            </button>
          </form>
        )
      )}
    </li>
  )
}

const ADD_ITEM_ICONS: Record<ItemType, IconName> = { page: 'page', link: 'link', file: 'upload', screen: 'monitor' }

const AddItemForm = ({ courseId, sectionId }: { courseId: number; sectionId: number }) => (
  <details class="add-item" data-autofocus-details>
    <summary>
      <Icon name="plus" size={16} /> アイテムを追加
    </summary>
    <form method="post" action={`/courses/${courseId}/items`} enctype="multipart/form-data" class="stack item-form" data-loading-form>
      <input type="hidden" name="section_id" value={String(sectionId)} />
      <div class="segmented" role="radiogroup" aria-label="種類">
        {(['page', 'link', 'file', 'screen'] as const).map((t, i) => (
          <label>
            <input type="radio" name="type" value={t} checked={i === 0} />
            <span>
              <Icon name={ADD_ITEM_ICONS[t]} size={15} /> {ITEM_TYPE_LABELS[t]}
            </span>
          </label>
        ))}
      </div>
      <div class="field">
        <label for={`t-${sectionId}`}>タイトル</label>
        <input id={`t-${sectionId}`} name="title" maxlength={200} placeholder="例：第1回 講義資料" required />
      </div>
      <div class="field when-link">
        <label for={`u-${sectionId}`}>URL</label>
        <input id={`u-${sectionId}`} name="url" type="url" placeholder="https://" />
      </div>
      <div class="field when-file">
        <label for={`f-${sectionId}`}>ファイル</label>
        <input id={`f-${sectionId}`} name="file" type="file" class="file-input" />
        <p class="field-hint">最大 30MB。PDF・画像はブラウザでプレビューできます。</p>
      </div>
      <div class="field">
        <label for={`b-${sectionId}`}>
          <span class="when-page-inline">本文</span>
          <span class="when-other-inline">説明（任意）</span>
        </label>
        <textarea id={`b-${sectionId}`} name="body" rows={4} placeholder="Markdown が使えます（# 見出し、**太字**、- 箇条書き、[リンク](https://…)）" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-sm">
          追加
        </button>
      </div>
    </form>
  </details>
)

const SectionEditBar = ({ courseId, section }: { courseId: number; section: Section }) => {
  const base = `/courses/${courseId}/sections/${section.id}`
  return (
    <div class="row-actions">
      <details class="popover">
        <summary class="icon-btn" aria-label="セクションを編集" title="編集">
          <Icon name="pencil" size={16} />
        </summary>
        <form method="post" action={base} class="popover-panel stack">
          <div class="field">
            <label for={`st-${section.id}`}>セクション名</label>
            <input id={`st-${section.id}`} name="title" value={section.title} maxlength={120} required />
          </div>
          <div class="field">
            <label for={`ss-${section.id}`}>説明</label>
            <textarea id={`ss-${section.id}`} name="summary" rows={3}>
              {section.summary}
            </textarea>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm">保存</button>
          </div>
        </form>
      </details>
      <form method="post" action={`${base}/move`}>
        <input type="hidden" name="dir" value="up" />
        <button class="icon-btn" aria-label="上へ" title="上へ">
          <Icon name="arrowUp" size={16} />
        </button>
      </form>
      <form method="post" action={`${base}/move`}>
        <input type="hidden" name="dir" value="down" />
        <button class="icon-btn" aria-label="下へ" title="下へ">
          <Icon name="arrowDown" size={16} />
        </button>
      </form>
      <form method="post" action={`${base}/delete`} data-confirm={`セクション「${section.title}」と中のアイテムをすべて削除しますか？`}>
        <button class="icon-btn danger" aria-label="削除" title="削除">
          <Icon name="trash" size={16} />
        </button>
      </form>
    </div>
  )
}

app.get('/:id', async (c) => {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const user = c.var.user!
  const edit = access.canManage && isEditMode(c)

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
    <AppShell>
      <CourseHeader
        access={access}
        tab="content"
        meta={metaLine}
        progress={isStudent ? { done: done.size, total: items.length } : undefined}
        actions={
          access.canManage && (
            <form method="post" action="/account/edit-mode">
              <input type="hidden" name="next" value={`/courses/${id}`} />
              <button type="submit" name="on" value={edit ? '0' : '1'} class={edit ? 'btn btn-sm btn-primary' : 'btn btn-sm'} aria-pressed={edit ? 'true' : 'false'}>
                <Icon name={edit ? 'check' : 'pencil'} size={16} /> {edit ? '編集を終了' : '編集モード'}
              </button>
            </form>
          )
        }
      />

      {edit && (
        <div class="edit-banner">
          <Icon name="pencil" size={16} />
          <span>編集モード — セクションやアイテムを追加・並べ替えできます。終了するまでほかのコースでも続きます。</span>
        </div>
      )}

      {sections.length === 0 && !edit ? (
        <EmptyState icon="layers" title="まだ教材がありません" text="教師が教材を追加するとここに表示されます。" />
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
                    <span class="chip chip-success">
                      <Icon name="check" size={12} /> 完了
                    </span>
                  )}
                  <Icon name="chevronDown" class="section-caret" />
                </summary>
                {edit && <SectionEditBar courseId={id!} section={s} />}
                {s.summary && <p class="section-summary">{s.summary}</p>}
                {list.length > 0 ? (
                  <ul class="items">
                    {list.map((it) => (
                      <ItemRow item={it} courseId={id!} done={done.has(it.id)} showCheck={isStudent} edit={edit} />
                    ))}
                  </ul>
                ) : (
                  !edit && <p class="muted small section-empty">このセクションにはまだアイテムがありません。</p>
                )}
                {edit && <AddItemForm courseId={id!} sectionId={s.id} />}
              </details>
            )
          })}
        </div>
      )}

      {edit && (
        <form method="post" action={`/courses/${id}/sections`} class="add-section" data-loading-form>
          <Icon name="plus" />
          <input name="title" placeholder="新しいセクション名（例：第2週 データの扱い方）" maxlength={120} required aria-label="新しいセクション名" />
          <button type="submit" class="btn btn-primary btn-sm">
            セクションを追加
          </button>
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

        <section class="card danger-zone">
          <div class="card-head">
            <h2>危険な操作</h2>
            <p class="muted">これらの操作は取り消せません。</p>
          </div>
          {access.role && (
            <div class="danger-row">
              <div>
                <div class="strong">コースから退出</div>
                <p class="muted small">自分の登録と進捗を削除します。</p>
              </div>
              <form method="post" action={`/courses/${id}/leave`} data-confirm="このコースから退出しますか？">
                <button class="btn btn-danger-outline">退出</button>
              </form>
            </div>
          )}
          <div class="danger-row">
            <div>
              <div class="strong">コースを削除</div>
              <p class="muted small">セクション・教材・ファイル・参加者の登録がすべて削除されます。</p>
            </div>
            <form method="post" action={`/courses/${id}/delete`} data-confirm={`「${access.course.title}」を完全に削除しますか？`}>
              <button class="btn btn-danger">コースを削除</button>
            </form>
          </div>
        </section>
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

  return c.render(
    <AppShell>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
        title={`${greeting()}、${user.name}さん`}
        description="今日も一歩ずつ進めましょう。"
        actions={canCreateCourse(user) && <CreateCourseButton />}
      />

      {learning.length > 0 && (
        <div class="stats">
          <div class="stat">
            <span class="stat-label">受講中のコース</span>
            <span class="stat-value">{learning.length}</span>
          </div>
          <div class="stat">
            <span class="stat-label">完了したアイテム</span>
            <span class="stat-value">
              {doneItems}
              <small> / {totalItems}</small>
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">全体の進捗</span>
            <Progress done={doneItems} total={totalItems} />
          </div>
          {next && (
            <a href={`/courses/${next.id}`} class={`stat stat-next tone-${next.color}`}>
              <span class="stat-label">続きから学習</span>
              <span class="strong truncate">{next.title}</span>
              <Icon name="chevronRight" class="stat-arrow" />
            </a>
          )}
        </div>
      )}

      {teaching.length > 0 && (
        <section class="block">
          <h2 class="block-title">担当しているコース</h2>
          <div class="course-grid">
            {teaching.map((course) => (
              <CourseCard course={course} />
            ))}
          </div>
        </section>
      )}

      <section class="block">
        <h2 class="block-title">受講中のコース</h2>
        {learning.length > 0 ? (
          <div class="course-grid">
            {learning.map((course) => (
              <CourseCard course={course} showProgress />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="book"
            title="まだ受講中のコースはありません"
            text="コースに追加されると、ここに表示されます。"
          />
        )}
      </section>
    </AppShell>,
    { title: 'ダッシュボード' },
  )
})
