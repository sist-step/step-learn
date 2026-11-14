import { and, eq, inArray } from 'drizzle-orm'
import type { CourseAccess } from './courses'
import { isCleared } from './code'
import { db } from './db'
import {
  RESTRICTION_KINDS,
  checkRestriction,
  describeRestriction,
  parseRestriction,
  type Availability,
  type CompletionState,
  type RestrictionChoices,
} from './restriction'
import { codeSubmissions, completions, items, sections } from './schema'
import type { Course, User } from './types'

const PROFILE_FIELDS = [
  { value: 'sf:name', label: '氏名' },
  { value: 'sf:username', label: 'ユーザー名' },
  { value: 'sf:email', label: 'メールアドレス' },
]

const profileValue = (user: User, field: string) =>
  field === 'sf:name' ? user.name : field === 'sf:username' ? (user.username ?? '') : field === 'sf:email' ? user.email : null

type OutlineRow = {
  id: number
  sectionId: number
  type: string
  title: string
  hidden: number
  completion: string
  availability: string | null
}
type SectionRow = { id: number; title: string; hidden: number; availability: string | null }

function loadOutline(courseId: number) {
  const sectionRows: SectionRow[] = db
    .select({ id: sections.id, title: sections.title, hidden: sections.hidden, availability: sections.availability })
    .from(sections)
    .where(eq(sections.courseId, courseId))
    .orderBy(sections.position, sections.id)
    .all()
  const itemRows: OutlineRow[] = db
    .select({
      id: items.id,
      sectionId: items.sectionId,
      type: items.type,
      title: items.title,
      hidden: items.hidden,
      completion: items.completion,
      availability: items.availability,
    })
    .from(items)
    .where(eq(items.courseId, courseId))
    .orderBy(items.position, items.id)
    .all()
  const order = new Map(sectionRows.map((s, i) => [s.id, i]))
  const ordered = [...itemRows].sort((a, b) => (order.get(a.sectionId) ?? 0) - (order.get(b.sectionId) ?? 0))
  return { sectionRows, ordered }
}

type Outline = ReturnType<typeof loadOutline>

function choicesOf(course: Pick<Course, 'completionEnabled'>, { sectionRows, ordered }: Outline, exclude?: number): RestrictionChoices {
  const sectionTitles = new Map(sectionRows.map((s) => [s.id, s.title]))
  const tracked = course.completionEnabled ? ordered.filter((it) => it.completion !== 'none' && it.id !== exclude) : []
  const graded = ordered.filter((it) => it.type === 'code' && it.id !== exclude)
  const unavailable: RestrictionChoices['unavailable'] = {}
  if (!course.completionEnabled) unavailable.completion = 'このコースでは完了ステータスを使っていません。'
  else if (tracked.length === 0) unavailable.completion = '完了の条件があるアイテムがありません。'
  if (graded.length === 0) unavailable.grade = '評点が付くアイテム（コード）がありません。'
  return {
    kinds: RESTRICTION_KINDS.filter((k) => !unavailable[k]),
    unavailable,
    items: tracked.map((it) => ({ id: it.id, label: it.title, meta: sectionTitles.get(it.sectionId), passFail: it.type === 'code' })),
    previous: tracked.length > 0,
    grades: graded.map((it) => ({ id: it.id, label: it.title, meta: sectionTitles.get(it.sectionId) })),
    profile: PROFILE_FIELDS,
  }
}

/** 編集画面で選べるもの。exclude は制限を付けるアイテム自身（自分の完了や評点は条件にできない） */
export const restrictionChoices = (course: Pick<Course, 'id' | 'completionEnabled'>, exclude?: number) =>
  choicesOf(course, loadOutline(course.id), exclude)

/** コースのセクションとアイテムの制限。学生には判定の結果、教師にはすべての条件の説明を返す */
export type CourseAvailability = {
  sections: Map<number, Availability>
  items: Map<number, Availability>
  /** 教師に見せる説明。キーは `section:<id>` / `item:<id>` */
  notes: Map<string, string>
}

