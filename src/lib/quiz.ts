// サーバーの handlers と client.ts（lib/forms.ts 経由）の両方が読み込むので、DB や Node の API を使うモジュールを import しない

/** 小テストのアイテムの種類の名前（Moodle モードでは extra_items.type） */
export const QUIZ_KIND = 'quiz'

export const QUIZ_KINDS = ['choice', 'output', 'order', 'bug', 'flow', 'indent', 'table'] as const

export type QuizKind = (typeof QUIZ_KINDS)[number]

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  choice: '選択',
  output: '出力の予測',
  order: '並べ替え',
  bug: 'バグ探し',
  flow: '実行の順番',
  indent: '字下げ',
  table: '変数の追跡',
}

export const QUIZ_KIND_DESCRIPTIONS: Record<QuizKind, string> = {
  choice: '選択肢から 1 つ選ぶ',
  output: 'コードの実行結果を答える',
  order: 'ばらばらの行を正しい順に並べる',
  bug: '間違っている行を選ぶ',
  flow: '行が実行される順にたどる',
  indent: '消えた字下げを付け直す',
  table: '変数の値の移り変わりを表に書く',
}

/** 問題を足したときに、問題文の欄に最初から入れておく文 */
export const QUIZ_DEFAULT_PROMPTS: Record<QuizKind, string> = {
  choice: '',
  output: 'このコードを実行すると、何が出力されますか？',
  order: '正しく動くように、行を並べ替えてください。',
  bug: 'このコードには間違いがあります。間違っている行を選んでください。',
  flow: 'このコードを実行したとき、行が実行される順に選んでください。',
  indent: 'このコードは字下げが消えています。正しく動くように、字下げを付け直してください。',
  table: 'このコードを実行したとき、繰り返しの各回が終わった時点での変数の値を書いてください。',
}

/** 学生に出す画面の見た目。game は中学生向けで、3D のダンジョンの扉を 1 問ずつ正解して開けながら進み、点数は問題ごとの最初の答えで数える */
export const QUIZ_LOOKS = ['plain', 'game'] as const

export type QuizLook = (typeof QUIZ_LOOKS)[number]

export const QUIZ_LOOK_LABELS: Record<QuizLook, string> = { plain: '標準', game: 'ゲーム' }

export const isQuizLook = (v: unknown): v is QuizLook => QUIZ_LOOKS.some((look) => look === v)

export const MAX_QUIZ_QUESTIONS = 50
export const MAX_QUIZ_PROMPT_LENGTH = 2000
export const MAX_QUIZ_CODE_LENGTH = 5000
export const MIN_QUIZ_CHOICES = 2
export const MAX_QUIZ_CHOICES = 8
export const MAX_QUIZ_CHOICE_LENGTH = 300
export const MIN_QUIZ_LINES = 2
export const MAX_QUIZ_LINES = 20
export const MAX_QUIZ_LINE_LENGTH = 300
export const MAX_QUIZ_OUTPUT_LENGTH = 2000
export const MAX_QUIZ_EXPLANATION_LENGTH = 2000
/** 実行の順番で選べる行の数 */
export const MAX_QUIZ_STEPS = 40
/** 字下げの深さ */
export const MAX_QUIZ_INDENT = 8
export const MAX_QUIZ_COLUMNS = 6
export const MAX_QUIZ_ROWS = 12
export const MAX_QUIZ_CELL_LENGTH = 40
export const MAX_QUIZ_JSON_LENGTH = 600_000
/** 1 人がアイテム 1 つを受けられる回数。受け直しは自由だが、記録が際限なく増えないように止める */
export const MAX_QUIZ_ATTEMPTS = 100
export const DEFAULT_PASS_PERCENT = 80

type QuestionBase = {
  /** 受験の記録と結び付ける目印。問題を書き換えても変えない */
  id: string
  prompt: string
  /** 採点のあとに見せる解説 */
  explanation: string
}

