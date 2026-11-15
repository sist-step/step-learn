import {
  AGENT_CLAUDE_MODELS,
  AGENT_PROVIDER_LABELS,
  AGENT_PROVIDERS,
  AGENT_STATE_MESSAGES,
  MAX_AGENT_PERIOD,
  agentModelLabel,
  isAgentOpen,
  usagePercent,
  type AgentModel,
  type AgentProvider,
  type AgentSettings,
  type AgentState,
  type AgentManageView,
  type AgentView,
} from '../lib/agent'
import type { OpenRouterModelInfo } from '../lib/ai-models'
import { VSCODE_EXTENSION_NAME, VSCODE_MARKETPLACE_URL } from '../lib/bundle'
import type { FieldErrors } from '../lib/forms'
import { Button } from './button'
import { cx } from './cx'
import { Card, LinkCard, Table } from './card'
import { DateTimeField, FieldError, TextField, validateWith } from './form'
import { Icon } from './icons'
import { MarkdownEditor } from './markdown'
import { useStyle } from './style'
import { Alert, Chip, EmptyState, Progress, formatDateTime } from './ui'

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
          <span class="muted small">
            開いているフォルダーのファイルを、AI（{agentModelLabel(settings.model)}）が読み書きしてプログラムを書きます
          </span>
        </span>
        <form method="post" action={`${base}/launch`} data-vscode-launch>
          <Button type="submit" variant="primary" iconEnd="external">
            VS Code で使う
          </Button>
        </form>
      </LinkCard>
      <div class="agent-help muted small">
        <p>
          VS Code に拡張機能「{VSCODE_EXTENSION_NAME}」を入れてから押してください。使える期間のあいだだけ、VS Code
          の右側のサイドバーに「STEP Learn」が出ます。
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

/** 説明の欄に添える、AI にも渡ることの案内 */
export const AGENT_BODY_HINT = '学生に見せるほか、AI にも渡します（課題の内容など）。学生に見せない指示は、下の「AI への指示」に書きます。'

const INSTRUCTIONS_PLACEHOLDER = [
  '- 答えのコードをそのまま書かず、まずヒントを出す',
  '- Python の標準ライブラリだけを使う',
  '- 変数名は英語、コメントは日本語で書く',
].join('\n')

/** 編集画面の、教師が書く AI への指示の欄（保存のフォームの中）。説明の欄の下に置く */
export const AgentInstructionsField = ({ value, error, id = 'f-instructions' }: { value: string; error?: string; id?: string }) => (
  <MarkdownEditor
    label="AI への指示（任意）"
    name="instructions"
    id={id}
    value={value}
    error={error}
    placeholder={INSTRUCTIONS_PLACEHOLDER}
    hint="このアイテムの AI が、どの依頼でも守る決まりを書きます（答え方、使ってよい書き方、してはいけないことなど）。学生には表示しません。"
    rows={8}
  />
)

type PeriodProps = { opensAt: string; closesAt: string; userLimit: string; errors: FieldErrors; idPrefix?: string }

const PERIOD_DESCRIPTION = `学生は、この期間のあいだだけ VS Code で使えます。長さは ${MAX_AGENT_PERIOD / 3600} 時間までです。`

const PeriodInputs = ({ opensAt, closesAt, userLimit, errors, idPrefix = 'f' }: PeriodProps) => (
  <div class="stack">
    <DateTimeField label="開始日時" name="opens_at" id={`${idPrefix}-opens_at`} value={opensAt} error={errors.opens_at} />
    <DateTimeField label="終了日時" name="closes_at" id={`${idPrefix}-closes_at`} value={closesAt} error={errors.closes_at} />
    <TextField
      label="1 人あたりの上限（USD）"
      name="user_limit"
      id={`${idPrefix}-user_limit`}
      inputmode="decimal"
      value={userLimit}
      error={errors.user_limit}
      hint="このアイテムで 1 人が使える額です。学生には額ではなく、使った割合だけを見せます。"
    />
  </div>
)

/** 編集画面の右の列に置く、使える期間と 1 人あたりの上限のカード（保存のフォームの中） */
export const AgentPeriodCard = (props: PeriodProps) => (
  <Card heading="使える期間と上限" description={PERIOD_DESCRIPTION}>
    <PeriodInputs {...props} />
  </Card>
)

