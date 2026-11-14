import {
  AGENT_MODEL_LABEL,
  AGENT_STATE_MESSAGES,
  MAX_AGENT_PERIOD,
  isAgentOpen,
  usagePercent,
  type AgentSettings,
  type AgentState,
} from '../lib/agent'
import type { AgentUserUsage } from '../lib/agent-items'
import { VSCODE_EXTENSION_NAME, VSCODE_MARKETPLACE_URL } from '../lib/bundle'
import type { FieldErrors } from '../lib/forms'
import { Button } from './button'
import { Card, LinkCard, Table } from './card'
import { DateTimeField, TextField, validateWith } from './form'
import { Icon } from './icons'
import { useStyle } from './style'
import { Alert, Chip, EmptyState, Progress, formatDateTime } from './ui'

/** 教師と管理者にだけ渡す、アイテム全体の使用量 */
export type AgentManageView = { spent: number; users: AgentUserUsage[]; tokens: number; isAdmin: boolean }

/** アイテムの画面と編集画面に出す、コーディングエージェントの設定と、見ている人の状態 */
export type AgentView = { settings: AgentSettings; state: AgentState; usage: number; manage?: AgentManageView }

const formatUsd = (usd: number) => `$${usd.toFixed(usd > 0 && usd < 0.1 ? 4 : 2)}`

const periodText = ({ opensAt, closesAt }: AgentSettings) =>
  opensAt !== null && closesAt !== null ? `${formatDateTime(opensAt)} 〜 ${formatDateTime(closesAt)}` : '未設定'

const StateChip = ({ state }: { state: AgentState }) =>
  state === 'ok' ? (
    <Chip tone="success">使えます</Chip>
  ) : state === 'off' ? (
    <Chip>無効</Chip>
  ) : (
    <Chip tone="accent">{state === 'limit' || state === 'total' ? '上限に達しました' : '期間外'}</Chip>
  )

/** アイテムの画面の本体。VS Code で使うボタンと、使える期間・自分の利用状況 */
export const AgentOpen = ({ base, editHref, settings, state, usage, manage }: AgentView & { base: string; editHref?: string }) => {
  useStyle('/src/components/agent.css', '/src/components/card.css')
  if (state === 'off')
    return (
      <EmptyState
        icon="cpuChip"
        title="まだ使えません"
        text={editHref ? '管理者がこのアイテムに API キーを入れると、学生が使えるようになります。' : AGENT_STATE_MESSAGES.off}
        action={
          editHref && (
            <Button href={editHref} icon="pencil">
              期間と上限を設定
            </Button>
          )
        }
      />
    )
  return (
    <div class="agent-open stack">
      <LinkCard icon="cpuChip" class="link-card-lg kind-agent">
        <span class="file-name">
          <span class="strong">VS Code でコーディングエージェントを使う</span>
          <span class="muted small">開いているフォルダーのファイルを、AI（{AGENT_MODEL_LABEL}）が読み書きしてプログラムを書きます</span>
        </span>
        <form method="post" action={`${base}/launch`} data-vscode-launch>
          <Button type="submit" variant="primary" iconEnd="external">
            VS Code で使う
          </Button>
        </form>
      </LinkCard>
      <div class="agent-help muted small">
        <p>
          VS Code に拡張機能「{VSCODE_EXTENSION_NAME}」を入れてから押してください。使える期間のあいだだけ、VS Code の左のバーに「STEP
          Learn」が出ます。
          <a href={VSCODE_MARKETPLACE_URL} target="_blank" rel="noopener" data-no-prefetch>
            Marketplace で見る
            <Icon name="external" size={12} />
          </a>
        </p>
      </div>
      {!isAgentOpen(state) && <Alert tone="info">{AGENT_STATE_MESSAGES[state]}</Alert>}
      <Card heading="使える期間" actions={<StateChip state={state} />}>
        <p class="agent-period">{periodText(settings)}</p>
      </Card>
      <Card
        heading={manage ? 'あなたの利用状況（試しに使った分）' : 'あなたの利用状況'}
        description="使える量のうち、どれだけ使ったかの割合です。上限に達すると、このアイテムでは使えなくなります。"
      >
        <Progress done={usage} total={100} />
      </Card>
      {manage && (
        <Card
          heading="学生全体の利用状況"
          description={`${formatUsd(manage.spent)} / ${formatUsd(settings.totalLimit)}（${usagePercent(manage.spent, settings.totalLimit)}%）・VS Code でつないだ PC ${manage.tokens} 台`}
          actions={
            editHref && (
              <Button href={editHref} size="sm" iconEnd="chevronRight">
                詳しく見る
              </Button>
            )
          }
        />
      )}
    </div>
  )
}

