// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない
import * as z from 'zod/mini'
import { CODE_LANGUAGES, MAX_CODE_LENGTH, MAX_MAX_SCORE, MAX_STDIN_LENGTH } from './code'
import { dateInputToUnix, dateTimeInputToUnix, isDateInput, isDateTimeInput } from './course-period'
import { checkPassword } from './password'
import { isMediaFile } from './preview'
import { COMPLETIONS, COURSE_COLORS, LINK_TARGETS, type Completion, type ItemType } from './types'
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

// 完了の条件（after[]）をここで確かめないのは、選べる活動がコースの中身で決まり、ハンドラで選択肢と照らし合わせるため
const restriction = z.object({ from: dateTime('開始日時'), until: dateTime('終了日時'), hide_unmet: flag() }).check(
  z.superRefine((v, ctx) => {
    if (isDateTimeInput(v.from) && isDateTimeInput(v.until) && dateTimeInputToUnix(v.until) <= dateTimeInputToUnix(v.from))
      ctx.issues.push({ code: 'custom', message: '終了日時は開始日時より後にしてください。', input: v, path: ['until'] })
  }),
)

const section = z.object({ title: text('セクション名', 120, { required: true }), summary: z.optional(text('説明', 2000)) })

export const completionChoices = (type: ItemType): Completion[] =>
  type === 'screen' ? ['none', 'manual'] : type === 'file' ? [...COMPLETIONS] : ['none', 'manual', 'view']

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

/** コードのアイテムで、実行・下書きの保存・提出のときに送るコード */
const code = z.object(codeFields)

const points = (label: string, { min, max }: { min: number; max: number }) =>
  z.pipe(
    trimmed(),
    z
      .string()
      .check(
        rule((s: string) =>
          !s || (/^\d{1,6}$/.test(s) && Number(s) >= min && Number(s) <= max)
            ? null
            : `${label}は ${min} から ${max} までの整数で入力してください。`,
        ),
      ),
  )

// 点数が満点を超えていないかをここで確かめないのは、満点がアイテムの設定で決まり、ハンドラで照らし合わせるため
const codeReview = z.object({
  submission: hidden(20),
  score: points('点数', { min: 0, max: MAX_MAX_SCORE }),
  comment: text('コメント', 2000),
})

const itemFields = {
  title: text('タイトル', 200, { required: true }),
  body: text('本文', 100_000),
  hidden: flag(),
  type: choice(['page', 'link', 'file', 'screen', 'code', 'bundle'], 'page'),
  language: choice(CODE_LANGUAGES, 'web'),
  link_target: choice(LINK_TARGETS, 'new'),
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
    criteria: z.optional(text('採点基準', 5000)),
    max_score: z.optional(points('満点', { min: 1, max: MAX_MAX_SCORE })),
    url: z.optional(z.pipe(text('URL', 2000), z.string().check(rule((s: string) => (isHttpUrl(s) ? null : URL_INVALID))))),
  })
  .check(
    z.superRefine((v, ctx) => {
      const message = completionIssue(v)
      if (message) ctx.issues.push({ code: 'custom', message, input: v, path: ['completion'] })
    }),
  )

/** Moodle モードの extra のアイテムに共通の欄。種類ごとのスキーマはこれに中身の欄を足して作る（src/moodle-mode/extra-kinds.tsx） */
export const extraItemFields = {
  title: text('タイトル', 200, { required: true }),
  hidden: flag(),
  completion: z.optional(z.enum(['none', 'manual', 'view'], '完了の条件が正しくありません。')),
}

const extraItem = z.object(extraItemFields)

/** Moodle モードのコードのアイテム。starter_set は、最初のコードの欄を出している画面（編集画面）から送られたときに 1 になる */
const extraCode = z.object({
  ...extraItemFields,
  ...codeFields,
  body: text('問題文', 100_000),
  language: choice(CODE_LANGUAGES, 'web'),
  starter_set: flag(),
  criteria: text('採点基準', 5000),
  max_score: points('満点', { min: 1, max: MAX_MAX_SCORE }),
})

const image = z.object({ image: file('画像を選択してください。') })

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

const aiSettings = z.object({
  openrouter_limit: usd('OpenRouter の月の上限', 10_000),
  anthropic_limit: usd('Anthropic の月の上限', 10_000),
})

export const FORMS = {
  login,
  register,
  completeRegister,
  forgotPassword,
  resetPassword,
  profile,
  password,
  course,
  section,
  restriction,
  item,
  itemEdit,
  code,
  codeReview,
  extraItem,
  extraCode,
  image,
  aiSettings,
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
