import { Button } from '../../components/button'
import { Card, Stat, Stats, Table } from '../../components/card'
import { CodeBarActions, CodeWorkspace, VerdictList, verdictSummary, type SubmissionsView } from './components/code'
import { CompletionStatus, ItemBar } from '../../components/course'
import { Icon } from '../../components/icons'
import { TextAreaField, validateWith } from '../../components/form'
import { AppShell } from '../../components/layout'
import { ConfirmChip } from '../../components/overlay'
import { Styles } from '../../components/style'
import {
  Alert,
  Avatar,
  Breadcrumbs,
  Chip,
  EmptyState,
  PageHeader,
  Person,
  Progress,
  TabPanel,
  Tabs,
  formatDateTime,
  userMeta,
} from '../../components/ui'
import {
  CODE_FILES,
  GRADING_STATUS_LABELS,
  appealStateOf,
  buildWebDocument,
  isCleared,
  type CodeLanguage,
  type Goal,
  type GradingStatus,
} from './code'
import type { Student, StudentRow, Submission, SubmissionSummary } from './code-store'
import type { CourseAccess } from '../../lib/courses'
import type { RunResult } from './sandbox'
import type { Completion } from '../../lib/types'

type CodeTarget = { id: number; title: string; language: CodeLanguage }

export const submissionsUrl = (courseId: number, itemId: number, userId?: number, submissionId?: number) =>
  `/courses/${courseId}/items/${itemId}/code/submissions${userId ? `/${userId}` : ''}${submissionId ? `?submission=${submissionId}` : ''}`

const crumbs = (access: CourseAccess, item: CodeTarget, pageUrl: string, student?: Student) => [
  { href: '/courses', label: 'コース一覧' },
  { href: `/courses/${access.course.id}`, label: access.course.title },
  { href: pageUrl, label: item.title },
  ...(student ? [{ href: submissionsUrl(access.course.id, item.id), label: '提出' }] : []),
]

/**
 * ブラウザエディターの画面。アイテムの画面の「ブラウザエディターで開く」から開く。ヘッダーの下いっぱいに、VS Code の画面（CodeVscodePage）を iframe で開く。
 * VS Code をこの画面に直接置かないのは、VS Code は 1 つのページで 1 回しか起動できず、再読み込みなしの遷移でほかの画面へ移って戻ったときに、起動し直せないため
 */
export const CodePage = ({
  access,
  item,
  itemUrl,
  submissions,
}: {
  access: CourseAccess
  item: CodeTarget
  /** アイテムの画面（戻る先） */
  itemUrl: string
  /** 見ている学生の提出 */
  submissions: SubmissionsView | null
}) => {
  const base = `/courses/${access.course.id}/items/${item.id}/code`
  return (
    <AppShell
      tone={access.course.color}
      topbar={
        <ItemBar
          type="code"
          crumbs={[
            { href: '/courses', label: 'コース一覧' },
            { href: `/courses/${access.course.id}`, label: access.course.title },
            { href: itemUrl, label: item.title },
          ]}
          title="ブラウザエディター"
        >
          {access.canManage && (
            <Button href={`${itemUrl}/edit`} variant="ghost" size="sm" icon="pencil" aria-label="編集">
              <span class="hide-sm">編集</span>
            </Button>
          )}
          <CodeBarActions base={base} canManage={access.canManage} submissions={submissions} />
        </ItemBar>
      }
    >
      <Styles use={['/src/features/code/code.css']} />
      <iframe class="code-frame" title="VS Code" src={`${base}/vscode`} data-code-vscode-frame data-ai-watch={`item:${item.id}`} />
    </AppShell>
  )
}

/**
 * ブラウザエディターの画面（CodePage）に iframe で埋め込む VS Code の画面。リンクとフォームは親の画面で開く（renderer の baseTarget）。
 * iframe の中で遷移させないのは、VS Code が消え、起動し直すまで書けなくなるため
 */
export const CodeVscodePage = ({
  base,
  item,
  body,
  goals,
  canRun,
  submissions,
  completion,
}: {
  base: string
  item: CodeTarget
  body: string
  /** 学生に見せるクリアの条件（制約のラベル） */
  goals: Goal[]
  canRun: boolean
  /** 見ている学生の提出 */
  submissions: SubmissionsView | null
  /** 見ている学生の完了の状態。完了を数えないときは渡さない */
  completion?: { completion: Completion; done: boolean }
}) => (
  <>
    <CodeWorkspace
      itemId={item.id}
      title={item.title}
      base={base}
      language={item.language}
      body={body}
      goals={goals}
      canRun={canRun}
      submissions={submissions}
      completion={completion && <CompletionStatus itemId={item.id} type="code" {...completion} />}
    />
    <ConfirmChip />
  </>
)

