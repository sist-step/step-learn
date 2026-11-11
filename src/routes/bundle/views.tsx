import { Button } from '../../components/button'
import { Card, Stat, Stats, Table } from '../../components/card'
import { cx } from '../../components/cx'
import type { IconName } from '../../components/icons'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import {
  Alert,
  Avatar,
  Breadcrumbs,
  Chip,
  EmptyState,
  PageHeader,
  Person,
  TabPanel,
  Tabs,
  formatDateTime,
  userMeta,
} from '../../components/ui'
import { bundleBase } from '../../lib/bundle'
import type { SyncStudentRow, SyncVersion } from '../../lib/bundle-sync'
import { formatBytes } from '../../lib/bytes'
import type { Student } from '../../lib/code-store'
import type { CourseAccess } from '../../lib/courses'
import { diffHunks, type DiffLine } from '../../lib/diff'

type BundleTarget = { id: number; title: string }

/** 変更履歴の画面の、ファイルの一覧の 1 行。latestId はいちばん新しい記録、deleted はその記録でファイルが消されているか */
export type SyncFileRow = { path: string; versions: number; deleted: boolean; latestId: number }

type HistoryQuery = { v?: number; full?: boolean }

export function historyUrl(courseId: number, itemId: number, userId?: number, { v, full }: HistoryQuery = {}) {
  const query = new URLSearchParams({ ...(v && { v: String(v) }), ...(full && { view: 'full' }) }).toString()
  return `${bundleBase(courseId, itemId)}/history${userId ? `/${userId}` : ''}${query ? `?${query}` : ''}`
}

// formatDateTime を使わないのは、同じ 1 分のあいだに何度も保存され、秒まで出さないと記録を見分けられないため
const formatStamp = (unix: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(unix * 1000))

const crumbs = (access: CourseAccess, item: BundleTarget, itemUrl: string, student?: Student) => [
  { href: '/courses', label: 'コース一覧' },
  { href: `/courses/${access.course.id}`, label: access.course.title },
  { href: itemUrl, label: item.title },
  ...(student && access.canManage ? [{ href: historyUrl(access.course.id, item.id), label: '変更履歴' }] : []),
]

const LineStats = ({ version }: { version: Pick<SyncVersion, 'deleted' | 'added' | 'removed'> }) =>
  version.deleted ? (
    <span class="sync-stats is-remove">削除</span>
  ) : (
    <span class="sync-stats">
      <span class="is-add">+{version.added}</span> <span class="is-remove">−{version.removed}</span>
    </span>
  )

