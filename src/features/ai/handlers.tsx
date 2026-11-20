// DB を開くモジュールを読み込まず、モードごとの違いを AiBackend で受け取るのは、Moodle モード（moodle-mode/app.tsx）も同じハンドラを使うため
import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import { AiPanel, type AiCardChange, type AiChatEntry, type AiPanelProps } from './components/ai-panel'
import {
  AI_CHAT_MODELS,
  AI_MODEL_LABELS,
  AiError,
  aiProvider,
  isAiModel,
  isProviderEnabled,
  readsFiles,
  type AiFilePart,
  type AiModel,
} from './ai'
import { contextPercent, imagesLeft, MAX_CHAT_IMAGES, quotaProblem, SUGGEST_REPLIES, type AiAgent, type AiAgentEvent } from './ai-agent'
import { chatRevision, type AiCard, type AiChatContent } from './ai-chat'
import { fileKindsAccept, fileKindsLabel } from './ai-file-kinds'
import type { AiChange, AiTouched } from './ai-tool-kit'
import { isVoiceTooLong, MAX_VOICE_BYTES, MAX_VOICE_CHARS, MAX_VOICE_SECONDS, transcribe, VOICE_MODEL, voiceFormat } from './ai-voice'
import { formatBytes } from '../../lib/bytes'
import { diffHunks, diffLines } from '../../lib/diff'
import { firstError, validate } from '../../lib/forms'
import { readFields, readForm, sameOriginReferer, wantsJson } from '../../lib/http'
import { uploadProblem } from '../../lib/storage'
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

function cardEntry(callId: string, card: AiCard, touched: AiTouched | undefined): AiChatEntry {
  if (card.request)
    return {
      kind: 'file',
      callId,
      title: card.title,
      accept: fileKindsAccept(card.request.kinds),
      kinds: fileKindsLabel(card.request.kinds),
      state: card.state,
      note: card.note,
      received: card.received && { name: card.received.name, size: formatBytes(card.received.size) },
    }
  return {
    kind: 'card',
    callId,
    title: card.title,
    changes: card.changes.map(cardChange),
    state: card.state,
    note: card.note,
    touched,
  }
}

// 添字や連番にしないのは、SQLite がチャットの ID を使い回し、閉じたチャットの画像をブラウザが覚えたまま、同じ URL で別の画像を出すことになるため
const imageKey = ({ data }: AiFilePart) => crypto.createHash('sha256').update(data).digest('base64url').slice(0, 22)

const imageUrl = (file: AiFilePart) => `/ai/chat/images/${imageKey(file)}`

function entriesOf({ messages, labels, cards, touched, compactions = [] }: AiChatContent): AiChatEntry[] {
  return messages.flatMap((m, i): AiChatEntry[] => {
    const marks = compactions.includes(i) ? [{ kind: 'compacted' as const }] : []
    if (m.role === 'user') return [...marks, { kind: 'user', text: m.content, image: m.files?.[0] && imageUrl(m.files[0]) }]
    if (m.role !== 'assistant') return marks
    return [
      ...marks,
      ...(m.content ? [{ kind: 'assistant' as const, text: m.content }] : []),
      ...(m.stopped ? [{ kind: 'stopped' as const }] : []),
      ...(m.toolCalls ?? [])
        .filter((t) => t.name !== SUGGEST_REPLIES)
        .map((t): AiChatEntry => {
          const card = cards[t.id]
          if (!card) return { kind: 'tool', label: labels[t.id] ?? TOOL_FALLBACK_LABEL, touched: touched[t.id] }
          return cardEntry(t.id, card, touched[t.id])
        }),
    ]
  })
}

