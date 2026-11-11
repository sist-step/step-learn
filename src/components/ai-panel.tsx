// lib/ai-usage.ts などを読み込まず、描く内容を props で受け取るのは、AppShell を使う Moodle モードから DB を開くモジュールを読み込まないため
import { IconButton } from './button'
import { FieldError, SegmentedControl, validateWith } from './form'
import { Icon } from './icons'
import { Markdown } from './markdown'
import { Mascot } from './mascot'
import { useStyle } from './style'

export type AiChatEntry = { kind: 'user' | 'assistant'; text: string } | { kind: 'tool'; label: string }

/** problem は今そのモデルを使えない理由 */
export type AiModelOption = { value: string; label: string; problem: string | null }

export type AiPanelProps = {
  models: readonly AiModelOption[]
  chat: { id: number; modelLabel: string; entries: AiChatEntry[]; busy: boolean } | null
  /** 開いているチャットのモデルの、今週の枠の使い具合 */
  quota: string
}

export const AI_PANEL_ID = 'ai-panel'

const SUGGESTIONS = [
  'このコースの構成を要約して',
  '開いているページの誤字や分かりにくい表現を探して',
  'このコースで非表示になっているものを教えて',
]

const Entry = ({ entry }: { entry: AiChatEntry }) => {
  if (entry.kind === 'tool') return <ToolLine label={entry.label} />
  if (entry.kind === 'user') return <UserMessage text={entry.text} />
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

const ToolLine = ({ label }: { label?: string }) => (
  <p class="ai-tool">
    <Icon name="checkCircle" size={15} />
    <span data-ai-text>{label}</span>
  </p>
)

const Intro = ({ models }: { models: readonly AiModelOption[] }) => (
  <div class="ai-intro" data-ai-intro>
    <Mascot act="greet" size={76} stand={false} />
    <h2 class="ai-intro-title">何をお手伝いしましょうか？</h2>
    <p class="ai-intro-text">
      管理しているコースの内容を読んで、質問に答えたり、教材の見直しを手伝ったりします。今はまだ、内容を変更することはできません。
    </p>
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

export const AiPanelToggle = () => (
  <IconButton
    icon="sparkles"
    label="AI アシスタント"
    iconSize={18}
    class="ai-panel-toggle"
    data-ai-toggle
    aria-controls={AI_PANEL_ID}
    aria-expanded="false"
  />
)

export const AiPanel = ({ models, chat, quota }: AiPanelProps) => {
  useStyle('/src/components/ai-panel.css')
  useStyle('/src/components/markdown.css')
  const usable = models.filter((m) => !m.problem)
  return (
    <aside
      id={AI_PANEL_ID}
      class="ai-panel"
      aria-label="AI アシスタント"
      data-persist
      data-keep
      data-ai-panel
      data-chat={chat?.id}
      data-busy={chat?.busy ? '' : undefined}
    >
      <header class="ai-panel-head">
        <Icon name="sparkles" size={18} class="ai-panel-mark" />
        <div class="ai-panel-heading">
          <strong>AI アシスタント</strong>
          {chat && <span class="ai-panel-model">{chat.modelLabel}</span>}
        </div>
        {chat && (
          <form method="post" action="/ai/chat/close" data-ai-close data-confirm="このチャットを閉じますか？閉じた会話は開き直せません。">
            <IconButton type="submit" icon="pencilSquare" label="チャットを閉じて新しく始める" />
          </form>
        )}
        <IconButton icon="x" label="パネルを閉じる" data-ai-toggle aria-controls={AI_PANEL_ID} />
      </header>

      <div class="ai-log" data-ai-log>
        {chat ? chat.entries.map((e) => <Entry entry={e} />) : <Intro models={models} />}
        {chat?.busy && (
          <p class="ai-tool ai-pending">
            <span class="ai-dots" aria-hidden="true" />
            応答を作成しています…
          </p>
        )}
      </div>

      <form method="post" action="/ai/chat" class="ai-composer" data-ai-form {...validateWith('aiMessage')}>
        <input type="hidden" name="chat" value={chat ? String(chat.id) : ''} />
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
        </div>
        <FieldError id="ai-message" />
        <p class="ai-note" data-ai-quota>
          {quota || 'Enter で送信、Shift + Enter で改行'}
        </p>
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
      <template data-ai-template="pending">
        <p class="ai-tool ai-pending">
          <span class="ai-dots" aria-hidden="true" />
          考えています…
        </p>
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
