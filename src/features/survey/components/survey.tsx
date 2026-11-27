import type { Child } from 'hono/jsx'
import { Button, IconButton } from '../../../components/button'
import { Card } from '../../../components/card'
import { cx } from '../../../components/cx'
import { DateTimeField, FieldError, Input, SegmentedControl, Select, Textarea } from '../../../components/form'
import { Icon, type IconName } from '../../../components/icons'
import { useStyle } from '../../../components/style'
import { Alert, Chip, formatDateTime } from '../../../components/ui'
import type { FieldErrors } from '../../../lib/forms'
import {
  SCALE_POINTS,
  SURVEY_KEY_SLOT,
  SURVEY_KINDS,
  SURVEY_KIND_DESCRIPTIONS,
  SURVEY_KIND_LABELS,
  answerField,
  answerText,
  blankSurveyRow,
  type SurveyAnswer,
  type SurveyFormRow,
  type SurveyKind,
  type SurveyQuestion,
  type SurveyQuestionSummary,
  type SurveySettings,
  type SurveyView,
} from '../survey'

const KIND_ICONS: Record<SurveyKind, IconName> = {
  single: 'checkCircle',
  multiple: 'listBullet',
  scale: 'chartBar',
  text: 'pencil',
}

// ---------------------------------------------------------------- 問いの編集

const control = (k: string, key: string, errors: FieldErrors) => ({
  id: `${k}-${key}`,
  name: `${k}.${key}`,
  invalid: !!errors[`${k}.${key}`],
  'aria-describedby': `${k}-${key}-error`,
})

/** 入力欄 1 つ。エラーは client.ts が `${id}-error` に出す */
const SvField = ({
  id,
  label,
  error,
  class: cls,
  children,
}: {
  id: string
  label: string
  error?: string
  class?: string
  children: Child
}) => (
  <div class={cx('field', error && 'has-error', cls)}>
    <label for={id}>{label}</label>
    {children}
    <FieldError id={id} error={error} />
  </div>
)

function SvFields({ row, errors }: { row: SurveyFormRow; errors: FieldErrors }) {
  const { k } = row
  switch (row.kind) {
    case 'single':
    case 'multiple':
      return (
        <SvField id={`${k}-options`} label="選択肢（1 行に 1 つ）" error={errors[`${k}.options`]}>
          <Textarea {...control(k, 'options', errors)} rows={4} value={row.options} />
        </SvField>
      )
    case 'scale':
      return (
        <div class="sv-scale-fields">
          <SvField id={`${k}-points`} label="段階の数" error={errors[`${k}.points`]}>
            <Select
              compact
              {...control(k, 'points', errors)}
              options={SCALE_POINTS.map((n) => ({ value: String(n), label: `${n} 段階` }))}
              value={row.points}
            />
          </SvField>
          <SvField id={`${k}-minLabel`} label="いちばん低い段階" error={errors[`${k}.minLabel`]} class="sv-grow">
            <Input compact {...control(k, 'minLabel', errors)} value={row.minLabel} autocomplete="off" />
          </SvField>
          <SvField id={`${k}-maxLabel`} label="いちばん高い段階" error={errors[`${k}.maxLabel`]} class="sv-grow">
            <Input compact {...control(k, 'maxLabel', errors)} value={row.maxLabel} autocomplete="off" />
          </SvField>
        </div>
      )
    case 'text':
      return <p class="muted small">学生は文章で答えます。</p>
  }
}

const SvQuestion = ({ row, errors }: { row: SurveyFormRow; errors: FieldErrors }) => (
  <li class="sv-q" data-sv-question={row.kind} data-sv-key={row.k}>
    <div class="sv-q-head">
      <span class="sv-q-num" aria-hidden="true" />
      <span class="sv-q-kind">
        <Icon name={KIND_ICONS[row.kind]} size={16} />
        {SURVEY_KIND_LABELS[row.kind]}
      </span>
      <span class="sv-q-actions">
        <IconButton icon="arrowUp" label="上へ移動" data-sv-move="up" />
        <IconButton icon="arrowDown" label="下へ移動" data-sv-move="down" />
        <IconButton icon="trash" label="この問いを削除" data-sv-remove />
      </span>
    </div>
    <div class="sv-q-body stack">
      <SvField id={`${row.k}-prompt`} label="問い" error={errors[`${row.k}.prompt`]}>
        <Textarea {...control(row.k, 'prompt', errors)} rows={2} value={row.prompt} />
      </SvField>
      <SvFields row={row} errors={errors} />
      <label class="sv-required">
        <input type="checkbox" class="sv-check" name={`${row.k}.required`} checked={row.required} />
        <span class="small">必ず答えてもらう</span>
      </label>
    </div>
  </li>
)

