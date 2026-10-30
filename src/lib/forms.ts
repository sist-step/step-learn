// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない
import * as z from 'zod/mini'
import { checkPassword } from './password'
import { COURSE_COLORS } from './types'
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

const newPassword = () => z.pipe(text('パスワード', 200, { required: true }), z.string().check(rule((p: string) => checkPassword(p))))

const file = (message: string) => z.custom<File>(isFile, message)

const login = z.object({
  login: z.pipe(
    text('メールアドレスまたはユーザー名', 254, { required: true }),
    z.transform((s: string) => s.toLowerCase()),
  ),
  password: text('パスワード', 200, { required: true }),
  next: hidden(500),
})

const register = z.object({
  email: z.pipe(
    z.pipe(
      text('メールアドレス', 254, { required: true }),
      z.transform((s: string) => s.toLowerCase()),
    ),
    z.string().check(rule((s: string) => (isEmail(s) ? null : '有効なメールアドレスを入力してください。'))),
  ),
  next: hidden(500),
})

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
      const message = checkPassword(v.password, v)
      if (message) ctx.issues.push({ code: 'custom', message, input: v, path: ['password'] })
    }),
  )

const profile = z.object({ name: text('氏名', 60, { required: true }), username: username() })

const password = z.object({ current: text('現在のパスワード', 200, { required: true }), password: newPassword() })

const course = z.object({
  title: text('コース名', 120, { required: true }),
  code: text('コースコード', 30),
  summary: text('概要', 2000),
  color: choice(COURSE_COLORS, 'cyan'),
})

const section = z.object({ title: text('セクション名', 120, { required: true }), summary: z.optional(text('説明', 2000)) })

const itemFields = { title: text('タイトル', 200, { required: true }), body: text('本文', 100_000), hidden: flag() }

const URL_INVALID = 'http:// または https:// で始まる URL を入力してください。'

const item = z
  .object({ ...itemFields, type: choice(['page', 'link', 'file', 'screen'], 'page'), url: text('URL', 2000), file: z.unknown() })
  .check(
    z.superRefine((v, ctx) => {
      if (v.type === 'link' && !isHttpUrl(v.url)) ctx.issues.push({ code: 'custom', message: URL_INVALID, input: v, path: ['url'] })
      if (v.type === 'file' && !isFile(v.file))
        ctx.issues.push({ code: 'custom', message: 'ファイルを選択してください。', input: v, path: ['file'] })
    }),
  )

// URL の欄はリンクのアイテムの編集画面にしかないので、欄があるときだけ確かめる
const itemEdit = z.object({
  ...itemFields,
  url: z.optional(z.pipe(text('URL', 2000), z.string().check(rule((s: string) => (isHttpUrl(s) ? null : URL_INVALID))))),
  // 必須にしないのは、ファイルの欄がファイルのアイテムのフォームにしかないため
  file: z.optional(z.unknown()),
})

const image = z.object({ image: file('画像を選択してください。') })

export const FORMS = { login, register, completeRegister, profile, password, course, section, item, itemEdit, image }

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