export const SyncStudentsPage = ({
  access,
  item,
  itemUrl,
  enabled,
  rows,
}: {
  access: CourseAccess
  item: BundleTarget
  /** アイテムの画面（戻る先） */
  itemUrl: string
  enabled: boolean
  rows: SyncStudentRow[]
}) => {
  const synced = rows.filter((r) => r.versions)
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/bundle/bundle.css']} />
      <Breadcrumbs items={crumbs(access, item, itemUrl)} />
      <PageHeader
        title="変更履歴"
        description="学生が VS Code でファイルを保存するたびに、その内容を学生ごとに記録しています。"
        actions={
          <Button href={itemUrl} variant="ghost" icon="chevronLeft">
            アイテムへ戻る
          </Button>
        }
      />
      {!enabled && <Alert tone="info">データの同期は止まっています。これまでに記録した変更履歴だけを表示しています。</Alert>}
      <Stats compact>
        <Stat label="記録がある人" value={`${synced.length}/${rows.length}`} />
        <Stat label="記録" value={String(synced.reduce((sum, r) => sum + r.versions, 0))} />
      </Stats>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="まだ記録がありません" text="学生が VS Code でファイルを保存すると、ここに並びます。" />
      ) : (
        <Table
          columns={[
            { label: '学生' },
            { label: '記録', class: 'col-sync' },
            { label: '最後の保存', class: 'hide-sm col-sync' },
            { label: '操作', class: 'hide-sm', srOnly: true },
          ]}
        >
          {rows.map(({ student, versions, lastAt }) => (
            <tr>
              <td>
                <Person
                  avatar={<Avatar name={student.name} />}
                  name={student.name}
                  meta={userMeta(student)}
                  href={versions ? historyUrl(access.course.id, item.id, student.id) : undefined}
                />
              </td>
              <td class="col-sync">{versions ? `${versions} 件` : <span class="muted">なし</span>}</td>
              <td class="hide-sm col-sync">{lastAt !== null && formatDateTime(lastAt)}</td>
              <td class="hide-sm col-open">
                {versions > 0 && (
                  <Button href={historyUrl(access.course.id, item.id, student.id)} size="sm" iconEnd="chevronRight">
                    開く
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </AppShell>
  )
}

const SIGNS: Record<DiffLine['kind'], string> = { same: '', add: '+', remove: '−' }

const DiffTable = ({ hunks }: { hunks: DiffLine[][] }) => (
  <div class="sync-code">
    <table class="sync-diff">
      {hunks.map((hunk, i) => (
        <tbody>
          {i > 0 && (
            <tr class="sync-gap">
              <td colspan={4}>⋯</td>
            </tr>
          )}
          {hunk.map((line) => (
            <tr class={cx(line.kind === 'add' && 'is-add', line.kind === 'remove' && 'is-remove')}>
              <td class="sync-no">{line.before}</td>
              <td class="sync-no">{line.after}</td>
              <td class="sync-sign">{SIGNS[line.kind]}</td>
              <td class="sync-text">{line.text}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  </div>
)

const StepButton = ({ label, href, ...icons }: { label: string; href?: string; icon?: IconName; iconEnd?: IconName }) => {
  const text = <span class="hide-sm">{label}</span>
  return href ? (
    <Button href={href} size="sm" aria-label={label} {...icons}>
      {text}
    </Button>
  ) : (
    <Button size="sm" aria-label={label} disabled {...icons}>
      {text}
    </Button>
  )
}

export const SyncHistoryPage = ({
  access,
  item,
  itemUrl,
  student,
  files,
  timeline,
  version,
  lines,
  full,
  fromDistributed,
}: {
  access: CourseAccess
  item: BundleTarget
  itemUrl: string
  student: Student
  files: SyncFileRow[]
  /** 選んだファイルの記録（新しい順） */
  timeline: SyncVersion[]
  version: SyncVersion
  /** 1 つ前の記録（なければ配ったファイル）との差分 */
  lines: DiffLine[]
  /** 差分ではなく、この記録の時点のファイル全体を出す */
  full: boolean
  /** 1 つ前の記録がなく、配ったファイルと比べたか */
  fromDistributed: boolean
}) => {
  const courseId = access.course.id
  const url = (query: HistoryQuery) => historyUrl(courseId, item.id, student.id, query)
  const index = timeline.findIndex((v) => v.id === version.id)
  const newer = timeline[index - 1]
  const older = timeline[index + 1]
  const hunks = full ? [lines.filter((l) => l.kind !== 'remove')] : diffHunks(lines)
  const total = files.reduce((sum, f) => sum + f.versions, 0)
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/bundle/bundle.css']} />
      <Breadcrumbs items={crumbs(access, item, itemUrl, student)} />
      <PageHeader
        title={`${student.name} さんの変更履歴`}
        description={`${files.length} 個のファイル・${total} 件の記録`}
        actions={
          access.canManage ? (
            <Button href={historyUrl(courseId, item.id)} variant="ghost" icon="chevronLeft">
              変更履歴の一覧
            </Button>
          ) : (
            <Button href={itemUrl} variant="ghost" icon="chevronLeft">
              アイテムへ戻る
            </Button>
          )
        }
      />
      <div class="sync-history">
        <div class="sync-history-main stack">
          <div class="sync-history-bar">
            <Tabs
              label="表示"
              items={[
                { href: url({ v: version.id }), label: '変更したところ', active: !full },
                { href: url({ v: version.id, full: true }), label: 'ファイル全体', active: full },
              ]}
            />
            <span class="row">
              <StepButton label="前の記録" icon="chevronLeft" href={older && url({ v: older.id, full })} />
              <StepButton label="次の記録" iconEnd="chevronRight" href={newer && url({ v: newer.id, full })} />
            </span>
          </div>
          <TabPanel>
            <Card
              heading={<span class="sync-path">{version.path}</span>}
              description={
                <>
                  {formatStamp(version.createdAt)} に保存（{timeline.length} 件のうち {timeline.length - index} 件目）
                  {!version.deleted && `・${formatBytes(version.size)}`}
                </>
              }
              actions={<LineStats version={version} />}
            >
              <div class="stack">
                {!!version.deleted && <Alert tone="info">このときに、ファイルが削除されました。</Alert>}
                {hunks.some((h) => h.length) ? (
                  <DiffTable hunks={hunks} />
                ) : (
                  <p class="muted">{full ? 'ファイルは空です。' : '行の内容に違いはありません（改行の種類などが変わりました）。'}</p>
                )}
                {!full && (
                  <p class="muted small">
                    {fromDistributed
                      ? 'このファイルの最初の記録です。配ったファイル（配っていないファイルなら空）との違いを表示しています。'
                      : '1 つ前の記録との違いを表示しています。'}
                  </p>
                )}
              </div>
            </Card>
          </TabPanel>
        </div>

        <aside class="sync-history-side stack">
          <Card heading="ファイル" description={`${files.length} 個`}>
            <ul class="sync-list">
              {files.map((f) => (
                <li>
                  <a
                    href={url({ v: f.latestId })}
                    class={f.path === version.path ? 'active' : undefined}
                    aria-current={f.path === version.path ? 'true' : undefined}
                  >
                    <span class="sync-path truncate">{f.path}</span>
                    {f.deleted && <Chip>削除</Chip>}
                    <span class="muted small">{f.versions} 件</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <Card heading="記録" description={`${version.path}・${timeline.length} 件`}>
            <ul class="sync-list sync-timeline">
              {timeline.map((v) => (
                <li>
                  <a
                    href={url({ v: v.id, full })}
                    class={v.id === version.id ? 'active' : undefined}
                    aria-current={v.id === version.id ? 'true' : undefined}
                  >
                    <span>{formatStamp(v.createdAt)}</span>
                    <LineStats version={v} />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </AppShell>
  )
}
