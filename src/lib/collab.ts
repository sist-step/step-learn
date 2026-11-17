// Node の API と DB を使わないのは、ブラウザ側の src/collab/ と Moodle モードからも読み込むため

/** 共同編集のアイテムの種類の名前（items.type と、Moodle モードの extra_items.type） */
export const COLLAB_KIND = 'collab'

export const COLLAB_KINDS = ['doc', 'sheet', 'slides', 'board'] as const

export type CollabKind = (typeof COLLAB_KINDS)[number]

export const COLLAB_KIND_LABELS: Record<CollabKind, string> = {
  doc: '文書',
  sheet: '表計算',
  slides: 'スライド',
  board: 'キャンバス',
}

export const COLLAB_KIND_DESCRIPTIONS: Record<CollabKind, string> = {
  doc: 'Word のように文章を書く。.docx で保存・読み込みできる',
  sheet: 'Excel のように表と計算式を扱う。.xlsx で保存・読み込みできる',
  slides: 'PowerPoint のようにスライドを作る。.pptx で保存・読み込みできる',
  board: '無限に広がるキャンバスに、付箋・図形・画像・線を置く',
}

/** Office の形式で保存・読み込みできる種類の拡張子 */
export const COLLAB_FILE_EXTS: Partial<Record<CollabKind, string>> = { doc: 'docx', sheet: 'xlsx', slides: 'pptx' }

// group をまだ置かないのは、グループの機能がまだないため。足すときは 'group' を足し、持ち主を group:<id> にする
export const COLLAB_SCOPES = ['course', 'student'] as const

export type CollabScope = (typeof COLLAB_SCOPES)[number]

export const COLLAB_SCOPE_LABELS: Record<CollabScope, string> = {
  course: 'コース全体で 1 つ',
  student: '学生ごとに 1 つ',
}

export const COLLAB_SCOPE_DESCRIPTIONS: Record<CollabScope, string> = {
  course: '教師も学生も、同じ 1 つのファイルを同時に編集する',
  student: '学生はそれぞれ自分のファイルを編集する。教師は全員のファイルを開ける',
}

export type CollabSettings = { kind: CollabKind; scope: CollabScope }

export const isCollabKind = (v: unknown): v is CollabKind => typeof v === 'string' && (COLLAB_KINDS as readonly string[]).includes(v)

export const isCollabScope = (v: unknown): v is CollabScope => typeof v === 'string' && (COLLAB_SCOPES as readonly string[]).includes(v)

/** Moodle モードの extra_items.data から読む。壊れていたら文書・コース全体として扱う */
export const collabSettingsOf = (data: Record<string, unknown>): CollabSettings => ({
  kind: isCollabKind(data.kind) ? data.kind : 'doc',
  scope: isCollabScope(data.scope) ? data.scope : 'course',
})

/**
 * ファイルの持ち主。course はコース全体の 1 つ、template は学生ごとのときに学生が最初に開いたときの中身（ひな形）、
 * user:<id> はその学生のファイル
 */
export type CollabOwner = 'course' | 'template' | `user:${number}`

export const userOwner = (userId: number): CollabOwner => `user:${userId}`

export function parseOwner(v: unknown): CollabOwner | null {
  if (v === 'course' || v === 'template') return v
  const m = typeof v === 'string' ? /^user:([1-9]\d{0,15})$/.exec(v) : null
  return m && Number.isSafeInteger(Number(m[1])) ? userOwner(Number(m[1])) : null
}

export const ownerUserId = (owner: CollabOwner) => (owner.startsWith('user:') ? Number(owner.slice(5)) : null)

/** 見る人が開けるファイルの持ち主。requested は URL などで指定されたもの（なければ空文字）。開けなければ null */
export function ownerFor(store: CollabStore, settings: CollabSettings, viewer: { id: number; canManage: boolean }, requested: string) {
  if (settings.scope === 'course') return !requested || requested === 'course' ? 'course' : null
  const own = userOwner(viewer.id)
  if (!requested) return viewer.canManage ? 'template' : own
  const owner = parseOwner(requested)
  if (!owner || owner === 'course') return null
  if (!viewer.canManage) return owner === own ? owner : null
  const userId = ownerUserId(owner)
  return userId === null || store.isStudent(userId) ? owner : null
}

/** 1 つのファイルの読み書き。key は同じファイルを開いている人をまとめる部屋の鍵で、ファイルごとに違う */
export type CollabDocStore = {
  key: string
  load: () => Uint8Array | null
  save: (state: Uint8Array, userId: number) => void
  /** まだ中身がないときに写す元（学生ごとのファイルのひな形） */
  template?: { key: string; load: () => Uint8Array | null }
}

/** 学生ごとのときの、学生とそのファイル。updatedAt はファイルを最後に変えた日時で、まだ開いていなければ null */
export type CollabStudentFile = { id: number; name: string; updatedAt: number | null }

/** アイテム 1 つのファイルの置き場所。通常モード（lib/collab-items.ts）と Moodle モード（moodle-mode/collab.ts）で違う */
export type CollabStore = {
  doc: (owner: CollabOwner) => CollabDocStore
  /** 学生ごとのときに教師が開ける学生とファイル */
  students: () => CollabStudentFile[]
  /** 教師が開ける学生のファイルか */
  isStudent: (userId: number) => boolean
  /** 画像を置くストレージのキーの頭（末尾の / はなし） */
  imagePrefix: string
}

/** アイテムの画面に出す、ファイルを開くための情報 */
export type CollabView = {
  settings: CollabSettings
  /** 編集画面の URL（/courses/:id/items/:iid/collab） */
  href: string
  /** 学生ごとのときの教師にだけ渡す */
  students?: CollabStudentFile[]
}

/** ひな形から始めるか。学生のファイルを初めて開いたとき */
export const startsFromTemplate = (owner: CollabOwner) => owner.startsWith('user:')

/** 1 つのファイルの大きさの上限（Yjs の状態のバイト数）。画像は別に置くので、文字と図形だけでここまで */
export const MAX_COLLAB_STATE = 16 * 1024 * 1024

/** 1 回に送る変更の上限。読み込み（インポート）で中身を入れ替えるときがいちばん大きい */
export const MAX_COLLAB_UPDATE = 8 * 1024 * 1024

/** 利用者の ID から決めた、参加者を見分ける色。カーソルや選択の色に使う */
export function presenceColor(id: number) {
  const hues = [210, 340, 150, 30, 270, 190, 0, 100, 300, 50]
  return `hsl(${hues[id % hues.length]} 70% 45%)`
}

/** 開いているファイルの名前（保存するときのファイル名） */
export const exportFileName = (title: string, kind: CollabKind) =>
  `${title.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 100) || COLLAB_KIND_LABELS[kind]}.${COLLAB_FILE_EXTS[kind] ?? 'json'}`
