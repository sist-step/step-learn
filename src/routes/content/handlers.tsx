import { and, eq, isNotNull } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  courseRevision,
  getCourseAccess,
  isVisibleItem,
  moveRow,
  nextPosition,
  touchCourse,
  trackedDoneCount,
  trackedItemCount,
  visibleItem,
  type CourseAccess,
} from '../../lib/courses'
import type { BundleView } from '../../components/bundle'
import { RestrictionPage } from '../../components/restriction'
import { MAX_AGENT_INSTRUCTIONS, agentViewOf } from '../../lib/agent'
import { agentStore, saveAgentOptions, savedAgentModel } from '../../lib/agent-items'
import { agentOpenRouterModels, resolveAgentModel } from '../../lib/agent-model'
import { canOpenItem, courseAvailability, restrictionChoices } from '../../lib/availability'
import { bundleBase } from '../../lib/bundle'
import { bundleKeysOf, bundleStore, bundleSyncStore } from '../../lib/bundle-items'
import { syncStateOf } from '../../lib/bundle-sync'
import {
  CODE_FILE_KEYS,
  CODE_LANGUAGE_LABELS,
  DEFAULT_STARTER,
  MAX_CODE_LENGTH,
  MAX_CONSTRAINT_LABEL_LENGTH,
  MAX_CONSTRAINT_LENGTH,
  MAX_CONSTRAINTS,
  MAX_STDIN_LENGTH,
  JUDGE_LABELS,
  goalsOf,
  isFinalized,
  publicSolutionOf,
  type CodeFiles,
} from '../../lib/code'
import { gradingEnabled, submissionsOf } from '../../lib/code-grader'
import { currentJudge, grader, judgeSwitchable, preparer, setJudge } from '../../lib/code-grading'
import { codeStore, duplicateCodeItem, getCodeItem, setCodeStage, updateCodeItem } from '../../lib/code-items'
import { dateTimeInputToUnix } from '../../lib/course-period'
import { db } from '../../lib/db'
import { completionError, firstError, isFile, readConstraints, solutionOf, validate, type FieldErrors } from '../../lib/forms'
import { field, fileField, intParam, readFields, readForm, redirectWith, wantsJson, type Form } from '../../lib/http'
import { previewKind } from '../../lib/preview'
import { DEFAULT_PASS_PERCENT, MAX_QUIZ_JSON_LENGTH, isQuizLook, readQuizForm } from '../../lib/quiz'
import { getQuizSettings, quizStore, saveQuizSettings } from '../../lib/quiz-items'
import { quizViewOf } from '../../lib/quiz-store'
import { availableCodeLanguages } from '../../lib/sandbox'
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
import {
  MAX_RESTRICTION_JSON_LENGTH,
  checkRestrictionChoices,
  describeRestriction,
  parseRestriction,
  readRestrictionForm,
  restrictionFormValue,
  restrictionJson,
  type RestrictionFormNode,
  type RestrictionSet,
} from '../../lib/restriction'
import type { AppEnv, CodeItem, Completion } from '../../lib/types'
import { ItemEditPage, ItemPage, TEXT_PREVIEW_MAX, editUrl, type ItemInput, type OutlineItem, type RestrictedOutline } from './views'

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

const agentView = (c: Context<AppEnv>, access: CourseAccess, itemId: number) =>
  agentViewOf(agentStore(itemId), c.var.user!.id, access.canManage ? { isAdmin: c.var.user!.role === 'admin' } : undefined)

const quizView = (c: Context<AppEnv>, access: CourseAccess, itemId: number) =>
  quizViewOf(quizStore(access.course.id, itemId), getQuizSettings(itemId), {
    itemUrl: `/courses/${access.course.id}/items/${itemId}`,
    userId: c.var.user!.id,
    student: access.role === 'student',
    retake: c.req.query('retake') === '1',
  })

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
  const fields = await readFields(c, 'move')
  if (!fields) return c.notFound()
  moveRow(sections, eq(sections.courseId, access.course.id), sid, fields.dir)
  return c.redirect(editUrl(access.course.id, sid), 303)
}