const focusChip = ({ focus }: AiChatContent) =>
  focus ? { title: focus.title, href: `/courses/${focus.courseId}/items/${focus.itemId}/edit` } : null

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
  const usable = (model: AiModel) => isProviderEnabled(aiProvider(model)) && ledger.isModelAvailable(model)
  const enabledModels = () => AI_CHAT_MODELS.filter(usable)
  /** 音声入力を今使えない理由。使用量は本人の OpenRouter の週の枠に数える */
  const voiceProblem = (user: User) =>
    isProviderEnabled('openrouter') ? quotaProblem(ledger.getQuota(user.id, VOICE_MODEL)) : '今は音声入力を使えません。'

  const modelOption = (user: User, model: AiModel) => {
    const hard = agent.hardTaskModel(model)
    return {
      value: model,
      label: AI_MODEL_LABELS[model],
      hardLabel: hard === model ? null : AI_MODEL_LABELS[hard],
      hardOff: agent.hardOff(user.id, model),
      problem: quotaProblem(ledger.getQuota(user.id, model)),
      usage: agent.usageOf(user.id, model),
      images: readsFiles(model),
    }
  }

  function panelProps(user: User): AiPanelProps {
    const chat = chats.currentChat(user.id)
    return {
      models: enabledModels().map((m) => modelOption(user, m)),
      revision: chatRevision(chat),
      voice: voiceProblem(user) ? null : { maxSeconds: MAX_VOICE_SECONDS, maxChars: MAX_VOICE_CHARS },
      images: { left: chat ? imagesLeft(chat.content) : MAX_CHAT_IMAGES, max: MAX_CHAT_IMAGES },
      chat: chat && {
        id: chat.id,
        model: modelOption(user, chat.model),
        hard: chat.content.turnModel !== undefined && chat.content.turnModel !== chat.model,
        entries: entriesOf(chat.content),
        replies: chat.content.replies ?? [],
        busy: agent.isRunning(user.id),
        context: contextPercent(chat.content),
        focus: focusChip(chat.content),
      },
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
      const { message, model, chat: chatId, page, hard, revision, focus: focusField, image } = result.values

      let chat = chats.currentChat(user.id)
      // 古い画面からの発言を今のチャットに足さないのは、利用者が読んでいない発言を踏まえた応答になり、チャットがないと思って送ると、ほかのタブのチャットを消して始めてしまうため
      if (revision !== chatRevision(chat)) return emit({ type: 'outdated' })
      if (chatId) {
        if (!chat || String(chat.id) !== chatId) {
          emit({ type: 'error', message: 'このチャットは閉じられています。新しいチャットで送り直してください。', retract: true })
          return emit({ type: 'closed' })
        }
        // 断るだけで閉じずにおかないのは、使えなくなったモデルのチャットが残ると、新しいチャットを始められないため。
        // enabledModels で確かめないのは、選択肢から外す前の Claude Sonnet 5.5 で始めたチャットも続けられるようにするため
        if (!usable(chat.model)) {
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
        const focusIds = focusField.match(/^(\d+)\/(\d+)$/)
        const focus = focusIds ? await agent.focusOf(c, Number(focusIds[1]), Number(focusIds[2])) : null
        if (focusField && !focus) return emit({ type: 'error', message: 'このコーディング問題は選べません。', retract: true })
        chat = chats.startChat(user.id, model, focus ?? undefined)
        emit({ type: 'chat', id: chat.id })
      }
      await agent.send({ c, chat, message, page, hard: hard === 1, image }, emit)
      // 何も残らなかったチャットを閉じるのは、最初の発言が失敗したとき、モデルを選び直して始められるようにするため
      if (chat.content.messages.length === 0) {
        chats.closeChat(user.id)
        emit({ type: 'closed' })
      }
    })
  }

  /** 発言に添えた画像。開いているチャットのものだけを返す */
  async function image(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const key = c.req.param('key')
    const file = (chats.currentChat(user.id)?.content.messages ?? [])
      .flatMap((m) => (m.role === 'user' ? (m.files ?? []) : []))
      .find((f) => imageKey(f) === key)
    if (!file) return c.notFound()
    const etag = `"${key}"`
    // max-age で覚えさせないのは、チャットを閉じたあとも、共有の端末のブラウザに画像が残って開けるため
    c.header('Cache-Control', 'private, no-cache')
    c.header('ETag', etag)
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304)
    c.header('Content-Type', file.mediaType)
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(Buffer.from(file.data, 'base64'))
  }

  /** 確認カードを決める。ファイルを選ぶカードでは、承認にファイルを添えて送る */
  async function decide(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const fields = await readFields(c, 'aiDecision')
    if (!fields) return c.notFound()
    const { call: callId, page } = fields
    const approve = fields.decision === 'approve'
    const file = approve ? fields.file : null
    const problem = file && (await uploadProblem(file))
    return streamEvents(c, async (emit) => {
      const chat = chats.currentChat(user.id)
      if (!chat || String(chat.id) !== fields.chat) {
        emit({ type: 'error', message: 'このチャットは閉じられています。' })
        return emit({ type: 'closed' })
      }
      if (problem) return emit({ type: 'error', message: problem, retract: true })
      if (file) await agent.receive({ c, chat, callId, file, page }, emit)
      else await agent.decide({ c, chat, callId, approve, page }, emit)
    })
  }

  /** 画面で見た確認カードをまとめて承認する */
  async function approveAll(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const fields = await readFields(c, 'aiApproveAll')
    if (!fields) return c.notFound()
    return streamEvents(c, async (emit) => {
      const chat = chats.currentChat(user.id)
      if (!chat || String(chat.id) !== fields.chat) {
        emit({ type: 'error', message: 'このチャットは閉じられています。' })
        return emit({ type: 'closed' })
      }
      await agent.approveAll({ c, chat, callIds: fields['call[]'], page: fields.page }, emit)
    })
  }

  /** パネルの最初に出す、開いている画面に合わせた依頼の候補。client.ts が画面を開くたびに取りに来る */
  async function suggestions(c: Context<AppEnv>) {
    if (!(await canUse(c))) return c.notFound()
    const result = validate('aiSuggestions', c.req.query())
    const suggestions = result.ok ? await agent.suggestRequests(c, result.values.page) : null
    if (!suggestions) return c.notFound()
    return c.json({ suggestions })
  }

  /** 作成中の応答を止める。ほかのタブで始めた応答も止められるように、チャットではなく利用者で探し、保存し終えてから返す */
  async function stop(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const stopped = await agent.stop(user.id)
    if (wantsJson(c)) return c.json({ ok: true, stopped })
    return c.redirect(sameOriginReferer(c, '/dashboard'), 303)
  }

  /** 録音中の音声を文字にする。client.ts は録り始めから今までの音声を何度も送り、返った文字を入力欄に薄く出す */
  async function voice(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const fields = await readFields(c, 'aiVoice')
    const format = fields && voiceFormat(fields.audio.type)
    if (!fields || !format) return c.json({ error: 'この形式の音声は受け取れません。' }, 400)
    if (fields.audio.size > MAX_VOICE_BYTES) return c.json({ error: '音声が長すぎます。' }, 400)
    const problem = voiceProblem(user)
    if (problem) return c.json({ error: problem }, 429)
    try {
      const { text, seconds, usage } = await transcribe(fields.audio, format, c.req.raw.signal)
      ledger.recordUsage(user.id, VOICE_MODEL, usage)
      // 録音の長さを client.ts だけに任せないのは、画面を通さずに送られた長い音声も、1 回の上限で断るため
      if (isVoiceTooLong(seconds)) return c.json({ error: `音声入力は 1 回 ${MAX_VOICE_SECONDS} 秒までです。` }, 400)
      return c.json({ text: text.slice(0, MAX_VOICE_CHARS) })
    } catch (e) {
      if (e instanceof AiError) return c.json({ error: e.message }, 502)
      throw e
    }
  }

  async function close(c: Context<AppEnv>) {
    const user = c.var.user!
    if (!(await canUse(c))) return c.notFound()
    const chatId = (await readFields(c, 'aiChat'))?.chat ?? ''
    // 開いていたチャットでなければ閉じないのは、ほかのタブで始めた、まだ見ていないチャットを消さないため
    if (String(chats.currentChat(user.id)?.id ?? '') === chatId) chats.closeChat(user.id)
    if (wantsJson(c)) return c.json({ ok: true })
    return c.redirect(sameOriginReferer(c, '/dashboard'), 303)
  }

  return { renderPanel, show, state, suggestions, image, send, decide, approveAll, stop, voice, close }
}

export type AiHandlers = ReturnType<typeof createAiHandlers>

export function aiRoutes(h: AiHandlers) {
  const app = new Hono<AppEnv>()
  app.get('/chat', h.show)
  app.get('/chat/state', h.state)
  app.get('/chat/images/:key', h.image)
  app.get('/suggestions', h.suggestions)
  app.post('/chat', h.send)
  app.post('/chat/confirm', h.decide)
  app.post('/chat/confirm-all', h.approveAll)
  app.post('/chat/stop', h.stop)
  app.post('/chat/close', h.close)
  app.post('/voice', h.voice)
  return app
}
