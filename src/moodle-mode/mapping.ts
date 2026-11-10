import type { CourseCardData } from '../components/ui'
import type { CourseAccess } from '../lib/courses'
import { COURSE_COLORS, type Completion, type Course, type LinkTarget, type NavCourse } from '../lib/types'
import { linkTargetOf, moodleDisplayOf, type MoodleDisplay } from '../moodle/display'
import { toMarkdown, toPlainText } from '../moodle/html'
import type { MoodleCourse, MoodleFormat, MoodleModule, MoodleRestriction, MoodleSection } from './client'

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
    startAt: null,
    endAt: null,
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
  inProgress: isInProgress(m),
})

export const isInProgress = (m: MoodleCourse) => m.inprogress !== false

export const isUpcoming = (m: MoodleCourse) => m.upcoming === true

export const toNavCourse = (m: MoodleCourse): NavCourse => ({
  id: m.id,
  title: m.fullname,
  color: courseColor(m.id),
  iconImage: null,
})

/** link と file は STEP Learn の画面で扱い、moodle は Moodle の画面で開く。label はセクションの中に本文を出す。subsection は中のアイテムを入れ子で並べる。extra は Moodle モードだけにある種類（中身は moodle-mode.db） */
export type ItemKind = 'link' | 'file' | 'moodle' | 'label' | 'subsection' | 'extra'

/** extra のアイテムの中身。type は extra-kinds.tsx の種類。live は画面共有の配信中のように、今まさに使われているか */
export type ExtraContent = { type: string; data: Record<string, unknown>; live: boolean }

export const EXTRA_PATH = '/m/'

/** extra のアイテムを置く URL の活動のリンク先（/m/<key>）から key を取り出す。ホストを見ないのは、STEP Learn のドメインを変えても読めるようにするため */
export const extraKeyOf = (url: string) => URL.parse(url)?.pathname.match(/^\/m\/([\w-]{20,64})$/)?.[1] ?? null

/** STEP Learn の完了の条件に、Moodle にしかない「そのほかの自動の条件」（auto）を足したもの */
export type ItemCompletion = Exclude<Completion, 'play'> | 'auto'

export type MItem = {
  id: number
  sectionId: number
  kind: ItemKind
  modname: string
  instance: number
  title: string
  /** link と extra はリンク先、moodle は Moodle の活動の画面 */
  url: string
  /** link の開き方。Moodle の表示方法を読み替えたもの */
  linkTarget: LinkTarget
  /** link の Moodle での表示方法。分からなければ null */
  display: MoodleDisplay | null
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
  /** 教師に見せるアクセス制限。制限がないときと学生には null */
  rule: Restriction | null
  completion: ItemCompletion
  done: boolean
  /** subsection の中身のセクション */
  childSectionId: number | null
  /** extra の key と中身。中身はほかのコースからコピーされた活動では null（コピー元のコースでしか使えない） */
  extraKey: string | null
  extra: ExtraContent | null
}

/** parentId はサブセクションの中身のセクションのとき、それを含むセクション。locked はアクセス制限で、まだ開けない */
export type MSection = {
  id: number
  number: number
  title: string
  summary: string
  hidden: boolean
  parentId: number | null
  locked: boolean
  restriction: string
  /** 教師に見せるアクセス制限。制限がないときと学生には null */
  rule: Restriction | null
}

/** 教師に見せるアクセス制限。editable のときだけ from 以降の値がある */
export type Restriction = {
  text: string
  editable: boolean
  from: number | null
  until: number | null
  /** 完了が条件の活動。-1 は直前の活動 */
  after: number[]
  hideUnmet: boolean
}

/** 完了の条件にできる「直前の活動」 */
export const PREVIOUS_ITEM = -1

// リンクを外すのは、Moodle が活動の名前を Moodle の画面へのリンクにしており、文字にすると URL が並んで条件が読みにくいため
const restrictionText = (html: string) => toPlainText(html.replace(/<\/?a\b[^>]*>/gi, ''), 1)

const toRestriction = (r: MoodleRestriction): Restriction => ({
  text: restrictionText(r.info),
  editable: r.editable,
  from: r.from || null,
  until: r.until || null,
  after: r.after,
  hideUnmet: r.hideunmet,
})

