import type { Child, JSX } from 'hono/jsx'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'danger-outline' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const ICON_SIZES: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

type ButtonOwnProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  icon?: IconName
  iconEnd?: IconName
  class?: string
  children?: Child
}

export type ButtonProps = ButtonOwnProps &
  (
    | ({ href: string; as?: undefined } & JSX.IntrinsicElements['a'])
    | ({ href?: undefined; as: 'span' } & JSX.IntrinsicElements['span'])
    | ({ href?: undefined; as?: undefined } & JSX.IntrinsicElements['button'])
  )

export const Button = ({ variant = 'default', size = 'md', block, icon, iconEnd, class: cls, children, as, ...rest }: ButtonProps) => {
  useStyle('/src/components/button.css')
  const className = cx('btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', cls)
  const content = (
    <>
      {icon && <Icon name={icon} size={ICON_SIZES[size]} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={ICON_SIZES[size]} />}
    </>
  )
  if (rest.href !== undefined) {
    return (
      <a class={className} {...rest}>
        {content}
      </a>
    )
  }
  if (as === 'span') {
    return (
      <span class={className} {...rest}>
        {content}
      </span>
    )
  }
  // type の既定を button にするのは、フォームの中に置いただけで送信ボタンになる事故を防ぐため。送信するときは type="submit" を明示する
  return (
    <button type="button" class={className} {...rest}>
      {content}
    </button>
  )
}

type IconButtonOwnProps = {
  icon: IconName
  label: string
  danger?: boolean
  iconSize?: number
  class?: string
}

export type IconButtonProps = IconButtonOwnProps &
  (
    | ({ href: string; as?: undefined } & JSX.IntrinsicElements['a'])
    | ({ href?: undefined; as: 'summary' } & JSX.IntrinsicElements['summary'])
    | ({ href?: undefined; as?: undefined } & JSX.IntrinsicElements['button'])
  )

export const IconButton = ({ icon, label, danger, iconSize = 16, class: cls, title, as, ...rest }: IconButtonProps) => {
  useStyle('/src/components/button.css')
  const props = { class: cx('icon-btn', danger && 'danger', cls), 'aria-label': label, title: title ?? label }
  const glyph = <Icon name={icon} size={iconSize} />
  if (rest.href !== undefined) {
    return (
      <a {...props} {...rest}>
        {glyph}
      </a>
    )
  }
  if (as === 'summary') {
    return (
      <summary {...props} {...rest}>
        {glyph}
      </summary>
    )
  }
  return (
    <button type="button" {...props} {...rest}>
      {glyph}
    </button>
  )
}
