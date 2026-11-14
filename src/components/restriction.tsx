import type { Child } from 'hono/jsx'
import {
  COMPLETION_EXPECTS,
  COMPLETION_EXPECT_LABELS,
  DATE_DIRECTIONS,
  DATE_DIRECTION_LABELS,
  PREVIOUS_ITEM,
  PROFILE_OPS,
  PROFILE_OP_LABELS,
  RESTRICTION_KIND_LABELS,
  RESTRICTION_KINDS,
  RESTRICTION_OPS,
  RESTRICTION_OP_LABELS,
  profileOpTakesValue,
  showsEach,
  type ProfileOp,
  type RestrictionChoices,
  type RestrictionFormNode,
  type RestrictionKind,
  type RestrictionOp,
} from '../lib/restriction'
import type { FieldErrors } from '../lib/forms'
import { Button, IconButton } from './button'
import { Card } from './card'
import { cx } from './cx'
import { DateTimeField, FieldError, Input, Select, validateWith, type Option } from './form'
import { Icon, type IconName } from './icons'
import { AppShell } from './layout'
import { useStyle } from './style'
import { Breadcrumbs } from './ui'

type FormSet = Extract<RestrictionFormNode, { c: RestrictionFormNode[] }>
type FormLeaf = Exclude<RestrictionFormNode, FormSet>

/** client.ts が行を複製するときに、新しい行の目印に置き換える文字 */
export const RESTRICTION_KEY_SLOT = '__K__'

const KIND_ICONS: Record<RestrictionKind | 'set' | 'other', IconName> = {
  date: 'calendar',
  completion: 'checkCircle',
  grade: 'academicCap',
  profile: 'user',
  set: 'layers',
  other: 'users',
}

type Ctx = { choices: RestrictionChoices; errors: FieldErrors }

const isFormSet = (n: RestrictionFormNode): n is FormSet => 'c' in n

const opOptions = RESTRICTION_OPS.map((op) => ({ value: op, label: RESTRICTION_OP_LABELS[op] }))

/** 入力欄 1 つ。エラーは client.ts が `${id}-error` に出す */
const RsField = ({
  id,
  label,
  error,
  class: cls,
  children,
}: {
  id: string
  label: string
  error?: string
  class?: string
  children: Child
}) => (
  <div class={cx('field rs-field', error && 'has-error', cls)}>
    <label for={id}>{label}</label>
    {children}
    <FieldError id={id} error={error} />
  </div>
)

const control = (k: string, key: string, errors: FieldErrors) => ({
  id: `${k}-${key}`,
  name: `${k}.${key}`,
  invalid: !!errors[`${k}.${key}`],
  'aria-describedby': `${k}-${key}-error`,
})

// 目のボタンを表示と非表示の 2 つにしないのは、押すたびに入れ替えるとフォーカスが外れるため
const EyeButton = ({ hidden, all }: { hidden: boolean; all?: boolean }) => (
  <Button
    size="sm"
    variant="ghost"
    class="rs-eye"
    aria-pressed={hidden ? 'true' : 'false'}
    title={hidden ? '満たさない学生には表示しない（押すと表示する）' : '満たさない学生にも条件を表示する（押すと表示しない）'}
    data-rs-eye={all ? 'all' : ''}
  >
    <Icon name="eye" size={16} class="rs-eye-shown" />
    <Icon name="eyeSlash" size={16} class="rs-eye-hidden" />
    <span class="sr-only">満たさない学生に表示しない</span>
  </Button>
)

const itemOptions = (choices: RestrictionChoices, current: string): Option[] => {
  const options = [
    ...(choices.previous ? [{ value: String(PREVIOUS_ITEM), label: '直前のアイテム' }] : []),
    ...choices.items.map((it) => ({ value: String(it.id), label: it.meta ? `${it.label}（${it.meta}）` : it.label })),
  ]
  return current && !options.some((o) => o.value === current) ? [{ value: current, label: '（削除されたアイテム）' }, ...options] : options
}

const gradeOptions = (choices: RestrictionChoices, current: string): Option[] => {
  const options = choices.grades.map((g) => ({ value: String(g.id), label: g.meta ? `${g.label}（${g.meta}）` : g.label }))
  return current && !options.some((o) => o.value === current) ? [{ value: current, label: '（削除されたアイテム）' }, ...options] : options
}

