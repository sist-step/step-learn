// サーバーの handlers と client.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない
// 形を Moodle の availability の JSON に合わせるのは、Moodle モードではそのまま Moodle に渡し、通常モードでも同じ部品と判定を使うため
import { formatDateTimeInput, isDateTimeInput, dateTimeInputToUnix, unixToDateTimeInput } from './course-period'

export const RESTRICTION_OPS = ['&', '|', '!|', '!&'] as const
export type RestrictionOp = (typeof RESTRICTION_OPS)[number]

export const RESTRICTION_OP_LABELS: Record<RestrictionOp, string> = {
  '&': 'すべて満たす',
  '|': 'いずれかを満たす',
  '!|': 'どれも満たさない',
  '!&': 'すべては満たさない',
}

export const RESTRICTION_KINDS = ['date', 'completion', 'grade', 'profile'] as const
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number]

export const RESTRICTION_KIND_LABELS: Record<RestrictionKind | 'set', string> = {
  date: '日付',
  completion: 'アイテムの完了',
  grade: '評点',
  profile: 'ユーザープロフィール',
  set: '制限セット',
}

export const DATE_DIRECTIONS = ['>=', '<'] as const
export type DateDirection = (typeof DATE_DIRECTIONS)[number]
export const DATE_DIRECTION_LABELS: Record<DateDirection, string> = { '>=': '以降', '<': 'より前' }

/** 値は Moodle の COMPLETION_INCOMPLETE（0）・COMPLETE（1）・COMPLETE_PASS（2）・COMPLETE_FAIL（3） */
export const COMPLETION_EXPECTS = [1, 0, 2, 3] as const
export type CompletionExpect = (typeof COMPLETION_EXPECTS)[number]
export const COMPLETION_EXPECT_LABELS: Record<CompletionExpect, string> = {
  1: '完了している',
  0: '完了していない',
  2: '合格している',
  3: '不合格になっている',
}
export const isPassFail = (e: CompletionExpect) => e === 2 || e === 3

export const PROFILE_OPS = ['isequalto', 'contains', 'doesnotcontain', 'startswith', 'endswith', 'isempty', 'isnotempty'] as const
export type ProfileOp = (typeof PROFILE_OPS)[number]
export const PROFILE_OP_LABELS: Record<ProfileOp, string> = {
  isequalto: '次と一致する',
  contains: '次を含む',
  doesnotcontain: '次を含まない',
  startswith: '次で始まる',
  endswith: '次で終わる',
  isempty: '空である',
  isnotempty: '空でない',
}
export const profileOpTakesValue = (op: ProfileOp) => op !== 'isempty' && op !== 'isnotempty'

/** 完了の条件にできる「直前のアイテム」 */
export const PREVIOUS_ITEM = -1
export const MAX_RESTRICTION_CONDITIONS = 50
// 深さに上限を設けるのは、際限なく入れ子にした JSON で判定と描画の再帰を深くさせないため
export const MAX_RESTRICTION_DEPTH = 5
export const MAX_PROFILE_VALUE_LENGTH = 255
export const MAX_RESTRICTION_JSON_LENGTH = 100_000

/** k は編集画面の行の目印（入力のエラーを出す場所）。Moodle に渡す JSON には含めない */
export type DateCondition = { type: 'date'; d: DateDirection; t: number; k?: string }
export type CompletionCondition = { type: 'completion'; cm: number; e: CompletionExpect; k?: string }
/** min・max は評点の割合（%）。min 以上・max 未満 */
export type GradeCondition = { type: 'grade'; id: number; min?: number; max?: number; k?: string }
/** field は標準の項目なら `sf:<名前>`、Moodle の独自の項目なら `cf:<短縮名>` */
export type ProfileCondition = { type: 'profile'; field: string; op: ProfileOp; v: string; k?: string }
/** STEP Learn では編集しない Moodle の条件（グループなど）。raw は Moodle の JSON のまま */
export type OtherCondition = { type: 'other'; raw: Record<string, unknown>; k?: string }
export type RestrictionCondition = DateCondition | CompletionCondition | GradeCondition | ProfileCondition | OtherCondition
/** 制限セット。show・showc は一番上のセットだけが持つ（Moodle と同じく、& と !| は条件ごとの showc、| と !& は全体の show） */
export type RestrictionSet = { op: RestrictionOp; c: RestrictionNode[]; show?: boolean; showc?: boolean[]; k?: string }
export type RestrictionNode = RestrictionCondition | RestrictionSet

