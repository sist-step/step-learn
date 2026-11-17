// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない
import * as z from 'zod/mini'
import { MAX_AGENT_INSTRUCTIONS, MAX_AGENT_LIMIT, MAX_AGENT_PERIOD, isAgentClaudeModel } from './agent'
import {
  CODE_LANGUAGES,
  MAX_CODE_LENGTH,
  MAX_CONSTRAINT_LABEL_LENGTH,
  MAX_CONSTRAINT_LENGTH,
  MAX_CONSTRAINTS,
  MAX_STDIN_LENGTH,
  MAX_SUBMIT_PERIOD,
  JUDGES,
  type CodeConstraint,
  type CodeFiles,
} from './code'
import { COLLAB_KINDS, COLLAB_SCOPES } from './collab'
import { dateInputToUnix, dateTimeInputToUnix, isDateInput, isDateTimeInput } from './course-period'
import { checkPassword } from './password'
import { isMediaFile } from './preview'
import { QUIZ_LOOKS, readQuizForm } from './quiz'
import { readRestrictionForm } from './restriction'
import { COMPLETIONS, COURSE_COLORS, COURSE_ROLES, ITEM_TYPES, LINK_TARGETS, ROLES, type Completion, type ItemType } from './types'
import { checkUsername, normalizeUsername } from './username'

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254

export const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const isFile = (v: unknown): v is File => v instanceof File && v.size > 0

const trimmed = () => z.transform((v: unknown) => (typeof v === 'string' ? v.trim() : ''))

const rule = <T>(check: (v: T) => string | null) =>
  z.superRefine<T>((v, ctx) => {
    const message = check(v)
    if (message) ctx.issues.push({ code: 'custom', message, input: v })
  })

const text = (label: string, max: number, { required = false } = {}) =>
  z.pipe(
    trimmed(),
    z
      .string()
      .check(
        ...(required ? [z.minLength(1, `${label}を入力してください。`)] : []),
        z.maxLength(max, `${label}は${max}文字以内で入力してください。`),
      ),
  )

// 画面に出さない欄を長すぎるときにエラーにしないのは、利用者が直せないため
const hidden = (max: number) =>
  z.pipe(
    trimmed(),
    z.transform((s: string) => s.slice(0, max)),
  )

const choice = <T extends string>(values: readonly [T, ...T[]], fallback: T) => z.catch(z.enum(values), fallback)

const flag = () =>
  z.pipe(
    hidden(1),
    z.transform((s: string) => (s === '1' ? 1 : 0)),
  )

const username = () => z.pipe(z.pipe(text('ユーザー名', 100), z.transform(normalizeUsername)), z.string().check(rule(checkUsername)))

const PASSWORD_MAX_LENGTH = 200

const newPassword = () =>
  z.pipe(text('パスワード', PASSWORD_MAX_LENGTH, { required: true }), z.string().check(rule((p: string) => checkPassword(p))))

const file = (message: string) => z.custom<File>(isFile, message)

const login = z.object({
  login: z.pipe(
    text('メールアドレスまたはユーザー名', 254, { required: true }),
    z.transform((s: string) => s.toLowerCase()),
  ),
  password: text('パスワード', 200, { required: true }),
  next: hidden(500),
})

const email = () =>
  z.pipe(
    z.pipe(
      text('メールアドレス', 254, { required: true }),
      z.transform((s: string) => s.toLowerCase()),
    ),
    z.string().check(rule((s: string) => (isEmail(s) ? null : '有効なメールアドレスを入力してください。'))),
  )

const register = z.object({ email: email(), next: hidden(500) })

const forgotPassword = z.object({ email: email() })

const resetPassword = z.object({ token: hidden(100), password: newPassword() })

const completeRegister = z
  .object({
    token: hidden(100),
    email: hidden(254),
    name: text('氏名', 60, { required: true }),
    username: username(),
    password: newPassword(),
  })
  .check(
    z.superRefine((v, ctx) => {
      // 長すぎる値を調べないのは、項目の上限を超えていてもこの検証は実行され、送られた値をそのまま受け取るため
      if (v.password.length > PASSWORD_MAX_LENGTH) return
      const message = checkPassword(v.password, v)
      if (message) ctx.issues.push({ code: 'custom', message, input: v, path: ['password'] })
    }),
  )

const profile = z.object({ name: text('氏名', 60, { required: true }), username: username() })

