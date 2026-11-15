import type { Child } from 'hono/jsx'
import type { FieldErrors } from '../lib/forms'
import {
  MAX_QUIZ_ATTEMPTS,
  QUIZ_DEFAULT_PROMPTS,
  QUIZ_KEY_SLOT,
  QUIZ_KINDS,
  QUIZ_KIND_DESCRIPTIONS,
  QUIZ_KIND_LABELS,
  QUIZ_LOOK_LABELS,
  answerField,
  codeLines,
  indentedCode,
  isSameCell,
  lineAt,
  parseSteps,
  quizStars,
  type QuizFormRow,
  type QuizKind,
  type QuizLook,
  type QuizReviewItem,
  type QuizScore,
  type QuizTakeQuestion,
} from '../lib/quiz'
import type { QuizAttemptView, QuizView } from '../lib/quiz-store'
import { Button, IconButton } from './button'
import { Card } from './card'
import { cx } from './cx'
import { FieldError, FormField, Input, SegmentedControl, TextField, Textarea } from './form'
import { Icon, type IconName } from './icons'
import { Mascot } from './mascot'
import { QUIZ_ANIMALS, QuizAnimal } from './quiz-animal'
import { useStyle } from './style'
import { Alert, Chip, EmptyState, formatDateTime } from './ui'

const KIND_ICONS: Record<QuizKind, IconName> = {
  choice: 'listBullet',
  output: 'terminal',
  order: 'sort',
  bug: 'bug',
  flow: 'play',
  indent: 'indent',
  table: 'table',
}

// ---------------------------------------------------------------- 編集画面

const control = (k: string, field: string, errors: FieldErrors) => ({
  id: `${k}-${field}`,
  name: `${k}.${field}`,
  invalid: !!errors[`${k}.${field}`],
  'aria-describedby': `${k}-${field}-error`,
})

const codeAttrs = { class: 'qz-code', spellcheck: false, autocapitalize: 'none', autocomplete: 'off' } as const

const QzChoice = ({ k, text, checked }: { k: string; text: string; checked: boolean }) => (
  <li class="qz-choice" data-qz-choice>
    <input type="radio" name={`${k}.answer`} checked={checked} class="qz-choice-radio" aria-label="この選択肢を正解にする" />
    <Input name={`${k}.choice`} value={text} placeholder="選択肢" aria-label="選択肢" autocomplete="off" data-qz-choice-text />
    <IconButton icon="x" label="この選択肢を消す" data-qz-choice-remove />
  </li>
)

/**
 * 選択肢の欄。エラーは fieldset（name="<k>.choices"）に出す。行ごとの入力欄は同じ名前が並ぶので、エラーの置き場所にできないため
 */
const QzChoices = ({ row, errors }: { row: QuizFormRow; errors: FieldErrors }) => {
  const { k } = row
  const id = `${k}-choices`
  const error = errors[`${k}.choices`]
  return (
    <fieldset
      name={`${k}.choices`}
      id={id}
      class={cx('field qz-choices', error && 'has-error')}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={`${id}-error`}
      data-qz-choices
    >
      <legend>選択肢</legend>
      <p class="field-hint">左の丸で、正解の選択肢を 1 つ選びます。学生には、この順のまま出します。</p>
      <ol class="qz-choice-list" data-qz-choice-list>
        {row.choices.map((text, i) => (
          <QzChoice k={k} text={text} checked={String(i) === row.answer} />
        ))}
      </ol>
      <div class="qz-choice-foot">
        <Button size="sm" icon="plus" data-qz-choice-add>
          選択肢を追加
        </Button>
      </div>
      <FieldError id={id} error={error} />
      <template data-qz-choice-template>
        <QzChoice k={k} text="" checked={false} />
      </template>
    </fieldset>
  )
}

const lineNote = (line: string | null) => (line === null ? '' : line.trim() || '（空の行）')

const CODE_LABELS: Record<Exclude<QuizKind, 'order'>, string> = {
  choice: 'コード（任意）',
  output: 'コード',
  bug: 'コード',
  flow: 'コード',
  indent: '正しく字下げしたコード',
  table: 'コード',
}

const INDENT_HINT =
  '学生には字下げを消して出し、行ごとに字下げを付け直してもらいます。空白の数ではなく、字下げの深さが合っていれば正解です。空の行は出しません。'

const TABLE_PLACEHOLDER = 'i | total\n1 | 1\n2 | 3\n3 | 6'