/**
 * 編集画面の「問い」のカード。送るのは survey_questions（client.ts が問いの行から組み立てる JSON）で、
 * 問いごとの入力欄は `<問いの目印>.<項目>` の name でエラーの置き場所にだけ使う
 */
export const SurveyEditor = ({ rows, errors = {}, responses }: { rows: SurveyFormRow[]; errors?: FieldErrors; responses: number }) => {
  useStyle('/src/components/form.css', '/src/features/survey/components/survey.css')
  return (
    <Card
      class="editor-extra"
      heading="問い"
      description={
        responses > 0
          ? `すでに ${responses} 人が回答しています。問いや選択肢を書き換えると、書き換える前の回答と集計が合わなくなることがあります。`
          : '問いを足して、学生に答えてもらう内容を作ります。'
      }
    >
      <div class="sv" data-sv>
        <input type="hidden" name="survey_questions" id="f-survey_questions" value={JSON.stringify(rows)} data-sv-value />
        <ol class="sv-list" data-sv-list>
          {rows.map((row) => (
            <SvQuestion row={row} errors={errors} />
          ))}
        </ol>
        <p class="sv-empty muted small">問いはまだありません。下のボタンから、答え方を選んで足します。</p>
        <FieldError id="f-survey_questions" error={errors.survey_questions} />
        <div class="sv-add" role="group" aria-label="問いを追加">
          {SURVEY_KINDS.map((kind) => (
            <button type="button" class="sv-add-kind" data-sv-add={kind}>
              <Icon name={KIND_ICONS[kind]} size={18} />
              <span class="sv-add-text">
                <span class="strong">{SURVEY_KIND_LABELS[kind]}</span>
                <span class="muted small">{SURVEY_KIND_DESCRIPTIONS[kind]}</span>
              </span>
              <Icon name="plus" size={16} class="sv-add-plus" />
            </button>
          ))}
        </div>
        {SURVEY_KINDS.map((kind) => (
          <template data-sv-template={kind}>
            <SvQuestion row={blankSurveyRow(SURVEY_KEY_SLOT, kind)} errors={{}} />
          </template>
        ))}
      </div>
    </Card>
  )
}

const Toggle = ({
  name,
  label,
  value,
  on,
  off,
  hint,
}: {
  name: string
  label: string
  value: number
  on: string
  off: string
  hint: string
}) => (
  <fieldset class="field">
    <legend>{label}</legend>
    <SegmentedControl
      name={name}
      label={label}
      options={[
        { value: '0', label: off },
        { value: '1', label: on },
      ]}
      value={String(value)}
    />
    <p class="field-hint">{hint}</p>
  </fieldset>
)

/** 編集画面の右の列に置く「回答の設定」のカード。locked は回答があって、匿名をやめられないとき */
export const SurveySettingsCard = ({
  settings,
  opensAt,
  closesAt,
  locked,
  errors,
}: {
  settings: Pick<SurveySettings, 'anonymous' | 'showResults' | 'allowEdit'>
  /** 日時の入力欄の値 */
  opensAt: string
  closesAt: string
  locked: boolean
  errors: FieldErrors
}) => (
  <Card heading="回答の設定">
    <div class="stack">
      {locked ? (
        <fieldset class="field">
          <legend>回答した人の名前</legend>
          <input type="hidden" name="anonymous" value="1" />
          <p class="sv-locked small">
            <Icon name="lock" size={14} />
            匿名（変えられません）
          </p>
          <p class="field-hint">
            匿名で回答を集めたあとに名前を見せると、学生との約束を破ることになるため、回答があるうちは記名に戻せません。
          </p>
        </fieldset>
      ) : (
        <Toggle
          name="anonymous"
          label="回答した人の名前"
          value={settings.anonymous}
          off="先生に見せる"
          on="匿名"
          hint="匿名にすると、先生にも、だれが何と答えたかは見えません。回答が入ったあとは記名に戻せません。"
        />
      )}
      <Toggle
        name="show_results"
        label="みんなの回答の集計"
        value={settings.showResults}
        off="見せない"
        on="回答した学生に見せる"
        hint="選ぶ問いと段階の問いの集計だけを見せます。自由に書いた回答は見せません。"
      />
      <Toggle
        name="allow_edit"
        label="送った回答"
        value={settings.allowEdit}
        off="直せない"
        on="期間中は直せる"
        hint="直せるようにすると、締め切りまでは何度でも回答を送り直せます。"
      />
      <DateTimeField label="受付の開始（任意）" name="opens_at" value={opensAt} error={errors.opens_at} optional />
      <DateTimeField label="締め切り（任意）" name="closes_at" value={closesAt} error={errors.closes_at} optional />
    </div>
  </Card>
)

