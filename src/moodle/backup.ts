import type { PublicationSettings, PublicationStatus } from '../features/publication/publication'
import type { Completion, CourseRole, ItemType, LinkTarget } from '../lib/types'

export type BackupFile = { path: string; name: string; size: number; type: string }

/** 学生フォルダの学生のファイル。moodleUserId は Moodle のユーザーの ID */
export type BackupPublicationFile = { file: BackupFile; moodleUserId: string; status: PublicationStatus; createdAt: number }

export type BackupPublication = { settings: PublicationSettings; files: BackupPublicationFile[] }

export type BackupItem = {
  module: string
  type: ItemType | null
  title: string
  body: string
  url: string
  linkTarget: LinkTarget
  file: BackupFile | null
  /** 学生フォルダのときだけ */
  publication?: BackupPublication
  hidden: boolean
  completion: Completion
  /** 取り込まない理由や、変換で失われるもの */
  notes: string[]
  /** サブセクションの活動なら、その中身。アイテムにはしないので type は null */
  subsection?: BackupSection
}

export type BackupSection = { title: string; summary: string; hidden: boolean; items: BackupItem[]; notes: string[] }

/** セクションのアイテム。サブセクションの中のものも、並びの順に含む */
export const backupItems = (s: BackupSection): BackupItem[] => s.items.flatMap((i) => (i.subsection ? backupItems(i.subsection) : [i]))

export type BackupParticipant = {
  /** Moodle のユーザーの ID。学生フォルダのファイルの持ち主と突き合わせる */
  moodleId: string
  moodleUsername: string
  name: string
  email: string
  /** ユーザー名の規則に合わなければ空 */
  username: string
  role: CourseRole
  skip: string | null
}

export type Backup = {
  release: string
  course: { title: string; code: string; summary: string; visible: boolean; completionEnabled: boolean }
  sections: BackupSection[]
  participants: BackupParticipant[]
  warnings: string[]
}

const MODULE_LABELS: Record<string, string> = {
  page: 'ページ',
  url: 'URL',
  resource: 'ファイル',
  folder: 'フォルダ',
  label: 'ラベル',
  book: 'ブック',
  assign: '課題',
  quiz: '小テスト',
  forum: 'フォーラム',
  choice: '投票',
  feedback: 'フィードバック',
  glossary: '用語集',
  lesson: 'レッスン',
  lti: '外部ツール',
  scorm: 'SCORM',
  workshop: 'ワークショップ',
  wiki: 'Wiki',
  h5pactivity: 'H5P',
  data: 'データベース',
  chat: 'チャット',
  survey: '調査',
  imscp: 'IMS コンテンツパッケージ',
  bigbluebuttonbn: 'BigBlueButton',
  qbank: '問題バンク',
  subsection: 'サブセクション',
  publication: '学生フォルダ',
}

export const moduleLabel = (module: string) => MODULE_LABELS[module] ?? module

export const LIMITS = {
  courseTitle: 120,
  courseCode: 30,
  summary: 2000,
  sectionTitle: 120,
  itemTitle: 200,
  body: 100_000,
  url: 2000,
  name: 60,
}

export function cut(text: string, max: number, notes: string[], label: string) {
  if (text.length <= max) return text
  notes.push(`${label}が長すぎるため、${max}文字で切ります`)
  return text.slice(0, max)
}

export const RESTRICTION_NOTE = 'Moodle のアクセス制限（日付・条件）は取り込めないため、制限なしで表示されます'
