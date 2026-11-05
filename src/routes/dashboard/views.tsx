import { Bento, Tile } from '../../components/card'
import { CreateCourseButton, nextActionLabel } from '../../components/course'
import { cx } from '../../components/cx'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { CourseIcon, CourseRow, EmptyState, courseInitials, Progress, ProgressRing, type CourseCardData } from '../../components/ui'
import { courseImageUrl } from '../../lib/course-images'
import { randomTip } from '../../lib/tips'

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
}

const StatLabel = ({ icon, children }: { icon: IconName; children: string }) => (
  <span class="stat-label">
    <span class="stat-icon">
      <Icon name={icon} size={16} />
    </span>
    {children}
  </span>
)

const AdminLink = ({ href, icon, label, description }: { href: string; icon: IconName; label: string; description: string }) => (
  <a href={href} class="course-row">
    <span class="stat-icon">
      <Icon name={icon} size={16} />
    </span>
    <span class="course-row-text">
      <strong>{label}</strong>
      <span class="muted small">{description}</span>
    </span>
    <Icon name="chevronRight" size={16} />
  </a>
)

const learningOf = (results: CourseCardData[]) => results.filter((r) => r.role === 'student')
const trackedTotal = (learning: CourseCardData[]) => learning.reduce((n, r) => n + (r.total ?? 0), 0)

export const featuredCourse = (results: CourseCardData[]) => {
  const learning = learningOf(results)
  return learning.find((r) => (r.total ?? 0) > (r.done ?? 0)) ?? (trackedTotal(learning) === 0 ? learning[0] : undefined)
}

export const DashboardPage = ({
  name,
  canCreate,
  isAdmin,
  results,
  nextItem,
}: {
  name: string
  canCreate: boolean
  isAdmin: boolean
  results: CourseCardData[]
  nextItem?: { id: number; title: string }
}) => {
  const teaching = results.filter((r) => r.role === 'teacher')
  const learning = learningOf(results)
  const totalItems = trackedTotal(learning)
  const doneItems = learning.reduce((n, r) => n + (r.done ?? 0), 0)
  const next = featuredCourse(results)
  const nextTracked = (next?.total ?? 0) > 0
  const recent = learning.length === 0 ? teaching[0] : undefined
  const hasSide = totalItems > 0 || learning.length > 0 || isAdmin || !!recent
  const stacked = totalItems === 0 && results.length <= 6 && (!!next || !!recent)
  const featured = next ?? recent
  const hero = featured && courseImageUrl(featured.id, 'hero', featured.heroImage)
  const cover = hero && <img class="tile-feature-cover" src={hero} alt="" />

  return (
    <AppShell>
      <Styles use={['/src/components/ui.css', '/src/routes/dashboard/dashboard.css']} />
      <Bento>
        <Tile span={hasSide ? 2 : 4} class="tile-welcome">
          <div class="eyebrow">
            {new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' }).format(
              new Date(),
            )}
          </div>
          <h1>{`${greeting()}、${name}さん`}</h1>
          <p class="tile-tip">{randomTip()}</p>
          {canCreate && (
            <div class="tile-actions">
              <CreateCourseButton />
            </div>
          )}
        </Tile>
        {totalItems > 0 && (
          <>
            <Tile class="tile-stat">
              <StatLabel icon="checkCircle">全体の進捗</StatLabel>
              <ProgressRing done={doneItems} total={totalItems} />
            </Tile>
            <Tile class="tile-stat">
              <StatLabel icon="check">完了したアイテム</StatLabel>
              <span class="stat-value">
                {doneItems}
                <small> / {totalItems}</small>
              </span>
            </Tile>
          </>
        )}
        {next && (
          <Tile
            href={nextItem ? `/courses/${next.id}/items/${nextItem.id}` : `/courses/${next.id}`}
            span={2}
            rows={stacked ? 2 : 1}
            class={`tile-feature tone-${next.color}`}
          >
            {cover}
            <CourseIcon course={next} text={courseInitials(next)} class="course-mono" />
            <div class="tile-feature-body">
              <span class="tile-feature-label">{nextItem ? '次に学ぶ' : '最近のコース'}</span>
              <strong class="tile-feature-title">{next.title}</strong>
              {nextItem && <span class="tile-feature-next truncate">次: {nextItem.title}</span>}
              {nextTracked && <Progress done={next.done ?? 0} total={next.total ?? 0} />}
            </div>
            <span class="tile-feature-cta">
              {nextItem ? nextActionLabel(next.done ?? 0) : '開く'} <Icon name="chevronRight" size={16} />
            </span>
          </Tile>
        )}
        {learning.length === 0 && isAdmin && !recent && (
          <Tile span={2} class="tile-stat tile-admin">
            <StatLabel icon="shield">管理</StatLabel>
            <strong class="tile-admin-title">ユーザーとコースを管理</strong>
            <div class="admin-links">
              <AdminLink href="/admin" icon="users" label="ユーザー" description="ロールとアカウント" />
              <AdminLink href="/admin/courses" icon="book" label="コース" description="すべてのコースと担当" />
            </div>
          </Tile>
        )}
        {recent && (
          <Tile span={2} rows={stacked ? 2 : 1} class={`tile-feature tile-teach tone-${recent.color}`}>
            {cover}
            <CourseIcon course={recent} text={courseInitials(recent)} class="course-mono" />
            <div class="tile-feature-body">
              <span class="tile-feature-label">最近のコース</span>
              <strong class="tile-feature-title">{recent.title}</strong>
              <span class="tile-feature-next">参加者 {recent.members ?? 0}人</span>
            </div>
            <div class="tile-quick">
              <a href={`/courses/${recent.id}`}>
                <Icon name="layers" size={16} />
                教材
              </a>
              <a href={`/courses/${recent.id}/participants`}>
                <Icon name="users" size={16} />
                参加者
              </a>
              <a href={`/courses/${recent.id}/settings`}>
                <Icon name="sliders" size={16} />
                設定
              </a>
            </div>
          </Tile>
        )}
        <Tile
          span={stacked || (next && totalItems > 0) ? 2 : 4}
          class={cx('tile-courses', isAdmin && results.length === 0 && 'tile-compact')}
        >
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
          ) : isAdmin ? (
            <p class="muted small">
              参加しているコースはありません。<a href="/courses">コース一覧</a>からすべてのコースを開けます。
            </p>
          ) : (
            <EmptyState icon="book" title="まだ参加しているコースはありません" text="コースに追加されると、ここに表示されます。" />
          )}
        </Tile>
      </Bento>
    </AppShell>
  )
}