// ---------------------------------------------------------------- 答える

const RequiredMark = () => <Chip tone="accent">必須</Chip>

function AnswerInputs({ q, value, disabled }: { q: SurveyQuestion; value: SurveyAnswer['value'] | undefined; disabled: boolean }) {
  const name = answerField(q)
  switch (q.kind) {
    case 'single':
    case 'multiple': {
      const picked = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
      return (
        <div class="sv-options">
          {q.options.map((option) => (
            <label class="sv-option">
              <input
                type={q.kind === 'single' ? 'radio' : 'checkbox'}
                class="sv-check"
                name={name}
                value={option}
                checked={picked.includes(option)}
                disabled={disabled}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'scale':
      return (
        <div class="sv-scale">
          {q.minLabel && <span class="sv-scale-label muted small">{q.minLabel}</span>}
          <div class="sv-scale-points">
            {Array.from({ length: q.points }, (_, i) => (
              <label class="sv-point">
                <input type="radio" name={name} value={String(i + 1)} checked={value === i + 1} disabled={disabled} />
                <span>{i + 1}</span>
              </label>
            ))}
          </div>
          {q.maxLabel && <span class="sv-scale-label muted small">{q.maxLabel}</span>}
        </div>
      )
    case 'text':
      return (
        <Textarea
          name={name}
          id={`a-${q.id}`}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-describedby={`a-${q.id}-error`}
        />
      )
  }
}

const SurveyQuestions = ({
  questions,
  answers = [],
  disabled = false,
}: {
  questions: SurveyQuestion[]
  answers?: SurveyAnswer[]
  disabled?: boolean
}) => (
  <ol class="sv-answers">
    {questions.map((q) => (
      <li class="sv-answer" data-sv-answer={q.id} data-sv-required={q.required ? 'true' : undefined}>
        <fieldset>
          <legend class="sv-answer-prompt">
            <span>{q.prompt}</span>
            {q.required && <RequiredMark />}
          </legend>
          <AnswerInputs q={q} value={answers.find((a) => a.id === q.id)?.value} disabled={disabled} />
          <FieldError id={`a-${q.id}`} />
        </fieldset>
      </li>
    ))}
  </ol>
)

export const SurveyAnswerList = ({ questions, answers }: { questions: SurveyQuestion[]; answers: SurveyAnswer[] }) => (
  <dl class="sv-mine">
    {questions.map((q) => (
      <div class="sv-mine-row">
        <dt class="small strong">{q.prompt}</dt>
        <dd class="wrap">{answerText(answers.find((a) => a.id === q.id)) || <span class="muted">（答えていません）</span>}</dd>
      </div>
    ))}
  </dl>
)

const percentOf = (count: number, total: number) => (total ? Math.round((count / total) * 100) : 0)

/** 問いごとの集計。texts は自由に書いた回答を出すか（教師だけ） */
export const SurveySummaryList = ({ summaries, total, texts }: { summaries: SurveyQuestionSummary[]; total: number; texts: boolean }) => {
  useStyle('/src/features/survey/components/survey.css')
  return (
    <ol class="sv-summary">
      {summaries.map((s) => (
        <li class="sv-summary-q">
          <div class="sv-summary-head">
            <span class="strong">{s.question.prompt}</span>
            <span class="muted small">
              {SURVEY_KIND_LABELS[s.question.kind]}・{s.answered} 人が回答
              {s.question.kind === 'scale' && 'average' in s && s.average !== null && `・平均 ${s.average.toFixed(1)}`}
            </span>
          </div>
          {'counts' in s && (
            <ul class="sv-bars">
              {s.counts.map((c) => {
                const pct = percentOf(c.count, s.question.kind === 'multiple' ? total : s.answered)
                return (
                  <li class="sv-bar-row">
                    <span class="sv-bar-label">{c.label}</span>
                    <span class="sv-bar-track" aria-hidden="true">
                      <span class="sv-bar" style={`width:${pct}%`} />
                    </span>
                    <span class="sv-bar-count small">
                      {c.count} 人<span class="muted">（{pct}%）</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {s.question.kind === 'scale' && (s.question.minLabel || s.question.maxLabel) && (
            <p class="muted small">
              1 = {s.question.minLabel || '—'}、{s.question.points} = {s.question.maxLabel || '—'}
            </p>
          )}
          {'texts' in s &&
            texts &&
            (s.texts.length === 0 ? (
              <p class="muted small">まだ回答はありません。</p>
            ) : (
              <ul class="sv-texts">
                {s.texts.map((t) => (
                  <li class="wrap">{t}</li>
                ))}
              </ul>
            ))}
        </li>
      ))}
    </ol>
  )
}

const PhaseNote = ({ settings, phase }: Pick<SurveyView, 'settings' | 'phase'>) =>
  phase === 'before' ? (
    <Alert tone="info">{formatDateTime(settings.opensAt!)} から回答できます。</Alert>
  ) : phase === 'after' ? (
    <Alert tone="info">締め切りました。</Alert>
  ) : settings.closesAt !== null ? (
    <p class="muted small">締め切り: {formatDateTime(settings.closesAt)}</p>
  ) : null

/** アイテムの画面に出すアンケート */
export const SurveyPanel = ({ survey, editHref }: { survey: SurveyView; editHref?: string }) => {
  useStyle('/src/components/form.css', '/src/features/survey/components/survey.css')
  const { settings, phase, manage, mine, results, base, itemUrl } = survey
  const anonymity = settings.anonymous ? 'このアンケートは匿名です。先生に名前は見えません。' : '先生には、だれが何と答えたかが見えます。'

  if (manage)
    return (
      <section class="sv-panel stack">
        <div class="sv-panel-head">
          <div>
            <div class="strong">
              回答 {manage.responses} 人<span class="muted"> / 学生 {manage.students} 人</span>
            </div>
            <p class="muted small">
              {settings.anonymous ? '匿名' : '記名'}・{settings.allowEdit ? '回答を直せる' : '回答は直せない'}・
              {settings.showResults ? '集計を学生に見せる' : '集計は先生だけ'}
            </p>
          </div>
          <div class="row">
            {editHref && (
              <Button href={editHref} variant="ghost" icon="pencil">
                問いを編集
              </Button>
            )}
            <Button href={`${base}/results`} variant="primary" icon="chartBar">
              結果を見る
            </Button>
          </div>
        </div>
        <PhaseNote settings={settings} phase={phase} />
        {settings.questions.length === 0 ? (
          <p class="muted">問いがまだありません。「問いを編集」から作ってください。</p>
        ) : (
          <div class="sv-preview">
            <p class="eyebrow">学生に見える問い（プレビュー）</p>
            <SurveyQuestions questions={settings.questions} disabled />
          </div>
        )}
      </section>
    )

  if (!mine) return null
  if (settings.questions.length === 0)
    return (
      <section class="sv-panel">
        <p class="muted">問いがまだありません。</p>
      </section>
    )

  const answering = phase === 'open' && (!mine.answers || mine.editing)
  return (
    <section class="sv-panel stack">
      <PhaseNote settings={settings} phase={phase} />
      {answering ? (
        <form method="post" action={`${base}/submit`} class="stack" data-loading-form data-sv-form>
          <p class="muted small">{anonymity}</p>
          <SurveyQuestions questions={settings.questions} answers={mine.answers ?? []} />
          <div class="form-actions">
            {mine.editing && (
              <Button href={itemUrl} variant="ghost">
                キャンセル
              </Button>
            )}
            <Button type="submit" variant="primary" icon="check">
              {mine.answers ? '回答を送り直す' : '回答を送る'}
            </Button>
          </div>
        </form>
      ) : mine.answers ? (
        <>
          <div class="sv-panel-head">
            <div class="strong">
              <Icon name="checkCircle" size={18} /> 回答しました
            </div>
            {phase === 'open' && settings.allowEdit === 1 && (
              <Button href={`${itemUrl}?edit=1`} icon="pencil">
                回答を直す
              </Button>
            )}
          </div>
          <SurveyAnswerList questions={settings.questions} answers={mine.answers} />
        </>
      ) : null}
      {results && results.summaries.length > 0 && !answering && (
        <div class="stack">
          <h3 class="sv-results-title">みんなの回答（{results.total} 人）</h3>
          <SurveySummaryList summaries={results.summaries} total={results.total} texts={false} />
        </div>
      )}
    </section>
  )
}