const StatusChip = ({ status }: { status: GradingStatus }) =>
  status === 'pending' ? (
    <Chip tone="accent">{GRADING_STATUS_LABELS.pending}</Chip>
  ) : status === 'failed' ? (
    <Chip>{GRADING_STATUS_LABELS.failed}</Chip>
  ) : null

/** 提出 1 つの判定のまとめ。すべてできていれば「クリア」、判定がなければ「—」 */
const Cleared = ({ submission }: { submission: SubmissionSummary }) => {
  const summary = submission.status === 'graded' ? verdictSummary(submission.verdicts) : null
  if (!summary) return <span class="muted">—</span>
  return isCleared(submission.verdicts) ? (
    <Chip tone="success" icon="check">
      {summary}
    </Chip>
  ) : (
    <span class="score">{summary}</span>
  )
}

export const SUBMISSION_FILTERS = ['all', 'unsubmitted', 'uncleared', 'appeal', 'review'] as const

/**
 * 提出の一覧の絞り込み。uncleared は提出したがまだクリアしていない学生、appeal は判定の確認を頼んでいる学生、
 * review はいちばん新しい提出に、AI の判定が割れて教師に確かめてほしい制約がある学生
 */
export type SubmissionFilter = (typeof SUBMISSION_FILTERS)[number]

const FILTER_LABELS: Record<SubmissionFilter, string> = {
  all: 'すべて',
  unsubmitted: '未提出',
  uncleared: '未クリア',
  appeal: '確認の依頼',
  review: '要確認',
}

const FILTER_EMPTY: Record<SubmissionFilter, { title: string; text: string }> = {
  all: { title: 'まだ提出がありません', text: '学生が提出すると、ここに並びます。' },
  unsubmitted: { title: '未提出の学生はいません', text: '全員が提出しています。' },
  uncleared: { title: '未クリアの学生はいません', text: '提出した学生は、全員クリアしています。' },
  appeal: { title: '確認の依頼はありません', text: '学生が判定の確認を頼むと、ここに並びます。' },
  review: { title: '確かめる判定はありません', text: 'AI の判定が割れた制約があると、ここに並びます。' },
}

/** AI の判定が割れて、教師に確かめてほしい制約がある提出 */
export const needsReview = (s: Pick<SubmissionSummary, 'status' | 'verdicts'>) =>
  s.status === 'graded' && !!s.verdicts?.some((v) => v.review)

/** 制約 1 つの状況。passed はいちばん新しい提出でできている学生の数、judged はその制約を判定した提出のある学生の数 */
export type ConstraintStat = { label: string; optional: boolean; passed: number; judged: number }

/** 学生の数。絞り込む前の全員から数える */
type SubmissionCounts = {
  students: number
  submitted: number
  cleared: number
  unsubmitted: number
  uncleared: number
  appeal: number
  review: number
}