/** 教師のときに、セクションとアイテムに制限を付ける */
export function withRestrictions<T extends { sections: MSection[]; items: MItem[] }>(outline: T, list: MoodleRestriction[]): T {
  const bySection = new Map(list.filter((r) => r.sectionid).map((r) => [r.sectionid, toRestriction(r)]))
  const byItem = new Map(list.filter((r) => r.cmid).map((r) => [r.cmid, toRestriction(r)]))
  return {
    ...outline,
    sections: outline.sections.map((s) => ({ ...s, rule: bySection.get(s.id) ?? null })),
    // サブセクションに中身のセクションの制限を使うのは、Moodle の画面でもサブセクションの制限はセクションの設定で編集し、活動の側はそれを写したものなため
    items: outline.items.map((it) => ({
      ...it,
      rule: (it.childSectionId ? bySection.get(it.childSectionId) : byItem.get(it.id)) ?? null,
    })),
  }
}

// 状態の値は Moodle の COMPLETION_COMPLETE（1）と COMPLETION_COMPLETE_PASS（2）
const isComplete = (state: number | undefined) => state === 1 || state === 2

function completionOf(m: MoodleModule, tracking: boolean): ItemCompletion {
  if (!tracking || !m.completion) return 'none'
  if (m.completion === 1) return 'manual'
  const rules = m.completiondata?.details.map((d) => d.rulename) ?? []
  return (m.modname === 'url' || m.modname === 'resource') && rules.length === 1 && rules[0] === 'completionview' ? 'view' : 'auto'
}

export function displayOf(m: MoodleModule) {
  try {
    const data = JSON.parse(m.customdata ?? '') as { display?: unknown }
    // 文字列も受け付けるのは、Moodle が DB の値をそのまま入れるため（自動のときだけ数値になる）
    const display = typeof data.display === 'number' || typeof data.display === 'string' ? moodleDisplayOf(Number(data.display)) : null
    // ダウンロードを自動とみなすのは、URL の活動の設定ではダウンロードを選べず、自動のときにふつうのページの URL へ Moodle が選ぶ値のため
    return display === 'download' ? 'auto' : display
  } catch {
    return null
  }
}

const KINDS: Partial<Record<string, ItemKind>> = { url: 'link', resource: 'file', label: 'label', subsection: 'subsection' }

function toItem(m: MoodleModule, sectionId: number, tracking: boolean, childSectionId: number | null = null): MItem {
  const content = m.contents?.[0]
  const extraKey = m.modname === 'url' ? extraKeyOf(content?.fileurl ?? '') : null
  const kind = extraKey ? 'extra' : (KINDS[m.modname] ?? 'moodle')
  const file = kind === 'file' ? content : undefined
  const display = kind === 'link' ? displayOf(m) : null
  return {
    id: m.id,
    sectionId,
    kind,
    modname: m.modname,
    instance: m.instance,
    title: m.name,
    url: kind === 'link' || kind === 'extra' ? (content?.fileurl ?? '') : (m.url ?? ''),
    // 表示方法が分からないときに新しいタブにするのは、Moodle の設定を読めなかった以前の STEP Learn の開き方に合わせるため
    linkTarget: display ? linkTargetOf(display) : 'new',
    display,
    fileName: file?.filename ?? '',
    fileSize: file?.filesize ?? 0,
    fileType: file?.mimetype ?? 'application/octet-stream',
    fileUrl: file?.fileurl ?? '',
    body: m.description ? toMarkdown(m.description, 1).markdown : '',
    hidden: !m.visible || !m.visibleoncoursepage,
    locked: !m.uservisible,
    restriction: m.availabilityinfo ? restrictionText(m.availabilityinfo) : '',
    rule: null,
    completion: completionOf(m, tracking),
    done: isComplete(m.completiondata?.state),
    childSectionId,
    extraKey,
    extra: null,
  }
}

const toSection = (s: MoodleSection, parentId: number | null, hidden: boolean): MSection => ({
  id: s.id,
  number: s.section,
  title: s.name,
  summary: toPlainText(s.summary, s.summaryformat),
  hidden,
  parentId,
  locked: s.uservisible === false,
  restriction: s.availabilityinfo ? restrictionText(s.availabilityinfo) : '',
  rule: null,
})

