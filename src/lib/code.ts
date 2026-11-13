// サーバーと code-editor.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

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
 * text は AI が判定に使う詳しい内容で、学生には見せない。text が空なら label で判定する
 */
export type CodeConstraint = { label: string; text: string }

export const MAX_CONSTRAINTS = 30
export const MAX_CONSTRAINT_LABEL_LENGTH = 60
export const MAX_CONSTRAINT_LENGTH = 300

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
  /** 判定の確からしさ（0〜1）。判定だけを返すモデル（Jev）で判定したときだけ入る */
  confidence?: number
}

/** 制約ごとの判定をするもの。llm は文章を作る AI（理由と講評も書く）、jev は判定だけを返す Jev */
export const JUDGES = ['llm', 'jev'] as const

export type Judge = (typeof JUDGES)[number]

export const isJudge = (s: unknown): s is Judge => (JUDGES as readonly unknown[]).includes(s)

export const JUDGE_LABELS: Record<Judge, string> = { llm: 'AI（DeepSeek）', jev: 'Jev' }

/** 判定のうち、できている（pass）の数 */
export const clearedCount = (verdicts: readonly ConstraintResult[]) => verdicts.filter((v) => v.verdict === 'pass').length

/** すべての制約ができている。制約のない提出（判定がない）はクリアにしない */
export const isCleared = (verdicts: readonly ConstraintResult[] | null): boolean =>
  !!verdicts?.length && clearedCount(verdicts) === verdicts.length

/** 提出の期間の長さの上限（秒）。提出のたびに AI の利用料がかかるので、受け付ける時間を区切る */
export const MAX_SUBMIT_PERIOD = 24 * 60 * 60

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

export type CodeFileSpec = { key: CodeFileKey; name: string; label: string }

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

export const PREVIEW_SOURCE = 'step-learn-preview'

export type PreviewLevel = 'log' | 'warn' | 'error'

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