const visibleTracked = (it: OutlineRow, hiddenSections: Set<number>) =>
  it.completion !== 'none' && !it.hidden && !hiddenSections.has(it.sectionId)

export function courseAvailability(user: User, access: CourseAccess): CourseAvailability {
  const course = access.course
  const outline = loadOutline(course.id)
  const { sectionRows, ordered } = outline
  const result: CourseAvailability = { sections: new Map(), items: new Map(), notes: new Map() }
  if (!sectionRows.some((s) => s.availability) && !ordered.some((it) => it.availability)) return result
  const choices = choicesOf(course, outline)

  if (access.canManage) {
    for (const s of sectionRows) {
      const set = parseRestriction(s.availability)
      if (set) result.notes.set(`section:${s.id}`, describeRestriction(set, choices))
    }
    for (const it of ordered) {
      const set = parseRestriction(it.availability)
      if (set) result.notes.set(`item:${it.id}`, describeRestriction(set, choices))
    }
    return result
  }

  const done = new Set(
    db
      .select({ itemId: completions.itemId })
      .from(completions)
      .where(and(eq(completions.userId, user.id), eq(completions.courseId, course.id)))
      .all()
      .map((r) => r.itemId),
  )
  const codeIds = ordered.filter((it) => it.type === 'code').map((it) => it.id)
  const graded = codeIds.length
    ? db
        .select({ itemId: codeSubmissions.itemId, verdicts: codeSubmissions.verdicts })
        .from(codeSubmissions)
        .where(and(eq(codeSubmissions.userId, user.id), eq(codeSubmissions.status, 'graded'), inArray(codeSubmissions.itemId, codeIds)))
        .all()
    : []
  const cleared = new Set(graded.filter((g) => isCleared(g.verdicts)).map((g) => g.itemId))
  const scores = new Map<number, number>()
  for (const g of graded) {
    if (!g.verdicts?.length) continue
    const score = (g.verdicts.filter((v) => v.verdict === 'pass').length / g.verdicts.length) * 100
    scores.set(g.itemId, Math.max(score, scores.get(g.itemId) ?? 0))
  }
  const gradedIds = new Set(graded.map((g) => g.itemId))
  const exists = new Set(ordered.map((it) => it.id))
  const completionOf = (id: number): CompletionState | null => {
    if (!exists.has(id)) return null
    if (cleared.has(id)) return 'pass'
    if (done.has(id)) return 'complete'
    return gradedIds.has(id) ? 'fail' : 'incomplete'
  }
  const now = Math.floor(Date.now() / 1000)
  const env = (previous: number | null) => ({
    now,
    previous,
    completion: completionOf,
    grade: (id: number) => scores.get(id) ?? null,
    profile: (field: string) => profileValue(user, field),
  })

  const hiddenSections = new Set(sectionRows.filter((s) => s.hidden).map((s) => s.id))
  // 「直前のアイテム」を完了の条件がないアイテムや学生に見えないアイテムにしないのは、学生が完了にできず、ずっと開けなくなるため
  let previous: number | null = null
  for (const s of sectionRows) {
    const sectionResult = checkRestriction(parseRestriction(s.availability), env(previous), choices)
    result.sections.set(s.id, sectionResult)
    for (const it of ordered.filter((o) => o.sectionId === s.id)) {
      const own = checkRestriction(parseRestriction(it.availability), env(previous), choices)
      result.items.set(it.id, sectionResult.open ? own : { ...sectionResult, text: '' })
      if (visibleTracked(it, hiddenSections)) previous = it.id
    }
  }
  return result
}

/** 学生が開ける（学生に見えて、制限を満たしている）アイテムか。教師はいつでも開ける */
export function canOpenItem(user: User, access: CourseAccess, itemId: number, visible: boolean) {
  if (access.canManage) return true
  if (!visible) return false
  return courseAvailability(user, access).items.get(itemId)?.open ?? true
}