export type ChoiceQuestion = QuestionBase & {
  kind: 'choice'
  code: string
  choices: string[]
  /** 正解の選択肢の位置（0 始まり） */
  answer: number
}
export type OutputQuestion = QuestionBase & { kind: 'output'; code: string; /** 正しい出力 */ answer: string }
export type OrderQuestion = QuestionBase & { kind: 'order'; /** 正しい順に並べた行 */ lines: string[] }
export type BugQuestion = QuestionBase & { kind: 'bug'; code: string; /** 間違っている行の番号（1 始まり） */ answer: number }
export type FlowQuestion = QuestionBase & { kind: 'flow'; code: string; /** 実行される順に並べた行の番号（1 始まり） */ answer: number[] }
export type IndentQuestion = QuestionBase & { kind: 'indent'; /** 正しく字下げしたコード */ code: string }
export type TableQuestion = QuestionBase & {
  kind: 'table'
  code: string
  /** 変数の名前 */
  columns: string[]
  /** 各回の変数の値。1 行が 1 回分で、並びは columns と同じ */
  rows: string[][]
}

export type QuizQuestion = ChoiceQuestion | OutputQuestion | OrderQuestion | BugQuestion | FlowQuestion | IndentQuestion | TableQuestion

/** 学生に出す問題。正解と解説を含めない */
export type QuizTakeQuestion =
  | { id: string; kind: 'choice'; prompt: string; code: string; choices: string[] }
  | { id: string; kind: 'output'; prompt: string; code: string }
  | { id: string; kind: 'order'; prompt: string; /** 混ぜた行 */ lines: string[] }
  | { id: string; kind: 'bug'; prompt: string; code: string }
  | { id: string; kind: 'flow'; prompt: string; code: string }
  | { id: string; kind: 'indent'; prompt: string; /** 字下げを除いた行 */ lines: string[] }
  | { id: string; kind: 'table'; prompt: string; code: string; columns: string[]; rowCount: number }

/**
 * 選択とバグ探しは選んだ位置・行、出力の予測は入力した文字、並べ替えは並べた行、実行の順番は選んだ行の番号、
 * 字下げは行ごとの深さ、変数の追跡は左上から行ごとに並べたマスの値。答えていなければ null
 */
export type QuizAnswer = number | string | string[] | number[] | null

export type QuizAnswerRecord = { id: string; answer: QuizAnswer; correct: boolean }

export const isQuizKind = (v: unknown): v is QuizKind => QUIZ_KINDS.includes(v as QuizKind)

export const codeLines = (code: string) => code.split('\n')

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n')

// 行末の空白と前後の空行だけを除くのは、行頭の空白は字下げとして意味を持つため
const trimCode = (s: string) =>
  normalizeNewlines(s)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')

// NFKC にそろえるのは、日本語入力のまま打った全角の数字や記号を、同じ出力として受け付けるため
const normalizeOutput = (s: string) => trimCode(s.normalize('NFKC'))

// 空白と引用符の種類を区別しないのは、[1, 2] と [1,2]、'a' と "a" のような書き方の違いを誤りにしないため
const normalizeCell = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').replace(/'/g, '"')

const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** 「4, 5, 1」のように書いた行の番号の並びを読む。数でないものが混ざっていれば null */
export function parseSteps(text: string): number[] | null {
  const parts = text
    .normalize('NFKC')
    .split(/[\s,、→>]+/)
    .filter(Boolean)
  return parts.every((p) => /^\d{1,4}$/.test(p)) ? parts.map(Number) : null
}

const TAB_WIDTH = 4

const indentWidth = (line: string) => [...(/^[ \t]*/.exec(line)?.[0] ?? '')].reduce((n, ch) => n + (ch === '\t' ? TAB_WIDTH : 1), 0)

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** 字下げしたコードを、字下げを除いた行と、行ごとの深さに分ける。空の行は除く。深さの単位は、字下げの幅の最大公約数 */
export function indentOf(code: string): { lines: string[]; levels: number[] } {
  const rows = codeLines(trimCode(code)).filter((line) => line.trim())
  const widths = rows.map(indentWidth)
  const unit = widths.reduce(gcd, 0) || 1
  return { lines: rows.map((line) => line.trim()), levels: widths.map((w) => w / unit) }
}

/** 字下げの問題の結果に出すコード。深さ 1 つを空白 4 つにする */
export const indentedCode = (lines: readonly string[], levels: readonly number[]) =>
  lines.map((line, i) => '    '.repeat(levels[i] ?? 0) + line).join('\n')

const CELL_SEPARATOR = '|'

