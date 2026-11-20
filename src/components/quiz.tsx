import type { Child } from 'hono/jsx'
import type { FieldErrors } from '../lib/forms'
import {
  LINES_MODES,
  LINES_MODE_LABELS,
  MAX_QUIZ_ATTEMPTS,
  ORDER_ASKS,
  ORDER_ASK_LABELS,
  QUIZ_KEY_SLOT,
  QUIZ_KINDS,
  QUIZ_KIND_DESCRIPTIONS,
  QUIZ_KIND_LABELS,
  QUIZ_LOOK_LABELS,
  answerField,
  blankFormRow,
  codeLines,
  isSameCell,
  lineAt,
  parseSteps,
  quizStars,
  type BlankPart,
  type OrderAsk,
  type QuizFormRow,
  type QuizKind,
  type QuizLook,
  type QuizReviewItem,
  type QuizReviewStatus,
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
  short: 'terminal',
  blank: 'variable',
  order: 'sort',
  lines: 'bug',
  match: 'arrowLongRight',
  essay: 'pencilSquare',
}

// ---------------------------------------------------------------- 編集画面

const control = (k: string, field: string, errors: FieldErrors) => ({
  id: `${k}-${field}`,
  name: `${k}.${field}`,
  invalid: !!errors[`${k}.${field}`],
  'aria-describedby': `${k}-${field}-error`,
})

const codeAttrs = { class: 'qz-code', spellcheck: false, autocapitalize: 'none', autocomplete: 'off' } as const

type ListColumn = { label: string; placeholder: string; code?: boolean }

const QzItem = ({
  k,
  field,
  cells,
  columns,
  check,
}: {
  k: string
  field: string
  cells: string[]
  columns: ListColumn[]
  check?: { label: string; checked: boolean }
}) => (
  <li class="qz-item" data-qz-item>
    {check && <input type="checkbox" checked={check.checked} class="qz-item-check" aria-label={check.label} data-qz-item-check />}
    {columns.map((column, i) =>
      column.code ? (
        <Textarea
          name={`${k}.${field}-item`}
          value={cells[i] ?? ''}
          rows={1}
          {...codeAttrs}
          placeholder={column.placeholder}
          aria-label={column.label}
          data-qz-cell
        />
      ) : (
        <Input
          name={`${k}.${field}-item`}
          value={cells[i] ?? ''}
          placeholder={column.placeholder}
          aria-label={column.label}
          autocomplete="off"
          data-qz-cell
        />
      ),
    )}
    <IconButton icon="x" label="消す" data-qz-item-remove />
  </li>
)

/**
 * 行を足し引きできる欄（選択肢・短答の正しい答え・組み合わせ）。エラーは fieldset（name="<k>.<field>"）に出す。
 * 行ごとの入力欄は同じ名前が並ぶので、エラーの置き場所にできないため
 */
const QzList = ({
  k,
  field,
  legend,
  hint,
  items,
  columns,
  check,
  addLabel,
  errors,
}: {
  k: string
  field: string
  legend: string
  hint?: string
  items: { cells: string[]; checked?: boolean }[]
  columns: ListColumn[]
  /** 行ごとに付ける印（選択の正解）の読み上げの名前 */
  check?: string
  addLabel: string
  errors: FieldErrors
}) => {
  const id = `${k}-${field}`
  const error = errors[`${k}.${field}`]
  return (
    <fieldset
      name={`${k}.${field}`}
      id={id}
      class={cx('field qz-items', error && 'has-error')}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={`${id}-error`}
      data-qz-items={field}
    >
      <legend>{legend}</legend>
      {hint && <p class="field-hint">{hint}</p>}
      <ol class="qz-item-list" data-qz-item-list>
        {items.map((item) => (
          <QzItem
            k={k}
            field={field}
            cells={item.cells}
            columns={columns}
            check={check ? { label: check, checked: !!item.checked } : undefined}
          />
        ))}
      </ol>
      <div class="qz-item-foot">
        <Button size="sm" icon="plus" data-qz-item-add>
          {addLabel}
        </Button>
      </div>
      <FieldError id={id} error={error} />
      <template data-qz-item-template>
        <QzItem k={k} field={field} cells={[]} columns={columns} check={check ? { label: check, checked: false } : undefined} />
      </template>
    </fieldset>
  )
}

/** 問題ごとの選び方（ラジオボタンの組）。値は client.ts が、選ばれているものを読む */
const QzSegment = ({
  k,
  field,
  legend,
  options,
  value,
  hint,
}: {
  k: string
  field: string
  legend: string
  options: { value: string; label: string }[]
  value: string
  hint?: string
}) => (
  <fieldset class="field qz-segment">
    <legend>{legend}</legend>
    <SegmentedControl
      name={`${k}.${field}`}
      label={legend}
      options={options}
      value={options.some((o) => o.value === value) ? value : options[0].value}
    />
    {hint && <p class="field-hint">{hint}</p>}
  </fieldset>
)

