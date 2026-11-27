import { and, eq, inArray } from 'drizzle-orm'
import type { CourseAccess } from './courses'
import { isCleared, verdictCounts } from '../features/code/code'
import { db } from './db'
import { groupIdsOf, groupsOf } from '../features/groups/group-items'
import { quizGradesOf } from '../features/quiz/quiz-items'
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
import { sectionLabel, sectionTree, treeItems } from './section-tree'
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
  position: number
}
type SectionRow = { id: number; parentId: number | null; position: number; title: string; hidden: number; availability: string | null }

function loadOutline(courseId: number) {
  const sectionRows: SectionRow[] = db
    .select({
      id: sections.id,
      parentId: sections.parentId,
      position: sections.position,
      title: sections.title,
      hidden: sections.hidden,
      availability: sections.availability,
    })
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
      position: items.position,
    })
    .from(items)
    .where(eq(items.courseId, courseId))
    .orderBy(items.position, items.id)
    .all()
  const tree = sectionTree(sectionRows, itemRows)
  return { sectionRows, tree, ordered: treeItems(tree) }
}

type Outline = ReturnType<typeof loadOutline>

const isGraded = (it: OutlineRow) => it.type === 'code' || it.type === 'quiz'

function choicesOf(
  course: Pick<Course, 'id' | 'completionEnabled'>,
  { sectionRows, ordered }: Outline,
  exclude?: number,
): RestrictionChoices {
  const sectionTitles = new Map(sectionRows.map((s) => [s.id, sectionLabel(sectionRows, s.id)]))
  const tracked = course.completionEnabled ? ordered.filter((it) => it.completion !== 'none' && it.id !== exclude) : []
  const graded = ordered.filter((it) => isGraded(it) && it.id !== exclude)
  const unavailable: RestrictionChoices['unavailable'] = {}
  if (!course.completionEnabled) unavailable.completion = 'このコースでは完了ステータスを使っていません。'
  else if (tracked.length === 0) unavailable.completion = '完了の条件があるアイテムがありません。'
  if (graded.length === 0) unavailable.grade = '評点が付くアイテム（コーディング問題・小テスト）がありません。'
  const groups = groupsOf(course.id)
  if (groups.length === 0) unavailable.group = 'このコースにはグループがありません。参加者の画面から作れます。'
  return {
    kinds: RESTRICTION_KINDS.filter((k) => !unavailable[k]),
    unavailable,
    items: tracked.map((it) => ({ id: it.id, label: it.title, meta: sectionTitles.get(it.sectionId), passFail: isGraded(it) })),
    previous: tracked.length > 0,
    grades: graded.map((it) => ({ id: it.id, label: it.title, meta: sectionTitles.get(it.sectionId) })),
    profile: PROFILE_FIELDS,
    groups: groups.map((g) => ({ id: g.id, label: g.name })),
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
    const { required } = verdictCounts(g.verdicts ?? [])
    if (!required.total) continue
    const score = (required.passed / required.total) * 100
    scores.set(g.itemId, Math.max(score, scores.get(g.itemId) ?? 0))
  }
  const gradedIds = new Set(graded.map((g) => g.itemId))
  const quizGrades = quizGradesOf(
    user.id,
    ordered.filter((it) => it.type === 'quiz').map((it) => it.id),
  )
  for (const [id, grade] of quizGrades) {
    gradedIds.add(id)
    scores.set(id, grade.percent)
    if (grade.passed) cleared.add(id)
  }
  const exists = new Set(ordered.map((it) => it.id))
  const completionOf = (id: number): CompletionState | null => {
    if (!exists.has(id)) return null
    if (cleared.has(id)) return 'pass'
    if (done.has(id)) return 'complete'
    return gradedIds.has(id) ? 'fail' : 'incomplete'
  }
  const now = Math.floor(Date.now() / 1000)
  const groups = groupIdsOf(course.id, user.id)
  const env = (previous: number | null) => ({
    groups,
    now,
    previous,
    completion: completionOf,
    grade: (id: number) => scores.get(id) ?? null,
    profile: (field: string) => profileValue(user, field),
  })

  const hiddenParents = new Set(sectionRows.filter((s) => s.hidden).map((s) => s.id))
  const hiddenSections = new Set(sectionRows.filter((s) => s.hidden || (s.parentId && hiddenParents.has(s.parentId))).map((s) => s.id))
  // 「直前のアイテム」を完了の条件がないアイテムや学生に見えないアイテムにしないのは、学生が完了にできず、ずっと開けなくなるため
  let previous: number | null = null
  const visit = (it: OutlineRow, outer: Availability) => {
    const own = checkRestriction(parseRestriction(it.availability), env(previous), choices)
    result.items.set(it.id, outer.open ? own : { ...outer, text: '' })
    if (visibleTracked(it, hiddenSections)) previous = it.id
  }
  // サブセクションの判定に親の結果を重ねるのは、親のセクションが開けないうちは、中のサブセクションも開けないようにするため
  const within = (outer: Availability, set: string | null) => {
    const own = checkRestriction(parseRestriction(set), env(previous), choices)
    return outer.open ? own : { ...outer, text: '' }
  }
  for (const { section, entries } of outline.tree) {
    const sectionResult = checkRestriction(parseRestriction(section.availability), env(previous), choices)
    result.sections.set(section.id, sectionResult)
    for (const entry of entries) {
      if (entry.kind === 'item') {
        visit(entry.item, sectionResult)
        continue
      }
      const subResult = within(sectionResult, entry.section.availability)
      result.sections.set(entry.section.id, subResult)
      for (const it of entry.items) visit(it, subResult)
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
