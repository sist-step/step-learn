import { and, asc, desc, eq, or } from 'drizzle-orm'
import * as z from 'zod/mini'
import type { AiTool } from './ai'
import { unixToDateInput } from './course-period'
import { getCourseAccessFor } from './courses'
import { contains, db } from './db'
import { bundleFiles, codeItems, courses, enrollments, items, sections } from './schema'
import { ITEM_TYPE_LABELS, type User } from './types'

/** label は画面の会話に出す、ツールで何をしたかの説明 */
export type AiToolResult = { content: string; label: string; isError?: boolean }

export type AiAgentTool = { tool: AiTool; run: (user: User, args: unknown) => AiToolResult | Promise<AiToolResult> }

const MAX_LISTED_COURSES = 100
// 本文を丸ごと渡さないのは、長いページを読むたびに、その会話の以後のすべての要求にその長さの料金がかかるため
const MAX_BODY_LENGTH = 20_000
const MAX_LISTED_FILES = 200

function defineTool<S extends z.ZodMiniObject>(
  name: string,
  description: string,
  schema: S,
  run: (user: User, args: z.output<S>) => AiToolResult | Promise<AiToolResult>,
): AiAgentTool {
  const { $schema: _, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>
  return {
    tool: { name, description, parameters },
    run: (user, raw) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return failure('引数が正しくありません。', `${name} の引数が正しくありません`)
      return run(user, parsed.data)
    },
  }
}

const success = (data: unknown, label: string): AiToolResult => ({ content: JSON.stringify(data), label })

const failure = (message: string, label: string): AiToolResult => ({ content: JSON.stringify({ error: message }), label, isError: true })

const NOT_FOUND = '見つからないか、管理する権限がありません。'

const id = (description: string) => z.int().check(z.positive(), z.describe(description))

const period = (c: { startAt: number | null; endAt: number | null }) => ({
  start: unixToDateInput(c.startAt) || null,
  end: unixToDateInput(c.endAt) || null,
})

const listCourses = defineTool(
  'list_courses',
  '利用者が管理しているコース（教師として登録しているコース。管理者はすべてのコース）の一覧を返す。',
  z.object({ query: z.optional(z.string().check(z.describe('コース名かコースコードの一部。省略するとすべて'))) }),
  (user, { query }) => {
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

const getCourse = defineTool(
  'get_course',
  'コースの設定と、セクションごとのアイテムの一覧（ID・種類・タイトル・表示/非表示）を返す。アイテムの中身は get_item で読む。',
  z.object({ course_id: id('コースの ID') }),
  async (user, { course_id }) => {
    const access = await getCourseAccessFor(user, course_id)
    if (!access?.canManage) return failure(NOT_FOUND, 'コースを開けませんでした')
    const { course } = access
    const sectionRows = db
      .select({ id: sections.id, title: sections.title, summary: sections.summary, hidden: sections.hidden })
      .from(sections)
      .where(eq(sections.courseId, course.id))
      .orderBy(asc(sections.position), asc(sections.id))
      .all()
    const itemRows = db
      .select({ id: items.id, sectionId: items.sectionId, type: items.type, title: items.title, hidden: items.hidden })
      .from(items)
      .where(eq(items.courseId, course.id))
      .orderBy(asc(items.position), asc(items.id))
      .all()
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
        sections: sectionRows.map((s) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
          hidden: s.hidden === 1,
          items: itemRows
            .filter((i) => i.sectionId === s.id)
            .map((i) => ({ id: i.id, type: i.type, type_label: ITEM_TYPE_LABELS[i.type], title: i.title, hidden: i.hidden === 1 })),
        })),
      },
      `「${course.title}」を確認しました`,
    )
  },
)

function itemDetail(item: typeof items.$inferSelect) {
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
  async (user, { item_id }) => {
    const item = db.select().from(items).where(eq(items.id, item_id)).get()
    const access = item && (await getCourseAccessFor(user, item.courseId))
    if (!item || !access?.canManage) return failure(NOT_FOUND, 'アイテムを開けませんでした')
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

/** 通常モードで AI が使えるツール。今は読むだけ */
export const AI_TOOLS: readonly AiAgentTool[] = [listCourses, getCourse, getItem]
