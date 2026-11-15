const DAY_MS = 86_400_000

const TOKYO_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

const DATE_IN_TITLE = /(?:(\d{4})\s*[/.年-]\s*)?(?<!\d)(\d{1,2})\s*[/月]\s*(\d{1,2})(?!\d)/

const dayOf = (y: number, m: number, d: number) => {
  const t = Date.UTC(y, m - 1, d)
  const date = new Date(t)
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? t / DAY_MS : null
}

const todayOf = (now: Date) => {
  const [y, m, d] = TOKYO_DATE.format(now).split('-').map(Number)
  return { year: y!, day: dayOf(y!, m!, d!)! }
}

/** タイトルの「第3回 (6/30)」「6月30日」などから、その日を 1970-01-01 からの日数にする。年がなければ今日にいちばん近い年とみなす */
export function sectionDay(title: string, now = new Date()) {
  const m = title.match(DATE_IN_TITLE)
  if (!m) return null
  const [month, date] = [Number(m[2]), Number(m[3])]
  if (m[1]) return dayOf(Number(m[1]), month, date)
  const today = todayOf(now)
  const candidates = [today.year - 1, today.year, today.year + 1].flatMap((y) => dayOf(y, month, date) ?? [])
  if (!candidates.length) return null
  return candidates.reduce((a, b) => (Math.abs(b - today.day) < Math.abs(a - today.day) ? b : a))
}

export type LessonWhen = 'prev' | 'today' | 'next'
export type Lesson = { id: number; title: string; when: LessonWhen; date: string }
export type Lessons = { prev?: Lesson; today?: Lesson; next?: Lesson }

const DAY_LABEL = new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC', month: 'numeric', day: 'numeric' })

/** 今日の日付のセクションと、その前後でいちばん近い日付のセクション */
export function findLessons(sections: { id: number; title: string }[], now = new Date()): Lessons {
  const today = todayOf(now).day
  const lessons: Lessons = {}
  const days: Partial<Record<LessonWhen, number>> = {}
  for (const s of sections) {
    const day = sectionDay(s.title, now)
    if (day == null) continue
    const when: LessonWhen = day === today ? 'today' : day < today ? 'prev' : 'next'
    const best = days[when]
    if (best != null && (when === 'prev' ? day <= best : day >= best)) continue
    days[when] = day
    lessons[when] = { id: s.id, title: s.title, when, date: DAY_LABEL.format(day * DAY_MS) }
  }
  return lessons
}

export const lessonWhen = (lessons: Lessons, id: number) => Object.values(lessons).find((l) => l.id === id)?.when