const DISTINGUISH = [
  { value: '0', label: '区別する' },
  { value: '1', label: '区別しない' },
]

const lineNote = (line: string | null) => (line === null ? '' : line.trim() || '（空の行）')

const BLANK_HINTS = {
  code: '答えさせたいところを {{正解}} と書きます。別解は {{正解|別解}} のように | で区切ります（| そのものは \\| と書きます）。空白と、引用符の種類（\' と "）の違いは区別せずに採点します。',
  table:
    '1 行目に見出し、2 行目からは中身を、| で区切って書きます。答えさせたいマスは {{正解}} と書きます。別解は {{正解|別解}} のように区切ります。',
} as const

const BLANK_PLACEHOLDERS = {
  code: 'total = 0\nfor i in range(1, 4):\n    total {{+=}} i\nprint({{total}})',
  table: '回 | i | total\n1 | {{1}} | {{1}}\n2 | {{2}} | {{3}}\n3 | {{3}} | {{6}}',
} as const

type WhenField = 'layout' | 'fill' | 'ask'

/** 問題ごとの選び方（field）が value のときだけ出す部分。選び直したときの切り替えは client.ts（qzWhen） */
const When = ({
  row,
  field,
  value,
  block,
  children,
}: {
  row: QuizFormRow
  field: WhenField
  value: string
  block?: boolean
  children: Child
}) =>
  block ? (
    <div data-qz-when={`${field}=${value}`} hidden={row[field] !== value}>
      {children}
    </div>
  ) : (
    <span data-qz-when={`${field}=${value}`} hidden={row[field] !== value}>
      {children}
    </span>
  )

const ORDER_HINTS: Record<OrderAsk, string> = {
  order: '1 行ずつ、正しい順に書きます。学生には順を混ぜて出し、字下げはそのまま見せます。正しい順が 1 つに決まるコードにしてください。',
  indent: '正しい字下げを付けたまま、正しい順に書きます。学生には順はそのままで字下げを消して出し、行ごとに付け直してもらいます。',
  both: '正しい字下げを付けたまま、正しい順に書きます。学生には順を混ぜ、字下げを消して出します。空白の数ではなく、字下げの深さが合っていれば正解です。',
}

