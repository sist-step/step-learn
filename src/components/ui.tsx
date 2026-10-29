import type { Child } from 'hono/jsx'
import { Icon, type IconName } from './icons'

export const initials = (name: string) => {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/)
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : [...t].slice(0, 2).join('').toUpperCase()
}

const hue = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)

export const Avatar = ({ name, size = 32 }: { name: string; size?: number }) => (
  <span
    class="avatar"
    style={`--h:${hue(name)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`}
    aria-hidden="true"
  >
    {initials(name)}
  </span>
)

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
}) => (
  <header class="page-header">
    <div>
      {eyebrow && <div class="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {description && <p class="muted">{description}</p>}
    </div>
    {actions && <div class="page-actions">{actions}</div>}
  </header>
)

export const EmptyState = ({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName
  title: string
  text?: Child
  action?: Child
}) => (
  <div class="empty">
    <div class="empty-icon">
      <Icon name={icon} size={24} />
    </div>
    <h3>{title}</h3>
    {text && <p class="muted">{text}</p>}
    {action && <div class="empty-action">{action}</div>}
  </div>
)

type FieldProps = {
  label: string
  name: string
  type?: string
  value?: string
  error?: string
  hint?: Child
  required?: boolean
  placeholder?: string
  autocomplete?: string
  autofocus?: boolean
  minlength?: number
  maxlength?: number
}

export const Field = ({ label, name, type = 'text', value, error, hint, ...rest }: FieldProps) => {
  const id = `f-${name}`
  const isPassword = type === 'password'
  return (
    <div class={error ? 'field has-error' : 'field'}>
      <label for={id}>{label}</label>
      <div class={isPassword ? 'input-wrap with-action' : 'input-wrap'}>
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error || hint ? `${id}-desc` : undefined}
          {...rest}
        />
        {isPassword && (
          <button type="button" class="input-action" data-toggle-password aria-label="パスワードを表示">
            <Icon name="eye" />
          </button>
        )}
      </div>
      {(error || hint) && (
        <p id={`${id}-desc`} class={error ? 'field-error' : 'field-hint'}>
          {error ? (
            <>
              <Icon name="alert" size={14} /> {error}
            </>
          ) : (
            hint
          )}
        </p>
      )}
    </div>
  )
}

export const TextArea = ({
  label,
  name,
  value,
  error,
  hint,
  rows = 4,
  placeholder,
}: {
  label: string
  name: string
  value?: string
  error?: string
  hint?: Child
  rows?: number
  placeholder?: string
}) => (
  <div class={error ? 'field has-error' : 'field'}>
    <label for={`f-${name}`}>{label}</label>
    <textarea id={`f-${name}`} name={name} rows={rows} placeholder={placeholder}>
      {value}
    </textarea>
    {(error || hint) && <p class={error ? 'field-error' : 'field-hint'}>{error ?? hint}</p>}
  </div>
)

export const Progress = ({ done, total, label = true }: { done: number; total: number; label?: boolean }) => {
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
  role?: string | null
  total?: number
  done?: number
  members?: number
  teachers?: string | null
}

export const CourseCard = ({ course, showProgress }: { course: CourseCardData; showProgress?: boolean }) => (
  <a href={`/courses/${course.id}`} class={`course-card tone-${course.color}`}>
    <div class="course-cover">
      <span class="course-mono">{[...(course.code || course.title)].slice(0, 2).join('')}</span>
      <div class="course-cover-badges">
        {course.role === 'teacher' && <span class="chip chip-accent">担当</span>}
        {course.role === 'student' && !showProgress && <span class="chip chip-success">受講中</span>}
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

export const formatDate = (unix: number) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(unix * 1000),
  )