/** 「i | total」のように書いた 1 行を、マスに分ける */
const cellsOf = (line: string) =>
  line
    .normalize('NFKC')
    .split(CELL_SEPARATOR)
    .map((cell) => cell.trim())

// ---------------------------------------------------------------- 編集画面から送られた値

/** 編集画面（components/quiz.tsx の QuizQuestionsField）の問題 1 つの、入力中の値。どの種類でもすべての欄を持つ */
export type QuizFormRow = {
  k: string
  kind: QuizKind
  prompt: string
  code: string
  choices: string[]
  /** 選択は正解の位置、出力の予測は正しい出力、バグ探しは行の番号、実行の順番は行の番号の並び、変数の追跡は表（1 行目が変数の名前） */
  answer: string
  /** 並べ替えの行（改行区切り） */
  lines: string
  explanation: string
}

export type QuizIssue = { key: string; message: string }

/** 追加する問題のひな形（template）で、問題の目印を入れる場所。client.ts が足すときに置き換える */
export const QUIZ_KEY_SLOT = '__K__'

/** バグ探しと実行の順番の編集で、入力した番号の行の中身。番号が行の範囲になければ null */
export function lineAt(code: string, lineNo: string | number) {
  const text = String(lineNo).trim()
  const n = /^\d+$/.test(text) ? Number(text) : 0
  return codeLines(trimCode(code))[n - 1] ?? null
}

const answerInputOf = (q: QuizQuestion) => {
  switch (q.kind) {
    case 'choice':
    case 'bug':
      return String(q.answer)
    case 'output':
      return q.answer
    case 'flow':
      return q.answer.join(', ')
    case 'table':
      return [q.columns, ...q.rows].map((cells) => cells.join(` ${CELL_SEPARATOR} `)).join('\n')
    case 'order':
    case 'indent':
      return ''
  }
}

export const quizFormRows = (questions: readonly QuizQuestion[]): QuizFormRow[] =>
  questions.map((q) => ({
    k: q.id,
    kind: q.kind,
    prompt: q.prompt,
    code: q.kind === 'order' ? '' : q.code,
    choices: q.kind === 'choice' ? q.choices : [],
    answer: answerInputOf(q),
    lines: q.kind === 'order' ? q.lines.join('\n') : '',
    explanation: q.explanation,
  }))

const FORM_BROKEN = '問題を読み取れませんでした。ページを開き直してから、もう一度お試しください。'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const KEY_PATTERN = /^[A-Za-z0-9]{1,32}$/

function readRow(raw: unknown): QuizFormRow | null {
  if (!isRecord(raw) || typeof raw.k !== 'string' || !KEY_PATTERN.test(raw.k) || !isQuizKind(raw.kind)) return null
  const str = (key: string) => (typeof raw[key] === 'string' ? normalizeNewlines(raw[key]) : '')
  return {
    k: raw.k,
    kind: raw.kind,
    prompt: str('prompt'),
    code: str('code'),
    choices: Array.isArray(raw.choices) ? raw.choices.map((c) => (typeof c === 'string' ? c : '')) : [],
    answer: str('answer'),
    lines: str('lines'),
    explanation: str('explanation'),
  }
}

const tooLong = (label: string, max: number) => `${label}は${max}文字以内で入力してください。`

/** 並べ替えと字下げの行の数と長さの誤り。なければ null */
function linesError(lines: readonly string[], label: string) {
  if (lines.length < MIN_QUIZ_LINES) return `${label}を ${MIN_QUIZ_LINES} 行以上入力してください。`
  if (lines.length > MAX_QUIZ_LINES) return `${label}は ${MAX_QUIZ_LINES} 行までにしてください。`
  if (lines.some((line) => line.length > MAX_QUIZ_LINE_LENGTH)) return tooLong('1 行', MAX_QUIZ_LINE_LENGTH)
  return null
}

