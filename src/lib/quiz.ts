// サーバーの handlers と client.ts（lib/forms.ts 経由）の両方が読み込むので、DB や Node の API を使うモジュールを import しない

/** 小テストのアイテムの種類の名前（Moodle モードでは extra_items.type） */
export const QUIZ_KIND = 'quiz'

export const QUIZ_KINDS = ['choice', 'short', 'blank', 'order', 'lines', 'match', 'essay'] as const

export type QuizKind = (typeof QUIZ_KINDS)[number]

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  choice: '選択',
  short: '短答',
  blank: '穴埋め',
  order: '並べ替え',
  lines: '行を選ぶ',
  match: '組み合わせ',
  essay: '記述',
}

export const QUIZ_KIND_DESCRIPTIONS: Record<QuizKind, string> = {
  choice: '選択肢から 1 つ、または複数を選ぶ',
  short: '値や出力を短く書く',
  blank: 'コードや表の空欄を埋める',
  order: '行を正しい順に並べ、字下げを付ける',
  lines: 'バグのある行や、実行される順の行を選ぶ',
  match: '左の項目に合うものを右から選ぶ',
  essay: '文章で答える。教師が採点する',
}

/** 問題を足したときに、問題文の欄に最初から入れておく文 */
export const QUIZ_DEFAULT_PROMPTS: Record<QuizKind, string> = {
  choice: '',
  short: 'このコードを実行すると、何が出力されますか？',
  blank: '空欄に入るものを答えてください。',
  order: '正しく動くように、行を並べ替えてください。',
  lines: 'このコードには間違いがあります。間違っている行を選んでください。',
  match: '左の項目に合うものを、右から選んでください。',
  essay: 'このコードが何をしているか、説明してください。',
}

/** 行を選ぶ問題の選び方。one は 1 行だけ、many は当てはまる行をすべて、sequence は実行される順に（同じ行を何度選んでもよい） */
export const LINES_MODES = ['one', 'many', 'sequence'] as const
export type LinesMode = (typeof LINES_MODES)[number]
export const LINES_MODE_LABELS: Record<LinesMode, string> = { one: '1 行だけ', many: '当てはまる行すべて', sequence: '実行される順に' }

/** 並べ替えの問題で答えさせるもの */
export const ORDER_ASKS = ['order', 'indent', 'both'] as const
export type OrderAsk = (typeof ORDER_ASKS)[number]
export const ORDER_ASK_LABELS: Record<OrderAsk, string> = { order: '並び', indent: '字下げ', both: '並びと字下げ' }

/** 穴埋めの本文の形。table は | で区切った表として出す */
export const BLANK_LAYOUTS = ['code', 'table'] as const
export type BlankLayout = (typeof BLANK_LAYOUTS)[number]

/** 穴埋めの答え方。type は打ちこむ、pick は選択肢から選ぶ */
export const BLANK_FILLS = ['type', 'pick'] as const
export type BlankFill = (typeof BLANK_FILLS)[number]

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
/** 並べ替えに混ぜる、使わない行の数 */
export const MAX_QUIZ_DISTRACTORS = 10
/** 短答の正しい答えとして登録できる数 */
export const MAX_QUIZ_ANSWERS = 10
export const MAX_QUIZ_OUTPUT_LENGTH = 2000
export const MAX_QUIZ_EXPLANATION_LENGTH = 2000
/** 行を選ぶ問題の「実行される順に」で選べる行の数 */
export const MAX_QUIZ_STEPS = 40
/** 字下げの深さ */
export const MAX_QUIZ_INDENT = 8
export const MAX_QUIZ_BLANKS = 30
export const MAX_QUIZ_BLANK_LENGTH = 100
export const MAX_QUIZ_TABLE_COLUMNS = 8
/** 穴埋めの表の行の数（見出しの行を含む） */
export const MAX_QUIZ_TABLE_ROWS = 13
/** 穴埋めと組み合わせの選択肢に混ぜる、正解ではないものの数 */
export const MAX_QUIZ_EXTRAS = 10
export const MIN_QUIZ_PAIRS = 2
export const MAX_QUIZ_PAIRS = 12
export const MAX_QUIZ_KEYWORDS = 10
export const MAX_QUIZ_KEYWORD_LENGTH = 50
export const MAX_QUIZ_ESSAY_LENGTH = 4000
export const MAX_QUIZ_SAMPLE_LENGTH = 2000
export const MAX_QUIZ_JSON_LENGTH = 600_000
/** 1 人がアイテム 1 つを受けられる回数。受け直しは自由だが、記録が際限なく増えないように止める */
export const MAX_QUIZ_ATTEMPTS = 100
export const DEFAULT_PASS_PERCENT = 80

type QuestionBase = {
  /** 受験の記録と結び付ける目印。問題を書き換えても変えない */
  id: string
  prompt: string
  /** 問題に添えるコード。行を選ぶ問題では、選ぶ行そのもの */
  code: string
  /** 採点のあとに見せる解説 */
  explanation: string
}