function QzFields({ row, errors }: { row: QuizFormRow; errors: FieldErrors }) {
  const { k, kind } = row
  const error = (field: string) => errors[`${k}.${field}`]
  return (
    <div class="qz-fields">
      <FormField id={`${k}-prompt`} label="問題文" error={error('prompt')}>
        <Textarea {...control(k, 'prompt', errors)} value={row.prompt} rows={2} />
      </FormField>
      {kind !== 'order' && (
        <FormField id={`${k}-code`} label={CODE_LABELS[kind]} error={error('code')} hint={kind === 'indent' ? INDENT_HINT : undefined}>
          <Textarea {...control(k, 'code', errors)} {...codeAttrs} value={row.code} rows={kind === 'choice' ? 3 : 6} data-qz-code />
        </FormField>
      )}
      {kind === 'choice' && <QzChoices row={row} errors={errors} />}
      {kind === 'output' && (
        <FormField
          id={`${k}-answer`}
          label="正しい出力"
          error={error('answer')}
          hint="行末の空白、前後の空行、全角と半角の違いは区別せずに採点します。"
        >
          <Textarea {...control(k, 'answer', errors)} {...codeAttrs} value={row.answer} rows={3} />
        </FormField>
      )}
      {kind === 'order' && (
        <FormField
          id={`${k}-lines`}
          label="正しい順に並べた行"
          error={error('lines')}
          hint="1 行ずつ、正しい順に書きます。学生には順を混ぜて出し、字下げはそのまま見せます。正しい順が 1 つに決まるコードにしてください。"
        >
          <Textarea {...control(k, 'lines', errors)} {...codeAttrs} value={row.lines} rows={6} />
        </FormField>
      )}
      {kind === 'bug' && (
        <FormField id={`${k}-answer`} label="間違っている行の番号" error={error('answer')}>
          <div class="qz-bug-row">
            <Input
              {...control(k, 'answer', errors)}
              value={row.answer}
              inputmode="numeric"
              autocomplete="off"
              class="qz-bug-no"
              data-qz-bug-no
            />
            <code class="qz-bug-line truncate" data-qz-bug-line>
              {lineNote(lineAt(row.code, row.answer))}
            </code>
          </div>
        </FormField>
      )}
      {kind === 'flow' && (
        <FormField
          id={`${k}-answer`}
          label="実行される順（行の番号）"
          error={error('answer')}
          hint="実行される順に、行の番号をカンマで区切って書きます。繰り返しで何度も実行される行は、その回数だけ書きます。"
        >
          <Input {...control(k, 'answer', errors)} value={row.answer} autocomplete="off" placeholder="例: 4, 1, 2, 5" data-qz-flow-answer />
          <ol class="qz-flow-steps" data-qz-flow-steps>
            {(parseSteps(row.answer) ?? []).map((n) => (
              <li>
                <span class="qz-flow-no">{n}</span>
                <code class="truncate">{lineNote(lineAt(row.code, n)) || '（行がありません）'}</code>
              </li>
            ))}
          </ol>
        </FormField>
      )}
      {kind === 'table' && (
        <FormField
          id={`${k}-answer`}
          label="変数の値の表"
          error={error('answer')}
          hint={`1 行目に変数の名前、2 行目からは各回の値を、| で区切って書きます。学生には変数の名前と行の数だけを見せます。空白と、引用符の種類（' と "）の違いは区別せずに採点します。`}
        >
          <Textarea {...control(k, 'answer', errors)} {...codeAttrs} value={row.answer} rows={5} placeholder={TABLE_PLACEHOLDER} />
        </FormField>
      )}
      <FormField id={`${k}-explanation`} label="解説（任意）" error={error('explanation')}>
        <Textarea {...control(k, 'explanation', errors)} value={row.explanation} rows={2} />
      </FormField>
    </div>
  )
}

const QzQuestion = ({ row, errors }: { row: QuizFormRow; errors: FieldErrors }) => (
  <li class="qz-q" data-qz-question={row.kind} data-qz-key={row.k}>
    <div class="qz-q-head">
      <span class="qz-q-num" aria-hidden="true" />
      <span class="qz-q-kind">
        <Icon name={KIND_ICONS[row.kind]} size={16} />
        {QUIZ_KIND_LABELS[row.kind]}
      </span>
      <span class="qz-q-actions">
        <IconButton icon="arrowUp" label="上へ移動" data-qz-move="up" />
        <IconButton icon="arrowDown" label="下へ移動" data-qz-move="down" />
        <IconButton icon="trash" label="この問題を削除" data-qz-remove />
      </span>
    </div>
    <QzFields row={row} errors={errors} />
  </li>
)

const blankRow = (kind: QuizKind): QuizFormRow => ({
  k: QUIZ_KEY_SLOT,
  kind,
  prompt: QUIZ_DEFAULT_PROMPTS[kind],
  code: '',
  choices: kind === 'choice' ? ['', '', '', ''] : [],
  answer: '',
  lines: '',
  explanation: '',
})

/**
 * 問題の欄。送るのは questions（client.ts が問題の行から組み立てる JSON）で、
 * 問題ごとの入力欄は `<問題の目印>.<項目>` の name でエラーの置き場所にだけ使う。idPrefix は、同じ画面にほかの種類の欄もある Moodle モードで id を分ける
 */
export const QuizQuestionsField = ({
  rows,
  errors = {},
  idPrefix = 'f',
}: {
  rows: QuizFormRow[]
  errors?: FieldErrors
  idPrefix?: string
}) => {
  useStyle('/src/components/form.css', '/src/components/quiz.css')
  const id = `${idPrefix}-questions`
  return (
    <div class="qz" data-qz>
      <input type="hidden" name="questions" id={id} value={JSON.stringify(rows)} data-qz-value />
      <ol class="qz-list" data-qz-list>
        {rows.map((row) => (
          <QzQuestion row={row} errors={errors} />
        ))}
      </ol>
      <p class="qz-empty muted small">問題はまだありません。下のボタンから、出題の形式を選んで足します。</p>
      <FieldError id={id} error={errors.questions} />
      <div class="qz-add" role="group" aria-label="問題を追加">
        {QUIZ_KINDS.map((kind) => (
          <button type="button" class="qz-add-kind" data-qz-add={kind}>
            <Icon name={KIND_ICONS[kind]} size={18} />
            <span class="qz-add-text">
              <span class="strong">{QUIZ_KIND_LABELS[kind]}</span>
              <span class="muted small">{QUIZ_KIND_DESCRIPTIONS[kind]}</span>
            </span>
            <Icon name="plus" size={16} class="qz-add-plus" />
          </button>
        ))}
      </div>
      {QUIZ_KINDS.map((kind) => (
        <template data-qz-template={kind}>
          <QzQuestion row={blankRow(kind)} errors={{}} />
        </template>
      ))}
    </div>
  )
}

