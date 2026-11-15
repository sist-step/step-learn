import { Button } from '../../components/button'
import { Block, Card, Stat, Stats, Table } from '../../components/card'
import { AppShell } from '../../components/layout'
import { QuizReview, QuizScoreChip } from '../../components/quiz'
import { Styles } from '../../components/style'
import { Avatar, Breadcrumbs, EmptyState, PageHeader, Person, formatDateTime, userMeta } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { QUIZ_KIND_LABELS, quizPercent, type QuizKind, type QuizReviewItem, type QuizScore } from '../../lib/quiz'
import type { QuizAttemptSummary, QuizStudent } from '../../lib/quiz-store'

type QuizTarget = { id: number; title: string }

/** 受験結果の一覧の 1 行。count は受験の回数、latest はいちばん新しい受験、best はいちばん点数の高い受験 */
export type ResultRow = { student: QuizStudent; count: number; latest: QuizAttemptSummary | null; best: QuizAttemptSummary | null }

/** 問題 1 つの正答率。学生ごとのいちばん新しい受験で数える */
export type QuestionStat = { kind: QuizKind; prompt: string; answered: number; correct: number }

export const resultsUrl = (courseId: number, itemId: number, userId?: number, attemptId?: number) =>
  `/courses/${courseId}/items/${itemId}/quiz/results${userId ? `/${userId}` : ''}${attemptId ? `?attempt=${attemptId}` : ''}`

const crumbs = (access: CourseAccess, item: QuizTarget, pageUrl: string, student?: QuizStudent) => [
  { href: '/courses', label: 'コース一覧' },
  { href: `/courses/${access.course.id}`, label: access.course.title },
  { href: pageUrl, label: item.title },
  ...(student ? [{ href: resultsUrl(access.course.id, item.id), label: '受験結果' }] : []),
]

const percentText = (score: QuizScore) => `${Math.round(quizPercent(score))}%`

// 一覧と履歴の見た目（.submission・.col-score など）は、コードのアイテムの提出の画面と同じものを使う
const PageStyles = () => <Styles use={['/src/routes/code/code.css', '/src/components/quiz.css']} />

export const ResultsPage = ({
  access,
  item,
  pageUrl,
  rows,
  stats,
}: {
  access: CourseAccess
  item: QuizTarget
  /** アイテムの画面（戻る先） */
  pageUrl: string
  rows: ResultRow[]
  stats: QuestionStat[]
}) => {
  const taken = rows.filter((r) => r.best)
  const passed = taken.filter((r) => r.best!.passed)
  const average = taken.length ? Math.round(taken.reduce((sum, r) => sum + quizPercent(r.best!), 0) / taken.length) : null
  return (
    <AppShell tone={access.course.color}>
      <PageStyles />
      <Breadcrumbs items={crumbs(access, item, pageUrl)} />
      <PageHeader
        title="受験結果"
        description="学生ごとに、いちばん高い点数を表示しています。"
        actions={
          <Button href={pageUrl} variant="ghost" icon="chevronLeft">
            アイテムへ戻る
          </Button>
        }
      />
      <Stats compact>
        <Stat label="受験" value={`${taken.length}/${rows.length}`} />
        <Stat label="合格" value={`${passed.length}/${rows.length}`} />
        <Stat label="最高点の平均" value={average === null ? '—' : `${average}%`} />
      </Stats>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="学生がいません" text="コースに学生が参加すると、ここに並びます。" />
      ) : (
        <Table
          columns={[
            { label: '学生' },
            { label: '最後の受験', class: 'hide-sm col-submitted' },
            { label: '最高点', class: 'col-score' },
            { label: '操作', class: 'hide-sm', srOnly: true },
          ]}
        >
          {rows.map(({ student, count, latest, best }) => (
            <tr>
              <td>
                <Person
                  avatar={<Avatar name={student.name} />}
                  name={student.name}
                  meta={userMeta(student)}
                  href={latest ? resultsUrl(access.course.id, item.id, student.id) : undefined}
                />
              </td>
              <td class="hide-sm col-submitted">
                {latest && (
                  <>
                    {formatDateTime(latest.createdAt)}
                    {count > 1 && <span class="muted small">（{count} 回）</span>}
                  </>
                )}
              </td>
              <td class="col-score">{best ? <QuizScoreChip score={best} passed={!!best.passed} /> : <span class="muted">未受験</span>}</td>
              <td class="hide-sm col-open">
                {latest && (
                  <Button href={resultsUrl(access.course.id, item.id, student.id)} size="sm" iconEnd="chevronRight">
                    開く
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {stats.length > 0 && taken.length > 0 && (
        <Block heading="問題ごとの正答率" class="quiz-stats">
          <p class="muted small">学生ごとの、いちばん新しい受験で数えています。</p>
          <Table columns={[{ label: '問題' }, { label: '正答率', class: 'col-score' }]}>
            {stats.map((s, i) => (
              <tr>
                <td>
                  <span class="quiz-stat-prompt">
                    <span class="truncate">{s.prompt}</span>
                    <span class="muted small">
                      問 {i + 1} · {QUIZ_KIND_LABELS[s.kind]}
                    </span>
                  </span>
                </td>
                <td class="col-score">
                  {s.answered > 0 ? (
                    <span class="quiz-rate">
                      <span class="quiz-rate-bar" aria-hidden="true">
                        <span style={`width: ${quizPercent({ correct: s.correct, total: s.answered })}%`} />
                      </span>
                      <span class="score">
                        {percentText({ correct: s.correct, total: s.answered })}
                        <span class="muted small">
                          （{s.correct}/{s.answered}）
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span class="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Block>
      )}
    </AppShell>
  )
}

export const ResultPage = ({
  access,
  item,
  pageUrl,
  student,
  attempt,
  history,
  review,
}: {
  access: CourseAccess
  item: QuizTarget
  pageUrl: string
  student: QuizStudent
  attempt: QuizAttemptSummary
  /** この学生の受験（新しい順） */
  history: QuizAttemptSummary[]
  review: QuizReviewItem[]
}) => (
  <AppShell tone={access.course.color}>
    <PageStyles />
    <Breadcrumbs items={crumbs(access, item, pageUrl, student)} />
    <PageHeader
      title={`${student.name} さんの受験`}
      description={`${formatDateTime(attempt.createdAt)} に受験${history.length > 1 ? `（${history.length} 回のうち ${history.length - history.findIndex((h) => h.id === attempt.id)} 回目）` : ''}`}
      actions={
        <Button href={resultsUrl(access.course.id, item.id)} variant="ghost" icon="chevronLeft">
          受験結果の一覧
        </Button>
      }
    />
    <div class="submission">
      <div class="submission-main">
        <QuizReview items={review} who="学生" />
      </div>
      <aside class="submission-side stack">
        <Card heading="点数">
          <p class="submission-score">
            <QuizScoreChip score={attempt} passed={!!attempt.passed} />
            <span class="muted small">{percentText(attempt)}</span>
          </p>
        </Card>
        {history.length > 1 && (
          <Card heading="受験の履歴">
            <ul class="submission-history">
              {history.map((h, i) => (
                <li>
                  <a
                    href={resultsUrl(access.course.id, item.id, student.id, h.id)}
                    class={h.id === attempt.id ? 'active' : undefined}
                    aria-current={h.id === attempt.id ? 'page' : undefined}
                  >
                    <span>
                      {history.length - i} 回目<span class="muted small"> {formatDateTime(h.createdAt)}</span>
                    </span>
                    <QuizScoreChip score={h} passed={!!h.passed} />
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