export const isSet = (n: RestrictionNode): n is RestrictionSet => !('type' in n)

/** 一番上のセットで、条件ごとに表示を選ぶ（目のアイコンが条件ごとに付く） */
export const showsEach = (op: RestrictionOp) => op === '&' || op === '!|'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isOp = (v: unknown): v is RestrictionOp => RESTRICTION_OPS.includes(v as RestrictionOp)
const isProfileOp = (v: unknown): v is ProfileOp => PROFILE_OPS.includes(v as ProfileOp)
const isExpect = (v: unknown): v is CompletionExpect => COMPLETION_EXPECTS.includes(v as CompletionExpect)
const isPercent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function readCondition(raw: Record<string, unknown>): RestrictionCondition | null {
  switch (raw.type) {
    case 'date':
      return (raw.d === '>=' || raw.d === '<') && Number.isSafeInteger(raw.t) ? { type: 'date', d: raw.d, t: raw.t as number } : null
    case 'completion':
      return Number.isSafeInteger(raw.cm) && isExpect(raw.e) ? { type: 'completion', cm: raw.cm as number, e: raw.e } : null
    case 'grade': {
      if (!Number.isSafeInteger(raw.id) || ('min' in raw && !isPercent(raw.min)) || ('max' in raw && !isPercent(raw.max))) return null
      return {
        type: 'grade',
        id: raw.id as number,
        ...(isPercent(raw.min) ? { min: raw.min } : {}),
        ...(isPercent(raw.max) ? { max: raw.max } : {}),
      }
    }
    case 'profile': {
      const field = typeof raw.sf === 'string' ? `sf:${raw.sf}` : typeof raw.cf === 'string' ? `cf:${raw.cf}` : null
      return field && isProfileOp(raw.op) ? { type: 'profile', field, op: raw.op, v: typeof raw.v === 'string' ? raw.v : '' } : null
    }
    default:
      return typeof raw.type === 'string' ? { type: 'other', raw } : null
  }
}

function readNode(raw: unknown, root: boolean, depth: number): RestrictionNode | null {
  if (!isRecord(raw)) return null
  if ('type' in raw) return readCondition(raw)
  if (!isOp(raw.op) || !Array.isArray(raw.c) || depth > MAX_RESTRICTION_DEPTH) return null
  const c: RestrictionNode[] = []
  for (const child of raw.c) {
    const node = readNode(child, false, depth + 1)
    if (!node) return null
    c.push(node)
  }
  if (!root) return { op: raw.op, c }
  if (showsEach(raw.op)) {
    const showc = Array.isArray(raw.showc) ? raw.showc : []
    return { op: raw.op, c, showc: c.map((_, i) => showc[i] !== false) }
  }
  return { op: raw.op, c, show: raw.show !== false }
}

/** Moodle の形の JSON を読む。空や読めないものは null（制限なし） */
export function parseRestriction(json: string | null | undefined): RestrictionSet | null {
  if (!json) return null
  try {
    const node = readNode(JSON.parse(json), true, 1)
    return node && isSet(node) && node.c.length > 0 ? node : null
  } catch {
    return null
  }
}

