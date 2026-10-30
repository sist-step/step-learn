import { and, eq, isNotNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCourseAccess, isVisibleItem, moveRow, nextPosition, visibleDoneCount, visibleItem, visibleItemCount } from '../../lib/courses'
import { db } from '../../lib/db'
import { field, fileField, intParam, isHttpUrl, readForm, redirectWith, wantsJson, type Form } from '../../lib/http'
import { completions, items, sections } from '../../lib/schema'
import { isSharing } from '../../lib/screen-share'
import { FILE_TOO_LARGE, MAX_FILE_SIZE, deleteKeys, inBackground, putCourseFile, storage, type StoredFile } from '../../lib/storage'
import type { AppEnv, ItemType } from '../../lib/types'
import { ItemEditPage, ItemPage, PREVIEWABLE, editUrl, type ItemInput, type OutlineItem } from './views'

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

export async function createSection(c: Context<AppEnv>) {
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
}

export async function updateSection(c: Context<AppEnv>) {
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
}

export async function moveSection(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  moveRow(sections, eq(sections.courseId, access.course.id), sid, dir)
  return c.redirect(editUrl(access.course.id, sid), 303)
}

// トグルにせず値を送らせるのは、二重送信や古い画面からの送信で意図と逆の状態になるのを避けるため
const readHidden = async (c: Context<AppEnv>) => (field(await readForm(c), 'hidden') === '1' ? 1 : 0)

const hiddenMessage = (title: string, hidden: number) => `「${title}」を${hidden ? '学生に非表示にしました' : '学生に表示しました'}。`

export async function setSectionHidden(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const hidden = await readHidden(c)
  const section = db
    .update(sections)
    .set({ hidden })
    .where(and(eq(sections.id, sid), eq(sections.courseId, access.course.id)))
    .returning({ title: sections.title })
    .get()
  if (!section) return c.notFound()
  return redirectWith(c, editUrl(access.course.id, sid), hiddenMessage(section.title, hidden), 'info')
}

export async function removeSection(c: Context<AppEnv>) {
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
}

// ---------------------------------------------------------------- アイテム作成・更新

const fileColumns = (stored: StoredFile | null) =>
  stored ? { fileKey: stored.key, fileName: stored.name, fileSize: stored.size, fileType: stored.type } : {}

function readItemInput(form: Form): ItemInput {
  return {
    title: field(form, 'title', 200),
    body: field(form, 'body', 100_000),
    url: field(form, 'url', 2000),
    file: fileField(form, 'file'),
  }
}

function validateItem(type: ItemType, input: ItemInput, requireFile: boolean) {
  if (!input.title) return 'タイトルを入力してください。'
  if (type === 'link' && !isHttpUrl(input.url)) return 'http:// または https:// で始まる URL を入力してください。'
  if (type === 'file' && requireFile && !input.file) return 'ファイルを選択してください。'
  if (input.file && input.file.size > MAX_FILE_SIZE) return FILE_TOO_LARGE
  return null
}

export async function createItem(c: Context<AppEnv>) {
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
}

export async function editItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  return c.render(<ItemEditPage access={access} item={item} sections={listSections(access.course.id)} />, {
    title: `編集 - ${item.title}`,
  })
}

export async function updateItem(c: Context<AppEnv>) {
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
  const hidden = field(form, 'hidden', 1) === '1' ? 1 : 0

  const error = validateItem(item.type, input, false)
  if (error) {
    c.status(422)
    return c.render(
      <ItemEditPage access={access} item={item} sections={listSections(courseId)} values={{ ...input, hidden, sectionId }} error={error} />,
      { title: `編集 - ${item.title}` },
    )
  }

  let stored: StoredFile | null = null
  if (item.type === 'file' && input.file) stored = await putCourseFile(courseId, input.file)

  db.update(items)
    .set({
      title: input.title,
      body: input.body,
      url: item.type === 'link' ? input.url : '',
      hidden,
      ...fileColumns(stored),
      ...(sectionId !== item.sectionId && { sectionId, position: nextPosition(items, eq(items.sectionId, sectionId)) }),
    })
    .where(eq(items.id, iid))
    .run()
  if (stored && item.fileKey) inBackground(deleteKeys([item.fileKey]))
  return redirectWith(c, `/courses/${courseId}/items/${iid}/edit`, '保存しました。')
}

export async function moveItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  const dir = field(await readForm(c), 'dir') === 'up' ? 'up' : 'down'
  moveRow(items, eq(items.sectionId, item.sectionId), iid, dir)
  return c.redirect(editUrl(access.course.id, item.sectionId), 303)
}

export async function setItemHidden(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const hidden = await readHidden(c)
  const item = db
    .update(items)
    .set({ hidden })
    .where(and(eq(items.id, iid), eq(items.courseId, access.course.id)))
    .returning({ sectionId: items.sectionId, title: items.title })
    .get()
  if (!item) return c.notFound()
  return redirectWith(c, editUrl(access.course.id, item.sectionId), hiddenMessage(item.title, hidden), 'info')
}

export async function removeItem(c: Context<AppEnv>) {
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
}

// ---------------------------------------------------------------- 閲覧・完了

export async function showItem(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const userId = c.var.user!.id

  const manage = access.canManage
  const item = getItem(id, iid)
  if (!item || (!manage && !isVisibleItem(iid))) return c.notFound()
  const sectionList = db
    .select({ id: sections.id, title: sections.title, hidden: sections.hidden })
    .from(sections)
    .where(and(eq(sections.courseId, id), manage ? undefined : eq(sections.hidden, 0)))
    .orderBy(sections.position, sections.id)
    .all()
  const outline: OutlineItem[] = db
    .select({ id: items.id, sectionId: items.sectionId, type: items.type, title: items.title, url: items.url, hidden: items.hidden })
    .from(items)
    .where(and(eq(items.courseId, id), manage ? undefined : visibleItem()))
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

  return c.render(
    <ItemPage
      access={access}
      item={item}
      section={section}
      sections={sectionList}
      outline={outline}
      done={done}
      prev={prev}
      next={next}
      sharing={isSharing(item.id)}
    />,
    { title: item.title },
  )
}

export async function toggleComplete(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || access.role !== 'student' || !isVisibleItem(iid)) return c.notFound()
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
    const total = await visibleItemCount(id)
    const done = await visibleDoneCount(userId, id)
    return c.json({ completed, total, done })
  }
  return c.redirect(c.req.header('referer') ?? `/courses/${id}`, 303)
}

export async function downloadFile(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const item = getItem(id, iid)
  if (!item || item.type !== 'file' || !item.fileKey || (!access.canManage && !isVisibleItem(iid))) return c.notFound()

  const type = item.fileType ?? 'application/octet-stream'
  // インライン表示は PDF とラスタ画像だけ（PDF ビューアは sandbox CSP 下で表示されないため、sandbox は添付時のみ）
  const res = await storage.serve(item.fileKey, {
    filename: item.fileName ?? 'file',
    contentType: type,
    inline: c.req.query('inline') === '1' && PREVIEWABLE.test(type),
  })
  return res ?? c.notFound()
}