const password = z.object({ current: text('現在のパスワード', 200, { required: true }), password: newPassword() })

const setPassword = z.object({ password: newPassword() })

const date = (label: string) =>
  z.pipe(trimmed(), z.string().check(rule((s: string) => (!s || isDateInput(s) ? null : `${label}が正しくありません。`))))

const course = z
  .object({
    title: text('コース名', 120, { required: true }),
    code: text('コースコード', 30),
    summary: text('概要', 2000),
    color: choice(COURSE_COLORS, 'cyan'),
    completion_enabled: flag(),
    start_date: date('開始日'),
    end_date: date('終了日'),
  })
  .check(
    z.superRefine((v, ctx) => {
      if (isDateInput(v.start_date) && isDateInput(v.end_date) && dateInputToUnix(v.end_date) < dateInputToUnix(v.start_date))
        ctx.issues.push({ code: 'custom', message: '終了日は開始日以降の日付にしてください。', input: v, path: ['end_date'] })
    }),
  )

const dateTime = (label: string) =>
  z.pipe(trimmed(), z.string().check(rule((s: string) => (!s || isDateTimeInput(s) ? null : `${label}が正しくありません。`))))

// 選んだアイテムや項目が今も選べるかをここで確かめないのは、選べるものがコースの中身で決まり、ハンドラで選択肢と照らし合わせるため
// 行ごとのエラーを外側の object で出すのは、availability の中で出すと path の先頭が availability になり、行の入力欄に出せないため
// clear が 1 のときに条件の誤りを出さないのは、条件を消す操作で、送られた条件は使わないため
const restriction = z
  .object({ clear: flag(), availability: z.transform((v: unknown) => readRestrictionForm(typeof v === 'string' ? v : '')) })
  .check(
    z.superRefine((v, ctx) => {
      if (v.clear) return
      for (const issue of v.availability.issues) ctx.issues.push({ code: 'custom', message: issue.message, input: v, path: [issue.key] })
    }),
  )

const section = z.object({ title: text('セクション名', 120, { required: true }), summary: z.optional(text('説明', 2000)) })

export const completionChoices = (type: ItemType): Completion[] =>
  type === 'screen'
    ? ['none', 'manual']
    : type === 'file'
      ? ['none', 'manual', 'view', 'play']
      : type === 'code'
        ? ['none', 'manual', 'view', 'clear']
        : type === 'quiz'
          ? ['none', 'manual', 'view', 'pass']
          : ['none', 'manual', 'view']

// file に null を受け付けるのは、ブラウザでは保存済みのファイルの種類が分からず、保存するときにサーバーで確かめ直すため
export function completionError(type: ItemType, completion: Completion | undefined, file: { type: string; name: string } | null) {
  if (!completion) return null
  if (completion === 'play' && (type !== 'file' || (file && !isMediaFile(file))))
    return '「最後まで再生したら完了」は動画・音声のファイルでだけ選べます。'
  if (!completionChoices(type).includes(completion)) return 'この種類のアイテムでは選べない完了の条件です。'
  return null
}

const completionIssue = (v: { type: ItemType; completion?: Completion; file?: unknown }) =>
  completionError(v.type, v.completion, isFile(v.file) ? v.file : null)

// trimmed() を通さないのは、Python では行頭の空白が意味を持つため。改行をそろえるのは、フォームの送信で CRLF になるため
const source = (label: string, max: number) =>
  z.pipe(
    z.transform((v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : '')),
    z.string().check(z.maxLength(max, `${label}は${max}文字以内で入力してください。`)),
  )

const codeFields = {
  html: source('HTML', MAX_CODE_LENGTH),
  css: source('CSS', MAX_CODE_LENGTH),
  js: source('JavaScript', MAX_CODE_LENGTH),
  py: source('Python', MAX_CODE_LENGTH),
  stdin: source('入力', MAX_STDIN_LENGTH),
}

/** コードのアイテムの編集画面の、解答例の欄。最初のコードの欄（codeFields）と名前がぶつからないよう、頭に solution_ を付ける */
const solutionFields = {
  solution_html: source('解答例の HTML', MAX_CODE_LENGTH),
  solution_css: source('解答例の CSS', MAX_CODE_LENGTH),
  solution_js: source('解答例の JavaScript', MAX_CODE_LENGTH),
  solution_py: source('解答例の Python', MAX_CODE_LENGTH),
  solution_public: flag(),
}

