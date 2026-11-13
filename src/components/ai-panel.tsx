// lib/ai-usage.ts などを読み込まず、描く内容を props で受け取るのは、AppShell を使う Moodle モードから DB を開くモジュールを読み込まないため
import type { AiUsageMeter } from '../lib/ai-agent'
import type { AiCardState } from '../lib/ai-chat'
import type { AiTouched } from '../lib/ai-tool-kit'
import type { DiffLine } from '../lib/diff'
import { Button, IconButton } from './button'
import { FieldError, SegmentedControl, validateWith } from './form'
import { Icon } from './icons'
import { Markdown } from './markdown'
import { Mascot } from './mascot'
import { Popover } from './overlay'
import { useStyle } from './style'

/** 確認カードの 1 行。複数行の文章は差分（hunks）で見せる */
export type AiCardChange = { label: string; before: string; after: string } | { label: string; hunks: DiffLine[][] }

export type AiChatEntry =
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'stopped' }
  | { kind: 'compacted' }
  | { kind: 'tool'; label: string; touched?: AiTouched }
  | { kind: 'card'; callId: string; title: string; changes: AiCardChange[]; state: AiCardState; note?: string; touched?: AiTouched }

/**
 * hardLabel は「難しい依頼」を選んだときに答えるモデル（なければ選べない）、hardOff はそれを今使えない短い理由、
 * problem は今そのモデルを使えない理由、usage はそのモデルで使う今週の枠の使い具合
 */
export type AiModelOption = {
  value: string
  label: string
  hardLabel: string | null
  hardOff: string | null
  problem: string | null
  usage: AiUsageMeter[]
}

export type AiPanelProps = {
  models: readonly AiModelOption[]
  /** チャットの版（lib/ai-chat.ts の chatRevision） */
  revision: string
  /**
   * hard は最後の発言で「難しい依頼」を選んでいたこと、replies は最後の応答のあとに出す、押して送れる続きの依頼、
   * context は会話の大きさ（lib/ai-agent.ts の contextPercent）
   */
  chat: {
    id: number
    model: AiModelOption
    hard: boolean
    entries: AiChatEntry[]
    replies: string[]
    busy: boolean
    context: number
  } | null
}

export const AI_PANEL_ID = 'ai-panel'

const SUGGESTIONS = [
  'このコースの構成を要約して',
  '開いているページの誤字や分かりにくい表現を直して',
  '新しいセクションを作って、授業の流れを説明するページを追加して',
]

// 差分を全部出さないのは、ページを丸ごと書き換える提案で、カードがパネルより長くなり、実行するボタンまでたどり着けないため
const MAX_DIFF_LINES = 40

const DIFF_MARKS: Record<DiffLine['kind'], string> = { add: '+', remove: '-', same: ' ' }

function DiffView({ hunks }: { hunks: DiffLine[][] }) {
  const rows = hunks.flatMap((hunk, i) => [...(i > 0 ? [null] : []), ...hunk])
  const shown = rows.slice(0, MAX_DIFF_LINES)
  return (
    <div class="ai-diff">
      {shown.map((line) =>
        line ? (
          <div class={`ai-diff-line is-${line.kind}`}>
            <span class="ai-diff-mark" aria-hidden="true">
              {DIFF_MARKS[line.kind]}
            </span>
            <span class="sr-only">{line.kind === 'add' ? '追加: ' : line.kind === 'remove' ? '削除: ' : ''}</span>
            {line.text || ' '}
          </div>
        ) : (
          <div class="ai-diff-gap" aria-hidden="true">
            ⋯
          </div>
        ),
      )}
      {rows.length > shown.length && <p class="ai-diff-more">ほか {rows.length - shown.length} 行</p>}
    </div>
  )
}

const CARD_STATE_LABELS: Record<AiCardState, string> = {
  pending: '実行してよいか確認してください',
  approved: '実行しました',
  rejected: '実行せずに取り消しました',
  failed: '実行できませんでした',
}

