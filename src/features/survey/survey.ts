// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

export const SURVEY_KINDS = ['single', 'multiple', 'scale', 'text'] as const

export type SurveyKind = (typeof SURVEY_KINDS)[number]

export const SURVEY_KIND_LABELS: Record<SurveyKind, string> = {
  single: '1 つを選ぶ',
  multiple: 'いくつでも選ぶ',
  scale: '段階で評価',
  text: '自由に書く',
}

export const SURVEY_KIND_DESCRIPTIONS: Record<SurveyKind, string> = {
  single: '選択肢から 1 つ。人数と割合を集計します',
  multiple: '選択肢から好きなだけ。選んだ人数を集計します',
  scale: '「そう思わない」〜「そう思う」など。分布と平均を集計します',
  text: '文章で答える。回答を一覧にします',
}

/** id は問いを作ったときの目印。書き換えても変えないので、回答と問いを結び付けられる */
type SurveyBase = { id: string; prompt: string; required: boolean }

export type SurveyQuestion =
  | (SurveyBase & { kind: 'single' | 'multiple'; options: string[] })
  | (SurveyBase & { kind: 'scale'; points: number; minLabel: string; maxLabel: string })
  | (SurveyBase & { kind: 'text' })

/**
 * 回答 1 つ。選択肢は番号ではなく文字で残す。
 * 番号にしないのは、教師があとから選択肢を並べ替えたり消したりすると、過去の回答が別の選択肢を指してしまうため
 */
export type SurveyAnswer = { id: string; value: string | string[] | number }

export type SurveySettings = {
  questions: SurveyQuestion[]
  /** 教師に回答した人の名前を見せない（0 / 1） */
  anonymous: number
  /** 回答した学生に、みんなの回答の集計を見せる（0 / 1）。自由記述は見せない */
  showResults: number
  /** 答えられる期間のうちは、送った回答を直せる（0 / 1） */
  allowEdit: number
  opensAt: number | null
  closesAt: number | null
}

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  questions: [],
  anonymous: 0,
  showResults: 0,
  allowEdit: 0,
  opensAt: null,
  closesAt: null,
}

const MAX_SURVEY_QUESTIONS = 50
const MAX_OPTIONS = 20
const MAX_PROMPT_LENGTH = 500
const MAX_OPTION_LENGTH = 200
const MAX_SCALE_LABEL_LENGTH = 50
const MAX_TEXT_ANSWER_LENGTH = 2000
export const MAX_SURVEY_JSON_LENGTH = 200_000
export const SCALE_POINTS = [2, 3, 4, 5, 6, 7, 10] as const
const DEFAULT_SCALE_POINTS = 5

/** client.ts が問いを足すときに、新しい問いの目印に置き換える文字 */
export const SURVEY_KEY_SLOT = '__Q__'

/** 答えられる期間の中か。始まりと終わりは、決めていなければ制限しない */
type SurveyPhase = 'before' | 'open' | 'after'

export const surveyPhase = ({ opensAt, closesAt }: Pick<SurveySettings, 'opensAt' | 'closesAt'>, now: number): SurveyPhase =>
  opensAt !== null && now < opensAt ? 'before' : closesAt !== null && now >= closesAt ? 'after' : 'open'

// ---------------------------------------------------------------- 編集画面から送られた問い

/** 編集画面（components/survey.tsx の SurveyEditor）が送る JSON の行。入力欄の値のまま送る */
export type SurveyFormRow = {
  k: string
  kind: SurveyKind
  prompt: string
  required: boolean
  /** 選択肢を 1 行に 1 つ */
  options: string
  points: string
  minLabel: string
  maxLabel: string
}

type SurveyIssue = { key: string; message: string }

const FORM_BROKEN = '問いを読み取れませんでした。ページを開き直してから、もう一度お試しください。'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKind = (v: unknown): v is SurveyKind => SURVEY_KINDS.includes(v as SurveyKind)
const KEY_RE = /^[a-z0-9]{1,40}$/

export const blankSurveyRow = (k: string, kind: SurveyKind): SurveyFormRow => ({
  k,
  kind,
  prompt: '',
  required: false,
  options: '',
  points: String(DEFAULT_SCALE_POINTS),
  minLabel: kind === 'scale' ? 'そう思わない' : '',
  maxLabel: kind === 'scale' ? 'そう思う' : '',
})

/** 保存されている問いを、編集画面の行にする */
export const surveyFormRows = (questions: SurveyQuestion[]): SurveyFormRow[] =>
  questions.map((q) => ({
    ...blankSurveyRow(q.id, q.kind),
    prompt: q.prompt,
    required: q.required,
    ...(q.kind === 'single' || q.kind === 'multiple' ? { options: q.options.join('\n') } : {}),
    ...(q.kind === 'scale' ? { points: String(q.points), minLabel: q.minLabel, maxLabel: q.maxLabel } : {}),
  }))

