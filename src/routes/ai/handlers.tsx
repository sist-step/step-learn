// DB を開くモジュールを読み込まず、モードごとの違いを AiBackend で受け取るのは、Moodle モード（moodle-mode/app.tsx）も同じハンドラを使うため
import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import { AiPanel, type AiCardChange, type AiChatEntry, type AiPanelProps } from '../../components/ai-panel'
import { AI_MODEL_LABELS, AI_MODELS, aiProvider, isAiModel, isProviderEnabled } from '../../lib/ai'
import { quotaNote, quotaProblem, type AiAgent, type AiAgentEvent } from '../../lib/ai-agent'
import { chatRevision, type AiChatContent } from '../../lib/ai-chat'
import type { AiChange } from '../../lib/ai-tool-kit'
import { diffHunks, diffLines } from '../../lib/diff'
import { firstError, validate } from '../../lib/forms'
import { field, readForm, sameOriginReferer, wantsJson } from '../../lib/http'
import type { AppEnv, User } from '../../lib/types'

export type AiBackend = {
  agent: AiAgent
  /** ログインしている人が AI を使えるか */
  canUse: (c: Context<AppEnv>) => boolean | Promise<boolean>
}

const TOOL_FALLBACK_LABEL = 'ツールを使いました'

// 変更前と変更後を丸ごと並べないのは、長いページの 1 行だけを直す提案で、どこが変わるのかが見つけられないため
const cardChange = ({ label, before, after, long }: AiChange): AiCardChange =>
  long ? { label, hunks: diffHunks(diffLines(before, after), 1) } : { label, before, after }

function entriesOf({ messages, labels, cards }: AiChatContent): AiChatEntry[] {
  return messages.flatMap((m): AiChatEntry[] => {
    if (m.role === 'user') return [{ kind: 'user', text: m.content }]
    if (m.role !== 'assistant') return []
    return [
      ...(m.content ? [{ kind: 'assistant' as const, text: m.content }] : []),
      ...(m.toolCalls ?? []).map((t): AiChatEntry => {
        const card = cards[t.id]
        if (!card) return { kind: 'tool', label: labels[t.id] ?? TOOL_FALLBACK_LABEL }
        return { kind: 'card', callId: t.id, title: card.title, changes: card.changes.map(cardChange), state: card.state, note: card.note }
      }),
    ]
  })
}

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
  // リバースプロキシの設定に任せないのは、応答をためられると、言い終えるまで画面に何も出ないため
  'X-Accel-Buffering': 'no',
}

function streamEvents(c: Context<AppEnv>, task: (emit: (event: AiAgentEvent) => void) => Promise<void>) {
  for (const [name, value] of Object.entries(NDJSON_HEADERS)) c.header(name, value)
  return stream(c, (s) => task((event) => void s.write(`${JSON.stringify(event)}\n`)))
}

