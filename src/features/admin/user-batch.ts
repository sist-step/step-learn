import { USERNAME_MAX_LENGTH } from '../../lib/username'

export const USER_BATCH_KINDS = ['create', 'reissue'] as const

export type UserBatchKind = (typeof USER_BATCH_KINDS)[number]

export const USER_BATCH_KIND_LABELS: Record<UserBatchKind, string> = {
  create: '一括作成',
  reissue: 'パスワードの再発行',
}

/** 連番の桁数。接頭辞ごとに 01〜99 */
const SERIAL_DIGITS = 2

export const MAX_BATCH_USERS = 10 ** SERIAL_DIGITS - 1

export const MAX_NAME_LENGTH = 60

const PREFIX_MAX_LENGTH = USERNAME_MAX_LENGTH - SERIAL_DIGITS

const PREFIX_RE = new RegExp(`^[a-z0-9._-]{1,${PREFIX_MAX_LENGTH}}$`)

export function checkPrefix(prefix: string) {
  if (!prefix) return '接頭辞を入力してください。'
  if (!PREFIX_RE.test(prefix)) return `接頭辞は半角英数字と . _ - で${PREFIX_MAX_LENGTH}文字以内にしてください。`
  return null
}

export const serialUsername = (prefix: string, serial: number) => `${prefix}${String(serial).padStart(SERIAL_DIGITS, '0')}`

/** その接頭辞に連番を付けたユーザー名なら連番を、そうでなければ null を返す */
export function serialOf(prefix: string, username: string) {
  if (!username.startsWith(prefix)) return null
  const rest = username.slice(prefix.length)
  return rest.length === SERIAL_DIGITS && /^\d+$/.test(rest) ? Number(rest) : null
}

// 行の空白をそのまま残さないのは、Excel の名簿から貼り付けると行の終わりにタブが付き、全角と半角の空白も混ざるため
export const parseNames = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[\s　]+/g, ' ').trim())
    .filter(Boolean)

export function checkNames(names: string[]) {
  if (names.length === 0) return '氏名を入力してください。'
  if (names.length > MAX_BATCH_USERS) return `一度に作れるのは${MAX_BATCH_USERS}人までです。`
  const long = names.findIndex((name) => name.length > MAX_NAME_LENGTH)
  if (long >= 0) return `${long + 1}人目の氏名は${MAX_NAME_LENGTH}文字以内で入力してください。`
  return null
}

/** 作れる人数を超えるなら理由を返す。next はその接頭辞で次に振る連番 */
export function checkRoom(next: number, count: number) {
  const room = Math.max(0, MAX_BATCH_USERS - next + 1)
  if (count <= room) return null
  return room === 0 ? 'この接頭辞の連番はすべて使われています。別の接頭辞にしてください。' : `この接頭辞で作れるのはあと${room}人です。`
}

/** 配るファイルを置いておく時間（秒） */
export const BATCH_FILE_TTL = 60 * 60

export const BATCH_FILE_FORMATS = ['docx', 'xlsx', 'csv'] as const

export type BatchFileFormat = (typeof BATCH_FILE_FORMATS)[number]

export const isBatchFileFormat = (s: string): s is BatchFileFormat => (BATCH_FILE_FORMATS as readonly string[]).includes(s)

export const BATCH_FILE_LABELS: Record<BatchFileFormat, string> = {
  docx: 'ログインカード（Word）',
  xlsx: '一覧（Excel）',
  csv: '一覧（CSV）',
}