export type ChoiceQuestion = QuestionBase & {
  kind: 'choice'
  choices: string[]
  multiple: boolean
  /** 正解の選択肢の位置（0 始まり）。multiple でなければ 1 つ */
  answers: number[]
}
export type ShortQuestion = QuestionBase & {
  kind: 'short'
  /** 正しい答え。どれか 1 つと合えば正解 */
  answers: string[]
  ignoreSpace: boolean
  ignoreCase: boolean
}
export type BlankQuestion = QuestionBase & {
  kind: 'blank'
  /** 空欄を {{正解|別解}} で書いた本文 */
  text: string
  layout: BlankLayout
  fill: BlankFill
  /** 選んで答えるときに、正解に混ぜる選択肢 */
  extras: string[]
}
export type OrderQuestion = QuestionBase & {
  kind: 'order'
  /** 正しい順に並べた行。字下げを答えさせるときは、正しい字下げを付けたまま */
  lines: string[]
  /** 混ぜておく、使わない行 */
  distractors: string[]
  ask: OrderAsk
}
export type LinesQuestion = QuestionBase & {
  kind: 'lines'
  mode: LinesMode
  /** 正解の行の番号（1 始まり）。sequence では実行される順 */
  answer: number[]
}
export type MatchQuestion = QuestionBase & {
  kind: 'match'
  pairs: { left: string; right: string }[]
  extras: string[]
}
export type EssayQuestion = QuestionBase & {
  kind: 'essay'
  /** すべて含む答えを、自動で正解にする言葉。なければ、教師が採点するまで採点待ち */
  keywords: string[]
  /** 採点のあとに見せる解答例 */
  sample: string
}

export type QuizQuestion = ChoiceQuestion | ShortQuestion | BlankQuestion | OrderQuestion | LinesQuestion | MatchQuestion | EssayQuestion

/** 穴埋めの本文の一部。文字か、空欄の番号（0 始まり） */
export type BlankPart = string | number

/** 学生に出す問題。正解と解説を含めない */
export type QuizTakeQuestion =
  | { id: string; kind: 'choice'; prompt: string; code: string; choices: string[]; multiple: boolean }
  | { id: string; kind: 'short'; prompt: string; code: string; multiline: boolean }
  | {
      id: string
      kind: 'blank'
      prompt: string
      code: string
      layout: BlankLayout
      /** 行 → マス → 文字と空欄。layout が code なら、1 行のマスは 1 つ */
      rows: BlankPart[][][]
      blanks: number
      /** 選んで答えるときの選択肢。打ちこむときは空 */
      options: string[]
    }
  | {
      id: string
      kind: 'order'
      prompt: string
      code: string
      /** 混ぜた行。字下げを答えさせるときは、字下げを除いてある */
      lines: string[]
      ask: OrderAsk
      /** 使わない行が混ざっているか */
      unused: boolean
    }
  | { id: string; kind: 'lines'; prompt: string; code: string; mode: LinesMode }
  | { id: string; kind: 'match'; prompt: string; code: string; lefts: string[]; options: string[] }
  | { id: string; kind: 'essay'; prompt: string; code: string }

/**
 * 選択の 1 つ・行を 1 行だけは選んだ位置・行、選択の複数・行を選ぶは位置・行の番号の並び、短答・記述は入力した文字、
 * 穴埋め・組み合わせは欄ごとの値、並べ替えは使う行（字下げを答えるときは、深さ 1 つを空白 4 つにして頭に付ける）。答えていなければ null
 */
export type QuizAnswer = number | string | string[] | number[] | null

/** correct が null なのは、記述の問題で教師の採点を待っているもの */
export type QuizAnswerRecord = { id: string; answer: QuizAnswer; correct: boolean | null }

export const isQuizKind = (v: unknown): v is QuizKind => QUIZ_KINDS.includes(v as QuizKind)

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)

export const codeLines = (code: string) => code.split('\n')

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n')

// 行末の空白と前後の空行だけを除くのは、行頭の空白は字下げとして意味を持つため
const trimCode = (s: string) =>
  normalizeNewlines(s)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')

// NFKC にそろえるのは、日本語入力のまま打った全角の数字や記号を、同じ答えとして受け付けるため
const normalizeShort = (s: string, q: Pick<ShortQuestion, 'ignoreSpace' | 'ignoreCase'>) => {
  const text = trimCode(s.normalize('NFKC'))
  const spaced = q.ignoreSpace ? text.replace(/\s+/g, '') : text
  return q.ignoreCase ? spaced.toLowerCase() : spaced
}

// 空白と引用符の種類を区別しないのは、[1, 2] と [1,2]、'a' と "a" のような書き方の違いを誤りにしないため
const normalizeCell = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').replace(/'/g, '"')

const normalizeWords = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i])

const byNumber = (a: number, b: number) => a - b

const sameSet = (a: readonly number[], b: readonly number[]) => sameList([...new Set(a)].sort(byNumber), [...new Set(b)].sort(byNumber))

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

/** 字下げした行を、字下げを除いた行と、行ごとの深さに分ける。深さの単位は、字下げの幅の最大公約数 */
export function indentOf(lines: readonly string[]): { lines: string[]; levels: number[] } {
  const widths = lines.map(indentWidth)
  const unit = widths.reduce(gcd, 0) || 1
  return { lines: lines.map((line) => line.trim()), levels: widths.map((w) => w / unit) }
}

const INDENT = '    '

/** 字下げの深さを、空白 4 つずつにして行の頭に付ける */
export const withIndent = (line: string, level: number) => INDENT.repeat(level) + line

/** 並べ替えの答えの 1 行（字下げを答えるとき）を、深さと字下げを除いた行に分ける */
export const levelOf = (line: string) => {
  const spaces = /^ */.exec(line)?.[0].length ?? 0
  return { level: Math.floor(spaces / INDENT.length), text: line.trim() }
}

const textList = (text: string) =>
  normalizeNewlines(text)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

const wordList = (text: string) =>
  text
    .split(/[\n,、]+/)
    .map((s) => s.trim())
    .filter(Boolean)

// ---------------------------------------------------------------- 穴埋めの本文

