import { and, asc, desc, eq, or } from 'drizzle-orm'
import * as z from 'zod/mini'
import {
  NOT_FOUND,
  STALE,
  changed,
  defineConfirmTool,
  defineTool,
  describedString,
  failure,
  id,
  sameSnapshot,
  success,
  type AiAgentTool,
} from './ai-tool-kit'
import {
  CODE_FILES,
  CODE_LANGUAGES,
  DEFAULT_MAX_SCORE,
  DEFAULT_STARTER,
  MAX_CODE_LENGTH,
  MAX_MAX_SCORE,
  MAX_STDIN_LENGTH,
  filesFor,
  type CodeFiles,
} from './code'
import { availableCodeLanguages } from './code-items'
import { unixToDateInput } from './course-period'
import { getCourseAccessFor, nextPosition, touchCourse } from './courses'
import { contains, db } from './db'
import { isHttpUrl } from './forms'
import { bundleFiles, codeItems, courses, enrollments, items, sections } from './schema'
import { ITEM_TYPE_LABELS, LINK_TARGET_LABELS, LINK_TARGETS, type Item, type User } from './types'

const MAX_LISTED_COURSES = 100
// 本文を丸ごと渡さないのは、長いページを読むたびに、その会話の以後のすべての要求にその長さの料金がかかるため
const MAX_BODY_LENGTH = 20_000
const MAX_LISTED_FILES = 200

const period = (c: { startAt: number | null; endAt: number | null }) => ({
  start: unixToDateInput(c.startAt) || null,
  end: unixToDateInput(c.endAt) || null,
})

async function manageable(user: User, courseId: number) {
  const access = await getCourseAccessFor(user, courseId)
  return access?.canManage ? access : null
}

async function sectionOf(user: User, sectionId: number) {
  const section = db.select().from(sections).where(eq(sections.id, sectionId)).get()
  const access = section && (await manageable(user, section.courseId))
  return section && access ? { section, access } : null
}

async function itemOf(user: User, itemId: number) {
  const item = db.select().from(items).where(eq(items.id, itemId)).get()
  const access = item && (await manageable(user, item.courseId))
  return item && access ? { item, access } : null
}

const sectionTitle = (sectionId: number) =>
  db.select({ title: sections.title }).from(sections).where(eq(sections.id, sectionId)).get()?.title ?? ''

const shown = (hidden: number) => (hidden ? '学生に非表示' : '学生に表示')

// ---------------------------------------------------------------- 読む

const listCourses = defineTool(
  'list_courses',
  '利用者が管理しているコース（教師として登録しているコース。管理者はすべてのコース）の一覧を返す。',
  z.object({ query: z.optional(z.string().check(z.describe('コース名かコースコードの一部。省略するとすべて'))) }),
  (c, { query }) => {
    const user = c.var.user!
    const q = query?.trim()
    const search = q ? or(contains(courses.title, q), contains(courses.code, q)) : undefined
    const columns = {
      id: courses.id,
      title: courses.title,
      code: courses.code,
      visible: courses.visible,
      startAt: courses.startAt,
      endAt: courses.endAt,
    }
    const rows =
      user.role === 'admin'
        ? db.select(columns).from(courses).where(search).orderBy(desc(courses.id)).limit(MAX_LISTED_COURSES).all()
        : db
            .select(columns)
            .from(courses)
            .innerJoin(
              enrollments,
              and(eq(enrollments.courseId, courses.id), eq(enrollments.userId, user.id), eq(enrollments.role, 'teacher')),
            )
            .where(search)
            .orderBy(desc(courses.id))
            .limit(MAX_LISTED_COURSES)
            .all()
    const list = rows.map(({ startAt, endAt, visible, ...c }) => ({ ...c, visible: visible === 1, period: period({ startAt, endAt }) }))
    return success({ courses: list, truncated: list.length === MAX_LISTED_COURSES }, 'コースの一覧を確認しました')
  },
)

const outline = (courseId: number) => {
  const sectionRows = db
    .select({ id: sections.id, title: sections.title, summary: sections.summary, hidden: sections.hidden })
    .from(sections)
    .where(eq(sections.courseId, courseId))
    .orderBy(asc(sections.position), asc(sections.id))
    .all()
  const itemRows = db
    .select({ id: items.id, sectionId: items.sectionId, type: items.type, title: items.title, hidden: items.hidden })
    .from(items)
    .where(eq(items.courseId, courseId))
    .orderBy(asc(items.position), asc(items.id))
    .all()
  return sectionRows.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    hidden: s.hidden === 1,
    items: itemRows
      .filter((i) => i.sectionId === s.id)
      .map((i) => ({ id: i.id, type: i.type, type_label: ITEM_TYPE_LABELS[i.type], title: i.title, hidden: i.hidden === 1 })),
  }))
}