const profileOptions = (choices: RestrictionChoices, current: string): Option[] =>
  current && !choices.profile.some((p) => p.value === current)
    ? [{ value: current, label: current.slice(3) }, ...choices.profile]
    : choices.profile

function LeafFields({ node, ctx }: { node: FormLeaf; ctx: Ctx }) {
  const { k } = node
  const { choices, errors } = ctx
  switch (node.type) {
    case 'date':
      return (
        <>
          <DateTimeField label="日時" name={`${k}.t`} id={`${k}-t`} value={node.t} error={errors[`${k}.t`]} />
          <RsField id={`${k}-d`} label="向き">
            <Select
              compact
              {...control(k, 'd', errors)}
              options={DATE_DIRECTIONS.map((d) => ({ value: d, label: DATE_DIRECTION_LABELS[d] }))}
              value={node.d}
            />
          </RsField>
        </>
      )
    case 'completion': {
      const passFail = choices.items.filter((it) => it.passFail).map((it) => it.id)
      return (
        <>
          <RsField id={`${k}-cm`} label="アイテム" error={errors[`${k}.cm`]} class="rs-grow">
            <Select compact {...control(k, 'cm', errors)} options={itemOptions(choices, node.cm)} value={node.cm} data-rs-item />
          </RsField>
          <RsField id={`${k}-e`} label="状態" error={errors[`${k}.e`]}>
            <Select
              compact
              {...control(k, 'e', errors)}
              options={COMPLETION_EXPECTS.map((e) => ({ value: String(e), label: COMPLETION_EXPECT_LABELS[e] }))}
              value={node.e}
              data-rs-pass-fail={JSON.stringify(choices.previous ? [PREVIOUS_ITEM, ...passFail] : passFail)}
            />
          </RsField>
        </>
      )
    }
    case 'grade':
      return (
        <>
          <RsField id={`${k}-id`} label="アイテム" error={errors[`${k}.id`]} class="rs-grow">
            <Select compact {...control(k, 'id', errors)} options={gradeOptions(choices, node.id)} value={node.id} />
          </RsField>
          <RsField id={`${k}-min`} label="% 以上（任意）" error={errors[`${k}.min`]} class="rs-num">
            <Input compact {...control(k, 'min', errors)} value={node.min} inputmode="decimal" autocomplete="off" />
          </RsField>
          <RsField id={`${k}-max`} label="% 未満（任意）" error={errors[`${k}.max`]} class="rs-num">
            <Input compact {...control(k, 'max', errors)} value={node.max} inputmode="decimal" autocomplete="off" />
          </RsField>
        </>
      )
    case 'profile': {
      const op = (PROFILE_OPS.includes(node.op as ProfileOp) ? node.op : 'isequalto') as ProfileOp
      return (
        <>
          <RsField id={`${k}-field`} label="項目" error={errors[`${k}.field`]}>
            <Select compact {...control(k, 'field', errors)} options={profileOptions(choices, node.field)} value={node.field} />
          </RsField>
          <RsField id={`${k}-op`} label="比べ方">
            <Select
              compact
              {...control(k, 'op', errors)}
              options={PROFILE_OPS.map((o) => ({ value: o, label: PROFILE_OP_LABELS[o] }))}
              value={op}
              data-rs-profile-op
            />
          </RsField>
          <RsField id={`${k}-v`} label="値" error={errors[`${k}.v`]} class="rs-grow">
            <Input
              compact
              {...control(k, 'v', errors)}
              value={node.v}
              autocomplete="off"
              disabled={!profileOpTakesValue(op)}
              data-rs-profile-value
            />
          </RsField>
        </>
      )
    }
    case 'other':
      return <p class="rs-other">{choices.other?.(node.raw, false) ?? 'そのほかの条件'}</p>
  }
}

const kindOf = (node: RestrictionFormNode): RestrictionKind | 'set' | 'other' => (isFormSet(node) ? 'set' : node.type)