const QUESTIONS_DESCRIPTION = '採点は正解との照合で行います。問題を書き換えても、すでに受けた学生の点数は変わりません。'

/** 通常モードの編集画面の「問題」のカード */
export const QuizEditor = ({ rows, errors = {} }: { rows: QuizFormRow[]; errors?: FieldErrors }) => (
  <Card class="editor-extra" heading="問題" description={QUESTIONS_DESCRIPTION}>
    <QuizQuestionsField rows={rows} errors={errors} />
  </Card>
)

type GradingProps = { passPercent: string; showAnswers: number; errors: FieldErrors; idPrefix?: string }

const GradingInputs = ({ passPercent, showAnswers, errors, idPrefix = 'f' }: GradingProps) => (
  <div class="stack">
    <TextField
      label="合格にする正解の割合（%）"
      name="pass_percent"
      id={`${idPrefix}-pass-percent`}
      value={passPercent}
      error={errors.pass_percent}
      inputmode="numeric"
      autocomplete="off"
      hint="正解の割合がこれ以上の受験を合格にします。"
    />
    <fieldset class="field">
      <legend>不正解だった問題の正解と解説</legend>
      <SegmentedControl
        name="show_answers"
        label="不正解だった問題の正解と解説"
        options={[
          { value: '1', label: '見せる', icon: 'eye' },
          { value: '0', label: '見せない', icon: 'eyeSlash' },
        ]}
        value={String(showAnswers)}
      />
      <p class="field-hint">見せないと、採点のあとに出すのは問題ごとの正誤と、正解した問題の解説だけになります。</p>
    </fieldset>
  </div>
)

/** 通常モードの編集画面の右の列に置く「採点」のカード */
export const QuizGradingCard = (props: GradingProps) => (
  <Card heading="採点" description="合格は、完了の条件「合格したら完了」と、アクセス制限の「合格している」に使います。">
    <GradingInputs {...props} />
  </Card>
)

const LookInputs = ({ look, legend }: { look: QuizLook; legend: string }) => (
  <fieldset class="field">
    <legend>{legend}</legend>
    <SegmentedControl
      name="look"
      label={legend}
      options={[
        { value: 'plain', label: QUIZ_LOOK_LABELS.plain, icon: 'clipboardCheck' },
        { value: 'game', label: QUIZ_LOOK_LABELS.game, icon: 'star' },
      ]}
      value={look}
    />
    <p class="field-hint">
      ゲームは中学生向けの見た目です。動物のキャラクターが案内し、1 問ずつステージを進む形で出します。問題と採点は標準と同じです。
    </p>
  </fieldset>
)

/** 通常モードの編集画面の右の列に置く「見た目」のカード */
export const QuizLookCard = ({ look }: { look: QuizLook }) => (
  <Card heading="見た目">
    <LookInputs look={look} legend="学生に出す画面" />
  </Card>
)

/**
 * Moodle モードの種類ごとの入力欄（extra-kinds.tsx）で使う「問題」「採点」「見た目」の欄。
 * 1 枚のカードの中に並べるので、カードではなく fieldset で包む
 */
export const QuizFields = ({ rows, look, ...grading }: { rows: QuizFormRow[]; look: QuizLook } & GradingProps) => (
  <>
    <fieldset class="field">
      <legend>問題</legend>
      <p class="field-hint">{QUESTIONS_DESCRIPTION}</p>
      <QuizQuestionsField rows={rows} errors={grading.errors} idPrefix={grading.idPrefix} />
    </fieldset>
    <fieldset class="field">
      <legend>採点</legend>
      <GradingInputs {...grading} />
    </fieldset>
    <LookInputs look={look} legend="見た目" />
  </>
)

// ---------------------------------------------------------------- 学生: 受ける

const CodeBlock = ({ code }: { code: string }) => (
  <pre class="quiz-code">
    <code>{code}</code>
  </pre>
)

type LineMark = 'right' | 'wrong' | 'answer'

const LineBody = ({ no, line }: { no: number; line: string }) => (
  <>
    <span class="quiz-line-no">{no}</span>
    <code>{line || ' '}</code>
  </>
)

/** 行番号付きのコード。pick を渡すと行を 1 つ選べ、marks を渡すと結果の印を付ける */
const CodeLines = ({
  code,
  pick,
  marks = {},
  who = 'あなた',
}: {
  code: string
  pick?: string
  marks?: Partial<Record<number, LineMark>>
  who?: string
}) => (
  <ol class="quiz-lines" role={pick ? 'radiogroup' : undefined} aria-label={pick ? '間違っている行' : undefined}>
    {codeLines(code).map((line, i) => {
      const mark = marks[i + 1]
      const body = (
        <>
          <LineBody no={i + 1} line={line} />
          {mark && <span class="quiz-line-mark">{mark === 'answer' ? '間違っている行' : `${who}の答え`}</span>}
        </>
      )
      return (
        <li class={cx('quiz-line', mark && `is-${mark}`)}>
          {pick && line.trim() ? (
            <label>
              <input type="radio" name={pick} value={i + 1} class="sr-only" />
              {body}
            </label>
          ) : (
            <span>{body}</span>
          )}
        </li>
      )
    })}
  </ol>
)

