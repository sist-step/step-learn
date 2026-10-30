import type { Child, JSX } from 'hono/jsx'
import { cx } from './cx'
import { Icon, type IconName } from './icons'
import { useStyle } from './style'

// title ではなく heading にするのは、HTML の title 属性（ツールチップ）と名前がぶつかるため
type CardOwnProps = {
  heading?: Child
  description?: Child
  leading?: Child
  actions?: Child
  tone?: 'default' | 'danger'
  class?: string
  children?: Child
}

export type CardProps = CardOwnProps &
  (
    | ({ as?: 'section' } & JSX.IntrinsicElements['section'])
    | ({ as: 'form' } & JSX.IntrinsicElements['form'])
    | ({ as: 'div' } & JSX.IntrinsicElements['div'])
  )

export const CardHead = ({
  heading,
  description,
  leading,
  actions,
}: Pick<CardOwnProps, 'heading' | 'description' | 'leading' | 'actions'>) => {
  useStyle('/src/components/card.css')
  return (
    <div class="card-head">
      {leading}
      <div class="card-head-text">
        {heading && <h2>{heading}</h2>}
        {description && <p class="muted">{description}</p>}
      </div>
      {actions && <div class="card-head-actions">{actions}</div>}
    </div>
  )
}

export const Card = ({
  as = 'section',
  heading,
  description,
  leading,
  actions,
  tone = 'default',
  class: cls,
  children,
  ...rest
}: CardProps) => {
  useStyle('/src/components/card.css')
  const Tag = as
  return (
    <Tag class={cx('card', tone === 'danger' && 'danger-zone', cls)} {...rest}>
      {(heading || description) && <CardHead heading={heading} description={description} leading={leading} actions={actions} />}
      {children}
    </Tag>
  )
}

export const DangerRow = ({ heading, description, children }: { heading: Child; description?: Child; children: Child }) => {
  useStyle('/src/components/card.css')
  return (
    <div class="danger-row">
      <div>
        <div class="strong">{heading}</div>
        {description && <p class="muted small">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export const Block = ({
  heading,
  count,
  actions,
  class: cls,
  children,
}: {
  heading: Child
  count?: number
  actions?: Child
  class?: string
  children: Child
}) => {
  useStyle('/src/components/card.css')
  return (
    <section class={cx('block', cls)}>
      <h2 class="block-title">
        {heading}
        {count !== undefined && <span class="count">{count}</span>}
        {actions && <span class="block-actions">{actions}</span>}
      </h2>
      {children}
    </section>
  )
}

export type TableColumn = { label: Child; class?: string; srOnly?: boolean }

export const Table = ({ columns, children }: { columns: readonly (TableColumn | false | null | undefined)[]; children: Child }) => {
  useStyle('/src/components/card.css')
  return (
    <div class="table-card">
      <table class="table">
        <thead>
          <tr>
            {columns
              .filter((col): col is TableColumn => !!col)
              .map((col) => (
                <th class={col.class}>{col.srOnly ? <span class="sr-only">{col.label}</span> : col.label}</th>
              ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export const Stats = ({ children }: { children: Child }) => {
  useStyle('/src/components/card.css')
  return <div class="stats">{children}</div>
}

export const Stat = ({
  label,
  value,
  href,
  class: cls,
  children,
}: {
  label: Child
  value?: Child
  href?: string
  class?: string
  children?: Child
}) => {
  useStyle('/src/components/card.css')
  const body = (
    <>
      <span class="stat-label">{label}</span>
      {value !== undefined && <span class="stat-value">{value}</span>}
      {children}
    </>
  )
  return href ? (
    <a href={href} class={cx('stat', 'stat-link', cls)}>
      {body}
      <Icon name="chevronRight" class="stat-arrow" />
    </a>
  ) : (
    <div class={cx('stat', cls)}>{body}</div>
  )
}

export const LinkCard = ({
  icon,
  class: cls,
  children,
  ...rest
}: { icon: IconName; class?: string; children: Child } & (
  ({ href: string } & JSX.IntrinsicElements['a']) | ({ href?: undefined } & JSX.IntrinsicElements['div'])
)) => {
  useStyle('/src/components/card.css')
  const body = (
    <>
      <Icon name={icon} size={20} />
      {children}
    </>
  )
  return rest.href !== undefined ? (
    <a class={cx('link-card', cls)} {...rest}>
      {body}
    </a>
  ) : (
    <div class={cx('link-card', cls)} {...rest}>
      {body}
    </div>
  )
}

export const Bento = ({ children }: { children: Child }) => {
  useStyle('/src/components/card.css')
  return <div class="bento">{children}</div>
}

export type TileProps = { span?: 1 | 2 | 3 | 4; rows?: 1 | 2; class?: string; children: Child } & (
  ({ href: string } & JSX.IntrinsicElements['a']) | ({ href?: undefined } & JSX.IntrinsicElements['section'])
)

export const Tile = ({ span = 1, rows = 1, class: cls, children, ...rest }: TileProps) => {
  useStyle('/src/components/card.css')
  const className = cx('tile', `span-${span}`, rows > 1 && `rows-${rows}`, cls)
  return rest.href !== undefined ? (
    <a class={className} {...rest}>
      {children}
    </a>
  ) : (
    <section class={className} {...rest}>
      {children}
    </section>
  )
}