/** core_course_get_contents の結果を、セクションとアイテムの一覧にする。items は上から読む順に並ぶ */
export function toOutline(list: MoodleSection[], { tracking, manage }: { tracking: boolean; manage: boolean }) {
  const delegated = new Map(list.filter((s) => s.component === 'mod_subsection' && s.itemid).map((s) => [s.itemid!, s]))
  const sections: MSection[] = []
  const items: MItem[] = []
  for (const s of list.filter((s) => !s.component)) {
    // 中身のない「一般」セクションを学生に出さないのは、Moodle では空でも必ずあり、準備中のセクションに見えるため
    if (s.section === 0 && s.modules.length === 0 && !manage) continue
    const hidden = s.visible === 0
    sections.push(toSection(s, null, hidden))
    for (const m of s.modules) {
      const child = m.modname === 'subsection' ? delegated.get(m.instance) : undefined
      // 中身のセクションが返ってこないサブセクション（学生に見えないもの）を出さないのは、開いても何もないため
      if (m.modname === 'subsection' && !child) continue
      items.push(toItem(m, s.id, tracking, child?.id ?? null))
      if (!child) continue
      // サブセクションを独立したセクションとして並べないのは、STEP Learn のセクションに入れ子がなく、親のセクションとの関係が分からなくなるため
      sections.push(toSection(child, s.id, hidden || child.visible === 0 || !m.visible))
      for (const cm of child.modules) items.push(toItem(cm, child.id, tracking))
    }
  }
  return { sections, items }
}

/** 前後のナビや「続きから」に並べるアイテム（ラベル・サブセクションと、Moodle が URL を返さない活動、中身のない extra は開く画面がないので除く） */
export const isOpenable = (it: MItem) =>
  it.kind !== 'label' && it.kind !== 'subsection' && !(it.kind === 'moodle' && !it.url) && !(it.kind === 'extra' && !it.extra)

export const isTracked = (it: MItem) => it.completion !== 'none'

export type TopcollLayout = {
  kind: 'topcoll'
  /** 学生に見せる順（「最新の週を先頭に」などの並べ方を反映したもの） */
  order: number[]
  collapsed: number[]
  current: number
  toggleAll: boolean
  oneSection: boolean
  columns: number
  summaryWhenCollapsed: boolean
  persistent: boolean
}

export type TileProgress = 'none' | 'fraction' | 'percent'

/** photo は Moodle での写真のファイル名（変わると配信 URL も変わる） */
export type Tile = { photo: string; photoUrl: string }

export type TilesLayout = {
  kind: 'tiles'
  progress: TileProgress
  subtiles: boolean
  subtilesZero: boolean
  tiles: Map<number, Tile>
}

/** コースフォーマットに合わせたコースページの見せ方。list はトピック形式などの、すべてを開いたセクションの一覧 */
export type CourseLayout = { kind: 'list' } | TopcollLayout | TilesLayout

const TILE_PROGRESS: TileProgress[] = ['none', 'fraction', 'percent']

const fileName = (url: string) => decodeURIComponent(URL.parse(url)?.pathname.split('/').at(-1) ?? '')

export function toLayout(format: MoodleFormat | undefined): CourseLayout {
  if (format?.topcoll) {
    const t = format.topcoll
    return {
      kind: 'topcoll',
      order: t.order,
      collapsed: t.collapsed,
      current: t.current,
      toggleAll: t.toggleall,
      oneSection: t.onesection,
      columns: t.columns,
      summaryWhenCollapsed: t.summarywhencollapsed,
      persistent: t.persistent,
    }
  }
  if (format?.tiles) {
    const t = format.tiles
    return {
      kind: 'tiles',
      progress: TILE_PROGRESS[t.progress] ?? 'none',
      subtiles: t.subtiles,
      subtilesZero: t.subtileszero,
      tiles: new Map(t.tiles.map((x) => [x.sectionid, { photo: x.photourl && fileName(x.photourl), photoUrl: x.photourl }])),
    }
  }
  return { kind: 'list' }
}

/** セクションをコースページで開く URL。タイルではセクションごとの画面になる */
export function sectionHref(courseId: number, layout: CourseLayout, sections: MSection[], sectionId: number) {
  const top = sections.find((s) => s.id === sectionId)?.parentId ?? sectionId
  const tiles = layout.kind === 'tiles' && sections.find((s) => s.id === top)?.number !== 0
  return `/courses/${courseId}${tiles ? `?section=${top}` : ''}#section-${sectionId}`
}