const optionLines = (s: string) =>
  s
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)

function readRow(raw: unknown): SurveyFormRow | null {
  if (!isRecord(raw) || typeof raw.k !== 'string' || !KEY_RE.test(raw.k) || !isKind(raw.kind)) return null
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  return {
    k: raw.k,
    kind: raw.kind,
    prompt: str('prompt'),
    required: raw.required === true,
    options: str('options'),
    points: str('points'),
    minLabel: str('minLabel'),
    maxLabel: str('maxLabel'),
  }
}

function readQuestion(row: SurveyFormRow, issues: SurveyIssue[]): SurveyQuestion {
  const k = row.k
  const prompt = row.prompt.trim()
  if (!prompt) issues.push({ key: `${k}.prompt`, message: '問いを入力してください。' })
  else if (prompt.length > MAX_PROMPT_LENGTH)
    issues.push({ key: `${k}.prompt`, message: `問いは${MAX_PROMPT_LENGTH}文字以内で入力してください。` })
  const base = { id: k, prompt, required: row.required }
  switch (row.kind) {
    case 'single':
    case 'multiple': {
      const options = optionLines(row.options)
      if (options.length < 2) issues.push({ key: `${k}.options`, message: '選択肢を 2 つ以上入力してください。' })
      else if (options.length > MAX_OPTIONS) issues.push({ key: `${k}.options`, message: `選択肢は${MAX_OPTIONS}個までにしてください。` })
      else if (options.some((o) => o.length > MAX_OPTION_LENGTH))
        issues.push({ key: `${k}.options`, message: `選択肢は 1 つ${MAX_OPTION_LENGTH}文字以内で入力してください。` })
      else if (new Set(options).size < options.length) issues.push({ key: `${k}.options`, message: '同じ選択肢が重なっています。' })
      return { ...base, kind: row.kind, options }
    }
    case 'scale': {
      const points = Number(row.points)
      if (!SCALE_POINTS.includes(points as (typeof SCALE_POINTS)[number]))
        issues.push({ key: `${k}.points`, message: '段階の数が正しくありません。' })
      const [minLabel, maxLabel] = [row.minLabel.trim(), row.maxLabel.trim()]
      for (const [key, label] of [
        ['minLabel', minLabel],
        ['maxLabel', maxLabel],
      ] as const)
        if (label.length > MAX_SCALE_LABEL_LENGTH)
          issues.push({ key: `${k}.${key}`, message: `ラベルは${MAX_SCALE_LABEL_LENGTH}文字以内で入力してください。` })
      return { ...base, kind: 'scale', points: points || DEFAULT_SCALE_POINTS, minLabel, maxLabel }
    }
    case 'text':
      return { ...base, kind: 'text' }
  }
}

/** 編集画面の値を読み、問いごとの入力の誤りを集める。issues の key は入力欄の name（`<目印>.<項目>`）か survey_questions */
export function readSurveyForm(json: string): { rows: SurveyFormRow[]; questions: SurveyQuestion[]; issues: SurveyIssue[] } {
  const broken = () => ({ rows: [], questions: [], issues: [{ key: 'survey_questions', message: FORM_BROKEN }] })
  if (json.length > MAX_SURVEY_JSON_LENGTH) return broken()
  let parsed: unknown
  try {
    parsed = json ? JSON.parse(json) : []
  } catch {
    return broken()
  }
  if (!Array.isArray(parsed)) return broken()
  const rows: SurveyFormRow[] = []
  for (const raw of parsed) {
    const row = readRow(raw)
    if (!row) return broken()
    rows.push(row)
  }
  if (new Set(rows.map((r) => r.k)).size < rows.length) return broken()
  const issues: SurveyIssue[] = []
  const questions = rows.map((row) => readQuestion(row, issues))
  if (rows.length > MAX_SURVEY_QUESTIONS)
    issues.push({ key: 'survey_questions', message: `問いは${MAX_SURVEY_QUESTIONS}個までにしてください。` })
  return { rows, questions, issues }
}

// ---------------------------------------------------------------- 学生の回答

/** 回答の入力欄の name。いくつでも選ぶ問いは同じ name のチェックボックスを並べる */
export const answerField = (q: Pick<SurveyQuestion, 'id'>) => `a.${q.id}`

const NEED_ANSWER = 'この問いに答えてください。'

