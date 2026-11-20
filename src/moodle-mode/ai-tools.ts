import type { Context } from 'hono'
import * as z from 'zod/mini'
import {
  NOT_FOUND,
  STALE,
  changed,
  constraintLines,
  constraintsSchema,
  defineConfirmTool,
  defineTool,
  inCourse,
  inItem,
  describedString,
  failure,
  fileChange,
  fileId,
  id,
  reorderProposal,
  sameMembers,
  sameSnapshot,
  success,
  toConstraints,
  UPLOAD_NOT_FOUND,
  type AiAgentTool,
  type AiFileReader,
  type AiToolContext,
} from '../lib/ai-tool-kit'
import {
  CODE_FILES,
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  DEFAULT_STARTER,
  MAX_CODE_LENGTH,
  MAX_STDIN_LENGTH,
  filesFor,
  isFinalized,
} from '../lib/code'
import { config } from '../lib/config'
import { isHttpUrl } from '../lib/forms'
import { availableCodeLanguages } from '../lib/sandbox'
import { LINK_TARGET_LABELS, LINK_TARGETS } from '../lib/types'
import { consumeUpload, findUpload, type MoodleAiUpload } from './ai-uploads'
import type { MoodleEnv } from './auth'
import { forgetCourse } from './cache'
import { fetchFile } from './client'
import { codeSettingsOf, codeStageOf } from './code-store'
import { loadCourse, moodle, myCourses, otherCourses, type LoadedCourse } from './data'
import { insertExtra, newExtraKey, updateExtraData } from './extra'
import { CODE_KIND, extraKindOf } from './extra-kinds'
import { EXTRA_PATH, type MItem, type MSection } from './mapping'

const moodleContext = (c: AiToolContext) => c as Context<MoodleEnv>

const MAX_BODY_LENGTH = 20_000

const KIND_LABELS: Record<MItem['kind'], string> = {
  link: 'リンク',
  file: 'ファイル',
  moodle: 'Moodle の活動',
  label: 'ラベル',
  subsection: 'サブセクション',
  extra: 'STEP Learn のアイテム',
}

/** 管理できるコース。Moodle が見せないコースは notfound で例外になるので、null にする */
async function manageable(c: AiToolContext, courseId: number, fresh = false) {
  try {
    const loaded = await loadCourse(moodleContext(c), courseId, { fresh })
    return loaded.access.canManage ? loaded : null
  } catch {
    return null
  }
}

// サブセクションの中身のセクションを対象にしないのは、Moodle ではサブセクションの活動と一緒に動かしたり消したりするもので、単独で操作すると壊れるため
const topSections = (loaded: LoadedCourse) => loaded.sections.filter((s) => !s.parentId)

const findItem = (loaded: LoadedCourse, itemId: number) => loaded.items.find((it) => it.id === itemId)

/** item_id から、その活動のあるコースを探す。Moodle に活動からコースを引く関数がないので、管理しているコースを順に見る */
async function courseOfItem(c: AiToolContext, itemId: number, courseId: number | undefined, fresh = false) {
  const candidates = courseId ? [courseId] : (await myCourses(moodleContext(c))).filter((m) => m.canmanage).map((m) => m.id)
  for (const cid of candidates) {
    const loaded = await manageable(c, cid, fresh)
    const item = loaded && findItem(loaded, itemId)
    if (loaded && item) return { loaded, item }
  }
  return null
}

const shown = (hidden: boolean) => (hidden ? '学生に非表示' : '学生に表示')

export const codeKind = (item: MItem) => item.kind === 'extra' && item.extra?.type === CODE_KIND && !!item.extraKey

// ---------------------------------------------------------------- 読む

const listCourses = defineTool(
  'list_courses',
  '利用者が管理しているコース（教師として登録しているコース。サイト管理者はほかのコースも）の一覧を返す。',
  z.object({ query: z.optional(z.string().check(z.describe('コース名かコースコードの一部。省略するとすべて'))) }),
  async (c, { query }) => {
    const mc = moodleContext(c)
    const [mine, others] = await Promise.all([myCourses(mc), c.var.user!.role === 'admin' ? otherCourses(mc) : []])
    const q = query?.trim().toLowerCase()
    const list = [...mine, ...others]
      .filter((m) => m.canmanage)
      .filter((m) => !q || [m.fullname, m.shortname].some((s) => s.toLowerCase().includes(q)))
      .map((m) => ({ id: m.id, title: m.fullname, code: m.shortname, visible: m.visible }))
    return success({ courses: list }, 'コースの一覧を確認しました')
  },
)

