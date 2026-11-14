const DAY_MS = 86_400_000
const WEEK_DAYS = 7

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

export type TodaySection = { id: number; when: 'today' | 'recent' }

/** 今日の日付のセクション。なければ、1 週間以内に終わったいちばん新しい回 */
export function findTodaySection(sections: { id: number; title: string }[], now = new Date()): TodaySection | null {
  const today = todayOf(now).day
  let recent: { id: number; day: number } | null = null
  for (const s of sections) {
    const day = sectionDay(s.title, now)
    if (day == null) continue
    if (day === today) return { id: s.id, when: 'today' }
    if (day < today && today - day < WEEK_DAYS && (!recent || day > recent.day)) recent = { id: s.id, day }
  }
  return recent && { id: recent.id, when: 'recent' }
}
