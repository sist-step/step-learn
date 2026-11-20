// サーバーと features/code/editor.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

export const CODE_LANGUAGES = ['web', 'python'] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

export const isCodeLanguage = (s: string | undefined): s is CodeLanguage => (CODE_LANGUAGES as readonly unknown[]).includes(s)

export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  web: 'Web（HTML / CSS / JavaScript）',
  python: 'Python',
}

export const GRADING_STATUSES = ['none', 'pending', 'graded', 'failed'] as const

export type GradingStatus = (typeof GRADING_STATUSES)[number]

export const GRADING_STATUS_LABELS: Record<GradingStatus, string> = {
  none: '採点なし',
  pending: '採点中',
  graded: '採点済み',
  failed: '採点できませんでした',
}

/**
 * 判定の観点の 1 つ。label は学生にも見せる短い名前（「クリアの条件」として並べる）、
 * text は AI が判定に使う詳しい内容で、学生には見せない。text が空なら label で判定する。
 * optional は発展の制約で、判定はするがクリアには数えない
 */
export type CodeConstraint = { label: string; text: string; optional?: boolean }

export const CONSTRAINT_KINDS = ['required', 'optional'] as const

type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]

export const CONSTRAINT_KIND_LABELS: Record<ConstraintKind, string> = { required: '必須', optional: '発展' }

export const MAX_CONSTRAINTS = 30
export const MAX_CONSTRAINT_LABEL_LENGTH = 60
export const MAX_CONSTRAINT_LENGTH = 300

/** 学生に見せるクリアの条件。制約のうち、ラベルと、発展かどうかだけを持つ */
export type Goal = { label: string; optional: boolean }

export const goalsOf = (constraints: readonly CodeConstraint[]): Goal[] =>
  constraints.map(({ label, optional }) => ({ label, optional: !!optional }))

/** AI に渡す制約の書き方。内容があれば、ラベルと内容を並べる */
export const describeConstraint = ({ label, text }: CodeConstraint) => (text ? `${label}（${text}）` : label)

export const VERDICTS = ['pass', 'partial', 'fail'] as const

export type Verdict = (typeof VERDICTS)[number]

export const isVerdict = (s: unknown): s is Verdict => (VERDICTS as readonly unknown[]).includes(s)

export const VERDICT_LABELS: Record<Verdict, string> = { pass: 'できている', partial: '一部できている', fail: 'できていない' }

/**
 * 提出 1 つの、制約 1 つへの判定。label と text は判定したときの制約の写しで、
 * あとから制約が書き換えられても、学生と教師にはこの提出を判定した観点のまま見せる
 */
export type ConstraintResult = CodeConstraint & {
  verdict: Verdict
  reason: string
  /** 判定の確からしさ（0〜1）。判定だけを返すモデルで最初に判定したときに入る（判定し直した制約では、最初の判定の確からしさ） */
  confidence?: number
  /** 教師に確かめてほしい判定。最初の判定に自信がなく、判定し直したら違う判定になったもの。教師が判定を変えると消える */
  review?: true
  /** 判定の根拠になった、提出したコードの一部。提出の中にあることを確かめたものだけが入る */
  evidence?: Evidence
  /** 教師が判定を変えたときの、AI の元の判定 */
  aiVerdict?: Verdict
}

/** 判定の根拠。line は file の中で quote が始まる行（1 から数える） */
export type Evidence = { file: CodeFileKey; line: number; quote: string }

/** 制約ごとの判定をするもの。llm は文章を作る AI（理由と講評も書く）、jev は判定だけを返す Jev */
export const JUDGES = ['llm', 'jev'] as const

export type Judge = (typeof JUDGES)[number]

export const isJudge = (s: unknown): s is Judge => (JUDGES as readonly unknown[]).includes(s)

export const JUDGE_LABELS: Record<Judge, string> = { llm: 'AI', jev: 'Jev' }

/**
 * 問題の確定と準備の段階。draft は確定する前、preparing は確定して AI が判定の基準を書いている途中、ready は準備が終わったもの、failed は準備に失敗したもの。
 * 確定したあと（draft 以外）は、問題文・制約・最初のコードなど判定に関わる設定を変えられない
 */
export const CODE_STAGES = ['draft', 'preparing', 'ready', 'failed'] as const

/** null は確定の仕組みより前に作ったアイテムで、確定しなくても学生が解け、設定も変えられる */
export type CodeStage = (typeof CODE_STAGES)[number] | null

export const CODE_STAGE_LABELS: Record<NonNullable<CodeStage>, string> = {
  draft: '確定前',
  preparing: '準備中',
  ready: '準備完了',
  failed: '準備に失敗',
}

/** 学生が解ける（エディターを開いて提出できる） */
export const isSolvable = (stage: CodeStage) => stage === null || stage === 'ready'