/** 解答例の欄の値を、ファイルごとの中身にまとめる */
export const solutionOf = (v: {
  solution_html?: string
  solution_css?: string
  solution_js?: string
  solution_py?: string
}): CodeFiles => ({
  html: v.solution_html ?? '',
  css: v.solution_css ?? '',
  js: v.solution_js ?? '',
  py: v.solution_py ?? '',
})

const many = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v])

const list = () => z.transform((v: unknown) => many(v).map((s) => (typeof s === 'string' ? s.trim() : '')))

/**
 * 編集画面の制約の行（constraint_label[]・constraint_text[]・constraint_kind[] を同じ順に送る）を、制約の一覧にする。ラベルも内容も空の行は捨てる。
 * error は最初に見つかった誤りで、何番目の行かを含める
 */
export function readConstraints({
  'constraint_label[]': labels = [],
  'constraint_text[]': texts = [],
  'constraint_kind[]': kinds = [],
}: {
  'constraint_label[]'?: string[]
  'constraint_text[]'?: string[]
  'constraint_kind[]'?: string[]
}): { constraints: CodeConstraint[]; error: string | null } {
  const rows = labels
    .map((label, i) => ({ no: i + 1, label, text: texts[i] ?? '', optional: kinds[i] === 'optional' }))
    .filter((r) => r.label || r.text)
  const fail = (error: string) => ({ constraints: [], error })
  if (rows.length === 0) return fail('制約を 1 つ以上入れてください。')
  if (rows.length > MAX_CONSTRAINTS) return fail(`制約は ${MAX_CONSTRAINTS} 個までにしてください。`)
  for (const { no, label, text } of rows) {
    if (!label) return fail(`${no} 番目の制約のラベルを入力してください。`)
    if (label.length > MAX_CONSTRAINT_LABEL_LENGTH)
      return fail(`${no} 番目の制約のラベルは${MAX_CONSTRAINT_LABEL_LENGTH}文字以内で入力してください。`)
    if (text.length > MAX_CONSTRAINT_LENGTH) return fail(`${no} 番目の制約の内容は${MAX_CONSTRAINT_LENGTH}文字以内で入力してください。`)
  }
  if (rows.every((r) => r.optional)) return fail('必須の制約を 1 つ以上入れてください。発展の制約だけでは、クリアを判定できません。')
  return { constraints: rows.map(({ label, text, optional }) => ({ label, text, ...(optional && { optional }) })), error: null }
}

/** コードのアイテムで、実行・下書きの保存・提出のときに送るコード */
const code = z.object(codeFields)

const codeReview = z.object({
  submission: hidden(20),
  comment: text('コメント', 2000),
})
const usd = (label: string, max: number) =>
  z.pipe(
    z.pipe(
      text(label, 20, { required: true }),
      z
        .string()
        .check(
          rule((s: string) => (/^\d+(\.\d{1,2})?$/.test(s) ? null : `${label}は 0 以上の数値（小数第 2 位まで）で入力してください。`)),
        ),
    ),
    z.pipe(
      z.transform((s: string) => Number(s)),
      z.number().check(z.maximum(max, `${label}は ${max} 以下で入力してください。`)),
    ),
  )

const percent = (label: string, min = 0) =>
  z.pipe(
    z.pipe(
      text(label, 3, { required: true }),
      z
        .string()
        .check(
          rule((s: string) =>
            /^\d+$/.test(s) && Number(s) >= min && Number(s) <= 100 ? null : `${label}は ${min}〜100 の整数で入力してください。`,
          ),
        ),
    ),
    z.transform((s: string) => Number(s)),
  )

const itemFields = {
  title: text('タイトル', 200, { required: true }),
  body: text('本文', 100_000),
  hidden: flag(),
  type: choice(ITEM_TYPES, 'page'),
  language: choice(CODE_LANGUAGES, 'web'),
  link_target: choice(LINK_TARGETS, 'new'),
  collab_kind: choice(COLLAB_KINDS, 'doc'),
  collab_scope: choice(COLLAB_SCOPES, 'course'),
  completion: z.optional(z.enum(COMPLETIONS, '完了の条件が正しくありません。')),
  // 必須にしないのは、ファイルの欄がファイルのアイテムのフォームにしかないため
  file: z.optional(z.unknown()),
}

const URL_INVALID = 'http:// または https:// で始まる URL を入力してください。'