/** Moodle モードの入力欄の、使える期間と 1 人あたりの上限の欄 */
export const AgentPeriodFields = (props: PeriodProps) => (
  <fieldset class="field">
    <legend>使える期間と上限</legend>
    <p class="field-hint">{PERIOD_DESCRIPTION}</p>
    <PeriodInputs {...props} />
  </fieldset>
)

/** 編集画面のモデルの一覧で、Claude のモデルの名前の下に出す一言。倍は Haiku に対する料金 */
const CLAUDE_NOTES: Record<(typeof AGENT_CLAUDE_MODELS)[number], string> = {
  'claude-haiku-5-5': '安くて速い（ふだんの授業向け）',
  'claude-sonnet-5-5': '難しい作業もこなす（約 20 倍）',
  'claude-opus-5-5': 'いちばん賢い（約 40 倍）',
}

/** client.ts がカーソルを重ねたときの説明（lib/agent.ts の agentModelFacts）を作るのに使う、OpenRouter のモデルの情報 */
const openRouterData = (m: OpenRouterModelInfo) => ({
  'data-name': m.name,
  'data-ctx': String(m.contextLength),
  'data-max': m.maxOutput === null ? '' : String(m.maxOutput),
  'data-in': String(m.prompt),
  'data-out': String(m.completion),
})

const ModelOption = ({ model, checked }: { model: AgentModel; checked: boolean }) => (
  <label
    class="agent-model"
    data-agent-model={model.id}
    data-search-text={`${agentModelLabel(model)} ${model.id}`.toLowerCase()}
    {...(model.provider === 'openrouter' && openRouterData(model))}
  >
    <input type="radio" name="agent_model" value={model.id} checked={checked} />
    <span class="agent-model-text">
      <span class="agent-model-name">{agentModelLabel(model)}</span>
      <span class="agent-model-sub">{model.provider === 'anthropic' ? CLAUDE_NOTES[model.id] : model.id}</span>
    </span>
  </label>
)

type ModelPickerProps = {
  /** 選んでいるモデルの ID（agent_model の値） */
  value: string
  /** 保存してあるモデル。OpenRouter の一覧を取れないときや一覧から消えたときも、選べるように残す */
  saved: AgentModel
  /** OpenRouter の選べるモデル（lib/agent-model.ts の agentOpenRouterModels）。一覧を取れなければ null */
  models: OpenRouterModelInfo[] | null
  error?: string
  idPrefix?: string
}

/** モデルを選ぶ欄。Claude の 3 つと OpenRouter のモデルを 1 つの一覧に並べ、client.ts が検索で絞り込み、カーソルを重ねたモデルの説明を出す */
const AgentModelPicker = ({ value, saved, models, error, idPrefix = 'f' }: ModelPickerProps) => {
  useStyle('/src/components/form.css', '/src/components/agent.css')
  const id = `${idPrefix}-agent_model`
  const listed: AgentModel[] = (models ?? []).map((m) => ({ provider: 'openrouter', ...m }))
  const kept = saved.provider === 'openrouter' && !listed.some((m) => m.id === saved.id) ? [saved] : []
  // 選んでいるものを先頭にするのは、一覧が長く、開いたときに今のモデルを探さずに済むようにするため
  const openRouter = [...kept, ...listed].sort((a, b) => Number(b.id === value) - Number(a.id === value))
  const claude: AgentModel[] = AGENT_CLAUDE_MODELS.map((m) => ({ provider: 'anthropic', id: m }))
  const current = [...claude, ...openRouter].find((m) => m.id === value)
  return (
    <div class={cx('field agent-models', error && 'has-error')} data-agent-models>
      <p class="agent-models-current">
        使うモデル: <strong data-agent-model-current>{current ? agentModelLabel(current) : '未選択'}</strong>
      </p>
      <label class="search agent-models-search">
        <Icon name="search" />
        <input
          type="search"
          class="search-input"
          placeholder="名前や ID で検索"
          aria-label="モデルを検索"
          aria-controls={id}
          autocomplete="off"
          data-agent-model-search
        />
      </label>
      <div class="agent-models-list" id={id} role="radiogroup" aria-label="モデル" aria-describedby={`${id}-error ${id}-desc`}>
        <p class="agent-models-group">Claude（Anthropic）</p>
        {claude.map((m) => (
          <ModelOption model={m} checked={m.id === value} />
        ))}
        <p class="agent-models-group">
          OpenRouter<span data-agent-model-count>{openRouter.length} 件</span>
        </p>
        {models === null && (
          <p class="agent-models-note">OpenRouter のモデル一覧を読み込めませんでした。時間をおいて開き直してください。</p>
        )}
        {openRouter.map((m) => (
          <ModelOption model={m} checked={m.id === value} />
        ))}
        <p class="agent-models-note" data-agent-model-empty hidden>
          見つかりません。
        </p>
      </div>
      <FieldError id={id} error={error} />
      <p id={`${id}-desc`} class="field-hint">
        カーソルを重ねると、料金と扱える会話の長さが出ます。OpenRouter のモデルを使うには、管理者が OpenRouter の API キーを入れます。
      </p>
      <div class="agent-model-tip" id={`${id}-tip`} role="tooltip" data-agent-model-tip hidden />
    </div>
  )
}

