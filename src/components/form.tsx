import type { Child, JSX } from 'hono/jsx'
import { formatDateTimeInput } from '../lib/course-period'
import type { FormName } from '../lib/forms'
import { IMAGE_ACCEPT, IMAGE_TOO_LARGE, MAX_IMAGE_SIZE } from '../lib/images'
import { IconButton } from './button'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

export type Option = { value: string; label: string }

// size ではなく compact にするのは、input / select がすでに size（表示文字数・行数）という属性を持っているため
type ControlProps = { compact?: boolean; invalid?: boolean; class?: string }

const controlClass = ({ compact, class: cls }: ControlProps) => cx('input', compact && 'input-sm', cls)

export const Input = ({ compact, invalid, class: cls, ...rest }: ControlProps & JSX.IntrinsicElements['input']) => {
  useStyle('/src/components/form.css')
  return <input class={controlClass({ compact, class: cls })} aria-invalid={invalid ? 'true' : undefined} {...rest} />
}

export const Select = ({
  options,
  value,
  compact,
  invalid,
  class: cls,
  ...rest
}: ControlProps & { options: readonly Option[]; value?: string } & JSX.IntrinsicElements['select']) => {
  useStyle('/src/components/form.css')
  return (
    <select class={controlClass({ compact, class: cls })} aria-invalid={invalid ? 'true' : undefined} {...rest}>
      {options.map((o) => (
        <option value={o.value} selected={o.value === value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export const Textarea = ({
  value,
  invalid,
  class: cls,
  ...rest
}: Omit<ControlProps, 'compact'> & { value?: string } & JSX.IntrinsicElements['textarea']) => {
  useStyle('/src/components/form.css')
  return (
    <textarea class={cx('input', cls)} aria-invalid={invalid ? 'true' : undefined} {...rest}>
      {value}
    </textarea>
  )
}

type FieldFrameProps = {
  id: string
  label: Child
  error?: string
  hint?: Child
  class?: string
  children: Child
}

// required などのブラウザの検証を使わないのは、ブラウザごとに見た目と文言の違う吹き出しになり、サーバーと同じ規則・文言で欄の下に出せないため
export const validateWith = (name: FormName) => ({ 'data-validate': name, novalidate: true })

// エラーがないときも描いておくのは、client.ts が `${入力欄の id}-error` で探して中身と表示を切り替えるため
export const FieldError = ({ id, error }: { id: string; error?: string }) => {
  useStyle('/src/components/form.css')
  return (
    <p id={`${id}-error`} class="field-error" hidden={!error}>
      <Icon name="alert" size={14} />
      <span data-field-error>{error}</span>
    </p>
  )
}

export const FormField = ({ id, label, error, hint, class: cls, children }: FieldFrameProps) => {
  useStyle('/src/components/form.css')
  return (
    <div class={cx('field', error && 'has-error', cls)}>
      <label for={id}>{label}</label>
      {children}
      <FieldError id={id} error={error} />
      {hint && (
        <p id={`${id}-desc`} class="field-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

type LabeledProps = {
  label: Child
  name: string
  id?: string
  error?: string
  hint?: Child
  fieldClass?: string
}

const describedBy = (id: string, hint: Child) => (hint ? `${id}-error ${id}-desc` : `${id}-error`)

const describe = (id: string, { error, hint }: Pick<LabeledProps, 'error' | 'hint'>) => ({
  invalid: !!error,
  'aria-describedby': describedBy(id, hint),
})

export const TextField = ({
  label,
  name,
  id = `f-${name}`,
  type = 'text',
  error,
  hint,
  fieldClass,
  ...rest
}: LabeledProps & Omit<JSX.IntrinsicElements['input'], 'id' | 'name'>) => {
  useStyle('/src/components/form.css')
  const isPassword = type === 'password'
  return (
    <FormField id={id} label={label} error={error} hint={hint} class={fieldClass}>
      <div class={isPassword ? 'input-wrap with-action' : 'input-wrap'}>
        <Input id={id} name={name} type={type} {...describe(id, { error, hint })} {...rest} />
        {isPassword && (
          <button type="button" class="input-action" data-toggle-password aria-label="パスワードを表示">
            <Icon name="eye" />
          </button>
        )}
      </div>
    </FormField>
  )
}

export const SelectField = ({
  label,
  name,
  id = `f-${name}`,
  error,
  hint,
  fieldClass,
  ...rest
}: LabeledProps & { options: readonly Option[]; value?: string } & Omit<JSX.IntrinsicElements['select'], 'id' | 'name'>) => {
  useStyle('/src/components/form.css')
  return (
    <FormField id={id} label={label} error={error} hint={hint} class={fieldClass}>
      <Select id={id} name={name} {...describe(id, { error, hint })} {...rest} />
    </FormField>
  )
}

export const TextAreaField = ({
  label,
  name,
  id = `f-${name}`,
  rows = 4,
  error,
  hint,
  fieldClass,
  ...rest
}: LabeledProps & { value?: string } & Omit<JSX.IntrinsicElements['textarea'], 'id' | 'name'>) => {
  useStyle('/src/components/form.css')
  return (
    <FormField id={id} label={label} error={error} hint={hint} class={fieldClass}>
      <Textarea id={id} name={name} rows={rows} {...describe(id, { error, hint })} {...rest} />
    </FormField>
  )
}

export const FileChip = ({
  name,
  meta,
  icon = 'file',
  children,
  class: cls,
  ...rest
}: { name?: string; meta?: string; icon?: IconName; children?: Child; class?: string } & JSX.IntrinsicElements['div']) => {
  useStyle('/src/components/form.css')
  return (
    <div class={cx('file-chip', cls)} {...rest}>
      <span class="file-chip-icon">
        <Icon name={icon} size={20} />
      </span>
      <span class="file-chip-body">
        <span class="file-chip-name truncate" data-file-name>
          {name}
        </span>
        <span class="file-chip-meta" data-file-meta>
          {meta}
        </span>
      </span>
      {children}
    </div>
  )
}

// ブラウザ標準の見た目のままにしないのは、ボタンと「選択されていません」がブラウザの言語で出て、ほかの部品とも形がそろわないため
export const FileInput = ({
  id,
  buttonLabel = 'ファイルを選択',
  icon,
  zoneClass,
  zoneStyle,
  children,
  class: cls,
  ...rest
}: { id: string; buttonLabel?: string; icon?: IconName; zoneClass?: string; zoneStyle?: string; children?: Child; class?: string } & Omit<
  JSX.IntrinsicElements['input'],
  'type' | 'id' | 'children'
>) => {
  useStyle('/src/components/form.css', '/src/components/button.css')
  return (
    <div class="file-drop" data-file-drop>
      <input type="file" id={id} class={cx('file-input', cls)} {...rest} />
      <label for={id} class={cx('file-drop-zone', zoneClass)} style={zoneStyle}>
        {children}
        <span class="file-drop-body">
          <span class="file-drop-icon">
            <Icon name="upload" size={18} />
          </span>
          <span>
            <span class="file-drop-drag">ドラッグ＆ドロップ または </span>
            <span class="file-drop-link">{buttonLabel}</span>
          </span>
        </span>
      </label>
      <FileChip class="file-drop-chip" icon={icon} data-file-chip>
        <IconButton icon="x" label="選択を取り消す" data-file-clear />
      </FileChip>
    </div>
  )
}

/**
 * 日時（mode="datetime"、値は YYYY-MM-DDTHH:mm）か日付（mode="date"、値は YYYY-MM-DD）を選ぶ欄。
 * 押すと client.ts が、パソコンでは欄の下にカレンダーと時刻の一覧を、スマホでは下からカレンダーと時刻のホイールを出す。
 * 送信されるのは隠した入力欄（name）の値。optional を付けると、選んだ値を消すボタンが付く
 */
export const DateTimeField = ({
  label,
  name,
  id = `f-${name}`,
  value = '',
  mode = 'datetime',
  optional,
  error,
  hint,
  fieldClass,
}: LabeledProps & { value?: string; mode?: 'datetime' | 'date'; optional?: boolean }) => {
  useStyle('/src/components/form.css', '/src/components/button.css')
  const placeholder = mode === 'date' ? '日付を選択' : '日付と時刻を選択'
  return (
    <div class={cx('field dt-field', error && 'has-error', fieldClass)} data-dt={mode}>
      <label for={`${id}-open`} id={`${id}-label`}>
        {label}
      </label>
      <div class="dt-control">
        <button
          type="button"
          id={`${id}-open`}
          class="dt-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-describedby={describedBy(id, hint)}
          data-dt-open
        >
          <Icon name="calendar" size={18} />
          <span class={cx('dt-text', !value && 'is-empty')} data-dt-text data-dt-placeholder={placeholder}>
            {value ? formatDateTimeInput(value) : placeholder}
          </span>
        </button>
        {optional && (
          <IconButton icon="x" label={`${mode === 'date' ? '日付' : '日時'}を消す`} class="dt-clear" hidden={!value} data-dt-clear />
        )}
        {/* type="hidden" にしないのは、検証のエラーで欄へ移動するとき、フォーカスもスクロールもできなくなるため */}
        <input type="text" id={id} name={name} value={value} class="dt-value" tabindex={-1} readonly aria-hidden="true" data-dt-value />
      </div>
      <FieldError id={id} error={error} />
      {hint && (
        <p id={`${id}-desc`} class="field-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

export const FileField = ({
  label,
  name,
  id = `f-${name}`,
  error,
  hint,
  fieldClass,
  ...rest
}: LabeledProps & Omit<JSX.IntrinsicElements['input'], 'id' | 'name' | 'type'>) => {
  useStyle('/src/components/form.css')
  return (
    <FormField id={id} label={label} error={error} hint={hint} class={fieldClass}>
      <FileInput id={id} name={name} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy(id, hint)} {...rest} />
    </FormField>
  )
}

export const ImageField = ({
  label,
  name,
  id = `f-${name}`,
  src,
  aspect = '16 / 9',
  width,
  error,
  hint,
  fieldClass,
  ...rest
}: LabeledProps & { src?: string | null; aspect?: string; width?: number } & Omit<
    JSX.IntrinsicElements['input'],
    'id' | 'name' | 'type' | 'src' | 'width'
  >) => {
  useStyle('/src/components/form.css')
  return (
    <FormField id={id} label={label} error={error} hint={hint} class={fieldClass}>
      <FileInput
        id={id}
        name={name}
        buttonLabel="画像を選択"
        icon="photo"
        zoneClass="image-preview"
        zoneStyle={`aspect-ratio: ${aspect};${width ? ` width: ${width}px;` : ''}`}
        accept={IMAGE_ACCEPT}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint)}
        data-image-input
        data-max-size={String(MAX_IMAGE_SIZE)}
        data-too-large={IMAGE_TOO_LARGE}
        {...rest}
      >
        <img src={src ?? undefined} alt="" hidden={!src} data-image-preview data-saved={src ?? undefined} />
      </FileInput>
    </FormField>
  )
}

export const SearchBox = ({
  label,
  value,
  placeholder,
  name = 'q',
}: {
  label: string
  value?: string
  placeholder: string
  name?: string
}) => {
  useStyle('/src/components/form.css')
  return (
    <label class="search">
      <Icon name="search" />
      <input type="search" class="search-input" name={name} value={value} placeholder={placeholder} data-search aria-label={label} />
      <kbd>/</kbd>
    </label>
  )
}

export const Switch = ({
  label,
  checked,
  icon,
  class: cls,
  ...rest
}: { label: Child; checked: boolean; icon?: IconName; class?: string } & JSX.IntrinsicElements['button']) => {
  useStyle('/src/components/form.css')
  return (
    <button type="button" role="switch" aria-checked={String(checked)} class={cx('switch', cls)} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      <span>{label}</span>
      <span class="switch-track" />
    </button>
  )
}

export type SegmentOption = Option & { icon?: IconName }

export const SegmentedControl = ({
  name,
  label,
  options,
  value = options[0]?.value,
  class: cls,
  ...rest
}: {
  name: string
  label: string
  options: readonly SegmentOption[]
  value?: string
  class?: string
} & JSX.IntrinsicElements['div']) => {
  useStyle('/src/components/form.css')
  return (
    <div class={cx('segmented', cls)} role="radiogroup" aria-label={label} {...rest}>
      {options.map((o) => (
        <label>
          <input type="radio" name={name} value={o.value} checked={o.value === value} />
          <span>
            {o.icon && <Icon name={o.icon} size={15} />} {o.label}
          </span>
        </label>
      ))}
    </div>
  )
}