const item = z.object({ ...itemFields, url: text('URL', 2000) }).check(
  z.superRefine((v, ctx) => {
    if (v.type === 'link' && !isHttpUrl(v.url)) ctx.issues.push({ code: 'custom', message: URL_INVALID, input: v, path: ['url'] })
    if (v.type === 'file' && !isFile(v.file))
      ctx.issues.push({ code: 'custom', message: 'ファイルを選択してください。', input: v, path: ['file'] })
    const message = completionIssue(v)
    if (message) ctx.issues.push({ code: 'custom', message, input: v, path: ['completion'] })
  }),
)

// URL の欄はリンクのアイテムの編集画面にしかないので、欄があるときだけ確かめる
const itemEdit = z
  .object({
    ...itemFields,
    ...codeFields,
    ...solutionFields,
    criteria: z.optional(text('採点基準', 5000)),
    'constraint_label[]': list(),
    'constraint_text[]': list(),
    'constraint_kind[]': list(),
    opens_at: z.optional(dateTime('開始日時')),
    closes_at: z.optional(dateTime('終了日時')),
    user_limit: z.optional(usd('1 人あたりの上限', MAX_AGENT_LIMIT)),
    instructions: z.optional(text('AI への指示', MAX_AGENT_INSTRUCTIONS)),
    // 問題ごとの誤りを外側の object で出すのは、questions の中で出すと path の先頭が questions になり、問題の入力欄に出せないため
    questions: z.transform((v: unknown) => readQuizForm(typeof v === 'string' ? v : '')),
    pass_percent: z.optional(percent('合格にする正解の割合', 1)),
    show_answers: flag(),
    look: choice(QUIZ_LOOKS, 'plain'),
    agent_model: z.optional(text('モデル', 200)),
    url: z.optional(z.pipe(text('URL', 2000), z.string().check(rule((s: string) => (isHttpUrl(s) ? null : URL_INVALID))))),
  })
  .check(
    z.superRefine((v, ctx) => {
      const message = completionIssue(v)
      if (message) ctx.issues.push({ code: 'custom', message, input: v, path: ['completion'] })
      const issues =
        v.type === 'code' ? codeItemIssues(v) : v.type === 'agent' ? agentItemIssues(v) : v.type === 'quiz' ? quizItemIssues(v) : []
      for (const issue of issues) ctx.issues.push({ code: 'custom', input: v, ...issue })
    }),
  )

/** 小テストのアイテムの編集画面の、問題と合格の割合の誤り */
function quizItemIssues(v: { questions: ReturnType<typeof readQuizForm>; pass_percent?: number }) {
  const issues = v.questions.issues.map((issue) => ({ message: issue.message, path: [issue.key] }))
  // 欄そのものがないときだけ足すのは、欄の値の誤りは pass_percent のスキーマ（percent）が出すため
  if (v.pass_percent === undefined) issues.push({ message: '合格にする正解の割合を入力してください。', path: ['pass_percent'] })
  return issues
}

/** OpenRouter のモデルの ID（openai/gpt-5.1、meta-llama/llama-4:free など） */
const OPENROUTER_MODEL_ID = /^~?[\w.-]+\/[\w.:-]+$/

/** コーディングエージェントのアイテムの編集画面の、モデル・使える期間・上限の誤り */
function agentItemIssues(v: { opens_at?: string; closes_at?: string; user_limit?: number; agent_model?: string }) {
  const issues = periodIssues(
    v.opens_at ?? '',
    v.closes_at ?? '',
    MAX_AGENT_PERIOD,
    `使える期間は ${MAX_AGENT_PERIOD / 3600} 時間以内にしてください。`,
  )
  // 欄そのものがないときだけ足すのは、欄の値の誤りは user_limit のスキーマ（usd）が出すため
  if (v.user_limit === undefined) issues.push({ message: '1 人あたりの上限を入力してください。', path: ['user_limit'] })
  // ID の形だけを見るのは、OpenRouter にあるかとツールを使えるかは、保存するときにモデル一覧で確かめるため
  if (!v.agent_model) issues.push({ message: 'モデルを選んでください。', path: ['agent_model'] })
  else if (!isAgentClaudeModel(v.agent_model) && !OPENROUTER_MODEL_ID.test(v.agent_model))
    issues.push({ message: 'モデルが正しくありません。', path: ['agent_model'] })
  return issues
}