function writeNode(node: RestrictionNode, root: boolean): Record<string, unknown> {
  if (!isSet(node)) {
    switch (node.type) {
      case 'date':
        return { type: 'date', d: node.d, t: node.t }
      case 'completion':
        return { type: 'completion', cm: node.cm, e: node.e }
      case 'grade':
        return {
          type: 'grade',
          id: node.id,
          ...(node.min != null ? { min: node.min } : {}),
          ...(node.max != null ? { max: node.max } : {}),
        }
      case 'profile': {
        const [kind, name] = [node.field.slice(0, 2), node.field.slice(3)]
        return { type: 'profile', [kind === 'cf' ? 'cf' : 'sf']: name, op: node.op, ...(profileOpTakesValue(node.op) ? { v: node.v } : {}) }
      }
      case 'other':
        return node.raw
    }
  }
  const c = node.c.map((child) => writeNode(child, false))
  if (!root) return { op: node.op, c }
  return showsEach(node.op)
    ? { op: node.op, c, showc: node.c.map((_, i) => node.showc?.[i] !== false) }
    : { op: node.op, c, show: node.show !== false }
}

/** Moodle の形の JSON にする。条件がなければ null（制限なし） */
export const restrictionJson = (set: RestrictionSet | null) => (set && set.c.length > 0 ? JSON.stringify(writeNode(set, true)) : null)

export function conditionsOf(node: RestrictionNode): RestrictionCondition[] {
  return isSet(node) ? node.c.flatMap(conditionsOf) : [node]
}

// ---------------------------------------------------------------- 編集画面から送られた値

/** 編集画面（components/restriction.tsx）が送る JSON の行。日時は入力欄の値のまま、評点は入力された文字のまま送る */
export type RestrictionFormNode =
  | { k: string; type: 'date'; d: string; t: string }
  | { k: string; type: 'completion'; cm: string; e: string }
  | { k: string; type: 'grade'; id: string; min: string; max: string }
  | { k: string; type: 'profile'; field: string; op: string; v: string }
  | { k: string; type: 'other'; raw: Record<string, unknown> }
  | { k: string; op: string; c: RestrictionFormNode[]; show?: boolean; showc?: boolean[] }

export type RestrictionIssue = { key: string; message: string }

const parsePercent = (s: string) => {
  const t = s.trim()
  if (!t) return { value: undefined }
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 100 && /^\d+(\.\d+)?$/.test(t) ? { value: n } : null
}

const FORM_BROKEN = '条件を読み取れませんでした。ページを開き直してから、もう一度お試しください。'