/** 変数の追跡の表（1 行目が変数の名前）を読む。誤りがあれば error に入れる */
function readTable(text: string): { columns: string[]; rows: string[][]; error: string | null } {
  const [columns = [], ...rows] = trimCode(text)
    .split('\n')
    .filter((line) => line.trim())
    .map(cellsOf)
  const fail = (error: string) => ({ columns, rows, error })
  if (rows.length === 0) return fail('1 行目に変数の名前、2 行目からは各回の値を、| で区切って入力してください。')
  if (columns.length > MAX_QUIZ_COLUMNS) return fail(`変数は ${MAX_QUIZ_COLUMNS} 個までにしてください。`)
  if (rows.length > MAX_QUIZ_ROWS) return fail(`値の行は ${MAX_QUIZ_ROWS} 行までにしてください。`)
  const uneven = rows.findIndex((cells) => cells.length !== columns.length)
  if (uneven >= 0) return fail(`${uneven + 2} 行目の値の数が、変数の数（${columns.length} 個）と合いません。`)
  if ([columns, ...rows].some((cells) => cells.some((cell) => !cell)))
    return fail('空のマスがあります。すべてのマスに値を入力してください。')
  if ([columns, ...rows].some((cells) => cells.some((cell) => cell.length > MAX_QUIZ_CELL_LENGTH)))
    return fail(tooLong('1 つの値', MAX_QUIZ_CELL_LENGTH))
  return { columns, rows, error: null }
}

function readQuestion(row: QuizFormRow, issues: QuizIssue[]): QuizQuestion {
  const { k, kind } = row
  const fail = (field: string, message: string) => void issues.push({ key: `${k}.${field}`, message })
  const prompt = row.prompt.trim()
  const explanation = row.explanation.trim()
  const code = trimCode(row.code)
  const lines = codeLines(code)
  if (!prompt) fail('prompt', '問題文を入力してください。')
  else if (prompt.length > MAX_QUIZ_PROMPT_LENGTH) fail('prompt', tooLong('問題文', MAX_QUIZ_PROMPT_LENGTH))
  if (explanation.length > MAX_QUIZ_EXPLANATION_LENGTH) fail('explanation', tooLong('解説', MAX_QUIZ_EXPLANATION_LENGTH))
  if (kind !== 'order') {
    if (!code && kind !== 'choice') fail('code', 'コードを入力してください。')
    else if (code.length > MAX_QUIZ_CODE_LENGTH) fail('code', tooLong('コード', MAX_QUIZ_CODE_LENGTH))
  }
  const base = { id: k, prompt, explanation }
  switch (kind) {
    case 'choice': {
      const filled = row.choices.map((text, i) => ({ text: text.trim(), i })).filter((c) => c.text)
      const choices = filled.map((c) => c.text)
      const answer = filled.findIndex((c) => String(c.i) === row.answer.trim())
      if (choices.length < MIN_QUIZ_CHOICES) fail('choices', `選択肢を ${MIN_QUIZ_CHOICES} つ以上入力してください。`)
      else if (choices.length > MAX_QUIZ_CHOICES) fail('choices', `選択肢は ${MAX_QUIZ_CHOICES} 個までにしてください。`)
      else if (choices.some((c) => c.length > MAX_QUIZ_CHOICE_LENGTH)) fail('choices', tooLong('選択肢', MAX_QUIZ_CHOICE_LENGTH))
      else if (new Set(choices).size < choices.length) fail('choices', '同じ選択肢が 2 つあります。')
      else if (answer < 0) fail('choices', '正解の選択肢を選んでください。')
      return { ...base, kind, code, choices, answer }
    }
    case 'output': {
      const answer = trimCode(row.answer)
      if (!answer) fail('answer', '正しい出力を入力してください。')
      else if (answer.length > MAX_QUIZ_OUTPUT_LENGTH) fail('answer', tooLong('正しい出力', MAX_QUIZ_OUTPUT_LENGTH))
      return { ...base, kind, code, answer }
    }
    case 'order': {
      const ordered = trimCode(row.lines)
        .split('\n')
        .filter((line) => line.trim())
      const error = linesError(ordered, '並べ替える行')
      if (error) fail('lines', error)
      else if (new Set(ordered).size < 2) fail('lines', '同じ行だけでは並べ替えになりません。')
      return { ...base, kind, lines: ordered }
    }
    case 'bug': {
      const answer = /^\d+$/.test(row.answer.trim()) ? Number(row.answer.trim()) : 0
      if (code && (answer < 1 || answer > lines.length))
        fail('answer', `間違っている行の番号を、1〜${lines.length} の整数で入力してください。`)
      else if (code && !lines[answer - 1].trim()) fail('answer', '空の行は選べません。')
      return { ...base, kind, code, answer }
    }
    case 'flow': {
      const answer = parseSteps(row.answer) ?? []
      if (!code) return { ...base, kind, code, answer }
      if (answer.length < 2) fail('answer', '実行される順に、行の番号を 2 つ以上、カンマで区切って入力してください。')
      else if (answer.length > MAX_QUIZ_STEPS) fail('answer', `行の番号は ${MAX_QUIZ_STEPS} 個までにしてください。`)
      else if (answer.some((n) => n < 1 || n > lines.length)) fail('answer', `行の番号は、1〜${lines.length} の整数で入力してください。`)
      else if (answer.some((n) => !lines[n - 1].trim())) fail('answer', '空の行は選べません。')
      return { ...base, kind, code, answer }
    }
    case 'indent': {
      const indented = indentOf(code)
      const error = code ? linesError(indented.lines, 'コード') : null
      if (error) fail('code', error)
      else if (code && indented.levels.every((level) => level === 0)) fail('code', '字下げのある行を 1 つ以上入れてください。')
      else if (indented.levels.some((level) => level > MAX_QUIZ_INDENT)) fail('code', `字下げは ${MAX_QUIZ_INDENT} 段までにしてください。`)
      return { ...base, kind, code }
    }
    case 'table': {
      const table = readTable(row.answer)
      if (table.error) fail('answer', table.error)
      return { ...base, kind, code, columns: table.columns, rows: table.rows }
    }
  }
}