/** 確定していて、判定に関わる設定（問題文・制約・教師の補足・最初のコード・解答例・標準入力）を変えられない */
export const isFinalized = (stage: CodeStage) => stage !== null && stage !== 'draft'

/** 必須の制約と発展の制約それぞれの、判定の数（total）と、そのうちできている（pass）の数（passed） */
export function verdictCounts(verdicts: readonly ConstraintResult[]) {
  const count = (list: readonly ConstraintResult[]) => ({ passed: list.filter((v) => v.verdict === 'pass').length, total: list.length })
  return { required: count(verdicts.filter((v) => !v.optional)), optional: count(verdicts.filter((v) => v.optional)) }
}

/** 必須の制約がすべてできている。発展の制約は数えない。制約のない提出（判定がない）はクリアにしない */
export function isCleared(verdicts: readonly ConstraintResult[] | null): boolean {
  const { required } = verdictCounts(verdicts ?? [])
  return required.total > 0 && required.passed === required.total
}

/** 提出の期間の長さの上限（秒）。提出のたびに AI の利用料がかかるので、受け付ける時間を区切る */
export const MAX_SUBMIT_PERIOD = 7 * 24 * 60 * 60

/** これ以上の長さの提出の期間は、編集画面と学生の画面で、長いことが分かるように出す */
export const LONG_SUBMIT_PERIOD = 24 * 60 * 60

/** 期間の長さの表示（「45 分」「5 時間 30 分」「2 日 3 時間」）。分の端数は切り捨てる */
export function formatPeriodLength(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const parts = [
    { value: Math.floor(minutes / (24 * 60)), unit: '日' },
    { value: Math.floor(minutes / 60) % 24, unit: '時間' },
    { value: minutes % 60, unit: '分' },
  ].filter((p) => p.value > 0)
  return parts.length ? parts.map((p) => `${p.value} ${p.unit}`).join(' ') : '0 分'
}

/** 学生が提出できる期間。どちらかが null なら、まだ決まっていない */
export type SubmitPeriod = { opensAt: number | null; closesAt: number | null }

/** 提出の受付の状態。unset は期間が決まっていない */
export type SubmitState = 'unset' | 'upcoming' | 'open' | 'closed'

/** period が null（期間を設けないモード。Moodle モード）なら、いつでも受け付ける */
export function submitStateOf(period: SubmitPeriod | null, now = Math.floor(Date.now() / 1000)): SubmitState {
  if (!period) return 'open'
  if (period.opensAt == null || period.closesAt == null) return 'unset'
  return now < period.opensAt ? 'upcoming' : now >= period.closesAt ? 'closed' : 'open'
}

/**
 * 学生に見せる解答例。教師が見せると決めていて、提出の期間が終わったあとだけ返す。
 * 期間を設けないモードで見せないのは、提出の受付が終わらず、解答例を見てから提出できてしまうため
 */
export const publicSolutionOf = (
  { language, solution, solutionPublic }: { language: CodeLanguage; solution: CodeFiles; solutionPublic: boolean },
  period: SubmitPeriod | null,
): CodeFiles | null =>
  solutionPublic && hasCode(solution) && period !== null && submitStateOf(period) === 'closed' ? filesFor(language, solution) : null

/** 判定を待っている提出の、前にある提出の数の表示 */
export const aheadText = (ahead: number) => (ahead > 0 ? `（前に ${ahead} 件の提出が待っています）` : '')

/** 残りの秒数の表示（「42 秒」「15 分」「2 時間 5 分」）。1 分以上は分の端数を切り上げる */
export function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} 時間 ${minutes % 60} 分` : `${hours} 時間`
}

export const CODE_FILE_KEYS = ['html', 'css', 'js', 'py'] as const

export type CodeFileKey = (typeof CODE_FILE_KEYS)[number]

export type CodeFiles = Partial<Record<CodeFileKey, string>>

type CodeFileSpec = { key: CodeFileKey; name: string; label: string }

export const CODE_FILES: Record<CodeLanguage, readonly CodeFileSpec[]> = {
  web: [
    { key: 'html', name: 'index.html', label: 'HTML' },
    { key: 'css', name: 'style.css', label: 'CSS' },
    { key: 'js', name: 'script.js', label: 'JavaScript' },
  ],
  python: [{ key: 'py', name: 'main.py', label: 'Python' }],
}

/** 1 ファイルの上限。UTF-8 で 1 文字 3 バイトになっても sandbox の上限（64KB）に収まる長さにしている */
export const MAX_CODE_LENGTH = 20_000
export const MAX_STDIN_LENGTH = 10_000

export const DEFAULT_STARTER: Record<CodeLanguage, CodeFiles> = {
  web: {
    html: `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>ページのタイトル</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>Hello</h1>

    <script src="script.js"></script>
  </body>