function RsNode({ node, ctx, hidden }: { node: RestrictionFormNode; ctx: Ctx; hidden: boolean }) {
  const kind = kindOf(node)
  return (
    <li class={cx('rs-node', kind === 'set' && 'rs-node-set')} data-rs-node={kind} data-rs-key={node.k}>
      <EyeButton hidden={hidden} />
      {isFormSet(node) ? (
        <RsSet node={node} ctx={ctx} />
      ) : (
        <div class="rs-cond">
          <div class="rs-cond-head">
            <span class="rs-kind">
              <Icon name={KIND_ICONS[kind]} size={16} />
              {kind === 'other' ? '旧STEP Learn の条件' : RESTRICTION_KIND_LABELS[kind as RestrictionKind]}
            </span>
            <IconButton icon="trash" label="この条件を削除" class="rs-remove" data-rs-remove />
          </div>
          <div class="rs-fields" data-rs-raw={node.type === 'other' ? JSON.stringify(node.raw) : undefined}>
            <LeafFields node={node} ctx={ctx} />
          </div>
        </div>
      )}
    </li>
  )
}

function RsSet({ node, ctx, root }: { node: FormSet; ctx: Ctx; root?: boolean }) {
  const op = (RESTRICTION_OPS.includes(node.op as RestrictionOp) ? node.op : '&') as RestrictionOp
  const { choices } = ctx
  return (
    <div class={cx('rs-set', root && 'rs-root')} data-rs-set={root ? 'root' : ''} data-rs-each={showsEach(op) ? 'true' : 'false'}>
      <div class="rs-set-head">
        {root ? (
          <span>学生が次の条件を</span>
        ) : (
          <span class="rs-kind">
            <Icon name="layers" size={16} />
            次の条件を
          </span>
        )}
        <Select compact name={`${node.k}.op`} options={opOptions} value={op} aria-label="条件の組み合わせ" data-rs-op />
        {root && <span>と開けます</span>}
        {root ? (
          <EyeButton hidden={node.show === false} all />
        ) : (
          <IconButton icon="trash" label="この制限セットを削除" class="rs-remove" data-rs-remove />
        )}
      </div>
      <ul class="rs-list" data-rs-list>
        {node.c.map((child, i) => (
          <RsNode node={child} ctx={ctx} hidden={!!root && node.showc?.[i] === false} />
        ))}
      </ul>
      <p class="rs-empty muted small">
        {root ? '条件がありません。下のボタンから追加してください。条件がなければ、だれでも開けます。' : '条件がありません。'}
      </p>
      <div class="rs-add" role="group" aria-label="条件を追加">
        {RESTRICTION_KINDS.map((kind) => {
          const reason = choices.kinds.includes(kind) ? null : (choices.unavailable[kind] ?? 'このコースでは使えません。')
          return (
            <Button size="sm" icon="plus" data-rs-add={kind} disabled={!!reason} title={reason ?? undefined}>
              {RESTRICTION_KIND_LABELS[kind]}
            </Button>
          )
        })}
        <Button size="sm" icon="plus" data-rs-add="set">
          {RESTRICTION_KIND_LABELS.set}
        </Button>
      </div>
    </div>
  )
}

const blank = (kind: RestrictionKind | 'set', choices: RestrictionChoices): RestrictionFormNode => {
  const k = RESTRICTION_KEY_SLOT
  switch (kind) {
    case 'date':
      return { k, type: 'date', d: '>=', t: '' }
    case 'completion':
      return { k, type: 'completion', cm: choices.previous ? String(PREVIOUS_ITEM) : String(choices.items[0]?.id ?? ''), e: '1' }
    case 'grade':
      return { k, type: 'grade', id: String(choices.grades[0]?.id ?? ''), min: '', max: '' }
    case 'profile':
      return { k, type: 'profile', field: choices.profile[0]?.value ?? '', op: 'isequalto', v: '' }
    case 'set':
      return { k, op: '&', c: [] }
  }
}

const EMPTY_ROOT: FormSet = { k: 'root', op: '&', c: [], showc: [] }

/**
 * アクセス制限の条件の編集。送るのは availability（client.ts が行から組み立てる JSON）で、
 * 行ごとの入力欄は `<行の目印>.<項目>` の name でエラーの置き場所にだけ使う
 */
