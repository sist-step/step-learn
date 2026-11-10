import { Button } from '../../components/button'
import { Card, Stat, Stats, Table } from '../../components/card'
import { TextAreaField, TextField, validateWith } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Alert, Avatar, Breadcrumbs, Chip, EmptyState, PageHeader, Person, formatDateTime, userMeta } from '../../components/ui'
import {
  CODE_FILES,
  GRADING_STATUS_LABELS,
  buildWebDocument,
  finalScore,
  type CodeFiles,
  type CodeLanguage,
  type GradingStatus,
} from '../../lib/code'
import type { CourseAccess } from '../../lib/courses'
import type { RunResult } from '../../lib/sandbox'

export type Student = { id: number; name: string; username: string | null; email: string }

/** 提出の一覧に出す項目。status は、画面に出す採点の状態（lib/code-grading.ts の gradingStatusOf） */
export type SubmissionSummary = {
  id: number
  status: GradingStatus
  score: number | null
  teacherScore: number | null
  createdAt: number
}

export type Submission = SubmissionSummary & {
  files: CodeFiles
  feedback: string
  output: RunResult | null
  teacherComment: string
}

export type StudentRow = { student: Student; count: number; latest: SubmissionSummary | null }

type CodeTarget = { id: number; title: string; language: CodeLanguage; maxScore: number }

const itemUrl = (access: CourseAccess, item: CodeTarget) => `/courses/${access.course.id}/items/${item.id}`

export const submissionsUrl = (courseId: number, itemId: number, userId?: number, submissionId?: number) =>
  `/courses/${courseId}/items/${itemId}/code/submissions${userId ? `/${userId}` : ''}${submissionId ? `?submission=${submissionId}` : ''}`

const crumbs = (access: CourseAccess, item: CodeTarget, student?: Student) => [
  { href: '/courses', label: 'コース一覧' },
  { href: `/courses/${access.course.id}`, label: access.course.title },
  { href: itemUrl(access, item), label: item.title },
  ...(student ? [{ href: submissionsUrl(access.course.id, item.id), label: '提出' }] : []),
]

const StatusChip = ({ status }: { status: GradingStatus }) =>
  status === 'pending' ? (
    <Chip tone="accent">{GRADING_STATUS_LABELS.pending}</Chip>
  ) : status === 'failed' ? (
    <Chip>{GRADING_STATUS_LABELS.failed}</Chip>
  ) : null

const Score = ({ value, max }: { value: number | null; max: number }) =>
  value === null ? (
    <span class="muted">—</span>
  ) : (
    <span class="score">
      <strong>{value}</strong>
      <span class="muted"> / {max}</span>
    </span>
  )

export const SubmissionsPage = ({ access, item, rows }: { access: CourseAccess; item: CodeTarget; rows: StudentRow[] }) => {
  const submitted = rows.filter((r) => r.latest)
  const scores = submitted.map((r) => finalScore(r.latest!)).filter((s): s is number => s !== null)
  const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
  return (
    <AppShell tone={access.course.color}>
      <Styles use={['/src/routes/code/code.css']} />
      <Breadcrumbs items={crumbs(access, item)} />
      <PageHeader
        title="提出"
        description="学生ごとに、いちばん新しい提出を表示しています。"
        actions={
          <Button href={itemUrl(access, item)} variant="ghost" icon="chevronLeft">
            アイテムへ戻る
          </Button>
        }
      />
      <Stats compact>
        <Stat label="提出" value={`${submitted.length}/${rows.length}`} />
        <Stat label="採点済み" value={String(scores.length)} />
        <Stat label="平均点" value={average === null ? '—' : String(average)} />
      </Stats>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="学生がいません" text="コースに学生を追加すると、ここに提出が並びます。" />
      ) : (
        <Table
          columns={[
            { label: '学生' },
            { label: '提出', class: 'hide-sm col-submitted' },
            { label: 'AI の点数', class: 'hide-sm col-score' },
            { label: '成績', class: 'col-score' },
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
              <td class="hide-sm col-score">
                {latest && (
                  <>
                    <Score value={latest.status === 'graded' ? latest.score : null} max={item.maxScore} />{' '}
                    <StatusChip status={latest.status} />
                  </>
                )}
              </td>
              <td class="col-score">
                {latest ? (
                  <>
                    <Score value={finalScore(latest)} max={item.maxScore} />
                    {latest.teacherScore !== null && <Chip icon="check">教師</Chip>}
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
  student,
  submission,
  history,
  gradingEnabled,
}: {
  access: CourseAccess
  item: CodeTarget
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
      <Breadcrumbs items={crumbs(access, item, student)} />
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
          <Card heading="成績">
            <p class="submission-score">
              <Score value={finalScore(submission)} max={item.maxScore} />
              {submission.teacherScore !== null ? (
                <Chip icon="check">教師が採点</Chip>
              ) : (
                submission.status === 'graded' && <Chip>AI が採点</Chip>
              )}
            </p>
          </Card>

          <Card
            heading="AI の採点"
            actions={
              gradingEnabled &&
              submission.status !== 'pending' && (
                <form method="post" action={`${base}/regrade`} data-loading-form>
                  <input type="hidden" name="submission" value={submission.id} />
                  <Button type="submit" size="sm" icon="arrowPath">
                    {submission.status === 'none' ? '採点する' : '採点し直す'}
                  </Button>
                </form>
              )
            }
          >
            {submission.status === 'graded' ? (
              <>
                <p class="submission-score">
                  <Score value={submission.score} max={item.maxScore} />
                </p>
                <p class="submission-note">{submission.feedback}</p>
              </>
            ) : submission.status === 'pending' ? (
              <p class="muted">採点しています。少し待ってから、ページを読み込み直してください。</p>
            ) : submission.status === 'failed' ? (
              <Alert tone="warning">AI で採点できませんでした。</Alert>
            ) : (
              <p class="muted">{gradingEnabled ? 'AI はまだ採点していません。' : 'AI が設定されていないため、採点していません。'}</p>
            )}
          </Card>

          <Card
            as="form"
            method="post"
            action={`${base}/review`}
            class="stack"
            heading="教師の採点"
            description="点数を入れると、AI の点数の代わりに成績になります。空にすると AI の点数に戻ります。"
            data-loading-form
            {...validateWith('codeReview')}
          >
            <input type="hidden" name="submission" value={submission.id} />
            <TextField
              label={`点数（${item.maxScore} 点満点）`}
              name="score"
              inputmode="numeric"
              value={submission.teacherScore === null ? '' : String(submission.teacherScore)}
            />
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
                      <Score value={finalScore(h)} max={item.maxScore} />
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