/** 編集画面の右の列に置く、モデルを選ぶカード（保存のフォームの中） */
export const AgentModelCard = (props: ModelPickerProps) => (
  <Card heading="AI のモデル" description="モデルによって料金と賢さが大きく違います。1 人あたりの上限と合わせて選んでください。">
    <AgentModelPicker {...props} />
  </Card>
)

/** Moodle モードの入力欄の、モデルを選ぶ欄 */
export const AgentModelFields = (props: ModelPickerProps) => (
  <fieldset class="field">
    <legend>AI のモデル</legend>
    <p class="field-hint">モデルによって料金と賢さが大きく違います。1 人あたりの上限と合わせて選んでください。</p>
    <AgentModelPicker {...props} />
  </fieldset>
)

/** API キーの欄の名前（lib/forms.ts の agentKey） */
const KEY_FIELDS: Record<AgentProvider, string> = { anthropic: 'api_key', openrouter: 'openrouter_api_key' }

const KEY_PLACEHOLDERS: Record<AgentProvider, string> = { anthropic: 'sk-ant-…', openrouter: 'sk-or-…' }

const KEY_HINTS: Record<AgentProvider, string> = {
  anthropic: 'Claude のモデルで使います。保存するときに、このキーを使えるかを確かめます。',
  openrouter: 'OpenRouter のモデルで使います。保存するときに、このキーを使えるかを確かめます。',
}

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
            ? `使うモデル（${agentModelLabel(settings.model)}）には、${AGENT_PROVIDER_LABELS[settings.model.provider]} の API キーが要ります。`
            : 'API キーと全体の上限は管理者が設定します。キーが入るまで、学生は使えません。'
        }
      >
        {manage.isAdmin ? (
          <>
            <form method="post" action={`${base}/key`} class="stack" data-loading-form {...validateWith('agentKey')}>
              {AGENT_PROVIDERS.map((provider) => {
                const key = settings.keys[provider]
                return (
                  <TextField
                    label={`${AGENT_PROVIDER_LABELS[provider]} の API キー${settings.model.provider === provider ? '（使うモデルの提供元）' : ''}`}
                    name={KEY_FIELDS[provider]}
                    id={`f-agent-${provider}-key`}
                    type="password"
                    autocomplete="off"
                    placeholder={key.configured ? `…${key.hint}（変えるときだけ入力）` : KEY_PLACEHOLDERS[provider]}
                    hint={KEY_HINTS[provider]}
                  />
                )
              })}
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
            {AGENT_PROVIDERS.some((provider) => settings.keys[provider].configured) && (
              <div class="agent-key-delete row">
                {AGENT_PROVIDERS.filter((provider) => settings.keys[provider].configured).map((provider) => (
                  <form
                    method="post"
                    action={`${base}/key/delete`}
                    data-confirm={`${AGENT_PROVIDER_LABELS[provider]} の API キーを削除しますか？${settings.model.provider === provider ? '学生は使えなくなります。' : ''}`}
                  >
                    <input type="hidden" name="provider" value={provider} />
                    <Button type="submit" variant="danger-outline" size="sm" icon="trash">
                      {AGENT_PROVIDER_LABELS[provider]} のキーを削除
                    </Button>
                  </form>
                ))}
              </div>
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
