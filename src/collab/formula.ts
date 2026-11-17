// 表計算の計算式（= で始まるセル）の読み取りと計算。Excel の書き方と関数の一部に合わせる

export type CellError = { error: string }
export type Scalar = number | string | boolean | CellError | null
type Range = { range: Scalar[][] }
type Value = Scalar | Range

export const isError = (v: unknown): v is CellError => typeof v === 'object' && v !== null && 'error' in v

const err = (code: string): CellError => ({ error: code })
const DIV0 = err('#DIV/0!')
const VALUE = err('#VALUE!')
const REF = err('#REF!')
const NAME = err('#NAME?')
const NA = err('#N/A')
const NUM = err('#NUM!')
export const CYCLE = err('#CYCLE!')

// ---------------------------------------------------------------- 列の名前と参照

export function colName(c: number) {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function colIndex(name: string) {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`

export function parseCellName(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim())
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null
}

// ---------------------------------------------------------------- 字句

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; sheet: string | null; text: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'err'; v: string }

const REF_PART = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`
const SHEET_PART = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_぀-ヿ㐀-鿿][\w.぀-ヿ㐀-鿿]*))!`
const TOKEN = new RegExp(
  [
    String.raw`(?<space>\s+)`,
    String.raw`(?<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)`,
    String.raw`(?<str>"(?:[^"]|"")*")`,
    String.raw`(?<ref>(?:${SHEET_PART})?${REF_PART}(?::${REF_PART})?)(?![\w(])`,
    String.raw`(?<err>#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|CYCLE!))`,
    String.raw`(?<name>[A-Za-z_][\w.]*)`,
    String.raw`(?<op><>|<=|>=|[-+*/^&=<>(),:%;])`,
  ].join('|'),
  'y',
)

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < src.length) {
    const m = TOKEN.exec(src)
    if (!m?.groups) return null
    const g = m.groups
    if (g.space) continue
    if (g.num) tokens.push({ t: 'num', v: Number(g.num) })
    else if (g.str) tokens.push({ t: 'str', v: g.str.slice(1, -1).replace(/""/g, '"') })
    else if (g.ref) {
      const bang = g.ref.lastIndexOf('!')
      const sheet = bang < 0 ? null : (m[5] ?? m[6] ?? '').replace(/''/g, "'")
      tokens.push({ t: 'ref', sheet, text: g.ref.slice(bang + 1) })
    } else if (g.err) tokens.push({ t: 'err', v: g.err })
    else if (g.name) {
      const upper = g.name.toUpperCase()
      tokens.push(upper === 'TRUE' || upper === 'FALSE' ? { t: 'bool', v: upper === 'TRUE' } : { t: 'name', v: upper })
    } else if (g.op) tokens.push({ t: 'op', v: g.op === ';' ? ',' : g.op })
  }
  return tokens
}

// ---------------------------------------------------------------- 構文

type Node =
  | { k: 'lit'; v: Scalar }
  | { k: 'ref'; sheet: string | null; r1: number; c1: number; r2: number; c2: number; range: boolean }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'pct'; a: Node }
  | { k: 'call'; name: string; args: Node[] }

function refNode(sheet: string | null, text: string): Node {
  const [a, b] = text.split(':')
  const p = parseCellName(a)!
  const q = b ? parseCellName(b)! : p
  return {
    k: 'ref',
    sheet,
    r1: Math.min(p.r, q.r),
    c1: Math.min(p.c, q.c),
    r2: Math.max(p.r, q.r),
    c2: Math.max(p.c, q.c),
    range: !!b,
  }
}