const getCourse = defineTool(
  'get_course',
  'コースの設定と、セクションごとのアイテムの一覧（ID・種類・タイトル・表示/非表示）を並び順で返す。アイテムの中身は get_item で読む。',
  z.object({ course_id: id('コースの ID') }),
  async (c, { course_id }) => {
    const access = await manageable(c.var.user!, course_id)
    if (!access) return failure(NOT_FOUND, 'コースを開けませんでした')
    const { course } = access
    return success(
      {
        course: {
          id: course.id,
          title: course.title,
          code: course.code,
          summary: course.summary,
          visible: course.visible === 1,
          completion_enabled: course.completionEnabled === 1,
          period: period(course),
        },
        sections: outline(course.id),
      },
      `「${course.title}」を確認しました`,
    )
  },
)

function itemDetail(item: Item) {
  switch (item.type) {
    case 'page':
      return { body: item.body.slice(0, MAX_BODY_LENGTH), body_truncated: item.body.length > MAX_BODY_LENGTH }
    case 'link':
      return { url: item.url, link_target: item.linkTarget, description: item.body.slice(0, MAX_BODY_LENGTH) }
    case 'file':
      return {
        file_name: item.fileName,
        file_size: item.fileSize,
        file_type: item.fileType,
        description: item.body.slice(0, MAX_BODY_LENGTH),
      }
    case 'screen':
      return { description: item.body.slice(0, MAX_BODY_LENGTH) }
    case 'code': {
      const code = db.select().from(codeItems).where(eq(codeItems.itemId, item.id)).get()
      return {
        problem: item.body.slice(0, MAX_BODY_LENGTH),
        language: code?.language ?? null,
        starter: code?.starter ?? {},
        stdin: code?.stdin ?? '',
        criteria: code?.criteria ?? '',
        max_score: code?.maxScore ?? null,
      }
    }
    case 'bundle': {
      const files = db
        .select({ path: bundleFiles.path, size: bundleFiles.size })
        .from(bundleFiles)
        .where(eq(bundleFiles.itemId, item.id))
        .orderBy(bundleFiles.path)
        .limit(MAX_LISTED_FILES + 1)
        .all()
      return {
        description: item.body.slice(0, MAX_BODY_LENGTH),
        files: files.slice(0, MAX_LISTED_FILES),
        files_truncated: files.length > MAX_LISTED_FILES,
      }
    }
  }
}

