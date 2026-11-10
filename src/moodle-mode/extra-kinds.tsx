import type { FC } from 'hono/jsx'
import { Button } from '../components/button'
import { LinkCard } from '../components/card'
import { CodeGradingFields, CodeStarterFields } from '../components/code'
import { SelectField } from '../components/form'
import type { IconName } from '../components/icons'
import { MarkdownEditor } from '../components/markdown'
import { Chip } from '../components/ui'
import {
  CODE_FILE_KEYS,
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  DEFAULT_MAX_SCORE,
  DEFAULT_STARTER,
  filesFor,
  isCodeLanguage,
  type CodeFiles,
} from '../lib/code'
import { gradingEnabled } from '../lib/code-grader'
import type { CourseAccess } from '../lib/courses'
import type { FieldErrors, FormName } from '../lib/forms'
import { sandboxEnabled } from '../lib/sandbox'
import { isSharing } from '../lib/screen-share'
import type { MItem } from './mapping'

export type ExtraData = Record<string, unknown>

/**
 * Moodle モードだけにある種類のアイテムの定義。中身は moodle-mode.db の extra_items に JSON で保存し、完全移行では引き継がない。
 * 種類を足すときは EXTRA_KINDS に定義を足し、forms.ts に extraItemFields を含むスキーマを登録する
 */
export type ExtraKind = {
  label: string
  /** アイテムを追加するときの種類の説明 */
  description: string
  icon: IconName
  /** 入力の検証に使うスキーマ。extraItemFields（タイトル・学生への表示・完了の条件）を含めて作る */
  form: FormName
  /** 検証を通った値から、保存する中身を作る */
  toData: (values: Record<string, unknown>) => ExtraData
  /** 追加・編集の画面の、種類ごとの入力欄。values は保存済みの中身か、検証で弾かれたときに送られてきたままの値 */
  Fields: FC<{ values: Record<string, unknown>; errors: FieldErrors; idPrefix: string }>
  /** アイテムの画面の本体 */
  View: FC<{ item: MItem; data: ExtraData; access: CourseAccess }>
  /**
   * 付けると、一覧や目次からはアイテムの画面ではなく、その下のこのパスの画面を新しいタブで開く。
   * Moodle の画面からも新しいタブで開き、/m/<key> からもこの画面に移る
   */
  tabPath?: string
  /** 一覧に「配信中」を出すか。引数は活動の cmid */
  isLive?: (cmid: number) => boolean
}

const SCREEN_PATH = 'screen'

const screen: ExtraKind = {
  label: '画面共有',
  description: '授業中に画面を配信する',
  icon: 'monitor',
  form: 'extraItem',
  toData: () => ({}),
  Fields: () => null,
  View: ({ item, access }) => (
    <LinkCard
      href={`/courses/${access.course.id}/items/${item.id}/${SCREEN_PATH}`}
      icon="monitor"
      class="link-card-lg kind-extra"
      target="_blank"
      rel="noopener"
      data-no-prefetch
    >
      <span class="file-name">
        <span class="strong">画面共有を開く</span>
        <span class="muted small truncate">別のタブで開きます</span>
      </span>
      {item.extra?.live && <Chip tone="live">配信中</Chip>}
      <Button as="span" variant="primary" iconEnd="external">
        開く
      </Button>
    </LinkCard>
  ),
  tabPath: SCREEN_PATH,
  isLive: isSharing,
}

/** コードのアイテムの種類の名前と、エディターの画面のパス（/courses/:id/items/:iid/code） */
export const CODE_KIND = 'code'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const codeFilesOf = (source: Record<string, unknown>): CodeFiles => Object.fromEntries(CODE_FILE_KEYS.map((key) => [key, str(source[key])]))

const CodeFields: ExtraKind['Fields'] = ({ values, errors, idPrefix }) => {
  const language = str(values.language)
  // 言語が決まっていないのは、追加するとき。最初のコードと採点基準は、言語が決まったあとの編集画面で設定する
  if (!isCodeLanguage(language)) {
    return (
      <>
        <SelectField
          label="言語"
          name="language"
          id={`${idPrefix}-language`}
          options={CODE_LANGUAGES.filter((l) => l !== 'python' || sandboxEnabled).map((l) => ({
            value: l,
            label: CODE_LANGUAGE_LABELS[l],
          }))}
          hint="あとから変えられません。最初に入れておくコードと採点基準は、追加したあとに編集画面で設定します。"
        />
        <MarkdownEditor label="問題文" name="body" id={`${idPrefix}-body`} rows={4} placeholder="あとから編集画面でも書けます" />
      </>
    )
  }
  // 保存済みの中身では starter にまとまっていて、検証で弾かれて送られてきたままの値では html・css などが直に入っている
  const starter = codeFilesOf(
    typeof values.starter === 'object' && values.starter !== null ? (values.starter as Record<string, unknown>) : values,
  )
  const maxScore = values.maxScore ?? values.max_score
  return (
    <>
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="starter_set" value="1" />
      <MarkdownEditor label="問題文" name="body" id={`${idPrefix}-body`} value={str(values.body)} error={errors.body} rows={10} />
      <CodeStarterFields language={language} starter={starter} stdin={str(values.stdin)} errors={errors} idPrefix={idPrefix} />
      <CodeGradingFields
        gradingEnabled={gradingEnabled}
        criteria={str(values.criteria)}
        maxScore={typeof maxScore === 'number' || typeof maxScore === 'string' ? String(maxScore) : ''}
        errors={errors}
        idPrefix={idPrefix}
      />
    </>
  )
}

const code: ExtraKind = {
  label: 'コード',
  description: 'コードを書いて提出する',
  icon: 'terminal',
  form: 'extraCode',
  // 中身の読み取りは moodle-mode/code.ts の codeSettingsOf。タイトルも入れておくのは、採点が Moodle に問い合わせずに動くため
  toData(values) {
    const language = isCodeLanguage(str(values.language)) ? (values.language as (typeof CODE_LANGUAGES)[number]) : 'web'
    return {
      title: str(values.title),
      body: str(values.body),
      language,
      starter: values.starter_set === 1 ? filesFor(language, codeFilesOf(values)) : DEFAULT_STARTER[language],
      stdin: language === 'python' ? str(values.stdin) : '',
      criteria: str(values.criteria),
      maxScore: Number(values.max_score) || DEFAULT_MAX_SCORE,
    }
  },
  Fields: CodeFields,
  View: ({ item, access }) => (
    <LinkCard
      href={`/courses/${access.course.id}/items/${item.id}/${CODE_KIND}`}
      icon="terminal"
      class="link-card-lg kind-extra"
      target="_blank"
      rel="noopener"
      data-no-prefetch
    >
      <span class="file-name">
        <span class="strong">エディターを開く</span>
        <span class="muted small truncate">別のタブで開きます</span>
      </span>
      <Button as="span" variant="primary" iconEnd="external">
        開く
      </Button>
    </LinkCard>
  ),
  tabPath: CODE_KIND,
}

export const EXTRA_KINDS: Record<string, ExtraKind> = { screen, [CODE_KIND]: code }

export const extraKindOf = (type: string): ExtraKind | null => (Object.hasOwn(EXTRA_KINDS, type) ? EXTRA_KINDS[type] : null)
