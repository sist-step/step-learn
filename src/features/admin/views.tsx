import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../../components/course'
import { Button, IconButton } from '../../components/button'
import { SearchBox, Select, SelectField, TextAreaField, TextField, validateWith } from '../../components/form'
import { Icon, type IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { MenuItem, Popover } from '../../components/overlay'
import { Block, Card, Stat, Stats, Table } from '../../components/card'
import { Styles } from '../../components/style'
import {
  Alert,
  Avatar,
  Chip,
  EmptyState,
  PageHeader,
  Person,
  TabPanel,
  Tabs,
  formatDate,
  formatDateTime,
  userMeta,
} from '../../components/ui'
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
} from '../ai/ai-models'
import type { AgentItemRow } from '../agent/agent'
import type { AiOverview, AiUserUsage } from '../ai/ai-ledger'
import {
  BATCH_FILE_FORMATS,
  BATCH_FILE_LABELS,
  BATCH_FILE_TTL,
  MAX_BATCH_USERS,
  USER_BATCH_KIND_LABELS,
  type UserBatchKind,
} from './user-batch'
import type { FieldErrors } from '../../lib/forms'
import { PASSWORD_HINT } from '../../lib/password'
import {
  LOG_KINDS,
  LOG_KIND_LABELS,
  LOG_RETENTION_DAYS,
  MANAGED_ROLES,
  ROLE_LABELS,
  isManagedRole,
  type LogKind,
  type ManagedRole,
  type Role,
} from '../../lib/types'
import { USERNAME_HINT } from '../../lib/username'

type Tab = 'users' | 'courses' | 'ai' | 'agents' | 'logs'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'users', href: '/admin', label: 'ユーザー' },
  { tab: 'courses', href: '/admin/courses', label: 'コース' },
  { tab: 'ai', href: '/admin/ai', label: 'AI' },
  { tab: 'agents', href: '/admin/agents', label: 'コーディングエージェント' },
  { tab: 'logs', href: '/admin/logs', label: '操作ログ' },
]

