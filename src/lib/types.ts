import type { Child } from 'hono/jsx'
import type { codeItems, courses, items, sections } from './schema'

export type Role = 'admin' | 'teacher' | 'student'
export type CourseRole = 'teacher' | 'student'

export type User = {
  id: number
  email: string
  name: string
  username: string | null
  role: Role
}

export type NavCourse = { id: number; title: string; color: string; iconImage: string | null }

export type Flash = { type: 'success' | 'error' | 'info'; message: string }

export type AppEnv = {
  Variables: {
    user: User | null
    navCourses: NavCourse[]
    flash: Flash | null
    /** 描画中に部品が登録したスタイルシート（components/style.tsx） */
    styles?: Set<string>
    /** AI のパネルを描く。AI を使えない利用者や Moodle モードでは未設定か null を返す（app.tsx） */
    aiPanel?: () => Child
    /** 操作ログに残す利用者。ログインした要求と、既にあるアカウントでのログインの失敗では、user がまだ空のため（lib/operation-log.ts） */
    logUserId?: number
  }
}

export type Course = typeof courses.$inferSelect
export type Section = typeof sections.$inferSelect
export type Item = typeof items.$inferSelect

export type CodeItem = typeof codeItems.$inferSelect

export type ItemType = 'page' | 'link' | 'file' | 'screen' | 'code' | 'bundle'

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  page: 'ページ',
  link: 'リンク',
  file: 'ファイル',
  screen: '画面共有',
  code: 'コード',
  bundle: 'ファイル自動配布',
}

export const COMPLETIONS = ['none', 'manual', 'view', 'play', 'clear'] as const

export type Completion = (typeof COMPLETIONS)[number]

export const COMPLETION_LABELS: Record<Completion, string> = {
  none: 'なし',
  manual: '学生が自分で完了にする',
  view: '開いたら完了',
  play: '最後まで再生したら完了',
  clear: '制約をすべてクリアしたら完了',
}

export const LINK_TARGETS = ['new', 'same', 'embed'] as const

export type LinkTarget = (typeof LINK_TARGETS)[number]

export const LINK_TARGET_LABELS: Record<LinkTarget, string> = {
  new: '新しいタブで開く',
  same: '同じタブで開く',
  embed: 'ページに埋め込む',
}

export const COURSE_COLORS = ['cyan', 'indigo', 'sky', 'emerald', 'amber', 'rose', 'violet', 'teal', 'slate'] as const

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理者',
  teacher: '教師',
  student: '学生',
}

export const COURSE_ROLE_LABELS: Record<CourseRole, string> = {
  teacher: '教師',
  student: '学生',
}

/** 操作ログの種類。どの操作がどれになるかは lib/operation-log.ts の RULES で決める */
export const LOG_KINDS = ['view', 'change', 'important'] as const

export type LogKind = (typeof LOG_KINDS)[number]

export const LOG_KIND_LABELS: Record<LogKind, string> = {
  view: '閲覧',
  change: '操作',
  important: '重要な操作',
}

/** 種類ごとの保存期間（日）。null は消さない */
export const LOG_RETENTION_DAYS: Record<LogKind, number | null> = {
  view: 90,
  change: 365,
  important: null,
}