/**
 * 編集画面の値（client.ts が行から組み立てる JSON）を読み、入力の誤りを問題ごとに集める。
 * issues の key は入力欄の name（`<k>.<項目>`）か questions。rows は、描き直す画面に戻す入力中の値
 */
export function readQuizForm(json: string): { rows: QuizFormRow[]; questions: QuizQuestion[]; issues: QuizIssue[] } {
  const broken = () => ({ rows: [], questions: [], issues: [{ key: 'questions', message: FORM_BROKEN }] })
  if (json.length > MAX_QUIZ_JSON_LENGTH) return broken()
  let parsed: unknown
  try {
    parsed = json ? JSON.parse(json) : []
  } catch {
    return broken()
  }
  if (!Array.isArray(parsed)) return broken()
  const rows: QuizFormRow[] = []
  for (const raw of parsed) {
    const row = readRow(raw)
    if (!row) return broken()
    rows.push(row)
  }
  if (new Set(rows.map((r) => r.k)).size < rows.length) return broken()
  const issues: QuizIssue[] = []
  const questions = rows.map((row) => readQuestion(row, issues))
  if (rows.length > MAX_QUIZ_QUESTIONS) issues.push({ key: 'questions', message: `問題は ${MAX_QUIZ_QUESTIONS} 問までにしてください。` })
  return { rows, questions, issues }
}

// ---------------------------------------------------------------- 設定

