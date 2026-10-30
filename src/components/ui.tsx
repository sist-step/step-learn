import type { Child, JSX } from 'hono/jsx'
import { courseImageUrl } from '../lib/courses'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

export const initials = (name: string) => {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/)
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : [...t].slice(0, 2).join('').toUpperCase()
}

const hue = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)

export const Avatar = ({ name, size = 32 }: { name: string; size?: number }) => {
  useStyle('/src/components/ui.css')
  return (
    <span
      class="avatar"
      style={`--h:${hue(name)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export const PageHeader = ({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: Child
  description?: Child
  actions?: Child
  eyebrow?: Child
}) => {
  useStyle('/src/components/ui.css')
  return (
    <header class="page-header">
      <div>
        {eyebrow && <div class="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p class="muted">{description}</p>}
      </div>
      {actions && <div class="page-actions">{actions}</div>}
    </header>
  )
}

export const EmptyState = ({
  icon,
  title,
  text,
  action,
  page,
}: {
  icon: IconName
  title: string
  text?: Child
  action?: Child
  page?: boolean
}) => {
  useStyle('/src/components/ui.css')
  return (
    <div class={cx('empty', page && 'empty-page')}>
      <div class="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      {text && <p class="muted">{text}</p>}
      {action && <div class="empty-action">{action}</div>}
    </div>
  )
}

/** Person の meta に出す「@ユーザー名 · メールアドレス」。メールアドレスを見せない画面では email を渡さない */
export const userMeta = (u: { username: string | null; email?: string }) => [u.username && `@${u.username}`, u.email].filter(Boolean).join(' · ')

export const Person = ({
  avatar,
  name,
  meta,
  href,
  class: cls,
}: {
  avatar: Child
  name: Child
  meta?: Child
  href?: string
  class?: string
}) => {
  useStyle('/src/components/ui.css')
  const body = (
    <>
      {avatar}
      <span class="person-meta">
        <span class="strong truncate">{name}</span>
        {meta && <span class="muted small truncate">{meta}</span>}
      </span>
    </>
  )
  return href ? (
    <a href={href} class={cx('person', cls)}>
      {body}
    </a>
  ) : (
    <div class={cx('person', cls)}>{body}</div>
  )
}

export type Crumb = { label: Child; href?: string }

export const Breadcrumbs = ({ items }: { items: readonly Crumb[] }) => {
  useStyle('/src/components/ui.css')
  return (
    <nav class="crumbs" aria-label="パンくず">
      {items.map((item, i) => (
        <>
          {i > 0 && <Icon name="chevronRight" size={14} />}
          {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
        </>
      ))}
    </nav>
  )
}

export type AlertTone = 'error' | 'info' | 'success' | 'warning'

const ALERT_ICONS: Record<AlertTone, IconName> = { error: 'alert', info: 'info', success: 'check', warning: 'alert' }

export const Alert = ({ tone = 'error', children }: { tone?: AlertTone; children: Child }) => {
  useStyle('/src/components/ui.css')
  return (
    <div class={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICONS[tone]} size={16} />
      <div>{children}</div>
    </div>
  )
}

export type ChipTone = 'default' | 'accent' | 'success' | 'live'

export const Chip = ({
  tone = 'default',
  icon,
  class: cls,
  children,
  ...rest
}: { tone?: ChipTone; icon?: IconName; class?: string; children: Child } & JSX.IntrinsicElements['span']) => {
  useStyle('/src/components/ui.css')
  return (
    <span class={cx('chip', tone !== 'default' && `chip-${tone}`, cls)} {...rest}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}

export type TabItem = { href: string; label: Child; active: boolean }

export const Tabs = ({ label, items, block }: { label: string; items: readonly TabItem[]; block?: boolean }) => {
  useStyle('/src/components/ui.css')
  return (
    <nav class={cx('tabs', block && 'tabs-block')} aria-label={label} data-tabs>
      {items.map((t) => (
        <a href={t.href} class={t.active ? 'tab active' : 'tab'} aria-current={t.active ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  )
}

export const TabPanel = ({ children }: { children: Child }) => {
  useStyle('/src/components/ui.css')
  return <div class="tab-panel">{children}</div>
}

export const Progress = ({ done, total, label = true }: { done: number; total: number; label?: boolean }) => {
  useStyle('/src/components/ui.css')
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div class="progress" data-progress>
      <div class="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div class="progress-bar" style={`width:${pct}%`} />
      </div>
      {label && (
        <span class="progress-label">
          <span data-progress-pct>{pct}</span>%
        </span>
      )}
    </div>
  )
}

export const ProgressRing = ({ done, total }: { done: number; total: number }) => {
  useStyle('/src/components/ui.css')
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div class="ring-wrap">
      <span class="ring" style={`--p:${pct}`} data-ring aria-hidden="true" />
      <strong class="ring-value">
        <span data-progress-pct>{pct}</span>%
      </strong>
    </div>
  )
}

export type CourseCardData = {
  id: number
  code: string
  title: string
  summary: string
  color: string
  heroImage?: string | null
  iconImage?: string | null
  role?: string | null
  total?: number
  done?: number
  members?: number
  teachers?: string | null
}

export const CourseIcon = ({
  course,
  text,
  class: cls,
}: {
  course: { id: number; iconImage?: string | null }
  text: string
  class: string
}) => {
  useStyle('/src/components/ui.css')
  const src = courseImageUrl(course.id, 'icon', course.iconImage)
  return (
    <span class={cx(cls, 'course-icon', src && 'has-image')} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : text}
    </span>
  )
}

export const courseInitials = (course: { code: string; title: string }) => [...(course.code || course.title)].slice(0, 2).join('')

export const CourseCard = ({ course, showProgress }: { course: CourseCardData; showProgress?: boolean }) => {
  useStyle('/src/components/ui.css')
  const hero = courseImageUrl(course.id, 'hero', course.heroImage)
  return (
    <a href={`/courses/${course.id}`} class={`course-card tone-${course.color}`}>
      <div class={cx('course-cover', hero && 'has-image')}>
        {hero && <img class="course-cover-img" src={hero} alt="" loading="lazy" />}
        <CourseIcon course={course} text={courseInitials(course)} class="course-mono" />
        <div class="course-cover-badges">
          {course.role === 'teacher' && <Chip tone="accent">担当</Chip>}
          {course.role === 'student' && !showProgress && <Chip tone="success">受講中</Chip>}
        </div>
      </div>
      <div class="course-body">
        {course.code && <div class="course-code">{course.code}</div>}
        <h3 class="course-title">{course.title}</h3>
        {course.summary ? <p class="course-summary">{course.summary}</p> : <p class="course-summary muted">説明はありません</p>}
      </div>
      <div class="course-foot">
        {showProgress && course.role === 'student' ? (
          <Progress done={course.done ?? 0} total={course.total ?? 0} />
        ) : (
          <span class="meta">
            <Icon name="users" size={14} /> {course.members ?? 0}人
            {course.teachers && <span class="meta-sep">·</span>}
            {course.teachers && <span class="truncate">{course.teachers}</span>}
          </span>
        )}
      </div>
    </a>
  )
}

export const CourseRow = ({ course }: { course: CourseCardData }) => {
  useStyle('/src/components/ui.css')
  return (
    <a href={`/courses/${course.id}`} class={`course-row tone-${course.color}`}>
      <CourseIcon course={course} text={courseInitials(course)} class="course-mono" />
      <span class="course-row-text">
        <span class="strong truncate">{course.title}</span>
        {course.code && <span class="muted small truncate">{course.code}</span>}
      </span>
      {course.role === 'student' ? <Progress done={course.done ?? 0} total={course.total ?? 0} /> : <Chip tone="accent">担当</Chip>}
    </a>
  )
}

export const formatDate = (unix: number) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(unix * 1000),
  )
