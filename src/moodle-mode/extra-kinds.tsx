import type { FC } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import {
  AGENT_BODY_HINT,
  AgentEditPanel,
  AgentInstructionsField,
  AgentModelFields,
  AgentOpen,
  AgentPeriodFields,
} from '../components/agent'
import { BundleEditPanel, BundleOpen, type BundleView } from '../components/bundle'
import { Button } from '../components/button'
import { LinkCard } from '../components/card'
import { CodeAiHelp, CodeGradingFields, CodeOpen, CodePeriodFields, CodeStarterFields, type ConstraintRow } from '../components/code'
import { SelectField } from '../components/form'
import type { IconName } from '../components/icons'
import { Markdown, MarkdownEditor } from '../components/markdown'
import { QuizFields, QuizPanel } from '../components/quiz'
import { Chip } from '../components/ui'
import { AGENT_KIND, DEFAULT_AGENT_MODEL, agentBase, agentViewOf, type AgentModel, type AgentView } from '../lib/agent'
import { agentOpenRouterModels, cachedAgentOpenRouterModels, resolveAgentModel } from '../lib/agent-model'
import {
  CODE_FILE_KEYS,
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  DEFAULT_STARTER,
  filesFor,
  isCodeLanguage,
  type CodeFiles,
} from '../lib/code'
import { dateTimeInputToUnix, isDateTimeInput, unixToDateTimeInput } from '../lib/course-period'
import { BUNDLE_KIND, bundleBase } from '../lib/bundle'
import { BUNDLE_MODULE } from '../lib/bundle'
import { syncStateOf } from '../lib/bundle-sync'
import { gradingEnabled, submissionsOf } from '../lib/code-grader'
import type { CourseAccess } from '../lib/courses'
import { readConstraints, type FieldErrors, type FormName } from '../lib/forms'
import {
  DEFAULT_PASS_PERCENT,
  QUIZ_KIND,
  isQuizLook,
  quizFormRows,
  quizSettingsOf,
  readQuizForm,
  type QuizFormRow,
  type QuizQuestion,
} from '../lib/quiz'
import { quizViewOf, type QuizView } from '../lib/quiz-store'
import { availableCodeLanguages } from '../lib/sandbox'
import { isSharing } from '../lib/screen-share'
import type { AppEnv } from '../lib/types'
import { agentModelData, agentModelOfData, agentPeriodOf, agentStore } from './agent-store'
import { bundleStore, bundleSyncStore } from './bundle-store'
import { codeSettingsOf, codeStore, grader } from './code-store'
import type { Api, MoodleCourse, SaveActivity } from './client'
import type { MItem } from './mapping'
import { quizStore } from './quiz'

export type ExtraData = Record<string, unknown>

/**
 * Moodle モードだけにある種類のアイテムの定義。中身は moodle-mode.db の extra_items に JSON で保存し、完全移行では引き継がない。
 * Moodle には、その位置に /m/<key> へ移る URL の活動か、種類ごとの専用の活動（module）を置く。
 * 種類を足すときは EXTRA_KINDS に定義を足し、forms.ts に extraItemFields を含むスキーマを登録する
 */
/** 編集画面で開いているアイテム。itemId は活動の cmid */
export type ExtraTarget = { courseId: number; itemId: number; title: string }

