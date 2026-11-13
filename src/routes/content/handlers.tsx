import { and, eq, isNotNull } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  courseRevision,
  getCourseAccess,
  isVisibleItem,
  moveRow,
  nextPosition,
  trackedDoneCount,
  trackedItemCount,
  visibleItem,
  type CourseAccess,
} from '../../lib/courses'
import type { BundleView } from '../../components/bundle'
import { bundleBase } from '../../lib/bundle'
import { bundleKeysOf, bundleStore, bundleSyncStore } from '../../lib/bundle-items'
import { syncStateOf } from '../../lib/bundle-sync'
import {
  CODE_LANGUAGE_LABELS,
  DEFAULT_STARTER,
  MAX_CODE_LENGTH,
  MAX_CONSTRAINT_LABEL_LENGTH,
  MAX_CONSTRAINT_LENGTH,
  MAX_CONSTRAINTS,
  MAX_STDIN_LENGTH,
  JUDGE_LABELS,
  isJudge,
} from '../../lib/code'
import { gradingEnabled, submissionsOf } from '../../lib/code-grader'
import { currentJudge, grader, judgeSwitchable, setJudge } from '../../lib/code-grading'
import { codeStore, getCodeItem, updateCodeItem } from '../../lib/code-items'
import { dateTimeInputToUnix } from '../../lib/course-period'
import { db } from '../../lib/db'
import { completionError, firstError, isFile, readConstraints, validate, type FieldErrors } from '../../lib/forms'
import { field, fileField, intParam, readForm, redirectWith, wantsJson, type Form } from '../../lib/http'
import { previewKind } from '../../lib/preview'
import { availableCodeLanguages, sandboxEnabled } from '../../lib/sandbox'
import { codeItems, completions, items, sections } from '../../lib/schema'
import { isSharing } from '../../lib/screen-share'
import {
  EXECUTABLE_NOT_ALLOWED,
  FILE_TOO_LARGE,
  MAX_FILE_SIZE,
  deleteKeys,
  inBackground,
  isExecutable,
  putCourseFile,
  storage,
  type StoredFile,
} from '../../lib/storage'
import type { AppEnv, Completion } from '../../lib/types'
import { ItemEditPage, ItemPage, TEXT_PREVIEW_MAX, editUrl, type ItemInput, type OutlineItem } from './views'

async function manageAccess(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const access = id && (await getCourseAccess(c, id))
  return access && access.canManage ? access : null
}

function bundleView(c: Context<AppEnv>, access: CourseAccess, itemId: number): BundleView {
  const courseId = access.course.id
  const viewer = { id: c.var.user!.id, canManage: access.canManage }
  return {
    files: bundleStore(itemId).list(),
    sync: syncStateOf(bundleSyncStore(courseId, itemId), bundleBase(courseId, itemId), viewer),
  }
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

const listSections = (courseId: number) =>
  db.select().from(sections).where(eq(sections.courseId, courseId)).orderBy(sections.position, sections.id).all()

// ---------------------------------------------------------------- セクション

export async function createSection(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const id = access.course.id
  const result = validate('section', await readForm(c))
  if (!result.ok) return redirectWith(c, editUrl(id), firstError(result.errors), 'error')
  const row = db
    .insert(sections)
    .values({ courseId: id, title: result.values.title, position: nextPosition(sections, eq(sections.courseId, id)) })
    .returning({ id: sections.id })
    .get()
  return redirectWith(c, editUrl(id, row.id), 'セクションを追加しました。')
}

export async function updateSection(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const sid = intParam(c, 'sid')
  if (!access || !sid) return c.notFound()
  const result = validate('section', await readForm(c))
  if (!result.ok) return redirectWith(c, editUrl(access.course.id, sid), firstError(result.errors), 'error')
  db.update(sections)
    .set({ title: result.values.title, summary: result.values.summary ?? '' })
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
  const bundles = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.sectionId, sid), eq(items.courseId, access.course.id), eq(items.type, 'bundle')))
    .all()
  const bundleKeys = bundleKeysOf(bundles.map((b) => b.id))
  db.delete(sections)
    .where(and(eq(sections.id, sid), eq(sections.courseId, access.course.id)))
    .run()
  inBackground(deleteKeys([...files.map((r) => r.fileKey!), ...bundleKeys]))
  return redirectWith(c, editUrl(access.course.id), 'セクションを削除しました。', 'info')
}