export function createAiHandlers({ agent, canUse }: AiBackend) {
  const { chats, ledger } = agent
  const enabledModels = () => AI_MODELS.filter((m) => isProviderEnabled(aiProvider(m)) && ledger.isModelAvailable(m))

  function panelProps(user: User): AiPanelProps {
    const chat = chats.currentChat(user.id)
    return {
      models: enabledModels().map((m) => ({ value: m, label: AI_MODEL_LABELS[m], problem: quotaProblem(ledger.getQuota(user.id, m)) })),
      revision: chatRevision(chat),
      chat: chat && {
        id: chat.id,
        modelLabel: AI_MODEL_LABELS[chat.model],
        entries: entriesOf(chat.content),
        busy: agent.isRunning(user.id),
      },
      quota: chat ? quotaNote(ledger.getQuota(user.id, chat.model)) : '',
    }
  }

  /** AppShell の右に出すパネル。使えるかは呼ぶ側で確かめる */
  const renderPanel = (user: User) => <AiPanel {...panelProps(user)} />

  /** パネルだけのページ。client.ts が応答のあとや、ほかのタブでの発言を反映するときに、パネルを取り直すのに使う */
  async function show(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    return c.render(<AiPanel {...panelProps(user)} />, { title: 'AI アシスタント' })
  }

  /** パネルの版と応答の作成中か。client.ts が、パネルを取り直すべきかを確かめるのに使う */
  async function state(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    c.header('Cache-Control', 'no-store')
    return c.json({ revision: chatRevision(chats.currentChat(user.id)), busy: agent.isRunning(user.id) })
  }

  async function send(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const result = validate('aiMessage', await readForm(c))
    return streamEvents(c, async (emit) => {
      if (!result.ok) return emit({ type: 'error', message: firstError(result.errors), retract: true })
      const { message, model, chat: chatId, page, revision } = result.values

      let chat = chats.currentChat(user.id)
      // 古い画面からの発言を今のチャットに足さないのは、利用者が読んでいない発言を踏まえた応答になり、チャットがないと思って送ると、ほかのタブのチャットを消して始めてしまうため
      if (revision !== chatRevision(chat)) return emit({ type: 'outdated' })
      if (chatId) {
        if (!chat || String(chat.id) !== chatId) {
          emit({ type: 'error', message: 'このチャットは閉じられています。新しいチャットで送り直してください。', retract: true })
          return emit({ type: 'closed' })
        }
        // 断るだけで閉じずにおかないのは、使えなくなったモデルのチャットが残ると、新しいチャットを始められないため
        if (!enabledModels().includes(chat.model)) {
          chats.closeChat(user.id)
          emit({
            type: 'error',
            message: `${AI_MODEL_LABELS[chat.model]} は今は使えません。新しいチャットで送り直してください。`,
            retract: true,
          })
          return emit({ type: 'closed' })
        }
      } else {
        if (!isAiModel(model) || !enabledModels().includes(model))
          return emit({ type: 'error', message: 'モデルを選んでください。', retract: true })
        // チャットを作る前に確かめるのは、使えないモデルで始めたチャットが残ると、モデルを選び直せなくなるため
        const problem = quotaProblem(ledger.getQuota(user.id, model))
        if (problem) return emit({ type: 'error', message: problem, retract: true })
        chat = chats.startChat(user.id, model)
        emit({ type: 'chat', id: chat.id })
      }
      await agent.send({ c, chat, message, page }, emit)
      // 何も残らなかったチャットを閉じるのは、最初の発言が失敗したとき、モデルを選び直して始められるようにするため
      if (chat.content.messages.length === 0) {
        chats.closeChat(user.id)
        emit({ type: 'closed' })
      }
    })
  }

  async function decide(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const form = await readForm(c)
    const callId = field(form, 'call', 200)
    const approve = field(form, 'decision', 10) === 'approve'
    const page = field(form, 'page', 500)
    return streamEvents(c, async (emit) => {
      const chat = chats.currentChat(user.id)
      if (!chat || String(chat.id) !== field(form, 'chat', 20)) {
        emit({ type: 'error', message: 'このチャットは閉じられています。' })
        return emit({ type: 'closed' })
      }
      await agent.decide({ c, chat, callId, approve, page }, emit)
    })
  }

  async function close(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const chatId = field(await readForm(c), 'chat', 20)
    // 開いていたチャットでなければ閉じないのは、ほかのタブで始めた、まだ見ていないチャットを消さないため
    if (String(chats.currentChat(user.id)?.id ?? '') === chatId) chats.closeChat(user.id)
    if (wantsJson(c)) return c.json({ ok: true })
    return c.redirect(sameOriginReferer(c, '/dashboard'), 303)
  }

  return { renderPanel, show, state, send, decide, close }
}

export type AiHandlers = ReturnType<typeof createAiHandlers>

export function aiRoutes(h: AiHandlers) {
  const app = new Hono<AppEnv>()
  app.get('/chat', h.show)
  app.get('/chat/state', h.state)
  app.post('/chat', h.send)
  app.post('/chat/confirm', h.decide)
  app.post('/chat/close', h.close)
  return app
}
