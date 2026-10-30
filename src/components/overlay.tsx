import type { Child, JSX } from 'hono/jsx'
import { IconButton } from './button'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

// <dialog> を使わないのは、外側のクリックで閉じる処理や開くための showModal() を client.ts に書かずに済ませるため
export const Modal = ({
  id,
  heading,
  description,
  class: cls,
  children,
}: {
  id: string
  heading: Child
  description?: Child
  class?: string
  children: Child
}) => {
  useStyle('/src/components/overlay.css')
  return (
    <div id={id} popover="auto" class={cx('modal', cls)} role="dialog" aria-labelledby={`${id}-title`}>
      <div class="modal-head">
        <div>
          <h2 id={`${id}-title`}>{heading}</h2>
          {description && <p class="muted small">{description}</p>}
        </div>
        <IconButton icon="x" label="閉じる" iconSize={18} popovertarget={id} popovertargetaction="hide" />
      </div>
      {children}
    </div>
  )
}

export const Popover = ({ trigger, class: cls, panelClass, children }: { trigger: Child; class?: string; panelClass?: string; children: Child }) => {
  useStyle('/src/components/overlay.css')
  return (
    <details class={cx('popover', cls)}>
      {trigger}
      <div class={cx('popover-panel', panelClass)}>{children}</div>
    </details>
  )
}

export const MenuItem = ({
  icon,
  class: cls,
  children,
  ...rest
}: { icon?: IconName; class?: string; children: Child } & (
  | ({ href: string } & JSX.IntrinsicElements['a'])
  | ({ href?: undefined } & JSX.IntrinsicElements['button'])
)) => {
  useStyle('/src/components/overlay.css')
  const body = (
    <>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </>
  )
  return rest.href !== undefined ? (
    <a class={cx('menu-item', cls)} {...rest}>
      {body}
    </a>
  ) : (
    <button type="button" class={cx('menu-item', cls)} {...rest}>
      {body}
    </button>
  )
}