function QzFields({ row, errors }: { row: QuizFormRow; errors: FieldErrors }) {
  const { k, kind } = row
  const error = (field: string) => errors[`${k}.${field}`]
  const codeHint =
    kind === 'blank'
      ? '本文の前に見せるコードです。変数の値を表に書かせるときは、ここに追うコードを書きます。'
      : kind === 'lines'
        ? '学生には、行の番号を付けて出します。'
        : undefined
  return (
    <div class="qz-fields">
      <FormField id={`${k}-prompt`} label="問題文" error={error('prompt')}>
        <Textarea {...control(k, 'prompt', errors)} value={row.prompt} rows={2} />
      </FormField>
      <FormField id={`${k}-code`} label={kind === 'lines' ? 'コード' : 'コード（任意）'} error={error('code')} hint={codeHint}>
        <Textarea {...control(k, 'code', errors)} {...codeAttrs} value={row.code} rows={kind === 'lines' ? 6 : 3} data-qz-code />
      </FormField>
      {kind === 'choice' && (
        <>
          <QzSegment
            k={k}
            field="multiple"
            legend="選び方"
            options={[
              { value: '0', label: '1 つ選ぶ' },
              { value: '1', label: '複数選ぶ' },
            ]}
            value={row.multiple}
            hint="複数選ぶときは、正解をすべて選んだ答えだけを正解にします。"
          />
          <QzList
            k={k}
            field="choices"
            legend="選択肢"
            hint="左の四角で、正解の選択肢に印を付けます。学生には、この順のまま出します。"
            items={row.choices.map((text, i) => ({ cells: [text], checked: row.correct[i] }))}
            columns={[{ label: '選択肢', placeholder: '選択肢' }]}
            check="この選択肢を正解にする"
            addLabel="選択肢を追加"
            errors={errors}
          />
        </>
      )}
      {kind === 'short' && (
        <>
          <QzList
            k={k}
            field="answers"
            legend="正しい答え"
            hint="どれか 1 つと合えば正解です。行末の空白、前後の空行、全角と半角の違いは区別しません。複数行の答え（出力など）も書けます。"
            items={row.answers.map((text) => ({ cells: [text] }))}
            columns={[{ label: '正しい答え', placeholder: '正しい答え', code: true }]}
            addLabel="正しい答えを追加"
            errors={errors}
          />
          <div class="qz-segments">
            <QzSegment k={k} field="space" legend="空白" options={DISTINGUISH} value={row.space} />
            <QzSegment k={k} field="case" legend="大文字と小文字" options={DISTINGUISH} value={row.case} />
          </div>
        </>
      )}
      {kind === 'blank' && (
        <>
          <div class="qz-segments">
            <QzSegment
              k={k}
              field="layout"
              legend="本文の形"
              options={[
                { value: 'code', label: 'コード' },
                { value: 'table', label: '表' },
              ]}
              value={row.layout}
            />
            <QzSegment
              k={k}
              field="fill"
              legend="答え方"
              options={[
                { value: 'type', label: '打ちこむ' },
                { value: 'pick', label: '選ぶ' },
              ]}
              value={row.fill}
            />
          </div>
          <FormField
            id={`${k}-text`}
            label="空欄のある本文"
            error={error('text')}
            hint={
              <>
                <When row={row} field="layout" value="code">
                  {BLANK_HINTS.code}
                </When>
                <When row={row} field="layout" value="table">
                  {BLANK_HINTS.table}
                </When>
              </>
            }
          >
            <Textarea
              {...control(k, 'text', errors)}
              {...codeAttrs}
              value={row.text}
              rows={6}
              placeholder={BLANK_PLACEHOLDERS[row.layout === 'table' ? 'table' : 'code']}
              data-placeholder-code={BLANK_PLACEHOLDERS.code}
              data-placeholder-table={BLANK_PLACEHOLDERS.table}
              data-qz-blank-text
            />
          </FormField>
          <When row={row} field="fill" value="pick" block>
            <FormField
              id={`${k}-extras`}
              label="選択肢に混ぜるもの（任意）"
              error={error('extras')}
              hint="選んで答えるときの選択肢は、すべての空欄の正解（最初に書いたもの）です。まぎらわしいものを、1 行に 1 つ書いて足せます。"
            >
              <Textarea {...control(k, 'extras', errors)} {...codeAttrs} value={row.extras} rows={3} />
            </FormField>
          </When>
        </>
      )}
      {kind === 'order' && (
        <>
          <QzSegment
            k={k}
            field="ask"
            legend="答えさせるもの"
            options={ORDER_ASKS.map((ask) => ({ value: ask, label: ORDER_ASK_LABELS[ask] }))}
            value={row.ask}
          />
          <FormField
            id={`${k}-lines`}
            label="正しい順の行"
            error={error('lines')}
            hint={ORDER_ASKS.map((ask) => (
              <When row={row} field="ask" value={ask}>
                {ORDER_HINTS[ask]}
              </When>
            ))}
          >
            <Textarea {...control(k, 'lines', errors)} {...codeAttrs} value={row.lines} rows={6} data-qz-order-lines />
          </FormField>
          <FormField
            id={`${k}-extras`}
            label="使わない行（任意）"
            error={error('extras')}
            hint="まぎらわしい行を、1 行に 1 つ書くと混ぜて出します。学生はそれを「使わない」にします。"
          >
            <Textarea {...control(k, 'extras', errors)} {...codeAttrs} value={row.extras} rows={2} />
          </FormField>
        </>
      )}
      {kind === 'lines' && (
        <>
          <QzSegment
            k={k}
            field="mode"
            legend="選び方"
            options={LINES_MODES.map((mode) => ({ value: mode, label: LINES_MODE_LABELS[mode] }))}
            value={row.mode}
            hint="「実行される順に」では、学生は実行される順に行を押していきます。繰り返しで何度も実行される行は、その回数だけ押します。"
          />
          <FormField
            id={`${k}-steps`}
            label="正解の行の番号"
            error={error('steps')}
            hint="行の番号をカンマで区切って書きます。「実行される順に」では、実行される順に、何度も実行される行はその回数だけ書きます。"
          >
            <Input {...control(k, 'steps', errors)} value={row.steps} autocomplete="off" placeholder="例: 4, 1, 2, 5" data-qz-steps />
            <ol class="qz-flow-steps" data-qz-flow-steps>
              {(parseSteps(row.steps) ?? []).map((n) => (
                <li>
                  <span class="qz-flow-no">{n}</span>
                  <code class="truncate">{lineNote(lineAt(row.code, n)) || '（行がありません）'}</code>
                </li>
              ))}
            </ol>
          </FormField>
        </>
      )}
      {kind === 'match' && (
        <>
          <QzList
            k={k}
            field="pairs"
            legend="組み合わせ"
            hint="左の項目と、それに合う右の項目を書きます。学生には、右の項目を混ぜて選択肢にして出します。右は同じものを何度使ってもかまいません。"
            items={row.pairs.map((pair) => ({ cells: pair }))}
            columns={[
              { label: '左の項目', placeholder: '左' },
              { label: '右の項目', placeholder: '右' },
            ]}
            addLabel="組み合わせを追加"
            errors={errors}
          />
          <FormField
            id={`${k}-extras`}
            label="選択肢に混ぜるもの（任意）"
            error={error('extras')}
            hint="どの左にも合わない右の項目を、1 行に 1 つ書いて足せます。"
          >
            <Textarea {...control(k, 'extras', errors)} value={row.extras} rows={2} />
          </FormField>
        </>
      )}
      {kind === 'essay' && (
        <>
          <FormField
            id={`${k}-keywords`}
            label="自動で正解にするキーワード（任意）"
            error={error('keywords')}
            hint="すべて含む答えを、自動で正解にします。含まない答えと、キーワードがないときは「採点待ち」になり、受験結果の画面で教師が採点します。自動で正解にした答えも、あとから変えられます。1 行かカンマで区切って書きます。"
          >
            <Textarea {...control(k, 'keywords', errors)} value={row.keywords} rows={2} placeholder="例: 合計, 繰り返し" />
          </FormField>
          <FormField id={`${k}-sample`} label="解答例（任意）" error={error('sample')} hint="採点のあとに、正解として見せます。">
            <Textarea {...control(k, 'sample', errors)} value={row.sample} rows={3} />
          </FormField>
        </>
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
          <QzQuestion row={blankFormRow(QUIZ_KEY_SLOT, kind)} errors={{}} />
        </template>
      ))}
    </div>
  )
}