const ROLE_OPTIONS = (['student', 'teacher', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

const ROLE_ICONS: Record<Role, IconName> = { admin: 'shield', teacher: 'book', student: 'users' }

// ユーザー・コース・操作ログを除くのは、ユーザーとコースは Moodle にあり、Moodle モードの操作は Moodle のログに残るため
const MOODLE_TABS = TABS.filter((t) => t.tab === 'ai' || t.tab === 'agents')

/** moodleAdminUrl は Moodle モードのときの Moodle のサイト管理の URL。ユーザーとコースのタブを出さず、Moodle の画面への移動を置く */
const AdminShell = ({ tab, moodleAdminUrl, children }: { tab: Tab; moodleAdminUrl?: string; children: Child }) => (
  <AppShell>
    {moodleAdminUrl ? (
      <PageHeader
        title="管理"
        description="AI とコーディングエージェントの利用を管理します。ユーザーとコースは旧STEP Learn のサイト管理で管理します。"
        actions={
          <Button href={moodleAdminUrl} variant="ghost" icon="external" target="_blank" rel="noopener" data-no-prefetch>
            旧STEP Learnのサイト管理
          </Button>
        }
      />
    ) : (
      <PageHeader title="管理" description="ユーザー・コース・AI の利用と操作ログをまとめて管理します。" />
    )}
    <Tabs
      label="管理メニュー"
      items={(moodleAdminUrl ? MOODLE_TABS : TABS).map((t) => ({ href: t.href, label: t.label, active: tab === t.tab }))}
    />
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

    <div class="toolbar">
      <form method="get" class="toolbar-grow">
        <SearchBox label="ユーザーを検索" value={q} placeholder="名前・ユーザー名・メールで検索" />
      </form>
      <Button href="/admin/batches" variant="ghost" icon="clock">
        一括作成の履歴
      </Button>
      <Button href="/admin/users/bulk" icon="userGroup">
        一括作成
      </Button>
      <Button href="/admin/users/new" variant="primary" icon="plus">
        ユーザーを作成
      </Button>
    </div>

    {list.length === 0 ? (
      <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
    ) : (
      <Table
        columns={[
          { label: 'ユーザー' },
          { label: '登録日', class: 'hide-sm' },
          { label: 'コース', class: 'hide-sm num' },
          { label: 'ロール' },
          { label: '操作', srOnly: true },
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
            <td>
              {isManagedRole(u.role) && (
                <div class="row-actions">
                  <Popover
                    class="row-menu"
                    panelClass="row-menu-panel"
                    trigger={<IconButton as="summary" icon="ellipsis" label={`${u.name} のその他の操作`} />}
                  >
                    <MenuItem href={`/admin/users/${u.id}/password`} icon="lock">
                      パスワードを再設定
                    </MenuItem>
                    <div class="menu-sep" role="separator" />
                    <form
                      method="post"
                      action={`/admin/users/${u.id}/delete`}
                      data-confirm={`${u.name} さんを削除しますか？提出や成績、AI とのチャットも消え、元に戻せません。`}
                      data-confirm-ok="削除する"
                    >
                      <MenuItem type="submit" icon="trash" class="is-danger">
                        ユーザーを削除
                      </MenuItem>
                    </form>
                  </Popover>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </AdminShell>
)

const MANAGED_ROLE_OPTIONS = MANAGED_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))

const BackToUsers = () => (
  <a href="/admin" class="back-link">
    <Icon name="chevronLeft" size={16} />
    ユーザー一覧
  </a>
)

export type NewUserValues = { name: string; username: string; email: string; role: ManagedRole }

export const NewUserPage = ({ values, errors = {} }: { values: NewUserValues; errors?: FieldErrors }) => (
  <AdminShell tab="users">
    <Styles use={['/src/features/admin/admin.css']} />
    <div class="admin-form">
      <BackToUsers />
      <Card heading="ユーザーを作成" description="作成したら、メールアドレスかユーザー名と、ここで決めたパスワードを本人に伝えてください。">
        <form method="post" action="/admin/users" class="stack" data-loading-form {...validateWith('newUser')}>
          <div class="grid-2">
            <TextField label="氏名" name="name" value={values.name} error={errors.name} autocomplete="off" autofocus />
            <SelectField label="ロール" name="role" options={MANAGED_ROLE_OPTIONS} value={values.role} error={errors.role} />
          </div>
          <TextField
            label="ユーザー名"
            name="username"
            value={values.username}
            error={errors.username}
            hint={USERNAME_HINT}
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
          />
          <TextField
            label="メールアドレス"
            name="email"
            type="email"
            value={values.email}
            error={errors.email}
            hint="Microsoft アカウントのメールアドレスと同じなら、本人が Microsoft アカウントでもログインできます。"
            autocomplete="off"
          />
          <TextField
            label="パスワード"
            name="password"
            type="password"
            error={errors.password}
            hint={PASSWORD_HINT}
            autocomplete="new-password"
          />
          <div class="form-actions">
            <Button href="/admin" variant="ghost">
              キャンセル
            </Button>
            <Button type="submit" variant="primary">
              ユーザーを作成
            </Button>
          </div>
        </form>
      </Card>
    </div>
  </AdminShell>
)

export type PasswordTarget = { id: number; name: string; username: string | null; email: string; role: ManagedRole }

export const ResetPasswordPage = ({ user, errors = {} }: { user: PasswordTarget; errors?: FieldErrors }) => (
  <AdminShell tab="users">
    <Styles use={['/src/features/admin/admin.css']} />
    <div class="admin-form">
      <BackToUsers />
      <Card
        heading="パスワードを再設定"
        description="再設定すると、このユーザーはすべての端末でログアウトされます。新しいパスワードは本人に伝えてください。"
      >
        <div class="stack">
          <Person avatar={<Avatar name={user.name} />} name={user.name} meta={[ROLE_LABELS[user.role], ...userMeta(user)]} />
          <form method="post" action={`/admin/users/${user.id}/password`} class="stack" data-loading-form {...validateWith('setPassword')}>
            <TextField
              label="新しいパスワード"
              name="password"
              type="password"
              error={errors.password}
              hint={PASSWORD_HINT}
              autocomplete="new-password"
              autofocus
            />
            <div class="form-actions">
              <Button href="/admin" variant="ghost">
                キャンセル
              </Button>
              <Button type="submit" variant="primary">
                パスワードを再設定
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  </AdminShell>
)

// ---------------------------------------------------------------- 一括作成

export type BulkUsersValues = { prefix: string; role: ManagedRole; course: string; names: string }

export type CourseChoice = { id: number; title: string }

export const BulkUsersPage = ({
  values,
  courses,
  errors = {},
}: {
  values: BulkUsersValues
  courses: CourseChoice[]
  errors?: FieldErrors
}) => (
  <AdminShell tab="users">
    <Styles use={['/src/features/admin/admin.css']} />
    <div class="admin-form">
      <BackToUsers />
      <Card
        heading="ユーザーを一括作成"
        description={`氏名を 1 行に 1 人ずつ貼り付けると、接頭辞に 2 桁の連番を付けたユーザー名と、パスワードを作ります。作ってから ${BATCH_FILE_TTL / 60} 分の間だけ、ログインカードと一覧をダウンロードできます。`}
      >
        <form
          method="post"
          action="/admin/users/bulk"
          class="stack"
          data-loading-form
          data-bulk-users="/admin/users/bulk/next"
          {...validateWith('bulkUsers')}
        >
          <div class="grid-2">
            <TextField
              label="接頭辞"
              name="prefix"
              value={values.prefix}
              error={errors.prefix}
              hint="例: 20260 にすると 2026001・2026002…。半角英数字と . _ -"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              autofocus
            />
            <SelectField label="ロール" name="role" options={MANAGED_ROLE_OPTIONS} value={values.role} error={errors.role} />
          </div>
          <SelectField
            label="登録するコース"
            name="course"
            options={[{ value: '', label: '登録しない' }, ...courses.map((c) => ({ value: String(c.id), label: c.title }))]}
            value={values.course}
            error={errors.course}
            hint="選ぶと、作った人を選んだロールでコースに登録します。"
          />
          <TextAreaField
            label="氏名"
            name="names"
            rows={10}
            value={values.names}
            error={errors.names}
            hint={`1 行に 1 人。一度に${MAX_BATCH_USERS}人まで。名簿の列をそのまま貼り付けられます。`}
            autocomplete="off"
          />
          <div class="bulk-preview" data-bulk-preview aria-live="polite">
            <p class="muted small">接頭辞と氏名を入れると、作るユーザー名がここに出ます。</p>
          </div>
          <div class="form-actions">
            <Button href="/admin" variant="ghost">
              キャンセル
            </Button>
            <Button type="submit" variant="primary">
              作成する
            </Button>
          </div>
        </form>
      </Card>
    </div>
  </AdminShell>
)

const BackToBatches = () => (
  <a href="/admin/batches" class="back-link">
    <Icon name="chevronLeft" size={16} />
    一括作成の履歴
  </a>
)

export type BatchRow = {
  id: number
  kind: UserBatchKind
  role: ManagedRole
  prefix: string
  count: number
  createdAt: number
  adminName: string | null
  courseTitle: string | null
}

export const BatchesPage = ({ list }: { list: BatchRow[] }) => (
  <AdminShell tab="users">
    <Styles use={['/src/features/admin/admin.css']} />
    <div class="stack">
      <BackToUsers />
      <p class="muted small">
        パスワードは残していません。ダウンロードの期限が過ぎたあとにカードを配り直すときは、記録を開いて、選んだ人のパスワードを再発行してください。
      </p>
      {list.length === 0 ? (
        <EmptyState icon="userGroup" title="まだ記録がありません" text="ユーザーを一括作成すると、ここに記録が残ります。" />
      ) : (
        <Table
          columns={[
            { label: '記録' },
            { label: '人数', class: 'num' },
            { label: 'コース', class: 'hide-sm' },
            { label: '作成者', class: 'hide-sm' },
          ]}
        >
          {list.map((b) => (
            <tr>
              <td>
                <a href={`/admin/batches/${b.id}`} class="strong">
                  {USER_BATCH_KIND_LABELS[b.kind]}
                </a>
                <div class="muted small">
                  {formatDateTime(b.createdAt)}・{ROLE_LABELS[b.role]}・接頭辞 {b.prefix}
                </div>
              </td>
              <td class="num">{b.count}</td>
              <td class="hide-sm muted">
                <span class="wrap">{b.courseTitle ?? 'なし'}</span>
              </td>
              <td class="hide-sm muted">{b.adminName ?? '削除されたユーザー'}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  </AdminShell>
)

export type BatchDetail = BatchRow & { members: { id: number; name: string; username: string | null; role: Role }[] }

const BatchDownloads = ({ id, expiresAt }: { id: number; expiresAt: number | null }) =>
  expiresAt === null ? (
    <Alert tone="info">
      ダウンロードの期限（作ってから {BATCH_FILE_TTL / 60}{' '}
      分）が過ぎたため、パスワードの入ったファイルは消えました。配り直すときは、下で人を選んでパスワードを再発行してください。
    </Alert>
  ) : (
    <div class="stack">
      <Alert tone="warning">
        {formatDateTime(expiresAt)} までダウンロードできます。過ぎるとファイルは消え、同じパスワードでは作り直せません。
      </Alert>
      <div class="row bulk-downloads">
        {BATCH_FILE_FORMATS.map((format) => (
          <Button href={`/admin/batches/${id}/files/${format}`} icon="download" data-reload data-no-prefetch>
            {BATCH_FILE_LABELS[format]}
          </Button>
        ))}
      </div>
    </div>
  )

export const BatchPage = ({ batch, expiresAt }: { batch: BatchDetail; expiresAt: number | null }) => {
  const removed = batch.count - batch.members.length
  return (
    <AdminShell tab="users">
      <Styles use={['/src/features/admin/admin.css']} />
      <div class="stack">
        <BackToBatches />
        <Card
          heading={`${USER_BATCH_KIND_LABELS[batch.kind]}（${batch.count}人）`}
          description={`${formatDateTime(batch.createdAt)}・${batch.adminName ?? '削除されたユーザー'}・${ROLE_LABELS[batch.role]}・接頭辞 ${batch.prefix}${batch.courseTitle ? `・${batch.courseTitle} に登録` : ''}`}
        >
          <BatchDownloads id={batch.id} expiresAt={expiresAt} />
        </Card>

        <form
          method="post"
          action={`/admin/batches/${batch.id}/reissue`}
          class="stack"
          data-loading-form
          data-confirm="選んだ人のパスワードを再発行しますか？今のパスワードは使えなくなり、すべての端末でログアウトされます。"
          data-confirm-ok="再発行する"
          {...validateWith('reissuePasswords')}
        >
          <Block
            heading="ユーザー"
            count={batch.members.length}
            actions={
              <Button type="submit" icon="arrowPath" disabled={batch.members.length === 0}>
                パスワードを再発行
              </Button>
            }
          >
            {removed > 0 && <p class="muted small">削除したユーザー {removed} 人は出していません。</p>}
            {batch.members.length === 0 ? (
              <EmptyState icon="users" title="ユーザーがいません" text="この記録のユーザーはすべて削除されています。" />
            ) : (
              <Table
                columns={[
                  {
                    label: (
                      <label class="bulk-member">
                        <input type="checkbox" class="bulk-check" data-check-all="users" />
                        氏名（すべて選ぶ）
                      </label>
                    ),
                  },
                  { label: 'ユーザー名' },
                ]}
              >
                {batch.members.map((m) => (
                  <tr>
                    <td>
                      <label class="bulk-member">
                        <input type="checkbox" name="users" value={String(m.id)} class="bulk-check" disabled={m.role !== batch.role} />
                        <span>
                          {m.name}
                          {m.role !== batch.role && <span class="muted small">（{ROLE_LABELS[m.role]}に変わったため選べません）</span>}
                        </span>
                      </label>
                    </td>
                    <td class="muted">{m.username}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Block>
        </form>
      </div>
    </AdminShell>
  )
}

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

// ---------------------------------------------------------------- コーディングエージェント

export const AgentsPage = ({ list, moodleAdminUrl }: { list: AgentItemRow[]; moodleAdminUrl?: string }) => (
  <AdminShell tab="agents" moodleAdminUrl={moodleAdminUrl}>
    <p class="muted small">
      教師が追加したコーディングエージェントのアイテムです。アイテムの編集画面で API キーを入れると、学生が VS Code で使えるようになります。
    </p>
    {list.length === 0 ? (
      <EmptyState
        icon="cpuChip"
        title="まだアイテムがありません"
        text="教師がコースに「コーディングエージェント」のアイテムを追加すると、ここに並びます。"
      />
    ) : (
      <Table
        columns={[
          { label: 'アイテム' },
          { label: '状態' },
          { label: '使える期間', class: 'hide-sm' },
          { label: '使った額', class: 'hide-sm num' },
          { label: '操作', srOnly: true },
        ]}
      >
        {list.map((row) => (
          <tr>
            <td>
              <span class="strong">{row.title}</span>
              <span class="muted small wrap"> {row.courseTitle}</span>
            </td>
            <td>
              {row.configured ? <Chip tone="success">有効</Chip> : <Chip>キー未設定</Chip>}
              <span class="muted small wrap"> {row.model}</span>
            </td>
            <td class="hide-sm muted">
              {row.opensAt !== null && row.closesAt !== null
                ? `${formatDateTime(row.opensAt)} 〜 ${formatDateTime(row.closesAt)}`
                : '未設定'}
            </td>
            <td class="hide-sm muted num">
              {formatUsd(row.spent)} / {formatUsd(row.totalLimit)}
            </td>
            <td>
              <div class="row-actions">
                <IconButton
                  href={`/courses/${row.courseId}/items/${row.itemId}/edit`}
                  icon="pencil"
                  label={`「${row.title}」の API キーを設定`}
                  title="API キーを設定"
                />
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
    <Styles use={['/src/features/admin/admin.css']} />
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
                    <span class="muted">利用者なし（コーディング問題の採点・削除されたユーザー）</span>
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
      <Styles use={['/src/features/admin/admin.css']} />
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