/** 編集画面の値を読み、入力の誤りを行ごとに集める。issues の key は入力欄の name（`<k>.<項目>`）か availability */
export function readRestrictionForm(json: string): { set: RestrictionSet | null; issues: RestrictionIssue[] } {
  const issues: RestrictionIssue[] = []
  let count = 0
  const broken = () => ({ set: null, issues: [{ key: 'availability', message: FORM_BROKEN }] })

  const readLeaf = (raw: Record<string, unknown>): RestrictionCondition | null => {
    const k = typeof raw.k === 'string' ? raw.k : ''
    const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
    switch (raw.type) {
      case 'date': {
        const t = str('t').trim()
        if (!isDateTimeInput(t)) issues.push({ key: `${k}.t`, message: t ? '日時が正しくありません。' : '日時を選んでください。' })
        return { type: 'date', d: str('d') === '<' ? '<' : '>=', t: isDateTimeInput(t) ? dateTimeInputToUnix(t) : 0, k }
      }
      case 'completion': {
        const cm = Number(str('cm'))
        const e = Number(str('e'))
        if (!Number.isSafeInteger(cm) || !str('cm')) issues.push({ key: `${k}.cm`, message: 'アイテムを選んでください。' })
        return { type: 'completion', cm, e: isExpect(e) ? e : 1, k }
      }
      case 'grade': {
        const id = Number(str('id'))
        if (!Number.isSafeInteger(id) || !str('id')) issues.push({ key: `${k}.id`, message: 'アイテムを選んでください。' })
        const min = parsePercent(str('min'))
        const max = parsePercent(str('max'))
        if (!min) issues.push({ key: `${k}.min`, message: '0〜100 の数で入力してください。' })
        if (!max) issues.push({ key: `${k}.max`, message: '0〜100 の数で入力してください。' })
        if (min?.value != null && max?.value != null && max.value <= min.value)
          issues.push({ key: `${k}.max`, message: '「未満」は「以上」より大きい数にしてください。' })
        return {
          type: 'grade',
          id,
          ...(min?.value != null ? { min: min.value } : {}),
          ...(max?.value != null ? { max: max.value } : {}),
          k,
        }
      }
      case 'profile': {
        const op = isProfileOp(raw.op) ? raw.op : 'isequalto'
        const v = str('v').trim()
        if (profileOpTakesValue(op) && !v) issues.push({ key: `${k}.v`, message: '値を入力してください。' })
        if (v.length > MAX_PROFILE_VALUE_LENGTH)
          issues.push({ key: `${k}.v`, message: `値は${MAX_PROFILE_VALUE_LENGTH}文字以内で入力してください。` })
        return { type: 'profile', field: str('field'), op, v: profileOpTakesValue(op) ? v : '', k }
      }
      case 'other':
        return isRecord(raw.raw) && typeof raw.raw.type === 'string' ? { type: 'other', raw: raw.raw, k } : null
      default:
        return null
    }
  }

  const readSet = (raw: unknown, root: boolean, depth: number): RestrictionSet | null => {
    if (!isRecord(raw) || !isOp(raw.op) || !Array.isArray(raw.c) || depth > MAX_RESTRICTION_DEPTH) return null
    const c: RestrictionNode[] = []
    const showc: boolean[] = []
    for (const [i, child] of raw.c.entries()) {
      if (!isRecord(child)) return null
      const node = 'type' in child ? readLeaf(child) : readSet(child, false, depth + 1)
      if (!node) return null
      // 中身のない入れ子のセットを黙って除くのは、条件を足す前に保存しても、意味のない空のセットを残さないため
      if (isSet(node) && node.c.length === 0) continue
      if (!isSet(node)) count++
      c.push(node)
      showc.push(!Array.isArray(raw.showc) || raw.showc[i] !== false)
    }
    const k = typeof raw.k === 'string' ? raw.k : undefined
    if (!root) return { op: raw.op, c, k }
    return showsEach(raw.op) ? { op: raw.op, c, showc } : { op: raw.op, c, show: raw.show !== false }
  }

  if (json.length > MAX_RESTRICTION_JSON_LENGTH) return broken()
  let parsed: unknown
  try {
    parsed = json ? JSON.parse(json) : null
  } catch {
    return broken()
  }
  if (parsed === null) return { set: null, issues }
  const set = readSet(parsed, true, 1)
  if (!set) return broken()
  if (count > MAX_RESTRICTION_CONDITIONS)
    issues.push({ key: 'availability', message: `条件は${MAX_RESTRICTION_CONDITIONS}個までにしてください。` })
  return { set: set.c.length > 0 ? set : null, issues }
}

// ---------------------------------------------------------------- 選べるもの

export type RestrictionChoice = { id: number; label: string; meta?: string }

/** 編集画面で選べるものと、ほかの画面で条件を文にするときの名前 */
export type RestrictionChoices = {
  /** 足せる条件の種類 */
  kinds: RestrictionKind[]
  /** 種類を足せない理由（足せない種類だけ） */
  unavailable: Partial<Record<RestrictionKind, string>>
  /** 完了を条件にできるアイテム。passFail は合格・不合格も条件にできる */
  items: (RestrictionChoice & { passFail: boolean })[]
  /** 「直前のアイテム」を選べる */
  previous: boolean
  /** 評点を条件にできるもの */
  grades: RestrictionChoice[]
  /** プロフィールの項目。value は ProfileCondition の field */
  profile: { value: string; label: string }[]
  /** 編集しない条件（OtherCondition）の説明 */
  other?: (raw: Record<string, unknown>, not: boolean) => string
}