/** コードのアイテムの編集画面の、制約と提出の期間の誤り */
function codeItemIssues(v: Parameters<typeof readConstraints>[0] & { opens_at?: string; closes_at?: string }) {
  const error = readConstraints(v).error
  return [...(error ? [{ message: error, path: ['constraints'] }] : []), ...submitPeriodIssues(v.opens_at ?? '', v.closes_at ?? '')]
}

/** コードのアイテムの提出の期間（日時の入力欄の値）の誤り。形の誤りは欄ごとのスキーマ（dateTime）が出すので、ここでは見ない */
const submitPeriodIssues = (opensAt: string, closesAt: string) =>
  periodIssues(opensAt, closesAt, MAX_SUBMIT_PERIOD, `提出の期間は ${MAX_SUBMIT_PERIOD / 86_400} 日以内にしてください。`)

function periodIssues(opensAt: string, closesAt: string, maxLength: number, tooLong: string) {
  const issues: { message: string; path: string[] }[] = []
  if (!opensAt) issues.push({ message: '開始日時を入力してください。', path: ['opens_at'] })
  if (!closesAt) issues.push({ message: '終了日時を入力してください。', path: ['closes_at'] })
  if (!isDateTimeInput(opensAt) || !isDateTimeInput(closesAt)) return issues
  const length = dateTimeInputToUnix(closesAt) - dateTimeInputToUnix(opensAt)
  if (length <= 0) issues.push({ message: '終了日時は開始日時より後にしてください。', path: ['closes_at'] })
  else if (length > maxLength) issues.push({ message: tooLong, path: ['closes_at'] })
  return issues
}

/** Moodle モードの extra のアイテムに共通の欄。種類ごとのスキーマはこれに中身の欄を足して作る（src/moodle-mode/extra-kinds.tsx） */
export const extraItemFields = {
  title: text('タイトル', 200, { required: true }),
  hidden: flag(),
  completion: z.optional(z.enum(['none', 'manual', 'view'], '完了の条件が正しくありません。')),
}

const extraItem = z.object(extraItemFields)

/** Moodle モードのコードのアイテム。starter_set は、最初のコードの欄を出している画面（編集画面）から送られたときに 1 になる */
const extraCode = z
  .object({
    ...extraItemFields,
    ...codeFields,
    ...solutionFields,
    body: text('問題文', 100_000),
    language: choice(CODE_LANGUAGES, 'web'),
    starter_set: flag(),
    /** 保存と一緒に問題を確定する（編集画面の「問題を確定する」） */
    finalize: flag(),
    criteria: text('補足', 5000),
    'constraint_label[]': list(),
    'constraint_text[]': list(),
    'constraint_kind[]': list(),
    opens_at: z.optional(dateTime('開始日時')),
    closes_at: z.optional(dateTime('終了日時')),
  })
  .check(
    z.superRefine((v, ctx) => {
      // 追加のモーダルは言語しか送らないので、制約と期間は編集画面から送られたときだけ求める
      if (v.starter_set !== 1) return
      for (const issue of codeItemIssues(v)) ctx.issues.push({ code: 'custom', input: v, ...issue })
    }),
  )

/** Moodle モードのコーディングエージェントのアイテム。agent_set は、期間と上限の欄を出している画面（編集画面）から送られたときに 1 になる */
const extraAgent = z
  .object({
    ...extraItemFields,
    body: text('説明', 100_000),
    agent_set: flag(),
    opens_at: z.optional(dateTime('開始日時')),
    closes_at: z.optional(dateTime('終了日時')),
    user_limit: z.optional(usd('1 人あたりの上限', MAX_AGENT_LIMIT)),
    instructions: text('AI への指示', MAX_AGENT_INSTRUCTIONS),
    agent_model: z.optional(text('モデル', 200)),
  })
  .check(
    z.superRefine((v, ctx) => {
      // 追加のモーダルは期間と上限を送らないので、編集画面から送られたときだけ求める
      if (v.agent_set !== 1) return
      for (const issue of agentItemIssues(v)) ctx.issues.push({ code: 'custom', input: v, ...issue })
    }),
  )

/** Moodle モードの小テストのアイテム。quiz_set は、問題と採点の欄を出している画面（編集画面）から送られたときに 1 になる */
const extraQuiz = z
  .object({
    ...extraItemFields,
    body: text('説明', 100_000),
    quiz_set: flag(),
    questions: z.transform((v: unknown) => readQuizForm(typeof v === 'string' ? v : '')),
    pass_percent: z.optional(percent('合格にする正解の割合', 1)),
    show_answers: flag(),
    look: choice(QUIZ_LOOKS, 'plain'),
  })
  .check(
    z.superRefine((v, ctx) => {
      // 追加のモーダルは問題と採点の欄を送らないので、編集画面から送られたときだけ求める
      if (v.quiz_set !== 1) return
      for (const issue of quizItemIssues(v)) ctx.issues.push({ code: 'custom', input: v, ...issue })
    }),
  )

