import { Bento, Tile } from '../../components/card'
import { CreateCourseButton } from '../../components/course'
import { cx } from '../../components/cx'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Mascot } from '../../components/mascot'
import { Styles } from '../../components/style'
import { CourseCard, EmptyState, ProgressRing, type CourseCardData } from '../../components/ui'
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

export const DashboardPage = ({
  name,
  canCreate,
  isAdmin,
  results,
}: {
  name: string
  canCreate: boolean
  isAdmin: boolean
  results: CourseCardData[]
}) => {
  const learning = learningOf(results)
  const totalItems = trackedTotal(learning)
  const doneItems = learning.reduce((n, r) => n + (r.done ?? 0), 0)
  const showsAdmin = learning.length === 0 && isAdmin
  const hasSide = totalItems > 0 || showsAdmin
  const tip = randomTip()

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
          <Mascot class="tile-mascot" act={tip.act} pose="wave" size={72} stand={false} say={tip.text} />
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
        {showsAdmin && (
          <Tile span={2} class="tile-stat tile-admin">
            <StatLabel icon="shield">管理</StatLabel>
            <strong class="tile-admin-title">ユーザーとコースを管理</strong>
            <div class="admin-links">
              <AdminLink href="/admin" icon="users" label="ユーザー" description="ロールとアカウント" />
              <AdminLink href="/admin/courses" icon="book" label="コース" description="すべてのコースと担当" />
            </div>
          </Tile>
        )}
        <Tile span={4} class={cx('tile-courses', isAdmin && results.length === 0 && 'tile-compact')}>
          <div class="tile-head">
            <h2>
              マイコース <span class="count">{results.length}</span>
            </h2>
            <a href="/courses" class="tile-link">
              すべて見る <Icon name="chevronRight" size={14} />
            </a>
          </div>
          {results.length > 0 ? (
            <div class="course-grid">
              {results.map((course) => (
                <CourseCard course={course} showProgress={course.role === 'student' && (course.total ?? 0) > 0} />
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