/** 保存する前に、選んだものが今も選べるかを確かめる。errors の key は入力欄の name */
export function checkRestrictionChoices(set: RestrictionSet, choices: RestrictionChoices, kept: RestrictionSet | null) {
  const errors: Partial<Record<string, string>> = {}
  const items = new Map(choices.items.map((it) => [it.id, it]))
  const grades = new Set(choices.grades.map((g) => g.id))
  const fields = new Set(choices.profile.map((p) => p.value))
  // 編集しない条件を自由に受け付けないのは、画面で足せないグループなどの条件を、送信を書き換えて足せてしまうため
  const others = new Set(kept ? conditionsOf(kept).flatMap((c) => (c.type === 'other' ? [JSON.stringify(c.raw)] : [])) : [])
  const kinds = new Set<string>(choices.kinds)
  for (const c of conditionsOf(set)) {
    const k = c.k ?? ''
    if (c.type !== 'other' && !kinds.has(c.type)) errors.availability ??= `${RESTRICTION_KIND_LABELS[c.type]}は条件にできません。`
    if (c.type === 'completion') {
      const item = items.get(c.cm)
      if (c.cm === PREVIOUS_ITEM ? !choices.previous : !item) errors[`${k}.cm`] = '選べないアイテムです。選び直してください。'
      else if (isPassFail(c.e) && item && !item.passFail) errors[`${k}.e`] = 'このアイテムでは合格・不合格を条件にできません。'
    }
    if (c.type === 'grade' && !grades.has(c.id)) errors[`${k}.id`] = '選べないアイテムです。選び直してください。'
    if (c.type === 'profile' && !fields.has(c.field)) errors[`${k}.field`] = '選べない項目です。選び直してください。'
    if (c.type === 'other' && !others.has(JSON.stringify(c.raw))) errors.availability ??= FORM_BROKEN
  }
  return errors
}

// ---------------------------------------------------------------- 判定（通常モード）

export type CompletionState = 'incomplete' | 'complete' | 'pass' | 'fail'

export type RestrictionEnv = {
  now: number
  /** アイテムの完了の状態。アイテムがなければ null */
  completion: (itemId: number) => CompletionState | null
  /** 評点の割合（%）。評点がなければ null */
  grade: (itemId: number) => number | null
  /** プロフィールの項目の値。項目がなければ null */
  profile: (field: string) => string | null
  /** 「直前のアイテム」の ID。なければ null */
  previous: number | null
}

function profileMatches(op: ProfileOp, value: string, expected: string) {
  switch (op) {
    case 'isequalto':
      return value === expected
    case 'contains':
      return value.includes(expected)
    case 'doesnotcontain':
      return !expected || !value.includes(expected)
    case 'startswith':
      return value.startsWith(expected)
    case 'endswith':
      return value.endsWith(expected)
    case 'isempty':
      return !value
    case 'isnotempty':
      return !!value
  }
}

// 消したアイテムの完了を否定でも満たさないことにするのは、Moodle の availability_completion と同じ結果にし、モードで判定を変えないため
function conditionMet(c: RestrictionCondition, not: boolean, env: RestrictionEnv): boolean {
  switch (c.type) {
    case 'date': {
      const allow = c.d === '>=' ? env.now >= c.t : env.now < c.t
      return not ? !allow : allow
    }
    case 'completion': {
      const id = c.cm === PREVIOUS_ITEM ? env.previous : c.cm
      const state = id == null ? null : env.completion(id)
      if (!state) return false
      const allow =
        c.e === 1
          ? state === 'complete' || state === 'pass'
          : c.e === 0
            ? state === 'incomplete' || state === 'fail'
            : state === (c.e === 2 ? 'pass' : 'fail')
      return not ? !allow : allow
    }
    case 'grade': {
      const score = env.grade(c.id)
      const allow = score != null && (c.min == null || score >= c.min) && (c.max == null || score < c.max)
      return not ? !allow : allow
    }
    case 'profile': {
      const value = env.profile(c.field)
      const allow = value != null && profileMatches(c.op, value, c.v)
      return not ? !allow : allow
    }
    case 'other':
      return false
  }
}

