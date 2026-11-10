import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { SearchBox, Select, TextField, validateWith } from '../../components/form'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Block, Card, Stat, Stats, Table } from '../../components/card'
import { Styles } from '../../components/style'
import { Alert, Avatar, EmptyState, PageHeader, Person, TabPanel, Tabs, formatDate, userMeta } from '../../components/ui'
import { AI_MODEL_LABELS, AI_PROVIDER_LABELS, AI_PROVIDER_MODELS, isAiModel, type AiProvider } from '../../lib/ai-models'
import type { AiOverview, AiUserUsage } from '../../lib/ai-ledger'
import type { FieldErrors } from '../../lib/forms'
import { ROLE_LABELS, type Role } from '../../lib/types'

type Tab = 'users' | 'courses' | 'ai'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'users', href: '/admin', label: 'ユーザー' },
  { tab: 'courses', href: '/admin/courses', label: 'コース' },
  { tab: 'ai', href: '/admin/ai', label: 'AI' },
]

const ROLE_OPTIONS = (['student', 'teacher', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

const ROLE_ICONS: Record<Role, IconName> = { admin: 'shield', teacher: 'book', student: 'users' }

/** moodleAdminUrl は Moodle モードのときの Moodle のサイト管理の URL。ユーザーとコースのタブを出さず、Moodle の画面への移動を置く */
const AdminShell = ({ tab, moodleAdminUrl, children }: { tab: Tab; moodleAdminUrl?: string; children: Child }) =>
  moodleAdminUrl ? (
    <AppShell>
      <PageHeader
        title="管理"
        description="AI の利用を管理します。ユーザーとコースは旧STEP Learn のサイト管理で管理します。"
        actions={
          <Button href={moodleAdminUrl} variant="ghost" icon="external" target="_blank" rel="noopener" data-no-prefetch>
            旧STEP Learnのサイト管理
          </Button>
        }
      />
      {children}
    </AppShell>
  ) : (
    <AppShell>
      <PageHeader title="管理" description="ユーザー・コース・AI の利用をまとめて管理します。" />
      <Tabs label="管理メニュー" items={TABS.map((t) => ({ href: t.href, label: t.label, active: tab === t.tab }))} />
      <TabPanel>{children}</TabPanel>
    </AppShell>
  )

// ---------------------------------------------------------------- ユーザー

export type UserRow = {
  id: number
  name: string
  username: string | null
  email: string
  role: Role
  createdAt: number
  courses: number
}

export const UsersPage = ({
  q,
  list,
  byRole,
  meId,
}: {
  q: string
  list: UserRow[]
  byRole: Partial<Record<Role, number>>
  meId: number
}) => (
  <AdminShell tab="users">
    <Stats compact>
      {(['admin', 'teacher', 'student'] as Role[]).map((r) => (
        <Stat
          label={
            <>
              <span class="stat-icon">
                <Icon name={ROLE_ICONS[r]} size={16} />
              </span>
              {ROLE_LABELS[r]}
            </>
          }
          value={byRole[r] ?? 0}
        />
      ))}
    </Stats>

    <form method="get" class="toolbar">
      <SearchBox label="ユーザーを検索" value={q} placeholder="名前・ユーザー名・メールで検索" />
    </form>

    {list.length === 0 ? (
      <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
    ) : (
      <Table
        columns={[
          { label: 'ユーザー' },
          { label: '登録日', class: 'hide-sm' },
          { label: 'コース', class: 'hide-sm num' },
          { label: 'ロール' },
        ]}
      >
        {list.map((u) => (
          <tr>
            <td>
              <Person
                avatar={<Avatar name={u.name} />}
                name={
                  <>
                    {u.name}
                    {u.id === meId && <span class="muted small">（あなた）</span>}
                  </>
                }
                meta={userMeta(u)}
              />
            </td>
            <td class="hide-sm muted">{formatDate(u.createdAt)}</td>
            <td class="hide-sm muted num">{u.courses}</td>
            <td>
              <form method="post" action={`/admin/users/${u.id}/role`} data-autosubmit>
                <Select
                  name="role"
                  compact
                  options={ROLE_OPTIONS}
                  value={u.role}
                  aria-label={`${u.name} のロール`}
                  disabled={u.id === meId}
                />
              </form>
            </td>
          </tr>
        ))}
      </Table>
    )}
  </AdminShell>
)

// ---------------------------------------------------------------- コース

export type CourseRow = {
  id: number
  code: string
  title: string
  color: string
  createdAt: number
  teachers: string | null
  students: number
  items: number
}

export const CoursesPage = ({ q, list }: { q: string; list: CourseRow[] }) => (
  <AdminShell tab="courses">
    <div class="toolbar">
      <form method="get" class="toolbar-grow">
        <SearchBox label="コースを検索" value={q} placeholder="コース名・コードで検索" />
      </form>
      <CreateCourseButton />
    </div>

    {list.length === 0 ? (
      <EmptyState
        icon="book"
        title={q ? `「${q}」に一致するコースはありません` : 'まだコースがありません'}
        text={q ? '別のキーワードで検索してみてください。' : '「コースを作成」から最初のコースを作りましょう。'}
      />
    ) : (
      <Table
        columns={[
          { label: 'コース' },
          { label: '教師', class: 'hide-sm' },
          { label: '学生', class: 'hide-sm num' },
          { label: 'アイテム', class: 'hide-sm num' },
          { label: '作成日', class: 'hide-sm' },
          { label: '操作', srOnly: true },
        ]}
      >
        {list.map((course) => (
          <tr>
            <td>
              <Person
                href={`/courses/${course.id}`}
                avatar={<span class={`dot tone-${course.color}`}>{[...course.title][0]}</span>}
                name={course.title}
                meta={course.code}
              />
            </td>
            <td class="hide-sm muted">
              <span class="wrap">{course.teachers ?? '未設定'}</span>
            </td>
            <td class="hide-sm muted num">{course.students}</td>
            <td class="hide-sm muted num">{course.items}</td>
            <td class="hide-sm muted">{formatDate(course.createdAt)}</td>
            <td>
              <div class="row-actions">
                <IconButton href={`/courses/${course.id}/participants`} icon="users" label={`${course.title} の参加者`} title="参加者" />
                <IconButton href={`/courses/${course.id}/settings`} icon="sliders" label={`${course.title} の設定`} title="設定" />
              </div>
            </td>
          </tr>
        ))}
      </Table>
    )}
  </AdminShell>
)

// ---------------------------------------------------------------- AI

// 常に小数第 2 位までにしないのは、1 回の呼び出しが 1 セントに満たず、使っていても $0.00 と出てしまうため
const formatUsd = (usd: number) => `$${usd.toFixed(usd > 0 && usd < 0.1 ? 4 : 2)}`

const API_KEY_NAMES: Record<AiProvider, string> = { openrouter: 'OPENROUTER_API_KEY', anthropic: 'CLAUDE_API_KEY' }

const modelLabels = (provider: AiProvider) => AI_PROVIDER_MODELS[provider].map((m) => AI_MODEL_LABELS[m]).join('・')

export const aiLimitField = (provider: AiProvider) => `${provider}_limit` as const

const ProviderUsage = ({ overview }: { overview: AiOverview }) => (
  <Block heading={`${AI_PROVIDER_LABELS[overview.provider]}（${modelLabels(overview.provider)}）`}>
    {(!overview.enabled || overview.monthlyLimit === 0) && (
      <div class="ai-notice">
        {overview.enabled ? (
          <Alert tone="info">月の上限が 0 のため、このモデルは使えません。</Alert>
        ) : (
          <Alert tone="warning">{API_KEY_NAMES[overview.provider]} が設定されていないため、このモデルは使えません。</Alert>
        )}
      </div>
    )}
    <Stats compact class="ai-stats">
      <Stat
        label="今月の消費"
        value={
          <>
            {formatUsd(overview.monthSpent)} <small>/ {formatUsd(overview.monthlyLimit)}</small>
          </>
        }
      />
      <Stat label="今週の全体枠" value={formatUsd(overview.pool)} />
      <Stat label="今週の 1 人あたりの枠" value={formatUsd(overview.pool / Math.max(1, overview.activeUsers))} />
      <Stat
        label="直近 4 週間の利用者"
        value={
          <>
            {overview.activeUsers} <small>人</small>
          </>
        }
      />
    </Stats>
  </Block>
)

export const AiPage = ({
  overviews,
  list,
  values,
  errors = {},
  moodleAdminUrl,
}: {
  overviews: AiOverview[]
  list: AiUserUsage[]
  values: Record<AiProvider, string>
  errors?: FieldErrors
  moodleAdminUrl?: string
}) => (
  <AdminShell tab="ai" moodleAdminUrl={moodleAdminUrl}>
    <Styles use={['/src/routes/admin/admin.css']} />
    {overviews.map((overview) => (
      <ProviderUsage overview={overview} />
    ))}

    <Card
      heading="月の上限"
      description="上限と使用量は、モデルの提供元ごとに分かれます。今週の全体枠は、月の残りを月末までの日数で割って決まり、直近 4 週間に使った人数で等分します。月曜 0:00 に切り替わります。"
    >
      <form method="post" action="/admin/ai" class="stack" data-loading-form {...validateWith('aiSettings')}>
        <div class="grid-2">
          {overviews.map(({ provider }) => (
            <TextField
              label={`${AI_PROVIDER_LABELS[provider]}（USD）`}
              name={aiLimitField(provider)}
              value={values[provider]}
              error={errors[aiLimitField(provider)]}
              hint={`${modelLabels(provider)}。0 にすると使えなくなります。`}
              inputmode="decimal"
              autocomplete="off"
            />
          ))}
        </div>
        <div class="form-actions">
          <Button type="submit" variant="primary">
            保存
          </Button>
        </div>
      </form>
    </Card>

    <Block heading="今月の使用量" count={list.length}>
      {list.length === 0 ? (
        <EmptyState icon="info" title="今月はまだ使われていません" text="AI を使うと、ユーザーごとの使用量がここに出ます。" />
      ) : (
        <Table
          columns={[
            { label: 'ユーザー' },
            { label: 'モデル', class: 'hide-sm' },
            { label: '今週', class: 'num' },
            { label: '今月', class: 'num' },
            { label: '回数', class: 'hide-sm num' },
          ]}
        >
          {list.map((u) => {
            const model = isAiModel(u.model) ? AI_MODEL_LABELS[u.model] : u.model
            return (
              <tr>
                <td>
                  {u.name === null ? (
                    <span class="muted">利用者なし（コードの採点・削除されたユーザー）</span>
                  ) : (
                    <Person
                      avatar={<Avatar name={u.name} />}
                      name={u.name}
                      meta={userMeta({ username: u.username, email: u.email ?? undefined })}
                    />
                  )}
                  <div class="ai-model-sm muted small">{model}</div>
                </td>
                <td class="hide-sm muted">{model}</td>
                <td class="num">{formatUsd(u.week)}</td>
                <td class="num">{formatUsd(u.month)}</td>
                <td class="hide-sm muted num">{u.calls}</td>
              </tr>
            )
          })}
        </Table>
      )}
    </Block>
  </AdminShell>
)
