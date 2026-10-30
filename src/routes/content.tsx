import { and, eq, isNotNull } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { raw } from 'hono/html'
import { CourseHeader, ItemIcon } from '../components/course'
import { Icon } from '../components/icons'
import { AppShell } from '../components/layout'
import { Styles } from '../components/style'
import { Button } from '../components/button'
import { FileInput, FormField, SelectField, TextAreaField, TextField } from '../components/form'
import { Card, LinkCard } from '../components/card'
import { Alert, Breadcrumbs, Chip } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess, moveRow, nextPosition, type CourseAccess } from '../lib/courses'
import { field, intParam, isHttpUrl, readForm, redirectWith, wantsJson, type Form } from '../lib/http'
import { renderMarkdown } from '../lib/markdown'
import { isSharing } from '../lib/screen-share'
import { MAX_FILE_SIZE, deleteKeys, formatBytes, inBackground, putCourseFile, storage, type StoredFile } from '../lib/storage'
import { ITEM_TYPE_LABELS, type AppEnv, type Item, type ItemType, type Section } from '../lib/types'
import { db } from '../lib/db'
import { completions, items, sections } from '../lib/schema'

const app = new Hono<AppEnv>()
app.use(requireAuth)

const editUrl = (courseId: number, sectionId?: number) =>
  `/courses/${courseId}${sectionId ? `#section-${sectionId}` : ''}`

async function manageAccess(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  return access && access.canManage ? access : null
}

const getItem = (courseId: number, itemId: number) =>
  db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId)))
    .get()

const getSection = (courseId: number, sectionId: number) =>
  db
    .select()
    .from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.courseId, courseId)))
    .get()

const listSections = (courseId: number) => db.select().from(sections).where(eq(sections.courseId, courseId)).orderBy(sections.position, sections.id).all()

// ---------------------------------------------------------------- セクション

app.post('/:id/sections', async (c) => {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const id = access.course.id
  const title = field(await readForm(c), 'title', 120)
  if (!title) return redirectWith(c, editUrl(id), 'セクション名を入力してください。', 'error')
  const row = db
    .insert(sections)
    .values({ courseId: id, title, position: nextPosition(sections, eq(sections.courseId, id)) })
    .returning({ id: sections.id })
    .get()
  return redirectWith(c, editUrl(id, row.id), 'セクションを追加しました。')
})

app.post('/:id/sections/:sid', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const form = await readForm(c)
  const title = field(form, 'title', 120)
  if (!title) return redirectWith(c, editUrl(access.course.id, sid), 'セクション名を入力してください。', 'error')
  db.update(sections)
    .set({ title, summary: field(form, 'summary', 2000) })
    .where(and(eq(sections.id, sid), eq(sections.courseId, access.course.id)))
    .run()
  return redirectWith(c, editUrl(access.course.id, sid), 'セクションを更新しました。')
})

app.post('/:id/sections/:sid/move', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  moveRow(sections, eq(sections.courseId, access.course.id), sid, dir)
  return c.redirect(editUrl(access.course.id, sid), 303)
})

app.post('/:id/sections/:sid/delete', async (c) => {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const files = db
    .select({ fileKey: items.fileKey })
    .from(items)
    .where(and(eq(items.sectionId, sid), eq(items.courseId, access.course.id), isNotNull(items.fileKey)))
    .all()
  db.delete(sections)
    .where(and(eq(sections.id, sid), eq(sections.courseId, access.course.id)))
    .run()
  inBackground(deleteKeys(files.map((r) => r.fileKey!)))
  return redirectWith(c, editUrl(access.course.id), 'セクションを削除しました。', 'info')
})

// ---------------------------------------------------------------- アイテム作成・更新

type ItemInput = { title: string; body: string; url: string; file: File | null }

