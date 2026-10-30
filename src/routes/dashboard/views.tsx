import { CreateCourseButton } from '../../components/course'
import { Bento, Tile } from '../../components/card'
import { Icon } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { CourseRow, EmptyState, Progress, ProgressRing, type CourseCardData } from '../../components/ui'
import { randomTip } from '../../lib/tips'

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
}

export const DashboardPage = ({ name, canCreate, results }: { name: string; canCreate: boolean; results: CourseCardData[] }) => {
  const teaching = results.filter((r) => r.role === 'teacher')
  const learning = results.filter((r) => r.role === 'student')
  const totalItems = learning.reduce((n, r) => n + (r.total ?? 0), 0)
  const doneItems = learning.reduce((n, r) => n + (r.done ?? 0), 0)
  const next = learning.find((r) => (r.total ?? 0) > (r.done ?? 0))

  const members = teaching.reduce((n, r) => n + (r.members ?? 0), 0)

  return (
    <AppShell>
      <Styles use={['/src/routes/dashboard/dashboard.css']} />
      <Bento>
        <Tile span={2} class="tile-welcome">
          <div class="eyebrow">
            {new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
          </div>
          <h1>{`${greeting()}、${name}さん`}</h1>
          <p class="tile-tip">{randomTip()}</p>
          {canCreate && (
            <div class="tile-actions">
              <CreateCourseButton />
            </div>
          )}
        </Tile>
        {learning.length > 0 ? (
          <>
            <Tile class="tile-stat">
              <span class="stat-label">全体の進捗</span>
              <ProgressRing done={doneItems} total={totalItems} />
            </Tile>
            <Tile class="tile-stat">
              <span class="stat-label">完了したアイテム</span>
              <span class="stat-value">
                {doneItems}
                <small> / {totalItems}</small>
              </span>
            </Tile>
          </>
        ) : (
          <>
            <Tile class="tile-stat">
              <span class="stat-label">担当しているコース</span>
              <span class="stat-value">{teaching.length}</span>
            </Tile>
            <Tile class="tile-stat">
              <span class="stat-label">参加者（延べ）</span>
              <span class="stat-value">{members}</span>
            </Tile>
          </>
        )}
        {next && (
          <Tile href={`/courses/${next.id}`} rows={2} class={`tile-feature tone-${next.color}`}>
            <span class="tile-feature-label">続きから学習</span>
            <span class="course-mono">{[...(next.code || next.title)].slice(0, 2).join('')}</span>
            <strong class="tile-feature-title">{next.title}</strong>
            <Progress done={next.done ?? 0} total={next.total ?? 0} />
            <span class="tile-feature-cta">
              学習を再開 <Icon name="chevronRight" size={16} />
            </span>
          </Tile>
        )}
        <Tile span={next ? 3 : 4} rows={next ? 2 : 1} class="tile-courses">
          <div class="tile-head">
            <h2>
              マイコース <span class="count">{results.length}</span>
            </h2>
            <a href="/courses" class="tile-link">
              すべて見る <Icon name="chevronRight" size={14} />
            </a>
          </div>
          {results.length > 0 ? (
            <div class="course-rows">
              {results.map((course) => (
                <CourseRow course={course} />
              ))}
            </div>
          ) : (
            <EmptyState icon="book" title="まだ参加しているコースはありません" text="コースに追加されると、ここに表示されます。" />
          )}
        </Tile>
      </Bento>
    </AppShell>
  )
}