/** Moodle モードの共同編集のアイテム。種類と分け方は追加のときだけ使い、編集では保存済みの値に戻す（extra-kinds.tsx の prepare） */
const extraCollab = z.object({
  ...extraItemFields,
  body: text('説明', 100_000),
  collab_kind: choice(COLLAB_KINDS, 'doc'),
  collab_scope: choice(COLLAB_SCOPES, 'course'),
})

const image = z.object({ image: file('画像を選択してください。') })

// 始まりだけを見るのは、キーの形は提供元が変えることがあり、使えるかは保存するときに提供元に確かめるため
const apiKeyField = (pattern: RegExp, message: string) =>
  z.pipe(text('API キー', 400), z.string().check(rule((s: string) => (!s || pattern.test(s) ? null : message))))

const agentKey = z.object({
  api_key: apiKeyField(/^sk-ant-[\w-]+$/, 'Anthropic の API キー（sk-ant- で始まる）を入力してください。'),
  openrouter_api_key: apiKeyField(/^sk-or-[\w-]+$/, 'OpenRouter の API キー（sk-or- で始まる）を入力してください。'),
  total_limit: usd('アイテム全体の上限', MAX_AGENT_LIMIT),
})

const aiSettings = z.object({
  openrouter_limit: usd('OpenRouter の月の上限', 10_000),
  anthropic_limit: usd('Anthropic の月の上限', 10_000),
  'claude-sonnet-5-5_share': percent('Claude Sonnet 5.5 の週の枠'),
})

export const MAX_AI_MESSAGE_LENGTH = 4000

const aiMessage = z.object({
  message: text('メッセージ', MAX_AI_MESSAGE_LENGTH, { required: true }),
  model: hidden(100),
  chat: hidden(20),
  page: hidden(500),
  hard: flag(),
  revision: hidden(50),
  /** 新しいチャットで選ぶアイテム（コース ID/アイテム ID）。コーディング問題の編集画面のボタンから始めたときだけ送る */
  focus: hidden(50),
  /** 発言に添えた画像。種類と大きさは中身を読まないと分からないので、lib/ai-agent.ts で確かめる */
  image: z.transform((v: unknown) => (isFile(v) ? v : null)),
})

const id = () => z.pipe(hidden(20), z.pipe(z.transform(Number), z.int().check(z.positive())))

// 読めない ID を飛ばして失敗させないのは、ほかのタブで消されたセクションが混ざっても、残りの開閉は記録するため
const ids = () =>
  z.pipe(
    hidden(2000),
    z.transform((s: string) =>
      s
        .split(',')
        .map(Number)
        .filter((n) => Number.isSafeInteger(n) && n > 0),
    ),
  )

const viewed = z.object({ path: hidden(500) })

const next = z.object({ next: hidden(500) })

const linkToken = z.object({ token: hidden(100) })

const move = z.object({ dir: z.enum(['up', 'down']) })

const visibility = z.object({ hidden: flag() })

const collapse = z.object({ open: ids(), closed: ids() })

// section_id が正しくなくても失敗させないのは、編集画面では今のセクションのままにするため。before も同じく、正しくなければ末尾に入れる。
// type を item の選択肢で絞らないのは、Moodle モードの extra の種類（src/moodle-mode/extra-kinds.tsx）も送られるため
const itemPlacement = z.object({
  section_id: z.catch(id(), 0),
  before: z.catch(id(), 0),
  after: choice(['edit', 'view'], 'edit'),
  type: hidden(50),
})

const completionToggle = z.object({ on: z.pipe(hidden(10), z.enum(['', 'view', 'ended'])) })

const judge = z.object({ judge: z.enum(JUDGES) })

const participant = z.object({ user_id: id(), role: z.enum(COURSE_ROLES) })

const courseRole = z.object({ role: z.enum(COURSE_ROLES) })

const siteRole = z.object({ role: z.enum(ROLES) })

const codeSuggest = z.object({
  title: hidden(200),
  body: z.pipe(hidden(100_000), z.string().check(z.minLength(1, '先に問題文を書いてください。'))),
})

