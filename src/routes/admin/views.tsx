import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { SearchBox, Select, TextField, validateWith } from '../../components/form'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Block, Card, Stat, Stats, Table } from '../../components/card'
import { Styles } from '../../components/style'
import { Alert, Avatar, Chip, EmptyState, PageHeader, Person, TabPanel, Tabs, formatDate, userMeta } from '../../components/ui'
import {
  AI_LIMITED_MODEL_QUOTA_LABELS,
  AI_MODEL_LABELS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODELS,
  AI_PROVIDER_QUOTA_LABELS,
  aiProvider,
  isAiModel,
  type AiLimitedModel,
  type AiProvider,
} from '../../lib/ai-models'
import type { AiOverview, AiUserUsage } from '../../lib/ai-ledger'
import type { FieldErrors } from '../../lib/forms'
import { LOG_KINDS, LOG_KIND_LABELS, LOG_RETENTION_DAYS, ROLE_LABELS, type LogKind, type Role } from '../../lib/types'

type Tab = 'users' | 'courses' | 'ai' | 'logs'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'users', href: '/admin', label: 'ユーザー' },
  { tab: 'courses', href: '/admin/courses', label: 'コース' },
  { tab: 'ai', href: '/admin/ai', label: 'AI' },
  { tab: 'logs', href: '/admin/logs', label: '操作ログ' },
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
      <PageHeader title="管理" description="ユーザー・コース・AI の利用と操作ログをまとめて管理します。" />
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

export const aiShareField = (model: AiLimitedModel) => `${model}_share` as const

/** 管理画面の入力欄の値。shares はモデルだけの週の枠（%） */
export type AiSettingValues = { limits: Record<AiProvider, string>; shares: Record<AiLimitedModel, string> }