/** 満たさなかった条件だけを残した木（学生に見せる説明に使う） */
type Failed = { set: RestrictionSet; not: boolean; children: (Failed | { cond: RestrictionCondition; not: boolean })[] }

function logic(op: RestrictionOp, not: boolean) {
  const negative = op === '!&' || op === '!|'
  const inner = negative ? !not : not
  const and = op === '&' || op === '!&'
  return { inner, and: inner ? !and : and }
}

function checkSet(set: RestrictionSet, not: boolean, env: RestrictionEnv): { ok: boolean; hide: boolean; failed: Failed } {
  const { inner, and } = logic(set.op, not)
  const failed: Failed = { set, not, children: [] }
  if (set.c.length === 0) return { ok: true, hide: false, failed }
  let ok = and
  let hide = set.show === false
  for (const [i, child] of set.c.entries()) {
    const result = isSet(child) ? checkSet(child, inner, env) : { ok: conditionMet(child, inner, env), failed: { cond: child, not: inner } }
    if (!result.ok) {
      failed.children.push(result.failed)
      if (set.showc && set.showc[i] === false) hide = true
    }
    if (and && !result.ok) ok = false
    else if (!and && result.ok) {
      ok = true
      break
    }
  }
  return { ok, hide: !ok && hide, failed }
}

export type Availability = {
  /** 開ける */
  open: boolean
  /** 開けないうえに、一覧にも出さない */
  hidden: boolean
  /** 開けないときに学生に見せる、満たしていない条件の説明 */
  text: string
}

export const AVAILABLE: Availability = { open: true, hidden: false, text: '' }

export function checkRestriction(set: RestrictionSet | null, env: RestrictionEnv, choices: RestrictionChoices): Availability {
  if (!set) return AVAILABLE
  const result = checkSet(set, false, env)
  if (result.ok) return AVAILABLE
  return { open: false, hidden: result.hide, text: result.hide ? '' : describeFailed(result.failed, choices) }
}

// ---------------------------------------------------------------- 説明

const quote = (s: string) => `「${s}」`
const dateText = (t: number) => formatDateTimeInput(unixToDateTimeInput(t))
const DELETED = '（削除されたアイテム）'

function conditionText(c: RestrictionCondition, not: boolean, choices: RestrictionChoices): string {
  switch (c.type) {
    case 'date':
      return `${dateText(c.t)} ${(c.d === '>=') !== not ? '以降' : 'より前'}`
    case 'completion': {
      const name = c.cm === PREVIOUS_ITEM ? '直前のアイテム' : quote(choices.items.find((it) => it.id === c.cm)?.label ?? DELETED)
      if (c.e === 2) return `${name}に${not ? '合格していない' : '合格している'}`
      if (c.e === 3) return `${name}が${not ? '不合格になっていない' : '不合格になっている'}`
      return `${name}を${(c.e === 1) !== not ? '完了している' : '完了していない'}`
    }
    case 'grade': {
      const name = quote(choices.grades.find((g) => g.id === c.id)?.label ?? DELETED)
      if (c.min == null && c.max == null) return `${name}に評点が${not ? 'ない' : 'ある'}`
      const range = [c.min != null && `${c.min}% 以上`, c.max != null && `${c.max}% 未満`].filter(Boolean).join(' ')
      return `${name}の評点が ${range}${not ? 'でない' : ''}`
    }
    case 'profile': {
      const label = choices.profile.find((p) => p.value === c.field)?.label ?? c.field.slice(3)
      const v = quote(c.v)
      switch (c.op) {
        case 'isequalto':
          return `${label}が${v}と${not ? '一致しない' : '一致する'}`
        case 'contains':
          return `${label}に${v}を${not ? '含まない' : '含む'}`
        case 'doesnotcontain':
          return `${label}に${v}を${not ? '含む' : '含まない'}`
        case 'startswith':
          return `${label}が${v}で${not ? '始まらない' : '始まる'}`
        case 'endswith':
          return `${label}が${v}で${not ? '終わらない' : '終わる'}`
        case 'isempty':
          return `${label}が${not ? '空でない' : '空である'}`
        case 'isnotempty':
          return `${label}が${not ? '空である' : '空でない'}`
      }
    }
    case 'other':
      return choices.other?.(c.raw, not) ?? 'そのほかの条件'
  }
}

