// 毎回 Moodle に問い合わせないのは、GET のたびにナビのコース一覧なども取り直すと、Moodle の速さがそのまま画面の速さになるため
// TTL を長くしないのは、Moodle の画面で変えた内容（課題の追加など）が STEP Learn に出るまで待たせないため
const TTL = 30_000
const MAX_ENTRIES = 5_000

const entries = new Map<string, { at: number; value: Promise<unknown> }>()

export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>
  const value = load()
  entries.delete(key)
  entries.set(key, { at: Date.now(), value })
  // 失敗を覚えないのは、Moodle が一時的に止まっただけで、TTL の間ずっとエラーを返し続けないため
  value.catch(() => entries.get(key)?.value === value && entries.delete(key))
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  return value
}

const forget = (match: (key: string) => boolean) => {
  for (const key of entries.keys()) if (match(key)) entries.delete(key)
}

export const coursesKey = (userId: number) => `courses:${userId}`
// courses: で始めるのは、forgetCourse で参加しているコースの一覧と一緒に捨てるため
export const otherCoursesKey = (userId: number) => `courses:others:${userId}`
export const courseKey = (courseId: number, userId: number) => `course:${courseId}:${userId}`
export const contentsKey = (courseId: number, userId: number) => `contents:${courseId}:${userId}`

/** 教師が内容を変えたとき。参加者全員の見え方と、一覧の進捗が変わる */
export const forgetCourse = (courseId: number) =>
  forget((k) => k.startsWith('courses:') || k.startsWith(`course:${courseId}:`) || k.startsWith(`contents:${courseId}:`))

/** 学生が完了を切り替えたとき。本人の見え方だけが変わる */
export const forgetProgress = (courseId: number, userId: number) => {
  entries.delete(coursesKey(userId))
  entries.delete(courseKey(courseId, userId))
  entries.delete(contentsKey(courseId, userId))
}

/** 利用者がセクションを開閉したとき。本人のコースの情報（開閉の記録を含む）だけが変わる */
export const forgetSections = (courseId: number, userId: number) => entries.delete(courseKey(courseId, userId))
