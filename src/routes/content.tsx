import { Hono, type Context } from 'hono'
import { raw } from 'hono/html'
import { CourseHeader, ItemIcon } from '../components/course'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { Field, TextArea } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess, moveRow, type CourseAccess } from '../lib/courses'
import { field, intParam, isHttpUrl, readForm, redirectWith, wantsJson, type Form } from '../lib/http'
import { renderMarkdown } from '../lib/markdown'
import { MAX_FILE_SIZE, deleteKeys, formatBytes, inBackground, putCourseFile, storage, type StoredFile } from '../lib/storage'
import { ITEM_TYPE_LABELS, type AppEnv, type Item, type ItemType, type Section } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const editUrl = (courseId: number, sectionId?: number) =>
  `/courses/${courseId}?edit=1${sectionId ? `#section-${sectionId}` : ''}`

async function manageAccess(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  return access && access.canManage ? access : null
}

const getItem = (c: Context<AppEnv>, courseId: number, itemId: number) =>
  db.prepare('SELECT * FROM items WHERE id = ? AND course_id = ?').bind(itemId, courseId).first<Item>()

const getSection = (c: Context<AppEnv>, courseId: number, sectionId: number) =>
  db.prepare('SELECT * FROM sections WHERE id = ? AND course_id = ?').bind(sectionId, courseId).first<Section>()

// ---------------------------------------------------------------- セクション

app.post('/:id/sections', async (c) => {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const id = access.course.id
  const title = field(await readForm(c), 'title', 120)
  if (!title) return redirectWith(c, editUrl(id), 'セクション名を入力してください。', 'error')
  const row = await db.prepare(
    `INSERT INTO sections (course_id, title, position)
     VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM sections WHERE course_id = ?1)) RETURNING id`,
  )
    .bind(id, title)
    .first<{ id: number }>()
  return redirectWith(c, editUrl(id, row!.id), 'セクションを追加しました。')
})

app.post('/:id/sections/:sid', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const form = await readForm(c)
  const title = field(form, 'title', 120)
  if (!title) return redirectWith(c, editUrl(access.course.id, sid), 'セクション名を入力してください。', 'error')
  await db.prepare('UPDATE sections SET title = ?, summary = ? WHERE id = ? AND course_id = ?')
    .bind(title, field(form, 'summary', 2000), sid, access.course.id)
    .run()
  return redirectWith(c, editUrl(access.course.id, sid), 'セクションを更新しました。')
})

app.post('/:id/sections/:sid/move', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  await moveRow('sections', 'course_id', access.course.id, sid, dir)
  return c.redirect(editUrl(access.course.id, sid), 303)
})

app.post('/:id/sections/:sid/delete', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const { results } = await db
    .prepare('SELECT file_key FROM items WHERE section_id = ? AND course_id = ? AND file_key IS NOT NULL')
    .bind(sid, access.course.id)
    .all<{ file_key: string }>()
  await db.prepare('DELETE FROM sections WHERE id = ? AND course_id = ?').bind(sid, access.course.id).run()
  inBackground(deleteKeys(results.map((r) => r.file_key)))
  return redirectWith(c, editUrl(access.course.id), 'セクションを削除しました。', 'info')
})

// ---------------------------------------------------------------- アイテム作成・更新

type ItemInput = { title: string; body: string; url: string; file: File | null }

function readItemInput(form: Form): ItemInput {
  const f = form.file
  return {
    title: field(form, 'title', 200),
    body: field(form, 'body', 100_000),
    url: field(form, 'url', 2000),
    file: f instanceof File && f.size > 0 ? f : null,
  }
}

function validateItem(type: ItemType, input: ItemInput, requireFile: boolean) {
  if (!input.title) return 'タイトルを入力してください。'
  if (type === 'link' && !isHttpUrl(input.url)) return 'http:// または https:// で始まる URL を入力してください。'
  if (type === 'file' && requireFile && !input.file) return 'ファイルを選択してください。'
  if (input.file && input.file.size > MAX_FILE_SIZE) return `ファイルサイズは ${formatBytes(MAX_FILE_SIZE)} までです。`
  return null
}

