import type { Child } from 'hono/jsx'
import { CreateCourseButton } from '../../components/course'
import { IconButton } from '../../components/button'
import { SearchBox, Select } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Stat, Stats, Table } from '../../components/card'
import { Avatar, EmptyState, PageHeader, Person, TabPanel, Tabs, formatDate, userMeta } from '../../components/ui'
import { ROLE_LABELS, type Role } from '../../lib/types'

type Tab = 'users' | 'courses'

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: 'users', href: '/admin', label: 'ユーザー' },
  { tab: 'courses', href: '/admin/courses', label: 'コース' },
]

const ROLE_OPTIONS = (['student', 'teacher', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

const AdminShell = ({ tab, children }: { tab: Tab; children: Child }) => (
  <AppShell>
    <PageHeader title="管理" description="ユーザーとコースをまとめて管理します。" />
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
    <Stats>
      {(['admin', 'teacher', 'student'] as Role[]).map((r) => (
        <Stat label={ROLE_LABELS[r]} value={byRole[r] ?? 0} />
      ))}
    </Stats>

    <form method="get" class="toolbar">
      <SearchBox label="ユーザーを検索" value={q} placeholder="名前・ユーザー名・メールで検索" />
    </form>

    {list.length === 0 ? (
      <EmptyState icon="users" title="ユーザーが見つかりません" text="検索条件を変えてお試しください。" />
    ) : (
      <Table columns={[{ label: 'ユーザー' }, { label: '登録日', class: 'hide-sm' }, { label: 'コース', class: 'hide-sm' }, { label: 'ロール' }]}>
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
            <td class="hide-sm muted">{u.courses}</td>
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
          { label: '学生', class: 'hide-sm' },
          { label: 'アイテム', class: 'hide-sm' },
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
            <td class="hide-sm muted">{course.teachers ?? '未設定'}</td>
            <td class="hide-sm muted">{course.students}</td>
            <td class="hide-sm muted">{course.items}</td>
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