// ---------------------------------------------------------------- アイテム作成・更新

const fileColumns = (stored: StoredFile | null) =>
  stored ? { fileKey: stored.key, fileName: stored.name, fileSize: stored.size, fileType: stored.type } : {}

// field() を使わないのは、前後の空白を削ると、コードの字下げや末尾の改行が変わるため
const sourceField = (form: Form, key: string, max: number) => {
  const v = form[key]
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function readItemInput(form: Form): ItemInput {
  return {
    title: field(form, 'title', 200),
    body: field(form, 'body', 100_000),
    url: field(form, 'url', 2000),
    linkTarget: field(form, 'link_target', 10),
    file: fileField(form, 'file'),
    starter: {
      html: sourceField(form, 'html', MAX_CODE_LENGTH),
      css: sourceField(form, 'css', MAX_CODE_LENGTH),
      js: sourceField(form, 'js', MAX_CODE_LENGTH),
      py: sourceField(form, 'py', MAX_CODE_LENGTH),
    },
    stdin: sourceField(form, 'stdin', MAX_STDIN_LENGTH),
    criteria: field(form, 'criteria', 5000),
    constraints: listField(form, 'constraint_label[]', MAX_CONSTRAINTS * 2).map((label, i) => ({
      label: label.slice(0, MAX_CONSTRAINT_LABEL_LENGTH * 2),
      text: (listField(form, 'constraint_text[]', MAX_CONSTRAINTS * 2)[i] ?? '').slice(0, MAX_CONSTRAINT_LENGTH * 2),
    })),
    opensAt: field(form, 'opens_at', 16),
    closesAt: field(form, 'closes_at', 16),
  }
}

const listField = (form: Form, key: string, max: number) => {
  const v = form[key]
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).slice(0, max).map((s) => (typeof s === 'string' ? s.trim() : ''))
}

// lib/forms.ts で確かめないのは、上限の値がストレージの設定にあり、実行ファイルかどうかは中身を読まないと分からないため
async function checkUpload(file: File | null) {
  if (file && file.size > MAX_FILE_SIZE) return FILE_TOO_LARGE
  if (file && (await isExecutable(file))) return EXECUTABLE_NOT_ALLOWED
  return null
}

export async function createItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  if (!access) return c.notFound()
  const courseId = access.course.id
  const form = await readForm(c)
  const sectionId = Number(field(form, 'section_id'))
  if (!getSection(courseId, sectionId)) return c.notFound()
  const result = validate('item', form)
  if (!result.ok) return redirectWith(c, editUrl(courseId, sectionId), firstError(result.errors), 'error')
  const { type, hidden, language, ...input } = result.values
  if (type === 'code' && !availableCodeLanguages.includes(language))
    return redirectWith(c, editUrl(courseId, sectionId), `${CODE_LANGUAGE_LABELS[language]} は選べません。`, 'error')
  const file = type === 'file' && isFile(input.file) ? input.file : null
  const uploadError = await checkUpload(file)
  if (uploadError) return redirectWith(c, editUrl(courseId, sectionId), uploadError, 'error')

  const stored = file && (await putCourseFile(courseId, file))

  const position = nextPosition(items, eq(items.sectionId, sectionId))
  const created = db.transaction((tx) => {
    const row = tx
      .insert(items)
      .values({
        courseId,
        sectionId,
        type,
        title: input.title,
        body: input.body,
        url: type === 'link' ? input.url : '',
        linkTarget: type === 'link' ? input.link_target : 'new',
        hidden,
        completion: access.course.completionEnabled ? (input.completion ?? 'none') : 'none',
        ...fileColumns(stored),
        position,
      })
      .returning({ id: items.id })
      .get()
    if (type === 'code') tx.insert(codeItems).values({ itemId: row.id, language, starter: DEFAULT_STARTER[language] }).run()
    return row
  })
  // ファイル自動配布は、ファイルを置くまで学生に配れないので、アップロードする編集画面へ進める
  if (type === 'bundle')
    return redirectWith(
      c,
      `/courses/${courseId}/items/${created.id}/edit`,
      `「${input.title}」を追加しました。配るファイルをアップロードしてください。`,
    )
  if (type === 'code')
    return redirectWith(
      c,
      `/courses/${courseId}/items/${created.id}/edit`,
      `「${input.title}」を追加しました。問題文と最初のコードを設定してください。`,
    )
  const next = field(form, 'then') === 'view' ? `/courses/${courseId}/items/${created.id}` : editUrl(courseId, sectionId)
  return redirectWith(c, next, `「${input.title}」を追加しました。`)
}