// トグルにせず値を送らせるのは、二重送信や古い画面からの送信で意図と逆の状態になるのを避けるため
const readHidden = async (c: Context<AppEnv>) => (await readFields(c, 'visibility'))?.hidden ?? 0

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

function quizLookField(form: Form) {
  const look = field(form, 'look', 10)
  return isQuizLook(look) ? look : 'plain'
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
      optional: listField(form, 'constraint_kind[]', MAX_CONSTRAINTS * 2)[i] === 'optional',
    })),
    solution: {
      html: sourceField(form, 'solution_html', MAX_CODE_LENGTH),
      css: sourceField(form, 'solution_css', MAX_CODE_LENGTH),
      js: sourceField(form, 'solution_js', MAX_CODE_LENGTH),
      py: sourceField(form, 'solution_py', MAX_CODE_LENGTH),
    },
    solutionPublic: field(form, 'solution_public', 1) === '1',
    opensAt: field(form, 'opens_at', 16),
    closesAt: field(form, 'closes_at', 16),
    userLimit: field(form, 'user_limit', 20),
    instructions: field(form, 'instructions', MAX_AGENT_INSTRUCTIONS * 2),
    questions: readQuizForm(sourceField(form, 'questions', MAX_QUIZ_JSON_LENGTH + 1)).rows,
    passPercent: field(form, 'pass_percent', 5),
    showAnswers: field(form, 'show_answers', 1) === '0' ? 0 : 1,
    look: quizLookField(form),
    model: field(form, 'agent_model', 200),
  }
}

