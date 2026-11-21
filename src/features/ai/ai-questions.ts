// DB を読まないのは、通常モードと Moodle モードで同じ質問カードを使い、パネル（components/ai-panel.tsx）と client.ts も型を読むため
import * as z from 'zod/mini'
import { describedString, toolOf } from './ai-tool-kit'
import { parseJson } from '../../lib/json'

/** 利用者に質問するカードを出すツール。確認カードと同じく、利用者が答えるか閉じるまで発言を止める */
export const ASK_USER = 'ask_user'

const TEXT_QUESTION_TYPES = ['choice', 'multi', 'number', 'text'] as const
const AI_QUESTION_TYPES = [...TEXT_QUESTION_TYPES, 'image'] as const

export type AiQuestionType = (typeof AI_QUESTION_TYPES)[number]

const MAX_QUESTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTIONS = 6
// 刻みの数を抑えるのは、スライダーの 1 目盛りが細かすぎると、ねらった数に合わせられないため
const MAX_NUMBER_STEPS = 1000
/** 自由に書く答え（記述と「その他」）の文字数の上限 */
export const MAX_ANSWER_LENGTH = 1000

export type AiOption = { label: string; description: string }

/** 質問カードの 1 問。initial はスライダーの最初の位置 */
export type AiQuestion =
  | { type: 'choice' | 'multi'; text: string; options: AiOption[] }
  | { type: 'number'; text: string; min: number; max: number; step: number; unit: string; initial: number }
  | { type: 'text'; text: string; placeholder: string }
  | { type: 'image'; text: string }

/** 1 問の答え。text が null なら飛ばした。image は答えに画像を添えたこと（画像はツールの結果に添える） */
export type AiAnswer = { text: string | null; image?: boolean }

const TYPE_HINT = [
  'choice は選択肢から 1 つ、multi は選択肢からいくつでも選んでもらう（どちらも「その他」の自由記述が自動で付くので、選択肢に入れない）。',
  'number は範囲の中の数をスライダーで選んでもらう（問題数・時間・割合など。min と max は必須、step・unit・default は任意）。',
  'text は自由に書いてもらう。',
].join('')

const IMAGE_HINT = 'image は画像を 1 枚送ってもらう（手書きの図・板書・見本の写真など、見ないと分からないもの。1 枚のカードに 1 問まで）。'

const questionArgs = (types: readonly [AiQuestionType, ...AiQuestionType[]]) =>
  z.object({
    type: z.enum(types).check(z.describe(`質問の形。${TYPE_HINT}${types.includes('image') ? IMAGE_HINT : ''}`)),
    question: describedString('質問の文（例: 「小テストは何問にしますか？」）', 200, 1),
    options: z.optional(
      z
        .array(
          z.object({
            label: describedString('選択肢の短い名前', 60, 1),
            description: z.optional(describedString('選択肢の補足（任意）', 120)),
          }),
        )
        .check(z.maxLength(MAX_OPTIONS), z.describe(`choice と multi の選択肢（${MIN_OPTIONS}〜${MAX_OPTIONS} 個）。ほかの形では省く`)),
    ),
    min: z.optional(z.number().check(z.describe('number の最小値'))),
    max: z.optional(z.number().check(z.describe('number の最大値'))),
    step: z.optional(z.number().check(z.describe('number の刻み。省くと 1'))),
    unit: z.optional(describedString('number の単位（例: 問、分、%）', 10)),
    default: z.optional(z.number().check(z.describe('number の最初の値。省くと範囲の真ん中'))),
    placeholder: z.optional(describedString('text の入力欄に薄く出す答えの例', 60)),
  })

const askArgs = (types: readonly [AiQuestionType, ...AiQuestionType[]]) =>
  z.object({
    questions: z
      .array(questionArgs(types))
      .check(z.minLength(1), z.maxLength(MAX_QUESTIONS), z.describe(`質問（1〜${MAX_QUESTIONS} 問）。カードには 1 問ずつ出る`)),
  })

const ARGS = { text: askArgs(TEXT_QUESTION_TYPES), image: askArgs(AI_QUESTION_TYPES) }

const askTool = (images: boolean) =>
  toolOf(
    ASK_USER,
    [
      '利用者に質問するカードを出します。作業を進めるのに利用者に決めてもらうことがあるとき（作る問題の数や難しさ、対象の学生、どの案にするかなど）は、本文で尋ねずにこれを呼んでください。',
      `関係する質問は 1 回にまとめてください（${MAX_QUESTIONS} 問まで）。推測で決めてよい細かいことまでは尋ねないでください。`,
      '利用者が答えると、質問ごとの答え（answer）か、飛ばしたこと（skipped）が結果として返ります。',
    ].join(''),
    ARGS[images ? 'image' : 'text'],
  )

/** 画像を答えにできる質問を含むか（images）ごとのツール */
export const ASK_TOOLS = { text: askTool(false), image: askTool(true) }

type QuestionArgs = z.output<ReturnType<typeof questionArgs>>

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

/** 刻みに合わせて丸める。浮動小数の誤差で 0.30000000000000004 のようにならないよう、刻みの桁で切る */
const snap = (value: number, min: number, step: number) =>
  Number((min + Math.round((value - min) / step) * step).toFixed(Math.max(decimals(min), decimals(step))))

