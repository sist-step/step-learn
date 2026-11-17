import type { Child, JSX } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import {
  CODE_FILES,
  CODE_LANGUAGE_LABELS,
  CODE_STAGE_LABELS,
  CONSTRAINT_KINDS,
  CONSTRAINT_KIND_LABELS,
  JUDGES,
  JUDGE_LABELS,
  LONG_SUBMIT_PERIOD,
  MAX_SUBMIT_PERIOD,
  VERDICTS,
  VERDICT_LABELS,
  aheadText,
  appealStateOf,
  buildWebDocument,
  formatPeriodLength,
  formatWait,
  hasCode,
  isCleared,
  isFinalized,
  isSolvable,
  verdictCounts,
  type CodeFiles,
  type CodeLanguage,
  type CodeStage,
  type ConstraintResult,
  type Goal,
  type GradingStatus,
  type Judge,
  type SubmitState,
  type Verdict,
} from '../lib/code'
import { VSCODE_EXTENSION_NAME, VSCODE_MARKETPLACE_URL } from '../lib/bundle'
import type { TrialResult } from '../lib/code-grader'
import { dateTimeInputToUnix, isDateTimeInput } from '../lib/course-period'
import type { FieldErrors } from '../lib/forms'
import type { AppEnv } from '../lib/types'
import { Button, IconButton } from './button'
import { Card, LinkCard } from './card'
import { cx } from './cx'
import { DateTimeField, FieldError, FormField, Input, SegmentedControl, Select, TextAreaField, Textarea } from './form'
import { Icon, type IconName } from './icons'
import { Markdown } from './markdown'
import { Popover } from './overlay'
import { useStyle } from './style'
import { Alert, Chip, formatDateTime } from './ui'

/** エディターの色分けに使う種類。text は色分けなし */
export type CodeSyntax = 'html' | 'css' | 'js' | 'py' | 'text'

/**
 * コードの入力欄。src/code-editor.ts が textarea を CodeMirror のエディターに置き換える。
 * 送信されるのは中の textarea（name）の値で、エディターで書き換えるたびに textarea に input イベントが出る
 */
export const CodeInput = ({
  syntax,
  rows = 10,
  fill,
  class: cls,
  ...rest
}: { syntax: CodeSyntax; rows?: number; fill?: boolean; value?: string; invalid?: boolean; class?: string } & Omit<
  JSX.IntrinsicElements['textarea'],
  'class'
>) => {
  useStyle('/src/components/form.css', '/src/components/code.css')
  return (
    <div class={cx('code-input', fill && 'code-input-fill', cls)} style={`--code-rows: ${rows}`} data-code-input={syntax}>
      <Textarea rows={rows} class="code-input-source" spellcheck={false} autocapitalize="none" autocomplete="off" {...rest} />
      <div class="code-input-host" data-code-host />
    </div>
  )
}

/** キーの表示。mod / alt / shift は、Mac では src/code-editor.ts が ⌘ / ⌥ / ⇧ に書き換える */
const KEY_LABELS: Record<string, string> = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', ctrl: 'Ctrl' }

const CODE_SHORTCUTS: { label: string; keys: string[][]; only?: CodeLanguage }[] = [
  {
    label: '候補を出す',
    keys: [
      ['mod', 'I'],
      ['ctrl', 'Space'],
    ],
  },
  { label: '候補を決める', keys: [['Tab'], ['Enter']] },
  { label: 'コードを整形する', keys: [['shift', 'alt', 'F']], only: 'web' },
  { label: 'コメントにする・戻す', keys: [['mod', '/']] },
  { label: '検索・置換', keys: [['mod', 'F']] },
  { label: '同じ語を続けて選ぶ', keys: [['mod', 'D']] },
  { label: 'カーソルを増やす', keys: [['alt', 'クリック']] },
  {
    label: '行を上下に動かす',
    keys: [
      ['alt', '↑'],
      ['alt', '↓'],
    ],
  },
  { label: '行を複製する', keys: [['shift', 'alt', '↓']] },
  { label: '行を消す', keys: [['shift', 'mod', 'K']] },
  {
    label: '元に戻す・やり直す',
    keys: [
      ['mod', 'Z'],
      ['shift', 'mod', 'Z'],
    ],
  },
  { label: '実行する', keys: [['mod', 'Enter']], only: 'python' },
]

/**
 * コードのエディターの道具（Web のコードの整形と、キーボードショートカットの一覧）。
 * 整形は、同じ data-code-workspace / data-code-starter の中で表示中のファイルに対して src/code-editor.ts が行う
 */