const HIDDEN_MARK = '（満たさない学生には表示しない）'

type Part = { text: string; nested: boolean }

function joinParts(parts: Part[], and: boolean) {
  return parts.map((p) => (p.nested ? `（${p.text}）` : p.text)).join(and ? ' かつ ' : ' または ')
}

function headline(lines: string[], and: boolean) {
  if (lines.length === 1) return `開ける条件: ${lines[0]}`
  return [`開ける条件（${and ? 'すべて' : 'いずれか'}）:`, ...lines.map((l) => `・${l}`)].join('\n')
}

function describeNested(set: RestrictionSet, not: boolean, choices: RestrictionChoices): Part {
  const { inner, and } = logic(set.op, not)
  const parts = set.c.map((child) =>
    isSet(child) ? describeNested(child, inner, choices) : { text: conditionText(child, inner, choices), nested: false },
  )
  if (parts.length === 1) return parts[0]
  return { text: joinParts(parts, and), nested: true }
}

/** 教師に見せる、すべての条件の説明。満たさない学生に表示しない条件には印を付ける */
export function describeRestriction(set: RestrictionSet, choices: RestrictionChoices): string {
  const { inner, and } = logic(set.op, false)
  const lines = set.c.map((child, i) => {
    const part = isSet(child) ? describeNested(child, inner, choices) : { text: conditionText(child, inner, choices), nested: false }
    const hidden = set.showc ? set.showc[i] === false : false
    return part.text + (hidden ? HIDDEN_MARK : '')
  })
  const text = headline(lines, and)
  return set.show === false ? `${text}\n${HIDDEN_MARK.slice(1, -1)}` : text
}

function describeFailedNode(node: Failed | { cond: RestrictionCondition; not: boolean }, choices: RestrictionChoices): Part {
  if ('cond' in node) return { text: conditionText(node.cond, node.not, choices), nested: false }
  const { and } = logic(node.set.op, node.not)
  const parts = node.children.map((child) => describeFailedNode(child, choices))
  if (parts.length === 1) return parts[0]
  return { text: joinParts(parts, and), nested: true }
}

function describeFailed(failed: Failed, choices: RestrictionChoices) {
  const { and } = logic(failed.set.op, failed.not)
  return headline(
    failed.children.map((child) => describeFailedNode(child, choices).text),
    and,
  )
}

// ---------------------------------------------------------------- 編集画面に渡す値

/** 保存されている制限を、編集画面の行の値にする。k がある行（送られた値を描き直すとき）は、エラーの置き場所が変わらないようそのまま使う */
function toFormNode(node: RestrictionNode, key: () => string): RestrictionFormNode {
  const k = node.k ?? key()
  if (isSet(node)) return { k, op: node.op, c: node.c.map((child) => toFormNode(child, key)), show: node.show, showc: node.showc }
  switch (node.type) {
    case 'date':
      return { k, type: 'date', d: node.d, t: node.t ? unixToDateTimeInput(node.t) : '' }
    case 'completion':
      return { k, type: 'completion', cm: String(node.cm), e: String(node.e) }
    case 'grade':
      return {
        k,
        type: 'grade',
        id: String(node.id),
        min: node.min != null ? String(node.min) : '',
        max: node.max != null ? String(node.max) : '',
      }
    case 'profile':
      return { k, type: 'profile', field: node.field, op: node.op, v: node.v }
    case 'other':
      return { k, type: 'other', raw: node.raw }
  }
}

export function restrictionFormValue(set: RestrictionSet | null): RestrictionFormNode | null {
  let count = 0
  return set && toFormNode(set, () => `n${count++}`)
}
