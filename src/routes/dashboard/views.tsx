import { CreateCourseButton } from '../../components/course'
import { cx } from '../../components/cx'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { MascotYard } from '../../components/mascot'
import { Styles } from '../../components/style'
import { CourseIcon, Progress, courseInitials, type CourseCardData } from '../../components/ui'
import { dateInputToUnix, unixToDateInput } from '../../lib/course-period'
import { randomTip } from '../../lib/tips'
import { COURSE_ROLE_LABELS } from '../../lib/types'

export type DashboardCourse = CourseCardData & { endAt?: number | null }

const DAY = 86_400
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
}

const LONG_DATE = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' })
const SHORT_DATE = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })

const roleLabel = (course: DashboardCourse) => (course.role === 'teacher' ? COURSE_ROLE_LABELS.teacher : COURSE_ROLE_LABELS.student)
const isTracked = (course: DashboardCourse) => course.role === 'student' && (course.total ?? 0) > 0

// ---------------------------------------------------------------- マイコース

const CourseRow = ({ course }: { course: DashboardCourse }) => (
  <a href={`/courses/${course.id}`} class={`dash-row tone-${course.color}`}>
    <CourseIcon course={course} text={courseInitials(course)} class="dot" />
    <span class="dash-row-text">
      <strong class="dash-row-title">{course.title}</strong>
      <span class="dash-row-sub">
        {course.code && <span class="truncate">{course.code}</span>}
        <span>{roleLabel(course)}</span>
        <span>{course.members ?? 0}人</span>
      </span>
    </span>
    {isTracked(course) && (
      <span class="dash-row-progress">
        <Progress done={course.done ?? 0} total={course.total ?? 0} />
      </span>
    )}
    <Icon name="chevronRight" size={18} class="dash-row-arrow" />
  </a>
)

// ---------------------------------------------------------------- カレンダー

function monthCells(year: number, month: number) {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1, i - lead + 1))
    return {
      key: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      outside: date.getUTCMonth() !== month - 1,
    }
  })
}

type Deadline = { course: DashboardCourse; date: string; daysLeft: number }

const deadlinesOf = (results: DashboardCourse[], today: string): Deadline[] =>
  results
    .flatMap((course) => (course.endAt == null ? [] : [{ course, date: unixToDateInput(course.endAt) }]))
    .map((d) => ({ ...d, daysLeft: Math.round((dateInputToUnix(d.date) - dateInputToUnix(today)) / DAY) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)

const Calendar = ({ today, deadlines }: { today: string; deadlines: Deadline[] }) => {
  const [year, month] = today.split('-').map(Number)
  return (
    <section class="dash-card" aria-label="カレンダー">
      <div class="dash-card-head">
        <h2>{`${year}年${month}月`}</h2>
        <span class="muted small">コースの終了日</span>
      </div>
      {/* 日付のマスを読み上げさせないのは、終了日は下の一覧で伝わり、30 個の数字を順に読むだけになるため */}
      <div aria-hidden="true">
        <div class="dash-week">
          {WEEKDAYS.map((w) => (
            <span>{w}</span>
          ))}
        </div>
        <div class="dash-days">
          {monthCells(year, month).map((cell) => (
            <span
              class={cx(
                'dash-day',
                cell.outside && 'is-outside',
                cell.weekday === 0 && 'is-sun',
                cell.weekday === 6 && 'is-sat',
                cell.key === today && 'is-today',
              )}
            >
              {cell.day}
              <span class="dash-day-marks">
                {deadlines
                  .filter((d) => d.date === cell.key)
                  .slice(0, 3)
                  .map((d) => (
                    <i class={`tone-${d.course.color}`} />
                  ))}
              </span>
            </span>
          ))}
        </div>
      </div>
      {deadlines.length > 0 ? (
        <ul class="dash-events">
          {deadlines.slice(0, 4).map(({ course, daysLeft }) => (
            <li>
              <a href={`/courses/${course.id}`} class={`dash-event tone-${course.color}`}>
                <CourseIcon course={course} text={[...course.title][0]} class="dot" />
                <span class="dash-event-text">
                  <strong class="truncate">{course.title}</strong>
                  <span class="small">
                    {`${SHORT_DATE.format(new Date((course.endAt ?? 0) * 1000))} まで、${daysLeft === 0 ? '今日で終了' : `あと ${daysLeft} 日`}`}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p class="dash-events-empty muted small">終了日の決まっている進行中のコースはありません。</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- ページ

export const DashboardPage = ({
  name,
  canCreate,
  isAdmin,
  results,
  adminCounts,
}: {
  name: string
  canCreate: boolean
  isAdmin: boolean
  results: DashboardCourse[]
  adminCounts?: { users: number; courses: number }
}) => {
  const today = unixToDateInput(Math.floor(Date.now() / 1000))

  return (
    <AppShell>
      <Styles use={['/src/components/card.css', '/src/components/ui.css', '/src/routes/dashboard/dashboard.css']} />
      <div class="dash-frame">
        <div class="dash">
          <div class="dash-main">
            <header class="dash-head">
              <div class="dash-head-text">
                <h1>{`${greeting()}、${name}さん`}</h1>
                <p class="muted">{LONG_DATE.format(new Date())}</p>
              </div>
              {canCreate && <CreateCourseButton />}
            </header>
            <section class="dash-courses">
              <h2 class="dash-vlabel">
                マイコース
                <span class="count">{results.length}</span>
              </h2>
              <div class="dash-rows">
                {results.length > 0 ? (
                  results.map((course) => <CourseRow course={course} />)
                ) : (
                  <p class="dash-rows-empty muted small">
                    {isAdmin || canCreate
                      ? '参加している進行中のコースはありません。'
                      : '進行中のコースはありません。コースに追加され、期間が始まると、ここに表示されます。'}
                    {isAdmin && (
                      <>
                        <a href="/courses">コース一覧</a>からすべてのコースを開けます。
                      </>
                    )}
                  </p>
                )}
                <a href="/courses" class="dash-more">
                  すべてのコースを見る <Icon name="chevronRight" size={14} />
                </a>
              </div>
            </section>
            <MascotYard />
          </div>
          <aside class="dash-side">
            <Calendar today={today} deadlines={deadlinesOf(results, today)} />
            {adminCounts && (
              <nav class="dash-ledger" aria-label="管理">
                <a href="/admin">
                  ユーザー
                  <strong>{adminCounts.users}</strong>
                  <Icon name="chevronRight" size={16} />
                </a>
                <a href="/admin/courses">
                  すべてのコース
                  <strong>{adminCounts.courses}</strong>
                  <Icon name="chevronRight" size={16} />
                </a>
              </nav>
            )}
            <section class="dash-tip" aria-label="今日のヒント">
              <h2>今日のヒント</h2>
              <p>{randomTip().text}</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  )
}