const fileColumns = (stored: StoredFile | null) =>
  stored ? { fileKey: stored.key, fileName: stored.name, fileSize: stored.size, fileType: stored.type } : {}

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
  const type: ItemType = typeRaw === 'link' || typeRaw === 'file' || typeRaw === 'screen' ? typeRaw : 'page'
  const input = readItemInput(form)

  if (!getSection(courseId, sectionId)) return c.notFound()
  const error = validateItem(type, input, true)
  if (error) return redirectWith(c, editUrl(courseId, sectionId), error, 'error')

  let stored: StoredFile | null = null
  if (type === 'file' && input.file) stored = await putCourseFile(courseId, input.file)

  db.insert(items)
    .values({
      courseId,
      sectionId,
      type,
      title: input.title,
      body: input.body,
      url: type === 'link' ? input.url : '',
      ...fileColumns(stored),
      position: nextPosition(items, eq(items.sectionId, sectionId)),
    })
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
      <Styles use={['/src/routes/content.css']} />
      <CourseHeader access={access} tab="content" />
      <div class="narrow">
        <a href={editUrl(courseId, item.sectionId)} class="back-link">
          <Icon name="chevronLeft" size={16} /> コースに戻る
        </a>
        <Card
          as="form"
          method="post"
          action={base}
          enctype="multipart/form-data"
          class="stack"
          data-loading-form
          leading={<ItemIcon type={item.type} />}
          heading={`${ITEM_TYPE_LABELS[item.type]}を編集`}
        >
          {error && <Alert>{error}</Alert>}
          <TextField label="タイトル" name="title" value={v.title} required maxlength={200} />
          <SelectField
            label="セクション"
            name="section_id"
            id="f-section"
            options={sections.map((s) => ({ value: String(s.id), label: s.title }))}
            value={String(item.sectionId)}
          />
          {item.type === 'link' && <TextField label="URL" name="url" type="url" value={v.url} required />}
          {item.type === 'file' && (
            <FormField id="f-file" label="ファイル" hint={`差し替える場合は新しいファイルを選択（最大 ${formatBytes(MAX_FILE_SIZE)}）`}>
              <div class="file-current">
                <Icon name="file" />
                <span class="truncate">{item.fileName}</span>
                <span class="muted small">{formatBytes(item.fileSize ?? 0)}</span>
              </div>
              <FileInput id="f-file" name="file" aria-describedby="f-file-desc" />
            </FormField>
          )}
          <TextAreaField
            label={item.type === 'page' ? '本文' : '説明（任意）'}
            name="body"
            value={v.body}
            rows={item.type === 'page' ? 16 : 4}
            hint="Markdown が使えます：# 見出し、**太字**、*斜体*、- 箇条書き、1. 番号付き、> 引用、```コード```、[リンク](https://…)"
          />
          <div class="form-actions">
            <Button href={editUrl(courseId, item.sectionId)} variant="ghost">
              キャンセル
            </Button>
            <Button type="submit" variant="primary">
              保存
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}

app.get('/:id/items/:iid/edit', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  return c.render(<ItemEditPage access={access} item={item} sections={listSections(access.course.id)} />, {
    title: `編集 - ${item.title}`,
  })
})

app.post('/:id/items/:iid', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const courseId = access.course.id
  const item = getItem(courseId, iid)
  if (!item) return c.notFound()

  const form = await readForm(c)
  const input = readItemInput(form)
  const requestedSection = Number(field(form, 'section_id'))
  const sectionId = getSection(courseId, requestedSection) ? requestedSection : item.sectionId

  const error = validateItem(item.type, input, false)
  if (error) {
    c.status(422)
    return c.render(<ItemEditPage access={access} item={item} sections={listSections(courseId)} values={input} error={error} />, {
      title: `編集 - ${item.title}`,
    })
  }

  let stored: StoredFile | null = null
  if (item.type === 'file' && input.file) stored = await putCourseFile(courseId, input.file)

  db.update(items)
    .set({
      title: input.title,
      body: input.body,
      url: item.type === 'link' ? input.url : '',
      ...fileColumns(stored),
      ...(sectionId !== item.sectionId && { sectionId, position: nextPosition(items, eq(items.sectionId, sectionId)) }),
    })
    .where(eq(items.id, iid))
    .run()
  if (stored && item.fileKey) inBackground(deleteKeys([item.fileKey]))
  return redirectWith(c, editUrl(courseId, sectionId), '保存しました。')
})

app.post('/:id/items/:iid/move', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  moveRow(items, eq(items.sectionId, item.sectionId), iid, dir)
  return c.redirect(editUrl(access.course.id, item.sectionId), 303)
})

app.post('/:id/items/:iid/delete', async (c) => {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = db
    .delete(items)
    .where(and(eq(items.id, iid), eq(items.courseId, access.course.id)))
    .returning({ sectionId: items.sectionId, fileKey: items.fileKey, title: items.title })
    .get()
  if (!item) return c.notFound()
  if (item.fileKey) inBackground(deleteKeys([item.fileKey]))
  return redirectWith(c, editUrl(access.course.id, item.sectionId), `「${item.title}」を削除しました。`, 'info')
})

// ---------------------------------------------------------------- 閲覧・完了

type OutlineItem = Pick<Item, 'id' | 'sectionId' | 'type' | 'title' | 'url'>

const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif))$/