/** 確定したコーディング問題の、判定に関わる欄の保存済みの値。編集画面のフォームと同じ名前で返す */
function lockedFields(body: string, code: CodeItem): Form {
  const files = (prefix: string, source: CodeFiles) =>
    Object.fromEntries(CODE_FILE_KEYS.map((key) => [`${prefix}${key}`, source[key] ?? '']))
  return {
    body,
    ...files('', code.starter),
    stdin: code.stdin,
    criteria: code.criteria,
    'constraint_label[]': code.constraints.map((c) => c.label),
    'constraint_text[]': code.constraints.map((c) => c.text),
    'constraint_kind[]': code.constraints.map((c) => (c.optional ? 'optional' : 'required')),
    ...files('solution_', code.solution),
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
  const placement = validate('itemPlacement', form)
  const sectionId = placement.ok ? placement.values.section_id : 0
  if (!placement.ok || !getSection(courseId, sectionId)) return c.notFound()
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
    if (type === 'code') tx.insert(codeItems).values({ itemId: row.id, language, starter: DEFAULT_STARTER[language], stage: 'draft' }).run()
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
  if (type === 'agent')
    return redirectWith(
      c,
      `/courses/${courseId}/items/${created.id}/edit`,
      `「${input.title}」を追加しました。使える期間と上限を設定してください。`,
    )
  if (type === 'quiz')
    return redirectWith(c, `/courses/${courseId}/items/${created.id}/edit`, `「${input.title}」を追加しました。問題を作ってください。`)
  const next = placement.values.after === 'view' ? `/courses/${courseId}/items/${created.id}` : editUrl(courseId, sectionId)
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
      preparing={preparer.isRunning(iid)}
      bundle={item.type === 'bundle' ? bundleView(c, access, iid) : undefined}
      agent={item.type === 'agent' ? agentView(c, access, iid) : undefined}
      quiz={item.type === 'quiz' ? getQuizSettings(iid) : undefined}
      agentModels={item.type === 'agent' ? await agentOpenRouterModels() : undefined}
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
  const finalized = !!code && isFinalized(code.stage)

  // 確定した問題は、判定に関わる欄を保存済みの値で上書きしてから検証する。画面に入力欄を出していないうえ、送られてきても変えさせないため
  const form = finalized ? { ...(await readForm(c)), ...lockedFields(item.body, code) } : await readForm(c)
  const finalizing = !!code && !finalized && field(form, 'finalize', 1) === '1'
  const placement = validate('itemPlacement', form)
  const requestedSection = placement.ok ? placement.values.section_id : 0
  const sectionId = getSection(courseId, requestedSection) ? requestedSection : item.sectionId
  // 送られてきた種類を使わないのは、画面の隠し欄は書き換えられ、保存済みのアイテムの種類と違うかもしれないため
  const result = validate('itemEdit', { ...form, type: item.type })
  const file = result.ok && item.type === 'file' && isFile(result.values.file) ? result.values.file : null
  const completion = (result.ok && result.values.completion) || item.completion
  const savedFile = { type: file?.type ?? item.fileType ?? '', name: file?.name ?? item.fileName ?? '' }
  const uploadError = result.ok ? await checkUpload(file) : null
  const completionMessage = result.ok ? completionError(item.type, completion, item.type === 'file' ? savedFile : null) : null
  const agentModel =
    result.ok && item.type === 'agent' ? await resolveAgentModel(result.values.agent_model ?? '', savedAgentModel(iid)) : null
  const errors: FieldErrors | null = !result.ok
    ? result.errors
    : uploadError
      ? { file: uploadError }
      : completionMessage
        ? { completion: completionMessage }
        : agentModel && 'error' in agentModel
          ? { agent_model: agentModel.error }
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
        agent={item.type === 'agent' ? agentView(c, access, iid) : undefined}
        quiz={item.type === 'quiz' ? getQuizSettings(iid) : undefined}
        agentModels={item.type === 'agent' ? await agentOpenRouterModels() : undefined}
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
      solution: solutionOf(input),
      solutionPublic: input.solution_public,
      opensAt: dateTimeInputToUnix(input.opens_at ?? ''),
      closesAt: dateTimeInputToUnix(input.closes_at ?? ''),
    })
    if (finalizing) {
      setCodeStage(iid, 'preparing')
      preparer.start(iid, c.var.user!.id)
      touchCourse(courseId)
      return redirectWith(
        c,
        `/courses/${courseId}/items/${iid}/edit`,
        '保存して問題を確定しました。準備が終わると、学生が解けるようになります。',
      )
    }
  }
  if (agentModel && 'model' in agentModel)
    saveAgentOptions(iid, {
      model: agentModel.model,
      opensAt: dateTimeInputToUnix(input.opens_at ?? ''),
      closesAt: dateTimeInputToUnix(input.closes_at ?? ''),
      userLimit: input.user_limit ?? 0,
      instructions: input.instructions ?? '',
    })
  if (item.type === 'quiz')
    saveQuizSettings(iid, {
      questions: input.questions.questions,
      passPercent: input.pass_percent ?? DEFAULT_PASS_PERCENT,
      showAnswers: input.show_answers,
      look: input.look,
    })
  if (stored && item.fileKey) inBackground(deleteKeys([item.fileKey]))
  return redirectWith(c, `/courses/${courseId}/items/${iid}/edit`, '保存しました。')
}

/** 確定したコーディング問題の準備をやり直す。失敗したときと、準備中のまま進んでいない（再起動などで止まった）ときだけ */
export async function prepareCode(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  const code = access && iid && getItem(access.course.id, iid) ? getCodeItem(iid) : undefined
  if (!access || !iid || !code || !(code.stage === 'failed' || (code.stage === 'preparing' && !preparer.isRunning(iid))))
    return c.notFound()
  setCodeStage(iid, 'preparing')
  preparer.start(iid, c.var.user!.id)
  return redirectWith(
    c,
    `/courses/${access.course.id}/items/${iid}/edit`,
    'もう一度準備しています。終わると、学生が解けるようになります。',
    'info',
  )
}

