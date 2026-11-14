import { config } from '../lib/config'
import type { LinkTarget } from '../lib/types'

const moodle = config.moodle!

const TIMEOUT = 15_000

/** Moodle が返した例外。errorcode で見分ける */
export class MoodleError extends Error {
  constructor(
    readonly errorcode: string,
    message: string,
    readonly debuginfo = '',
  ) {
    super(message)
  }
}

// 存在を知らせないよう、権限がない場合もまとめて 404 として扱う
const NOT_FOUND_CODES = new Set([
  'notfound',
  'invalidrecord',
  'invalidrecordunknown',
  'invalidcoursemodule',
  'invalidcourseid',
  'requireloginerror',
  'nopermissions',
  'invalidparameter',
])

export const isNotFound = (e: unknown) => e instanceof MoodleError && NOT_FOUND_CODES.has(e.errorcode)

// 404 にまとめないのは、Web サービスの認証で起きる（rest:use の権限がないなど）Moodle の設定の問題で、ユーザーのすべての画面が見えなくなるため
export const isAccessDenied = (e: unknown) => e instanceof MoodleError && e.errorcode === 'accessexception'

/** トークンの期限切れ・削除。ログインし直せば直る */
export const isTokenError = (e: unknown) => e instanceof MoodleError && e.errorcode === 'invalidtoken'

/** Moodle に接続できない（停止中・タイムアウトなど） */
export const isUnavailable = (e: unknown) => e instanceof MoodleError && e.errorcode === 'unavailable'

type Param = string | number | boolean | Param[] | { [key: string]: Param }

// URLSearchParams に値をそのまま渡さないのは、Moodle の REST が配列や入れ子を ids[0]=1 や options[0][name]=x の形でしか受け取らないため
function flatten(params: Record<string, Param>, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) flatten(Object.fromEntries(value.map((v, i) => [String(i), v])), name, out)
    else if (typeof value === 'object') flatten(value, name, out)
    else out.append(name, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  return out
}

async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })
  } catch (e) {
    console.error('[moodle]', e)
    throw new MoodleError('unavailable', 'Moodle に接続できません')
  }
}

/** site の Moodle を呼ぶ。Moodle モードでない移行ツールからも使うので、MOODLE_URL の Moodle とは限らない */
export async function callSite<T>(site: string, token: string, wsfunction: string, params: Record<string, Param> = {}): Promise<T> {
  const body = flatten(params)
  body.set('wstoken', token)
  body.set('wsfunction', wsfunction)
  const res = await send(`${site}/webservice/rest/server.php?moodlewsrestformat=json`, { method: 'POST', body })
  if (!res.ok) throw new MoodleError('unavailable', `Moodle が ${res.status} を返しました`)
  const data = (await res.json()) as unknown
  if (data && typeof data === 'object' && 'exception' in data) {
    const { errorcode, message, debuginfo } = data as { errorcode?: string; message?: string; debuginfo?: string }
    throw new MoodleError(errorcode ?? 'unknown', message ?? '', debuginfo)
  }
  return data as T
}

export const call = <T>(token: string, wsfunction: string, params: Record<string, Param> = {}) =>
  callSite<T>(moodle.url, token, wsfunction, params)

// Moodle 以外の URL にトークンを付けないのは、教材の URL が書き換えられたときにトークンを外部に漏らさないため
function withToken(site: string, fileUrl: string, token: string) {
  const url = URL.parse(fileUrl)
  if (!url || url.origin !== new URL(site).origin || !url.pathname.includes('/webservice/pluginfile.php/')) return null
  url.searchParams.delete('forcedownload')
  url.searchParams.set('token', token)
  return url
}

/** site の webservice/pluginfile.php のファイルを取得する。ほかの URL には null を返す */
export async function fetchSiteFile(site: string, token: string, fileUrl: string, range?: string) {
  const url = withToken(site, fileUrl, token)
  if (!url) return null
  return send(url.href, { headers: range ? { Range: range } : {} })
}

