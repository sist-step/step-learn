import type { Child, JSX } from 'hono/jsx'
import {
  CODE_FILES,
  CODE_LANGUAGE_LABELS,
  JUDGES,
  JUDGE_LABELS,
  MAX_SUBMIT_PERIOD,
  VERDICT_LABELS,
  clearedCount,
  formatWait,
  isCleared,
  type CodeFiles,
  type CodeLanguage,
  type ConstraintResult,
  type GradingStatus,
  type Judge,
  type SubmitState,
  type Verdict,
} from '../lib/code'
import type { FieldErrors } from '../lib/forms'
import { Button, IconButton } from './button'
import { Card } from './card'
import { cx } from './cx'
import { FieldError, FormField, Input, TextAreaField, TextField, Textarea } from './form'
import { Icon, type IconName } from './icons'
import { Markdown } from './markdown'
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

/** Moodle モードの入力欄の、AI の講評に使う採点基準の欄（教師）。Moodle モードには制約の欄がないので、講評だけを返す */
export const CodeGradingFields = ({
  gradingEnabled,
  criteria,
  errors,
  idPrefix = 'f',
}: {
  /** AI が設定されていて、提出に講評を付けるか */
  gradingEnabled: boolean
  criteria: string
  errors: FieldErrors
  idPrefix?: string
}) => (
  <fieldset class="field">
    <legend>AI の講評</legend>
    <p class="field-hint">
      {gradingEnabled
        ? '学生が提出すると、AI が講評を付けます。'
        : 'AI が設定されていないため、講評は付きません。提出の画面で教師がコメントを書きます。'}
    </p>
    <TextAreaField
      label="採点基準"
      name="criteria"
      id={`${idPrefix}-criteria`}
      rows={6}
      value={criteria}
      error={errors.criteria}
      hint="学生には表示されません。AI に見てほしい点を書きます。"
    />
  </fieldset>
)

/**
 * アイテムの編集画面の、問題文から最初のコードと採点基準の下書きを AI に作らせるボタン（教師）。
 * 押すと src/code-editor.ts が action に問題文を送り、返ってきた下書きを同じフォームの欄に入れる
 */
export const CodeSuggest = ({ action }: { action: string }) => {
  useStyle('/src/components/code.css')
  return (
    <div class="code-suggest">
      <p class="muted small" role="status" data-code-suggest-status>
        問題文から、最初のコードと採点基準の下書きを AI で作れます（30 秒ほど）。
      </p>
      <Button size="sm" icon="sparkles" data-code-suggest={action}>
        下書きを作る
      </Button>
    </div>
  )
}

type StarterTab = { key: string; name: string; syntax: CodeSyntax; value: string; hint?: string }

/**
 * 通常モードの編集画面の「最初のコード」のカード（教師）。ファイルをタブで切り替えるエディターと、Web ならその場のプレビューを横に並べる。
 * タブの切り替え・プレビュー・ひな形に戻す操作は src/code-editor.ts が受け持つ
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
  const tabs: StarterTab[] = [
    ...CODE_FILES[language].map((f) => ({ key: f.key, name: f.name, syntax: f.key, value: starter[f.key] ?? '' })),
    ...(language === 'python' ? [{ key: 'stdin', name: '入力の例', syntax: 'text' as const, value: stdin, hint: STDIN_HINT }] : []),
  ]
  const selected = tabs.find((t) => errors[t.key])?.key ?? tabs[0].key
  return (
    <Card
      class="editor-extra code-section"
      heading="最初のコード"
      description="学生が最初に開いたときに入っているコードです。どこに何を書くかをコメントで示しておくと、取りかかりやすくなります。"
      actions={
        <Button size="sm" variant="ghost" icon="undo" aria-label="ひな形に戻す" data-code-starter-reset={language}>
          <span class="hide-sm">ひな形に戻す</span>
        </Button>
      }
      data-code-starter
    >
      <div class={cx('code-starter', language === 'web' && 'has-preview')}>
        <div class="code-starter-editor">
          <div class="code-pane-head">
            <div class="code-tabs" role="tablist" aria-label="ファイル">
              {tabs.map((t) => (
                <button
                  type="button"
                  role="tab"
                  id={`starter-tab-${t.key}`}
                  class={cx(errors[t.key] && 'has-error')}
                  aria-selected={t.key === selected ? 'true' : 'false'}
                  aria-controls={`starter-file-${t.key}`}
                  tabindex={t.key === selected ? 0 : -1}
                  data-code-tab={t.key}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          {tabs.map((t) => (
            <div
              class={cx('field code-file', errors[t.key] && 'has-error')}
              role="tabpanel"
              id={`starter-file-${t.key}`}
              aria-labelledby={`starter-tab-${t.key}`}
              hidden={t.key !== selected}
              data-code-file={t.key}
            >
              <CodeInput
                syntax={t.syntax}
                id={`f-starter-${t.key}`}
                name={t.key}
                value={t.value}
                invalid={!!errors[t.key]}
                aria-label={t.name}
                aria-describedby={`f-starter-${t.key}-error`}
                fill
              />
              <FieldError id={`f-starter-${t.key}`} error={errors[t.key]} />
              {t.hint && <p class="field-hint">{t.hint}</p>}
            </div>
          ))}
        </div>
        {language === 'web' && (
          <div class="code-starter-preview">
            <div class="code-pane-head">
              <span class="code-pane-title">
                <Icon name="eye" size={16} /> 学生に見えるページ
              </span>
            </div>
            <iframe
              class="code-preview"
              title="最初のコードのプレビュー"
              sandbox="allow-scripts allow-forms allow-modals"
              data-code-preview
            />
          </div>
        )}
      </div>
    </Card>
  )
}

/** 編集画面の制約の 1 行の、入力中の値 */
export type ConstraintRow = { label: string; text: string }

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
    <IconButton icon="x" label="この制約を消す" data-code-constraint-remove />
  </li>
)

