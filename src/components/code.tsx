import type { Child, JSX } from 'hono/jsx'
import { CODE_FILES, finalScore, type CodeLanguage, type GradingStatus } from '../lib/code'
import { Button, IconButton } from './button'
import { Card } from './card'
import { cx } from './cx'
import { FormField, Textarea } from './form'
import { Icon } from './icons'
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

export const CODE_FORM = 'code-form'
const RESET_FORM = 'code-reset'

/**
 * コードのアイテムの本体。ヘッダーの下いっぱいに、左に問題文とエディター、右にプレビュー（Web）か実行結果（Python）を出す。
 * コードは描かず、src/code-editor.ts が `${base}/state` から読み込む。ここに描くと、書きかけのコードや最初のコードが変わるたびに
 * 描く内容が変わり、コースの変更の反映（CourseLiveSync）が、書いている途中のエディターの入力欄を差し替えてしまう
 */
export const CodeWorkspace = ({
  base,
  language,
  body,
  canRun,
}: {
  /** 実行・保存・提出の送信先の共通部分（`/courses/1/items/2/code`） */
  base: string
  language: CodeLanguage
  /** 問題文（Markdown） */
  body: string
  /** Python を実行できるか（sandbox が設定されているか） */
  canRun: boolean
}) => {
  useStyle('/src/components/code.css')
  const files = CODE_FILES[language]
  return (
    <div class="code-stage" data-code-workspace={language} data-code-base={base}>
      <form id={CODE_FORM} method="post" action={`${base}/submit`} class="code-edit" data-loading-form>
        {body && (
          <details class="code-task" open>
            <summary>
              <Icon name="page" size={16} /> 問題
              <Icon name="chevronDown" size={14} class="code-task-arrow" />
            </summary>
            <Markdown source={body} />
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

      {language === 'web' ? (
        <div class="code-result">
          <div class="code-pane-head">
            <span class="code-pane-title">
              <Icon name="eye" size={16} /> プレビュー
            </span>
            <IconButton icon="arrowPath" label="プレビューを読み込み直す" data-code-refresh />
          </div>
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
        </div>
      ) : (
        <div class="code-result">
          <div class="code-pane-head">
            <span class="code-pane-title">
              <Icon name="terminal" size={16} /> 実行結果
            </span>
            <Button variant="primary" size="sm" icon="play" title="実行（⌘Enter / Ctrl+Enter）" disabled={!canRun} data-code-run>
              実行
            </Button>
          </div>
          {!canRun && <Alert tone="warning">Python を実行する環境が設定されていないため、実行できません。</Alert>}
          <div class="field code-stdin">
            <label for="code-stdin">入力（プログラムが input() で読む内容）</label>
            <Textarea id="code-stdin" name="stdin" form={CODE_FORM} rows={3} class="code-mono" spellcheck={false} />
          </div>
          <div class="code-output" aria-live="polite" data-code-output>
            <p class="muted">「実行」を押すと、ここに結果が出ます。</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** 学生に見せる、いちばん新しい提出の採点 */
export type GradeView = {
  status: GradingStatus
  score: number | null
  feedback: string
  teacherScore: number | null
  teacherComment: string
  createdAt: number
  maxScore: number
}

/** ヘッダーの帯に出す、提出の状況の短い表示 */
export const gradeLabel = (grade: GradeView) => {
  const score = finalScore(grade)
  if (score !== null) return `${score} / ${grade.maxScore} 点`
  return grade.status === 'pending' ? '採点中…' : `${formatDateTime(grade.createdAt)} に提出`
}

export const GRADE_CARD = 'code-grade'

/**
 * 学生に見せる提出と採点の結果。採点中は data-code-grade（確かめる先の URL）を付け、src/code-editor.ts が採点の終わりを待って、
 * このカードとヘッダーの帯の表示（data-code-grade-chip）を取り直す。帯の表示は、このカードへのリンクにする
 */
export const CodeGrade = ({ grade, pollUrl }: { grade: GradeView; pollUrl: string }) => {
  useStyle('/src/components/code.css')
  const score = finalScore(grade)
  const pending = grade.status === 'pending' && score === null
  return (
    <Card
      id={GRADE_CARD}
      class="code-grade"
      heading="提出と採点"
      description={`${formatDateTime(grade.createdAt)} に提出`}
      data-code-grade={pending ? pollUrl : undefined}
    >
      {score !== null ? (
        <p class="code-grade-score">
          <strong>{score}</strong>
          <span class="muted">/ {grade.maxScore} 点</span>
          {grade.teacherScore !== null ? <Chip icon="check">教師が採点</Chip> : <Chip>AI が採点</Chip>}
        </p>
      ) : pending ? (
        <p class="code-grade-waiting muted">
          <span class="code-grade-spinner" aria-hidden="true" />
          AI が採点しています。終わると、ここに結果が出ます。
        </p>
      ) : grade.status === 'failed' ? (
        <Alert tone="warning">AI で採点できませんでした。教師の採点を待つか、少し待ってから出し直してください。</Alert>
      ) : (
        <p class="muted">提出を受け付けました。教師が確認します。</p>
      )}
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
      {grade.status === 'graded' && grade.teacherScore === null && (
        <p class="muted small">AI による採点です。教師が確認して、点数を変えることがあります。</p>
      )}
    </Card>
  )
}