/** 確定したコーディング問題を、確定する前の新しいアイテムとして同じセクションの末尾に複製する。提出は写さない */
export async function duplicateCode(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  const item = access && iid ? getItem(access.course.id, iid) : undefined
  const code = item && getCodeItem(item.id)
  if (!access || !item || !code || !isFinalized(code.stage)) return c.notFound()
  const id = duplicateCodeItem(item, code)
  touchCourse(access.course.id)
  return redirectWith(
    c,
    `/courses/${access.course.id}/items/${id}/edit`,
    `「${item.title}」を複製しました。直してから確定してください。学生には表示していません。`,
  )
}

/** コードのアイテムの、制約ごとの判定をするものを切り替える。開発サーバーだけで使え、すべてのアイテムに効く */
export async function switchJudge(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!judgeSwitchable || !access || !iid || !getCodeItem(iid) || !getItem(access.course.id, iid)) return c.notFound()
  const fields = await readFields(c, 'judge')
  if (!fields) return c.notFound()
  const { judge } = fields
  setJudge(judge)
  return redirectWith(c, `/courses/${access.course.id}/items/${iid}/edit`, `制約の判定を ${JUDGE_LABELS[judge]} で行うようにしました。`)
}

export async function moveItem(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const iid = intParam(c, 'iid')
  if (!access || !iid) return c.notFound()
  const item = getItem(access.course.id, iid)
  if (!item) return c.notFound()
  const fields = await readFields(c, 'move')
  if (!fields) return c.notFound()
  moveRow(items, eq(items.sectionId, item.sectionId), iid, fields.dir)
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

// ---------------------------------------------------------------- アクセス制限

type RestrictionSubject = { kind: 'section' | 'item'; id: number; sectionId: number; title: string; availability: string | null }

function restrictionSubject(c: Context<AppEnv>, access: CourseAccess): RestrictionSubject | null {
  const courseId = access.course.id
  const iid = intParam(c, 'iid')
  if (iid) {
    const item = getItem(courseId, iid)
    return item ? { kind: 'item', id: item.id, sectionId: item.sectionId, title: item.title, availability: item.availability } : null
  }
  const sid = intParam(c, 'sid')
  const section = sid ? getSection(courseId, sid) : undefined
  return section
    ? { kind: 'section', id: section.id, sectionId: section.id, title: section.title, availability: section.availability }
    : null
}

function restrictionPage(
  c: Context<AppEnv>,
  access: CourseAccess,
  subject: RestrictionSubject,
  value?: RestrictionFormNode | null,
  errors?: FieldErrors,
) {
  const courseId = access.course.id
  const choices = restrictionChoices(access.course, subject.kind === 'item' ? subject.id : undefined)
  const saved = parseRestriction(subject.availability)
  return c.render(
    <RestrictionPage
      tone={access.course.color}
      crumbs={[
        { href: '/courses', label: 'コース一覧' },
        { href: `/courses/${courseId}`, label: access.course.title },
      ]}
      target={{
        kind: subject.kind,
        title: subject.title,
        action: `/courses/${courseId}/${subject.kind === 'item' ? 'items' : 'sections'}/${subject.id}/restriction`,
        back: editUrl(courseId, subject.sectionId),
      }}
      value={value === undefined ? restrictionFormValue(saved) : value}
      choices={choices}
      errors={errors}
      note={saved && describeRestriction(saved, restrictionChoices(access.course))}
    />,
    { title: `アクセス制限 - ${subject.title}` },
  )
}

export async function editRestriction(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const subject = access && restrictionSubject(c, access)
  if (!access || !subject) return c.notFound()
  return restrictionPage(c, access, subject)
}

export async function updateRestriction(c: Context<AppEnv>) {
  const access = await manageAccess(c)
  const subject = access && restrictionSubject(c, access)
  if (!access || !subject) return c.notFound()
  const form = await readForm(c)
  let set: RestrictionSet | null = null
  const result = validate('restriction', form)
  if (!result.ok || !result.values.clear) {
    const read = result.ok ? result.values.availability : readRestrictionForm(field(form, 'availability', MAX_RESTRICTION_JSON_LENGTH + 1))
    const choices = restrictionChoices(access.course, subject.kind === 'item' ? subject.id : undefined)
    const errors = result.ok
      ? read.set
        ? checkRestrictionChoices(read.set, choices, parseRestriction(subject.availability))
        : {}
      : result.errors
    if (Object.keys(errors).length > 0) {
      c.status(422)
      return restrictionPage(c, access, subject, restrictionFormValue(read.set), errors)
    }
    set = read.set
  }
  const table = subject.kind === 'item' ? items : sections
  db.update(table)
    .set({ availability: restrictionJson(set) })
    .where(and(eq(table.id, subject.id), eq(table.courseId, access.course.id)))
    .run()
  return redirectWith(
    c,
    editUrl(access.course.id, subject.sectionId),
    `「${subject.title}」のアクセス制限を${set ? '保存しました' : 'なくしました'}。`,
  )
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
  const availability = courseAvailability(c.var.user!, access)
  if (availability.items.get(iid)?.open === false) return c.notFound()
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
  // 一覧に出さないものも outline から除かないのは、進捗をコースページと同じく制限に関係なく数えるため
  const restricted: RestrictedOutline = {
    locked: new Set(outline.filter((o) => availability.items.get(o.id)?.open === false).map((o) => o.id)),
    hidden: new Set(outline.filter((o) => availability.items.get(o.id)?.hidden).map((o) => o.id)),
    hiddenSections: new Set(sectionList.filter((s) => availability.sections.get(s.id)?.hidden).map((s) => s.id)),
  }
  const locked = restricted.locked
  const doneRows = db
    .select({ itemId: completions.itemId })
    .from(completions)
    .where(and(eq(completions.userId, userId), eq(completions.courseId, id)))
    .all()
  const done = new Set(doneRows.map((r) => r.itemId))

  // セクション順 → アイテム順でコース全体を並べ、前後のアイテムを求める
  const ordered = sectionList.flatMap((s) => outline.filter((o) => o.sectionId === s.id && !locked.has(o.id)))
  const idx = ordered.findIndex((o) => o.id === item.id)
  const prev = ordered[idx - 1]
  const next = ordered[idx + 1]
  const section = sectionList.find((s) => s.id === item.sectionId)
  const codeItem = item.type === 'code' ? getCodeItem(iid) : undefined
  const codePeriod = codeItem && { opensAt: codeItem.opensAt, closesAt: codeItem.closesAt }
  const code = codeItem && {
    language: codeItem.language,
    goals: goalsOf(codeItem.constraints),
    grade: access.role === 'student' ? submissionsOf(codeStore(id, iid), userId, grader, codePeriod!).grade : null,
    solution: publicSolutionOf({ ...codeItem, solutionPublic: codeItem.solutionPublic === 1 }, codePeriod!),
    stage: codeItem.stage,
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
      restricted={restricted}
      done={done}
      prev={prev}
      next={next}
      sharing={isSharing(item.id)}
      textPreview={textPreview}
      code={code}
      bundle={item.type === 'bundle' ? bundleView(c, access, iid) : undefined}
      agent={item.type === 'agent' ? agentView(c, access, iid) : undefined}
      quiz={item.type === 'quiz' ? quizView(c, access, iid) : undefined}
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
  if (
    !access ||
    access.role !== 'student' ||
    !access.course.completionEnabled ||
    !canOpenItem(c.var.user!, access, iid, isVisibleItem(iid))
  )
    return c.notFound()
  const item = getItem(id, iid)
  const fields = await readFields(c, 'completionToggle')
  if (!fields) return c.notFound()
  const { on } = fields
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
  if (!item || item.type !== 'file' || !item.fileKey || !canOpenItem(c.var.user!, access, iid, isVisibleItem(iid))) return c.notFound()

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