/**
 * 通常モードの編集画面の「判定」のカード（教師）。制約を 1 行ずつ書く。行の追加と削除は src/code-editor.ts が受け持つ。
 * 制約の欄のエラーは fieldset（name="constraints"）に出す。行ごとの入力欄は同じ名前が並ぶので、エラーの置き場所にできないため
 */
/** アイテムの編集画面の右の列に置く、学生が提出できる期間の欄 */
export const CodePeriodCard = ({ opensAt, closesAt, errors }: { opensAt: string; closesAt: string; errors: FieldErrors }) => (
  <Card
    heading="提出の期間"
    description={`学生はこの期間だけ提出できます。長さは ${MAX_SUBMIT_PERIOD / 3600} 時間までです。期間の外でも、問題を見てコードを書くことはできます。`}
  >
    <div class="stack">
      <TextField label="開始日時" name="opens_at" type="datetime-local" value={opensAt} error={errors.opens_at} />
      <TextField label="終了日時" name="closes_at" type="datetime-local" value={closesAt} error={errors.closes_at} />
    </div>
  </Card>
)

export const CodeGradingCard = ({
  gradingEnabled,
  criteria,
  constraints,
  judge,
  errors,
}: {
  gradingEnabled: boolean
  criteria: string
  constraints: ConstraintRow[]
  /** 制約ごとの判定をするものの切り替え（開発サーバーだけ）。form は切り替えを送るフォームの id */
  judge?: { current: Judge; form: string }
  errors: FieldErrors
}) => {
  useStyle('/src/components/code.css')
  return (
    <Card
      class="editor-extra code-section code-grading"
      heading="判定"
      description={
        gradingEnabled
          ? '学生が提出すると、AI が制約ごとに「できている・一部できている・できていない」を判定します。'
          : 'AI が設定されていないため、判定されません。提出の画面で教師がコメントを書きます。'
      }
    >
      <div class="stack">
        {judge && (
          <div class="code-dev-judge">
            <div class="code-dev-judge-text">
              <span class="strong small">
                制約の判定 <Chip>開発サーバーだけ</Chip>
              </span>
              <span class="muted small">
                すべてのアイテムに効きます。本番では常に AI（DeepSeek）です。Jev は理由と講評を返しません。保存していない変更は消えます。
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
        <fieldset
          name="constraints"
          id="f-constraints"
          class={cx('field code-constraints', errors.constraints && 'has-error')}
          aria-invalid={errors.constraints ? 'true' : undefined}
          aria-describedby="f-constraints-error"
          data-code-constraints
        >
          <legend>制約</legend>
          <p class="field-hint">
            問題文の要件を 1 行ずつ書きます。ラベルは「クリアの条件」として学生にも見え、判定の内容は AI
            だけが使います（空ならラベルで判定します）。完了の条件を「制約をすべてクリアしたら完了」にすると、すべて「できている」になったときに完了します。
          </p>
          <ol class="code-constraint-list" data-code-constraint-list>
            {constraints.map((row) => (
              <ConstraintRowView row={row} />
            ))}
          </ol>
          <p class="code-constraint-empty muted small">
            制約はまだありません。問題文から AI で作るか、「制約を追加」で書き足します。保存するには 1 つ以上必要です。
          </p>
          <div class="code-constraint-foot">
            <Button size="sm" icon="plus" data-code-constraint-add>
              制約を追加
            </Button>
          </div>
          <FieldError id="f-constraints" error={errors.constraints} />
          <template data-code-constraint-template>
            <ConstraintRowView row={{ label: '', text: '' }} />
          </template>
        </fieldset>
        <TextAreaField
          label="補足（任意）"
          name="criteria"
          id="f-criteria"
          rows={3}
          value={criteria}
          error={errors.criteria}
          hint="制約にしにくい、見てほしい点（読みやすさなど）を書きます。AI が判定と講評の参考にします。学生には表示されません。"
        />
      </div>
    </Card>
  )
}

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
  base,
  language,
  body,
  goals,
  canRun,
  submissions,
  completion,
}: {
  /** 実行・保存・提出の送信先の共通部分（`/courses/1/items/2/code`） */
  base: string
  language: CodeLanguage
  /** 問題文（Markdown） */
  body: string
  /** クリアの条件（制約のラベル）。問題文の下に並べる */
  goals: readonly string[]
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
    <div class="code-stage" data-code-workspace={language} data-code-base={base}>
      <form id={CODE_FORM} method="post" action={`${base}/submit`} class="code-edit" data-loading-form>
        {(body || goals.length > 0) && (
          <details class="code-task" open>
            <summary>
              <Icon name="page" size={16} /> 問題
              <Icon name="chevronDown" size={14} class="code-task-arrow" />
            </summary>
            {goals.length > 0 && (
              <div class="code-goals">
                <h3>クリアの条件</h3>
                <ul>
                  {goals.map((goal) => (
                    <li>
                      <Icon name="checkCircle" size={16} />
                      {goal}
                    </li>
                  ))}
                </ul>
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
      <form id={RESET_FORM} method="post" action={`${base}/reset`} data-confirm="書いたコードを消して、最初のコードに戻しますか？" hidden />

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
            <CodeSubmissions view={submissions} pollUrl={`${base}/grading`} completion={completion} />
          </div>
        )}
      </div>
    </div>
  )
}

/** 学生に見せる、いちばん新しい提出の判定 */
export type GradeView = {
  status: GradingStatus
  feedback: string
  verdicts: ConstraintResult[] | null
  teacherComment: string
  createdAt: number
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

/** 制約ごとの判定の短いまとめ（「クリア」「3 / 4 クリア」）。判定がなければ null */
export const verdictSummary = (verdicts: readonly ConstraintResult[] | null) =>
  !verdicts?.length ? null : isCleared(verdicts) ? 'クリア' : `${clearedCount(verdicts)} / ${verdicts.length} クリア`

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

/** 制約ごとの判定の一覧。学生にはラベルだけを、showText（教師）なら判定の内容も出す。confidence（Jev の判定の確からしさ）があれば、理由の代わりに出す */
export const VerdictList = ({ verdicts, showText = false }: { verdicts: readonly ConstraintResult[]; showText?: boolean }) => {
  useStyle('/src/components/code.css')
  return (
    <ul class="code-verdicts">
      {verdicts.map((v) => (
        <li class={`code-verdict is-${v.verdict}`}>
          <Icon name={VERDICT_ICONS[v.verdict]} size={18} class="code-verdict-icon" />
          <div class="code-verdict-text">
            <span>
              <span class="sr-only">{VERDICT_LABELS[v.verdict]}：</span>
              {v.label}
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
          </div>
        </li>
      ))}
    </ul>
  )
}

const GradeResult = ({ grade }: { grade: GradeView }) => {
  const verdicts = grade.status === 'graded' ? grade.verdicts : null
  return (
    <>
      {grade.status === 'pending' ? (
        <p class="code-grade-waiting muted">
          <span class="code-grade-spinner" aria-hidden="true" />
          AI が判定しています。終わると、ここに結果が出ます。
        </p>
      ) : grade.status === 'failed' ? (
        <Alert tone="warning">AI で判定できませんでした。少し待ってから出し直してください。</Alert>
      ) : verdicts?.length ? (
        <div class="stack">
          <p class="code-grade-summary">
            {isCleared(verdicts) ? (
              <>
                <Chip tone="success" icon="check">
                  クリア
                </Chip>
                すべての制約ができています。
              </>
            ) : (
              <>
                <strong>
                  {clearedCount(verdicts)} / {verdicts.length}
                </strong>
                の制約ができています。足りないところを直して、出し直しましょう。
              </>
            )}
          </p>
          <VerdictList verdicts={verdicts} />
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
 * 判定中は data-code-grade（確かめる先の URL）を付け、src/code-editor.ts が判定の終わりを待って、この中身とヘッダーの帯の表示（data-code-grade-chip）を取り直す
 */
export const CodeSubmissions = ({ view, pollUrl, completion }: { view: SubmissionsView; pollUrl: string; completion?: Child }) => {
  useStyle('/src/components/code.css')
  const { grade, history, period } = view
  const status = submitStatus(view)
  const older = history.slice(1)
  return (
    <div id="code-submissions" class="code-submissions" data-code-grade={grade?.status === 'pending' ? pollUrl : undefined}>
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
          </p>
        )}
      </div>
      {grade ? (
        <Card heading="いちばん新しい提出" description={`${formatDateTime(grade.createdAt)} に提出`} class="code-grade">
          <GradeResult grade={grade} />
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