app.get('/:id/items/:iid', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const userId = c.var.user!.id

  const item = getItem(id, iid)
  if (!item) return c.notFound()
  const sectionList = db
    .select({ id: sections.id, title: sections.title })
    .from(sections)
    .where(eq(sections.courseId, id))
    .orderBy(sections.position, sections.id)
    .all()
  const outline: OutlineItem[] = db
    .select({ id: items.id, sectionId: items.sectionId, type: items.type, title: items.title, url: items.url })
    .from(items)
    .where(eq(items.courseId, id))
    .orderBy(items.position, items.id)
    .all()
  const doneRows = db
    .select({ itemId: completions.itemId })
    .from(completions)
    .where(and(eq(completions.userId, userId), eq(completions.courseId, id)))
    .all()
  const done = new Set(doneRows.map((r) => r.itemId))

  // セクション順 → アイテム順でコース全体を並べ、前後のアイテムを求める
  const ordered = sectionList.flatMap((s) => outline.filter((o) => o.sectionId === s.id))
  const idx = ordered.findIndex((o) => o.id === item.id)
  const prev = ordered[idx - 1]
  const next = ordered[idx + 1]
  const section = sectionList.find((s) => s.id === item.sectionId)
  const isStudent = access.role === 'student'
  const isDone = done.has(item.id)
  const base = `/courses/${id}/items`
  const fileUrl = `${base}/${item.id}/file`
  const canPreview = item.type === 'file' && PREVIEWABLE.test(item.fileType ?? '')

  const navHref = (o: OutlineItem) => `${base}/${o.id}`

  return c.render(
    <AppShell wide>
      <Styles use={['/src/routes/content.css']} />
      <div class="reader">
        <article class="reader-main">
          <Breadcrumbs items={[{ href: `/courses/${id}`, label: access.course.title }, { label: section?.title }]} />
          <header class="reader-head">
            <ItemIcon type={item.type} />
            <h1>{item.title}</h1>
            {access.canManage && (
              <Button href={`${base}/${item.id}/edit`} variant="ghost" size="sm" icon="pencil">
                編集
              </Button>
            )}
          </header>

          {item.type === 'link' && (
            <LinkCard href={item.url} icon="link" target="_blank" rel="noopener noreferrer" data-no-prefetch>
              <span class="truncate">{item.url}</span>
              <Button as="span" variant="primary" size="sm" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'screen' && (
            <LinkCard href={`${base}/${item.id}/screen`} icon="monitor" target="_blank" rel="noopener" data-no-prefetch>
              <span class="truncate">別のタブで画面共有を開きます</span>
              {isSharing(item.id) && <Chip tone="live">配信中</Chip>}
              <Button as="span" variant="primary" size="sm" iconEnd="external">
                開く
              </Button>
            </LinkCard>
          )}

          {item.type === 'file' && (
            <>
              <LinkCard icon="file">
                <span class="file-name">
                  <span class="truncate strong">{item.fileName}</span>
                  <span class="muted small">{formatBytes(item.fileSize ?? 0)}</span>
                </span>
                <Button href={fileUrl} variant="primary" size="sm" icon="download" data-no-prefetch download>
                  ダウンロード
                </Button>
              </LinkCard>
              {canPreview &&
                (item.fileType === 'application/pdf' ? (
                  <iframe class="file-preview" src={`${fileUrl}?inline=1`} title={item.fileName ?? 'プレビュー'} loading="lazy" />
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
              <Button type="submit" variant={isDone ? 'success' : 'primary'} size="lg" icon="check" aria-pressed={isDone ? 'true' : 'false'}>
                <span data-complete-label>{isDone ? '完了済み' : '完了にする'}</span>
              </Button>
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
          {sectionList.map((s) => (
            <div class="outline-section">
              <div class="outline-title">{s.title}</div>
              <ul>
                {outline
                  .filter((o) => o.sectionId === s.id)
                  .map((o) => (
                    <li>
                      <a
                        href={o.type === 'link' ? o.url : o.type === 'screen' ? `${navHref(o)}/screen` : navHref(o)}
                        class={o.id === item.id ? 'outline-link active' : 'outline-link'}
                        {...(o.type === 'link' || o.type === 'screen'
                          ? { target: '_blank', rel: o.type === 'link' ? 'noopener noreferrer' : 'noopener', 'data-no-prefetch': '' }
                          : {})}
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
  const removed = db
    .delete(completions)
    .where(and(eq(completions.userId, userId), eq(completions.itemId, iid)))
    .run().changes > 0
  if (!removed) {
    if (!getItem(id, iid)) return c.notFound()
    db.insert(completions).values({ userId, itemId: iid, courseId: id }).run()
  }
  const completed = !removed

  if (wantsJson(c)) {
    const total = await db.$count(items, eq(items.courseId, id))
    const done = await db.$count(completions, and(eq(completions.userId, userId), eq(completions.courseId, id)))
    return c.json({ completed, total, done })
  }
  return c.redirect(c.req.header('referer') ?? `/courses/${id}`, 303)
})

app.get('/:id/items/:iid/file', async (c) => {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const item = getItem(id, iid)
  if (!item || item.type !== 'file' || !item.fileKey) return c.notFound()

  const type = item.fileType ?? 'application/octet-stream'
  // インライン表示は PDF とラスタ画像だけ（PDF ビューアは sandbox CSP 下で表示されないため、sandbox は添付時のみ）
  const res = await storage.serve(item.fileKey, {
    filename: item.fileName ?? 'file',
    contentType: type,
    inline: c.req.query('inline') === '1' && PREVIEWABLE.test(type),
  })
  return res ?? c.notFound()
})

export default app