const perUser = ({ pool, activeUsers }: AiOverview) => pool / Math.max(1, activeUsers)

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
      <Stat
        label="今週の 1 人あたりの枠"
        value={
          <>
            {formatUsd(perUser(overview))}
            {overview.shares.map(({ model, share }) => (
              <small class="ai-stat-sub">
                {AI_LIMITED_MODEL_QUOTA_LABELS[model]} {formatUsd(perUser(overview) * share)}
              </small>
            ))}
          </>
        }
      />
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
  values: AiSettingValues
  errors?: FieldErrors
  moodleAdminUrl?: string
}) => (
  <AdminShell tab="ai" moodleAdminUrl={moodleAdminUrl}>
    <Styles use={['/src/routes/admin/admin.css']} />
    {overviews.map((overview) => (
      <ProviderUsage overview={overview} />
    ))}

    <Card
      heading="上限"
      description="上限と使用量は、モデルの提供元ごとに分かれます。今週の全体枠は、月の残りを月末までの日数で割って決まり、直近 4 週間に使った人数で等分します。月曜 0:00 に切り替わります。"
    >
      <form method="post" action="/admin/ai" class="stack" data-loading-form {...validateWith('aiSettings')}>
        <div class="grid-2">
          {overviews.map(({ provider }) => (
            <TextField
              label={`${AI_PROVIDER_LABELS[provider]}の月の上限（USD）`}
              name={aiLimitField(provider)}
              value={values.limits[provider]}
              error={errors[aiLimitField(provider)]}
              hint={`${modelLabels(provider)}。0 にすると使えなくなります。`}
              inputmode="decimal"
              autocomplete="off"
            />
          ))}
          {overviews.flatMap(({ shares }) =>
            shares.map(({ model }) => (
              <TextField
                label={`${AI_MODEL_LABELS[model]} だけの週の枠（%）`}
                name={aiShareField(model)}
                value={values.shares[model]}
                error={errors[aiShareField(model)]}
                hint={`${AI_PROVIDER_QUOTA_LABELS[aiProvider(model)]}の 1 人あたりの週の枠に対する割合。使った分は${AI_PROVIDER_QUOTA_LABELS[aiProvider(model)]}の枠にも数えます。0 にすると「難しい依頼」が使えなくなります。`}
                inputmode="numeric"
                autocomplete="off"
              />
            )),
          )}
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

// ---------------------------------------------------------------- 操作ログ

export type LogRow = {
  id: number
  createdAt: number
  kind: LogKind
  action: string
  label: string
  path: string
  target: string | null
  ip: string
  userAgent: string | null
  courseId: number | null
  courseTitle: string | null
  userId: number | null
  name: string | null
  username: string | null
  email: string | null
}

type LogFilter = { q?: string; kind?: LogKind; user?: number; before?: number }

const logsUrl = (filter: LogFilter) => {
  const params = new URLSearchParams(
    Object.entries(filter)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  )
  return params.size ? `/admin/logs?${params}` : '/admin/logs'
}

// formatDateTime を使わないのは、年と秒がなく、消さずに残す記録や、続けて行った操作の前後がわからないため
const LOG_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const formatLogTime = (unix: number) => LOG_TIME.format(new Date(unix * 1000))

const KIND_DESCRIPTIONS: Record<LogKind, string> = {
  view: '閲覧（コースやアイテムを開いた記録）',
  change: '操作（ログイン・教材の編集・提出など）',
  important: '重要な操作（削除・ロールと参加者の変更・パスワードの変更など）',
}

const retentionNote = (kind: LogKind) => {
  const days = LOG_RETENTION_DAYS[kind]
  return `${KIND_DESCRIPTIONS[kind]}は${days === null ? '消さずに残します' : ` ${days} 日たつと消えます`}。`
}

const KIND_OPTIONS = [{ value: '', label: 'すべての種類' }, ...LOG_KINDS.map((k) => ({ value: k, label: LOG_KIND_LABELS[k] }))]

// 操作を最初の列にするのは、Table は最初の列だけを伸ばして折り返し、ほかの列は折り返さないため
const LogEntry = ({ log }: { log: LogRow }) => (
  <tr>
    <td>
      <div class="log-action">
        <Chip tone={log.kind === 'important' ? 'accent' : 'default'}>{LOG_KIND_LABELS[log.kind]}</Chip>
        <span>
          {log.label}
          {log.target && <>「{log.target}」</>}
        </span>
      </div>
      {log.courseId !== null && log.target !== log.courseTitle && (
        <div class="small">
          {log.courseTitle === null ? (
            <span class="muted">削除されたコース</span>
          ) : (
            <a href={`/courses/${log.courseId}`} class="muted">
              {log.courseTitle}
            </a>
          )}
        </div>
      )}
      {log.action === 'other' && <code class="small muted">{log.path}</code>}
      <div class="log-time-sm muted small">
        {formatLogTime(log.createdAt)}・{log.ip}
      </div>
    </td>
    <td class="log-user">
      {log.userId !== null && log.name !== null ? (
        <Person
          href={logsUrl({ user: log.userId })}
          avatar={<Avatar name={log.name} />}
          name={log.name}
          meta={userMeta({ username: log.username, email: log.email ?? undefined })}
        />
      ) : (
        <span class="muted">ユーザーなし</span>
      )}
    </td>
    <td class="hide-sm muted log-time">{formatLogTime(log.createdAt)}</td>
    <td class="hide-sm muted" title={log.userAgent ?? undefined}>
      {log.ip}
    </td>
  </tr>
)

export const LogsPage = ({
  q,
  kind,
  user,
  before,
  list,
  nextBefore,
}: {
  q: string
  kind?: LogKind
  user: { id: number; name: string } | null
  before?: number
  list: LogRow[]
  nextBefore?: number
}) => {
  const filter: LogFilter = { q, kind, user: user?.id }
  const filtered = !!(q || kind || user)
  return (
    <AdminShell tab="logs">
      <Styles use={['/src/routes/admin/admin.css']} />
      <p class="muted log-notice">{LOG_KINDS.map(retentionNote).join('')}</p>

      <form method="get" class="toolbar log-toolbar" data-autosubmit>
        <div class="toolbar-grow">
          <SearchBox label="ユーザーで絞り込む" value={q} placeholder="名前・ユーザー名・メールで絞り込む" />
        </div>
        <Select name="kind" options={KIND_OPTIONS} value={kind ?? ''} aria-label="種類" />
        {user && <input type="hidden" name="user" value={String(user.id)} />}
      </form>

      {user && (
        <div class="log-filter">
          <Chip tone="accent">{user.name} さんの記録</Chip>
          <a href={logsUrl({ ...filter, user: undefined })} class="small">
            絞り込みを解除
          </a>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="search"
          title={filtered || before ? '一致する記録はありません' : 'まだ記録がありません'}
          text={filtered ? '条件を変えてお試しください。' : 'ログインや教材の閲覧・編集などを行うと、ここに記録が出ます。'}
        />
      ) : (
        <Table
          columns={[
            { label: '操作' },
            { label: 'ユーザー' },
            { label: '日時', class: 'hide-sm' },
            { label: 'IP アドレス', class: 'hide-sm' },
          ]}
        >
          {list.map((log) => (
            <LogEntry log={log} />
          ))}
        </Table>
      )}

      {(before || nextBefore) && (
        <div class="row log-pager">
          {before && (
            <Button href={logsUrl(filter)} variant="ghost">
              最新の記録へ
            </Button>
          )}
          {nextBefore && (
            <Button href={logsUrl({ ...filter, before: nextBefore })} iconEnd="chevronRight">
              さらに古い記録
            </Button>
          )}
        </div>
      )}
    </AdminShell>
  )
}