/** 本文を行 → マス → 文字と空欄に分け、空欄ごとの正解（別解を含む）を取り出す。error は本文の書き方の誤り */
export function parseBlanks(text: string, layout: BlankLayout): { rows: BlankPart[][][]; blanks: string[][]; error: string | null } {
  const rows: BlankPart[][][] = []
  const blanks: string[][] = []
  let error: string | null = null
  const lines =
    layout === 'table'
      ? trimCode(text)
          .split('\n')
          .filter((line) => line.trim())
      : codeLines(trimCode(text))
  for (const line of lines) {
    const cells: BlankPart[][] = [[]]
    let plain = ''
    const flush = () => {
      if (plain) cells[cells.length - 1].push(plain)
      plain = ''
    }
    for (let at = 0; at < line.length; at++) {
      if (line.startsWith('{{', at)) {
        const end = line.indexOf('}}', at + 2)
        if (end < 0) {
          error ??= '{{ に対応する }} がありません。空欄は {{正解}} のように書いてください。'
          plain += line.slice(at)
          break
        }
        const answers = line
          .slice(at + 2, end)
          .split(/(?<!\\)\|/)
          .map((s) => s.replace(/\\\|/g, '|').trim())
          .filter(Boolean)
        if (answers.length === 0) error ??= '空欄の正解が空です。{{正解}} のように、中に正解を書いてください。'
        flush()
        cells[cells.length - 1].push(blanks.length)
        blanks.push(answers)
        at = end + 1
      } else if (layout === 'table' && line[at] === '|') {
        flush()
        cells.push([])
      } else if (layout === 'table' && line.startsWith('\\|', at)) {
        plain += '|'
        at++
      } else plain += line[at]
    }
    flush()
    if (layout === 'table')
      for (const cell of cells) {
        const first = cell[0]
        const last = cell[cell.length - 1]
        if (typeof first === 'string') cell[0] = first.trimStart()
        if (typeof last === 'string') cell[cell.length - 1] = (cell[cell.length - 1] as string).trimEnd()
      }
    rows.push(cells.map((cell) => cell.filter((part) => part !== '')))
  }
  return { rows, blanks, error }
}

// ---------------------------------------------------------------- 前の形式の問題

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const strOf = (v: unknown) => (typeof v === 'string' ? v : '')
const strsOf = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [])
const numsOf = (v: unknown) => (Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [])

/** 前の形式（出力の予測・バグ探し・実行の順番・字下げ・変数の追跡など）で保存した問題を、今の形にする。読めなければ null */
export function upgradeQuestion(raw: unknown): QuizQuestion | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const base = { id: raw.id, prompt: strOf(raw.prompt), code: strOf(raw.code), explanation: strOf(raw.explanation) }
  switch (raw.kind) {
    case 'choice':
      return {
        ...base,
        kind: 'choice',
        choices: strsOf(raw.choices),
        multiple: raw.multiple === true,
        answers: Array.isArray(raw.answers) ? numsOf(raw.answers) : typeof raw.answer === 'number' ? [raw.answer] : [],
      }
    case 'short':
      return {
        ...base,
        kind: 'short',
        answers: strsOf(raw.answers),
        ignoreSpace: raw.ignoreSpace === true,
        ignoreCase: raw.ignoreCase === true,
      }
    case 'output':
      return { ...base, kind: 'short', answers: [strOf(raw.answer)], ignoreSpace: false, ignoreCase: false }
    case 'blank':
      return {
        ...base,
        kind: 'blank',
        text: strOf(raw.text),
        layout: isOneOf(BLANK_LAYOUTS, raw.layout) ? raw.layout : 'code',
        fill: isOneOf(BLANK_FILLS, raw.fill) ? raw.fill : 'type',
        extras: strsOf(raw.extras),
      }
    case 'table': {
      // 前の形式の答え（行ごとに並べたマスの値）がそのまま空欄の答えになるように、すべての値のマスを、左上から行ごとの空欄にする
      const columns = strsOf(raw.columns)
      const rows = Array.isArray(raw.rows) ? raw.rows.map(strsOf) : []
      const escape = (s: string) => s.replace(/\|/g, '\\|')
      const text = [
        ['回', ...columns.map(escape)].join(' | '),
        ...rows.map((cells, r) => [String(r + 1), ...cells.map((cell) => `{{${escape(cell)}}}`)].join(' | ')),
      ].join('\n')
      return { ...base, kind: 'blank', text, layout: 'table', fill: 'type', extras: [] }
    }
    case 'order':
      return {
        ...base,
        kind: 'order',
        lines: strsOf(raw.lines),
        distractors: strsOf(raw.distractors),
        ask: isOneOf(ORDER_ASKS, raw.ask) ? raw.ask : 'order',
      }
    case 'indent':
      return {
        ...base,
        code: '',
        kind: 'order',
        lines: codeLines(trimCode(base.code)).filter((line) => line.trim()),
        distractors: [],
        ask: 'indent',
      }
    case 'lines':
      return { ...base, kind: 'lines', mode: isOneOf(LINES_MODES, raw.mode) ? raw.mode : 'one', answer: numsOf(raw.answer) }
    case 'bug':
      return { ...base, kind: 'lines', mode: 'one', answer: typeof raw.answer === 'number' ? [raw.answer] : [] }
    case 'flow':
      return { ...base, kind: 'lines', mode: 'sequence', answer: numsOf(raw.answer) }
    case 'match':
      return {
        ...base,
        kind: 'match',
        pairs: Array.isArray(raw.pairs) ? raw.pairs.filter(isRecord).map((p) => ({ left: strOf(p.left), right: strOf(p.right) })) : [],
        extras: strsOf(raw.extras),
      }
    case 'essay':
      return { ...base, kind: 'essay', keywords: strsOf(raw.keywords), sample: strOf(raw.sample) }
    default:
      return null
  }
}

export const upgradeQuestions = (raw: unknown): QuizQuestion[] =>
  Array.isArray(raw) ? raw.map(upgradeQuestion).filter((q) => q !== null) : []