app.post('/:id/items', async (c) => {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const courseId = access.course.id
  const form = await readForm(c)
  const sectionId = Number(field(form, 'section_id'))
  const typeRaw = field(form, 'type')
  const type: ItemType = typeRaw === 'link' || typeRaw === 'file' ? typeRaw : 'page'
  const input = readItemInput(form)

  if (!(await getSection(c, courseId, sectionId))) return c.notFound()
  const error = validateItem(type, input, true)
  if (error) return redirectWith(c, editUrl(courseId, sectionId), error, 'error')

  let stored: StoredFile | null = null
  if (type === 'file' && input.file) stored = await putCourseFile(courseId, input.file)

  await db.prepare(
    `INSERT INTO items (course_id, section_id, type, title, body, url, file_key, file_name, file_size, file_type, position)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE section_id = ?2))`,
  )
    .bind(
      courseId,
      sectionId,
      type,
      input.title,
      input.body,
      type === 'link' ? input.url : '',
      stored?.key ?? null,
      stored?.name ?? null,
      stored?.size ?? null,
      stored?.type ?? null,
    )
    .run()
  return redirectWith(c, editUrl(courseId, sectionId), `「${input.title}」を追加しました。`)
})

const ItemEditPage = ({
  access,
  item,
  sections,
  values,
  error,
}: {
  access: CourseAccess
  item: Item
  sections: Section[]
  values?: Partial<ItemInput>
  error?: string
}) => {
  const courseId = access.course.id
  const base = `/courses/${courseId}/items/${item.id}`
  const v = { title: item.title, body: item.body, url: item.url, ...values }
  return (
    <AppShell>
      <CourseHeader access={access} tab="content" />
      <div class="narrow">
        <a href={editUrl(courseId, item.section_id)} class="back-link">
          <Icon name="chevronLeft" size={16} /> コースに戻る
        </a>
        <form method="post" action={base} enctype="multipart/form-data" class="card stack" data-loading-form>
          <div class="card-head row">
            <ItemIcon type={item.type} />
            <div>
              <h2>{ITEM_TYPE_LABELS[item.type]}を編集</h2>
            </div>
          </div>
          {error && (
            <div class="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <Field label="タイトル" name="title" value={v.title} required maxlength={200} />
          <div class="field">
            <label for="f-section">セクション</label>
            <select id="f-section" name="section_id">
              {sections.map((s) => (
                <option value={String(s.id)} selected={s.id === item.section_id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          {item.type === 'link' && <Field label="URL" name="url" type="url" value={v.url} required />}
          {item.type === 'file' && (
            <div class="field">
              <span class="label">ファイル</span>
              <div class="file-current">
                <Icon name="file" />
                <span class="truncate">{item.file_name}</span>
                <span class="muted small">{formatBytes(item.file_size ?? 0)}</span>
              </div>
              <label for="f-file" class="field-hint">
                差し替える場合は新しいファイルを選択（最大 {formatBytes(MAX_FILE_SIZE)}）
              </label>
              <input id="f-file" name="file" type="file" class="file-input" />
            </div>
          )}
          <TextArea
            label={item.type === 'page' ? '本文' : '説明（任意）'}
            name="body"
            value={v.body}
            rows={item.type === 'page' ? 16 : 4}
            hint="Markdown が使えます：# 見出し、**太字**、*斜体*、- 箇条書き、1. 番号付き、> 引用、```コード```、[リンク](https://…)"
          />
          <div class="form-actions">
            <a href={editUrl(courseId, item.section_id)} class="btn btn-ghost">
              キャンセル
            </a>
            <button type="submit" class="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

app.get('/:id/items/:iid/edit', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const [itemRes, secRes] = await db.batch([
    db.prepare('SELECT * FROM items WHERE id = ? AND course_id = ?').bind(iid, access.course.id),
    db.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY position, id').bind(access.course.id),
  ])
  const item = itemRes.results[0] as Item | undefined
  if (!item) return c.notFound()
  return c.render(<ItemEditPage access={access} item={item} sections={secRes.results as Section[]} />, {
    title: `編集 - ${item.title}`,
  })
})

app.post('/:id/items/:iid', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const courseId = access.course.id
  const item = await getItem(c, courseId, iid)
  if (!item) return c.notFound()

  const form = await readForm(c)
  const input = readItemInput(form)
  const requestedSection = Number(field(form, 'section_id'))
  const sectionId = (await getSection(c, courseId, requestedSection)) ? requestedSection : item.section_id

  const error = validateItem(item.type, input, false)
  if (error) {
    const { results } = await db.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY position, id')
      .bind(courseId)
      .all<Section>()
    c.status(422)
    return c.render(<ItemEditPage access={access} item={item} sections={results} values={input} error={error} />, {
      title: `編集 - ${item.title}`,
    })
  }

  let stored: StoredFile | null = null
  if (item.type === 'file' && input.file) stored = await putCourseFile(courseId, input.file)

  await db
    .prepare(
      `UPDATE items SET
         title = ?1, body = ?2, url = ?3,
         file_key = COALESCE(?4, file_key), file_name = COALESCE(?5, file_name),
         file_size = COALESCE(?6, file_size), file_type = COALESCE(?7, file_type),
         position = CASE WHEN section_id = ?9 THEN position
                         ELSE (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE section_id = ?9) END,
         section_id = ?9,
         updated_at = unixepoch()
       WHERE id = ?8`,
    )
    .bind(
      input.title,
      input.body,
      item.type === 'link' ? input.url : '',
      stored?.key ?? null,
      stored?.name ?? null,
      stored?.size ?? null,
      stored?.type ?? null,
      iid,
      sectionId,
    )
    .run()
  if (stored && item.file_key) inBackground(deleteKeys([item.file_key]))
  return redirectWith(c, editUrl(courseId, sectionId), '保存しました。')
})

app.post('/:id/items/:iid/move', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = await getItem(c, access.course.id, iid)
  if (!item) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  await moveRow('items', 'section_id', item.section_id, iid, dir)
  return c.redirect(editUrl(access.course.id, item.section_id), 303)
})

app.post('/:id/items/:iid/delete', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = await db.prepare('DELETE FROM items WHERE id = ? AND course_id = ? RETURNING section_id, file_key, title')
    .bind(iid, access.course.id)
    .first<{ section_id: number; file_key: string | null; title: string }>()
  if (!item) return c.notFound()
  if (item.file_key) inBackground(deleteKeys([item.file_key]))
  return redirectWith(c, editUrl(access.course.id, item.section_id), `「${item.title}」を削除しました。`, 'info')
})

// ---------------------------------------------------------------- 閲覧・完了

type OutlineItem = Pick<Item, 'id' | 'section_id' | 'type' | 'title' | 'url'>

const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif))$/

app.get('/:id/items/:iid', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || !access.canView) return c.notFound()
  const userId = c.var.user!.id

  const [itemRes, secRes, outRes, doneRes] = await db.batch([
    db.prepare('SELECT * FROM items WHERE id = ? AND course_id = ?').bind(iid, id),
    db.prepare('SELECT id, title FROM sections WHERE course_id = ? ORDER BY position, id').bind(id),
    db.prepare('SELECT id, section_id, type, title, url FROM items WHERE course_id = ? ORDER BY position, id').bind(id),
    db.prepare('SELECT item_id FROM completions WHERE user_id = ? AND course_id = ?').bind(userId, id),
  ])
  const item = itemRes.results[0] as Item | undefined
  if (!item) return c.notFound()
  const sections = secRes.results as Pick<Section, 'id' | 'title'>[]
  const outline = outRes.results as OutlineItem[]
  const done = new Set((doneRes.results as { item_id: number }[]).map((r) => r.item_id))

  // セクション順 → アイテム順でコース全体を並べ、前後のアイテムを求める
  const ordered = sections.flatMap((s) => outline.filter((o) => o.section_id === s.id))
  const idx = ordered.findIndex((o) => o.id === item.id)
  const prev = ordered[idx - 1]
  const next = ordered[idx + 1]
  const section = sections.find((s) => s.id === item.section_id)
  const isStudent = access.role === 'student'
  const isDone = done.has(item.id)
  const base = `/courses/${id}/items`
  const fileUrl = `${base}/${item.id}/file`
  const canPreview = item.type === 'file' && PREVIEWABLE.test(item.file_type ?? '')

  const navHref = (o: OutlineItem) => `${base}/${o.id}`

  return c.render(
    <AppShell wide>
      <div class="reader">
        <article class="reader-main">
          <nav class="crumbs crumbs-plain" aria-label="パンくず">
            <a href={`/courses/${id}`}>{access.course.title}</a>
            <Icon name="chevronRight" size={14} />
            <span>{section?.title}</span>
          </nav>
          <header class="reader-head">
            <ItemIcon type={item.type} />
            <h1>{item.title}</h1>
            {access.canManage && (
              <a href={`${base}/${item.id}/edit`} class="btn btn-sm btn-ghost">
                <Icon name="pencil" size={14} /> 編集
              </a>
            )}
          </header>

          {item.type === 'link' && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" class="link-card" data-no-prefetch>
              <Icon name="link" size={20} />
              <span class="truncate">{item.url}</span>
              <span class="btn btn-primary btn-sm">
                開く <Icon name="external" size={14} />
              </span>
            </a>
          )}

          {item.type === 'file' && (
            <>
              <div class="link-card">
                <Icon name="file" size={20} />
                <span class="file-name">
                  <span class="truncate strong">{item.file_name}</span>
                  <span class="muted small">{formatBytes(item.file_size ?? 0)}</span>
                </span>
                <a href={fileUrl} class="btn btn-primary btn-sm" data-no-prefetch download>
                  <Icon name="download" size={14} /> ダウンロード
                </a>
              </div>
              {canPreview &&
                (item.file_type === 'application/pdf' ? (
                  <iframe class="file-preview" src={`${fileUrl}?inline=1`} title={item.file_name ?? 'プレビュー'} loading="lazy" />
                ) : (
                  <img class="file-preview-img" src={`${fileUrl}?inline=1`} alt={item.title} loading="lazy" />
                ))}
            </>
          )}

          {item.body ? (
            <div class="prose">{raw(renderMarkdown(item.body))}</div>
          ) : (
            item.type === 'page' && <p class="muted">本文はまだありません。</p>
          )}

          {isStudent && (
            <form method="post" action={`${base}/${item.id}/complete`} class="complete-bar" data-complete>
              <button type="submit" class={isDone ? 'btn btn-success btn-lg' : 'btn btn-primary btn-lg'} aria-pressed={isDone ? 'true' : 'false'}>
                <Icon name="check" />
                <span data-complete-label>{isDone ? '完了済み' : '完了にする'}</span>
              </button>
            </form>
          )}

          <nav class="pager" aria-label="前後のアイテム">
            {prev ? (
              <a href={navHref(prev)} class="pager-link">
                <span class="muted small">
                  <Icon name="chevronLeft" size={14} /> 前へ
                </span>
                <span class="truncate">{prev.title}</span>
              </a>
            ) : (
              <span />
            )}
            {next ? (
              <a href={navHref(next)} class="pager-link pager-next">
                <span class="muted small">
                  次へ <Icon name="chevronRight" size={14} />
                </span>
                <span class="truncate">{next.title}</span>
              </a>
            ) : (
              <a href={`/courses/${id}`} class="pager-link pager-next">
                <span class="muted small">
                  コースへ <Icon name="chevronRight" size={14} />
                </span>
                <span class="truncate">{access.course.title}</span>
              </a>
            )}
          </nav>
        </article>

        <aside class="reader-outline" aria-label="コースの目次">
          <div class="outline-head">
            <a href={`/courses/${id}`} class="strong truncate">
              {access.course.title}
            </a>
            {isStudent && (
              <span class="muted small">
                {done.size} / {outline.length} 完了
              </span>
            )}
          </div>
          {sections.map((s) => (
            <div class="outline-section">
              <div class="outline-title">{s.title}</div>
              <ul>
                {outline
                  .filter((o) => o.section_id === s.id)
                  .map((o) => (
                    <li>
                      <a
                        href={o.type === 'link' ? o.url : navHref(o)}
                        class={o.id === item.id ? 'outline-link active' : 'outline-link'}
                        {...(o.type === 'link' ? { target: '_blank', rel: 'noopener noreferrer', 'data-no-prefetch': '' } : {})}
                        aria-current={o.id === item.id ? 'page' : undefined}
                      >
                        <span class={done.has(o.id) ? 'outline-dot done' : 'outline-dot'} data-outline-dot={o.id}>
                          {done.has(o.id) && <Icon name="check" size={10} />}
                        </span>
                        <span class="truncate">{o.title}</span>
                      </a>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </AppShell>,
    { title: item.title },
  )
})

app.post('/:id/items/:iid/complete', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || access.role !== 'student') return c.notFound()
  const userId = c.var.user!.id

  // 削除できたら未完了に、なければ完了として挿入（トグル）
  const removed = await db.prepare('DELETE FROM completions WHERE user_id = ? AND item_id = ? RETURNING item_id').bind(userId, iid).first()
  if (!removed) {
    const inserted = await db
      .prepare('INSERT INTO completions (user_id, item_id, course_id) SELECT ?, id, course_id FROM items WHERE id = ? AND course_id = ? RETURNING item_id')
      .bind(userId, iid, id)
      .first()
    if (!inserted) return c.notFound()
  }
  const completed = !removed

  if (wantsJson(c)) {
    const stats = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM items WHERE course_id = ?1) AS total,
                (SELECT COUNT(*) FROM completions WHERE user_id = ?2 AND course_id = ?1) AS done`,
      )
      .bind(id, userId)
      .first<{ total: number; done: number }>()
    return c.json({ completed, ...stats })
  }
  return c.redirect(c.req.header('referer') ?? `/courses/${id}`, 303)
})

app.get('/:id/items/:iid/file', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || !access.canView) return c.notFound()
  const item = await getItem(c, id!, iid!)
  if (!item || item.type !== 'file' || !item.file_key) return c.notFound()

  const type = item.file_type ?? 'application/octet-stream'
  // インライン表示は PDF とラスタ画像だけ（PDF ビューアは sandbox CSP 下で表示されないため、sandbox は添付時のみ）
  const res = await storage.serve(item.file_key, {
    filename: item.file_name ?? 'file',
    contentType: type,
    inline: c.req.query('inline') === '1' && PREVIEWABLE.test(type),
  })
  return res ?? c.notFound()
})

export default app