export const CodeEditorTools = ({ language }: { language: CodeLanguage }) => (
  <>
    {language === 'web' && <IconButton icon="format" label="コードを整形（Shift + Alt + F）" data-code-format />}
    <Popover
      class="code-keys"
      panelClass="code-keys-panel"
      trigger={<IconButton as="summary" icon="question" label="キーボードショートカット" />}
    >
      <p class="code-keys-title">キーボードショートカット</p>
      <dl>
        {CODE_SHORTCUTS.filter((s) => !s.only || s.only === language).map((s) => (
          <div>
            <dt>{s.label}</dt>
            <dd>
              {s.keys.map((combo, i) => (
                <>
                  {i > 0 && <span class="muted">/</span>}
                  <span class="code-keys-combo">
                    {combo.map((key) => (
                      <kbd data-code-key={key in KEY_LABELS ? key : undefined}>{KEY_LABELS[key] ?? key}</kbd>
                    ))}
                  </span>
                </>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p class="code-keys-note muted">文字を打つと候補が出ます。HTML では ul&gt;li*3 のような Emmet の略記も使えます。</p>
    </Popover>
  </>
)

export const CodeField = ({
  label,
  name,
  id = `f-${name}`,
  syntax,
  value,
  rows,
  error,
  hint,
}: {
  label: Child
  name: string
  id?: string
  syntax: CodeSyntax
  value?: string
  rows?: number
  error?: string
  hint?: Child
}) => (
  <FormField id={id} label={label} error={error} hint={hint}>
    <CodeInput
      syntax={syntax}
      id={id}
      name={name}
      value={value}
      rows={rows}
      invalid={!!error}
      aria-describedby={hint ? `${id}-error ${id}-desc` : `${id}-error`}
    />
  </FormField>
)

const STDIN_HINT = 'プログラムが input() で読む内容です。学生の画面の入力欄に最初から入り、AI が採点するときの実行にも使います。'

/** アイテムの編集画面の、最初に入れておくコードの欄（教師） */
export const CodeStarterFields = ({
  language,
  starter,
  stdin,
  errors,
  idPrefix = 'f',
}: {
  language: CodeLanguage
  starter: CodeFiles
  stdin: string
  errors: FieldErrors
  idPrefix?: string
}) => (
  <fieldset class="field">
    <legend>最初のコード</legend>
    <p class="field-hint">
      学生が最初に開いたときに入っているコードです（{CODE_LANGUAGE_LABELS[language]}。言語はあとから変えられません）。
    </p>
    <div class="stack">
      {CODE_FILES[language].map((f) => (
        <CodeField
          label={f.name}
          name={f.key}
          id={`${idPrefix}-starter-${f.key}`}
          syntax={f.key}
          value={starter[f.key]}
          rows={8}
          error={errors[f.key]}
        />
      ))}
      {language === 'python' && (
        <CodeField
          label="入力の例"
          name="stdin"
          id={`${idPrefix}-starter-stdin`}
          syntax="text"
          value={stdin}
          rows={3}
          error={errors.stdin}
          hint={STDIN_HINT}
        />
      )}
    </div>
  </fieldset>
)

const SOLUTION_DESCRIPTION =
  'すべての制約を満たすコードの例です（任意）。AI が判定の参考にし、「試しに判定」で、制約が思ったとおりに判定されるかを確かめられます。'

/** 解答例を学生に見せるかの切り替え */
const SolutionPublicField = ({ checked }: { checked: boolean }) => (
  <fieldset class="field">
    <legend>学生への公開</legend>
    <SegmentedControl
      name="solution_public"
      label="解答例の学生への公開"
      options={[
        { value: '0', label: '見せない', icon: 'eyeSlash' },
        { value: '1', label: '提出の期間が終わったら見せる', icon: 'eye' },
      ]}
      value={checked ? '1' : '0'}
    />
  </fieldset>
)

/**
 * 「試しに判定」のボタンと結果の置き場所。押すと src/code-editor.ts が、同じフォームの保存前の問題文・最初のコード・解答例・制約を
 * action に送り、返ってきた結果（CodeTrialResult）をここに入れる
 */
const CodeTrial = ({ action }: { action: string }) => (
  <div class="code-trial" data-code-trial>
    <div class="code-trial-head">
      <Button size="sm" icon="play" data-code-trial-run={action}>
        試しに判定
      </Button>
      <span class="muted small" role="status" data-code-trial-status>
        解答例と最初のコードを、学生の提出と同じように AI が判定します（30 秒ほど）。
      </span>
    </div>
    <div class="code-trial-result" aria-live="polite" data-code-trial-result />
  </div>
)

/** Moodle モードの入力欄の、解答例の欄（教師）。通常モードの CodeSolutionCard と同じものを、1 枚のカードの中に並べる */
export const CodeSolutionFields = ({
  language,
  solution,
  solutionPublic,
  trial,
  errors,
  idPrefix = 'f',
}: {
  language: CodeLanguage
  solution: CodeFiles
  solutionPublic: boolean
  /** 試しに判定する送信先（/code/trial）。AI がないときは渡さない */
  trial?: string
  errors: FieldErrors
  idPrefix?: string
}) => (
  <fieldset class="field">
    <legend>解答例</legend>
    <p class="field-hint">{SOLUTION_DESCRIPTION}</p>
    <div class="stack">
      {CODE_FILES[language].map((f) => (
        <CodeField
          label={f.name}
          name={`solution_${f.key}`}
          id={`${idPrefix}-solution-${f.key}`}
          syntax={f.key}
          value={solution[f.key]}
          rows={8}
          error={errors[`solution_${f.key}`]}
        />
      ))}
      <SolutionPublicField checked={solutionPublic} />
      {trial && <CodeTrial action={trial} />}
    </div>
  </fieldset>
)

const gradingDescription = (gradingEnabled: boolean) =>
  gradingEnabled
    ? '学生が提出すると、AI が制約ごとに「できている・一部できている・できていない」を判定します。'
    : 'AI が設定されていないため、判定されません。提出の画面で教師がコメントを書きます。'

const CRITERIA_HINT = '制約にしにくい、見てほしい点（読みやすさなど）を書きます。AI が判定と講評の参考にします。学生には表示されません。'

/** Moodle モードの入力欄の、判定の欄（教師）。通常モードの CodeGradingCard と同じく、制約と補足を書く */
export const CodeGradingFields = ({
  gradingEnabled,
  criteria,
  constraints,
  suggest,
  errors,
  idPrefix = 'f',
}: {
  /** AI が設定されていて、提出を判定するか */
  gradingEnabled: boolean
  criteria: string
  constraints: ConstraintRow[]
  /** 制約を AI で作る送信先（/code/constraints）。AI がないときと、追加の画面では渡さない */
  suggest?: string
  errors: FieldErrors
  idPrefix?: string
}) => (
  <fieldset class="field">
    <legend>判定</legend>
    <p class="field-hint">{gradingDescription(gradingEnabled)}</p>
    <div class="stack">
      <CodeConstraintsField constraints={constraints} suggest={suggest} errors={errors} idPrefix={idPrefix} mode="moodle" />
      <TextAreaField
        label="補足（任意）"
        name="criteria"
        id={`${idPrefix}-criteria`}
        rows={3}
        value={criteria}
        error={errors.criteria}
        hint={CRITERIA_HINT}
      />
    </div>
  </fieldset>
)

/** AI アシスタントに送る、コーディング問題を整え始める最初の発言 */
const ASSIST_MESSAGE = 'このコーディング問題の問題文と制約を、一緒に整えてください。'

/**
 * アイテムの編集画面の、AI に手伝わせるボタンの帯（教師）。
 * suggest を渡すと「下書きを作る」を出し、押すと src/code-editor.ts が問題文を送って、返ってきた最初のコードと制約を同じフォームの欄に入れる。
 * AI のパネルを使える人には「AI と相談する」を出し、押すと client.ts が、このアイテムを選んだ新しいチャットをパネルで始める
 */
export const CodeAiHelp = ({ suggest, item }: { suggest?: string; item: { courseId: number; itemId: number; title: string } }) => {
  useStyle('/src/components/code.css')
  const canAsk = !!useRequestContext<AppEnv>().var.aiPanel
  if (!suggest && !canAsk) return null
  const start = {
    focus: `${item.courseId}/${item.itemId}`,
    title: item.title,
    href: `/courses/${item.courseId}/items/${item.itemId}/edit`,
    message: ASSIST_MESSAGE,
  }
  return (
    <div class="code-suggest">
      <p class="muted small" role="status" data-code-suggest-status>
        {suggest && canAsk
          ? '問題文から最初のコードと制約の下書きを AI で作るか、AI アシスタントと相談しながら問題文と制約を整えられます。'
          : suggest
            ? '問題文から、最初のコードと制約の下書きを AI で作れます（30 秒ほど）。'
            : 'AI アシスタントと相談しながら、問題文と制約を整えられます。足りないところは、質問に答えながら一緒に埋めます。'}
      </p>
      <div class="code-suggest-actions">
        {suggest && (
          <Button size="sm" icon="sparkles" data-code-suggest={suggest}>
            下書きを作る
          </Button>
        )}
        {canAsk && (
          <Button size="sm" icon="assistant" data-ai-focus-start={JSON.stringify(start)}>
            AI と相談する
          </Button>
        )}
      </div>
    </div>
  )
}

/** key はタブの目印（data-code-file）で、ファイルなら html・css などのファイルの種類。name は送る欄の名前 */
type FileTab = { key: string; name: string; label: string; syntax: CodeSyntax; value: string; hint?: string }

/**
 * 編集画面の、ファイルをタブで切り替えるエディター。Web なら、その場のプレビューを横に並べる。
 * タブの切り替えとプレビューは src/code-editor.ts が受け持つ（包むカードに data-code-starter を付ける）
 */
const CodeFilesPane = ({
  idPrefix,
  tabs,
  preview,
  errors,
}: {
  /** タブと欄の id の頭に付ける名前。同じ画面に 2 つ置くので、重ならないようにする */
  idPrefix: string
  tabs: FileTab[]
  /** プレビューの見出し。渡さなければプレビューを置かない */
  preview?: string
  errors: FieldErrors
}) => {
  const selected = tabs.find((t) => errors[t.name])?.key ?? tabs[0].key
  return (
    <div class={cx('code-starter', preview && 'has-preview')}>
      <div class="code-starter-editor">
        <div class="code-pane-head">
          <div class="code-tabs" role="tablist" aria-label="ファイル">
            {tabs.map((t) => (
              <button
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${t.key}`}
                class={cx(errors[t.name] && 'has-error')}
                aria-selected={t.key === selected ? 'true' : 'false'}
                aria-controls={`${idPrefix}-file-${t.key}`}
                tabindex={t.key === selected ? 0 : -1}
                data-code-tab={t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {tabs.map((t) => (
          <div
            class={cx('field code-file', errors[t.name] && 'has-error')}
            role="tabpanel"
            id={`${idPrefix}-file-${t.key}`}
            aria-labelledby={`${idPrefix}-tab-${t.key}`}
            hidden={t.key !== selected}
            data-code-file={t.key}
          >
            <CodeInput
              syntax={t.syntax}
              id={`f-${idPrefix}-${t.key}`}
              name={t.name}
              value={t.value}
              invalid={!!errors[t.name]}
              aria-label={t.label}
              aria-describedby={`f-${idPrefix}-${t.key}-error`}
              fill
            />
            <FieldError id={`f-${idPrefix}-${t.key}`} error={errors[t.name]} />
            {t.hint && <p class="field-hint">{t.hint}</p>}
          </div>
        ))}
      </div>
      {preview && (
        <div class="code-starter-preview">
          <div class="code-pane-head">
            <span class="code-pane-title">
              <Icon name="eye" size={16} /> {preview}
            </span>
          </div>
          <iframe class="code-preview" title={preview} sandbox="allow-scripts allow-forms allow-modals" data-code-preview />
        </div>
      )}
    </div>
  )
}

/**
 * 通常モードの編集画面の「最初のコード」のカード（教師）。ひな形に戻す操作は src/code-editor.ts が受け持つ
 */
export const CodeStarterCard = ({
  language,
  starter,
  stdin,
  errors,
}: {
  language: CodeLanguage
  starter: CodeFiles
  stdin: string
  errors: FieldErrors
}) => {
  useStyle('/src/components/code.css')
  const tabs: FileTab[] = [
    ...CODE_FILES[language].map((f) => ({ key: f.key, name: f.key, label: f.name, syntax: f.key, value: starter[f.key] ?? '' })),
    ...(language === 'python'
      ? [{ key: 'stdin', name: 'stdin', label: '入力の例', syntax: 'text' as const, value: stdin, hint: STDIN_HINT }]
      : []),
  ]
  return (
    <Card
      class="editor-extra code-section"
      heading="最初のコード"
      description="学生が最初に開いたときに入っているコードです。どこに何を書くかをコメントで示しておくと、取りかかりやすくなります。"
      actions={
        <>
          <CodeEditorTools language={language} />
          <Button size="sm" variant="ghost" icon="undo" aria-label="ひな形に戻す" data-code-starter-reset={language}>
            <span class="hide-sm">ひな形に戻す</span>
          </Button>
        </>
      }
      data-code-starter
    >
      <CodeFilesPane idPrefix="starter" tabs={tabs} preview={language === 'web' ? '学生に見えるページ' : undefined} errors={errors} />
    </Card>
  )
}

/**
 * 通常モードの編集画面の「解答例」のカード（教師）。最初のコードを写す操作と「試しに判定」は src/code-editor.ts が受け持つ
 */
export const CodeSolutionCard = ({
  language,
  solution,
  solutionPublic,
  trial,
  errors,
}: {
  language: CodeLanguage
  solution: CodeFiles
  solutionPublic: boolean
  /** 試しに判定する送信先（/code/trial）。AI がないときは渡さない */
  trial?: string
  errors: FieldErrors
}) => {
  useStyle('/src/components/code.css')
  const tabs: FileTab[] = CODE_FILES[language].map((f) => ({
    key: f.key,
    name: `solution_${f.key}`,
    label: f.name,
    syntax: f.key,
    value: solution[f.key] ?? '',
  }))
  return (
    <Card
      class="editor-extra code-section"
      heading="解答例"
      description={SOLUTION_DESCRIPTION}
      actions={
        <>
          <CodeEditorTools language={language} />
          <Button size="sm" variant="ghost" icon="copy" aria-label="最初のコードを写す" data-code-solution-copy>
            <span class="hide-sm">最初のコードを写す</span>
          </Button>
        </>
      }
      data-code-starter
      data-code-solution
    >
      <div class="stack">
        <CodeFilesPane idPrefix="solution" tabs={tabs} preview={language === 'web' ? '解答例のページ' : undefined} errors={errors} />
        <SolutionPublicField checked={solutionPublic} />
        {trial && <CodeTrial action={trial} />}
      </div>
    </Card>
  )
}

/** 編集画面の制約の 1 行の、入力中の値 */
export type ConstraintRow = { label: string; text: string; optional?: boolean }

const ConstraintRowView = ({ row }: { row: ConstraintRow }) => (
  <li class="code-constraint" data-code-constraint>
    <Input
      name="constraint_label[]"
      value={row.label}
      placeholder="ラベル（例：名前を見出しにする）"
      aria-label="ラベル（学生にも見える）"
      class="code-constraint-label"
    />
    <Input
      name="constraint_text[]"
      value={row.text}
      placeholder="判定の内容（例：h1 要素に自分の名前が書かれている）"
      aria-label="判定の内容（学生には見えない）"
    />
    <Select
      name="constraint_kind[]"
      options={CONSTRAINT_KINDS.map((kind) => ({ value: kind, label: CONSTRAINT_KIND_LABELS[kind] }))}
      value={row.optional ? 'optional' : 'required'}
      aria-label="必須か発展か"
      class="code-constraint-kind"
      compact
    />
    <IconButton icon="x" label="この制約を消す" data-code-constraint-remove />
  </li>
)

type PeriodProps = { opensAt: string; closesAt: string; errors: FieldErrors; idPrefix?: string }

const PERIOD_DESCRIPTION = `学生はこの期間だけ提出できます。長さは ${MAX_SUBMIT_PERIOD / 86_400} 日までです。期間の外でも、問題を見てコードを書くことはできます。`

const LONG_PERIOD_LABEL = `${LONG_SUBMIT_PERIOD / 86_400} 日以上`

/**
 * 提出の期間の長さ。LONG_SUBMIT_PERIOD 以上なら、長いことが分かるように色を変えて注意を添える。
 * 日時を選び直したときは、src/code-editor.ts が同じ規則（data-code-period-long の秒数）で書き換える
 */
const PeriodLength = ({ opensAt, closesAt }: Pick<PeriodProps, 'opensAt' | 'closesAt'>) => {
  const length = isDateTimeInput(opensAt) && isDateTimeInput(closesAt) ? dateTimeInputToUnix(closesAt) - dateTimeInputToUnix(opensAt) : 0
  return (
    <div
      class={cx('code-period-length', length >= LONG_SUBMIT_PERIOD && 'is-long')}
      role="status"
      hidden={length <= 0}
      data-code-period-length
      data-code-period-long={LONG_SUBMIT_PERIOD}
    >
      <p class="code-period-length-line">
        <Icon name="clock" size={16} />
        <span>
          期間の長さ：<strong data-code-period-length-text>{formatPeriodLength(Math.max(0, length))}</strong>
        </span>
        <Chip class="code-period-long">{LONG_PERIOD_LABEL}</Chip>
      </p>
      <p class="code-period-long muted small">
        受け付けているあいだは、提出のたびに AI の利用料がかかります。授業の中だけで使うなら、短くしてください。
      </p>
    </div>
  )
}

const PeriodInputs = ({ opensAt, closesAt, errors, idPrefix = 'f' }: PeriodProps) => (
  <div class="stack" data-code-period>
    <DateTimeField label="開始日時" name="opens_at" id={`${idPrefix}-opens_at`} value={opensAt} error={errors.opens_at} />
    <DateTimeField label="終了日時" name="closes_at" id={`${idPrefix}-closes_at`} value={closesAt} error={errors.closes_at} />
    <PeriodLength opensAt={opensAt} closesAt={closesAt} />
  </div>
)

/** 通常モードの編集画面の右の列に置く、学生が提出できる期間のカード */
export const CodePeriodCard = (props: PeriodProps) => (
  <Card heading="提出の期間" description={PERIOD_DESCRIPTION}>
    <PeriodInputs {...props} />
  </Card>
)

/** Moodle モードの入力欄の、学生が提出できる期間の欄 */
export const CodePeriodFields = (props: PeriodProps) => (
  <fieldset class="field">
    <legend>提出の期間</legend>
    <p class="field-hint">{PERIOD_DESCRIPTION}</p>
    <PeriodInputs {...props} />
  </fieldset>
)

/**
 * 制約の欄。1 行ずつ、学生にも見えるラベルと AI だけが使う判定の内容を書く。行の追加と削除は src/code-editor.ts が受け持つ。
 * エラーは fieldset（name="constraints"）に出す。行ごとの入力欄は同じ名前が並ぶので、エラーの置き場所にできないため
 */
const CodeConstraintsField = ({
  constraints,
  suggest,
  errors,
  idPrefix,
  mode,
}: {
  constraints: ConstraintRow[]
  /** 渡すと「AI で作る」を出す。押すと src/code-editor.ts が、問題文と最初のコードをここに送る */
  suggest?: string
  errors: FieldErrors
  idPrefix: string
  /** moodle では、ない機能（「制約をすべてクリアしたら完了」）の案内を出さない */
  mode: 'normal' | 'moodle'
}) => {
  useStyle('/src/components/code.css')
  const id = `${idPrefix}-constraints`
  return (
    <fieldset
      name="constraints"
      id={id}
      class={cx('field code-constraints', errors.constraints && 'has-error')}
      aria-invalid={errors.constraints ? 'true' : undefined}
      aria-describedby={`${id}-error`}
      data-code-constraints
    >
      <legend>制約</legend>
      <p class="field-hint">
        問題文の要件を 1 行ずつ書きます。ラベルは「クリアの条件」として学生にも見え、判定の内容は AI
        だけが使います（空ならラベルで判定します）。「発展」にした制約は、判定はしますが、クリアには数えません。
        {mode === 'normal' &&
          '完了の条件を「制約をすべてクリアしたら完了」にすると、必須の制約がすべて「できている」になったときに完了します。'}
      </p>
      <ol class="code-constraint-list" data-code-constraint-list>
        {constraints.map((row) => (
          <ConstraintRowView row={row} />
        ))}
      </ol>
      <p class="code-constraint-empty muted small">
        制約はまだありません。
        {suggest ? '「AI で作る」で問題文から作るか、「制約を追加」で書き足します。' : '「制約を追加」で書き足します。'}
        保存するには 1 つ以上必要です。
      </p>
      <div class="code-constraint-foot">
        <Button size="sm" icon="plus" data-code-constraint-add>
          制約を追加
        </Button>
        {suggest && (
          <Button size="sm" icon="sparkles" data-code-constraints-suggest={suggest}>
            AI で作る
          </Button>
        )}
        {suggest && <span class="muted small" role="status" data-code-constraints-status />}
      </div>
      <FieldError id={id} error={errors.constraints} />
      <template data-code-constraint-template>
        <ConstraintRowView row={{ label: '', text: '', optional: false }} />
      </template>
    </fieldset>
  )
}

/** 通常モードの編集画面の「判定」のカード（教師）。制約と補足の欄に、開発サーバーでは判定するものの切り替えを足す */

export const CodeGradingCard = ({
  gradingEnabled,
  criteria,
  constraints,
  suggest,
  judge,
  errors,
}: {
  gradingEnabled: boolean
  criteria: string
  constraints: ConstraintRow[]
  /** 制約を AI で作る送信先（/code/constraints）。AI がないときは渡さない */
  suggest?: string
  /** 制約ごとの判定をするものの切り替え（開発サーバーだけ）。form は切り替えを送るフォームの id */
  judge?: { current: Judge; form: string }
  errors: FieldErrors
}) => {
  useStyle('/src/components/code.css')
  return (
    <Card class="editor-extra code-section code-grading" heading="判定" description={gradingDescription(gradingEnabled)}>
      <div class="stack">
        {judge && (
          <div class="code-dev-judge">
            <div class="code-dev-judge-text">
              <span class="strong small">
                制約の判定 <Chip>開発サーバーだけ</Chip>
              </span>
              <span class="muted small">
                すべてのアイテムに効きます。本番では常に AI です。Jev は理由と講評を返しません。保存していない変更は消えます。
              </span>
            </div>
            <div class="code-dev-judge-options" role="group" aria-label="制約の判定">
              {JUDGES.map((j) => (
                <Button
                  type="submit"
                  form={judge.form}
                  name="judge"
                  value={j}
                  size="sm"
                  variant={j === judge.current ? 'primary' : 'default'}
                  aria-pressed={j === judge.current ? 'true' : 'false'}
                >
                  {JUDGE_LABELS[j]}
                </Button>
              ))}
            </div>
          </div>
        )}
        <CodeConstraintsField constraints={constraints} suggest={suggest} errors={errors} idPrefix="f" mode="normal" />
        <TextAreaField
          label="補足（任意）"
          name="criteria"
          id="f-criteria"
          rows={3}
          value={criteria}
          error={errors.criteria}
          hint={CRITERIA_HINT}
        />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- 問題の確定

const FINALIZE_CONFIRM =
  '確定すると、問題文・制約・補足・最初のコード・解答例は変えられなくなります（タイトル・提出の期間・公開の設定は変えられます）。保存していない変更も一緒に保存して確定します。確定しますか？'

const STAGE_TEXT: Record<NonNullable<CodeStage> | 'legacy', string> = {
  legacy:
    'この問題は確定の仕組みより前に作ったので、確定しなくても学生が解けます。確定すると、AI が制約ごとの判定の基準を書き、判定が揃いやすくなります。',
  draft:
    '確定するまで、学生はこの問題を解けません。確定すると AI（Claude Opus 5.5）が制約ごとの判定の基準を書き、終わると学生が解けるようになります。',
  preparing: 'AI が制約ごとの判定の基準を書いています。終わると学生が解けるようになります（1〜2 分ほど）。',
  ready: '準備が終わり、学生が解けます。',
  failed: '判定の基準を書けませんでした。もう一度準備するまで、学生は解けません。',
}

/** 確定と準備の段階ごとの説明と操作。finalize は確定のボタンを送るフォーム、prepare と duplicate は、もう一度準備する・複製するフォームの id */
const StageBody = ({
  stage,
  running,
  forms,
}: {
  stage: CodeStage
  /** 準備をこのプロセスで進めている */
  running: boolean
  forms: { finalize?: string; prepare: string; duplicate?: string }
}) => (
  <div class="stack code-stage-panel">
    {stage && (
      <p class="code-stage-line">
        <Chip tone={stage === 'ready' ? 'success' : stage === 'preparing' ? 'accent' : 'default'}>{CODE_STAGE_LABELS[stage]}</Chip>
      </p>
    )}
    <p class="muted small">{STAGE_TEXT[stage ?? 'legacy']}</p>
    {!isFinalized(stage) && (
      <Button
        type="submit"
        form={forms.finalize}
        name="finalize"
        value="1"
        variant="primary"
        icon="lock"
        data-confirm={FINALIZE_CONFIRM}
        data-confirm-ok="確定する"
      >
        問題を確定する
      </Button>
    )}
    {(stage === 'failed' || (stage === 'preparing' && !running)) && (
      <Button type="submit" form={forms.prepare} icon="arrowPath">
        もう一度準備する
      </Button>
    )}
    {stage === 'preparing' && running && (
      <a href="" class="small" data-reload>
        開き直して確かめる
      </a>
    )}
    {isFinalized(stage) &&
      (forms.duplicate ? (
        <div class="stack">
          <Button type="submit" form={forms.duplicate} icon="copy">
            複製して作り直す
          </Button>
          <p class="muted small">
            直したいときは、確定する前の新しいアイテムとして複製し、そちらを直して確定します。この問題と提出はそのまま残ります。
          </p>
        </div>
      ) : (
        <p class="muted small">直したいときは、新しいコーディング問題を作ってください。</p>
      ))}
  </div>
)

/** 通常モードの編集画面の右の列に置く、問題の確定のカード */
export const CodeStageCard = (props: Parameters<typeof StageBody>[0]) => (
  <Card heading="問題の確定">
    <StageBody {...props} />
  </Card>
)

/** Moodle モードの入力欄の、問題の確定の欄 */
export const CodeStageFields = (props: Parameters<typeof StageBody>[0]) => (
  <fieldset class="field">
    <legend>問題の確定</legend>
    <StageBody {...props} />
  </fieldset>
)

/** 確定した問題の、判定に関わる設定。変えられないので入力欄ではなく、中身をそのまま見せる */
export type FinalizedCode = {
  language: CodeLanguage
  starter: CodeFiles
  stdin: string
  criteria: string
  constraints: ConstraintRow[]
  solution: CodeFiles
  solutionPublic: boolean
  /** 制約ごとの判定の基準（準備が終わるまでは空） */
  guides: string[]
}

const SourceBlock = ({ label, source }: { label: string; source: string }) => (
  <details class="code-solution-file">
    <summary>
      {label}
      <Icon name="chevronDown" size={14} class="code-task-arrow" />
    </summary>
    <pre>{source || '（空）'}</pre>
  </details>
)

const FinalizedBody = ({ code }: { code: FinalizedCode }) => {
  useStyle('/src/components/code.css')
  const { language, starter, stdin, criteria, constraints, solution, solutionPublic, guides } = code
  return (
    <div class="stack">
      <div class="stack">
        <h3 class="code-finalized-heading">制約</h3>
        <ol class="code-finalized-constraints">
          {constraints.map((c, i) => (
            <li>
              <span class="strong">{c.label}</span> <Chip>{CONSTRAINT_KIND_LABELS[c.optional ? 'optional' : 'required']}</Chip>
              {c.text && <p class="muted small">{c.text}</p>}
              {guides[i] && (
                <p class="code-guide small">
                  <span class="strong">判定の基準：</span>
                  {guides[i]}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
      {criteria && (
        <div class="stack">
          <h3 class="code-finalized-heading">補足</h3>
          <p class="small">{criteria}</p>
        </div>
      )}
      <div class="stack">
        <h3 class="code-finalized-heading">最初のコード</h3>
        {CODE_FILES[language].map((f) => (
          <SourceBlock label={f.name} source={starter[f.key] ?? ''} />
        ))}
        {language === 'python' && <SourceBlock label="入力の例" source={stdin} />}
      </div>
      {hasCode(solution) && (
        <div class="stack">
          <h3 class="code-finalized-heading">解答例</h3>
          {CODE_FILES[language].map((f) => (
            <SourceBlock label={f.name} source={solution[f.key] ?? ''} />
          ))}
          <SolutionPublicField checked={solutionPublic} />
        </div>
      )}
    </div>
  )
}

/** 通常モードの編集画面の、確定した問題の中身のカード。最初のコード・解答例・判定のカードの代わりに置く */
export const CodeFinalizedCard = ({ code }: { code: FinalizedCode }) => (
  <Card
    class="editor-extra code-section"
    heading="確定した問題"
    description="確定したので、判定に関わる設定は変えられません。判定の基準は、AI が判定のたびに読みます（学生には見えません）。"
  >
    <FinalizedBody code={code} />
  </Card>
)

/** Moodle モードの入力欄の、確定した問題の中身 */
export const CodeFinalizedFields = ({ code }: { code: FinalizedCode }) => (
  <fieldset class="field">
    <legend>確定した問題</legend>
    <p class="field-hint">
      確定したので、判定に関わる設定は変えられません。判定の基準は、AI が判定のたびに読みます（学生には見えません）。
    </p>
    <FinalizedBody code={code} />
  </fieldset>
)

export const CODE_FORM = 'code-form'
const RESET_FORM = 'code-reset'

/** 右の枠の表示。output はプレビュー（Web）か実行結果（Python） */
type ResultView = 'output' | 'submissions'

/**
 * コードのアイテムの本体。ヘッダーの下いっぱいに、左に問題文とエディター、右にプレビュー（Web）か実行結果（Python）を出す。
 * コードは描かず、src/code-editor.ts が `${base}/state` から読み込む。ここに描くと、書きかけのコードや最初のコードが変わるたびに
 * 描く内容が変わり、コースの変更の反映（CourseLiveSync）が、書いている途中のエディターの入力欄を差し替えてしまう
 */
export const CodeWorkspace = ({
  itemId,
  base,
  language,
  body,
  goals,
  canRun,
  submissions,
  completion,
}: {
  /** AI がこのアイテムを変えたときに、client.ts がエディターを取り直すための目印 */
  itemId: number
  /** 実行・保存・提出の送信先の共通部分（`/courses/1/items/2/code`） */
  base: string
  language: CodeLanguage
  /** 問題文（Markdown） */
  body: string
  /** クリアの条件（制約のラベル）。問題文の上に並べ、いちばん新しい提出の判定を重ねる */
  goals: readonly Goal[]
  /** Python を実行できるか（sandbox が設定されているか） */
  canRun: boolean
  /** 見ている学生の提出。渡すと、右の枠に「提出」のタブを出す */
  submissions?: SubmissionsView | null
  /** 提出のタブに出す、アイテムの完了の状態（通常モードの CompletionStatus） */
  completion?: Child
}) => {
  useStyle('/src/components/code.css')
  const files = CODE_FILES[language]
  // 判定中なら提出のタブから始めるのは、提出した直後に結果を待つ画面へそのまま進めるため
  const startView: ResultView = submissions?.grade?.status === 'pending' ? 'submissions' : 'output'
  const output = language === 'web' ? { label: 'プレビュー', icon: 'eye' as const } : { label: '実行結果', icon: 'terminal' as const }
  const viewAttrs = (view: ResultView) =>
    submissions ? { role: 'tabpanel', id: `code-view-${view}`, 'aria-labelledby': `code-view-tab-${view}`, hidden: view !== startView } : {}
  return (
    <div class="code-stage" data-code-workspace={language} data-code-base={base} data-ai-watch={`item:${itemId}`}>
      <form id={CODE_FORM} method="post" action={`${base}/submit`} class="code-edit" data-loading-form>
        {(body || goals.length > 0) && (
          <details class="code-task" open>
            <summary>
              <Icon name="page" size={16} /> 問題
              <Icon name="chevronDown" size={14} class="code-task-arrow" />
            </summary>
            {goals.length > 0 && (
              <div class="code-goals" id="code-goals">
                <h3>クリアの条件</h3>
                <GoalList goals={goals} grade={submissions?.grade} />
              </div>
            )}
            {body && <Markdown source={body} />}
          </details>
        )}
        <div class="code-pane">
          <div class="code-pane-head">
            <div class="code-tabs" role="tablist" aria-label="ファイル">
              {files.map((f, i) => (
                <button
                  type="button"
                  role="tab"
                  id={`code-tab-${f.key}`}
                  aria-selected={i === 0 ? 'true' : 'false'}
                  aria-controls={`code-file-${f.key}`}
                  tabindex={i === 0 ? 0 : -1}
                  data-code-tab={f.key}
                >
                  {f.name}
                </button>
              ))}
            </div>
            <span class="code-save muted" role="status" data-code-save />
            <CodeEditorTools language={language} />
            <IconButton type="submit" form={RESET_FORM} icon="undo" label="最初のコードに戻す" />
          </div>
          {files.map((f, i) => (
            <div
              class="code-file"
              role="tabpanel"
              id={`code-file-${f.key}`}
              aria-labelledby={`code-tab-${f.key}`}
              hidden={i > 0}
              data-code-file={f.key}
            >
              <CodeInput syntax={f.key} id={`code-${f.key}`} name={f.key} aria-label={f.name} fill />
            </div>
          ))}
        </div>
      </form>
      <form
        id={RESET_FORM}
        method="post"
        action={`${base}/reset`}
        data-confirm="書いたコードを消して、最初のコードに戻しますか？"
        data-confirm-ok="戻す"
        hidden
      />

      <div class="code-result">
        <div class="code-pane-head">
          {submissions ? (
            <div class="code-tabs code-view-tabs" role="tablist" aria-label="右の表示">
              {(
                [
                  { view: 'output', ...output },
                  { view: 'submissions', label: '提出', icon: 'upload' },
                ] as const
              ).map((tab) => (
                <button
                  type="button"
                  role="tab"
                  id={`code-view-tab-${tab.view}`}
                  aria-selected={tab.view === startView ? 'true' : 'false'}
                  aria-controls={`code-view-${tab.view}`}
                  tabindex={tab.view === startView ? 0 : -1}
                  data-code-view={tab.view}
                >
                  <Icon name={tab.icon} size={16} />
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <span class="code-pane-title">
              <Icon name={output.icon} size={16} /> {output.label}
            </span>
          )}
          {language === 'web' ? (
            <IconButton
              icon="arrowPath"
              label="プレビューを読み込み直す"
              hidden={startView !== 'output'}
              data-code-view-only="output"
              data-code-refresh
            />
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon="play"
              title="実行（⌘Enter / Ctrl+Enter）"
              disabled={!canRun}
              hidden={startView !== 'output'}
              data-code-view-only="output"
              data-code-run
            >
              実行
            </Button>
          )}
        </div>
        <div class="code-view" {...viewAttrs('output')} data-code-view-panel="output">
          {language === 'web' ? (
            <>
              {/* allow-same-origin を付けないのは、書いたコードが STEP Learn と同じオリジンで動き、Cookie や画面に触れられるようになるため */}
              <iframe class="code-preview" title="プレビュー" sandbox="allow-scripts allow-forms allow-modals" data-code-preview />
              <details class="code-console" data-code-console>
                <summary>
                  <Icon name="terminal" size={16} /> コンソール
                  <span class="code-console-count" data-code-console-count hidden />
                  <Icon name="chevronDown" size={14} class="code-task-arrow" />
                </summary>
                <div class="code-console-lines" role="log" aria-label="コンソールの出力" data-code-console-lines />
              </details>
            </>
          ) : (
            <>
              {!canRun && <Alert tone="warning">Python を実行する環境が設定されていないため、実行できません。</Alert>}
              <div class="field code-stdin">
                <label for="code-stdin">入力（プログラムが input() で読む内容）</label>
                <Textarea id="code-stdin" name="stdin" form={CODE_FORM} rows={3} class="code-mono" spellcheck={false} />
              </div>
              <div class="code-output" aria-live="polite" data-code-output>
                <p class="muted">「実行」を押すと、ここに結果が出ます。</p>
              </div>
            </>
          )}
        </div>
        {submissions && (
          <div class="code-view" {...viewAttrs('submissions')} data-code-view-panel="submissions">
            <CodeSubmissions view={submissions} base={base} completion={completion} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * アイテムの画面に置く、コードを書く場所の入口。ブラウザエディターはこのアイテムの下の画面（base）で開き、
 * VS Code は拡張機能が書きかけのコードを受け取って開く。VS Code で保存すると書きかけに反映し、VS Code からも提出できる。
 * 判定中は、いちばん新しい提出のカードに data-code-grade（確かめる先の URL）を付け、src/code-editor.ts が判定の終わりを待って、
 * カードとクリアの条件（data-code-grade-with の id）を取り直す
 */
export const CodeOpen = ({
  base,
  language,
  goals,
  grade,
  solution,
  canManage,
  stage,
}: {
  /** ブラウザエディターの画面（`/courses/1/items/2/code`） */
  base: string
  language: CodeLanguage
  goals: readonly Goal[]
  /** 見ている学生のいちばん新しい提出 */
  grade?: GradeView | null
  /** 学生に見せる解答例（lib/code.ts の publicSolutionOf）。見せないあいだは渡さない */
  solution?: CodeFiles | null
  canManage: boolean
  /** 問題の確定と準備の段階。準備が終わるまで、学生には開く操作を出さない */
  stage: CodeStage
}) => {
  useStyle('/src/components/code.css', '/src/components/card.css')
  if (!canManage && !isSolvable(stage))
    return (
      <div class="code-open stack">
        <Alert tone="info">この問題は準備中です。教師が問題を確定して準備が終わると、解けるようになります。</Alert>
      </div>
    )
  return (
    <div class="code-open stack">
      {canManage && !isSolvable(stage) && (
        <Alert tone="info">
          学生はまだこの問題を解けません（{CODE_STAGE_LABELS[stage!]}）。編集画面で問題を確定し、準備が終わると解けるようになります。
        </Alert>
      )}
      <LinkCard href={base} icon="code" class="link-card-lg kind-code">
        <span class="file-name">
          <span class="strong">ブラウザエディターで開く</span>
          <span class="muted small">
            {language === 'web' ? 'ブラウザで書いて、その場でプレビューを見られます' : 'ブラウザで書いて、その場で実行できます'}
          </span>
        </span>
        <Button as="span" variant="primary" iconEnd="chevronRight">
          開く
        </Button>
      </LinkCard>
      <LinkCard icon="terminal" class="link-card-lg kind-code">
        <span class="file-name">
          <span class="strong">VS Code で開く</span>
          <span class="muted small">
            ファイルを用意して VS Code で開きます。保存した内容はブラウザエディターにも反映され、VS Code から提出もできます
          </span>
        </span>
        <form method="post" action={`${base}/launch`} data-vscode-launch>
          <Button type="submit" iconEnd="external">
            VS Code で開く
          </Button>
        </form>
      </LinkCard>
      <p class="code-open-help muted small">
        VS Code で開くには、拡張機能「{VSCODE_EXTENSION_NAME}」を入れてください。
        <a href={VSCODE_MARKETPLACE_URL} target="_blank" rel="noopener" data-no-prefetch>
          Marketplace で見る
          <Icon name="external" size={12} />
        </a>
      </p>
      {canManage && (
        <div>
          <Button href={`${base}/submissions`} size="sm" icon="users">
            学生の提出を見る
          </Button>
        </div>
      )}
      {goals.length > 0 && (
        <Card heading="クリアの条件" description="提出すると、AI がこの条件ごとに判定します。" id="code-open-goals">
          <GoalList goals={goals} grade={grade} />
        </Card>
      )}
      {grade && (
        <Card
          heading="いちばん新しい提出"
          description={`${formatDateTime(grade.createdAt)} に提出`}
          class="code-grade"
          id="code-open-grade"
          data-code-grade={grade.status === 'pending' ? `${base}/grading` : undefined}
          data-code-grade-with="code-open-goals"
        >
          <GradeResult grade={grade} appeal={`${base}/appeal`} />
        </Card>
      )}
      {solution && (
        <Card heading="解答例" description="提出の受付が終わったので、教師の解答例を見られます。自分のコードと比べてみましょう。">
          <div class="stack">
            {language === 'web' && (
              // allow-same-origin を付けないのは、解答例のコードが STEP Learn と同じオリジンで動き、Cookie や画面に触れられるようになるため
              <iframe
                class="code-solution-preview"
                title="解答例のプレビュー"
                sandbox="allow-scripts"
                srcdoc={buildWebDocument(solution)}
              />
            )}
            {CODE_FILES[language].map((f) => (
              <details class="code-solution-file">
                <summary>
                  {f.name}
                  <Icon name="chevronDown" size={14} class="code-task-arrow" />
                </summary>
                {solution[f.key] ? <pre>{solution[f.key]}</pre> : <p class="muted small">空です。</p>}
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

/** 学生に見せる、いちばん新しい提出の判定。ahead は、判定を待っているあいだの、前にある提出の数 */
export type GradeView = {
  status: GradingStatus
  feedback: string
  verdicts: ConstraintResult[] | null
  teacherComment: string
  appealedAt: number | null
  appealClosedAt: number | null
  ahead: number
  createdAt: number
}

const GOAL_ICONS: Record<Verdict, IconName> = { pass: 'checkCircle', partial: 'alert', fail: 'x' }

/**
 * クリアの条件の一覧。いちばん新しい提出が判定済みなら、条件ごとに判定を重ねる（ラベルで突き合わせる）。
 * まだ判定のない条件には、空の丸を出す
 */
const GoalList = ({ goals, grade }: { goals: readonly Goal[]; grade?: GradeView | null }) => {
  const verdicts = grade?.status === 'graded' ? (grade.verdicts ?? []) : []
  return (
    <ul class="code-goal-list">
      {goals.map((goal) => {
        const result = verdicts.find((v) => v.label === goal.label)
        return (
          <li class={cx('code-goal', result && `is-${result.verdict}`)}>
            {result ? (
              <Icon name={GOAL_ICONS[result.verdict]} size={16} class="code-goal-mark" />
            ) : (
              <span class="code-goal-mark code-goal-dot" aria-hidden="true" />
            )}
            <span class="code-goal-text">
              <span>
                {result && <span class="sr-only">{VERDICT_LABELS[result.verdict]}：</span>}
                {goal.label}
                {goal.optional && <Chip class="code-goal-kind">{CONSTRAINT_KIND_LABELS.optional}</Chip>}
              </span>
              {result && result.verdict !== 'pass' && result.reason && <span class="muted small">{result.reason}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** 提出の履歴の 1 件 */
export type SubmissionRow = { status: GradingStatus; verdicts: ConstraintResult[] | null; createdAt: number }

/**
 * 学生の提出のタブに出すもの（lib/code-grader.ts の submissionsOf で作る）。秒数はどれも描いた時点のもので、
 * wait は次に提出できるまで（受付の前なら受付が始まるまで）、period.closesIn は受付が終わるまで
 */
export type SubmissionsView = {
  grade: GradeView | null
  history: SubmissionRow[]
  wait: number
  period: { state: SubmitState; opensAt: number | null; closesAt: number | null; closesIn: number | null }
}

/** 制約ごとの判定の短いまとめ（「クリア」「3 / 4 クリア」）。発展の制約は数えない。判定がなければ null */
export function verdictSummary(verdicts: readonly ConstraintResult[] | null) {
  if (!verdicts?.length) return null
  const { required } = verdictCounts(verdicts)
  return isCleared(verdicts) ? 'クリア' : `${required.passed} / ${required.total} クリア`
}

const submissionLabel = (s: SubmissionRow) =>
  s.status === 'pending'
    ? '判定中…'
    : s.status === 'failed'
      ? '判定できませんでした'
      : (s.status === 'graded' && verdictSummary(s.verdicts)) || '提出済み'

const SubmissionChip = ({ submission: s }: { submission: SubmissionRow }) => (
  <Chip tone={s.status === 'graded' && isCleared(s.verdicts) ? 'success' : s.status === 'pending' ? 'accent' : 'default'} icon="check">
    {submissionLabel(s)}
  </Chip>
)

const submitLabel = (submitted: boolean) => (submitted ? '出し直す' : '提出')
const waitLabel = (seconds: number) => `あと ${formatWait(seconds)}`
const CLOSED_LABEL = '受付終了'
const CLOSED_TEXT = '提出の受付は終わりました。'

/** 提出のボタンと提出のタブの、描いた時点の表示。受付の前後や待つあいだは押せない */
function submitStatus({ grade, wait, period }: SubmissionsView) {
  const ready = grade ? 'もう一度提出できます。' : '書けたら、右上の「提出」を押しましょう。'
  const prefix = period.state === 'upcoming' ? '受付が始まるまで' : '次に提出できるまで'
  if (period.state === 'unset')
    return {
      ready,
      prefix,
      blocked: true,
      button: '提出できません',
      text: '提出の期間がまだ決まっていません。教師が決めると提出できます。',
    }
  if (period.state === 'closed') return { ready, prefix, blocked: true, button: CLOSED_LABEL, text: CLOSED_TEXT }
  if (wait > 0) return { ready, prefix, blocked: true, button: waitLabel(wait), text: `${prefix}、${waitLabel(wait)}` }
  return { ready, prefix, blocked: false, button: submitLabel(!!grade), text: ready }
}

/**
 * ヘッダーの帯（ItemBar）に置く、提出の一覧への入口（教師）と、提出の状況・提出ボタン（学生）。
 * 続けて提出できないあいだや受付の前は、提出ボタンを押せなくして残りの時間を出し、受付が終わると押せなくする。数え直すのは src/code-editor.ts
 */
export const CodeBarActions = ({
  base,
  canManage,
  submissions,
}: {
  base: string
  canManage: boolean
  /** 見ている学生の提出。学生でなければ渡さない */
  submissions?: SubmissionsView | null
}) => {
  const grade = submissions?.grade
  const status = submissions && submitStatus(submissions)
  const timed = !!submissions && (submissions.wait > 0 || submissions.period.closesIn !== null)
  return (
    <>
      {canManage && (
        <Button href={`${base}/submissions`} size="sm" icon="users" aria-label="提出">
          <span class="hide-sm">提出</span>
        </Button>
      )}
      {grade && (
        <button type="button" class="item-bar-status" title="提出のタブを開く" data-code-grade-chip data-code-show="submissions">
          <SubmissionChip submission={grade} />
        </button>
      )}
      {submissions && status && (
        <Button
          type="submit"
          form={CODE_FORM}
          variant="primary"
          size="sm"
          icon="upload"
          class="code-submit"
          disabled={status.blocked}
          data-code-submit-timer={timed ? '' : undefined}
          data-code-submit-wait={submissions.wait}
          data-code-submit-close={submissions.period.closesIn ?? undefined}
          data-code-submit-label={submitLabel(!!grade)}
          data-code-submit-closed={CLOSED_LABEL}
        >
          <span data-code-submit-text>{status.button}</span>
        </Button>
      )}
    </>
  )
}

const VERDICT_ICONS: Record<Verdict, IconName> = { pass: 'checkCircle', partial: 'alert', fail: 'x' }

/** 判定を選び直す欄の表示。言葉にしないのは、提出の画面の右の列が狭く、3 つが 1 行に収まらないため */
const VERDICT_MARKS: Record<Verdict, string> = { pass: '○', partial: '△', fail: '×' }

/**
 * 「試しに判定」の結果（教師）。解答例はすべて「できている」、最初のコードはどれも「できている」にならないのが、意図どおりの制約。
 * そうでない制約を先に知らせ、制約ごとの判定は下に並べる
 */
export const CodeTrialResult = ({ result: { solution, starter } }: { result: TrialResult }) => {
  useStyle('/src/components/code.css')
  const missed = solution?.filter((v) => v.verdict !== 'pass' && !v.optional) ?? []
  const missedOptional = solution?.filter((v) => v.verdict !== 'pass' && v.optional) ?? []
  const given = starter.filter((v) => v.verdict === 'pass')
  const names = (verdicts: readonly ConstraintResult[]) => verdicts.map((v) => `「${v.label}」`).join('')
  return (
    <div class="stack">
      {!solution ? (
        <Alert tone="info">
          解答例が空なので、最初のコードだけを判定しました。解答例を書くと、制約をすべて満たせるかも確かめられます。
        </Alert>
      ) : missed.length === 0 ? (
        <Alert tone="success">
          {missedOptional.length === 0
            ? '解答例は、すべての制約で「できている」と判定されました。'
            : `解答例は、必須の制約がすべて「できている」と判定されました。発展の ${names(missedOptional)} は、解答例ではできていません。`}
        </Alert>
      ) : (
        <Alert tone="warning">
          解答例が「できている」にならない制約があります：{names(missed)}。制約の書き方があいまいか、解答例が足りていないかもしれません。
        </Alert>
      )}
      {given.length === 0 ? (
        <Alert tone="success">最初のコードのままでは、どの制約も「できている」になりません。</Alert>
      ) : (
        <Alert tone="warning">
          最初のコードのままで「できている」になる制約があります：{names(given)}
          。何も書かなくても満たせるので、制約か最初のコードを見直してください。
        </Alert>
      )}
      {solution && (
        <details class="code-trial-detail" open={missed.length > 0}>
          <summary>
            解答例の判定
            <Icon name="chevronDown" size={14} class="code-task-arrow" />
          </summary>
          <VerdictList verdicts={solution} />
        </details>
      )}
      <details class="code-trial-detail" open={given.length > 0}>
        <summary>
          最初のコードの判定
          <Icon name="chevronDown" size={14} class="code-task-arrow" />
        </summary>
        <VerdictList verdicts={starter} />
      </details>
    </div>
  )
}

/** 判定の根拠になった、提出したコードの場所と抜粋 */
const EvidenceQuote = ({ result }: { result: ConstraintResult }) => {
  const { evidence } = result
  const file =
    evidence &&
    Object.values(CODE_FILES)
      .flat()
      .find((f) => f.key === evidence.file)
  if (!evidence || !file) return null
  return (
    <span class="code-evidence">
      <span class="muted small">
        根拠：{file.name} の {evidence.line} 行目
      </span>
      <code>{evidence.quote}</code>
    </span>
  )
}

/**
 * 制約ごとの判定の一覧。学生にはラベルだけを、showText（教師）なら判定の内容も出す。confidence（Jev の判定の確からしさ）があれば、理由の代わりに出す。
 * editable（教師の提出の画面）なら、制約ごとに判定を選び直す欄（verdict_0・verdict_1…）を出す。送るフォームは呼ぶ側が包む
 */
export const VerdictList = ({
  verdicts,
  showText = false,
  editable = false,
}: {
  verdicts: readonly ConstraintResult[]
  showText?: boolean
  editable?: boolean
}) => {
  useStyle('/src/components/code.css')
  return (
    <ul class="code-verdicts">
      {verdicts.map((v, i) => (
        <li class={`code-verdict is-${v.verdict}`}>
          <Icon name={VERDICT_ICONS[v.verdict]} size={18} class="code-verdict-icon" />
          <div class="code-verdict-text">
            <span>
              <span class="sr-only">{VERDICT_LABELS[v.verdict]}：</span>
              {v.label}
              {v.optional && <Chip class="code-goal-kind">{CONSTRAINT_KIND_LABELS.optional}</Chip>}
              {v.aiVerdict && (
                <Chip tone="accent" class="code-goal-kind">
                  教師が変更
                </Chip>
              )}
              {showText && v.review && (
                <Chip icon="eye" class="code-goal-kind" title="最初の判定に自信がなく、判定し直したら違う判定になりました">
                  要確認
                </Chip>
              )}
            </span>
            {showText && v.text && <span class="muted small">判定の内容：{v.text}</span>}
            {v.reason ? (
              <span class="muted small">{v.reason}</span>
            ) : (
              v.confidence !== undefined && (
                <span class="muted small">
                  {VERDICT_LABELS[v.verdict]}（確からしさ {Math.round(v.confidence * 100)}%）
                </span>
              )
            )}
            {showText && v.aiVerdict && <span class="muted small">AI の判定：{VERDICT_LABELS[v.aiVerdict]}</span>}
            <EvidenceQuote result={v} />
            {editable && (
              <SegmentedControl
                name={`verdict_${i}`}
                label={`「${v.label}」の判定`}
                options={VERDICTS.map((verdict) => ({ value: verdict, label: VERDICT_MARKS[verdict] }))}
                value={v.verdict}
                class="code-verdict-edit"
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** 学生が、判定の確認を教師に頼む欄。判定済みで、制約ごとの判定がある提出にだけ出す */
const AppealRow = ({ grade, action }: { grade: GradeView; action: string }) => {
  const state = appealStateOf(grade)
  return (
    <div class="code-appeal">
      {state === 'none' ? (
        <form
          method="post"
          action={action}
          data-confirm="この判定を、教師に確かめてもらいますか？"
          data-confirm-ok="知らせる"
          data-loading-form
        >
          <span class="muted small">判定がおかしいと思ったら</span>
          <Button type="submit" size="sm" variant="ghost" icon="flag">
            教師に知らせる
          </Button>
        </form>
      ) : (
        <p class="muted small">
          <Icon name="flag" size={14} />
          {state === 'open' ? '教師に知らせました。教師が判定を確かめるまで、お待ちください。' : '教師が判定を確かめました。'}
        </p>
      )}
    </div>
  )
}

/** appeal は、判定の確認を教師に頼む送信先（/code/appeal） */
const GradeResult = ({ grade, appeal }: { grade: GradeView; appeal: string }) => {
  const verdicts = grade.status === 'graded' ? grade.verdicts : null
  const counts = verdicts && verdictCounts(verdicts)
  return (
    <>
      {grade.status === 'pending' ? (
        <p class="code-grade-waiting muted">
          <span class="code-grade-spinner" aria-hidden="true" />
          <span>
            AI が判定しています。終わると、ここに結果が出ます。
            <span data-code-grade-ahead>{aheadText(grade.ahead)}</span>
          </span>
        </p>
      ) : grade.status === 'failed' ? (
        <Alert tone="warning">AI で判定できませんでした。少し待ってから出し直してください。</Alert>
      ) : verdicts?.length && counts ? (
        <div class="stack">
          <p class="code-grade-summary">
            {isCleared(verdicts) ? (
              <>
                <Chip tone="success" icon="check">
                  クリア
                </Chip>
                {counts.optional.total === 0
                  ? 'すべての制約ができています。'
                  : `必須の制約がすべてできています。発展は ${counts.optional.passed} / ${counts.optional.total} できています。`}
              </>
            ) : (
              <>
                <strong>
                  {counts.required.passed} / {counts.required.total}
                </strong>
                の{counts.optional.total > 0 && '必須の'}制約ができています。足りないところを直して、出し直しましょう。
              </>
            )}
          </p>
          <VerdictList verdicts={verdicts} />
          <AppealRow grade={grade} action={appeal} />
        </div>
      ) : grade.status === 'none' ? (
        <p class="muted">提出を受け付けました。教師が確認します。</p>
      ) : null}
      {grade.status === 'graded' && grade.feedback && (
        <div class="code-grade-note">
          <h3>AI の講評</h3>
          <p>{grade.feedback}</p>
        </div>
      )}
      {grade.teacherComment && (
        <div class="code-grade-note">
          <h3>教師のコメント</h3>
          <p>{grade.teacherComment}</p>
        </div>
      )}
    </>
  )
}

/**
 * 学生の提出のタブの中身。次に提出できるまでの残り・完了の状態・いちばん新しい提出の判定・これまでの提出を並べる。
 * 判定中は data-code-grade（確かめる先の URL）を付け、src/code-editor.ts が判定の終わりを待って、この中身と、
 * 判定を重ねているクリアの条件（data-code-grade-with の id）、ヘッダーの帯の表示（data-code-grade-chip）を取り直す
 */
export const CodeSubmissions = ({
  view,
  base,
  completion,
}: {
  view: SubmissionsView
  /** 判定の終わりを確かめる先と、判定の確認を頼む先の共通部分（`/courses/1/items/2/code`） */
  base: string
  completion?: Child
}) => {
  useStyle('/src/components/code.css')
  const { grade, history, period } = view
  const status = submitStatus(view)
  const older = history.slice(1)
  const length = period.opensAt !== null && period.closesAt !== null ? period.closesAt - period.opensAt : 0
  return (
    <div
      id="code-submissions"
      class="code-submissions"
      data-code-grade={grade?.status === 'pending' ? `${base}/grading` : undefined}
      data-code-grade-with="code-goals"
    >
      <div class="code-submissions-status">
        <p
          class="code-countdown"
          data-code-countdown={status.ready}
          data-code-countdown-prefix={status.prefix}
          data-code-countdown-closed={CLOSED_TEXT}
          data-waiting={status.blocked ? '' : undefined}
        >
          <Icon name="clock" size={16} />
          <span data-code-countdown-text>{status.text}</span>
        </p>
        {completion}
        {period.opensAt !== null && period.closesAt !== null && (
          <p class="code-period muted small">
            <Icon name="calendar" size={14} />
            提出の期間 {formatDateTime(period.opensAt)} 〜 {formatDateTime(period.closesAt)}
            {length >= LONG_SUBMIT_PERIOD && `（${formatPeriodLength(length)}）`}
          </p>
        )}
      </div>
      {grade ? (
        <Card heading="いちばん新しい提出" description={`${formatDateTime(grade.createdAt)} に提出`} class="code-grade">
          <GradeResult grade={grade} appeal={`${base}/appeal`} />
        </Card>
      ) : (
        <div class="code-submissions-empty">
          <Icon name="upload" size={24} />
          <p class="strong">まだ提出していません</p>
          <p class="muted small">提出すると、AI がクリアの条件ごとに判定し、ここに結果が出ます。</p>
        </div>
      )}
      {older.length > 0 && (
        <Card heading="これまでの提出" description={`ほかに ${older.length} 回提出しています。`}>
          <ul class="code-history">
            {older.map((s) => (
              <li>
                <details>
                  <summary>
                    <span class="code-history-time">{formatDateTime(s.createdAt)}</span>
                    <SubmissionChip submission={s} />
                    <Icon name="chevronDown" size={14} class="code-task-arrow" />
                  </summary>
                  {s.status === 'graded' && s.verdicts?.length ? (
                    <VerdictList verdicts={s.verdicts} />
                  ) : (
                    <p class="muted small">制約ごとの判定はありません。</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