/** 実行の順番の解答。行を押すたびに、その行の番号を順番の最後に足す（client.ts） */
const FlowPicker = ({ code, name }: { code: string; name: string }) => (
  <div class="quiz-flow" data-quiz-flow>
    <input type="hidden" name={name} data-quiz-flow-value />
    <ol class="quiz-lines">
      {codeLines(code).map((line, i) => (
        <li class="quiz-line">
          {line.trim() ? (
            <button type="button" data-quiz-flow-line={i + 1} aria-label={`${i + 1} 行目を順番に足す`}>
              <LineBody no={i + 1} line={line} />
              <span class="quiz-flow-badges" data-quiz-flow-badges />
            </button>
          ) : (
            <span>
              <LineBody no={i + 1} line={line} />
            </span>
          )}
        </li>
      ))}
    </ol>
    <div class="quiz-flow-bar">
      <ol class="quiz-steps" data-quiz-flow-steps aria-live="polite" aria-label="選んだ順番" />
      <p class="quiz-flow-empty muted small">実行される順に、行を押してください。同じ行を何度押してもかまいません。</p>
      <Button size="sm" icon="undo" data-quiz-flow-undo disabled>
        1 つ戻す
      </Button>
      <Button size="sm" icon="x" data-quiz-flow-clear disabled>
        やり直す
      </Button>
    </div>
  </div>
)

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

