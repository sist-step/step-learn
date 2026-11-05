import { imageName } from './images'

export type CourseImageKind = 'hero' | 'icon'

export const courseImageUrl = (courseId: number, kind: CourseImageKind, key: string | null | undefined) =>
  key ? `/courses/${courseId}/${kind}/${imageName(key)}` : null

export const courseImagePrefix = (courseId: number, kind: CourseImageKind) => `courses/${courseId}/${kind}`