function parse(tokens: Token[]): Node | null {
  let i = 0
  const peek = () => tokens[i]
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v
  const take = () => tokens[i++]

  function binary(next: () => Node, ops: string[]): Node {
    let left = next()
    while (peek()?.t === 'op' && ops.includes((peek() as { v: string }).v)) {
      const op = (take() as { v: string }).v
      left = { k: 'bin', op, a: left, b: next() }
    }
    return left
  }
  const comparison = (): Node => binary(concat, ['=', '<>', '<', '>', '<=', '>='])
  const concat = (): Node => binary(additive, ['&'])
  const additive = (): Node => binary(term, ['+', '-'])
  const term = (): Node => binary(power, ['*', '/'])
  const power = (): Node => binary(unary, ['^'])
  function unary(): Node {
    if (isOp('-') || isOp('+')) {
      const op = (take() as { v: string }).v
      return { k: 'un', op, a: unary() }
    }
    let node = primary()
    while (isOp('%')) {
      take()
      node = { k: 'pct', a: node }
    }
    return node
  }
  function primary(): Node {
    const tok = take()
    if (!tok) throw new Error('end')
    switch (tok.t) {
      case 'num':
        return { k: 'lit', v: tok.v }
      case 'str':
        return { k: 'lit', v: tok.v }
      case 'bool':
        return { k: 'lit', v: tok.v }
      case 'err':
        return { k: 'lit', v: err(tok.v) }
      case 'ref':
        return refNode(tok.sheet, tok.text)
      case 'name': {
        if (!isOp('(')) return { k: 'lit', v: NAME }
        take()
        const args: Node[] = []
        if (!isOp(')')) {
          for (;;) {
            args.push(isOp(',') || isOp(')') ? { k: 'lit', v: null } : comparison())
            if (isOp(',')) {
              take()
              continue
            }
            break
          }
        }
        if (!isOp(')')) throw new Error('paren')
        take()
        return { k: 'call', name: tok.v, args }
      }
      case 'op':
        if (tok.v === '(') {
          const inner = comparison()
          if (!isOp(')')) throw new Error('paren')
          take()
          return inner
        }
    }
    throw new Error('token')
  }
  try {
    const node = comparison()
    return i === tokens.length ? node : null
  } catch {
    return null
  }
}

const parsed = new Map<string, Node | null>()

function compile(formula: string) {
  let node = parsed.get(formula)
  if (node === undefined) {
    const tokens = tokenize(formula)
    node = tokens && parse(tokens)
    if (parsed.size > 5_000) parsed.clear()
    parsed.set(formula, node)
  }
  return node
}

// ---------------------------------------------------------------- 値の変換

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const DAY = 86_400_000

/** 日付（年・月・日）を Excel のシリアル値にする */
export const dateSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY

export function serialDate(serial: number) {
  const d = new Date(EXCEL_EPOCH + Math.round(serial * DAY))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() }
}

const DATE_INPUT = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

/** 入力された文字（計算式でないもの）の値。数・日付・真偽値として読めなければ文字のまま */
export function literalValue(raw: string): Scalar {
  const s = raw.trim()
  if (s === '') return null
  const num = /^([+-]?)[¥$]?([\d,]*\.?\d+(?:[eE][+-]?\d+)?)(%?)$/.exec(s)
  if (num && /^\d{1,3}(,\d{3})*(\.\d+)?$|^[\d.]+(?:[eE][+-]?\d+)?$/.test(num[2])) {
    const n = Number(num[2].replace(/,/g, '')) * (num[1] === '-' ? -1 : 1)
    return num[3] ? n / 100 : n
  }
  const date = DATE_INPUT.exec(s)
  if (date) return dateSerial(Number(date[1]), Number(date[2]), Number(date[3]))
  const upper = s.toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') return upper === 'TRUE'
  return raw
}

export const isDateInput = (raw: string) => DATE_INPUT.test(raw.trim())