export const fetchFile = (token: string, fileUrl: string, range?: string) => fetchSiteFile(moodle.url, token, fileUrl, range)

/** ファイルを利用者の下書き領域に上げ、その itemid を返す */
export async function uploadDraft(token: string, file: File) {
  const body = new FormData()
  body.set('token', token)
  body.set('filearea', 'draft')
  body.set('itemid', '0')
  body.set('file_1', file, file.name)
  const res = await send(`${moodle.url}/webservice/upload.php`, { method: 'POST', body })
  type Uploaded = { itemid?: number; error?: string; errorcode?: string }
  const data = (await res.json()) as Uploaded[] | Uploaded
  const first = Array.isArray(data) ? data[0] : data
  if (!first?.itemid) throw new MoodleError(first?.errorcode ?? 'uploadfailed', first?.error ?? '')
  return first.itemid
}

export type Exchanged = {
  token: string
  validuntil: number
  sidhash: string
  userid: number
  username: string
  fullname: string
  email: string
  siteadmin: boolean
}

export const exchangeCode = (code: string, verifier: string) =>
  call<Exchanged>(moodle.exchangeToken, 'local_steplearn_exchange_code', { code, verifier })

export type MoodleCourse = {
  id: number
  shortname: string
  fullname: string
  summary: string
  summaryformat: number
  visible: boolean
  completionenabled: boolean
  role: '' | 'teacher' | 'student'
  canmanage: boolean
  total: number
  done: number
  // 必須にしないのは、プラグインを更新する前の Moodle は返さないため
  inprogress?: boolean
  upcoming?: boolean
  members: number
  imageurl: string
  /** local_steplearn_get_course だけが返す */
  format?: MoodleFormat
  /** local_steplearn_get_course だけが返す。ファイル自動配布の活動（mod_stepbundle）が Moodle に入っているか */
  bundle?: boolean
}

export type MoodleFormat = {
  name: string
  /** 折りたたみ型トピック（format_topcoll） */
  topcoll?: {
    order: number[]
    collapsed: number[]
    current: number
    toggleall: boolean
    onesection: boolean
    columns: number
    summarywhencollapsed: boolean
    persistent: boolean
  }
  /** タイル（format_tiles） */
  tiles?: {
    defaulticon: string
    /** 0 は出さない、1 は分数、2 は割合 */
    progress: number
    subtiles: boolean
    subtileszero: boolean
    tiles: { sectionid: number; icon: string; photourl: string }[]
  }
}

export type MoodleModule = {
  id: number
  url?: string
  name: string
  instance: number
  visible: number
  uservisible: boolean
  visibleoncoursepage: number
  modname: string
  availabilityinfo?: string
  description?: string
  completion?: number
  completiondata?: {
    state: number
    isautomatic: boolean
    istrackeduser: boolean
    details: { rulename: string }[]
  }
  contents?: { type: string; filename: string; filepath?: string; fileurl: string; filesize: number; mimetype?: string }[]
  /** 活動ごとの追加の情報（JSON）。URL では display（自動を解決したあとの表示方法）、ファイル自動配布では key（中身を見分ける鍵） */
  customdata?: string
}

export type MoodleSection = {
  id: number
  name: string
  visible?: number
  summary: string
  summaryformat: number
  section: number
  uservisible?: boolean
  availabilityinfo?: string
  component?: string | null
  /** サブセクション（component が mod_subsection）のときは、その活動の instance */
  itemid?: number | null
  modules: MoodleModule[]
}

/** 教師に見せるアクセス制限 */
export type MoodleRestriction = {
  sectionid: number
  cmid: number
  /** すべての条件を書いた説明（HTML） */
  info: string
  /** Moodle の availability の JSON */
  json: string
}

type Named = { id: number; name: string }

