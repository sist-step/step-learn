export type Role = 'admin' | 'teacher' | 'student'
export type CourseRole = 'teacher' | 'student'

export type User = {
  id: number
  email: string
  name: string
  role: Role
}

export type NavCourse = { id: number; title: string; color: string }

export type Flash = { type: 'success' | 'error' | 'info'; message: string }

export type AppEnv = {
  Variables: {
    user: User | null
    navCourses: NavCourse[]
    flash: Flash | null
  }
}

export type Course = {
  id: number
  code: string
  title: string
  summary: string
  color: string
  enroll_key: string | null
  visible: number
  created_at: number
  updated_at: number
}

export type Section = {
  id: number
  course_id: number
  title: string
  summary: string
  position: number
}

export type Item = {
  id: number
  course_id: number
  section_id: number
  type: ItemType
  title: string
  body: string
  url: string
  file_key: string | null
  file_name: string | null
  file_size: number | null
  file_type: string | null
  position: number
}

export type ItemType = 'page' | 'link' | 'file' | 'screen'

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  page: 'ページ',
  link: 'リンク',
  file: 'ファイル',
  screen: '画面共有',
}

export const COURSE_COLORS = ['indigo', 'sky', 'emerald', 'amber', 'rose', 'violet', 'teal', 'slate'] as const

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理者',
  teacher: '教師',
  student: '学生',
}

export const COURSE_ROLE_LABELS: Record<CourseRole, string> = {
  teacher: '教師',
  student: '学生',
}