// ---------------------------------------------------------------- 編集画面から送られた値

/**
 * 編集画面（components/quiz.tsx の QuizQuestionsField）の問題 1 つの、入力中の値。どの種類でもすべての欄を持つ。
 * 選び方の欄（multiple など）は、ラジオボタンで選んだ値の文字
 */
export type QuizFormRow = {
  k: string
  kind: QuizKind
  prompt: string
  code: string
  explanation: string
  /** 選択の選択肢と、正解の印 */
  choices: string[]
  correct: boolean[]
  multiple: string
  /** 短答の正しい答え */
  answers: string[]
  space: string
  case: string
  /** 穴埋めの本文 */
  text: string
  layout: string
  fill: string
  /** 並べ替えの正しい順の行（改行区切り） */
  lines: string
  ask: string
  /** 並べ替えの使わない行、穴埋めと組み合わせの選択肢に混ぜるもの（改行区切り） */
  extras: string
  /** 行を選ぶ問題の正解の行の番号 */
  steps: string
  mode: string
  /** 組み合わせの左と右 */
  pairs: [string, string][]
  /** 記述の、自動で正解にする言葉（改行かカンマ区切り）と解答例 */
  keywords: string
  sample: string
}

export type QuizIssue = { key: string; message: string }

/** 追加する問題のひな形（template）で、問題の目印を入れる場所。client.ts が足すときに置き換える */
export const QUIZ_KEY_SLOT = '__K__'

/** 行を選ぶ問題の編集で、入力した番号の行の中身。番号が行の範囲になければ null */
export function lineAt(code: string, lineNo: string | number) {
  const text = String(lineNo).trim()
  const n = /^\d+$/.test(text) ? Number(text) : 0
  return codeLines(trimCode(code))[n - 1] ?? null
}

const BLANK_ROW: Omit<QuizFormRow, 'k' | 'kind' | 'prompt'> = {
  code: '',
  explanation: '',
  choices: [],
  correct: [],
  multiple: '0',
  answers: [],
  space: '0',
  case: '0',
  text: '',
  layout: 'code',
  fill: 'type',
  lines: '',
  ask: 'order',
  extras: '',
  steps: '',
  mode: 'one',
  pairs: [],
  keywords: '',
  sample: '',
}

/** 問題を足したときの、入力欄の最初の値 */
export const blankFormRow = (k: string, kind: QuizKind): QuizFormRow => ({
  ...BLANK_ROW,
  k,
  kind,
  prompt: QUIZ_DEFAULT_PROMPTS[kind],
  ...(kind === 'choice' && { choices: ['', '', '', ''], correct: [false, false, false, false] }),
  ...(kind === 'short' && { answers: [''] }),
  ...(kind === 'match' && {
    pairs: [
      ['', ''],
      ['', ''],
      ['', ''],
    ],
  }),
})

const flag = (on: boolean) => (on ? '1' : '0')

function formRowOf(q: QuizQuestion): QuizFormRow {
  const row = { ...BLANK_ROW, k: q.id, kind: q.kind, prompt: q.prompt, code: q.code, explanation: q.explanation }
  switch (q.kind) {
    case 'choice':
      return { ...row, choices: q.choices, correct: q.choices.map((_, i) => q.answers.includes(i)), multiple: flag(q.multiple) }
    case 'short':
      return { ...row, answers: q.answers, space: flag(q.ignoreSpace), case: flag(q.ignoreCase) }
    case 'blank':
      return { ...row, text: q.text, layout: q.layout, fill: q.fill, extras: q.extras.join('\n') }
    case 'order':
      return { ...row, lines: q.lines.join('\n'), extras: q.distractors.join('\n'), ask: q.ask }
    case 'lines':
      return { ...row, steps: q.answer.join(', '), mode: q.mode }
    case 'match':
      return { ...row, pairs: q.pairs.map((p) => [p.left, p.right]), extras: q.extras.join('\n') }
    case 'essay':
      return { ...row, keywords: q.keywords.join('\n'), sample: q.sample }
  }
}

export const quizFormRows = (questions: readonly QuizQuestion[]): QuizFormRow[] => questions.map(formRowOf)

const FORM_BROKEN = '問題を読み取れませんでした。ページを開き直してから、もう一度お試しください。'

const KEY_PATTERN = /^[A-Za-z0-9]{1,32}$/

function readRow(raw: unknown): QuizFormRow | null {
  if (!isRecord(raw) || typeof raw.k !== 'string' || !KEY_PATTERN.test(raw.k) || !isQuizKind(raw.kind)) return null
  const str = (key: keyof QuizFormRow) => normalizeNewlines(strOf(raw[key]))
  const list = (key: keyof QuizFormRow) => (Array.isArray(raw[key]) ? raw[key].map((s) => normalizeNewlines(strOf(s))) : [])
  return {
    k: raw.k,
    kind: raw.kind,
    prompt: str('prompt'),
    code: str('code'),
    explanation: str('explanation'),
    choices: list('choices'),
    correct: Array.isArray(raw.correct) ? raw.correct.map((v) => v === true) : [],
    multiple: str('multiple'),
    answers: list('answers'),
    space: str('space'),
    case: str('case'),
    text: str('text'),
    layout: str('layout'),
    fill: str('fill'),
    lines: str('lines'),
    ask: str('ask'),
    extras: str('extras'),
    steps: str('steps'),
    mode: str('mode'),
    pairs: Array.isArray(raw.pairs)
      ? raw.pairs.map((p): [string, string] => (Array.isArray(p) ? [strOf(p[0]).trim(), strOf(p[1]).trim()] : ['', '']))
      : [],
    keywords: str('keywords'),
    sample: str('sample'),
  }
}

