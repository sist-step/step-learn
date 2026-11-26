// サーバーの handlers と、ブラウザで読み込む lib/forms.ts の両方が読み込むので、DB や Node の API を使うモジュールを import しない

export const PUBLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const

/** 教師が決めたファイルの扱い。pending はまだ決めていない */
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export type PublicationSettings = {
  /** 教師が承認したファイルだけをほかの学生に見せる */
  approval: number
  /** ほかの学生に、ファイルを上げた人の名前を見せる */
  showNames: number
  opensAt: number | null
  closesAt: number | null
}

export const DEFAULT_PUBLICATION_SETTINGS: PublicationSettings = { approval: 1, showNames: 1, opensAt: null, closesAt: null }

/** 学生 1 人がアップロードできるファイルの数 */
export const MAX_PUBLICATION_FILES = 20

export type PublicationFile = {
  id: number
  userId: number
  /** 上げた人の名前。ほかの学生に名前を見せない設定では空 */
  userName: string
  name: string
  size: number
  type: string
  status: PublicationStatus
  createdAt: number
}

/** ほかの学生に見せるか。承認が要らない設定でも、教師が非公開にしたファイルは見せない */
export const isPublic = (settings: Pick<PublicationSettings, 'approval'>, status: PublicationStatus) =>
  status === 'approved' || (!settings.approval && status === 'pending')

/** 学生に見せる、ファイルの今の扱い */
export const publicationStateOf = (settings: Pick<PublicationSettings, 'approval'>, status: PublicationStatus) =>
  isPublic(settings, status) ? 'public' : status === 'rejected' ? 'rejected' : 'waiting'

export type PublicationState = ReturnType<typeof publicationStateOf>

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  public: '公開中',
  waiting: '承認待ち',
  rejected: '非公開',
}

/** 学生がファイルを上げたり消したりできる時期か。期間の決まっていない側は制限しない */
export function uploadPeriodState({ opensAt, closesAt }: Pick<PublicationSettings, 'opensAt' | 'closesAt'>, now: number) {
  if (opensAt && now < opensAt) return 'before'
  if (closesAt && now >= closesAt) return 'after'
  return 'open'
}

export type PublicationView = {
  settings: PublicationSettings
  /** 学生が今アップロード・削除できるか */
  period: ReturnType<typeof uploadPeriodState>
  /** 見ている学生のファイル。教師には空 */
  mine: PublicationFile[]
  /** 教師にはすべてのファイル、学生にはほかの学生の公開中のファイル */
  others: PublicationFile[]
  manage: boolean
}

export const publicationBase = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/publication`