const QUESTIONS_DESCRIPTION =
  '記述のほかは、正解との照合で採点します。記述は教師が採点します（キーワードを決めておくと自動で正解にできます）。問題を書き換えても、すでに受けた学生の点数は変わりません。'

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
      hint="正解の割合がこれ以上の受験を合格にします。採点待ちの記述は、採点されるまで正解に数えません。"
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
      ゲームは中学生向けの見た目です。3D
      のダンジョンで、問題ごとの扉を正解して開けながら進みます。点数は、問題ごとの最初の答えで数えます。記述の扉は、答えを書けば開きます。
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

type LineMark = 'right' | 'wrong' | 'answer' | 'picked'

const LINE_MARK_LABELS: Record<LineMark, string> = { right: '答え', wrong: '答え', answer: '正解の行', picked: '答え' }

const LineBody = ({ no, line }: { no: number; line: string }) => (
  <>
    <span class="quiz-line-no">{no}</span>
    <code>{line || ' '}</code>
  </>
)

/** 行番号付きのコード。pick を渡すと行を選べ（multiple なら複数）、marks を渡すと結果の印を付ける */
const CodeLines = ({
  code,
  pick,
  multiple = false,
  marks = {},
  who = 'あなた',
}: {
  code: string
  pick?: string
  multiple?: boolean
  marks?: Partial<Record<number, LineMark>>
  who?: string
}) => (
  <ol class="quiz-lines" role={pick && !multiple ? 'radiogroup' : pick ? 'group' : undefined} aria-label={pick ? '行' : undefined}>
    {codeLines(code).map((line, i) => {
      const mark = marks[i + 1]
      const body = (
        <>
          <LineBody no={i + 1} line={line} />
          {mark && <span class="quiz-line-mark">{mark === 'answer' ? LINE_MARK_LABELS.answer : `${who}の${LINE_MARK_LABELS[mark]}`}</span>}
        </>
      )
      return (
        <li class={cx('quiz-line', mark && `is-${mark}`)}>
          {pick && line.trim() ? (
            <label>
              <input type={multiple ? 'checkbox' : 'radio'} name={pick} value={i + 1} class="sr-only" />
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

/** 実行される順に行を選ぶ解答。行を押すたびに、その行の番号を順番の最後に足す（client.ts） */
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

const textAttrs = { autocomplete: 'off', autocapitalize: 'none', spellcheck: false } as const

/** 穴埋めの空欄 1 つの入力欄。選んで答えるときは選択肢の一覧 */
const BlankInput = ({ name, no, options }: { name: string; no: number; options: string[] }) =>
  options.length ? (
    <select name={name} class="quiz-blank-input" aria-label={`空欄 ${no}`} data-quiz-blank>
      <option value="">選ぶ</option>
      {options.map((o) => (
        <option value={o}>{o}</option>
      ))}
    </select>
  ) : (
    <input name={name} class="quiz-blank-input" aria-label={`空欄 ${no}`} {...textAttrs} data-quiz-blank />
  )

type BlankCellView = (part: number) => Child

/** 穴埋めの本文。空欄の中身は blank が描く（解答の入力欄か、結果の答え） */
function BlankSheet({ q, blank }: { q: Extract<QuizTakeQuestion, { kind: 'blank' }>; blank: BlankCellView }) {
  const parts = (cell: BlankPart[]) =>
    cell.map((part) =>
      typeof part === 'number' ? (
        <span class="quiz-blank">
          <span class="quiz-blank-no" aria-hidden="true">
            {part + 1}
          </span>
          {blank(part)}
        </span>
      ) : (
        part
      ),
    )
  if (q.layout === 'code')
    return (
      <pre class="quiz-code quiz-blank-code">
        <code>{q.rows.flatMap((cells, r) => [...(r > 0 ? ['\n'] : []), ...parts(cells[0] ?? [])])}</code>
      </pre>
    )
  const [head = [], ...body] = q.rows
  return (
    <div class="quiz-table-wrap">
      <table class="quiz-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th scope="col">{parts(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells) => (
            <tr>
              {cells.map((cell) => (
                <td>{parts(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TakeBody({ q }: { q: QuizTakeQuestion }) {
  const name = answerField(q)
  switch (q.kind) {
    case 'choice':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          {q.multiple && <p class="quiz-note muted small">当てはまるものをすべて選んでください。</p>}
          <div class="quiz-choices" role={q.multiple ? 'group' : 'radiogroup'} aria-label="選択肢">
            {q.choices.map((text, i) => (
              <label class="quiz-choice">
                <input type={q.multiple ? 'checkbox' : 'radio'} name={name} value={i} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </>
      )
    case 'short':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          {q.multiline ? (
            <Textarea name={name} rows={3} {...codeAttrs} class="quiz-output" placeholder="答えを入力" aria-label="答え" data-quiz-text />
          ) : (
            <Input name={name} {...textAttrs} class="quiz-short" placeholder="答えを入力" aria-label="答え" data-quiz-text />
          )}
        </>
      )
    case 'blank':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <BlankSheet q={q} blank={(i) => <BlankInput name={name} no={i + 1} options={q.options} />} />
        </>
      )
    case 'order': {
      const reorder = q.ask !== 'indent'
      const indent = q.ask !== 'order'
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          {q.unused && <p class="quiz-note muted small">使わない行が混ざっています。使わない行は「使わない」にしてください。</p>}
          <ol class={cx('quiz-order', indent && 'is-indent', !reorder && 'is-fixed')} data-quiz-order>
            {q.lines.map((line) => (
              <li class="quiz-order-line" data-quiz-line data-line={line} style={indent ? '--level: 0' : undefined}>
                {reorder && (
                  <span class="quiz-order-grip" data-quiz-grip aria-hidden="true">
                    <Icon name="grip" size={16} />
                  </span>
                )}
                <input type="hidden" name={name} value={line} data-quiz-line-value />
                {indent && <IconButton icon="chevronLeft" label="字下げを浅くする" data-quiz-indent-move="-1" disabled />}
                {indent && <IconButton icon="chevronRight" label="字下げを深くする" data-quiz-indent-move="1" />}
                <code>{line}</code>
                {q.unused && (
                  <Button size="sm" variant="ghost" class="quiz-order-use" aria-pressed="false" data-quiz-line-use>
                    使わない
                  </Button>
                )}
                {reorder && <IconButton icon="arrowUp" label="上へ移動" data-quiz-line-move="up" />}
                {reorder && <IconButton icon="arrowDown" label="下へ移動" data-quiz-line-move="down" />}
              </li>
            ))}
          </ol>
        </>
      )
    }
    case 'lines':
      if (q.mode === 'sequence') return <FlowPicker code={q.code} name={name} />
      return (
        <>
          {q.mode === 'many' && <p class="quiz-note muted small">当てはまる行をすべて選んでください。</p>}
          <CodeLines code={q.code} pick={name} multiple={q.mode === 'many'} />
        </>
      )
    case 'match':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <ol class="quiz-match">
            {q.lefts.map((left) => (
              <li class="quiz-match-row">
                <span class="quiz-match-left">{left}</span>
                <Icon name="arrowLongRight" size={18} class="quiz-match-arrow" />
                <select name={name} class="input quiz-match-pick" aria-label={`「${left}」に合うもの`} data-quiz-match>
                  <option value="">選ぶ</option>
                  {q.options.map((o) => (
                    <option value={o}>{o}</option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        </>
      )
    case 'essay':
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <Textarea name={name} rows={5} class="quiz-essay" placeholder="答えを入力" aria-label="答え" data-quiz-text />
        </>
      )
  }
}

const STATUS_LABELS: Record<QuizLook, Record<QuizReviewStatus, string>> = {
  plain: { right: '正解', wrong: '不正解', pending: '採点待ち', none: '未採点' },
  game: { right: 'せいかい！', wrong: 'おしい…', pending: '先生が採点中', none: '未採点' },
}

const STATUS_ICONS: Partial<Record<QuizReviewStatus, IconName>> = { right: 'check', wrong: 'x', pending: 'clock' }

const Question = ({
  no,
  q,
  status,
  look = 'plain',
  children,
}: {
  no: number
  q: QuizTakeQuestion
  status?: QuizReviewStatus
  look?: QuizLook
  children: Child
}) => {
  const icon = status && STATUS_ICONS[status]
  return (
    <li class={cx('quiz-q', status && `is-${status}`)} data-quiz-q={q.kind}>
      <div class="quiz-q-head">
        {look === 'game' && (
          <QuizAnimal kind={q.kind} size={44} mood={status === 'right' ? 'happy' : status === 'wrong' ? 'sad' : 'normal'} />
        )}
        <span class="quiz-q-num">{look === 'game' ? `ステージ ${no}` : `問 ${no}`}</span>
        <span class="quiz-q-kind muted small">{QUIZ_KIND_LABELS[q.kind]}</span>
        {status && (
          <span class="quiz-mark">
            {icon && <Icon name={icon} size={14} />}
            {STATUS_LABELS[look][status]}
          </span>
        )}
      </div>
      <p class="quiz-prompt">{q.prompt}</p>
      {children}
    </li>
  )
}

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
        {questions.some((q) => q.kind === 'essay') && '記述の問題は、先生が採点します。'}
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
  status,
  mine,
  answer,
  correct,
  solution,
}: {
  status: QuizReviewStatus
  /** 答えの見出し */
  mine: string
  answer: Child
  /** 正解の見出し */
  correct: string
  solution: Child
}) => (
  <div class="quiz-compare">
    <div class={cx('quiz-compare-side', status === 'wrong' ? 'is-wrong' : status === 'right' ? 'is-right' : 'is-plain')}>
      <span class="quiz-compare-label">{mine}</span>
      {answer ?? <p class="muted small">答えていません。</p>}
    </div>
    {status !== 'right' && solution && (
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
const tablesOf = (v: unknown) => (Array.isArray(v) && v.every((s) => Array.isArray(s)) ? (v as string[][]) : null)
const picksOf = (v: unknown) => (typeof v === 'number' ? [v] : (numbersOf(v) ?? []))

const NotAnswered = ({ answer }: { answer: unknown }) => (answer === null ? <p class="muted small">答えていません。</p> : null)

function ReviewBody({ item, who }: { item: QuizReviewItem; who: string }) {
  const { question: q, answer, status, solution } = item
  switch (q.kind) {
    case 'choice': {
      const picked = picksOf(answer)
      const right = solution ? picksOf(solution.answer) : null
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <ul class="quiz-choices is-review">
            {q.choices.map((text, i) => {
              const mine = picked.includes(i)
              const good = right?.includes(i)
              const mark = mine
                ? right
                  ? good
                    ? 'is-right'
                    : 'is-wrong'
                  : status === 'right'
                    ? 'is-right'
                    : 'is-picked'
                : good && 'is-answer'
              return (
                <li class={cx('quiz-choice', mark)}>
                  <span class="quiz-choice-dot" aria-hidden="true" />
                  <span>{text}</span>
                  {mine && <span class="quiz-line-mark">{who}の答え</span>}
                  {!mine && good && <span class="quiz-line-mark">正解</span>}
                </li>
              )
            })}
          </ul>
          <NotAnswered answer={answer} />
        </>
      )
    }
    case 'short': {
      const right = stringsOf(solution?.answer)
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <Compare
            status={status}
            mine={`${who}の答え`}
            answer={typeof answer === 'string' ? <CodeBlock code={answer} /> : null}
            correct={right && right.length > 1 ? '正しい答え（どれか 1 つ）' : '正しい答え'}
            solution={right && right.map((a) => <CodeBlock code={a} />)}
          />
        </>
      )
    }
    case 'blank': {
      const mine = stringsOf(answer)
      const right = tablesOf(solution?.answer)
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <BlankSheet
            q={q}
            blank={(i) => {
              const value = mine?.[i] ?? ''
              const expected = right?.[i]
              const same = expected ? isSameCell(value, expected) : status === 'right' ? true : null
              return (
                <span class={cx('quiz-blank-value', same === true && 'is-right', same === false && 'is-wrong')}>
                  <code>{value || '—'}</code>
                  {same === false && expected && <span class="quiz-cell-answer">正: {expected[0]}</span>}
                </span>
              )
            }}
          />
          <NotAnswered answer={answer} />
        </>
      )
    }
    case 'order': {
      const mine = stringsOf(answer)
      const right = stringsOf(solution?.answer)
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <Compare
            status={status}
            mine={`${who}の並び`}
            answer={mine && <CodeBlock code={mine.join('\n')} />}
            correct="正しい並び"
            solution={right && <CodeBlock code={right.join('\n')} />}
          />
        </>
      )
    }
    case 'lines': {
      const right = numbersOf(solution?.answer)
      if (q.mode === 'sequence') {
        const mine = numbersOf(answer)
        return (
          <>
            <CodeLines code={q.code} />
            <Compare
              status={status}
              mine={`${who}の順番`}
              answer={mine && <Steps steps={mine} compare={status === 'wrong' ? (right ?? undefined) : undefined} />}
              correct="正しい順番"
              solution={right && <Steps steps={right} />}
            />
          </>
        )
      }
      const marks: Partial<Record<number, LineMark>> = {}
      for (const n of right ?? []) marks[n] = 'answer'
      for (const n of picksOf(answer)) marks[n] = right ? (right.includes(n) ? 'right' : 'wrong') : status === 'right' ? 'right' : 'picked'
      return (
        <>
          <CodeLines code={q.code} marks={marks} who={who} />
          <NotAnswered answer={answer} />
        </>
      )
    }
    case 'match': {
      const mine = stringsOf(answer)
      const right = stringsOf(solution?.answer)
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <ol class="quiz-match is-review">
            {q.lefts.map((left, i) => {
              const value = mine?.[i] ?? ''
              const expected = right?.[i]
              const same = expected !== undefined ? value === expected : status === 'right' ? true : null
              return (
                <li class={cx('quiz-match-row', same === true && 'is-right', same === false && 'is-wrong')}>
                  <span class="quiz-match-left">{left}</span>
                  <Icon name="arrowLongRight" size={18} class="quiz-match-arrow" />
                  <span class="quiz-match-value">
                    {value || '—'}
                    {same === false && <span class="quiz-cell-answer">正: {expected}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
          <NotAnswered answer={answer} />
        </>
      )
    }
    case 'essay': {
      const sample = typeof solution?.answer === 'string' && solution.answer ? solution.answer : null
      return (
        <>
          {q.code && <CodeBlock code={q.code} />}
          <div class={cx('quiz-essay-answer', status === 'right' && 'is-right', status === 'wrong' && 'is-wrong')}>
            <span class="quiz-compare-label">{who}の答え</span>
            {typeof answer === 'string' ? <p>{answer}</p> : <p class="muted small">答えていません。</p>}
          </div>
          {status === 'pending' && <p class="muted small">先生の採点を待っています。</p>}
          {sample && (
            <div class="quiz-essay-answer is-answer">
              <span class="quiz-compare-label">解答例</span>
              <p>{sample}</p>
            </div>
          )}
        </>
      )
    }
  }
}

/** 教師が記述の問題を採点するボタン。押すと、その問題の正誤を変えて点数を数え直す */
const GradeButtons = ({
  action,
  attemptId,
  questionId,
  status,
}: {
  action: string
  attemptId: number
  questionId: string
  status: QuizReviewStatus
}) => (
  <form method="post" action={action} class="quiz-grade" data-loading-form>
    <input type="hidden" name="attempt" value={attemptId} />
    <input type="hidden" name="q" value={questionId} />
    <span class="muted small">{status === 'pending' ? 'この答えを採点してください。' : '採点を変えられます。'}</span>
    <Button
      type="submit"
      size="sm"
      name="verdict"
      value="right"
      icon="check"
      aria-pressed={String(status === 'right')}
      variant={status === 'right' ? 'primary' : 'default'}
    >
      正解
    </Button>
    <Button
      type="submit"
      size="sm"
      name="verdict"
      value="wrong"
      icon="x"
      aria-pressed={String(status === 'wrong')}
      variant={status === 'wrong' ? 'primary' : 'default'}
    >
      不正解
    </Button>
  </form>
)

/** 問題ごとの結果。学生の結果の画面と、教師が学生の受験を見る画面で使う */
export const QuizReview = ({
  items,
  who = 'あなた',
  look = 'plain',
  grade,
}: {
  items: QuizReviewItem[]
  /** 答えた人の呼び方（「あなたの答え」「学生の答え」） */
  who?: string
  /** 教師が学生の受験を見る画面では、どの見た目の小テストでも標準のまま出す */
  look?: QuizLook
  /** 教師が記述を採点するときの送り先と、受験の ID */
  grade?: { action: string; attemptId: number }
}) => {
  useStyle('/src/components/form.css', '/src/components/quiz.css')
  return (
    <ol class="quiz-questions">
      {items.map((item, i) => (
        <Question no={i + 1} q={item.question} status={item.status} look={look}>
          <ReviewBody item={item} who={who} />
          {item.status === 'none' && <p class="muted small">この問題は、受けたあとに足されました。</p>}
          {grade && item.question.kind === 'essay' && item.status !== 'none' && (
            <GradeButtons action={grade.action} attemptId={grade.attemptId} questionId={item.question.id} status={item.status} />
          )}
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

/** 受験 1 回の点数。合格なら「合格」、採点待ちの記述があれば「採点待ち」のチップを付ける */
export const QuizScoreChip = ({ score, passed, pending = 0 }: { score: QuizScore; passed: boolean; pending?: number }) =>
  passed ? (
    <Chip tone="success" icon="check">
      {score.correct} / {score.total} 合格
    </Chip>
  ) : pending > 0 ? (
    <Chip tone="accent" icon="clock">
      {score.correct} / {score.total} 採点待ち {pending}
    </Chip>
  ) : (
    <span class="score">
      {score.correct} / {score.total}
    </span>
  )

const Result = ({ quiz, mine, latest }: { quiz: QuizView; mine: NonNullable<QuizView['mine']>; latest: QuizAttemptView }) => {
  const { score, passed, pending } = latest
  const full = mine.count >= MAX_QUIZ_ATTEMPTS
  const waiting = !passed && pending > 0
  return (
    <>
      <div class={cx('quiz-score', passed ? 'is-passed' : waiting ? 'is-pending' : 'is-failed')}>
        <Mascot act={passed ? 'cheer' : waiting ? 'think' : 'advise'} size={72} stand={false} />
        <div class="quiz-score-text">
          <p class="quiz-score-value">
            <strong>{score.correct}</strong> / {score.total} 問正解
            <Chip tone={passed ? 'success' : waiting ? 'accent' : 'default'} icon={passed ? 'check' : waiting ? 'clock' : undefined}>
              {passed ? '合格' : waiting ? '採点待ち' : '不合格'}
            </Chip>
          </p>
          <p class="muted small">
            {formatDateTime(latest.createdAt)} · {mine.count} 回目
            {mine.count > 1 && mine.best && ` · これまでの最高 ${mine.best.correct} / ${mine.best.total}`}
            {waiting && ` · ${pending} 問は先生の採点を待っています`}
            {!passed && !waiting && ` · ${passCount(score.total, quiz.passPercent)} 問以上の正解で合格`}
          </p>
        </div>
        {!full && (
          <Button href={`${quiz.itemUrl}?retake=1`} icon="arrowPath" variant={passed || waiting ? 'default' : 'primary'}>
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
  const { score, passed, pending } = latest
  const stars = quizStars(score, passed)
  const full = mine.count >= MAX_QUIZ_ATTEMPTS
  const kinds = QUIZ_KINDS.filter((kind) => latest.review.some((item) => item.question.kind === kind))
  const need = passCount(score.total, quiz.passPercent) - score.correct
  const waiting = !passed && pending > 0
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
        <p class="qg-result-title">
          {stars === 3 ? 'パーフェクト！' : passed ? 'ステージクリア！' : waiting ? '先生の採点を待っているよ' : 'あとすこし！'}
        </p>
        {/* 星の数を文字でも置くのは、3D に切り替わると 2D の星を隠すので、読み上げで数が伝わらなくなるため */}
        <p class="sr-only">星 {stars} つ（3 つ中）</p>
        <p class="qg-result-score">
          <strong>{score.correct}</strong> / {score.total} 問正解
        </p>
        <p class="muted small">
          {formatDateTime(latest.createdAt)} · {mine.count} 回目のチャレンジ
          {mine.count > 1 && mine.best && ` · これまでの最高 ${mine.best.correct} / ${mine.best.total}`}
          {waiting && ` · ${pending} 問は先生が採点するよ`}
          {!passed && !waiting && need > 0 && ` · あと ${need} 問でクリア`}
        </p>
        {!full && (
          <Button href={`${quiz.itemUrl}?retake=1`} size="lg" icon="arrowPath" variant={passed || waiting ? 'default' : 'primary'}>
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