export async function editItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  return c.render(
    <ItemEditPage
      access={access}
      item={item}
      code={getCodeItem(iid)}
      bundle={item.type === 'bundle' ? bundleView(c, access, iid) : undefined}
      gradingEnabled={gradingEnabled}
      judge={judgeSwitchable ? currentJudge() : undefined}
      sections={listSections(access.course.id)}
    />,
    { title: `編集 - ${item.title}` },
  )
}

export async function updateItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const courseId = access.course.id
  const item = getItem(courseId, iid)
  if (!item) return c.notFound()
  const code = getCodeItem(iid)

  const form = await readForm(c)
  const requestedSection = Number(field(form, 'section_id'))
  const sectionId = getSection(courseId, requestedSection) ? requestedSection : item.sectionId
  // 送られてきた種類を使わないのは、画面の隠し欄は書き換えられ、保存済みのアイテムの種類と違うかもしれないため
  const result = validate('itemEdit', { ...form, type: item.type })
  const file = result.ok && item.type === 'file' && isFile(result.values.file) ? result.values.file : null
  const completion = (result.ok && result.values.completion) || item.completion
  const savedFile = { type: file?.type ?? item.fileType ?? '', name: file?.name ?? item.fileName ?? '' }
  const uploadError = result.ok ? await checkUpload(file) : null
  const completionMessage = result.ok ? completionError(item.type, completion, item.type === 'file' ? savedFile : null) : null
  const errors: FieldErrors | null = !result.ok
    ? result.errors
    : uploadError
      ? { file: uploadError }
      : completionMessage
        ? { completion: completionMessage }
        : null
  if (!result.ok || errors) {
    const values = {
      ...readItemInput(form),
      hidden: field(form, 'hidden', 1) === '1' ? 1 : 0,
      sectionId,
      completion: field(form, 'completion', 10),
    }
    c.status(422)
    return c.render(
      <ItemEditPage
        access={access}
        item={item}
        code={code}
        bundle={item.type === 'bundle' ? bundleView(c, access, iid) : undefined}
        gradingEnabled={gradingEnabled}
        judge={judgeSwitchable ? currentJudge() : undefined}
        sections={listSections(courseId)}
        values={values}
        errors={errors ?? {}}
      />,
      { title: `編集 - ${item.title}` },
    )
  }
  const { hidden, ...input } = result.values
  const stored = file && (await putCourseFile(courseId, file))

  db.update(items)
    .set({
      title: input.title,
      body: input.body,
      url: item.type === 'link' ? (input.url ?? '') : '',
      linkTarget: item.type === 'link' ? input.link_target : 'new',
      hidden,
      completion,
      ...fileColumns(stored),
      ...(sectionId !== item.sectionId && { sectionId, position: nextPosition(items, eq(items.sectionId, sectionId)) }),
    })
    .where(eq(items.id, iid))
    .run()
  if (code) {
    updateCodeItem(iid, code.language, {
      starter: input,
      stdin: input.stdin,
      criteria: input.criteria ?? '',
      constraints: readConstraints(input).constraints,
      opensAt: dateTimeInputToUnix(input.opens_at ?? ''),
      closesAt: dateTimeInputToUnix(input.closes_at ?? ''),
    })
  }
  if (stored && item.fileKey) inBackground(deleteKeys([item.fileKey]))
  return redirectWith(c, `/courses/${courseId}/items/${iid}/edit`, '保存しました。')
}

/** コードのアイテムの、制約ごとの判定をするものを切り替える。開発サーバーだけで使え、すべてのアイテムに効く */
export async function switchJudge(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!judgeSwitchable || !access || !iid || !getCodeItem(iid) || !getItem(access.course.id, iid)) return c.notFound()
  const judge = field(await readForm(c), 'judge', 10)
  if (!isJudge(judge)) return c.notFound()
  setJudge(judge)
  return redirectWith(c, `/courses/${access.course.id}/items/${iid}/edit`, `制約の判定を ${JUDGE_LABELS[judge]} で行うようにしました。`)
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
  const bundleKeys = bundleKeysOf([iid])
  const item = db
    .delete(items)
    .where(and(eq(items.id, iid), eq(items.courseId, access.course.id)))
    .returning({ sectionId: items.sectionId, fileKey: items.fileKey, title: items.title })
    .get()
  if (!item) return c.notFound()
  inBackground(deleteKeys([item.fileKey, ...bundleKeys]))
  return redirectWith(c, editUrl(access.course.id, item.sectionId), `「${item.title}」を削除しました。`, 'info')
}

