import type { Context } from 'hono'
import { stream } from 'hono/streaming'
import { AiPanel, type AiChatEntry, type AiPanelProps } from '../../components/ai-panel'
import { AI_MODEL_LABELS, AI_MODELS, aiProvider, isAiModel, isProviderEnabled } from '../../lib/ai'
import { isAgentRunning, quotaNote, quotaProblem, runAgent, type AiAgentEvent } from '../../lib/ai-agent'
import { closeChat, currentChat, startChat, type AiChatContent } from '../../lib/ai-chat'
import { canUseAi, getQuota } from '../../lib/ai-usage'
import { firstError, validate } from '../../lib/forms'
import { readForm, sameOriginReferer, wantsJson } from '../../lib/http'
import type { AppEnv, User } from '../../lib/types'

const TOOL_FALLBACK_LABEL = 'ツールを使いました'

function entriesOf({ messages, labels }: AiChatContent): AiChatEntry[] {
  return messages.flatMap((m): AiChatEntry[] => {
    if (m.role === 'user') return [{ kind: 'user', text: m.content }]
    if (m.role !== 'assistant') return []
    return [
      ...(m.content ? [{ kind: 'assistant' as const, text: m.content }] : []),
      ...(m.toolCalls ?? []).map((t) => ({ kind: 'tool' as const, label: labels[t.id] ?? TOOL_FALLBACK_LABEL })),
    ]
  })
}

const enabledModels = () => AI_MODELS.filter((m) => isProviderEnabled(aiProvider(m)))

function panelProps(user: User): AiPanelProps {
  const chat = currentChat(user.id)
  return {
    models: enabledModels().map((m) => ({ value: m, label: AI_MODEL_LABELS[m], problem: quotaProblem(getQuota(user.id, m)) })),
    chat: chat && {
      id: chat.id,
      modelLabel: AI_MODEL_LABELS[chat.model],
      entries: entriesOf(chat.content),
      busy: isAgentRunning(user.id),
    },
    quota: chat ? quotaNote(getQuota(user.id, chat.model)) : '',
  }
}

/** AppShell の右に出すパネル。使えない利用者には何も描かない */
export const renderAiPanel = (user: User | null) => (user && canUseAi(user) ? <AiPanel {...panelProps(user)} /> : null)

/** パネルだけのページ。client.ts がチャットを閉じたあとや、応答の作成中に開いたときに、パネルを取り直すのに使う */
export async function show(c: Context<AppEnv>) {
  const user = c.var.user!
  if (!canUseAi(user)) return c.notFound()
  return c.render(<AiPanel {...panelProps(user)} />, { title: 'AI アシスタント' })
}

export async function send(c: Context<AppEnv>) {
  const user = c.var.user!
  if (!canUseAi(user)) return c.notFound()
  const result = validate('aiMessage', await readForm(c))
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  // リバースプロキシの設定に任せないのは、応答をためられると、言い終えるまで画面に何も出ないため
  c.header('X-Accel-Buffering', 'no')
  return stream(c, async (s) => {
    const emit = (event: AiAgentEvent) => void s.write(`${JSON.stringify(event)}\n`)
    if (!result.ok) return emit({ type: 'error', message: firstError(result.errors), retract: true })
    const { message, model, chat: chatId, page } = result.values

    let chat = currentChat(user.id)
    if (chatId) {
      if (!chat || String(chat.id) !== chatId) {
        emit({ type: 'error', message: 'このチャットは閉じられています。新しいチャットで送り直してください。', retract: true })
        return emit({ type: 'closed' })
      }
    } else {
      if (!isAiModel(model) || !enabledModels().includes(model))
        return emit({ type: 'error', message: 'モデルを選んでください。', retract: true })
      // チャットを作る前に確かめるのは、使えないモデルで始めたチャットが残ると、モデルを選び直せなくなるため
      const problem = quotaProblem(getQuota(user.id, model))
      if (problem) return emit({ type: 'error', message: problem, retract: true })
      chat = startChat(user.id, model)
      emit({ type: 'chat', id: chat.id })
    }
    await runAgent({ user, chat, message, page }, emit)
    // 何も残らなかったチャットを閉じるのは、最初の発言が失敗したとき、モデルを選び直して始められるようにするため
    if (chat.content.messages.length === 0) {
      closeChat(user.id)
      emit({ type: 'closed' })
    }
  })
}

export async function close(c: Context<AppEnv>) {
  const user = c.var.user!
  if (!canUseAi(user)) return c.notFound()
  closeChat(user.id)
  if (wantsJson(c)) return c.json({ ok: true })
  return c.redirect(sameOriginReferer(c, '/dashboard'), 303)
}