/** アクセス制限の編集で選べるもの。plugins は有効な条件の種類（availability_* の名前） */
export type MoodleRestrictionOptions = {
  plugins: string[]
  /** 評点の項目。cmid はその活動（活動の評点でなければ 0） */
  grades: (Named & { cmid: number })[]
  /** field は `sf:<標準の項目>` か `cf:<独自の項目の短縮名>` */
  profilefields: { field: string; name: string }[]
  groups: Named[]
  groupings: Named[]
}

/** 活動を作る・変えるときに、どの種類でも送る値。cmid が 0 なら sectionid のセクションに作る */
export type SaveActivity = {
  courseid: number
  cmid: number
  sectionid: number
  name: string
  completion: string
  visible: boolean
}

export type StateAction =
  'cm_move' | 'cm_hide' | 'cm_show' | 'cm_delete' | 'section_move_after' | 'section_hide' | 'section_show' | 'section_delete'

/** トークンを持つ利用者として Moodle を呼ぶ関数 */
export const api = (token: string) => ({
  myCourses: () => call<MoodleCourse[]>(token, 'local_steplearn_get_my_courses'),
  otherCourses: () => call<MoodleCourse[]>(token, 'local_steplearn_get_other_courses'),
  course: (courseid: number) => call<MoodleCourse>(token, 'local_steplearn_get_course', { courseid }),
  contents: (courseid: number) => call<MoodleSection[]>(token, 'core_course_get_contents', { courseid }),
  viewCourse: (courseid: number) => call<unknown>(token, 'core_course_view_course', { courseid }),
  setManualCompletion: (cmid: number, completed: boolean) =>
    call<unknown>(token, 'core_completion_update_activity_completion_status_manually', { cmid, completed }),
  viewUrl: (urlid: number) => call<unknown>(token, 'mod_url_view_url', { urlid }),
  viewResource: (resourceid: number) => call<unknown>(token, 'mod_resource_view_resource', { resourceid }),
  updateCourse: (courseid: number, action: StateAction, ids: number[], target: { sectionid?: number; cmid?: number } = {}) =>
    call<string>(token, 'core_courseformat_update_course', {
      action,
      courseid,
      ids,
      ...(target.sectionid ? { targetsectionid: target.sectionid } : {}),
      ...(target.cmid ? { targetcmid: target.cmid } : {}),
    }),
  createSection: (courseid: number, name: string) => call<number>(token, 'local_steplearn_create_section', { courseid, name }),
  updateSection: (courseid: number, sectionid: number, name: string, summary: string) =>
    call<null>(token, 'local_steplearn_update_section', { courseid, sectionid, name, summary }),
  restrictions: (courseid: number) =>
    call<{ enabled: boolean; restrictions: MoodleRestriction[]; options: MoodleRestrictionOptions }>(
      token,
      'local_steplearn_get_restrictions',
      {
        courseid,
      },
    ),
  /** availability が空なら制限をなくす */
  setRestriction: (p: { courseid: number; sectionid: number; cmid: number; availability: string }) =>
    call<null>(token, 'local_steplearn_set_restriction', p),
  setSectionsCollapsed: (courseid: number, sectionids: number[], collapsed: boolean) =>
    call<null>(token, 'local_steplearn_set_sections_collapsed', { courseid, sectionids, collapsed }),
  checkSession: (sidhash: string) => call<{ active: boolean }>(token, 'local_steplearn_check_session', { sidhash }),
  saveUrl: (p: SaveActivity & { externalurl: string; display: LinkTarget | 'keep' }) => call<number>(token, 'local_steplearn_save_url', p),
  saveResource: (p: SaveActivity & { draftitemid: number }) => call<number>(token, 'local_steplearn_save_resource', p),
  saveBundle: (p: SaveActivity) => call<number>(token, 'mod_stepbundle_save', p),
  viewBundle: (cmid: number) => call<unknown>(token, 'mod_stepbundle_view', { cmid }),
})

export type Api = ReturnType<typeof api>

export const moodleUrl = (path: string) => `${moodle.url}${path}`
