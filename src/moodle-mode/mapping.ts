import type { CourseCardData } from '../components/ui'
import type { CourseAccess } from '../lib/courses'
import { COURSE_COLORS, type Completion, type Course, type NavCourse } from '../lib/types'
import { toMarkdown, toPlainText } from '../moodle/html'
import type { MoodleCourse, MoodleModule, MoodleSection } from './client'

// Moodle のコースには色がないので、ID から決めて毎回同じ色にする
export const courseColor = (id: number) => COURSE_COLORS[id % COURSE_COLORS.length]

/** コース画像の URL のうち、画像の配信 URL（/courses/:id/hero/:name）に使う部分 */
const imageKey = (url: string) => (url ? (URL.parse(url)?.pathname ?? null) : null)

export function toCourse(m: MoodleCourse): Course {
  return {
    id: m.id,
    code: m.shortname,
    title: m.fullname,
    summary: toPlainText(m.summary, m.summaryformat),
    color: courseColor(m.id),
    heroImage: imageKey(m.imageurl),
    iconImage: null,
    enrollKey: null,
    visible: m.visible ? 1 : 0,
    completionEnabled: m.completionenabled ? 1 : 0,
    createdBy: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

export const toAccess = (m: MoodleCourse): CourseAccess => ({ course: toCourse(m), role: m.role || null, canManage: m.canmanage })

export const toCard = (m: MoodleCourse): CourseCardData => ({
  ...toCourse(m),
  role: m.role || null,
  total: m.total,
  done: m.done,
  members: m.members,
  teachers: m.teachers.join('、') || null,
})

export const toNavCourse = (m: MoodleCourse): NavCourse => ({ id: m.id, title: m.fullname, color: courseColor(m.id), iconImage: null })

/** link と file は STEP Learn の画面で扱い、moodle は Moodle の画面で開く。label はセクションの中に本文を出す */
export type ItemKind = 'link' | 'file' | 'moodle' | 'label'

/** STEP Learn の完了の条件に、Moodle にしかない「そのほかの自動の条件」（auto）を足したもの */
export type ItemCompletion = Exclude<Completion, 'play'> | 'auto'

export type MItem = {
  id: number
  sectionId: number
  kind: ItemKind
  modname: string
  instance: number
  title: string
  /** link はリンク先、moodle は Moodle の活動の画面 */
  url: string
  fileName: string
  fileSize: number
  fileType: string
  fileUrl: string
  /** label の本文と、活動の説明（Markdown） */
  body: string
  hidden: boolean
  /** アクセス制限で、まだ開けない */
  locked: boolean
  restriction: string
  completion: ItemCompletion
  done: boolean
}

export type MSection = { id: number; number: number; title: string; summary: string; hidden: boolean }

// 状態の値は Moodle の COMPLETION_COMPLETE（1）と COMPLETION_COMPLETE_PASS（2）
const isComplete = (state: number | undefined) => state === 1 || state === 2

function completionOf(m: MoodleModule, tracking: boolean): ItemCompletion {
  if (!tracking || !m.completion) return 'none'
  if (m.completion === 1) return 'manual'
  const rules = m.completiondata?.details.map((d) => d.rulename) ?? []
  return (m.modname === 'url' || m.modname === 'resource') && rules.length === 1 && rules[0] === 'completionview' ? 'view' : 'auto'
}

const kindOf = (modname: string): ItemKind =>
  modname === 'url' ? 'link' : modname === 'resource' ? 'file' : modname === 'label' ? 'label' : 'moodle'

function toItem(m: MoodleModule, sectionId: number, tracking: boolean): MItem {
  const kind = kindOf(m.modname)
  const content = m.contents?.[0]
  const file = kind === 'file' ? content : undefined
  return {
    id: m.id,
    sectionId,
    kind,
    modname: m.modname,
    instance: m.instance,
    title: m.name,
    url: kind === 'link' ? (content?.fileurl ?? '') : (m.url ?? ''),
    fileName: file?.filename ?? '',
    fileSize: file?.filesize ?? 0,
    fileType: file?.mimetype ?? 'application/octet-stream',
    fileUrl: file?.fileurl ?? '',
    body: m.description ? toMarkdown(m.description, 1).markdown : '',
    hidden: !m.visible || !m.visibleoncoursepage,
    locked: !m.uservisible,
    restriction: m.availabilityinfo ? toPlainText(m.availabilityinfo, 1) : '',
    completion: completionOf(m, tracking),
    done: isComplete(m.completiondata?.state),
  }
}

/** core_course_get_contents の結果を、セクションとアイテムの一覧にする */
export function toOutline(list: MoodleSection[], { tracking, manage }: { tracking: boolean; manage: boolean }) {
  // サブセクションを別のセクションとして並べないのは、STEP Learn のセクションに入れ子がなく、親のセクションと関係が分からなくなるため
  const top = list.filter((s) => !s.component)
  const sections: MSection[] = []
  const items: MItem[] = []
  for (const s of top) {
    // 中身のない「一般」セクションを学生に出さないのは、Moodle では空でも必ずあり、準備中のセクションに見えるため
    if (s.section === 0 && s.modules.length === 0 && !manage) continue
    sections.push({
      id: s.id,
      number: s.section,
      title: s.name,
      summary: toPlainText(s.summary, s.summaryformat),
      hidden: s.visible === 0,
    })
    for (const m of s.modules) items.push(toItem(m, s.id, tracking))
  }
  return { sections, items }
}

/** 前後のナビや「続きから」に並べるアイテム（ラベルは開く画面がないので除く） */
export const isOpenable = (it: MItem) => it.kind !== 'label'

export const isTracked = (it: MItem) => it.completion !== 'none'