const getItem = defineTool(
  'get_item',
  'アイテムの中身を返す。ページは本文（Markdown）、リンクは URL、コードは問題文・最初のコード・採点基準、ファイル自動配布は配るファイルの一覧。',
  z.object({ item_id: id('アイテムの ID') }),
  async (c, { item_id }) => {
    const found = await itemOf(c.var.user!, item_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを開けませんでした')
    const { item, access } = found
    const section = db
      .select({ title: sections.title, hidden: sections.hidden })
      .from(sections)
      .where(eq(sections.id, item.sectionId))
      .get()
    return success(
      {
        item: {
          id: item.id,
          course_id: item.courseId,
          course_title: access.course.title,
          section: section ? { id: item.sectionId, title: section.title, hidden: section.hidden === 1 } : null,
          type: item.type,
          type_label: ITEM_TYPE_LABELS[item.type],
          title: item.title,
          hidden: item.hidden === 1,
          completion: item.completion,
          ...itemDetail(item),
        },
      },
      `「${item.title}」を確認しました`,
    )
  },
)

// ---------------------------------------------------------------- 追加・並べ替え（すぐ実行する）

const createSection = defineTool(
  'create_section',
  'コースの末尾にセクションを追加する。学生には非表示の状態で作られる。',
  z.object({
    course_id: id('コースの ID'),
    title: describedString('セクション名', 120, 1),
    summary: z.optional(describedString('セクションの説明（Markdown）', 2000)),
  }),
  async (c, { course_id, title, summary }) => {
    const access = await manageable(c.var.user!, course_id)
    if (!access) return failure(NOT_FOUND, 'セクションを追加できませんでした')
    const name = title.trim()
    if (!name) return failure('セクション名が空です。', 'セクションを追加できませんでした')
    const row = db
      .insert(sections)
      .values({
        courseId: course_id,
        title: name,
        summary: summary?.trim() ?? '',
        hidden: 1,
        position: nextPosition(sections, eq(sections.courseId, course_id)),
      })
      .returning({ id: sections.id })
      .get()
    touchCourse(course_id)
    return success({ section_id: row.id, hidden: true }, `セクション「${name}」を追加しました（非表示）`)
  },
)

const CREATABLE_TYPES = ['page', 'link', 'code'] as const

const createItem = defineTool(
  'create_item',
  'セクションの末尾にアイテムを追加する。作れるのはページ・リンク・コード（学生がブラウザでコードを書いて提出し、AI が採点する課題）。学生には非表示の状態で作られる。',
  z.object({
    section_id: id('追加先のセクションの ID'),
    type: z.enum(CREATABLE_TYPES).check(z.describe('page: ページ（Markdown の本文） / link: リンク / code: コード')),
    title: describedString('タイトル', 200, 1),
    body: z.optional(describedString('ページは本文、コードは問題文、リンクは説明（いずれも Markdown）', 100_000)),
    url: z.optional(describedString('リンクの URL（http:// か https:// で始まる）。リンクでは必須', 2000)),
    link_target: z.optional(
      z.enum(LINK_TARGETS).check(z.describe('リンクの開き方。new: 新しいタブ / same: 同じタブ / embed: ページに埋め込む')),
    ),
    language: z.optional(z.enum(CODE_LANGUAGES).check(z.describe('コードの言語。web: HTML / CSS / JavaScript、python: Python'))),
    criteria: z.optional(describedString('コードの採点基準。AI の採点に使い、学生には見せない', 5000)),
    max_score: z.optional(z.int().check(z.minimum(1), z.maximum(MAX_MAX_SCORE), z.describe('コードの満点'))),
  }),
  async (c, args) => {
    const found = await sectionOf(c.var.user!, args.section_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを追加できませんでした')
    const courseId = found.section.courseId
    const title = args.title.trim()
    const fail = (message: string) => failure(message, 'アイテムを追加できませんでした')
    if (!title) return fail('タイトルが空です。')
    const url = args.url?.trim() ?? ''
    if (args.type === 'link' && !isHttpUrl(url)) return fail('リンクには http:// か https:// で始まる URL が必要です。')
    const language = args.language ?? 'web'
    if (args.type === 'code' && !availableCodeLanguages.includes(language))
      return fail('Python を実行する環境が設定されていないため、Python のコードは作れません。')

    const created = db.transaction((tx) => {
      const row = tx
        .insert(items)
        .values({
          courseId,
          sectionId: args.section_id,
          type: args.type,
          title,
          body: args.body ?? '',
          url: args.type === 'link' ? url : '',
          linkTarget: args.type === 'link' ? (args.link_target ?? 'new') : 'new',
          hidden: 1,
          position: nextPosition(items, eq(items.sectionId, args.section_id)),
        })
        .returning({ id: items.id })
        .get()
      if (args.type === 'code')
        tx.insert(codeItems)
          .values({
            itemId: row.id,
            language,
            starter: DEFAULT_STARTER[language],
            criteria: args.criteria ?? '',
            maxScore: args.max_score ?? DEFAULT_MAX_SCORE,
          })
          .run()
      return row
    })
    touchCourse(courseId)
    return success({ item_id: created.id, hidden: true }, `「${title}」を追加しました（非表示）`)
  },
)

/** ids が今の並びと同じ顔ぶれなら、その順に position を振り直す */
function reorder(table: typeof sections | typeof items, current: number[], ids: number[]) {
  const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((i) => current.includes(i))
  if (!same) return false
  db.transaction((tx) => {
    ids.forEach((rowId, position) => tx.update(table).set({ position }).where(eq(table.id, rowId)).run())
  })
  return true
}

const reorderSections = defineTool(
  'reorder_sections',
  'コースのセクションを並べ替える。section_ids には、コースのすべてのセクションの ID を新しい順に並べる。',
  z.object({
    course_id: id('コースの ID'),
    section_ids: z.array(id('セクションの ID')).check(z.describe('すべてのセクションの ID を新しい順に')),
  }),
  async (c, { course_id, section_ids }) => {
    const access = await manageable(c.var.user!, course_id)
    if (!access) return failure(NOT_FOUND, 'セクションを並べ替えられませんでした')
    const current = db.select({ id: sections.id }).from(sections).where(eq(sections.courseId, course_id)).all()
    if (
      !reorder(
        sections,
        current.map((s) => s.id),
        section_ids,
      )
    )
      return failure(
        'section_ids がコースのセクションと一致しません。get_course で確かめてから、すべての ID を 1 回ずつ並べてください。',
        'セクションを並べ替えられませんでした',
      )
    touchCourse(course_id)
    return success({ ok: true }, `「${access.course.title}」のセクションを並べ替えました`)
  },
)

const reorderItems = defineTool(
  'reorder_items',
  'セクションの中のアイテムを並べ替える。item_ids には、そのセクションのすべてのアイテムの ID を新しい順に並べる。別のセクションへ移すときは update_item を使う。',
  z.object({
    section_id: id('セクションの ID'),
    item_ids: z.array(id('アイテムの ID')).check(z.describe('セクションのすべてのアイテムの ID を新しい順に')),
  }),
  async (c, { section_id, item_ids }) => {
    const found = await sectionOf(c.var.user!, section_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを並べ替えられませんでした')
    const current = db.select({ id: items.id }).from(items).where(eq(items.sectionId, section_id)).all()
    if (
      !reorder(
        items,
        current.map((i) => i.id),
        item_ids,
      )
    )
      return failure(
        'item_ids がセクションのアイテムと一致しません。get_course で確かめてから、すべての ID を 1 回ずつ並べてください。',
        'アイテムを並べ替えられませんでした',
      )
    touchCourse(found.section.courseId)
    return success({ ok: true }, `「${found.section.title}」のアイテムを並べ替えました`)
  },
)

// ---------------------------------------------------------------- 変更・表示の切り替え（利用者が確認してから実行する）

const NO_CHANGE = '今の内容と同じなので、変更するところがありません。'

const sectionSnapshot = (s: typeof sections.$inferSelect) => ({ title: s.title, summary: s.summary })

const updateSection = defineConfirmTool(
  'update_section',
  'セクションの名前や説明を変える。利用者が確認カードで承認してから実行される。変えない欄は省く。',
  z.object({
    section_id: id('セクションの ID'),
    title: z.optional(describedString('新しいセクション名', 120, 1)),
    summary: z.optional(describedString('新しい説明（Markdown）。全文を書く', 2000)),
  }),
  async (c, { section_id, title, summary }) => {
    const found = await sectionOf(c.var.user!, section_id)
    if (!found) return failure(NOT_FOUND, 'セクションを開けませんでした')
    const { section } = found
    const changes = [
      ...changed('セクション名', section.title, title?.trim() || undefined),
      ...changed('説明', section.summary, summary?.trim(), true),
    ]
    if (changes.length === 0) return failure(NO_CHANGE, 'セクションを変更しませんでした')
    return { title: `セクション「${section.title}」を変更する`, changes, snapshot: sectionSnapshot(section) }
  },
  async (c, { section_id, title, summary }, snapshot) => {
    const found = await sectionOf(c.var.user!, section_id)
    if (!found) return failure(NOT_FOUND, 'セクションを変更できませんでした')
    if (!sameSnapshot(sectionSnapshot(found.section), snapshot)) return failure(STALE, 'セクションを変更できませんでした')
    db.update(sections)
      .set({ title: title?.trim() || found.section.title, summary: summary?.trim() ?? found.section.summary })
      .where(eq(sections.id, section_id))
      .run()
    touchCourse(found.section.courseId)
    return success({ ok: true }, `セクション「${title?.trim() || found.section.title}」を変更しました`)
  },
)

const BODY_LABELS: Record<Item['type'], string> = {
  page: '本文',
  code: '問題文',
  link: '説明',
  file: '説明',
  screen: '説明',
  bundle: '説明',
}

const codeOf = (itemId: number) => db.select().from(codeItems).where(eq(codeItems.itemId, itemId)).get()

const itemSnapshot = (item: Item) => {
  const code = item.type === 'code' ? codeOf(item.id) : undefined
  return {
    title: item.title,
    body: item.body,
    url: item.url,
    linkTarget: item.linkTarget,
    sectionId: item.sectionId,
    code: code ? { starter: code.starter, stdin: code.stdin, criteria: code.criteria, maxScore: code.maxScore } : null,
  }
}

const starterSchema = z.object(
  Object.fromEntries(
    (['html', 'css', 'js', 'py'] as const).map((key) => [key, z.optional(describedString(`${key} のファイルの全文`, MAX_CODE_LENGTH))]),
  ) as Record<'html' | 'css' | 'js' | 'py', z.ZodMiniOptional<z.ZodMiniString>>,
)

const updateItemArgs = z.object({
  item_id: id('アイテムの ID'),
  title: z.optional(describedString('新しいタイトル', 200, 1)),
  body: z.optional(describedString('新しい本文・問題文・説明（Markdown）。一部だけでなく全文を書く', 100_000)),
  url: z.optional(describedString('新しい URL（リンクだけ）', 2000)),
  link_target: z.optional(z.enum(LINK_TARGETS).check(z.describe('リンクの開き方（リンクだけ）'))),
  section_id: z.optional(id('移し先のセクションの ID（同じコースの中だけ）。移すと末尾に入る')),
  criteria: z.optional(describedString('新しい採点基準（コードだけ）', 5000)),
  max_score: z.optional(z.int().check(z.minimum(1), z.maximum(MAX_MAX_SCORE), z.describe('新しい満点（コードだけ）'))),
  starter: z.optional(
    starterSchema.check(
      z.describe('最初に入れておくコード（コードだけ）。変えるファイルだけを全文で書く。web は html / css / js、python は py'),
    ),
  ),
  stdin: z.optional(describedString('Python の入力の例（コードの python だけ）', MAX_STDIN_LENGTH)),
})

type UpdateItemArgs = z.output<typeof updateItemArgs>

function checkItemArgs(item: Item, args: UpdateItemArgs, sectionCourse: number | null) {
  if ((args.url !== undefined || args.link_target !== undefined) && item.type !== 'link')
    return 'URL と開き方はリンクのアイテムでだけ変えられます。'
  if (args.url !== undefined && !isHttpUrl(args.url.trim())) return 'URL は http:// か https:// で始めてください。'
  const codeArgs = [args.criteria, args.max_score, args.starter, args.stdin]
  if (codeArgs.some((v) => v !== undefined) && item.type !== 'code')
    return '採点基準・満点・最初のコード・入力の例は、コードのアイテムでだけ変えられます。'
  if (args.section_id !== undefined && sectionCourse !== item.courseId) return '移し先のセクションが、同じコースにありません。'
  return null
}

const sectionCourseOf = (sectionId: number | undefined) =>
  sectionId === undefined
    ? null
    : (db.select({ courseId: sections.courseId }).from(sections).where(eq(sections.id, sectionId)).get()?.courseId ?? null)

function itemChanges(item: Item, args: UpdateItemArgs) {
  const code = item.type === 'code' ? codeOf(item.id) : undefined
  const files = code ? CODE_FILES[code.language] : []
  return [
    ...changed('タイトル', item.title, args.title?.trim() || undefined),
    ...changed(BODY_LABELS[item.type], item.body, args.body, true),
    ...changed('URL', item.url, args.url?.trim()),
    ...changed('開き方', LINK_TARGET_LABELS[item.linkTarget], args.link_target && LINK_TARGET_LABELS[args.link_target]),
    ...(args.section_id !== undefined && args.section_id !== item.sectionId
      ? [{ label: 'セクション', before: sectionTitle(item.sectionId), after: sectionTitle(args.section_id) }]
      : []),
    ...(code
      ? [
          ...files.flatMap((f) => changed(`最初のコード（${f.name}）`, code.starter[f.key] ?? '', args.starter?.[f.key], true)),
          ...changed('入力の例', code.stdin, code.language === 'python' ? args.stdin : undefined, true),
          ...changed('採点基準', code.criteria, args.criteria, true),
          ...changed('満点', String(code.maxScore), args.max_score === undefined ? undefined : String(args.max_score)),
        ]
      : []),
  ]
}

const updateItem = defineConfirmTool(
  'update_item',
  'アイテムのタイトル・本文・URL・セクション、コードの採点基準や最初のコードを変える。利用者が確認カードで承認してから実行される。変えない欄は省く。',
  updateItemArgs,
  async (c, args) => {
    const found = await itemOf(c.var.user!, args.item_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを開けませんでした')
    const { item } = found
    const problem = checkItemArgs(item, args, sectionCourseOf(args.section_id))
    if (problem) return failure(problem, `「${item.title}」を変更しませんでした`)
    const changes = itemChanges(item, args)
    if (changes.length === 0) return failure(NO_CHANGE, `「${item.title}」を変更しませんでした`)
    return { title: `「${item.title}」を変更する`, changes, snapshot: itemSnapshot(item) }
  },
  async (c, args, snapshot) => {
    const found = await itemOf(c.var.user!, args.item_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを変更できませんでした')
    const { item } = found
    const label = `「${item.title}」を変更できませんでした`
    if (!sameSnapshot(itemSnapshot(item), snapshot)) return failure(STALE, label)
    const problem = checkItemArgs(item, args, sectionCourseOf(args.section_id))
    if (problem) return failure(problem, label)
    const moving = args.section_id !== undefined && args.section_id !== item.sectionId
    const code = item.type === 'code' ? codeOf(item.id) : undefined
    db.transaction((tx) => {
      tx.update(items)
        .set({
          title: args.title?.trim() || item.title,
          body: args.body ?? item.body,
          url: args.url?.trim() ?? item.url,
          linkTarget: args.link_target ?? item.linkTarget,
          ...(moving && { sectionId: args.section_id, position: nextPosition(items, eq(items.sectionId, args.section_id!)) }),
        })
        .where(eq(items.id, item.id))
        .run()
      if (code) {
        const starter: CodeFiles = { ...code.starter, ...args.starter }
        tx.update(codeItems)
          .set({
            starter: filesFor(code.language, starter),
            stdin: code.language === 'python' ? (args.stdin ?? code.stdin) : '',
            criteria: args.criteria ?? code.criteria,
            maxScore: args.max_score ?? code.maxScore,
          })
          .where(eq(codeItems.itemId, item.id))
          .run()
      }
    })
    touchCourse(item.courseId)
    return success({ ok: true }, `「${args.title?.trim() || item.title}」を変更しました`)
  },
)

const VISIBILITY_TARGETS = ['section', 'item'] as const

async function visibilityTarget(user: User, target: (typeof VISIBILITY_TARGETS)[number], targetId: number) {
  if (target === 'section') {
    const found = await sectionOf(user, targetId)
    return (
      found && {
        table: sections,
        title: `セクション「${found.section.title}」`,
        hidden: found.section.hidden,
        courseId: found.section.courseId,
      }
    )
  }
  const found = await itemOf(user, targetId)
  return found && { table: items, title: `「${found.item.title}」`, hidden: found.item.hidden, courseId: found.item.courseId }
}

const setVisibility = defineConfirmTool(
  'set_visibility',
  'セクションかアイテムを、学生に表示するか非表示にするかを切り替える。利用者が確認カードで承認してから実行される。',
  z.object({
    target: z.enum(VISIBILITY_TARGETS).check(z.describe('section: セクション / item: アイテム')),
    id: id('セクションかアイテムの ID'),
    hidden: z.boolean().check(z.describe('true: 学生に非表示にする / false: 学生に表示する')),
  }),
  async (c, { target, id: targetId, hidden }) => {
    const found = await visibilityTarget(c.var.user!, target, targetId)
    if (!found) return failure(NOT_FOUND, '表示を切り替えられませんでした')
    const next = hidden ? 1 : 0
    if (found.hidden === next) return failure(`すでに${shown(next)}になっています。`, '表示を切り替えませんでした')
    return {
      title: `${found.title}を${shown(next)}にする`,
      changes: [{ label: '学生への表示', before: shown(found.hidden), after: shown(next) }],
      snapshot: { hidden: found.hidden },
    }
  },
  async (c, { target, id: targetId, hidden }, snapshot) => {
    const found = await visibilityTarget(c.var.user!, target, targetId)
    if (!found) return failure(NOT_FOUND, '表示を切り替えられませんでした')
    if (!sameSnapshot({ hidden: found.hidden }, snapshot)) return failure(STALE, '表示を切り替えられませんでした')
    const next = hidden ? 1 : 0
    db.update(found.table).set({ hidden: next }).where(eq(found.table.id, targetId)).run()
    touchCourse(found.courseId)
    return success({ ok: true }, `${found.title}を${shown(next)}にしました`)
  },
)

/** 通常モードで AI が使えるツール。削除・ファイル・画面共有・受講者・コースの設定は扱わない */
export const AI_TOOLS: readonly AiAgentTool[] = [
  listCourses,
  getCourse,
  getItem,
  createSection,
  createItem,
  reorderSections,
  reorderItems,
  updateSection,
  updateItem,
  setVisibility,
]