/** 編集画面の問題文と最初のコードから、制約だけを作るときに送るもの */
const codeConstraintsSuggest = z.object({ ...codeSuggest.shape, ...codeFields })

/** 編集画面の「試しに判定」で送るもの。保存する前の問題文・最初のコード・解答例・制約・補足 */
const codeTrial = z.object({
  ...codeSuggest.shape,
  ...codeFields,
  ...solutionFields,
  criteria: text('補足', 5000),
  'constraint_label[]': list(),
  'constraint_text[]': list(),
  'constraint_kind[]': list(),
})

const regrade = z.object({ submission: id() })

/** 教師が判定を変えるフォーム。制約ごとの判定は verdict_0・verdict_1… の名前で送られ、数が提出ごとに違うので、ハンドラで読む */
const codeVerdicts = z.looseObject({ submission: id() })

// 空のファイルも受け付けるのは、中身のない __init__.py や .gitkeep も配るため
const files = () => z.transform((v: unknown) => many(v).filter((f): f is File => f instanceof File))

const bundleUpload = z.object({
  files: files(),
  // 前後の空白を削らないのは、ファイルやフォルダーの名前の一部のため
  paths: z.transform((v: unknown) => many(v).map((p) => (typeof p === 'string' ? p : ''))),
  archives: files(),
  skipped: z.catch(z.pipe(hidden(20), z.pipe(z.transform(Number), z.int().check(z.minimum(0), z.maximum(1_000_000)))), 0),
})

const bundleRemove = z.object({ path: hidden(1000), folder: hidden(1000), all: flag() })

const bundleSync = z.object({ sync: flag() })

// file を必須にしないのは、ファイルを選ぶカードでだけ送られるため。大きさと中身はストレージの設定と中身で決まるので、ハンドラで確かめる
const aiDecision = z.object({
  call: hidden(200),
  decision: choice(['approve', 'reject'], 'reject'),
  page: hidden(500),
  chat: hidden(20),
  file: z.transform((v: unknown) => (isFile(v) ? v : null)),
})

const aiApproveAll = z.object({ 'call[]': list(), page: hidden(500), chat: hidden(20) })

const aiChat = z.object({ chat: hidden(20) })

const aiSuggestions = z.object({ page: hidden(500) })

// 形式と大きさをここで確かめないのは、受け取れる形式が文字起こしの提供元の都合で決まり、lib/ai-voice.ts にまとめておくため
const aiVoice = z.object({ audio: file('音声がありません。') })

export const FORMS = {
  login,
  register,
  completeRegister,
  forgotPassword,
  resetPassword,
  profile,
  password,
  setPassword,
  course,
  section,
  restriction,
  item,
  itemEdit,
  code,
  codeReview,
  codeVerdicts,
  extraItem,
  extraCode,
  extraAgent,
  extraQuiz,
  extraCollab,
  image,
  aiSettings,
  aiMessage,
  agentKey,
  viewed,
  next,
  linkToken,
  move,
  visibility,
  collapse,
  itemPlacement,
  completionToggle,
  judge,
  participant,
  courseRole,
  siteRole,
  codeSuggest,
  codeConstraintsSuggest,
  codeTrial,
  regrade,
  bundleUpload,
  bundleRemove,
  bundleSync,
  aiDecision,
  aiApproveAll,
  aiChat,
  aiSuggestions,
  aiVoice,
}

export type FormName = keyof typeof FORMS

export const isFormName = (s: string | undefined): s is FormName => !!s && Object.hasOwn(FORMS, s)

export type FieldErrors = Partial<Record<string, string>>

export type FormInput = Record<string, unknown>

export type FormValues<N extends FormName> = z.output<(typeof FORMS)[N]>

export type Validated<N extends FormName> = { ok: true; values: FormValues<N> } | { ok: false; errors: FieldErrors }

export const firstError = (errors: FieldErrors) => Object.values(errors).find((m) => !!m) ?? ''

export function validate<N extends FormName>(name: N, data: FormInput): Validated<N> {
  const result = (FORMS[name] as z.ZodMiniType).safeParse(data)
  if (result.success) return { ok: true, values: result.data as FormValues<N> }
  const errors: FieldErrors = {}
  for (const issue of result.error.issues) errors[String(issue.path[0] ?? 'form')] ??= issue.message
  return { ok: false, errors }
}