function toQuestion(q: QuestionArgs): AiQuestion | string {
  const text = q.question.trim()
  switch (q.type) {
    case 'choice':
    case 'multi': {
      const options = (q.options ?? []).map((o) => ({ label: o.label.trim(), description: o.description?.trim() ?? '' }))
      if (options.length < MIN_OPTIONS) return `「${text}」の選択肢を ${MIN_OPTIONS}〜${MAX_OPTIONS} 個にしてください。`
      if (new Set(options.map((o) => o.label)).size !== options.length) return `「${text}」の選択肢の名前が重なっています。`
      return { type: q.type, text, options }
    }
    case 'number': {
      const { min, max, step = 1 } = q
      if (min === undefined || max === undefined || !(min < max))
        return `「${text}」の min と max を、min が小さくなるように指定してください。`
      if (!(step > 0) || (max - min) / step > MAX_NUMBER_STEPS)
        return `「${text}」の step は 0 より大きく、範囲を ${MAX_NUMBER_STEPS} 目盛り以下に分ける値にしてください。`
      const initial = Math.min(max, Math.max(min, snap(q.default ?? (min + max) / 2, min, step)))
      return { type: 'number', text, min, max, step, unit: q.unit?.trim() ?? '', initial }
    }
    case 'text':
      return { type: 'text', text, placeholder: q.placeholder?.trim() ?? '' }
    case 'image':
      return { type: 'image', text }
  }
}

/**
 * ask_user の引数を質問にする。images は画像を答えにできること（読めるモデルで、このチャットに画像の枠が残っている）。
 * 引数が正しくなければ、AI に直してもらう理由
 */
export function readQuestions(raw: unknown, images: boolean): AiQuestion[] | string {
  const parsed = ARGS.image.safeParse(raw)
  if (!parsed.success) return '引数が正しくありません。説明に合わせて呼び直してください。'
  const questions = parsed.data.questions.map(toQuestion)
  const problem = questions.find((q) => typeof q === 'string')
  if (problem) return problem
  const valid = questions as AiQuestion[]
  const imageCount = valid.filter((q) => q.type === 'image').length
  if (imageCount > 0 && !images) return '今は画像を答えにする質問を出せません。image 以外の形で尋ねてください。'
  if (imageCount > 1) return 'image の質問は 1 枚のカードに 1 問までです。'
  return valid
}

/** 利用者が送った 1 問の答え。client.ts が JSON にして送る */
export type AiAnswerInput = { skip?: boolean; choices?: number[]; other?: string; value?: number; text?: string; image?: boolean }

const answerInput = z.object({
  skip: z.optional(z.boolean()),
  choices: z.optional(z.array(z.int())),
  other: z.optional(z.string()),
  value: z.optional(z.number()),
  text: z.optional(z.string()),
  image: z.optional(z.boolean()),
})

const freeText = (s: string | undefined) => s?.trim() ?? ''

const formatNumber = (value: number, unit: string) => `${value}${unit ? ` ${unit}` : ''}`

function readAnswer(q: AiQuestion, a: AiAnswerInput, image: boolean): AiAnswer | string {
  if (a.skip) return { text: null }
  const other = freeText(a.other)
  if (other.length > MAX_ANSWER_LENGTH) return `答えは ${MAX_ANSWER_LENGTH} 文字以内で入力してください。`
  switch (q.type) {
    case 'choice':
    case 'multi': {
      const choices = [...new Set(a.choices ?? [])]
      if (choices.some((i) => !q.options[i]) || (q.type === 'choice' && choices.length + (other ? 1 : 0) > 1))
        return `「${q.text}」の答えが正しくありません。`
      const labels = [...choices.sort((x, y) => x - y).map((i) => q.options[i].label), ...(other ? [`その他（${other}）`] : [])]
      return labels.length > 0 ? { text: labels.join('、') } : `「${q.text}」の答えを選んでください。`
    }
    case 'number': {
      const { value } = a
      if (value === undefined || !Number.isFinite(value) || value < q.min || value > q.max || snap(value, q.min, q.step) !== value)
        return `「${q.text}」の答えが正しくありません。`
      return { text: formatNumber(value, q.unit) }
    }
    case 'text': {
      const text = freeText(a.text)
      if (text.length > MAX_ANSWER_LENGTH) return `答えは ${MAX_ANSWER_LENGTH} 文字以内で入力してください。`
      return text ? { text } : `「${q.text}」の答えを入力してください。`
    }
    case 'image':
      return a.image && image ? { text: '画像を送りました', image: true } : `「${q.text}」の画像を選んでください。`
  }
}

/** 送られた答えを、質問ごとに読む。image は答えに画像を添えて送ったこと。読めなければ、利用者に見せる理由 */
export function readAnswers(questions: readonly AiQuestion[], json: string, image: boolean): AiAnswer[] | string {
  const parsed = z.array(answerInput).safeParse(parseJson(json))
  if (!parsed.success || parsed.data.length !== questions.length) return '答えを読み取れませんでした。もう一度お試しください。'
  const answers: AiAnswer[] = []
  for (const [i, q] of questions.entries()) {
    const answer = readAnswer(q, parsed.data[i], image)
    if (typeof answer === 'string') return answer
    answers.push(answer)
  }
  if (image && !answers.some((a) => a.image)) return '答えを読み取れませんでした。もう一度お試しください。'
  return answers
}

/** AI に返す答え */
export const answersResult = (questions: readonly AiQuestion[], answers: readonly AiAnswer[]) => ({
  answers: questions.map((q, i) =>
    answers[i].text === null ? { question: q.text, skipped: true } : { question: q.text, answer: answers[i].text },
  ),
  ...(answers.some((a) => a.image) && { note: '画像の答えは、この結果に添えました。' }),
})