const outline = (loaded: LoadedCourse) =>
  topSections(loaded).map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    hidden: s.hidden,
    general: s.number === 0,
    items: loaded.items
      .filter((it) => it.sectionId === s.id)
      .map((it) => ({ id: it.id, kind: it.kind, kind_label: kindLabel(it), title: it.title, hidden: it.hidden })),
  }))

export const kindLabel = (it: MItem) =>
  codeKind(it)
    ? 'コーディング問題'
    : it.kind === 'extra'
      ? (extraKindOf(it.extra?.type ?? '')?.label ?? KIND_LABELS.extra)
      : it.kind === 'moodle'
        ? `Moodle の活動（${it.modname}）`
        : KIND_LABELS[it.kind]

const getCourse = defineTool(
  'get_course',
  'コースと、セクションごとのアイテムの一覧（ID・種類・タイトル・表示/非表示）を並び順で返す。アイテムの中身は get_item で読む。general が true のセクション（一般）は動かせず、非表示にもできない。',
  z.object({ course_id: id('コースの ID') }),
  async (c, { course_id }) => {
    const loaded = await manageable(c, course_id)
    if (!loaded) return failure(NOT_FOUND, 'コースを開けませんでした')
    const { course } = loaded
    return success(
      { course: { id: course.id, title: course.fullname, code: course.shortname, visible: course.visible }, sections: outline(loaded) },
      `「${course.fullname}」を確認しました`,
    )
  },
)

function itemDetail(item: MItem) {
  if (item.kind === 'link') return { url: item.url, link_target: item.linkTarget, description: item.body.slice(0, MAX_BODY_LENGTH) }
  if (item.kind === 'file')
    return {
      file_name: item.fileName,
      file_size: item.fileSize,
      file_type: item.fileType,
      description: item.body.slice(0, MAX_BODY_LENGTH),
    }
  if (item.kind === 'label') return { body: item.body.slice(0, MAX_BODY_LENGTH) }
  const settings = codeKind(item) && item.extra ? codeSettingsOf(item.extra.data, item.title) : null
  if (settings)
    return {
      problem: settings.body.slice(0, MAX_BODY_LENGTH),
      language: settings.language,
      starter: settings.starter,
      stdin: settings.stdin,
      constraints: settings.constraints,
      criteria: settings.criteria,
    }
  return { description: item.body.slice(0, MAX_BODY_LENGTH) }
}