const tooLong = (label: string, max: number) => `${label}は${max}文字以内で入力してください。`

/** 並べ替えの行の数と長さの誤り。なければ null */
function linesError(lines: readonly string[], label: string) {
  if (lines.length < MIN_QUIZ_LINES) return `${label}を ${MIN_QUIZ_LINES} 行以上入力してください。`
  if (lines.length > MAX_QUIZ_LINES) return `${label}は ${MAX_QUIZ_LINES} 行までにしてください。`
  if (lines.some((line) => line.length > MAX_QUIZ_LINE_LENGTH)) return tooLong('1 行', MAX_QUIZ_LINE_LENGTH)
  return null
}

/** 改行区切りの選択肢に混ぜるものの誤り。なければ null */
function extrasError(extras: readonly string[], max: number, length: number) {
  if (extras.length > max) return `混ぜるものは ${max} 個までにしてください。`
  if (extras.some((s) => s.length > length)) return tooLong('混ぜるもの 1 つ', length)
  return null
}

/** 穴埋めの本文の誤り。なければ null */
function blankError(text: string, layout: BlankLayout) {
  if (!text.trim()) return '空欄のある本文を入力してください。'
  if (text.length > MAX_QUIZ_CODE_LENGTH) return tooLong('本文', MAX_QUIZ_CODE_LENGTH)
  const sheet = parseBlanks(text, layout)
  if (sheet.error) return sheet.error
  if (sheet.blanks.length === 0) return '空欄がありません。答えさせたいところを {{正解}} のように書いてください。'
  if (sheet.blanks.length > MAX_QUIZ_BLANKS) return `空欄は ${MAX_QUIZ_BLANKS} 個までにしてください。`
  if (sheet.blanks.some((answers) => answers.some((a) => a.length > MAX_QUIZ_BLANK_LENGTH)))
    return tooLong('空欄の正解', MAX_QUIZ_BLANK_LENGTH)
  if (layout === 'table') {
    const [head, ...body] = sheet.rows
    if (body.length === 0) return '表は、1 行目に見出し、2 行目から中身を | で区切って書いてください。'
    if (sheet.rows.length > MAX_QUIZ_TABLE_ROWS) return `表の行は、見出しを含めて ${MAX_QUIZ_TABLE_ROWS} 行までにしてください。`
    if (head.length > MAX_QUIZ_TABLE_COLUMNS) return `表の列は ${MAX_QUIZ_TABLE_COLUMNS} 列までにしてください。`
    const uneven = body.findIndex((cells) => cells.length !== head.length)
    if (uneven >= 0) return `${uneven + 2} 行目のマスの数が、見出し（${head.length} 個）と合いません。`
  }
  return null
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
  if (!code && kind === 'lines') fail('code', 'コードを入力してください。')
  else if (code.length > MAX_QUIZ_CODE_LENGTH) fail('code', tooLong('コード', MAX_QUIZ_CODE_LENGTH))
  const base = { id: k, prompt, code, explanation }
  switch (kind) {
    case 'choice': {
      const multiple = row.multiple === '1'
      const filled = row.choices.map((text, i) => ({ text: text.trim(), right: !!row.correct[i] })).filter((c) => c.text)
      const choices = filled.map((c) => c.text)
      const answers = filled.flatMap((c, i) => (c.right ? [i] : []))
      if (choices.length < MIN_QUIZ_CHOICES) fail('choices', `選択肢を ${MIN_QUIZ_CHOICES} つ以上入力してください。`)
      else if (choices.length > MAX_QUIZ_CHOICES) fail('choices', `選択肢は ${MAX_QUIZ_CHOICES} 個までにしてください。`)
      else if (choices.some((c) => c.length > MAX_QUIZ_CHOICE_LENGTH)) fail('choices', tooLong('選択肢', MAX_QUIZ_CHOICE_LENGTH))
      else if (new Set(choices).size < choices.length) fail('choices', '同じ選択肢が 2 つあります。')
      else if (answers.length === 0) fail('choices', '正解の選択肢に印を付けてください。')
      else if (!multiple && answers.length > 1)
        fail('choices', '正解は 1 つだけにしてください。複数を正解にするときは、選び方を「複数選ぶ」にします。')
      return { ...base, kind, choices, multiple, answers }
    }
    case 'short': {
      const answers = row.answers.map(trimCode).filter(Boolean)
      if (answers.length === 0) fail('answers', '正しい答えを入力してください。')
      else if (answers.length > MAX_QUIZ_ANSWERS) fail('answers', `正しい答えは ${MAX_QUIZ_ANSWERS} 個までにしてください。`)
      else if (answers.some((a) => a.length > MAX_QUIZ_OUTPUT_LENGTH)) fail('answers', tooLong('正しい答え', MAX_QUIZ_OUTPUT_LENGTH))
      return { ...base, kind, answers, ignoreSpace: row.space === '1', ignoreCase: row.case === '1' }
    }
    case 'blank': {
      const layout = isOneOf(BLANK_LAYOUTS, row.layout) ? row.layout : 'code'
      const fill = isOneOf(BLANK_FILLS, row.fill) ? row.fill : 'type'
      const text = trimCode(row.text)
      const extras = fill === 'pick' ? textList(row.extras) : []
      const error = blankError(text, layout)
      if (error) fail('text', error)
      const extraError = extrasError(extras, MAX_QUIZ_EXTRAS, MAX_QUIZ_BLANK_LENGTH)
      if (extraError) fail('extras', extraError)
      return { ...base, kind, text, layout, fill, extras }
    }
    case 'order': {
      const ask = isOneOf(ORDER_ASKS, row.ask) ? row.ask : 'order'
      const ordered = trimCode(row.lines)
        .split('\n')
        .filter((line) => line.trim())
      const distractors = trimCode(row.extras)
        .split('\n')
        .filter((line) => line.trim())
      const error = linesError(ordered, '正しい順の行')
      const levels = indentOf(ordered).levels
      if (error) fail('lines', error)
      else if (ask !== 'indent' && new Set(ordered).size < 2) fail('lines', '同じ行だけでは並べ替えになりません。')
      else if (ask !== 'order' && levels.every((level) => level === 0)) fail('lines', '字下げのある行を 1 つ以上入れてください。')
      else if (levels.some((level) => level > MAX_QUIZ_INDENT)) fail('lines', `字下げは ${MAX_QUIZ_INDENT} 段までにしてください。`)
      const extraError = extrasError(distractors, MAX_QUIZ_DISTRACTORS, MAX_QUIZ_LINE_LENGTH)
      if (extraError) fail('extras', extraError)
      return { ...base, kind, lines: ordered, distractors, ask }
    }
    case 'lines': {
      const mode = isOneOf(LINES_MODES, row.mode) ? row.mode : 'one'
      const answer = parseSteps(row.steps) ?? []
      if (!code) return { ...base, kind, mode, answer }
      const range = `行の番号は、1〜${lines.length} の整数で入力してください。`
      if (answer.some((n) => n < 1 || n > lines.length)) fail('steps', range)
      else if (answer.some((n) => !lines[n - 1].trim())) fail('steps', '空の行は選べません。')
      else if (mode === 'one' && answer.length !== 1) fail('steps', '正解の行の番号を 1 つ入力してください。')
      else if (mode === 'many' && answer.length === 0) fail('steps', '正解の行の番号を、カンマで区切って入力してください。')
      else if (mode === 'many' && new Set(answer).size < answer.length) fail('steps', '同じ行の番号が 2 回あります。')
      else if (mode === 'sequence' && answer.length < 2)
        fail('steps', '実行される順に、行の番号を 2 つ以上、カンマで区切って入力してください。')
      else if (answer.length > MAX_QUIZ_STEPS) fail('steps', `行の番号は ${MAX_QUIZ_STEPS} 個までにしてください。`)
      return { ...base, kind, mode, answer: mode === 'many' ? [...answer].sort((a, b) => a - b) : answer }
    }
    case 'match': {
      const pairs = row.pairs.filter(([left, right]) => left || right).map(([left, right]) => ({ left, right }))
      const extras = textList(row.extras)
      if (pairs.length < MIN_QUIZ_PAIRS) fail('pairs', `組み合わせを ${MIN_QUIZ_PAIRS} つ以上入力してください。`)
      else if (pairs.length > MAX_QUIZ_PAIRS) fail('pairs', `組み合わせは ${MAX_QUIZ_PAIRS} 個までにしてください。`)
      else if (pairs.some((p) => !p.left || !p.right)) fail('pairs', '左と右の両方を入力してください。')
      else if (pairs.some((p) => p.left.length > MAX_QUIZ_CHOICE_LENGTH || p.right.length > MAX_QUIZ_CHOICE_LENGTH))
        fail('pairs', tooLong('1 つの項目', MAX_QUIZ_CHOICE_LENGTH))
      else if (new Set(pairs.map((p) => p.left)).size < pairs.length) fail('pairs', '左に同じ項目が 2 つあります。')
      const extraError = extrasError(extras, MAX_QUIZ_EXTRAS, MAX_QUIZ_CHOICE_LENGTH)
      if (extraError) fail('extras', extraError)
      return { ...base, kind, pairs, extras }
    }
    case 'essay': {
      const keywords = wordList(row.keywords)
      const sample = row.sample.trim()
      if (keywords.length > MAX_QUIZ_KEYWORDS) fail('keywords', `キーワードは ${MAX_QUIZ_KEYWORDS} 個までにしてください。`)
      else if (keywords.some((w) => w.length > MAX_QUIZ_KEYWORD_LENGTH))
        fail('keywords', tooLong('キーワード 1 つ', MAX_QUIZ_KEYWORD_LENGTH))
      if (sample.length > MAX_QUIZ_SAMPLE_LENGTH) fail('sample', tooLong('解答例', MAX_QUIZ_SAMPLE_LENGTH))
      return { ...base, kind, keywords, sample }
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
  questions: upgradeQuestions(data.questions),
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

const seeded = (seed: string) => {
  let state = hash(seed)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Math.random を使わないのは、開き直すたびに並びが変わると、途中まで並べた学生がやり直しになるため
function shuffled<T>(list: readonly T[], seed: string): T[] {
  const random = seeded(seed)
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
  return result.length > 1 && sameList(result, lines) ? [...result.slice(1), result[0]] : result
}

/** 並べ替えで並びを答えさせないときの行。正しい順のまま、使わない行を seed で決めた位置に差しこむ */
function insertedLines(lines: readonly string[], distractors: readonly string[], seed: string) {
  const random = seeded(seed)
  const result = [...lines]
  for (const extra of distractors) result.splice(Math.floor(random() * (result.length + 1)), 0, extra)
  return result
}

const unique = (list: readonly string[]) => [...new Set(list)]

/** 穴埋め（選んで答える）の選択肢。空欄ごとの最初の正解と、混ぜるもの */
const blankOptionsOf = (q: BlankQuestion) =>
  unique([...parseBlanks(q.text, q.layout).blanks.map((answers) => answers[0] ?? ''), ...q.extras])

const matchOptionsOf = (q: MatchQuestion) => unique([...q.pairs.map((p) => p.right), ...q.extras])

/** 並べ替えで配る行（混ぜる前）。字下げを答えさせるときは、字下げを除く */
function orderPoolOf(q: OrderQuestion) {
  const pool = [...q.lines, ...q.distractors]
  return q.ask === 'order' ? pool : pool.map((line) => line.trim())
}

function takeQuestion(q: QuizQuestion, seed: string): QuizTakeQuestion {
  const { id, prompt, code } = q
  const base = { id, prompt, code }
  switch (q.kind) {
    case 'choice':
      return { ...base, kind: q.kind, choices: q.choices, multiple: q.multiple }
    case 'short':
      return { ...base, kind: q.kind, multiline: q.answers.some((a) => a.includes('\n')) }
    case 'blank': {
      const sheet = parseBlanks(q.text, q.layout)
      const options = q.fill === 'pick' ? shuffled(blankOptionsOf(q), `${seed}:${id}`) : []
      return { ...base, kind: q.kind, layout: q.layout, rows: sheet.rows, blanks: sheet.blanks.length, options }
    }
    case 'order': {
      const lines = orderPoolOf(q)
      const placed =
        q.ask === 'indent'
          ? insertedLines(lines.slice(0, q.lines.length), lines.slice(q.lines.length), `${seed}:${id}`)
          : shuffledLines(lines, `${seed}:${id}`)
      return { ...base, kind: q.kind, lines: placed, ask: q.ask, unused: q.distractors.length > 0 }
    }
    case 'lines':
      return { ...base, kind: q.kind, mode: q.mode }
    case 'match':
      return { ...base, kind: q.kind, lefts: q.pairs.map((p) => p.left), options: shuffled(matchOptionsOf(q), `${seed}:${id}`) }
    case 'essay':
      return { ...base, kind: q.kind }
  }
}

/** 学生に出す形にする。seed は並べ替えの行と選択肢の混ぜ方を決める（学生ごとに変える） */
export const takeQuestions = (questions: readonly QuizQuestion[], seed: string): QuizTakeQuestion[] =>
  questions.map((q) => takeQuestion(q, seed))

type AnswerShape =
  | Pick<ChoiceQuestion, 'id' | 'kind' | 'multiple'>
  | Pick<LinesQuestion, 'id' | 'kind' | 'mode'>
  | { id: string; kind: Exclude<QuizKind, 'choice' | 'lines'> }

/** 欄をいくつも送る問題か */
const isListAnswer = (q: AnswerShape) =>
  q.kind === 'blank' ||
  q.kind === 'order' ||
  q.kind === 'match' ||
  (q.kind === 'choice' && q.multiple) ||
  (q.kind === 'lines' && q.mode === 'many')

// 欄をいくつも送る問題の名前に [] を付けるのは、同じ名前の欄をすべて受け取るため（付けないと、最後の 1 つだけになる）
/** 解答のフォームの欄の名前 */
export const answerField = (q: AnswerShape) => `a.${q.id}${isListAnswer(q) ? '[]' : ''}`

// ---------------------------------------------------------------- 採点

const intAnswer = (raw: unknown, min: number, max: number) => {
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  return n >= min && n <= max ? n : null
}

const stringList = (raw: unknown) => (Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : typeof raw === 'string' ? [raw] : [])

const textAnswer = (raw: unknown, max: number) => {
  const text = typeof raw === 'string' ? trimCode(raw).slice(0, max) : ''
  return text || null
}

/** sent の値が、pool の中からそれぞれ 1 回ずつ取り出したものか */
function drawnFrom(sent: readonly string[], pool: readonly string[]) {
  const left = [...pool]
  return sent.every((v) => {
    const at = left.indexOf(v)
    if (at < 0) return false
    left.splice(at, 1)
    return true
  })
}

/** 選んだ位置・行の番号の並び。重ならない番号を小さい順にする */
const indexList = (raw: unknown, min: number, max: number) => {
  const sent = stringList(raw).map((v) => intAnswer(v, min, max))
  return sent.length > 0 && sent.every((n) => n !== null) ? [...new Set(sent)].sort((a, b) => a - b) : null
}

/** 送られた値を、問題の種類に合う答えにする。答えていない・形が合わないものは null */
export function readQuizAnswer(q: QuizQuestion, raw: unknown): QuizAnswer {
  switch (q.kind) {
    case 'choice':
      return q.multiple ? indexList(raw, 0, q.choices.length - 1) : intAnswer(raw, 0, q.choices.length - 1)
    case 'short':
      return textAnswer(raw, MAX_QUIZ_OUTPUT_LENGTH)
    case 'essay':
      return textAnswer(raw, MAX_QUIZ_ESSAY_LENGTH)
    case 'blank': {
      const count = parseBlanks(q.text, q.layout).blanks.length
      const cells = stringList(raw).map((v) => v.trim().slice(0, MAX_QUIZ_BLANK_LENGTH))
      return cells.length === count && cells.some(Boolean) ? cells : null
    }
    case 'match': {
      const sent = stringList(raw)
      const options = matchOptionsOf(q)
      return sent.length === q.pairs.length && sent.some(Boolean) && sent.every((v) => !v || options.includes(v)) ? sent : null
    }
    case 'order': {
      const sent = stringList(raw)
      if (sent.length === 0) return null
      const pool = orderPoolOf(q)
      if (q.ask === 'order') return drawnFrom(sent, pool) ? sent : null
      // 配った行に字下げを付けたものだけを受け付けるのは、書き換えた行を記録に残さないため
      const read = sent.map(levelOf)
      return read.every((r) => r.level <= MAX_QUIZ_INDENT) &&
        drawnFrom(
          read.map((r) => r.text),
          pool,
        )
        ? read.map((r) => withIndent(r.text, r.level))
        : null
    }
    case 'lines': {
      const count = codeLines(q.code).length
      if (q.mode === 'one') return intAnswer(raw, 1, count)
      if (q.mode === 'many') return indexList(raw, 1, count)
      const steps = typeof raw === 'string' ? parseSteps(raw) : null
      return steps && steps.length > 0 && steps.length <= MAX_QUIZ_STEPS * 2 && steps.every((n) => n >= 1 && n <= count) ? steps : null
    }
  }
}

/** 答えが合っているか。記述でキーワードだけでは決められないものは null（教師の採点を待つ） */
export function isCorrectAnswer(q: QuizQuestion, answer: QuizAnswer): boolean | null {
  if (answer === null) return false
  switch (q.kind) {
    case 'choice':
      return q.multiple ? Array.isArray(answer) && sameSet(answer as number[], q.answers) : answer === q.answers[0]
    case 'short':
      return typeof answer === 'string' && q.answers.some((a) => normalizeShort(a, q) === normalizeShort(answer, q))
    case 'blank': {
      const { blanks } = parseBlanks(q.text, q.layout)
      return (
        Array.isArray(answer) && answer.length === blanks.length && blanks.every((answers, i) => isSameCell(String(answer[i]), answers))
      )
    }
    case 'match':
      return Array.isArray(answer) && q.pairs.every((p, i) => answer[i] === p.right)
    case 'order': {
      if (!Array.isArray(answer)) return false
      if (q.ask === 'order') return sameList(answer, q.lines)
      const right = indentOf(q.lines)
      const read = (answer as string[]).map(levelOf)
      return (
        sameList(
          read.map((r) => r.text),
          right.lines,
        ) &&
        sameList(
          read.map((r) => r.level),
          right.levels,
        )
      )
    }
    case 'lines':
      if (q.mode === 'one') return answer === q.answer[0]
      return Array.isArray(answer) && (q.mode === 'many' ? sameSet(answer as number[], q.answer) : sameList(answer, q.answer))
    case 'essay': {
      if (typeof answer !== 'string' || q.keywords.length === 0) return null
      const written = normalizeWords(answer)
      return q.keywords.every((word) => written.includes(normalizeWords(word))) ? true : null
    }
  }
}

/** 穴埋めの欄の値が、空欄の正解（別解を含む）のどれかと合っているか */
export const isSameCell = (answer: string, answers: readonly string[]) => answers.some((a) => normalizeCell(answer) === normalizeCell(a))

export type QuizScore = { correct: number; total: number }

/** input は、欄の名前（answerField）から送られた値を返す。pending は採点待ちの問題の数 */
export function gradeQuiz(
  questions: readonly QuizQuestion[],
  input: (field: string, q: QuizQuestion) => unknown,
): QuizScore & { pending: number; records: QuizAnswerRecord[] } {
  const records = questions.map((q) => {
    const answer = readQuizAnswer(q, input(answerField(q), q))
    return { id: q.id, answer, correct: isCorrectAnswer(q, answer) }
  })
  return {
    records,
    correct: records.filter((r) => r.correct === true).length,
    total: records.length,
    pending: records.filter((r) => r.correct === null).length,
  }
}

/** 記録の点数を数え直す（教師が記述を採点したあと） */
export const scoreOf = (records: readonly QuizAnswerRecord[]) => ({
  correct: records.filter((r) => r.correct === true).length,
  total: records.length,
  pending: records.filter((r) => r.correct === null).length,
})

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

/** 正解。選択と行を選ぶは位置・行の番号、短答は正しい答え、穴埋めは空欄ごとの正解（別解を含む）、組み合わせは右の項目、並べ替えは正しい行、記述は解答例 */
export type QuizSolution = { answer: number[] | string[] | string[][] | string; explanation: string }

/** 問題 1 つの結果。none は、その受験のあとに足された問題（採点していない） */
export type QuizReviewStatus = 'right' | 'wrong' | 'pending' | 'none'

/** 採点のあとに見せる、問題 1 つの結果 */
export type QuizReviewItem = {
  question: QuizTakeQuestion
  answer: QuizAnswer
  status: QuizReviewStatus
  /** 正解と解説。見せてよいときだけ入れる */
  solution?: QuizSolution
}

const solutionAnswerOf = (q: QuizQuestion): QuizSolution['answer'] => {
  switch (q.kind) {
    case 'choice':
    case 'short':
      return q.answers
    case 'blank':
      return parseBlanks(q.text, q.layout).blanks
    case 'order':
      return q.ask === 'order' ? q.lines : (({ lines, levels }) => lines.map((line, i) => withIndent(line, levels[i])))(indentOf(q.lines))
    case 'lines':
      return q.answer
    case 'match':
      return q.pairs.map((p) => p.right)
    case 'essay':
      return q.sample
  }
}

/** 前の形式で残した答えを、今の問題の形に合わせる（字下げの問題の、行ごとの深さの答え） */
function upgradeAnswer(q: QuizQuestion, take: QuizTakeQuestion, answer: QuizAnswer): QuizAnswer {
  if (q.kind === 'order' && take.kind === 'order' && Array.isArray(answer) && answer.every((v) => typeof v === 'number'))
    return take.lines.map((line, i) => withIndent(line, (answer as number[])[i] ?? 0))
  return answer
}

const statusOf = (record: QuizAnswerRecord | undefined): QuizReviewStatus =>
  !record ? 'none' : record.correct === null ? 'pending' : record.correct ? 'right' : 'wrong'

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
    const status = statusOf(record)
    const shown = reveal === 'all' || status === 'right'
    return {
      question: take[i],
      answer: upgradeAnswer(q, take[i], record?.answer ?? null),
      status,
      ...(shown && { solution: { answer: solutionAnswerOf(q), explanation: q.explanation } }),
    }
  })
}
