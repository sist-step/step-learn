import { Button } from '../../components/button'
import { Card, Stat, Stats, Table } from '../../components/card'
import { CodeBarActions, CodeWorkspace, VerdictList, verdictSummary, type SubmissionsView } from '../../components/code'
import { ItemBar } from '../../components/course'
import { TextAreaField, validateWith } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Alert, Avatar, Breadcrumbs, Chip, EmptyState, PageHeader, Person, formatDateTime, userMeta } from '../../components/ui'
import { CODE_FILES, GRADING_STATUS_LABELS, buildWebDocument, isCleared, type CodeLanguage, type GradingStatus } from '../../lib/code'
import type { Student, StudentRow, Submission, SubmissionSummary } from '../../lib/code-store'
import type { CourseAccess } from '../../lib/courses'
import type { RunResult } from '../../lib/sandbox'

type CodeTarget = { id: number; title: string; language: CodeLanguage }

export const submissionsUrl = (courseId: number, itemId: number, userId?: number, submissionId?: number) =>
  `/courses/${courseId}/items/${itemId}/code/submissions${userId ? `/${userId}` : ''}${submissionId ? `?submission=${submissionId}` : ''}`

const crumbs = (access: CourseAccess, item: CodeTarget, pageUrl: string, student?: Student) => [
  { href: '/courses', label: 'コース一覧' },
  { href: `/courses/${access.course.id}`, label: access.course.title },
  { href: pageUrl, label: item.title },
  ...(student ? [{ href: submissionsUrl(access.course.id, item.id), label: '提出' }] : []),
]

/** エディターだけの画面。Moodle モードのように、アイテムの画面にエディターを組み込まないときに使う */
export const CodePage = ({
  access,
  item,
  body,
  goals,
  canRun,
  submissions,
}: {
  access: CourseAccess
  item: CodeTarget
  body: string
  /** 学生に見せるクリアの条件（制約のラベル） */
  goals: string[]
  canRun: boolean
  /** 見ている学生の提出 */
  submissions: SubmissionsView | null
}) => {
  const itemUrl = `/courses/${access.course.id}/items/${item.id}`
  const base = `${itemUrl}/code`
  return (
    <AppShell
      tone={access.course.color}
      topbar={
        <ItemBar
          type="code"
          crumbs={[
            { href: '/courses', label: 'コース一覧' },
            { href: `/courses/${access.course.id}`, label: access.course.title },
          ]}
          title={item.title}
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
      <CodeWorkspace base={base} language={item.language} body={body} goals={goals} canRun={canRun} submissions={submissions} />
    </AppShell>
  )
}

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

export const SubmissionsPage = ({
  access,
  item,
  pageUrl,
  rows,
}: {
  access: CourseAccess
  item: CodeTarget
  /** エディターのある画面（戻る先） */
  pageUrl: string
  rows: StudentRow[]
}) => {
  const submitted = rows.filter((r) => r.latest)
  const cleared = submitted.filter((r) => r.latest!.status === 'graded' && isCleared(r.latest!.verdicts))
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/code/code.css']} />
      <Breadcrumbs items={crumbs(access, item, pageUrl)} />
      <PageHeader
        title="提出"
        description="学生ごとに、いちばん新しい提出を表示しています。"
        actions={
          <Button href={pageUrl} variant="ghost" icon="chevronLeft">
            アイテムへ戻る
          </Button>
        }
      />
      <Stats compact>
        <Stat label="提出" value={`${submitted.length}/${rows.length}`} />
        <Stat label="クリア" value={`${cleared.length}/${rows.length}`} />
      </Stats>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="まだ提出がありません" text="学生が提出すると、ここに並びます。" />
      ) : (
        <Table
          columns={[
            { label: '学生' },
            { label: '提出', class: 'hide-sm col-submitted' },
            { label: '判定', class: 'col-score' },
            { label: '操作', class: 'hide-sm', srOnly: true },
          ]}
        >
          {rows.map(({ student, count, latest }) => (
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
    </AppShell>
  )
}

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
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/code/code.css']} />
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
                {submission.verdicts?.length ? (
                  <>
                    <p class="submission-score">
                      <Cleared submission={submission} />
                    </p>
                    <VerdictList verdicts={submission.verdicts} showText />
                  </>
                ) : null}
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