const getItem = defineTool(
  'get_item',
  'アイテムの中身を返す。リンクは URL、コーディング問題は問題文・最初のコード・制約・補足。course_id が分かっていれば一緒に渡す。',
  z.object({ item_id: id('アイテムの ID'), course_id: z.optional(id('アイテムのあるコースの ID')) }),
  async (c, { item_id, course_id }) => {
    const found = await courseOfItem(c, item_id, course_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを開けませんでした')
    const { loaded, item } = found
    const section = loaded.sections.find((s) => s.id === item.sectionId)
    return success(
      {
        item: {
          id: item.id,
          course_id: loaded.course.id,
          course_title: loaded.course.fullname,
          section: section ? { id: section.id, title: section.title, hidden: section.hidden } : null,
          kind: item.kind,
          kind_label: kindLabel(item),
          title: item.title,
          hidden: item.hidden,
          ...itemDetail(item),
        },
      },
      `「${item.title}」を確認しました`,
    )
  },
)

/** read_file（lib/ai-agent.ts）で読む、利用者が管理しているファイルのアイテム（Moodle のファイルの活動） */
export const readMoodleItemFile: AiFileReader = async (c, itemId, courseId) => {
  const found = await courseOfItem(c, itemId, courseId)
  if (!found) return failure(NOT_FOUND, 'ファイルを開けませんでした')
  const { item } = found
  if (item.kind !== 'file' || !item.fileUrl)
    return failure('ファイルのアイテムではありません。', `「${item.title}」のファイルを読めませんでした`)
  const read = async () => {
    const res = await fetchFile(moodleContext(c).var.token!, item.fileUrl)
    return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null
  }
  return { title: item.title, name: item.fileName, size: item.fileSize, read }
}

// ---------------------------------------------------------------- 追加・並べ替え（利用者が確認してから実行する）
// 追加と並べ替えもすぐ実行しないのは、AI が読んだ教材（ほかの教師が書いたもの）に指示を仕込まれると、利用者の知らないうちに、
// ほかのコースの非公開の内容を書き写したアイテムを作らせたり、ほかのコースの並びを変えさせたりできるため

const createSection = defineConfirmTool(
  'create_section',
  'コースの末尾にセクションを追加する。学生には非表示の状態で作られる。利用者が確認カードで承認してから実行される。',
  z.object({
    course_id: id('コースの ID'),
    title: describedString('セクション名', 120, 1),
    summary: z.optional(describedString('セクションの説明', 2000)),
  }),
  async (c, { course_id, title, summary }) => {
    const loaded = await manageable(c, course_id)
    if (!loaded) return failure(NOT_FOUND, 'セクションを追加できませんでした')
    const name = title.trim()
    if (!name) return failure('セクション名が空です。', 'セクションを追加できませんでした')
    return {
      title: `「${loaded.course.fullname}」にセクションを追加する（学生には非表示）`,
      changes: [{ label: 'セクション名', before: '', after: name }, ...changed('説明', '', summary?.trim(), true)],
      snapshot: null,
    }
  },
  async (c, { course_id, title, summary }) => {
    const loaded = await manageable(c, course_id)
    if (!loaded) return failure(NOT_FOUND, 'セクションを追加できませんでした')
    const name = title.trim()
    if (!name) return failure('セクション名が空です。', 'セクションを追加できませんでした')
    const api = moodle(moodleContext(c))
    const sid = await api.createSection(course_id, name)
    // 表示のまま作ってから隠すのは、Moodle のセクションを作る関数が、表示・非表示を受け取らないため
    await api.updateCourse(course_id, 'section_hide', [sid])
    if (summary?.trim()) await api.updateSection(course_id, sid, name, summary.trim())
    forgetCourse(course_id)
    return success({ section_id: sid, hidden: true }, `セクション「${name}」を追加しました（非表示）`, inCourse(course_id, sid))
  },
)

const extraUrl = (c: AiToolContext, key: string) => `${config.appOrigin ?? new URL(c.req.url).origin}${EXTRA_PATH}${key}`

const CREATABLE_TYPES = ['link', 'file', 'code'] as const

const CREATABLE_LABELS: Record<(typeof CREATABLE_TYPES)[number], string> = { link: 'リンク', file: 'ファイル', code: 'コーディング問題' }

const createItemArgs = z.object({
  course_id: id('コースの ID'),
  section_id: id('追加先のセクションの ID'),
  type: z.enum(CREATABLE_TYPES).check(z.describe('link: リンク / file: ファイル / code: コーディング問題')),
  title: describedString('タイトル', 200, 1),
  file_id: z.optional(fileId('ファイルのアイテムに置くファイル。ファイルでは必須')),
  url: z.optional(describedString('リンクの URL（http:// か https:// で始まる）。リンクでは必須', 2000)),
  link_target: z.optional(
    z.enum(LINK_TARGETS).check(z.describe('リンクの開き方。new: 新しいタブ / same: 同じタブ / embed: ページに埋め込む')),
  ),
  body: z.optional(describedString('コーディング問題の問題文（Markdown）', 100_000)),
  language: z.optional(
    z
      .enum(CODE_LANGUAGES)
      .check(
        z.describe(`コードの言語。web: HTML / CSS / JavaScript、python: Python。今作れるのは ${availableCodeLanguages.join('・')} だけ`),
      ),
  ),
  constraints: z.optional(
    constraintsSchema('コーディング問題の制約。AI が提出を制約ごとに判定し、すべてできていればクリアになる。コーディング問題では必須'),
  ),
  criteria: z.optional(
    describedString('コーディング問題の補足。制約にしにくい観点（読みやすさなど）。AI の判定に使い、学生には見せない', 5000),
  ),
})

/** 追加するアイテムの引数を確かめる。提案と実行のどちらでも、そのときの権限とファイルで確かめ直す */
async function checkNewItem(c: AiToolContext, args: z.output<typeof createItemArgs>) {
  const loaded = await manageable(c, args.course_id)
  const section = loaded && loaded.sections.find((s) => s.id === args.section_id)
  if (!loaded || !section) return failure(NOT_FOUND, 'アイテムを追加できませんでした')
  const fail = (message: string) => failure(message, 'アイテムを追加できませんでした')
  const title = args.title.trim()
  if (!title) return fail('タイトルが空です。')
  const url = args.url?.trim() ?? ''
  if (args.type === 'link' && !isHttpUrl(url)) return fail('リンクには http:// か https:// で始まる URL が必要です。')
  const language = args.language ?? 'web'
  if (args.type === 'code' && !args.constraints?.length) return fail('コーディング問題には制約（constraints）を 1 つ以上渡してください。')
  if (args.type === 'code' && !availableCodeLanguages.includes(language))
    return fail(
      `${CODE_LANGUAGE_LABELS[language]} のコードは作れません。今は ${availableCodeLanguages.map((l) => CODE_LANGUAGE_LABELS[l]).join('・')} だけ作れます。`,
    )
  const upload = args.type === 'file' && args.file_id ? findUpload(c.var.user!.id, args.file_id) : undefined
  if (args.type === 'file' && !upload) return fail(args.file_id ? UPLOAD_NOT_FOUND : 'ファイルには file_id を渡してください。')
  return { loaded, section, title, url, language, upload }
}

const createItem = defineConfirmTool(
  'create_item',
  'セクションの末尾にアイテムを追加する。作れるのはリンク（Moodle の URL の活動）・ファイル（Moodle のファイルの活動。request_file で受け取ったもの）・コーディング問題（学生がブラウザでコードを書いて提出し、AI が制約ごとに判定する課題）。学生には非表示の状態で作られる。利用者が確認カードで承認してから実行される。',
  createItemArgs,
  async (c, args) => {
    const checked = await checkNewItem(c, args)
    if ('content' in checked) return checked
    const { loaded, section, title, url, language, upload } = checked
    const link = args.type === 'link'
    const code = args.type === 'code'
    return {
      title: `「${loaded.course.fullname}」の「${section.title}」に${CREATABLE_LABELS[args.type]}を追加する（学生には非表示）`,
      changes: [
        { label: 'タイトル', before: '', after: title },
        ...(link ? [{ label: 'URL', before: '', after: url }] : []),
        ...(link ? [{ label: '開き方', before: '', after: LINK_TARGET_LABELS[args.link_target ?? 'new'] }] : []),
        ...(upload ? [fileChange({ name: '', size: 0 }, upload)] : []),
        ...(code ? changed('問題文', '', args.body, true) : []),
        ...(code ? [{ label: '言語', before: '', after: CODE_LANGUAGE_LABELS[language] }] : []),
        ...(code ? changed('制約', '', constraintLines(toConstraints(args.constraints ?? [])), true) : []),
        ...(code ? changed('補足', '', args.criteria, true) : []),
      ],
      snapshot: null,
    }
  },
  async (c, args) => {
    const checked = await checkNewItem(c, args)
    if ('content' in checked) return checked
    const { title, url, language, upload } = checked
    const api = moodle(moodleContext(c))
    const activity = { courseid: args.course_id, cmid: 0, sectionid: args.section_id, name: title, completion: 'none', visible: false }
    let cmid: number
    if (args.type === 'link') {
      cmid = await api.saveUrl({ ...activity, externalurl: url, display: args.link_target ?? 'new' })
    } else if (upload) {
      cmid = await api.saveResource({ ...activity, draftitemid: upload.draftItemId })
      consumeUpload(upload.id)
    } else {
      const key = newExtraKey()
      // 新しいタブで開くのは、Moodle の画面から開いたときも、STEP Learn の一覧と同じくエディターを別のタブに出すため
      cmid = await api.saveUrl({ ...activity, externalurl: extraUrl(c, key), display: 'new' })
      insertExtra({
        key,
        courseId: args.course_id,
        cmid,
        type: CODE_KIND,
        data: {
          title,
          body: args.body ?? '',
          language,
          starter: DEFAULT_STARTER[language],
          stdin: '',
          criteria: args.criteria ?? '',
          constraints: toConstraints(args.constraints ?? []),
          opensAt: null,
          closesAt: null,
          stage: 'draft',
          guides: [],
        },
      })
    }
    forgetCourse(args.course_id)
    return success({ item_id: cmid, hidden: true }, `「${title}」を追加しました（非表示）`, inItem(args.course_id, cmid, args.section_id))
  },
)

const SECTIONS_MISMATCH =
  'section_ids がコースのセクション（一般を除く）と一致しません。get_course で確かめてから、すべての ID を 1 回ずつ並べてください。'
const ITEMS_MISMATCH = 'item_ids がセクションのアイテムと一致しません。get_course で確かめてから、すべての ID を 1 回ずつ並べてください。'

/** 並べ替えるセクション。一般はいつも先頭にあり、動かせない */
const movableSections = (loaded: LoadedCourse) => topSections(loaded).filter((s) => s.number !== 0)

const itemsIn = (loaded: LoadedCourse, sectionId: number) => loaded.items.filter((it) => it.sectionId === sectionId)

const reorderSections = defineConfirmTool(
  'reorder_sections',
  'コースのセクションを並べ替える。section_ids には、一般（general）を除くすべてのセクションの ID を新しい順に並べる。一般はいつも先頭にある。利用者が確認カードで承認してから実行される。',
  z.object({
    course_id: id('コースの ID'),
    section_ids: z.array(id('セクションの ID')).check(z.describe('一般を除くすべてのセクションの ID を新しい順に')),
  }),
  async (c, { course_id, section_ids }) => {
    const label = 'セクションを並べ替えられませんでした'
    const loaded = await manageable(c, course_id, true)
    if (!loaded) return failure(NOT_FOUND, label)
    const title = `「${loaded.course.fullname}」のセクションを並べ替える`
    return reorderProposal(title, movableSections(loaded), section_ids, SECTIONS_MISMATCH, label)
  },
  async (c, { course_id, section_ids }, snapshot) => {
    const label = 'セクションを並べ替えられませんでした'
    const loaded = await manageable(c, course_id, true)
    if (!loaded) return failure(NOT_FOUND, label)
    const sections = topSections(loaded)
    const general = sections.find((s) => s.number === 0)
    const current = movableSections(loaded).map((s) => s.id)
    if (!sameSnapshot(current, snapshot)) return failure(STALE, label)
    if (!general || !sameMembers(section_ids, current)) return failure(SECTIONS_MISMATCH, label)
    const api = moodle(moodleContext(c))
    // Moodle は「このセクションの後ろへ」しか指定できないので、一般の後ろから順に 1 つずつ後ろへつなげる
    let after: MSection = general
    for (const sid of section_ids) {
      await api.updateCourse(course_id, 'section_move_after', [sid], { sectionid: after.id })
      after = sections.find((s) => s.id === sid)!
    }
    forgetCourse(course_id)
    return success({ ok: true }, `「${loaded.course.fullname}」のセクションを並べ替えました`, inCourse(course_id))
  },
)

const reorderItems = defineConfirmTool(
  'reorder_items',
  'セクションの中のアイテムを並べ替える。item_ids には、そのセクションのすべてのアイテムの ID を新しい順に並べる。別のセクションへ移すときは update_item を使う。利用者が確認カードで承認してから実行される。',
  z.object({
    course_id: id('コースの ID'),
    section_id: id('セクションの ID'),
    item_ids: z.array(id('アイテムの ID')).check(z.describe('セクションのすべてのアイテムの ID を新しい順に')),
  }),
  async (c, { course_id, section_id, item_ids }) => {
    const label = 'アイテムを並べ替えられませんでした'
    const found = await sectionOf(c, course_id, section_id, true)
    if (!found) return failure(NOT_FOUND, label)
    const title = `「${found.section.title}」のアイテムを並べ替える`
    return reorderProposal(title, itemsIn(found.loaded, section_id), item_ids, ITEMS_MISMATCH, label)
  },
  async (c, { course_id, section_id, item_ids }, snapshot) => {
    const label = 'アイテムを並べ替えられませんでした'
    const found = await sectionOf(c, course_id, section_id, true)
    if (!found) return failure(NOT_FOUND, label)
    const current = itemsIn(found.loaded, section_id).map((it) => it.id)
    if (!sameSnapshot(current, snapshot)) return failure(STALE, label)
    if (!sameMembers(item_ids, current)) return failure(ITEMS_MISMATCH, label)
    const api = moodle(moodleContext(c))
    // Moodle は「この活動の前へ」かセクションの末尾へしか動かせないので、新しい順に 1 つずつ末尾へ送る
    for (const cmid of item_ids) await api.updateCourse(course_id, 'cm_move', [cmid], { sectionid: section_id })
    forgetCourse(course_id)
    return success({ ok: true }, `「${found.section.title}」のアイテムを並べ替えました`, inCourse(course_id, section_id))
  },
)

// ---------------------------------------------------------------- 変更・表示の切り替え（利用者が確認してから実行する）

const NO_CHANGE = '今の内容と同じなので、変更するところがありません。'

const sectionSnapshot = (s: MSection) => ({ title: s.title, summary: s.summary })

async function sectionOf(c: AiToolContext, courseId: number, sectionId: number, fresh = false) {
  const loaded = await manageable(c, courseId, fresh)
  const section = loaded && topSections(loaded).find((s) => s.id === sectionId)
  return loaded && section ? { loaded, section } : null
}

const updateSection = defineConfirmTool(
  'update_section',
  'セクションの名前や説明を変える。利用者が確認カードで承認してから実行される。変えない欄は省く。',
  z.object({
    course_id: id('コースの ID'),
    section_id: id('セクションの ID'),
    title: z.optional(describedString('新しいセクション名', 120, 1)),
    summary: z.optional(describedString('新しい説明。全文を書く', 2000)),
  }),
  async (c, { course_id, section_id, title, summary }) => {
    const found = await sectionOf(c, course_id, section_id)
    if (!found) return failure(NOT_FOUND, 'セクションを開けませんでした')
    const { section } = found
    const changes = [
      ...changed('セクション名', section.title, title?.trim() || undefined),
      ...changed('説明', section.summary, summary?.trim(), true),
    ]
    if (changes.length === 0) return failure(NO_CHANGE, 'セクションを変更しませんでした')
    return { title: `セクション「${section.title}」を変更する`, changes, snapshot: sectionSnapshot(section) }
  },
  async (c, { course_id, section_id, title, summary }, snapshot) => {
    const found = await sectionOf(c, course_id, section_id, true)
    if (!found) return failure(NOT_FOUND, 'セクションを変更できませんでした')
    if (!sameSnapshot(sectionSnapshot(found.section), snapshot)) return failure(STALE, 'セクションを変更できませんでした')
    const name = title?.trim() || found.section.title
    await moodle(moodleContext(c)).updateSection(course_id, section_id, name, summary?.trim() ?? found.section.summary)
    forgetCourse(course_id)
    return success({ ok: true }, `セクション「${name}」を変更しました`, inCourse(course_id, section_id))
  },
)

const starterSchema = z.object(
  Object.fromEntries(
    (['html', 'css', 'js', 'py'] as const).map((key) => [key, z.optional(describedString(`${key} のファイルの全文`, MAX_CODE_LENGTH))]),
  ) as Record<'html' | 'css' | 'js' | 'py', z.ZodMiniOptional<z.ZodMiniString>>,
)

const updateItemArgs = z.object({
  item_id: id('アイテムの ID'),
  course_id: id('アイテムのあるコースの ID'),
  title: z.optional(describedString('新しいタイトル', 200, 1)),
  url: z.optional(describedString('新しい URL（リンクだけ）', 2000)),
  link_target: z.optional(z.enum(LINK_TARGETS).check(z.describe('リンクの開き方（リンクだけ）'))),
  section_id: z.optional(id('移し先のセクションの ID（同じコースの中だけ）。移すと末尾に入る')),
  file_id: z.optional(fileId('差し替える新しいファイル（ファイルだけ）')),
  body: z.optional(describedString('新しい問題文（コードだけ。Markdown）。全文を書く', 100_000)),
  constraints: z.optional(constraintsSchema('新しい制約の一覧（コーディング問題だけ）。一部だけでなくすべての制約を書く')),
  criteria: z.optional(describedString('新しい補足（コーディング問題だけ）', 5000)),
  starter: z.optional(
    starterSchema.check(
      z.describe('最初に入れておくコード（コーディング問題だけ）。変えるファイルだけを全文で書く。web は html / css / js、python は py'),
    ),
  ),
  stdin: z.optional(describedString('Python の入力の例（コーディング問題の python だけ）', MAX_STDIN_LENGTH)),
})

type UpdateItemArgs = z.output<typeof updateItemArgs>

const codeOf = (item: MItem) => (codeKind(item) && item.extra ? codeSettingsOf(item.extra.data, item.title) : null)

const itemSnapshot = (item: MItem) => ({
  title: item.title,
  url: item.kind === 'link' ? item.url : '',
  linkTarget: item.linkTarget,
  sectionId: item.sectionId,
  ...(item.kind === 'file' && { file: item.fileUrl }),
  code: codeOf(item),
})

const uploadOf = (c: AiToolContext, args: UpdateItemArgs) =>
  args.file_id === undefined ? undefined : findUpload(c.var.user!.id, args.file_id)

function checkItemArgs(loaded: LoadedCourse, item: MItem, args: UpdateItemArgs, upload: MoodleAiUpload | undefined) {
  if (item.kind !== 'link' && item.kind !== 'file' && !codeKind(item))
    return 'STEP Learn から変えられるのは、リンク・ファイル・コーディング問題だけです。ほかの活動は Moodle の画面で変えてください。'
  if (args.file_id !== undefined && item.kind !== 'file') return 'ファイルを差し替えられるのは、ファイルのアイテムだけです。'
  if (args.file_id !== undefined && !upload) return UPLOAD_NOT_FOUND
  if ((args.url !== undefined || args.link_target !== undefined) && item.kind !== 'link')
    return 'URL と開き方はリンクのアイテムでだけ変えられます。'
  if (args.url !== undefined && !isHttpUrl(args.url.trim())) return 'URL は http:// か https:// で始めてください。'
  const codeArgs = [args.body, args.constraints, args.criteria, args.starter, args.stdin]
  if (codeArgs.some((v) => v !== undefined) && !codeKind(item))
    return '問題文・制約・補足・最初のコード・入力の例は、コーディング問題でだけ変えられます。'
  if (codeArgs.some((v) => v !== undefined) && item.extra && isFinalized(codeStageOf(item.extra.data)))
    return 'このコーディング問題は確定しているので、問題文・制約・補足・最初のコード・入力の例は変えられません。直すときは、新しいコーディング問題を作ってください。'
  if (args.section_id !== undefined && !loaded.sections.some((s) => s.id === args.section_id))
    return '移し先のセクションが、同じコースにありません。'
  return null
}

const sectionTitle = (loaded: LoadedCourse, sectionId: number) => loaded.sections.find((s) => s.id === sectionId)?.title ?? ''

function itemChanges(loaded: LoadedCourse, item: MItem, args: UpdateItemArgs, upload: MoodleAiUpload | undefined) {
  const code = codeOf(item)
  return [
    ...changed('タイトル', item.title, args.title?.trim() || undefined),
    ...changed('URL', item.url, args.url?.trim()),
    ...changed('開き方', LINK_TARGET_LABELS[item.linkTarget], args.link_target && LINK_TARGET_LABELS[args.link_target]),
    ...(upload ? [fileChange({ name: item.fileName, size: item.fileSize }, upload)] : []),
    ...(args.section_id !== undefined && args.section_id !== item.sectionId
      ? [{ label: 'セクション', before: sectionTitle(loaded, item.sectionId), after: sectionTitle(loaded, args.section_id) }]
      : []),
    ...(code
      ? [
          ...changed('問題文', code.body, args.body, true),
          ...CODE_FILES[code.language].flatMap((f) =>
            changed(`最初のコード（${f.name}）`, code.starter[f.key] ?? '', args.starter?.[f.key], true),
          ),
          ...changed('入力の例', code.stdin, code.language === 'python' ? args.stdin : undefined, true),
          ...changed('制約', constraintLines(code.constraints), args.constraints && constraintLines(toConstraints(args.constraints)), true),
          ...changed('補足', code.criteria, args.criteria, true),
        ]
      : []),
  ]
}

const updateItem = defineConfirmTool(
  'update_item',
  'リンクのタイトル・URL・開き方・セクション、ファイルのタイトル・セクション・ファイル、コーディング問題のタイトル・問題文・最初のコード・制約・補足を変える。利用者が確認カードで承認してから実行される。変えない欄は省く。',
  updateItemArgs,
  async (c, args) => {
    const found = await courseOfItem(c, args.item_id, args.course_id)
    if (!found) return failure(NOT_FOUND, 'アイテムを開けませんでした')
    const { loaded, item } = found
    const upload = uploadOf(c, args)
    const problem = checkItemArgs(loaded, item, args, upload)
    if (problem) return failure(problem, `「${item.title}」を変更しませんでした`)
    const changes = itemChanges(loaded, item, args, upload)
    if (changes.length === 0) return failure(NO_CHANGE, `「${item.title}」を変更しませんでした`)
    return { title: `「${item.title}」を変更する`, changes, snapshot: itemSnapshot(item) }
  },
  async (c, args, snapshot) => {
    const found = await courseOfItem(c, args.item_id, args.course_id, true)
    if (!found) return failure(NOT_FOUND, 'アイテムを変更できませんでした')
    const { loaded, item } = found
    const label = `「${item.title}」を変更できませんでした`
    if (!sameSnapshot(itemSnapshot(item), snapshot)) return failure(STALE, label)
    const upload = uploadOf(c, args)
    const problem = checkItemArgs(loaded, item, args, upload)
    if (problem) return failure(problem, label)
    const api = moodle(moodleContext(c))
    const courseId = loaded.course.id
    const title = args.title?.trim() || item.title
    // 完了の条件と開き方を keep で送るのは、Moodle の画面で決めた設定を、AI が頼まれていないのに書き換えないため
    const activity = {
      courseid: courseId,
      cmid: item.id,
      sectionid: item.sectionId,
      name: title,
      completion: 'keep',
      visible: !item.hidden,
    }
    if (item.kind === 'link') {
      await api.saveUrl({
        ...activity,
        externalurl: args.url?.trim() ?? item.url,
        display: args.link_target && args.link_target !== item.linkTarget ? args.link_target : 'keep',
      })
    } else if (item.kind === 'file') {
      // 差し替えないときに 0 を送るのは、save_resource が下書きの itemid 0 を「今のファイルのまま」として扱うため
      await api.saveResource({ ...activity, draftitemid: upload?.draftItemId ?? 0 })
      if (upload) consumeUpload(upload.id)
    } else {
      const code = codeOf(item)!
      updateExtraData(item.extraKey!, courseId, {
        ...item.extra!.data,
        title,
        body: args.body ?? code.body,
        language: code.language,
        starter: filesFor(code.language, { ...code.starter, ...args.starter }),
        stdin: code.language === 'python' ? (args.stdin ?? code.stdin) : '',
        criteria: args.criteria ?? code.criteria,
        constraints: args.constraints ? toConstraints(args.constraints) : code.constraints,
      })
      // リンク先を送り直すのは、save_url が URL を必須にしているため。Moodle の画面で書き換えられていても /m/<key> に戻す
      if (title !== item.title) await api.saveUrl({ ...activity, externalurl: extraUrl(c, item.extraKey!), display: 'keep' })
    }
    if (args.section_id !== undefined && args.section_id !== item.sectionId)
      await api.updateCourse(courseId, 'cm_move', [item.id], { sectionid: args.section_id })
    forgetCourse(courseId)
    return success({ ok: true }, `「${title}」を変更しました`, inItem(courseId, item.id, args.section_id ?? item.sectionId))
  },
)

const VISIBILITY_TARGETS = ['section', 'item'] as const

async function visibilityTarget(
  c: AiToolContext,
  courseId: number,
  target: (typeof VISIBILITY_TARGETS)[number],
  targetId: number,
  fresh = false,
) {
  const loaded = await manageable(c, courseId, fresh)
  if (!loaded) return null
  if (target === 'section') {
    const section = topSections(loaded).find((s) => s.id === targetId)
    if (!section || section.number === 0) return null
    return {
      title: `セクション「${section.title}」`,
      hidden: section.hidden,
      ids: [section.id],
      on: 'section' as const,
      touched: inCourse(courseId, section.id),
    }
  }
  const item = findItem(loaded, targetId)
  if (!item) return null
  // サブセクションに cm_hide を使わないのは、Moodle 5.1 では表示の更新を返すときにセクション ID を取り違えて失敗するため
  const touched = { ...inCourse(courseId, item.sectionId), item: item.id }
  if (item.childSectionId)
    return { title: `「${item.title}」`, hidden: item.hidden, ids: [item.childSectionId], on: 'section' as const, touched }
  return { title: `「${item.title}」`, hidden: item.hidden, ids: [item.id], on: 'cm' as const, touched }
}

const setVisibility = defineConfirmTool(
  'set_visibility',
  'セクションかアイテムを、学生に表示するか非表示にするかを切り替える。利用者が確認カードで承認してから実行される。一般のセクションは切り替えられない。',
  z.object({
    course_id: id('コースの ID'),
    target: z.enum(VISIBILITY_TARGETS).check(z.describe('section: セクション / item: アイテム')),
    id: id('セクションかアイテムの ID'),
    hidden: z.boolean().check(z.describe('true: 学生に非表示にする / false: 学生に表示する')),
  }),
  async (c, { course_id, target, id: targetId, hidden }) => {
    const found = await visibilityTarget(c, course_id, target, targetId)
    if (!found) return failure(NOT_FOUND, '表示を切り替えられませんでした')
    if (found.hidden === hidden) return failure(`すでに${shown(hidden)}になっています。`, '表示を切り替えませんでした')
    return {
      title: `${found.title}を${shown(hidden)}にする`,
      changes: [{ label: '学生への表示', before: shown(found.hidden), after: shown(hidden) }],
      snapshot: { hidden: found.hidden },
    }
  },
  async (c, { course_id, target, id: targetId, hidden }, snapshot) => {
    const found = await visibilityTarget(c, course_id, target, targetId, true)
    if (!found) return failure(NOT_FOUND, '表示を切り替えられませんでした')
    if (!sameSnapshot({ hidden: found.hidden }, snapshot)) return failure(STALE, '表示を切り替えられませんでした')
    const action = found.on === 'section' ? (hidden ? 'section_hide' : 'section_show') : hidden ? 'cm_hide' : 'cm_show'
    await moodle(moodleContext(c)).updateCourse(course_id, action, found.ids)
    forgetCourse(course_id)
    return success({ ok: true }, `${found.title}を${shown(hidden)}にしました`, found.touched)
  },
)

/** Moodle モードで AI が使えるツール。削除・画面共有・ファイル自動配布・参加者・コースの設定・アクセス制限は扱わない */
export const MOODLE_AI_TOOLS: readonly AiAgentTool[] = [
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