function toNumber(v: Scalar): number | CellError {
  if (isError(v)) return v
  if (v === null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const lit = literalValue(v)
  return typeof lit === 'number' ? lit : VALUE
}

function toText(v: Scalar): string | CellError {
  if (isError(v)) return v
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return formatGeneral(v)
  return v
}

function toBool(v: Scalar): boolean | CellError {
  if (isError(v)) return v
  if (typeof v === 'string') {
    const upper = v.toUpperCase()
    return upper === 'TRUE' ? true : upper === 'FALSE' ? false : VALUE
  }
  return !!v
}

export function formatGeneral(n: number) {
  if (!Number.isFinite(n)) return '#NUM!'
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const fixed = Number(n.toPrecision(11))
  return Math.abs(fixed) >= 1e11 || (Math.abs(fixed) < 1e-9 && fixed !== 0) ? fixed.toExponential(5).replace(/\.?0+e/, 'e') : String(fixed)
}

// ---------------------------------------------------------------- 計算

export type Lookup = {
  /** そのシートのセルの値。シートがなければ undefined */
  cell: (sheet: string | null, r: number, c: number) => Scalar | undefined
  /** そのシートが使っている大きさ（範囲の参照を切り詰める） */
  size: (sheet: string | null) => { rows: number; cols: number } | undefined
}

const scalarOf = (v: Value): Scalar => (v !== null && typeof v === 'object' && 'range' in v ? (v.range[0]?.[0] ?? null) : v)

const flat = (args: Value[]): Scalar[] => args.flatMap((a) => (a !== null && typeof a === 'object' && 'range' in a ? a.range.flat() : [a]))

/** 範囲の中の数（文字や空は数えない）。直接書いた引数は数に直す */
function numbers(args: Value[]): number[] | CellError {
  const out: number[] = []
  for (const a of args) {
    if (a !== null && typeof a === 'object' && 'range' in a) {
      for (const v of a.range.flat()) {
        if (isError(v)) return v
        if (typeof v === 'number') out.push(v)
      }
    } else {
      const n = toNumber(a)
      if (isError(n)) return n
      out.push(n)
    }
  }
  return out
}

const plain = (v: Scalar) => (v === null || isError(v) ? '' : String(v))

function criterion(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v === c
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(plain(c))!
  const op = m[1] ?? '='
  const target = literalValue(m[2])
  const wildcard = typeof target === 'string' && /[*?]/.test(target)
  const pattern = wildcard
    ? new RegExp(
        `^${target
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'i',
      )
    : null
  return (v) => {
    if (pattern) return op === '<>' ? !pattern.test(plain(v)) : pattern.test(plain(v))
    if (typeof target === 'number') {
      if (typeof v !== 'number') return op === '<>'
      return op === '='
        ? v === target
        : op === '<>'
          ? v !== target
          : op === '<'
            ? v < target
            : op === '>'
              ? v > target
              : op === '<='
                ? v <= target
                : v >= target
    }
    const a = plain(v).toLowerCase()
    const b = plain(target).toLowerCase()
    return op === '<>' ? a !== b : op === '=' ? a === b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b
  }
}

const rangeOf = (v: Value): Scalar[][] => (v !== null && typeof v === 'object' && 'range' in v ? v.range : [[v as Scalar]])

function round(n: number, digits: number, mode: 'round' | 'up' | 'down') {
  const f = 10 ** digits
  const x = Math.abs(n) * f
  const r = mode === 'round' ? Math.round(x + 1e-9) : mode === 'up' ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9)
  return (Math.sign(n) * r) / f
}

function compareValues(a: Scalar, b: Scalar) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'ja', { sensitivity: 'base' })
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2)
  return rank(a) - rank(b)
}

type Fn = (args: Value[], raw: Node[], ev: (n: Node) => Value) => Value

const num1 =
  (f: (n: number) => number | CellError): Fn =>
  (args) => {
    const n = toNumber(scalarOf(args[0] ?? null))
    return isError(n) ? n : f(n)
  }

const text1 =
  (f: (s: string) => Value): Fn =>
  (args) => {
    const s = toText(scalarOf(args[0] ?? null))
    return isError(s) ? s : f(s)
  }

const aggregate =
  (f: (ns: number[]) => number | CellError): Fn =>
  (args) => {
    const ns = numbers(args)
    return isError(ns) ? ns : f(ns)
  }

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

function conditional(args: Value[], f: (ns: number[]) => number | CellError) {
  const test = criterion(scalarOf(args[1] ?? null))
  const cells = rangeOf(args[0] ?? null)
  const values = args[2] === undefined ? cells : rangeOf(args[2])
  const picked: number[] = []
  cells.forEach((row, r) => row.forEach((v, c) => test(v) && typeof values[r]?.[c] === 'number' && picked.push(values[r][c] as number)))
  return f(picked)
}

function lookup(args: Value[], vertical: boolean): Value {
  const key = scalarOf(args[0] ?? null)
  const table = rangeOf(args[1] ?? null)
  const index = toNumber(scalarOf(args[2] ?? null))
  if (isError(index)) return index
  const approximate = args[3] === undefined ? true : toBool(scalarOf(args[3]))
  if (isError(approximate)) return approximate
  const lines = vertical ? table : (table[0] ?? []).map((_, c) => table.map((row) => row[c]))
  let found = -1
  for (let i = 0; i < lines.length; i++) {
    const cmp = compareValues(lines[i][0], key)
    if (cmp === 0) {
      found = i
      break
    }
    if (approximate && cmp < 0) found = i
    if (approximate && cmp > 0) break
  }
  if (found < 0) return NA
  const v = lines[found][Math.trunc(index) - 1]
  return v === undefined ? REF : v
}

const FUNCTIONS: Record<string, Fn> = {
  SUM: aggregate(sum),
  AVERAGE: aggregate((ns) => (ns.length ? sum(ns) / ns.length : DIV0)),
  MIN: aggregate((ns) => (ns.length ? Math.min(...ns) : 0)),
  MAX: aggregate((ns) => (ns.length ? Math.max(...ns) : 0)),
  PRODUCT: aggregate((ns) => ns.reduce((a, b) => a * b, 1)),
  MEDIAN: aggregate((ns) => {
    if (!ns.length) return NUM
    const s = [...ns].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }),
  STDEV: aggregate((ns) => {
    if (ns.length < 2) return DIV0
    const mean = sum(ns) / ns.length
    return Math.sqrt(sum(ns.map((n) => (n - mean) ** 2)) / (ns.length - 1))
  }),
  COUNT: (args) => flat(args).filter((v) => typeof v === 'number').length,
  COUNTA: (args) => flat(args).filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (args) => flat(args).filter((v) => v === null || v === '').length,
  SUMIF: (args) => conditional(args, sum),
  COUNTIF: (args) => {
    const test = criterion(scalarOf(args[1] ?? null))
    return rangeOf(args[0] ?? null)
      .flat()
      .filter(test).length
  },
  AVERAGEIF: (args) => conditional(args, (ns) => (ns.length ? sum(ns) / ns.length : DIV0)),
  IF: (_args, raw, ev) => {
    const cond = toBool(scalarOf(ev(raw[0] ?? { k: 'lit', v: false })))
    if (isError(cond)) return cond
    const branch = cond ? raw[1] : raw[2]
    return branch ? scalarOf(ev(branch)) : cond
  },
  IFERROR: (_args, raw, ev) => {
    const v = scalarOf(ev(raw[0] ?? { k: 'lit', v: null }))
    return isError(v) ? scalarOf(ev(raw[1] ?? { k: 'lit', v: '' })) : v
  },
  AND: (args) => {
    for (const v of flat(args)) {
      const b = toBool(v)
      if (isError(b)) return b
      if (!b) return false
    }
    return true
  },
  OR: (args) => flat(args).some((v) => toBool(v) === true),
  NOT: (args) => {
    const b = toBool(scalarOf(args[0] ?? null))
    return isError(b) ? b : !b
  },
  ROUND: (args) => {
    const n = toNumber(scalarOf(args[0] ?? null))
    const d = toNumber(scalarOf(args[1] ?? 0))
    return isError(n) ? n : isError(d) ? d : round(n, Math.trunc(d), 'round')
  },
  ROUNDUP: (args) => {
    const n = toNumber(scalarOf(args[0] ?? null))
    const d = toNumber(scalarOf(args[1] ?? 0))
    return isError(n) ? n : isError(d) ? d : round(n, Math.trunc(d), 'up')
  },
  ROUNDDOWN: (args) => {
    const n = toNumber(scalarOf(args[0] ?? null))
    const d = toNumber(scalarOf(args[1] ?? 0))
    return isError(n) ? n : isError(d) ? d : round(n, Math.trunc(d), 'down')
  },
  INT: num1(Math.floor),
  ABS: num1(Math.abs),
  SQRT: num1((n) => (n < 0 ? NUM : Math.sqrt(n))),
  POWER: (args) => {
    const a = toNumber(scalarOf(args[0] ?? null))
    const b = toNumber(scalarOf(args[1] ?? null))
    return isError(a) ? a : isError(b) ? b : a ** b
  },
  MOD: (args) => {
    const a = toNumber(scalarOf(args[0] ?? null))
    const b = toNumber(scalarOf(args[1] ?? null))
    if (isError(a)) return a
    if (isError(b)) return b
    return b === 0 ? DIV0 : a - b * Math.floor(a / b)
  },
  PI: () => Math.PI,
  TODAY: () => {
    const now = new Date()
    return dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate())
  },
  NOW: () => (Date.now() - new Date().getTimezoneOffset() * 60_000 - EXCEL_EPOCH) / DAY,
  DATE: (args) => {
    const [y, m, d] = [0, 1, 2].map((i) => toNumber(scalarOf(args[i] ?? null)))
    for (const v of [y, m, d]) if (isError(v)) return v
    return dateSerial(y as number, m as number, d as number)
  },
  YEAR: num1((n) => serialDate(n).y),
  MONTH: num1((n) => serialDate(n).m),
  DAY: num1((n) => serialDate(n).d),
  LEN: text1((s) => [...s].length),
  LEFT: (args) => {
    const s = toText(scalarOf(args[0] ?? null))
    const n = toNumber(scalarOf(args[1] ?? 1))
    return isError(s) ? s : isError(n) ? n : [...s].slice(0, Math.max(0, n)).join('')
  },
  RIGHT: (args) => {
    const s = toText(scalarOf(args[0] ?? null))
    const n = toNumber(scalarOf(args[1] ?? 1))
    return isError(s) ? s : isError(n) ? n : n <= 0 ? '' : [...s].slice(-n).join('')
  },
  MID: (args) => {
    const s = toText(scalarOf(args[0] ?? null))
    const start = toNumber(scalarOf(args[1] ?? null))
    const n = toNumber(scalarOf(args[2] ?? null))
    if (isError(s)) return s
    if (isError(start)) return start
    if (isError(n)) return n
    return [...s].slice(start - 1, start - 1 + n).join('')
  },
  UPPER: text1((s) => s.toUpperCase()),
  LOWER: text1((s) => s.toLowerCase()),
  TRIM: text1((s) => s.trim().replace(/\s+/g, ' ')),
  CONCAT: (args) => {
    let out = ''
    for (const v of flat(args)) {
      const s = toText(v)
      if (isError(s)) return s
      out += s
    }
    return out
  },
  VALUE: (args) => toNumber(scalarOf(args[0] ?? null)),
  VLOOKUP: (args) => lookup(args, true),
  HLOOKUP: (args) => lookup(args, false),
  INDEX: (args) => {
    const table = rangeOf(args[0] ?? null)
    const r = toNumber(scalarOf(args[1] ?? 1))
    const c = toNumber(scalarOf(args[2] ?? 1))
    if (isError(r)) return r
    if (isError(c)) return c
    const v = table[Math.max(1, r) - 1]?.[Math.max(1, c) - 1]
    return v === undefined ? REF : v
  },
  MATCH: (args) => {
    const key = scalarOf(args[0] ?? null)
    const list = rangeOf(args[1] ?? null).flat()
    const i = list.findIndex((v) => compareValues(v, key) === 0)
    return i < 0 ? NA : i + 1
  },
}
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT

/** 使える関数の名前（入力の補助に出す） */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort()

const MAX_RANGE_CELLS = 200_000

function evaluate(node: Node, look: Lookup): Value {
  const ev = (n: Node) => evaluate(n, look)
  switch (node.k) {
    case 'lit':
      return node.v
    case 'ref': {
      const size = look.size(node.sheet)
      if (!size) return REF
      if (!node.range) return look.cell(node.sheet, node.r1, node.c1) ?? null
      const r2 = Math.min(node.r2, size.rows - 1)
      const c2 = Math.min(node.c2, size.cols - 1)
      if ((r2 - node.r1 + 1) * (c2 - node.c1 + 1) > MAX_RANGE_CELLS) return NUM
      const range: Scalar[][] = []
      for (let r = node.r1; r <= r2; r++) {
        const row: Scalar[] = []
        for (let c = node.c1; c <= c2; c++) row.push(look.cell(node.sheet, r, c) ?? null)
        range.push(row)
      }
      return { range }
    }
    case 'un': {
      const n = toNumber(scalarOf(ev(node.a)))
      return isError(n) ? n : node.op === '-' ? -n : n
    }
    case 'pct': {
      const n = toNumber(scalarOf(ev(node.a)))
      return isError(n) ? n : n / 100
    }
    case 'bin': {
      const a = scalarOf(ev(node.a))
      const b = scalarOf(ev(node.b))
      if (isError(a)) return a
      if (isError(b)) return b
      if (node.op === '&') return `${toText(a) as string}${toText(b) as string}`
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const cmp = compareValues(a ?? (typeof b === 'number' ? 0 : ''), b ?? (typeof a === 'number' ? 0 : ''))
        return node.op === '='
          ? cmp === 0
          : node.op === '<>'
            ? cmp !== 0
            : node.op === '<'
              ? cmp < 0
              : node.op === '>'
                ? cmp > 0
                : node.op === '<='
                  ? cmp <= 0
                  : cmp >= 0
      }
      const x = toNumber(a)
      const y = toNumber(b)
      if (isError(x)) return x
      if (isError(y)) return y
      if (node.op === '+') return x + y
      if (node.op === '-') return x - y
      if (node.op === '*') return x * y
      if (node.op === '/') return y === 0 ? DIV0 : x / y
      return x ** y
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) return NAME
      const lazy = node.name === 'IF' || node.name === 'IFERROR'
      const result = fn(lazy ? [] : node.args.map(ev), node.args, ev)
      return typeof result === 'number' && !Number.isFinite(result) ? NUM : result
    }
  }
}

/** 計算式（先頭の = を除いたもの）の値 */
export function evaluateFormula(formula: string, look: Lookup): Scalar {
  const node = compile(formula)
  if (!node) return err('#ERROR!')
  return scalarOf(evaluate(node, look))
}

// ---------------------------------------------------------------- 貼り付けで相対参照をずらす

/** 計算式を dr 行・dc 列だけ離れたセルに写したときの式。$ の付いていない行・列だけを動かし、はみ出す参照は #REF! にする */
export function moveFormula(formula: string, dr: number, dc: number) {
  return formula.replace(
    new RegExp(String.raw`("(?:[^"]|"")*")|((?:${SHEET_PART})?)(${REF_PART})(?::(${REF_PART}))?(?![\w(])`, 'g'),
    (match, str: string | undefined, prefix: string, _quoted: unknown, _bare: unknown, a: string, b: string | undefined) => {
      if (str) return match
      const moveOne = (ref: string) => {
        const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(ref)!
        const c = m[1] ? colIndex(m[2]) : colIndex(m[2]) + dc
        const r = m[3] ? Number(m[4]) - 1 : Number(m[4]) - 1 + dr
        return r < 0 || c < 0 ? null : `${m[1]}${colName(c)}${m[3]}${r + 1}`
      }
      const x = moveOne(a)
      const y = b ? moveOne(b) : ''
      if (x === null || y === null) return `${prefix}#REF!`
      return `${prefix}${x}${b ? `:${y}` : ''}`
    },
  )
}