export type ExtraKind = {
  label: string
  /** アイテムを追加するときの種類の説明 */
  description: string
  icon: IconName
  /** 入力の検証に使うスキーマ。extraItemFields（タイトル・学生への表示・完了の条件）を含めて作る */
  form: FormName
  /** 検証を通った値から、保存する中身を作る */
  toData: (values: Record<string, unknown>) => ExtraData
  /**
   * 追加・編集の画面の、種類ごとの入力欄。values は保存済みの中身か、検証で弾かれたときに送られてきたままの値。
   * saved は保存済みの中身、target は編集しているアイテム。どちらも追加の画面では渡さない
   */
  Fields: FC<{ values: Record<string, unknown>; errors: FieldErrors; idPrefix: string; saved?: ExtraData; target?: ExtraTarget }>
  /**
   * 検証を通った値を、保存する前に外部に問い合わせて確かめる（toData は同期なので、ここで済ませる）。
   * 返した values を toData に渡す。current は保存済みの中身（追加のときは渡さない）
   */
  prepare?: (values: Record<string, unknown>, current?: ExtraData) => Promise<{ values: Record<string, unknown> } | { errors: FieldErrors }>
  /** 編集画面を描く前に読み込んでおくもの（Fields は同期で描くので、外部から取るものは先に取ってキャッシュに置く） */
  preload?: () => Promise<unknown>
  /** アイテムの画面の本体 */
  View: FC<{ item: MItem; data: ExtraData; access: CourseAccess }>
  /** 編集画面の、保存のフォームの外に置く欄（ファイルのアップロードのように、別の送信先を持つもの） */
  Panel?: FC<{ item: MItem; access: CourseAccess }>
  /** 追加したあとに、アイテムの画面ではなく編集画面へ進めるか */
  editAfterCreate?: boolean
  /** アイテムを追加するモーダルで、種類ごとの欄の代わりに出す説明 */
  addNote?: string
  /**
   * 付けると、一覧や目次からはアイテムの画面ではなく、その下のこのパスの画面を新しいタブで開く。
   * Moodle の画面からも新しいタブで開き、/m/<key> からもこの画面に移る
   */
  tabPath?: string
  /** 一覧に「配信中」を出すか。引数は活動の cmid */
  isLive?: (cmid: number) => boolean
  /**
   * 付けると、Moodle には /m/<key> の URL の活動ではなく、専用の活動（moodle/mod_<name>）を置く。開くと STEP Learn のアイテムの画面に移る。
   * 中身は同じく moodle-mode.db に置き、活動が持つ鍵で見分ける。鍵は Moodle が決めるので、中身は最初に見たときに空で作る（extra.ts の withExtras）。
   * 名前は mapping.ts の EXTRA_MODULES にも足す
   */
  module?: {
    name: string
    /** Moodle にこの活動のプラグインが入っているか */
    available: (course: MoodleCourse) => boolean
    save: (moodle: Api, activity: SaveActivity) => Promise<number>
    /** 開いたことを Moodle に記録する（「開いたら完了」の条件を満たす） */
    view: (moodle: Api, cmid: number) => Promise<unknown>
  }
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

const listOf = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(str)

const constraintsOfForm = (values: Record<string, unknown>) =>
  readConstraints({ 'constraint_label[]': listOf(values['constraint_label[]']), 'constraint_text[]': listOf(values['constraint_text[]']) })
    .constraints

/** 入力欄に入れる制約の行。保存済みの中身では constraints にまとまっていて、送られてきたままの値では行ごとの欄の値が並んでいる */
function constraintRowsOf(values: Record<string, unknown>): ConstraintRow[] {
  if (Array.isArray(values.constraints))
    return values.constraints.map((c: Record<string, unknown>) => ({ label: str(c.label), text: str(c.text) }))
  const texts = listOf(values['constraint_text[]'])
  return listOf(values['constraint_label[]']).map((label, i) => ({ label, text: texts[i] ?? '' }))
}

/** 入力欄に入れる提出の期間。保存済みの中身では UNIX 秒、送られてきたままの値では日時の入力欄の値 */
const periodInputOf = (values: Record<string, unknown>, field: 'opens_at' | 'closes_at', saved: 'opensAt' | 'closesAt') =>
  typeof values[field] === 'string' ? values[field] : typeof values[saved] === 'number' ? unixToDateTimeInput(values[saved]) : ''

const unixOf = (input: string) => (isDateTimeInput(input) ? dateTimeInputToUnix(input) : null)

const CodeFields: ExtraKind['Fields'] = ({ values, errors, idPrefix, target }) => {
  const language = str(values.language)
  // 言語が決まっていないのは、追加するとき。問題文・最初のコード・採点基準は、言語が決まったあとの編集画面で設定する
  if (!isCodeLanguage(language)) {
    if (availableCodeLanguages.length === 1) return <input type="hidden" name="language" value={availableCodeLanguages[0]} />
    return (
      <SelectField
        label="言語"
        name="language"
        id={`${idPrefix}-language`}
        options={availableCodeLanguages.map((l) => ({ value: l, label: CODE_LANGUAGE_LABELS[l] }))}
        hint="あとから変えられません。"
      />
    )
  }
  // 保存済みの中身では starter にまとまっていて、検証で弾かれて送られてきたままの値では html・css などが直に入っている
  const base = target && `/courses/${target.courseId}/items/${target.itemId}`
  const starter = codeFilesOf(
    typeof values.starter === 'object' && values.starter !== null ? (values.starter as Record<string, unknown>) : values,
  )
  return (
    <>
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="starter_set" value="1" />
      <MarkdownEditor label="問題文" name="body" id={`${idPrefix}-body`} value={str(values.body)} error={errors.body} rows={10} split />
      {target && <CodeAiHelp item={target} />}
      <CodeStarterFields language={language} starter={starter} stdin={str(values.stdin)} errors={errors} idPrefix={idPrefix} />
      <CodeGradingFields
        gradingEnabled={gradingEnabled}
        criteria={str(values.criteria)}
        constraints={constraintRowsOf(values)}
        suggest={gradingEnabled && base ? `${base}/code/constraints` : undefined}
        errors={errors}
        idPrefix={idPrefix}
      />
      <CodePeriodFields
        opensAt={periodInputOf(values, 'opens_at', 'opensAt')}
        closesAt={periodInputOf(values, 'closes_at', 'closesAt')}
        errors={errors}
        idPrefix={idPrefix}
      />
    </>
  )
}

const code: ExtraKind = {
  label: 'コーディング問題',
  description: 'コードを書いて提出する',
  icon: 'terminal',
  form: 'extraCode',
  // 中身の読み取りは moodle-mode/code-store.ts の codeSettingsOf と codePeriodOf。タイトルも入れておくのは、採点が Moodle に問い合わせずに動くため
  toData(values) {
    const language = isCodeLanguage(str(values.language)) ? (values.language as (typeof CODE_LANGUAGES)[number]) : 'web'
    const edited = values.starter_set === 1
    return {
      title: str(values.title),
      body: str(values.body),
      language,
      starter: edited ? filesFor(language, codeFilesOf(values)) : DEFAULT_STARTER[language],
      stdin: language === 'python' ? str(values.stdin) : '',
      criteria: str(values.criteria),
      constraints: edited ? constraintsOfForm(values) : [],
      opensAt: edited ? unixOf(str(values.opens_at)) : null,
      closesAt: edited ? unixOf(str(values.closes_at)) : null,
    }
  },
  Fields: CodeFields,
  addNote: '問題文・最初のコード・制約・提出の期間は、追加したあとの編集画面で設定します。',
  editAfterCreate: true,
  View: ({ item, data, access }) => {
    const settings = codeSettingsOf(data, item.title)
    const grade = useCodeGrade(item, access)
    return (
      settings && (
        <>
          <CodeOpen
            base={`/courses/${access.course.id}/items/${item.id}/${CODE_KIND}`}
            language={settings.language}
            goals={settings.constraints.map((c) => c.label)}
            grade={grade}
            canManage={access.canManage}
          />
          {settings.body && (
            <div class="reader-sheet">
              <Markdown source={settings.body} />
            </div>
          )}
        </>
      )
    )
  },
}

// 見ている人を引数で受け取らないのは、ほかの種類の View と Panel には要らず、種類の定義の形を変えずに済ませるため
function useCodeGrade(item: MItem, access: CourseAccess) {
  const c = useRequestContext<AppEnv>()
  if (!item.extraKey || access.role !== 'student') return null
  return submissionsOf(codeStore(item.extraKey), c.var.user!.id, grader, null).grade
}

// 見ている人を引数で受け取らないのは、ほかの種類の View と Panel には要らず、種類の定義の形を変えずに済ませるため
function useBundleView(item: MItem, access: CourseAccess): BundleView {
  const viewer = { id: useRequestContext<AppEnv>().var.user!.id, canManage: access.canManage }
  if (!item.extraKey) return { files: [], sync: { enabled: false } }
  return {
    files: bundleStore(item.extraKey).list(),
    sync: syncStateOf(bundleSyncStore(item.extraKey), bundleBase(access.course.id, item.id), viewer),
  }
}

const bundle: ExtraKind = {
  label: 'ファイル自動配布',
  description: 'プログラムのファイルを VS Code で開けるように配る',
  icon: 'folder',
  form: 'extraItem',
  toData: () => ({}),
  Fields: () => null,
  addNote: '配るファイルは、追加したあとの編集画面でアップロードします。',
  View: ({ item, access }) => (
    <BundleOpen
      base={bundleBase(access.course.id, item.id)}
      {...useBundleView(item, access)}
      editHref={access.canManage ? `/courses/${access.course.id}/items/${item.id}/edit` : undefined}
    />
  ),
  Panel: ({ item, access }) => (
    <BundleEditPanel base={bundleBase(access.course.id, item.id)} {...useBundleView(item, access)} class="editor-extra" />
  ),
  editAfterCreate: true,
  module: {
    name: BUNDLE_MODULE,
    available: (course) => !!course.bundle,
    save: (moodle, activity) => moodle.saveBundle(activity),
    view: (moodle, cmid) => moodle.viewBundle(cmid),
  },
}

/** 入力欄に入れる 1 人あたりの上限。保存済みの中身では数値、送られてきたままの値では入力欄の値 */
const userLimitInputOf = (values: Record<string, unknown>) =>
  typeof values.user_limit === 'string' ? values.user_limit : String(agentPeriodOf(values).userLimit)

/** 入力欄で選んでいるモデルの ID。送られてきたままの値では agent_model、保存済みの中身では model */
const agentModelInputOf = (values: Record<string, unknown>) =>
  typeof values.agent_model === 'string' ? values.agent_model : agentModelOfData(values).id

const AgentFields: ExtraKind['Fields'] = ({ values, errors, idPrefix, saved }) => {
  // 保存済みの中身は toData が必ず userLimit を入れるので、どちらもないのは追加のモーダル。期間と上限は追加したあとの編集画面で設定する
  if (typeof values.userLimit !== 'number' && values.agent_set === undefined) return null
  return (
    <>
      <input type="hidden" name="agent_set" value="1" />
      <MarkdownEditor
        label="説明（任意）"
        name="body"
        id={`${idPrefix}-body`}
        value={str(values.body)}
        error={errors.body}
        hint={AGENT_BODY_HINT}
        rows={5}
        split
      />
      <AgentInstructionsField value={str(values.instructions)} error={errors.instructions} id={`${idPrefix}-instructions`} />
      <AgentModelFields
        value={agentModelInputOf(values)}
        saved={agentModelOfData(saved ?? values)}
        models={cachedAgentOpenRouterModels()}
        error={errors.agent_model}
        idPrefix={idPrefix}
      />
      <AgentPeriodFields
        opensAt={periodInputOf(values, 'opens_at', 'opensAt')}
        closesAt={periodInputOf(values, 'closes_at', 'closesAt')}
        userLimit={userLimitInputOf(values)}
        errors={errors}
        idPrefix={idPrefix}
      />
    </>
  )
}

// 見ている人を引数で受け取らないのは、ほかの種類の View と Panel には要らず、種類の定義の形を変えずに済ませるため
function useAgentView(item: MItem, access: CourseAccess): AgentView | null {
  const user = useRequestContext<AppEnv>().var.user!
  if (!item.extraKey || !item.extra) return null
  const manager = access.canManage ? { isAdmin: user.role === 'admin' } : undefined
  return agentViewOf(agentStore(item.extraKey, item.extra.data), user.id, manager)
}

const agent: ExtraKind = {
  label: 'コーディングエージェント',
  description: 'VS Code で AI にコードを書いてもらう',
  icon: 'cpuChip',
  form: 'extraAgent',
  // タイトルも入れておくのは、Moodle に問い合わせなくても管理画面などで見分けられるようにするため
  // 外部に問い合わせるのは編集画面から送られたときだけにするのは、追加のモーダルはモデルを送らず、既定のモデルで作るため
  async prepare(values, current) {
    if (values.agent_set !== 1) return { values }
    const resolved = await resolveAgentModel(str(values.agent_model), current ? agentModelOfData(current) : null)
    return 'error' in resolved ? { errors: { agent_model: resolved.error } } : { values: { ...values, resolved_model: resolved.model } }
  },
  preload: agentOpenRouterModels,
  toData(values) {
    const edited = values.agent_set === 1
    const model = (values.resolved_model as AgentModel | undefined) ?? DEFAULT_AGENT_MODEL
    return {
      title: str(values.title),
      body: str(values.body),
      instructions: str(values.instructions),
      ...agentModelData(model),
      opensAt: edited ? unixOf(str(values.opens_at)) : null,
      closesAt: edited ? unixOf(str(values.closes_at)) : null,
      userLimit: typeof values.user_limit === 'number' ? values.user_limit : agentPeriodOf({}).userLimit,
    }
  },
  Fields: AgentFields,
  addNote: '説明・使える期間と上限は、追加したあとの編集画面で設定します。学生が使えるようになるのは、管理者が API キーを入れてからです。',
  editAfterCreate: true,
  View: ({ item, data, access }) => {
    const view = useAgentView(item, access)
    const body = str(data.body)
    return (
      <>
        {view && (
          <AgentOpen
            base={agentBase(access.course.id, item.id)}
            {...view}
            editHref={access.canManage ? `/courses/${access.course.id}/items/${item.id}/edit` : undefined}
          />
        )}
        {body && (
          <div class="reader-sheet">
            <Markdown source={body} />
          </div>
        )}
      </>
    )
  },
  Panel: ({ item, access }) => {
    const view = useAgentView(item, access)
    return view?.manage ? (
      <AgentEditPanel base={agentBase(access.course.id, item.id)} settings={view.settings} manage={view.manage} class="editor-extra" />
    ) : null
  },
}

/** 入力欄に入れる問題。保存済みの中身では問題の一覧、送られてきたままの値では編集画面が組み立てた JSON */
const quizRowsOf = (values: Record<string, unknown>): QuizFormRow[] =>
  Array.isArray(values.questions) ? quizFormRows(values.questions as QuizQuestion[]) : readQuizForm(str(values.questions)).rows

const QuizKindFields: ExtraKind['Fields'] = ({ values, errors, idPrefix }) => {
  // 保存済みの中身は toData が必ず questions を入れるので、どちらもないのは追加のモーダル。問題と採点は追加したあとの編集画面で設定する
  if (!Array.isArray(values.questions) && values.quiz_set === undefined) return null
  const saved = quizSettingsOf(values)
  return (
    <>
      <input type="hidden" name="quiz_set" value="1" />
      <MarkdownEditor
        label="説明（任意）"
        name="body"
        id={`${idPrefix}-body`}
        value={str(values.body)}
        error={errors.body}
        rows={5}
        split
      />
      <QuizFields
        rows={quizRowsOf(values)}
        passPercent={typeof values.pass_percent === 'string' ? values.pass_percent : String(saved.passPercent)}
        showAnswers={typeof values.show_answers === 'string' ? (values.show_answers === '0' ? 0 : 1) : saved.showAnswers}
        look={saved.look}
        errors={errors}
        idPrefix={idPrefix}
      />
    </>
  )
}

// 見ている人を引数で受け取らないのは、ほかの種類の View と Panel には要らず、種類の定義の形を変えずに済ませるため
function useQuizView(item: MItem, access: CourseAccess): QuizView | null {
  const c = useRequestContext<AppEnv>()
  if (!item.extraKey || !item.extra) return null
  return quizViewOf(quizStore(item.extraKey), quizSettingsOf(item.extra.data), {
    itemUrl: `/courses/${access.course.id}/items/${item.id}`,
    userId: c.var.user!.id,
    student: access.role === 'student',
    retake: c.req.query('retake') === '1',
  })
}

// Moodle の小テストの活動を使わないのは、コードを読んで答える形式（並べ替え・実行の順番・字下げなど）が Moodle の小テストにないため
const quiz: ExtraKind = {
  label: '小テスト',
  description: 'コードを読んで答える問題で理解を確かめる',
  icon: 'clipboardCheck',
  form: 'extraQuiz',
  // 中身の読み取りは lib/quiz.ts の quizSettingsOf
  toData(values) {
    const edited = values.quiz_set === 1
    const read = values.questions as ReturnType<typeof readQuizForm>
    return {
      title: str(values.title),
      body: str(values.body),
      questions: edited ? read.questions : [],
      passPercent: edited && typeof values.pass_percent === 'number' ? values.pass_percent : DEFAULT_PASS_PERCENT,
      showAnswers: edited && values.show_answers === 0 ? 0 : 1,
      look: edited && isQuizLook(values.look) ? values.look : 'plain',
    }
  },
  Fields: QuizKindFields,
  addNote: '問題は、追加したあとの編集画面で作ります。',
  editAfterCreate: true,
  View: ({ item, data, access }) => {
    const view = useQuizView(item, access)
    const body = str(data.body)
    return (
      <>
        {body && (
          <div class="reader-sheet">
            <Markdown source={body} />
          </div>
        )}
        {view && <QuizPanel quiz={view} editHref={access.canManage ? `/courses/${access.course.id}/items/${item.id}/edit` : undefined} />}
      </>
    )
  },
}

export const EXTRA_KINDS: Record<string, ExtraKind> = {
  screen,
  [CODE_KIND]: code,
  [QUIZ_KIND]: quiz,
  [BUNDLE_KIND]: bundle,
  [AGENT_KIND]: agent,
}

export const extraKindOf = (type: string): ExtraKind | null => (Object.hasOwn(EXTRA_KINDS, type) ? EXTRA_KINDS[type] : null)

/** Moodle の活動の名前から、その活動に置く種類を探す */
export const extraTypeOfModule = (modname: string) => Object.keys(EXTRA_KINDS).find((type) => EXTRA_KINDS[type].module?.name === modname)

/** 種類の名前（extra_items.type）と定義 */
export type ExtraKindEntry = [type: string, kind: ExtraKind]

/** このコースで追加できる種類 */
export const addableExtraKinds = (course: MoodleCourse): ExtraKindEntry[] =>
  Object.entries(EXTRA_KINDS).filter(([, kind]) => !kind.module || kind.module.available(course))
