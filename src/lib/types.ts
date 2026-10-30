import type { courses, items, sections } from './schema'

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
  }
}

export type Course = typeof courses.$inferSelect
export type Section = typeof sections.$inferSelect
export type Item = typeof items.$inferSelect

export type ItemType = 'page' | 'link' | 'file' | 'screen'

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  page: 'ページ',
  link: 'リンク',
  file: 'ファイル',
  screen: '画面共有',
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