// ---------------------------------------------------------------- 行と列の挿入・削除で参照をずらす

/**
 * 計算式の中の参照を、行（axis が row）か列の挿入・削除に合わせてずらす。at より後ろ（at を含む）を delta だけ動かし、
 * 削除で消えた位置を指す参照は #REF! にする。targetSheet は挿入・削除したシートの名前、ownSheet は計算式のあるシートの名前
 */
export function shiftFormula(formula: string, axis: 'row' | 'col', at: number, delta: number, targetSheet: string, ownSheet: string) {
  return formula.replace(
    new RegExp(String.raw`("(?:[^"]|"")*")|((?:${SHEET_PART})?)(${REF_PART})(?::(${REF_PART}))?(?![\w(])`, 'g'),
    (
      match,
      str: string | undefined,
      prefix: string,
      quoted: string | undefined,
      bare: string | undefined,
      a: string,
      b: string | undefined,
    ) => {
      if (str) return match
      const sheet = prefix ? (quoted ?? bare ?? '').replace(/''/g, "'") : ownSheet
      if (sheet !== targetSheet) return match
      const shiftOne = (ref: string) => {
        const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(ref)!
        let c = colIndex(m[2])
        let r = Number(m[4]) - 1
        const pos = axis === 'row' ? r : c
        if (delta < 0 && pos >= at && pos < at - delta) return null
        if (pos >= at) {
          if (axis === 'row') r += delta
          else c += delta
        }
        return `${m[1]}${colName(c)}${m[3]}${r + 1}`
      }
      const x = shiftOne(a)
      const y = b ? shiftOne(b) : ''
      if (x === null || y === null) return `${prefix}#REF!`
      return `${prefix}${x}${b ? `:${y}` : ''}`
    },
  )
}