export type QuizSettings = {
  questions: QuizQuestion[]
  /** 合格にする正解の割合（%） */
  passPercent: number
  /** 採点のあとに、不正解だった問題の正解と解説も見せるか（0 / 1） */
  showAnswers: number
  look: QuizLook
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = { questions: [], passPercent: DEFAULT_PASS_PERCENT, showAnswers: 1, look: 'plain' }

/** Moodle モードの extra_items の data（extra-kinds.tsx の quiz の toData が作る）を、小テストの設定として読む */
export const quizSettingsOf = (data: Record<string, unknown>): QuizSettings => ({
  questions: Array.isArray(data.questions) ? (data.questions as QuizQuestion[]) : [],
  passPercent: typeof data.passPercent === 'number' ? data.passPercent : DEFAULT_PASS_PERCENT,
  showAnswers: data.showAnswers === 0 ? 0 : 1,
  look: isQuizLook(data.look) ? data.look : 'plain',
})

// ---------------------------------------------------------------- 出題

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Math.random を使わないのは、開き直すたびに並びが変わると、途中まで並べた学生がやり直しになるため
function shuffled<T>(list: readonly T[], seed: string): T[] {
  let state = hash(seed)
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const result = [...list]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 並べ替えの行を混ぜる。seed が同じなら同じ並びになる。混ぜた結果が正しい順のままなら、先頭を末尾へ回す */
export function shuffledLines(lines: readonly string[], seed: string) {
  const result = shuffled(lines, seed)
  return sameList(result, lines) ? [...result.slice(1), result[0]] : result
}

/** 学生に出す形にする。seed は並べ替えの行の混ぜ方を決める（学生ごとに変える） */
export const takeQuestions = (questions: readonly QuizQuestion[], seed: string): QuizTakeQuestion[] =>
  questions.map((q) => {
    const { id, prompt } = q
    switch (q.kind) {
      case 'choice':
        return { id, kind: q.kind, prompt, code: q.code, choices: q.choices }
      case 'output':
      case 'bug':
      case 'flow':
        return { id, kind: q.kind, prompt, code: q.code }
      case 'order':
        return { id, kind: q.kind, prompt, lines: shuffledLines(q.lines, `${seed}:${id}`) }
      case 'indent':
        return { id, kind: q.kind, prompt, lines: indentOf(q.code).lines }
      case 'table':
        return { id, kind: q.kind, prompt, code: q.code, columns: q.columns, rowCount: q.rows.length }
    }
  })

const LIST_KINDS: readonly QuizKind[] = ['order', 'indent', 'table']

// 欄をいくつも送る種類の名前に [] を付けるのは、同じ名前の欄をすべて受け取るため（付けないと、最後の 1 つだけになる）
/** 解答のフォームの欄の名前 */
export const answerField = (q: Pick<QuizQuestion, 'id' | 'kind'>) => `a.${q.id}${LIST_KINDS.includes(q.kind) ? '[]' : ''}`

// ---------------------------------------------------------------- 採点

const intAnswer = (raw: unknown, min: number, max: number) => {
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  return n >= min && n <= max ? n : null
}

const stringList = (raw: unknown) => (Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : typeof raw === 'string' ? [raw] : [])

/** 送られた値を、問題の種類に合う答えにする。答えていない・形が合わないものは null */
export function readQuizAnswer(q: QuizQuestion, raw: unknown): QuizAnswer {
  switch (q.kind) {
    case 'choice':
      return intAnswer(raw, 0, q.choices.length - 1)
    case 'bug':
      return intAnswer(raw, 1, codeLines(q.code).length)
    case 'output': {
      const text = typeof raw === 'string' ? trimCode(raw).slice(0, MAX_QUIZ_OUTPUT_LENGTH) : ''
      return text || null
    }
    case 'order': {
      const lines = stringList(raw)
      // 配った行を並べ替えたものだけを受け付けるのは、書き換えた行を記録に残さないため
      return sameList([...lines].sort(), [...q.lines].sort()) ? lines : null
    }
    case 'flow': {
      const steps = typeof raw === 'string' ? parseSteps(raw) : null
      const count = codeLines(q.code).length
      return steps && steps.length > 0 && steps.length <= MAX_QUIZ_STEPS * 2 && steps.every((n) => n >= 1 && n <= count) ? steps : null
    }
    case 'indent': {
      const sent = stringList(raw)
      const levels = sent.map((v) => intAnswer(v, 0, MAX_QUIZ_INDENT)).filter((v) => v !== null)
      return levels.length === sent.length && levels.length === indentOf(q.code).lines.length ? levels : null
    }
    case 'table': {
      const cells = stringList(raw).map((v) => v.trim().slice(0, MAX_QUIZ_CELL_LENGTH))
      return cells.length === q.rows.length * q.columns.length && cells.some(Boolean) ? cells : null
    }
  }
}

export function isCorrectAnswer(q: QuizQuestion, answer: QuizAnswer) {
  if (answer === null) return false
  switch (q.kind) {
    case 'choice':
    case 'bug':
      return answer === q.answer
    case 'output':
      return typeof answer === 'string' && normalizeOutput(answer) === normalizeOutput(q.answer)
    case 'order':
      return Array.isArray(answer) && sameList(answer, q.lines)
    case 'flow':
      return Array.isArray(answer) && sameList(answer, q.answer)
    case 'indent':
      return Array.isArray(answer) && sameList(answer, indentOf(q.code).levels)
    case 'table':
      return (
        Array.isArray(answer) &&
        sameList(
          answer.map((v) => normalizeCell(String(v))),
          q.rows.flat().map(normalizeCell),
        )
      )
  }
}

/** 変数の追跡で、答えたマスが正しい値と合っているか */
export const isSameCell = (answer: string, correct: string) => normalizeCell(answer) === normalizeCell(correct)

export type QuizScore = { correct: number; total: number }

/** input は、欄の名前（answerField）から送られた値を返す */
export function gradeQuiz(
  questions: readonly QuizQuestion[],
  input: (field: string, q: QuizQuestion) => unknown,
): QuizScore & { records: QuizAnswerRecord[] } {
  const records = questions.map((q) => {
    const answer = readQuizAnswer(q, input(answerField(q), q))
    return { id: q.id, answer, correct: isCorrectAnswer(q, answer) }
  })
  return { records, correct: records.filter((r) => r.correct).length, total: records.length }
}

/** ゲームの見た目で、1 問ずつ確かめたときの最初の答え（client.ts の qgCheck が送る first[]）の欄の名前 */
export const FIRST_ANSWER_FIELD = 'first[]'

/**
 * ゲームの見た目で、扉のレバーを引いて最初にまちがえた答えを、問題の ID ごとの「送られた欄」にする。
 * 扉は正解するまで開かないので、最後の答えはいつも正解になる。最初の答えで採点して、まちがえた問題を点数に残す
 */
export function readFirstAnswers(raw: unknown): Map<string, Record<string, string | string[]>> {
  const firsts = new Map<string, Record<string, string | string[]>>()
  for (const text of stringList(raw)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const { id, fields } = parsed as { id?: unknown; fields?: unknown }
    if (typeof id !== 'string' || !Array.isArray(fields) || firsts.has(id)) continue
    const form: Record<string, string | string[]> = {}
    for (const entry of fields) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue
      const [name, value] = entry as [string, string]
      if (name !== `a.${id}` && name !== `a.${id}[]`) continue
      const prev = form[name]
      form[name] = name.endsWith('[]') ? [...(Array.isArray(prev) ? prev : []), value] : value
    }
    firsts.set(id, form)
  }
  return firsts
}

export const quizPercent = ({ correct, total }: QuizScore) => (total > 0 ? (correct / total) * 100 : 0)

export const isQuizPassed = (score: QuizScore, passPercent: number) => score.total > 0 && quizPercent(score) >= passPercent

/** ゲームの見た目の結果に出す星の数（0〜3）。全問正解で 3、合格で 2、1 問でも正解なら 1 */
export const quizStars = (score: QuizScore, passed: boolean) =>
  score.total > 0 && score.correct === score.total ? 3 : passed ? 2 : score.correct > 0 ? 1 : 0

/** いちばん正解の割合が高い受験 */
export const bestScore = <T extends QuizScore>(attempts: readonly T[]): T | null =>
  attempts.reduce<T | null>((best, a) => (!best || quizPercent(a) > quizPercent(best) ? a : best), null)

// ---------------------------------------------------------------- 結果

export type QuizSolution = { answer: number | string | string[] | number[]; explanation: string }

/** 採点のあとに見せる、問題 1 つの結果 */
export type QuizReviewItem = {
  question: QuizTakeQuestion
  answer: QuizAnswer
  /** その受験のあとに足された問題は null（採点していない） */
  correct: boolean | null
  /** 正解と解説。見せてよいときだけ入れる */
  solution?: QuizSolution
}

const solutionAnswerOf = (q: QuizQuestion): QuizSolution['answer'] => {
  switch (q.kind) {
    case 'order':
      return q.lines
    case 'indent':
      return indentOf(q.code).levels
    case 'table':
      return q.rows.flat()
    default:
      return q.answer
  }
}

/**
 * 受験の記録を、今の問題に重ねる。reveal が all ならすべての正解と解説を、correct なら正解した問題の解説だけを含める
 * （不正解の問題の正解を見せないアイテムで、受け直す前に答えが分からないようにする）
 */
export function reviewQuiz(
  questions: readonly QuizQuestion[],
  records: readonly QuizAnswerRecord[],
  reveal: 'all' | 'correct',
): QuizReviewItem[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  const take = takeQuestions(questions, '')
  return questions.map((q, i) => {
    const record = byId.get(q.id)
    const shown = reveal === 'all' || !!record?.correct
    return {
      question: take[i],
      answer: record?.answer ?? null,
      correct: record ? record.correct : null,
      ...(shown && { solution: { answer: solutionAnswerOf(q), explanation: q.explanation } }),
    }
  })
}