// ---------------------------------------------------------------- 閲覧・完了

async function readTextPreview(key: string) {
  const bytes = await storage.read(key, TEXT_PREVIEW_MAX)
  if (!bytes || bytes.includes(0)) return null
  // stream を付けるのは、上限で切れた末尾の文字の途中を化けた文字として出さないため
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
  } catch {
    // UTF-8 でないものは、Excel が書き出す CSV などの Shift_JIS とみなす
    return new TextDecoder('shift_jis').decode(bytes, { stream: true })
  }
}

export async function showItem(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access) return c.notFound()
  const userId = c.var.user!.id
  // 読み出しの後で取らないのは、その間に変わったときに古い内容へ新しい版を付けてしまい、変更を取りこぼすため
  const revision = courseRevision(id)

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
    .select({
      id: items.id,
      sectionId: items.sectionId,
      type: items.type,
      title: items.title,
      url: items.url,
      linkTarget: items.linkTarget,
      fileName: items.fileName,
      fileType: items.fileType,
      hidden: items.hidden,
      completion: items.completion,
    })
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
  const codeItem = item.type === 'code' ? getCodeItem(iid) : undefined
  const code = codeItem && {
    language: codeItem.language,
    canRun: sandboxEnabled,
    goals: codeItem.constraints.map((c) => c.label),
    submissions:
      access.role === 'student'
        ? submissionsOf(codeStore(id, iid), userId, grader, { opensAt: codeItem.opensAt, closesAt: codeItem.closesAt })
        : null,
  }
  const textPreview =
    item.type === 'file' && item.fileKey && item.fileSize && previewKind(item.fileType ?? '', item.fileName ?? '') === 'text'
      ? await readTextPreview(item.fileKey)
      : null

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
      textPreview={textPreview}
      code={code}
      bundle={item.type === 'bundle' ? bundleView(c, access, iid) : undefined}
      revision={revision}
    />,
    { title: item.title },
  )
}

// 自動の完了で on（開いた・最後まで再生した）を送らせるのは、手動の切り替えと取り違えて、自動で付いた完了を未完了に戻さないため
const AUTO_COMPLETE_ON: Partial<Record<Completion, string>> = { view: 'view', play: 'ended' }

export async function toggleComplete(c: Context<AppEnv>) {
  const id = intParam(c, 'id')
  const iid = intParam(c, 'iid')
  const access = id && iid && (await getCourseAccess(c, id))
  if (!access || access.role !== 'student' || !access.course.completionEnabled || !isVisibleItem(iid)) return c.notFound()
  const item = getItem(id, iid)
  const on = field(await readForm(c), 'on', 10)
  const manual = item?.completion === 'manual' && !on
  if (!item || !(manual || (on && AUTO_COMPLETE_ON[item.completion] === on))) return c.notFound()
  const userId = c.var.user!.id

  // 手動のときは、削除できたら未完了に、なければ完了として挿入（トグル）。自動のときは完了にするだけで戻さない
  const removed =
    manual &&
    db
      .delete(completions)
      .where(and(eq(completions.userId, userId), eq(completions.itemId, iid)))
      .run().changes > 0
  if (!removed) db.insert(completions).values({ userId, itemId: iid, courseId: id }).onConflictDoNothing().run()
  const completed = !removed

  if (wantsJson(c)) {
    const total = await trackedItemCount(id)
    const done = await trackedDoneCount(userId, id)
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
  const filename = item.fileName ?? 'file'
  const preview = c.req.query('inline') === '1' ? previewKind(type, filename) : null
  // PDF ビューアは sandbox CSP 下で表示されないため、sandbox は添付時のみ。
  // テキストをインラインで返さないのは、HTML や SVG として同一オリジンで描かせないため（プレビューはサーバーで読んで埋め込む）
  const res = await storage.serve(item.fileKey, {
    filename,
    contentType: type,
    inline: !!preview && preview !== 'text',
    range: c.req.header('range'),
  })
  return res ?? c.notFound()
}