export const RestrictionEditor = ({
  value,
  choices,
  errors = {},
}: {
  value: RestrictionFormNode | null
  choices: RestrictionChoices
  errors?: FieldErrors
}) => {
  useStyle('/src/components/form.css', '/src/components/restriction.css')
  const root = value && isFormSet(value) ? { ...value, k: 'root' } : EMPTY_ROOT
  const ctx = { choices, errors }
  return (
    <div class="rs" data-rs>
      <input type="hidden" name="availability" id="f-availability" value={JSON.stringify(root)} data-rs-value />
      <FieldError id="f-availability" error={errors.availability} />
      <RsSet node={root} ctx={ctx} root />
      {[...RESTRICTION_KINDS, 'set' as const].map((kind) => (
        <template data-rs-template={kind}>
          <RsNode node={blank(kind, choices)} ctx={{ choices, errors: {} }} hidden={false} />
        </template>
      ))}
    </div>
  )
}

/** 教師に見せる、アクセス制限の説明（lib/restriction.ts の describeRestriction） */
export const RestrictionNote = ({ text, class: cls }: { text: string; class?: string }) => {
  useStyle('/src/components/restriction.css')
  return (
    <span class={cx('restriction-note muted small', cls)}>
      <Icon name="lock" size={14} />
      <span>{text || 'アクセス制限あり'}</span>
    </span>
  )
}

export type RestrictionTarget = {
  kind: 'section' | 'item'
  title: string
  /** 保存の送信先 */
  action: string
  /** 戻る先（コースページのそのセクション） */
  back: string
}

/** アクセス制限の編集画面（通常モードと Moodle モード）。editable でなければ、条件の編集の代わりに notice を出す */
export const RestrictionPage = ({
  tone,
  crumbs,
  target,
  value,
  choices,
  errors,
  note,
  editable = true,
  notice,
  side,
}: {
  tone: string
  crumbs: { href: string; label: string }[]
  target: RestrictionTarget
  value: RestrictionFormNode | null
  choices: RestrictionChoices
  errors?: FieldErrors
  /** 今の制限の説明。制限がなければ null */
  note: string | null
  editable?: boolean
  notice?: Child
  /** 右の列の「現在の制限」のカードに足すもの */
  side?: Child
}) => {
  useStyle('/src/components/course.css', '/src/components/restriction.css', '/src/routes/content/content.css')
  const kindLabel = target.kind === 'section' ? 'セクション' : 'アイテム'
  return (
    <AppShell tone={tone}>
      <Breadcrumbs items={[...crumbs, { href: target.back, label: target.title }, { label: 'アクセス制限' }]} />
      <header class="editor-head">
        <span class="item-icon kind-restriction">
          <Icon name="lock" size={20} />
        </span>
        <div class="editor-head-text">
          <span class="eyebrow">{kindLabel}のアクセス制限</span>
          <h1 class="truncate">{target.title}</h1>
        </div>
        <div class="editor-head-actions">
          <Button href={target.back} variant="ghost" icon="chevronLeft" aria-label="戻る">
            <span class="hide-sm">戻る</span>
          </Button>
          {editable && (
            <Button type="submit" form="restriction-form" variant="primary" icon="check" title="保存（⌘S / Ctrl+S）" data-save-shortcut>
              保存
            </Button>
          )}
        </div>
      </header>

      <div class="editor">
        {editable ? (
          <Card
            as="form"
            id="restriction-form"
            method="post"
            action={target.action}
            class="editor-main stack"
            heading="開ける条件"
            description="条件を満たした学生だけが開けます。教師はいつでも開けます。目のアイコンで、条件を満たしていない学生に条件を見せるか、一覧にも出さないかを選べます。"
            data-loading-form
            {...validateWith('restriction')}
          >
            <RestrictionEditor value={value} choices={choices} errors={errors} />
          </Card>
        ) : (
          <div class="editor-main stack">{notice}</div>
        )}

        <aside class="editor-side">
          <Card heading="現在の制限">
            <div class="stack">
              {note ? <RestrictionNote text={note} /> : <p class="muted small">制限はありません。</p>}
              {editable && note && (
                <form method="post" action={target.action} data-confirm={`「${target.title}」のアクセス制限をなくしますか？`}>
                  <input type="hidden" name="clear" value="1" />
                  <Button type="submit" size="sm" icon="lockOpen">
                    制限をなくす
                  </Button>
                </form>
              )}
              {side}
            </div>
          </Card>
        </aside>
      </div>
    </AppShell>
  )
}