const Card = ({ entry, chatId }: { entry: Extract<AiChatEntry, { kind: 'card' }>; chatId: number }) => (
  <div class="ai-card" data-state={entry.state}>
    <p class="ai-card-title">
      <Icon name="pencil" size={15} />
      <strong>{entry.title}</strong>
    </p>
    <dl class="ai-card-changes">
      {entry.changes.map((change) => (
        <div class="ai-change">
          <dt>{change.label}</dt>
          <dd>
            {'hunks' in change ? (
              <DiffView hunks={change.hunks} />
            ) : (
              <span class="ai-change-values">
                <s class="ai-change-before">{change.before || '（なし）'}</s>
                <Icon name="chevronRight" size={14} />
                <span class="ai-change-after">{change.after || '（なし）'}</span>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
    {entry.state === 'pending' ? (
      <form method="post" action="/ai/chat/confirm" class="ai-card-actions" data-ai-confirm>
        <input type="hidden" name="chat" value={String(chatId)} />
        <input type="hidden" name="call" value={entry.callId} />
        <span class="ai-card-ask">{CARD_STATE_LABELS.pending}</span>
        <Button type="submit" name="decision" value="reject" size="sm" variant="ghost">
          取り消す
        </Button>
        <Button type="submit" name="decision" value="approve" size="sm" variant="primary" icon="check">
          実行する
        </Button>
      </form>
    ) : (
      <p class="ai-card-state">
        <Icon name={entry.state === 'approved' ? 'checkCircle' : entry.state === 'failed' ? 'alert' : 'x'} size={15} />
        {CARD_STATE_LABELS[entry.state]}
        {entry.state === 'failed' && entry.note && `（${entry.note}）`}
        {entry.touched && <SpotLink touched={entry.touched} />}
      </p>
    )}
  </div>
)

const Entry = ({ entry, chatId }: { entry: AiChatEntry; chatId: number }) => {
  if (entry.kind === 'card') return <Card entry={entry} chatId={chatId} />
  if (entry.kind === 'tool') return <ToolLine label={entry.label} touched={entry.touched} />
  if (entry.kind === 'user') return <UserMessage text={entry.text} />
  if (entry.kind === 'stopped') return <StoppedLine />
  if (entry.kind === 'compacted') return <CompactedLine />
  return (
    <div class="ai-msg ai-msg-assistant">
      <Markdown source={entry.text} class="ai-prose" />
    </div>
  )
}

const UserMessage = ({ text }: { text?: string }) => (
  <div class="ai-msg ai-msg-user">
    <p data-ai-text>{text}</p>
  </div>
)

/** AI が変えたものを開き、開いた画面でそれを強調するリンク（client.ts が data-ai-spot の AiTouched を読む） */
const SpotLink = ({ touched }: { touched?: AiTouched }) => (
  <a href={touched?.href} class="ai-spot-link" data-ai-spot={touched && JSON.stringify(touched)} hidden={!touched}>
    開く
    <Icon name="chevronRight" size={12} />
  </a>
)

/** 押すとそのまま送る続きの依頼。client.ts も data-ai-template="replies" を複製して、応答の最後に出す */
const Replies = ({ replies = [] }: { replies?: string[] }) => (
  <div class="ai-replies" role="group" aria-label="続けて頼む" data-ai-replies>
    {replies.map((r) => (
      <ReplyButton text={r} />
    ))}
  </div>
)

const ReplyButton = ({ text }: { text?: string }) => (
  <button type="button" class="ai-reply" data-ai-suggest={text}>
    <span data-ai-text>{text}</span>
    <Icon name="arrowUp" size={14} />
  </button>
)

const StoppedLine = () => (
  <p class="ai-tool ai-stopped">
    <Icon name="stop" size={15} />
    生成を停止しました
  </p>
)

const CompactedLine = () => (
  <p class="ai-compacted" role="note">
    これまでの会話を要約しました
  </p>
)

const ToolLine = ({ label, touched }: { label?: string; touched?: AiTouched }) => (
  <p class="ai-tool">
    <Icon name="checkCircle" size={15} />
    <span data-ai-text>{label}</span>
    <SpotLink touched={touched} />
  </p>
)

const Intro = ({ models }: { models: readonly AiModelOption[] }) => (
  <div class="ai-intro" data-ai-intro>
    <Mascot act="greet" size={76} stand={false} />
    <h2 class="ai-intro-title">なにかお手伝いできますか？</h2>
    <div class="ai-suggestions">
      {SUGGESTIONS.map((s) => (
        <button type="button" class="ai-suggestion" data-ai-suggest={s}>
          {s}
        </button>
      ))}
    </div>
    {models.some((m) => m.problem) && (
      <ul class="ai-problems">
        {models
          .filter((m) => m.problem)
          .map((m) => (
            <li>
              <strong>{m.label}</strong>: {m.problem}
            </li>
          ))}
      </ul>
    )}
  </div>
)

// 8 割から色を変えるのは、使い切る前に「難しい依頼」を控えるかを決められるようにするため
const isHigh = (meter: AiUsageMeter) => meter.state === 'ok' && meter.percent >= 80

const hardName = (off: string | null) => (off ? `難しい依頼（${off}）` : '難しい依頼')

/** 枠ごとの使い具合のバー。client.ts が応答のあと、data-ai-meter の同じ key の行をすべて書き換える */
const Meter = ({ meter }: { meter: AiUsageMeter }) => (
  <div
    class="ai-meter"
    data-ai-meter={meter.key}
    data-state={meter.state}
    data-high={isHigh(meter) ? '' : undefined}
    style={`--ai-used:${meter.percent}%`}
  >
    <div class="ai-meter-top">
      <span class="ai-meter-label">{meter.label}</span>
      <span class="ai-meter-value">
        <span data-ai-meter-percent>{meter.percent}</span>% 使用
      </span>
    </div>
    <div
      class="ai-meter-track"
      role="progressbar"
      aria-label={`${meter.label}の今週の使用量`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={meter.percent}
    >
      <span class="ai-meter-fill" />
    </div>
    <p class="ai-meter-note" data-ai-meter-note>
      {meter.note}
    </p>
  </div>
)

/** 入力欄の下の、今週の枠の使い具合。モデルを選べるときはモデルごとに描き、client.ts が選んだモデルのものだけを出す */
const contextLabel = (percent: number) => `会話の長さ（${percent}%）`

/** 会話の大きさ。client.ts（paintAiContext）が応答のあとに書き換える */
const ContextMeter = ({ percent }: { percent: number }) => (
  <Popover
    class="ai-usage-pop ai-context-pop"
    panelClass="ai-usage-panel"
    trigger={
      <summary class="ai-usage-trigger" aria-label={contextLabel(percent)} data-ai-context style={`--ai-used:${percent}%`}>
        <span class="ai-context-ring" aria-hidden="true" />
        <span class="ai-usage-text">
          会話 <span data-ai-context-percent>{percent}</span>%
        </span>
      </summary>
    }
  >
    <div class="ai-usage-head">
      <strong>会話の長さ</strong>
    </div>
    <p class="ai-context-note">
      AI に送っている会話の量です。100%
      になると、次に送るときに古いやり取りを要約して、続きから話せるようにします。パネルの会話はそのまま残ります。
    </p>
  </Popover>
)

const Usage = ({ option, hidden }: { option: AiModelOption; hidden: boolean }) => {
  const [main] = option.usage
  if (!main) return null
  return (
    <div class="ai-usage" data-ai-usage={option.value} hidden={hidden}>
      <Popover
        class="ai-usage-pop"
        panelClass="ai-usage-panel"
        trigger={
          <summary class="ai-usage-trigger" aria-label={`今週の利用状況（${main.label} ${main.percent}% 使用）`} data-ai-usage-trigger>
            <span class="ai-usage-bars" aria-hidden="true">
              {option.usage.map((m) => (
                <span
                  class="ai-usage-bar"
                  data-ai-meter={m.key}
                  data-state={m.state}
                  data-high={isHigh(m) ? '' : undefined}
                  style={`--ai-used:${m.percent}%`}
                />
              ))}
            </span>
            <span class="ai-usage-text">
              今週 <span data-ai-usage-main>{main.percent}</span>%
            </span>
          </summary>
        }
      >
        <div class="ai-usage-head">
          <strong>今週の利用状況</strong>
          <span>{option.label}</span>
        </div>
        <div class="ai-meters">
          {option.usage.map((m) => (
            <Meter meter={m} />
          ))}
        </div>
      </Popover>
    </div>
  )
}

export const AiPanelToggle = () => (
  <IconButton
    icon="assistant"
    label="AI アシスタント"
    iconSize={18}
    class="ai-panel-toggle"
    data-ai-toggle
    aria-controls={AI_PANEL_ID}
    aria-expanded="false"
  />
)

export const AiPanel = ({ models, revision, chat }: AiPanelProps) => {
  useStyle('/src/components/ai-panel.css')
  useStyle('/src/components/markdown.css')
  const usable = models.filter((m) => !m.problem)
  const current = chat?.model ?? usable[0]
  const hard = !!chat?.hard && !!current?.hardLabel && !current.hardOff
  const choices = chat ? [chat.model] : usable
  // 選べるモデルごとの名前を渡すのは、モデルや「難しい依頼」を切り替えたとき、client.ts がヘッダーの名前を書き換えるため
  const labels = Object.fromEntries(choices.map((m) => [m.value, { label: m.label, hard: m.hardLabel, hardOff: m.hardOff }]))
  return (
    <aside
      id={AI_PANEL_ID}
      class="ai-panel"
      aria-label="AI アシスタント"
      data-persist
      data-keep
      data-confirm-scope
      data-ai-panel
      data-chat={chat?.id}
      data-model={chat?.model.value}
      data-revision={revision}
      data-busy={chat?.busy ? '' : undefined}
    >
      <header class="ai-panel-head">
        <Icon name="assistant" size={18} class="ai-panel-mark" />
        <div class="ai-panel-heading">
          <strong>AI アシスタント</strong>
          {current && (
            <span class="ai-panel-model" data-ai-model>
              {hard ? current.hardLabel : current.label}
            </span>
          )}
        </div>
        {chat && (
          <form method="post" action="/ai/chat/close" data-ai-close data-confirm="このチャットを閉じますか？閉じた会話は開き直せません。">
            <input type="hidden" name="chat" value={String(chat.id)} />
            <IconButton type="submit" icon="pencilSquare" label="チャットを閉じて新しく始める" />
          </form>
        )}
        <IconButton icon="x" label="パネルを閉じる" data-ai-toggle aria-controls={AI_PANEL_ID} />
      </header>

      <div class="ai-log" data-ai-log>
        {chat ? chat.entries.map((e) => <Entry entry={e} chatId={chat.id} />) : <Intro models={models} />}
        {chat && !chat.busy && chat.replies.length > 0 && <Replies replies={chat.replies} />}
        {chat?.busy && (
          <p class="ai-tool ai-pending">
            <span class="ai-dots" aria-hidden="true" />
            応答を作成しています…
          </p>
        )}
      </div>

      <form
        method="post"
        action="/ai/chat"
        class="ai-composer"
        data-ai-form
        data-ai-labels={JSON.stringify(labels)}
        {...validateWith('aiMessage')}
      >
        <input type="hidden" name="chat" value={chat ? String(chat.id) : ''} />
        <input type="hidden" name="hard" value={hard ? '1' : ''} />
        {chat && <input type="hidden" name="model" value={chat.model.value} />}
        {!chat && usable.length > 1 && (
          <SegmentedControl
            name="model"
            label="モデル"
            class="ai-models"
            options={usable.map((m) => ({ value: m.value, label: m.label }))}
          />
        )}
        {!chat && usable.length === 1 && <input type="hidden" name="model" value={usable[0].value} />}
        <div class="field ai-input">
          {/* title を空にするのは、ブラウザ標準のツールチップが CSS のチップと重なって 2 つ出るため */}
          <IconButton
            icon="lightBulb"
            label={hardName(current?.hardOff ?? null)}
            title=""
            class="ai-hard"
            data-ai-hard
            aria-pressed={hard ? 'true' : 'false'}
            hidden={!current?.hardLabel}
            disabled={!!current?.hardOff}
          />
          <textarea
            id="ai-message"
            name="message"
            rows={1}
            class="ai-textarea"
            placeholder={usable.length || chat ? 'AI に頼みたいことを入力' : '今は AI を使えません'}
            aria-label="メッセージ"
            aria-describedby="ai-message-error"
            disabled={!chat && usable.length === 0}
          />
          <IconButton type="submit" icon="arrowUp" label="送信" class="ai-send" disabled={!chat && usable.length === 0} />
          <IconButton icon="stop" label="生成を停止" class="ai-stop" data-ai-stop />
        </div>
        <FieldError id="ai-message" />
        <div class="ai-foot">
          {choices.map((m) => (
            <Usage option={m} hidden={m.value !== current?.value} />
          ))}
          {chat && <ContextMeter percent={chat.context} />}
          <p class="ai-note">Shift + Enter で改行</p>
        </div>
      </form>

      <template data-ai-template="user">
        <UserMessage />
      </template>
      <template data-ai-template="assistant">
        <div class="ai-msg ai-msg-assistant">
          <div class="prose ai-prose" data-ai-text />
        </div>
      </template>
      <template data-ai-template="tool">
        <ToolLine />
      </template>
      <template data-ai-template="replies">
        <Replies />
      </template>
      <template data-ai-template="reply">
        <ReplyButton />
      </template>
      <template data-ai-template="pending">
        <p class="ai-tool ai-pending">
          <span class="ai-dots" aria-hidden="true" />
          <span data-ai-pending-label>考えています…</span>
        </p>
      </template>
      <template data-ai-template="compacted">
        <CompactedLine />
      </template>
      <template data-ai-template="stopped">
        <StoppedLine />
      </template>
      <template data-ai-template="error">
        <p class="ai-error" role="alert">
          <Icon name="alert" size={15} />
          <span data-ai-text />
        </p>
      </template>
    </aside>
  )
}