</html>
`,
    css: '',
    js: '',
  },
  python: { py: 'print("Hello")\n' },
}

/** その言語のファイルだけを取り出す。ないファイルは空にする */
export const filesFor = (language: CodeLanguage, files: CodeFiles): CodeFiles =>
  Object.fromEntries(CODE_FILES[language].map((f) => [f.key, files[f.key] ?? '']))

/** その言語のファイルの中身が、どれも同じ */
export const sameFiles = (language: CodeLanguage, a: CodeFiles, b: CodeFiles) =>
  CODE_FILES[language].every((f) => (a[f.key] ?? '') === (b[f.key] ?? ''))

/** どれかのファイルに中身がある */
export const hasCode = (files: CodeFiles) => Object.values(files).some((code) => !!code?.trim())

/** 学生が判定の確認を教師に頼んだ状態。open は教師がまだ見ていない、closed は教師が確認した */
type AppealState = 'none' | 'open' | 'closed'

export const appealStateOf = (s: { appealedAt: number | null; appealClosedAt: number | null }): AppealState =>
  s.appealedAt == null ? 'none' : s.appealClosedAt == null ? 'open' : 'closed'

const PREVIEW_SOURCE = 'step-learn-preview'

type PreviewLevel = 'log' | 'warn' | 'error'

export type PreviewMessage = { source: typeof PREVIEW_SOURCE; level: PreviewLevel; text: string }

export const isPreviewMessage = (v: unknown): v is PreviewMessage => {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return m.source === PREVIEW_SOURCE && typeof m.text === 'string' && (m.level === 'log' || m.level === 'warn' || m.level === 'error')
}

const CONSOLE_BRIDGE = `<script>
(() => {
  const format = (v) => {
    if (typeof v === 'string') return v
    if (v instanceof Error) return String(v)
    try {
      return JSON.stringify(v) ?? String(v)
    } catch {
      return String(v)
    }
  }
  const send = (level, args) => parent.postMessage({ source: '${PREVIEW_SOURCE}', level, text: args.map(format).join(' ') }, '*')
  for (const [name, level] of [['log', 'log'], ['info', 'log'], ['debug', 'log'], ['warn', 'warn'], ['error', 'error']]) {
    const original = console[name]
    console[name] = (...args) => {
      send(level, args)
      original.apply(console, args)
    }
  }
  addEventListener('error', (e) => send('error', [e.message]))
  addEventListener('unhandledrejection', (e) => send('error', [e.reason]))
})()
</script>`

const escapeClosing = (code: string, tag: 'style' | 'script') => code.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1')

const insertAt = (doc: string, index: number, part: string) => doc.slice(0, index) + part + doc.slice(index)

/**
 * HTML・CSS・JavaScript を、プレビューの iframe の srcdoc に入れる 1 つの文書にまとめる。
 * HTML が style.css・script.js を読み込んでいればその位置に、読み込んでいなければ head の先頭と body の末尾に埋め込む
 */
export function buildWebDocument({ html = '', css = '', js = '' }: CodeFiles) {
  const style = `<style>${escapeClosing(css, 'style')}</style>`
  const script = `<script>${escapeClosing(js, 'script')}</script>`
  let linkedCss = false
  let linkedJs = false
  // 置き換える文字列をそのまま渡さないのは、コードの中の $& などが置換のパターンとして解釈されるため
  // 属性まで 1 つの正規表現で照合せず `>` も必須にしないのは、`>` のない入力で開始位置ごとに末尾まで走査し直し、サーバーの描画が止まるため
  let doc = html
    .replace(/<link\b[^>]*>?/gi, (tag) => {
      if (!tag.endsWith('>') || !/\bhref=(["'])(?:\.\/)?style\.css\1/i.test(tag)) return tag
      linkedCss = true
      return style
    })
    .replace(/<script\b[^>]*(>\s*<\/script>)?/gi, (tag, closing: string | undefined) => {
      if (!closing || !/\bsrc=(["'])(?:\.\/)?script\.js\1/i.test(tag)) return tag
      linkedJs = true
      return script
    })
  if (!linkedJs && js.trim()) {
    const body = doc.search(/<\/body>/i)
    doc = body < 0 ? doc + script : insertAt(doc, body, script)
  }
  const head = CONSOLE_BRIDGE + (!linkedCss && css.trim() ? style : '')
  // 先頭に置かないのは、DOCTYPE の前に要素があると後方互換モードで描かれ、学生の CSS の効き方が変わるため
  const opening = /<head\b[^>]*>/i.exec(doc) ?? /<html\b[^>]*>/i.exec(doc) ?? /<!doctype[^>]*>/i.exec(doc)
  return opening ? insertAt(doc, opening.index + opening[0].length, head) : head + doc
}