export const SubmissionsPage = ({
  access,
  item,
  pageUrl,
  rows,
  counts,
  filter,
  stats,
  live,
  gradingEnabled,
}: {
  access: CourseAccess
  item: CodeTarget
  /** エディターのある画面（戻る先） */
  pageUrl: string
  /** filter で絞り込んだ学生 */
  rows: StudentRow[]
  counts: SubmissionCounts
  filter: SubmissionFilter
  stats: ConstraintStat[]
  /** 一覧が変わったかを確かめる先と、描いた時点の値。変わると client.ts が画面を取り直す */
  live: { url: string; revision: string }
  gradingEnabled: boolean
}) => {
  const base = submissionsUrl(access.course.id, item.id)
  const judged = Math.max(0, ...stats.map((s) => s.judged))
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/features/code/code.css']} />
      <span hidden data-live={live.url} data-live-rev={live.revision} />
      <Breadcrumbs items={crumbs(access, item, pageUrl)} />
      <PageHeader
        title="提出"
        description="学生ごとに、いちばん新しい提出を表示しています。新しい提出や判定は、開いたままでも反映されます。"
        actions={
          <>
            {gradingEnabled && counts.submitted > 0 && (
              <form
                method="post"
                action={`${base}/regrade`}
                data-confirm="学生ごとのいちばん新しい提出を、AI に判定し直させますか？ 教師が判定を変えた提出は、そのままにします。"
                data-confirm-ok="判定し直す"
                data-loading-form
              >
                <Button type="submit" icon="arrowPath">
                  まとめて判定し直す
                </Button>
              </form>
            )}
            <Button href={pageUrl} variant="ghost" icon="chevronLeft">
              アイテムへ戻る
            </Button>
          </>
        }
      />
      <Stats compact>
        <Stat label="提出" value={`${counts.submitted}/${counts.students}`} />
        <Stat label="クリア" value={`${counts.cleared}/${counts.students}`} />
      </Stats>
      {stats.length > 0 && judged > 0 && (
        <Card
          heading="制約ごとの状況"
          description="いちばん新しい提出で「できている」と判定された学生の数です。"
          class="constraint-stats-card"
        >
          <ul class="constraint-stats">
            {stats.map((s) => (
              <li>
                <span class="constraint-stat-label">
                  {s.label}
                  {s.optional && <Chip>発展</Chip>}
                </span>
                <Progress done={s.passed} total={s.judged} label={false} />
                <span class="constraint-stat-count">
                  {s.passed} / {s.judged} 人
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Tabs
        label="絞り込み"
        items={SUBMISSION_FILTERS.map((f) => ({
          href: f === 'all' ? base : `${base}?show=${f}`,
          label: f === 'all' ? FILTER_LABELS[f] : `${FILTER_LABELS[f]} ${counts[f]}`,
          active: f === filter,
        }))}
      />
      <TabPanel>
        <SubmissionRows access={access} item={item} rows={rows} filter={filter} />
      </TabPanel>
    </AppShell>
  )
}

const SubmissionRows = ({
  access,
  item,
  rows,
  filter,
}: {
  access: CourseAccess
  item: CodeTarget
  rows: StudentRow[]
  filter: SubmissionFilter
}) => (
  <>
    {rows.length === 0 ? (
      <EmptyState icon="users" {...FILTER_EMPTY[filter]} />
    ) : (
      <Table
        columns={[
          { label: '学生' },
          { label: '提出', class: 'hide-sm col-submitted' },
          { label: '判定', class: 'col-score' },
          { label: '操作', class: 'hide-sm', srOnly: true },
        ]}
      >
        {rows.map(({ student, count, latest, cleared, appealed }) => (
          <tr>
            <td>
              <Person
                avatar={<Avatar name={student.name} />}
                name={student.name}
                meta={userMeta(student)}
                href={latest ? submissionsUrl(access.course.id, item.id, student.id) : undefined}
              />
            </td>
            <td class="hide-sm col-submitted">
              {latest && (
                <>
                  {formatDateTime(latest.createdAt)}
                  {count > 1 && <span class="muted small">（{count} 回目）</span>}
                </>
              )}
            </td>
            <td class="col-score">
              {latest ? (
                <>
                  <Cleared submission={latest} /> <StatusChip status={latest.status} />
                  {cleared && !(latest.status === 'graded' && isCleared(latest.verdicts)) && (
                    <Chip tone="success" icon="check" title="前の提出でクリアしています">
                      クリア済み
                    </Chip>
                  )}
                  {appealed !== null && (
                    <a href={submissionsUrl(access.course.id, item.id, student.id, appealed)} class="appeal-link">
                      <Chip tone="accent" icon="flag">
                        確認の依頼
                      </Chip>
                    </a>
                  )}
                  {needsReview(latest) && (
                    <a href={submissionsUrl(access.course.id, item.id, student.id, latest.id)} class="appeal-link">
                      <Chip icon="eye" title="AI の判定が割れた制約があります">
                        要確認
                      </Chip>
                    </a>
                  )}
                </>
              ) : (
                <span class="muted">未提出</span>
              )}
            </td>
            <td class="hide-sm col-open">
              {latest && (
                <Button href={submissionsUrl(access.course.id, item.id, student.id)} size="sm" iconEnd="chevronRight">
                  開く
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </>
)

const RUN_STATUS_LABELS: Record<RunResult['status'], string> = {
  exited: '終了',
  timeout: '時間切れで停止',
  output_limit: '出力が多すぎて停止',
  killed: '強制終了',
}

export const SubmissionPage = ({
  access,
  item,
  pageUrl,
  student,
  submission,
  history,
  gradingEnabled,
}: {
  access: CourseAccess
  item: CodeTarget
  pageUrl: string
  student: Student
  submission: Submission
  history: SubmissionSummary[]
  gradingEnabled: boolean
}) => {
  const base = submissionsUrl(access.course.id, item.id, student.id)
  const { output } = submission
  const appeal = appealStateOf(submission)
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/features/code/code.css']} />
      <Breadcrumbs items={crumbs(access, item, pageUrl, student)} />
      <PageHeader
        title={`${student.name} さんの提出`}
        description={`${formatDateTime(submission.createdAt)} に提出${history.length > 1 ? `（${history.length} 回のうち ${history.length - history.findIndex((h) => h.id === submission.id)} 回目）` : ''}`}
        actions={
          <Button href={submissionsUrl(access.course.id, item.id)} variant="ghost" icon="chevronLeft">
            提出の一覧
          </Button>
        }
      />
      <div class="submission">
        <div class="submission-main stack">
          {item.language === 'web' && (
            <Card heading="プレビュー">
              {/* allow-same-origin を付けないのは、学生のコードが教師の権限で STEP Learn を操作できるようになるため */}
              <iframe class="submission-preview" title="プレビュー" sandbox="allow-scripts" srcdoc={buildWebDocument(submission.files)} />
            </Card>
          )}
          {CODE_FILES[item.language].map((f) => (
            <Card heading={f.name}>
              {submission.files[f.key] ? <pre class="submission-code">{submission.files[f.key]}</pre> : <p class="muted">空です。</p>}
            </Card>
          ))}
          {item.language === 'python' && (
            <Card
              heading="採点のときの実行結果"
              description={
                output
                  ? `${RUN_STATUS_LABELS[output.status]}${output.exitCode === null ? '' : `（終了コード ${output.exitCode}）`}`
                  : undefined
              }
            >
              {output ? (
                <div class="stack">
                  {output.stdout && <pre class="submission-code">{output.stdout}</pre>}
                  {output.stderr && <pre class="submission-code is-error">{output.stderr}</pre>}
                  {!output.stdout && !output.stderr && <p class="muted">出力はありませんでした。</p>}
                </div>
              ) : (
                <p class="muted">実行した結果はありません。</p>
              )}
            </Card>
          )}
        </div>

        <aside class="submission-side stack">
          <Card
            heading="AI の判定"
            actions={
              gradingEnabled &&
              submission.status !== 'pending' && (
                <form method="post" action={`${base}/regrade`} data-loading-form>
                  <input type="hidden" name="submission" value={submission.id} />
                  <Button type="submit" size="sm" icon="arrowPath">
                    {submission.status === 'none' ? '判定する' : '判定し直す'}
                  </Button>
                </form>
              )
            }
          >
            {submission.status === 'graded' ? (
              <div class="stack">
                {appeal === 'open' && (
                  <Alert tone="info">
                    学生が、この判定の確認を頼んでいます。判定を変えて保存するか、このままでよければ「確認済みにする」を押してください。
                  </Alert>
                )}
                {submission.verdicts?.length ? (
                  <form method="post" action={`${base}/verdicts`} class="stack" data-loading-form>
                    <input type="hidden" name="submission" value={submission.id} />
                    <p class="submission-score">
                      <Cleared submission={submission} />
                    </p>
                    <VerdictList verdicts={submission.verdicts} showText editable />
                    <p class="muted small">
                      AI の判定が違っていたら、制約ごとに「○ できている・△ 一部できている・×
                      できていない」を選び直して保存します。変えた判定は、学生の画面に「教師が変更」と出ます。
                    </p>
                    <div class="form-actions">
                      <Button type="submit" variant="primary">
                        判定を保存
                      </Button>
                    </div>
                  </form>
                ) : null}
                {appeal === 'open' && (
                  <form method="post" action={`${base}/appeal/close`} data-loading-form>
                    <input type="hidden" name="submission" value={submission.id} />
                    <Button type="submit" size="sm" icon="check">
                      確認済みにする
                    </Button>
                  </form>
                )}
                {submission.feedback && <p class="submission-note">{submission.feedback}</p>}
              </div>
            ) : submission.status === 'pending' ? (
              <p class="muted">判定しています。少し待ってから、ページを読み込み直してください。</p>
            ) : submission.status === 'failed' ? (
              <Alert tone="warning">AI で判定できませんでした。</Alert>
            ) : (
              <p class="muted">{gradingEnabled ? 'AI はまだ判定していません。' : 'AI が設定されていないため、判定していません。'}</p>
            )}
          </Card>

          <Card
            as="form"
            method="post"
            action={`${base}/review`}
            class="stack"
            heading="教師のコメント"
            description="学生の結果の画面に、AI の講評と並べて表示されます。"
            data-loading-form
            {...validateWith('codeReview')}
          >
            <input type="hidden" name="submission" value={submission.id} />
            <TextAreaField label="学生へのコメント" name="comment" rows={4} value={submission.teacherComment} />
            <div class="form-actions">
              <Button type="submit" variant="primary">
                保存
              </Button>
            </div>
          </Card>

          {history.length > 1 && (
            <Card heading="提出の履歴">
              <ul class="submission-history">
                {history.map((h, i) => (
                  <li>
                    <a
                      href={submissionsUrl(access.course.id, item.id, student.id, h.id)}
                      class={h.id === submission.id ? 'active' : undefined}
                      aria-current={h.id === submission.id ? 'page' : undefined}
                    >
                      <span>
                        {history.length - i} 回目<span class="muted small"> {formatDateTime(h.createdAt)}</span>
                        {appealStateOf(h) === 'open' && <Icon name="flag" size={14} class="appeal-flag" aria-label="確認の依頼" />}
                      </span>
                      <Cleared submission={h} />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  )
}