/** 送られた回答を問いと照らし合わせて読む。選択肢にない値や、段階の外の値は誤りにする */
export function readSurveyAnswers(questions: SurveyQuestion[], form: Record<string, unknown>) {
  const answers: SurveyAnswer[] = []
  const issues: SurveyIssue[] = []
  for (const q of questions) {
    const field = answerField(q)
    const raw = form[field]
    const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((v): v is string => typeof v === 'string')
    const fail = (message: string) => issues.push({ key: field, message })
    switch (q.kind) {
      case 'single': {
        const value = values[0] ?? ''
        if (!value) {
          if (q.required) fail(NEED_ANSWER)
        } else if (!q.options.includes(value)) fail('選択肢から選んでください。')
        else answers.push({ id: q.id, value })
        break
      }
      case 'multiple': {
        const picked = [...new Set(values)]
        if (picked.some((v) => !q.options.includes(v))) fail('選択肢から選んでください。')
        else if (picked.length === 0) {
          if (q.required) fail(NEED_ANSWER)
        } else answers.push({ id: q.id, value: q.options.filter((o) => picked.includes(o)) })
        break
      }
      case 'scale': {
        const value = values[0] ?? ''
        const n = Number(value)
        if (!value) {
          if (q.required) fail(NEED_ANSWER)
        } else if (!Number.isInteger(n) || n < 1 || n > q.points) fail('段階から選んでください。')
        else answers.push({ id: q.id, value: n })
        break
      }
      case 'text': {
        const value = (values[0] ?? '').trim()
        if (!value) {
          if (q.required) fail(NEED_ANSWER)
        } else if (value.length > MAX_TEXT_ANSWER_LENGTH) fail(`${MAX_TEXT_ANSWER_LENGTH}文字以内で入力してください。`)
        else answers.push({ id: q.id, value })
        break
      }
    }
  }
  return { answers, issues }
}

// ---------------------------------------------------------------- 集計

type SurveyChoiceCount = { label: string; count: number }

/** 問い 1 つの集計。answered はその問いに答えた人数 */
export type SurveyQuestionSummary =
  | { question: SurveyQuestion & { kind: 'single' | 'multiple' }; answered: number; counts: SurveyChoiceCount[] }
  | { question: SurveyQuestion & { kind: 'scale' }; answered: number; counts: SurveyChoiceCount[]; average: number | null }
  | { question: SurveyQuestion & { kind: 'text' }; answered: number; texts: string[] }

const OTHER_OPTION = '（今はない選択肢）'

/** 回答の一覧から、問いごとの集計を作る。問いを書き換える前の回答の、今はない選択肢はまとめて数える */
export function summarizeSurvey(questions: SurveyQuestion[], responses: { answers: SurveyAnswer[] }[]): SurveyQuestionSummary[] {
  return questions.map((question) => {
    const values = responses.flatMap((r) => r.answers.filter((a) => a.id === question.id).map((a) => a.value))
    switch (question.kind) {
      case 'single':
      case 'multiple': {
        const picked = values.flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []))
        const others = picked.filter((v) => !question.options.includes(v)).length
        const counts = question.options.map((label) => ({ label, count: picked.filter((v) => v === label).length }))
        return { question, answered: values.length, counts: others ? [...counts, { label: OTHER_OPTION, count: others }] : counts }
      }
      case 'scale': {
        const numbers = values.filter((v): v is number => typeof v === 'number' && v >= 1 && v <= question.points)
        const counts = Array.from({ length: question.points }, (_, i) => ({
          label: String(i + 1),
          count: numbers.filter((n) => n === i + 1).length,
        }))
        const average = numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null
        return { question, answered: numbers.length, counts, average }
      }
      case 'text': {
        const texts = values.filter((v): v is string => typeof v === 'string' && v !== '')
        return { question, answered: texts.length, texts }
      }
    }
  })
}

/** 回答 1 つを、一覧や CSV に出す文字にする */
export function answerText(answer: SurveyAnswer | undefined) {
  if (!answer) return ''
  return Array.isArray(answer.value) ? answer.value.join('、') : String(answer.value)
}

// ---------------------------------------------------------------- 画面に渡すもの

/** アイテムの画面に出すアンケート（components/survey.tsx の SurveyPanel） */
export type SurveyView = {
  /** アイテムの画面 */
  itemUrl: string
  /** 回答と結果のルートの土台（/courses/:id/items/:iid/survey） */
  base: string
  settings: SurveySettings
  phase: SurveyPhase
  /** 教師に出す回答の数。学生なら null */
  manage: { responses: number; students: number } | null
  /** 見ている学生の回答。学生でなければ null、まだ答えていなければ answers が null */
  mine: { answers: SurveyAnswer[] | null; editing: boolean } | null
  /** 回答した学生に見せる集計（自由記述は除く）と、回答した人数。見せない設定や、まだ答えていなければ null */
  results: { total: number; summaries: SurveyQuestionSummary[] } | null
}
