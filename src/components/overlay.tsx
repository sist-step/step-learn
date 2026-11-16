import type { Child, JSX } from 'hono/jsx'
import { Button, IconButton } from './button'
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

export const Popover = ({
  trigger,
  class: cls,
  panelClass,
  children,
  ...rest
}: {
  trigger: Child
  class?: string
  panelClass?: string
  children: Child
} & JSX.IntrinsicElements['details']) => {
  useStyle('/src/components/overlay.css')
  return (
    <details class={cx('popover', cls)} {...rest}>
      {trigger}
      <div class={cx('popover-panel', panelClass)}>{children}</div>
    </details>
  )
}

/**
 * ボタンのそばに出す確認のチップ。client.ts の confirmNear がこの template を複製し、押したボタンの下（収まらなければ上）に開く。
 * 確定のボタンは、取り消せない操作なら danger、取り消せる操作なら primary の方だけを残す
 */
// client.ts で組み立てないのは、ボタンのマークアップが Button と 2 か所に分かれて見た目がずれていくため
export const ConfirmChip = () => {
  useStyle('/src/components/overlay.css')
  return (
    <template data-confirm-chip>
      <div class="confirm-chip" popover="auto" role="alertdialog">
        <div class="confirm-chip-msg" data-confirm-chip-msg />
        <div class="confirm-chip-actions">
          <Button variant="ghost" size="sm" data-confirm-chip-cancel>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" data-confirm-chip-ok="danger" />
          <Button variant="primary" size="sm" data-confirm-chip-ok="primary" />
        </div>
      </div>
    </template>
  )
}

export const MenuItem = ({
  icon,
  class: cls,
  children,
  ...rest
}: { icon?: IconName; class?: string; children: Child } & (
  ({ href: string } & JSX.IntrinsicElements['a']) | ({ href?: undefined } & JSX.IntrinsicElements['button'])
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
