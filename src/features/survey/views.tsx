import { Button } from '../../components/button'
import { Block, Stat, Stats } from '../../components/card'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { Alert, Avatar, Breadcrumbs, EmptyState, PageHeader, Person, formatDateTime, userMeta } from '../../components/ui'
import type { CourseAccess } from '../../lib/courses'
import { SurveyAnswerList, SurveySummaryList } from './components/survey'
import type { SurveyAnswer, SurveyQuestionSummary, SurveySettings } from './survey'

type SurveyResponseRow = { name: string; username: string | null; answers: SurveyAnswer[]; updatedAt: number }

export const ResultsPage = ({
  access,
  item,
  pageUrl,
  settings,
  summaries,
  responses,
  total,
  students,
}: {
  access: CourseAccess
  item: { id: number; title: string }
  /** アイテムの画面（戻る先） */
  pageUrl: string
  settings: SurveySettings
  summaries: SurveyQuestionSummary[]
  /** 回答した人ごとの回答。匿名なら null */
  responses: SurveyResponseRow[] | null
  total: number
  students: number
}) => (
  <AppShell tone={access.course.color}>
    <Styles use={['/src/features/survey/components/survey.css']} />
    <Breadcrumbs
      items={[
        { href: '/courses', label: 'コース一覧' },
        { href: `/courses/${access.course.id}`, label: access.course.title },
        { href: pageUrl, label: item.title },
        { label: '結果' },
      ]}
    />
    <PageHeader
      title="アンケートの結果"
      description={item.title}
      actions={
        <>
          <Button href={pageUrl} variant="ghost" icon="chevronLeft">
            戻る
          </Button>
          <Button href={`${pageUrl}/survey/results.csv`} icon="download" data-reload data-no-prefetch>
            CSV でダウンロード
          </Button>
        </>
      }
    />
    <div class="stack">
      <Stats compact>
        <Stat label="回答" value={`${total} 人`} />
        <Stat label="学生" value={`${students} 人`} />
        <Stat label="回答率" value={students ? `${Math.round((Math.min(total, students) / students) * 100)}%` : '—'} />
      </Stats>
      {settings.anonymous === 1 && <Alert tone="info">匿名のアンケートです。だれが何と答えたかは表示しません。</Alert>}
      {settings.questions.length === 0 ? (
        <EmptyState icon="chatBubble" title="問いがまだありません" text="アイテムの編集画面で問いを作ってください。" />
      ) : total === 0 ? (
        <EmptyState icon="chartBar" title="まだ回答がありません" text="学生が回答すると、ここに集計が出ます。" />
      ) : (
        <SurveySummaryList summaries={summaries} total={total} texts />
      )}
      {responses && responses.length > 0 && (
        <Block heading="回答した人" count={responses.length}>
          <div class="sv-people">
            {responses.map((r) => (
              <details class="sv-person">
                <summary>
                  <Person avatar={<Avatar name={r.name} />} name={r.name} meta={userMeta({ username: r.username })} />
                  <span class="muted small">{formatDateTime(r.updatedAt)}</span>
                </summary>
                <SurveyAnswerList questions={settings.questions} answers={r.answers} />
              </details>
            ))}
          </div>
        </Block>
      )}
    </div>
  </AppShell>
)