function TakeBody({ q }: { q: QuizTakeQuestion }) {
  const name = answerField(q)
  switch (q.kind) {
    case 'choice':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <div class="quiz-choices" role="radiogroup" aria-label="選択肢">
            {q.choices.map((text, i) => (
              <label class="quiz-choice">
                <input type="radio" name={name} value={i} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </>
      )
    case 'output':
      return (
        <>
          <CodeBlock code={q.code} />
          <Textarea name={name} rows={3} {...codeAttrs} class="quiz-output" placeholder="出力を入力" aria-label="出力" />
        </>
      )
    case 'order':
      return (
        <ol class="quiz-order" data-quiz-order>
          {q.lines.map((line) => (
            <li class="quiz-order-line" data-quiz-line>
              <span class="quiz-order-grip" data-quiz-grip aria-hidden="true">
                <Icon name="grip" size={16} />
              </span>
              <input type="hidden" name={name} value={line} />
              <code>{line}</code>
              <IconButton icon="arrowUp" label="上へ移動" data-quiz-line-move="up" />
              <IconButton icon="arrowDown" label="下へ移動" data-quiz-line-move="down" />
            </li>
          ))}
        </ol>
      )
    case 'bug':
      return <CodeLines code={q.code} pick={name} />
    case 'flow':
      return <FlowPicker code={q.code} name={name} />
    case 'indent':
      return (
        <ol class="quiz-indent">
          {q.lines.map((line) => (
            <li class="quiz-indent-line" data-quiz-indent-line style="--level: 0">
              <input type="hidden" name={name} value="0" />
              <IconButton icon="chevronLeft" label="字下げを浅くする" data-quiz-indent-move="-1" disabled />
              <IconButton icon="chevronRight" label="字下げを深くする" data-quiz-indent-move="1" />
              <code>{line}</code>
            </li>
          ))}
        </ol>
      )
    case 'table':
      return (
        <>
          <CodeBlock code={q.code} />
          <div class="quiz-table-wrap">
            <table class="quiz-table">
              <thead>
                <tr>
                  <th scope="col">回</th>
                  {q.columns.map((column) => (
                    <th scope="col">
                      <code>{column}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {range(q.rowCount).map((r) => (
                  <tr>
                    <th scope="row">{r + 1}</th>
                    {q.columns.map((column) => (
                      <td>
                        <Input
                          compact
                          name={name}
                          class="quiz-cell"
                          autocomplete="off"
                          autocapitalize="none"
                          spellcheck={false}
                          aria-label={`${r + 1} 回目の ${column}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )
  }
}

type QuestionStatus = 'right' | 'wrong' | 'none'

const STATUS_LABELS: Record<QuizLook, Record<QuestionStatus, string>> = {
  plain: { right: '正解', wrong: '不正解', none: '未採点' },
  game: { right: 'せいかい！', wrong: 'おしい…', none: '未採点' },
}

const Question = ({
  no,
  q,
  status,
  look = 'plain',
  children,
}: {
  no: number
  q: QuizTakeQuestion
  status?: QuestionStatus
  look?: QuizLook
  children: Child
}) => (
  <li class={cx('quiz-q', status && `is-${status}`)} data-quiz-q={q.kind}>
    <div class="quiz-q-head">
      {look === 'game' && (
        <QuizAnimal kind={q.kind} size={44} mood={status === 'right' ? 'happy' : status === 'wrong' ? 'sad' : 'normal'} />
      )}
      <span class="quiz-q-num">{look === 'game' ? `ステージ ${no}` : `問 ${no}`}</span>
      <span class="quiz-q-kind muted small">{QUIZ_KIND_LABELS[q.kind]}</span>
      {status && (
        <span class="quiz-mark">
          {status !== 'none' && <Icon name={status === 'right' ? 'check' : 'x'} size={14} />}
          {STATUS_LABELS[look][status]}
        </span>
      )}
    </div>
    <p class="quiz-prompt">{q.prompt}</p>
    {children}
  </li>
)

const passCount = (total: number, passPercent: number) => Math.ceil((total * passPercent) / 100)

const TakeForm = ({ quiz, action }: { quiz: QuizView; action?: string }) => {
  const { questions, passPercent } = quiz
  const list = (
    <ol class="quiz-questions">
      {questions.map((q, i) => (
        <Question no={i + 1} q={q}>
          <TakeBody q={q} />
        </Question>
      ))}
    </ol>
  )
  return (
    <>
      <p class="quiz-lead muted">
        全 {questions.length} 問。{passCount(questions.length, passPercent)} 問以上の正解で合格です。
      </p>
      {action ? (
        <form method="post" action={action} class="quiz-form" data-quiz-form data-loading-form>
          {list}
          <div class="quiz-actions">
            <Button type="submit" variant="primary" size="lg" icon="check">
              採点する
            </Button>
          </div>
        </form>
      ) : (
        <div class="quiz-form">{list}</div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 学生: 結果

/** 答えと正解を左右に並べる。正解は、不正解で、見せてよいときだけ出す */
const Compare = ({
  wrong,
  mine,
  answer,
  correct,
  solution,
}: {
  wrong: boolean
  /** 答えの見出し */
  mine: string
  answer: Child
  /** 正解の見出し */
  correct: string
  solution: Child
}) => (
  <div class="quiz-compare">
    <div class={cx('quiz-compare-side', wrong ? 'is-wrong' : 'is-right')}>
      <span class="quiz-compare-label">{mine}</span>
      {answer ?? <p class="muted small">答えていません。</p>}
    </div>
    {wrong && solution && (
      <div class="quiz-compare-side is-answer">
        <span class="quiz-compare-label">{correct}</span>
        {solution}
      </div>
    )}
  </div>
)

/** 実行の順番。compare を渡すと、同じ位置の番号が違うところに印を付ける */
const Steps = ({ steps, compare }: { steps: readonly number[]; compare?: readonly number[] }) => (
  <ol class="quiz-steps">
    {steps.map((n, i) => (
      <li class={cx('quiz-step', compare && compare[i] !== n && 'is-wrong')}>{n}</li>
    ))}
  </ol>
)

const numbersOf = (v: unknown) => (Array.isArray(v) && v.every((n) => typeof n === 'number') ? v : null)
const stringsOf = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : null)

function ReviewBody({ item, who }: { item: QuizReviewItem; who: string }) {
  const { question: q, answer, correct, solution } = item
  const wrong = correct === false
  switch (q.kind) {
    case 'choice':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <ul class="quiz-choices is-review">
            {q.choices.map((text, i) => {
              const picked = answer === i
              const right = solution?.answer === i
              return (
                <li class={cx('quiz-choice', picked && (wrong ? 'is-wrong' : 'is-right'), !picked && right && 'is-answer')}>
                  <span class="quiz-choice-dot" aria-hidden="true" />
                  <span>{text}</span>
                  {picked && <span class="quiz-line-mark">{who}の答え</span>}
                  {!picked && right && <span class="quiz-line-mark">正解</span>}
                </li>
              )
            })}
          </ul>
        </>
      )
    case 'output':
      return (
        <>
          <CodeBlock code={q.code} />
          <Compare
            wrong={wrong}
            mine={`${who}の答え`}
            answer={typeof answer === 'string' ? <CodeBlock code={answer} /> : null}
            correct="正しい出力"
            solution={typeof solution?.answer === 'string' ? <CodeBlock code={solution.answer} /> : null}
          />
        </>
      )
    case 'order': {
      const mine = stringsOf(answer)
      const right = stringsOf(solution?.answer)
      return (
        <Compare
          wrong={wrong}
          mine={`${who}の並び`}
          answer={mine && <CodeBlock code={mine.join('\n')} />}
          correct="正しい並び"
          solution={right && <CodeBlock code={right.join('\n')} />}
        />
      )
    }
    case 'bug': {
      const marks: Partial<Record<number, LineMark>> = {}
      if (typeof solution?.answer === 'number') marks[solution.answer] = 'answer'
      if (typeof answer === 'number') marks[answer] = wrong ? 'wrong' : 'right'
      return (
        <>
          <CodeLines code={q.code} marks={marks} who={who} />
          {answer === null && <p class="muted small">答えていません。</p>}
        </>
      )
    }
    case 'flow': {
      const mine = numbersOf(answer)
      const right = numbersOf(solution?.answer)
      return (
        <>
          <CodeLines code={q.code} />
          <Compare
            wrong={wrong}
            mine={`${who}の順番`}
            answer={mine && <Steps steps={mine} compare={wrong ? (right ?? undefined) : undefined} />}
            correct="正しい順番"
            solution={right && <Steps steps={right} />}
          />
        </>
      )
    }
    case 'indent': {
      const mine = numbersOf(answer)
      const right = numbersOf(solution?.answer)
      return (
        <Compare
          wrong={wrong}
          mine={`${who}の字下げ`}
          answer={mine && <CodeBlock code={indentedCode(q.lines, mine)} />}
          correct="正しい字下げ"
          solution={right && <CodeBlock code={indentedCode(q.lines, right)} />}
        />
      )
    }
    case 'table': {
      const mine = stringsOf(answer)
      const right = stringsOf(solution?.answer)
      return (
        <>
          <CodeBlock code={q.code} />
          <div class="quiz-table-wrap">
            <table class="quiz-table is-review">
              <thead>
                <tr>
                  <th scope="col">回</th>
                  {q.columns.map((column) => (
                    <th scope="col">
                      <code>{column}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {range(q.rowCount).map((r) => (
                  <tr>
                    <th scope="row">{r + 1}</th>
                    {q.columns.map((_, col) => {
                      const at = r * q.columns.length + col
                      const value = mine?.[at] ?? ''
                      const expected = right?.[at]
                      const same = expected === undefined ? null : isSameCell(value, expected)
                      return (
                        <td class={cx(same === true && 'is-right', same === false && 'is-wrong')}>
                          <code>{value || '—'}</code>
                          {same === false && <span class="quiz-cell-answer">正: {expected}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {answer === null && <p class="muted small">答えていません。</p>}
        </>
      )
    }
  }
}

/** 問題ごとの結果。学生の結果の画面と、教師が学生の受験を見る画面で使う */
export const QuizReview = ({
  items,
  who = 'あなた',
  look = 'plain',
}: {
  items: QuizReviewItem[]
  /** 答えた人の呼び方（「あなたの答え」「学生の答え」） */
  who?: string
  /** 教師が学生の受験を見る画面では、どの見た目の小テストでも標準のまま出す */
  look?: QuizLook
}) => {
  useStyle('/src/components/form.css', '/src/components/quiz.css')
  return (
    <ol class="quiz-questions">
      {items.map((item, i) => (
        <Question no={i + 1} q={item.question} status={item.correct === null ? 'none' : item.correct ? 'right' : 'wrong'} look={look}>
          <ReviewBody item={item} who={who} />
          {item.correct === null && <p class="muted small">この問題は、受けたあとに足されました。</p>}
          {item.solution?.explanation && (
            <div class="quiz-explanation">
              <span class="quiz-explanation-label">
                <Icon name="lightBulb" size={14} />
                解説
              </span>
              <p>{item.solution.explanation}</p>
            </div>
          )}
        </Question>
      ))}
    </ol>
  )
}

/** 受験 1 回の点数。合格なら「合格」のチップを付ける */
export const QuizScoreChip = ({ score, passed }: { score: QuizScore; passed: boolean }) =>
  passed ? (
    <Chip tone="success" icon="check">
      {score.correct} / {score.total} 合格
    </Chip>
  ) : (
    <span class="score">
      {score.correct} / {score.total}
    </span>
  )

const Result = ({ quiz, mine, latest }: { quiz: QuizView; mine: NonNullable<QuizView['mine']>; latest: QuizAttemptView }) => {
  const { score, passed } = latest
  const full = mine.count >= MAX_QUIZ_ATTEMPTS
  return (
    <>
      <div class={cx('quiz-score', passed ? 'is-passed' : 'is-failed')}>
        <Mascot act={passed ? 'cheer' : 'advise'} size={72} stand={false} />
        <div class="quiz-score-text">
          <p class="quiz-score-value">
            <strong>{score.correct}</strong> / {score.total} 問正解
            <Chip tone={passed ? 'success' : 'default'} icon={passed ? 'check' : undefined}>
              {passed ? '合格' : '不合格'}
            </Chip>
          </p>
          <p class="muted small">
            {formatDateTime(latest.createdAt)} · {mine.count} 回目
            {mine.count > 1 && mine.best && ` · これまでの最高 ${mine.best.correct} / ${mine.best.total}`}
            {!passed && ` · ${passCount(score.total, quiz.passPercent)} 問以上の正解で合格`}
          </p>
        </div>
        {!full && (
          <Button href={`${quiz.itemUrl}?retake=1`} icon="arrowPath" variant={passed ? 'default' : 'primary'}>
            もう一度受ける
          </Button>
        )}
      </div>
      {full && <Alert tone="info">受けられる回数の上限（{MAX_QUIZ_ATTEMPTS} 回）に達しました。</Alert>}
      <QuizReview items={latest.review} />
    </>
  )
}

// ---------------------------------------------------------------- ゲームの見た目

/**
 * ゲームの見た目の解答。問題を 1 問ずつのステージにして、上の道のりと下のボタンで行き来する（client.ts）。
 * 3D のゲームでは、扉のレバーで 1 問ずつ答えを確かめ（data-qg-check）、正解するまで扉を開けない。点数は最初の答えで、ゴールでまとめて採点する
 */
const GameTake = ({ quiz, action }: { quiz: QuizView; action?: string }) => {
  const { questions, passPercent } = quiz
  const count = questions.length
  const body = (
    <>
      {/* 道のりを 3D の枠の中に置くのは、3D を読み込むまでと、WebGL を使えない端末で、同じ場所に 2D の道のりを出しておくため */}
      <div class="qg-world" data-qg-world="take" data-kinds={questions.map((q) => q.kind).join(',')}>
        <ol class="qg-track" aria-label="ステージ">
          {questions.map((q, i) => (
            <li class="qg-step" data-quiz-kind={q.kind}>
              <button
                type="button"
                class="qg-node"
                data-qg-to={i}
                aria-current={i === 0 ? 'step' : undefined}
                aria-label={`ステージ ${i + 1}（${QUIZ_KIND_LABELS[q.kind]}）`}
              >
                <QuizAnimal kind={q.kind} size={36} />
                <span class="qg-node-no">{i + 1}</span>
                <span class="qg-node-star">
                  <Icon name="star" size={14} />
                </span>
              </button>
            </li>
          ))}
          <li class="qg-step qg-goal">
            <button type="button" class="qg-node" data-qg-to={count} aria-label="ゴール">
              <Icon name="flag" size={22} />
            </button>
          </li>
        </ol>
        {/* ここから下は 3D のゲームの画面に重ねる部品。3D を描けたときだけ出す（quiz-game.css）。操作は src/quiz-world.ts */}
        <div class="qg-start">
          <p class="qg-start-title">ダンジョンの扉をあけて、ゴールをめざそう！</p>
          <Button size="lg" variant="primary" icon="play" data-qg-start>
            ゲームスタート
          </Button>
          <p class="qg-start-keys">
            <span class="qg-help-keys">
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> で歩く・マウスで見まわす・部屋にある玉やブロックは、ねらって<kbd>クリック</kbd>で動かす・<kbd>Esc</kbd>{' '}
              でメニュー
            </span>
            <span class="qg-help-touch">
              左下のスティックで歩いて、画面をなぞって見まわそう。部屋にある玉やブロックは、タップで動かすよ
            </span>
          </p>
          <p class="qg-start-keys">答えたら、扉の横のレバーを引こう。正解すると扉がひらくよ（点数になるのは、さいしょの答え）</p>
          {/* 3D が重い端末や、マウスを使えない人が、同じ問題に 2D のステージで答えられるようにする（src/quiz-world.ts が 3D を片付ける） */}
          <button type="button" class="qg-flat" data-qg-flat>
            3D を使わずに答える
          </button>
        </div>
        <div class="qg-hud">
          <Button size="sm" icon="x" data-qg-exit>
            やめる
          </Button>
          <p class="qg-world-score" title="開けた扉">
            <Icon name="star" size={16} />
            <span data-qg-opened>0</span> / {count}
          </p>
          <p class="qg-world-score" title="集めた宝石">
            <span class="qg-gem" aria-hidden="true" />
            <span class="sr-only">宝石</span>
            <span data-qg-gems>0</span>
          </p>
          <Button size="sm" icon="book" data-qg-note>
            ノート
            <kbd class="qg-help-keys">N</kbd>
          </Button>
        </div>
        <p class="qg-quest" data-qg-quest aria-live="polite" />
        {/* 照準が合っているものを押すと、何が起きるか */}
        <p class="qg-act" data-qg-act aria-hidden="true" hidden>
          <kbd>クリック</kbd>
          <span data-qg-act-label />
        </p>
        <canvas class="qg-map" data-qg-map aria-hidden="true" />
        <span class="qg-aim" aria-hidden="true" />
        {/* 動かせるものに重ねる、Tab キーで選ぶための目印。中のボタンは src/quiz-world.ts が、いまいる部屋のものに合わせて作る */}
        <div class="qg-spots" data-qg-spots />
        {/* 黒板や表に文字を書くときに、キーボードの入力を受け取る欄。ゲームの間は 2D のステージを隠していて、そこの欄にはフォーカスできないため */}
        <textarea class="qg-typer" data-qg-typer tabindex={-1} autocomplete="off" autocapitalize="none" spellcheck={false} />
        {/* Esc などでマウスが外れたときのメニュー。マウスを閉じ込めている間は「やめる」を押せないので、ここにも置く */}
        <div class="qg-pause">
          <p class="qg-pause-title">ひとやすみ</p>
          <Button size="lg" variant="primary" icon="play" data-qg-resume>
            つづける
          </Button>
          <Button size="lg" icon="x" data-qg-exit>
            やめる
          </Button>
        </div>
        {/* まちがえたあとに正解したときの解説（client.ts の qgCheck）。ゲームの枠の直下に置かないのは、全画面で遊んでいる間は 3D の枠の外が隠れるため */}
        <div class="qg-explain" data-qg-explain role="dialog" aria-modal="true" aria-labelledby="qg-explain-title" hidden>
          <div class="qg-explain-card">
            <p class="qg-explain-badge">
              <Icon name="check" size={16} />
              正解！
            </p>
            <h2 class="qg-explain-title" id="qg-explain-title">
              解説
            </h2>
            <p class="qg-explain-text" data-qg-explain-text />
            <Button size="lg" variant="primary" icon="play" data-qg-explain-close>
              つづける
            </Button>
          </div>
        </div>
        <div class="qg-pad">
          <div class="qg-stick" data-qg-stick>
            <span class="qg-stick-knob" />
          </div>
          <button type="button" class="qg-pad-btn" data-qg-jump>
            ジャンプ
          </button>
        </div>
      </div>
      {/* 問題を 1 つの枠で包むのは、3D のゲームでは、この枠を「ノート」として画面に重ねて開け閉めするため（src/quiz-world.ts） */}
      <div class="qg-panel" tabindex={-1}>
        <ol class="qg-stages">
          {questions.map((q, i) => (
            <li class="quiz-q qg-stage" data-quiz-q={q.kind} data-quiz-id={q.id} data-qg-stage hidden={i > 0}>
              <div class="qg-host">
                <QuizAnimal kind={q.kind} size={88} label={QUIZ_ANIMALS[q.kind].name} />
                <div class="qg-bubble">
                  <p class="qg-stage-name">
                    ステージ {i + 1}
                    <span class="qg-kind">{QUIZ_KIND_LABELS[q.kind]}</span>
                  </p>
                  <p class="qg-hint">{QUIZ_ANIMALS[q.kind].hint}</p>
                </div>
              </div>
              <p class="quiz-prompt">{q.prompt}</p>
              <TakeBody q={q} />
            </li>
          ))}
          {/* 採点のボタンを最後の問題に置かないのは、3D のゲームで「ゴールの島に着いたら採点」という区切りにするため。2D でも同じ流れにそろえる */}
          <li class="quiz-q qg-stage qg-goal-stage" data-qg-stage data-qg-goal hidden>
            <div class="qg-host">
              <span class="qg-goal-flag" aria-hidden="true">
                <Icon name="flag" size={44} />
              </span>
              <div class="qg-bubble">
                <p class="qg-stage-name">ゴール</p>
                <p class="qg-hint">
                  {action
                    ? 'ここまでおつかれさま！ ぜんぶのステージに答えたら、こたえあわせをしよう。'
                    : '学生には、ここに「こたえあわせ」のボタンが出ます。'}
                </p>
              </div>
            </div>
            <p class="qg-goal-count">
              答えたステージ <strong data-qg-done>0</strong> / {count}
            </p>
            {action && (
              <Button type="submit" size="lg" variant="success" icon="check" data-qg-submit>
                こたえあわせ
              </Button>
            )}
          </li>
        </ol>
        <div class="qg-panel-foot">
          <Button size="lg" data-qg-close>
            とじる
            <kbd class="qg-help-keys">Esc</kbd>
          </Button>
          <Button size="lg" variant="primary" icon="check" data-qg-answer>
            こたえる！
          </Button>
        </div>
      </div>
      <div class="qg-nav">
        <Button size="lg" icon="chevronLeft" data-qg-go="-1" disabled>
          もどる
        </Button>
        <p class="qg-count" aria-live="polite">
          <strong data-qg-now>1</strong>
          <span data-qg-of> / {count}</span>
        </p>
        <Button size="lg" variant="primary" iconEnd="chevronRight" data-qg-go="1">
          つぎへ
        </Button>
      </div>
    </>
  )
  return (
    <>
      <p class="qg-lead">
        全 {count} ステージ。{passCount(count, passPercent)} 問以上の正解でクリア！
      </p>
      {action ? (
        <form
          method="post"
          action={action}
          class="quiz-form"
          data-quiz-form
          data-quiz-game
          data-qg-check={`${quiz.base}/check`}
          data-loading-form
        >
          {body}
        </form>
      ) : (
        <div class="quiz-form" data-quiz-game data-qg-check={`${quiz.base}/check`}>
          {body}
        </div>
      )}
    </>
  )
}

const CONFETTI = 16

const GameResult = ({ quiz, mine, latest }: { quiz: QuizView; mine: NonNullable<QuizView['mine']>; latest: QuizAttemptView }) => {
  const { score, passed } = latest
  const stars = quizStars(score, passed)
  const full = mine.count >= MAX_QUIZ_ATTEMPTS
  const kinds = QUIZ_KINDS.filter((kind) => latest.review.some((item) => item.question.kind === kind))
  const need = passCount(score.total, quiz.passPercent) - score.correct
  return (
    <>
      <div class={cx('qg-result', passed && 'is-clear')}>
        {passed && (
          <span class="qg-confetti" aria-hidden="true">
            {range(CONFETTI).map((i) => (
              <i style={`--i: ${i}`} />
            ))}
          </span>
        )}
        <div class="qg-world" data-qg-world="result" data-kinds={kinds.join(',')} data-stars={stars} data-passed={passed || undefined}>
          <div class="qg-crowd">
            {kinds.map((kind) => (
              <QuizAnimal kind={kind} size={56} mood={passed ? 'happy' : 'sad'} />
            ))}
          </div>
          <div class="qg-stars" aria-hidden="true">
            {range(3).map((i) => (
              <span class={cx('qg-star', i < stars && 'is-on')}>
                <Icon name="star" size={44} />
              </span>
            ))}
          </div>
        </div>
        <p class="qg-result-title">{stars === 3 ? 'パーフェクト！' : passed ? 'ステージクリア！' : 'あとすこし！'}</p>
        {/* 星の数を文字でも置くのは、3D に切り替わると 2D の星を隠すので、読み上げで数が伝わらなくなるため */}
        <p class="sr-only">星 {stars} つ（3 つ中）</p>
        <p class="qg-result-score">
          <strong>{score.correct}</strong> / {score.total} 問正解
        </p>
        <p class="muted small">
          {formatDateTime(latest.createdAt)} · {mine.count} 回目のチャレンジ
          {mine.count > 1 && mine.best && ` · これまでの最高 ${mine.best.correct} / ${mine.best.total}`}
          {!passed && need > 0 && ` · あと ${need} 問でクリア`}
        </p>
        {!full && (
          <Button href={`${quiz.itemUrl}?retake=1`} size="lg" icon="arrowPath" variant={passed ? 'default' : 'primary'}>
            もう一度チャレンジ
          </Button>
        )}
      </div>
      {full && <Alert tone="info">受けられる回数の上限（{MAX_QUIZ_ATTEMPTS} 回）に達しました。</Alert>}
      <h2 class="qg-review-title">ふりかえり</h2>
      <QuizReview items={latest.review} look="game" />
    </>
  )
}

/**
 * アイテムの画面の小テスト。学生には解答の画面か、いちばん新しい受験の結果を出す。
 * 教師には学生と同じ問題を、採点のボタンなしで出す。editHref は教師にだけ渡す編集画面
 */
export const QuizPanel = ({ quiz, editHref }: { quiz: QuizView; editHref?: string }) => {
  useStyle('/src/components/form.css', '/src/components/quiz.css')
  const { mine } = quiz
  const game = quiz.look === 'game'
  const Take = game ? GameTake : TakeForm
  const Shown = game ? GameResult : Result
  if (quiz.questions.length === 0)
    return (
      <EmptyState
        icon="clipboardCheck"
        title="問題はまだありません"
        text={editHref ? '編集画面で問題を作ると、学生が受けられるようになります。' : '問題が用意されるまでお待ちください。'}
        action={
          editHref && (
            <Button href={editHref} variant="primary" icon="pencil">
              問題を作る
            </Button>
          )
        }
      />
    )
  return (
    <section class={cx('quiz', game && 'quiz-game')} aria-label="小テスト">
      {!mine && (
        <div class="quiz-teacher">
          <p class="muted small">学生に見える問題を表示しています。採点のボタンは学生にだけ出ます。正解は編集画面で確かめられます。</p>
          {editHref && (
            <Button href={`${quiz.base}/results`} size="sm" icon="academicCap">
              受験結果
            </Button>
          )}
        </div>
      )}
      {mine?.latest && !mine.retake ? (
        <Shown quiz={quiz} mine={mine} latest={mine.latest} />
      ) : (
        <Take quiz={quiz} action={mine && mine.count < MAX_QUIZ_ATTEMPTS ? `${quiz.base}/submit` : undefined} />
      )}
    </section>
  )
}
