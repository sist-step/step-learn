import type { Child, JSX } from 'hono/jsx'
import type { FormName } from '../lib/forms'
import { IMAGE_ACCEPT, IMAGE_TOO_LARGE, MAX_IMAGE_SIZE } from '../lib/images'
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

export const FileInput = ({ class: cls, ...rest }: Omit<JSX.IntrinsicElements['input'], 'type'> & { class?: string }) => {
  useStyle('/src/components/form.css')
  return <input type="file" class={cx('file-input', cls)} {...rest} />
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
      <div class="image-field">
        <div class="image-preview" style={`aspect-ratio: ${aspect};${width ? ` width: ${width}px;` : ''}`}>
          <Icon name="photo" size={28} />
          <img src={src ?? undefined} alt="" hidden={!src} data-image-preview data-saved={src ?? undefined} />
        </div>
        <FileInput
          id={id}
          name={name}
          accept={IMAGE_ACCEPT}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, hint)}
          data-image-input
          data-max-size={String(MAX_IMAGE_SIZE)}
          data-too-large={IMAGE_TOO_LARGE}
          {...rest}
        />
      </div>
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
}: {
  name: string
  label: string
  options: readonly SegmentOption[]
  value?: string
}) => {
  useStyle('/src/components/form.css')
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
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