/** 編集画面の右の列に置く、使える期間と 1 人あたりの上限のカード（保存のフォームの中） */
export const AgentPeriodCard = ({
  opensAt,
  closesAt,
  userLimit,
  errors,
}: {
  opensAt: string
  closesAt: string
  userLimit: string
  errors: FieldErrors
}) => (
  <Card
    heading="使える期間と上限"
    description={`学生は、この期間のあいだだけ VS Code で使えます。長さは ${MAX_AGENT_PERIOD / 86_400} 日までです。`}
  >
    <div class="stack">
      <DateTimeField label="開始日時" name="opens_at" value={opensAt} error={errors.opens_at} />
      <DateTimeField label="終了日時" name="closes_at" value={closesAt} error={errors.closes_at} />
      <TextField
        label="1 人あたりの上限（USD）"
        name="user_limit"
        inputmode="decimal"
        value={userLimit}
        error={errors.user_limit}
        hint="このアイテムで 1 人が使える額です。学生には額ではなく、使った割合だけを見せます。"
      />
    </div>
  </Card>
)

/** 編集画面の、保存のフォームの外に置く欄（API キーとアイテム全体の上限、利用状況） */
export const AgentEditPanel = ({
  base,
  settings,
  manage,
  class: cls,
}: Pick<AgentView, 'settings'> & { base: string; manage: AgentManageView; class?: string }) => {
  useStyle('/src/components/agent.css')
  return (
    <div class={`agent-edit stack ${cls ?? ''}`}>
      <Card
        heading={
          <span class="agent-heading">
            API キーと全体の上限
            {settings.configured ? <Chip tone="success">有効</Chip> : <Chip>無効</Chip>}
          </span>
        }
        description={
          manage.isAdmin
            ? 'このアイテムだけで使う Anthropic の API キーです。キーは暗号化して保存し、画面には出しません。キーを入れるまで、学生は使えません。'
            : 'API キーと全体の上限は管理者が設定します。キーが入るまで、学生は使えません。'
        }
      >
        {manage.isAdmin ? (
          <>
            <form method="post" action={`${base}/key`} class="stack" data-loading-form {...validateWith('agentKey')}>
              <TextField
                label="Anthropic の API キー"
                name="api_key"
                id="f-agent-api-key"
                type="password"
                autocomplete="off"
                placeholder={settings.configured ? `…${settings.apiKeyHint}（変えるときだけ入力）` : 'sk-ant-…'}
                hint={`保存するときに、このキーで ${AGENT_MODEL_LABEL} を使えるかを確かめます。`}
              />
              <TextField
                label="アイテム全体の上限（USD）"
                name="total_limit"
                id="f-agent-total-limit"
                inputmode="decimal"
                value={String(settings.totalLimit)}
                hint="学生全員で使える額です。達すると、全員が使えなくなります。"
              />
              <div class="form-actions">
                <Button type="submit" variant="primary">
                  {settings.configured ? '保存' : '保存して有効にする'}
                </Button>
              </div>
            </form>
            {settings.configured && (
              <form
                method="post"
                action={`${base}/key/delete`}
                class="agent-key-delete"
                data-confirm="API キーを削除しますか？学生は使えなくなります。"
              >
                <Button type="submit" variant="danger-outline" size="sm" icon="trash">
                  キーを削除して無効にする
                </Button>
              </form>
            )}
          </>
        ) : (
          <p class="muted small">アイテム全体の上限: {formatUsd(settings.totalLimit)}</p>
        )}
      </Card>
      <Card
        heading="利用状況"
        description={`${formatUsd(manage.spent)} / ${formatUsd(settings.totalLimit)}（${usagePercent(manage.spent, settings.totalLimit)}%）・VS Code でつないだ PC ${manage.tokens} 台`}
      >
        {manage.users.length ? (
          <Table
            columns={[
              { label: '名前' },
              { label: '使った額' },
              { label: '1 人の上限に対して', class: 'hide-sm' },
              { label: '最後に使った日時', class: 'hide-sm' },
            ]}
          >
            {manage.users.map((u) => (
              <tr>
                <td>
                  <span class="strong">{u.name}</span>
                  {u.username && <span class="muted small"> @{u.username}</span>}
                </td>
                <td>{formatUsd(u.cost)}</td>
                <td class="hide-sm">{usagePercent(u.cost, settings.userLimit)}%</td>
                <td class="hide-sm">{formatDateTime(u.lastAt)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p class="muted small">まだ誰も使っていません。</p>
        )}
      </Card>
    </div>
  )
}
