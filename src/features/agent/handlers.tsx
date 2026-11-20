// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・features/agent/agent-items.ts など）を import しない。
// モードごとの DB と権限の確認は AgentBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/agent.ts）
import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import {
  AGENT_PROVIDER_LABELS,
  AGENT_PROVIDERS,
  AGENT_REQUEST,
  AGENT_STATE_MESSAGES,
  agentContextLimit,
  agentMaxTokens,
  agentModelLabel,
  agentState,
  agentSummaryMessages,
  agentSystemPrompt,
  agentToolsFor,
  isAgentOpen,
  usagePercent,
  type AgentModel,
  type AgentProvider,
  type AgentStore,
} from './agent'
import { AiError, type AiReply, type AiRequestFor } from '../ai/ai-models'
import { checkAnthropicKey, completeAnthropic } from '../ai/ai-anthropic'
import { checkOpenRouterKey, completeOpenRouterWith } from '../ai/ai-openrouter'
import { VSCODE_EXTENSION_ID } from '../bundle/bundle'
import { launchClaimer, linkExpired, signToken, tooManyRequests } from '../../lib/vscode-token'
import { config } from '../../lib/config'
import { firstError, validate } from '../../lib/forms'
import { bearerToken, readForm, readJson, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import type { AppEnv } from '../../lib/types'

type C = Context<AppEnv>

/** 利用者が今開けるアイテム。description は学生にも見せているアイテムの説明で、AI にも渡す */
export type AgentTarget = { course: string; title: string; description: string; store: AgentStore }

type AgentContext = AgentTarget & {
  courseId: number
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  /** 拡張機能に渡すアイテムの識別子。targetOf に渡すと同じアイテムが返る */
  ref: string
}

export type AgentBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら返す。開けなければ null */
  resolve: (c: C) => Promise<AgentContext | null>
  /** 拡張機能からの要求（ログインのセッションがない）で、userId の人が ref のアイテムを今開けるなら返す。開けなければ null */
  targetOf: (ref: string, userId: number) => Promise<AgentTarget | null>
  findUser: (userId: number) => { id: number; name: string } | undefined
  /** トークンの ID・アイテムの ref・持ち主。知らないトークンなら null */
  findToken: (token: string) => { id: number; ref: string; userId: number } | null
  touchToken: (id: number) => void
  revokeToken: (id: number) => void
}

const editUrl = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/edit`

const nowSec = () => Math.floor(Date.now() / 1000)

/** アイテムで選んでいるモデルを、その提供元のキーで呼ぶ */
const completeAgent = (model: AgentModel, apiKey: string, request: Omit<AiRequestFor<string>, 'model'>): Promise<AiReply> =>
  model.provider === 'anthropic'
    ? completeAnthropic({ ...request, model: model.id }, apiKey)
    : completeOpenRouterWith({ ...request, model: model.id }, apiKey, model)

/** 管理者が入れた API キーを、提供元に確かめる。使えなければ、画面に出す文言 */
async function keyProblem(provider: AgentProvider, apiKey: string, model: AgentModel) {
  const label = AGENT_PROVIDER_LABELS[provider]
  const check =
    provider === 'anthropic'
      ? await checkAnthropicKey(apiKey, model.provider === 'anthropic' ? model.id : 'claude-haiku-5-5')
      : await checkOpenRouterKey(apiKey)
  if (check === 'invalid') return `${label} の API キーが使えません。キーを確かめてください。`
  if (check === 'unreachable') return `${label} に接続できず、キーを確かめられませんでした。しばらくしてからお試しください。`
  return null
}

const stateOf = (store: AgentStore, userId: number) => {
  const settings = store.settings()
  const used = store.used(userId)
  const state = agentState(settings, { used, spent: store.spent() }, nowSec())
  return { settings, used, state }
}

// ---------------------------------------------------------------- STEP Learn の画面から

export function createAgentHandlers({ resolve }: Pick<AgentBackend, 'resolve'>) {
  /** VS Code の拡張機能にトークンを渡すリンクを作る。キーが入る前は作らない（拡張機能に使えないトークンを持たせない） */
  async function launch(c: C) {
    const item = await resolve(c)
    if (!item) return c.notFound()
    const back = `/courses/${item.courseId}/items/${item.itemId}`
    if (!wantsJson(c)) return c.redirect(back, 303)
    if (!item.store.settings().configured) return c.json({ error: AGENT_STATE_MESSAGES.off }, 409)
    const token = signToken('launch', { ref: item.ref, userId: c.var.user!.id, course: item.course, title: item.title })
    const query = new URLSearchParams({ server: config.appOrigin ?? new URL(c.req.url).origin, token })
    return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/agent?${query}` })
  }

  async function adminItem(c: C) {
    if (c.var.user?.role !== 'admin') return null
    return resolve(c)
  }

  async function saveKey(c: C) {
    const item = await adminItem(c)
    if (!item) return c.notFound()
    const back = editUrl(item.courseId, item.itemId)
    const result = validate('agentKey', await readForm(c))
    if (!result.ok) return redirectWith(c, back, firstError(result.errors), 'error')
    const { api_key: anthropic, openrouter_api_key: openrouter, total_limit: totalLimit } = result.values
    const before = item.store.settings()
    const { model } = before
    const keys = { anthropic, openrouter }
    const entered = AGENT_PROVIDERS.filter((provider) => keys[provider])
    if (!entered.length && !before.configured)
      return redirectWith(c, back, `${AGENT_PROVIDER_LABELS[model.provider]} の API キーを入力してください。`, 'error')
    for (const provider of entered) {
      const problem = await keyProblem(provider, keys[provider], model)
      if (problem) return redirectWith(c, back, problem, 'error')
    }
    item.store.saveKey({ keys: Object.fromEntries(entered.map((p) => [p, keys[p]])), totalLimit })
    if (!item.store.settings().configured)
      return redirectWith(
        c,
        back,
        `API キーを保存しました。使うモデル（${agentModelLabel(model)}）には、${AGENT_PROVIDER_LABELS[model.provider]} の API キーが要ります。`,
        'info',
      )
    return redirectWith(c, back, before.configured ? '保存しました。' : `「${item.title}」を有効にしました。`)
  }

  async function removeKey(c: C) {
    const item = await adminItem(c)
    if (!item) return c.notFound()
    const provider = (await readForm(c)).provider
    if (provider !== 'anthropic' && provider !== 'openrouter') return c.notFound()
    item.store.clearKey(provider)
    const stopped = item.store.settings().model.provider === provider ? '学生は使えなくなります。' : ''
    return redirectWith(
      c,
      editUrl(item.courseId, item.itemId),
      `「${item.title}」の ${AGENT_PROVIDER_LABELS[provider]} の API キーを削除しました。${stopped}`,
      'info',
    )
  }

  return { launch, saveKey, removeKey }
}

export function agentRoutes(h: ReturnType<typeof createAgentHandlers>) {
  const app = new Hono<AppEnv>()
  app.post('/:id/items/:iid/agent/launch', h.launch)
  app.post('/:id/items/:iid/agent/key', h.saveKey)
  app.post('/:id/items/:iid/agent/key/delete', h.removeKey)
  return app
}

// ---------------------------------------------------------------- 拡張機能から

const CONVERSATION_PATHS = ['/api/vscode/agent/messages', '/api/vscode/agent/summarize']

/** 拡張機能が会話を送る要求かを確かめる関数。ログインのセッションがなくても、トークンで本人と確かめられるので、本文の上限を上げてよい */
export const agentRequestCheck =
  ({ findToken }: Pick<AgentBackend, 'findToken'>) =>
  (c: Context) =>
    c.req.method === 'POST' && CONVERSATION_PATHS.includes(c.req.path) && !!findToken(bearerToken(c))

const TOKEN_INVALID = 'トークンが使えなくなりました。STEP Learn のアイテムの画面から、もう一度 VS Code で開いてください。'

/** STEP Learn for VSCode（vscode-extension/）が呼ぶ API。ログインのセッションの代わりに、アイテムごとのトークンで確かめる */
export function agentApi({ targetOf, findUser, findToken, touchToken, revokeToken }: AgentBackend) {
  const claim = launchClaimer('launch')
  // 1 回の依頼でツールを何度も呼ぶので、拡張機能が普通に使っていて届く回数より多めにする
  const messageLimit = rateLimiter({ limit: 60, windowSec: 60 })
  /** 応答を作っている途中の利用者とアイテム。同じ人が並べて呼んで、上限を確かめる前に何回分も使うのを防ぐ */
  const running = new Map<string, AbortController>()
  const app = new Hono<AppEnv>()

  // 開けるかを毎回確かめるのは、トークンが長く使え、そのあいだにコースから外されたり、アイテムが非表示になったりするため。
  // 開けないときもトークンを使えないことにしないのは、非表示を戻したときに、学生が STEP Learn の画面から開き直さずに済ませるため
  async function tokenTarget(c: C) {
    const found = findToken(bearerToken(c))
    if (!found) return null
    touchToken(found.id)
    return { tokenId: found.id, ref: found.ref, userId: found.userId, item: await targetOf(found.ref, found.userId) }
  }

  app.post('/claim', async (c) => {
    const claims = await claim(c)
    if (claims instanceof Response) return claims
    const user = findUser(claims.userId)
    const item = user && (await targetOf(claims.ref, user.id))
    if (!user || !item) return linkExpired(c)
    return c.json({
      ref: claims.ref,
      course: item.course,
      title: item.title,
      user: { id: user.id, name: user.name },
      token: item.store.issueToken(user.id),
    })
  })

  app.get('/status', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    if (!target.item) return c.json({ state: 'closed', open: false, message: AGENT_STATE_MESSAGES.closed })
    const { settings, used, state } = stateOf(target.item.store, target.userId)
    return c.json({
      state,
      open: isAgentOpen(state),
      message: AGENT_STATE_MESSAGES[state],
      course: target.item.course,
      title: target.item.title,
      model: agentModelLabel(settings.model),
      opensAt: settings.opensAt,
      closesAt: settings.closesAt,
      usage: usagePercent(used, settings.userLimit),
      contextLimit: agentContextLimit(settings.model),
    })
  })

  app.post('/revoke', async (c) => {
    const found = findToken(bearerToken(c))
    if (found) revokeToken(found.id)
    return c.body(null, 204)
  })

  /** 会話を受け取り、AI を呼べるところまで確かめる。呼べなければ、返す応答。呼び終えたら release を呼ぶ */
  async function accept(c: C) {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    const { userId, item } = target
    if (!item) return c.json({ error: AGENT_STATE_MESSAGES.closed, state: 'closed' }, 403)
    const limitKey = String(target.tokenId)
    if (messageLimit.retryAfter(limitKey)) return tooManyRequests(c)
    messageLimit.hit(limitKey)
    const request = await readJson(c, AGENT_REQUEST)
    if (!request) return c.json({ error: '送られた会話が正しくありません。新しいチャットを始めてください。' }, 400)
    const { store } = item
    const { settings, state } = stateOf(store, userId)
    const apiKey = state === 'ok' ? store.apiKey(settings.model.provider) : null
    if (!apiKey) return c.json({ error: AGENT_STATE_MESSAGES[state], state }, 403)
    const runKey = `${target.ref}:${userId}`
    if (running.has(runKey)) return c.json({ error: 'ほかのウィンドウで AI が応答を作っています。終わってからお試しください。' }, 409)
    const controller = new AbortController()
    running.set(runKey, controller)
    const { messages } = request
    return { userId, item, store, settings, apiKey, request, messages, controller, release: () => running.delete(runKey) }
  }

  app.post('/messages', async (c) => {
    const accepted = await accept(c)
    if (accepted instanceof Response) return accepted
    const { userId, item, store, settings, apiKey, request, messages, controller, release } = accepted

    const system = agentSystemPrompt({
      course: item.course,
      title: item.title,
      description: item.description,
      instructions: settings.instructions,
      platform: request.platform,
    })
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    // リバースプロキシの設定に任せないのは、応答をためられると、言い終えるまで VS Code に何も出ないため
    c.header('X-Accel-Buffering', 'no')
    return stream(c, async (s) => {
      const emit = (event: Record<string, unknown>) => void s.write(`${JSON.stringify(event)}\n`)
      s.onAbort(() => controller.abort())
      try {
        const reply = await completeAgent(settings.model, apiKey, {
          messages: [{ role: 'system', content: system }, ...messages],
          tools: agentToolsFor(request.tools),
          maxTokens: agentMaxTokens(settings.model),
          onText: (text) => emit({ type: 'text', text }),
          signal: controller.signal,
        })
        store.record(userId, reply.usage)
        emit({
          type: 'done',
          reply: { text: reply.text, toolCalls: reply.toolCalls, stop: reply.stop, native: reply.native },
          contextTokens: reply.usage.promptTokens + reply.usage.completionTokens,
          usage: usagePercent(store.used(userId), settings.userLimit),
        })
      } catch (e) {
        emit({ type: 'error', message: e instanceof AiError ? `${e.message}。` : 'AI の応答を受け取れませんでした。' })
        if (!(e instanceof AiError)) console.error('[agent]', e instanceof Error ? e.message : typeof e)
      } finally {
        release()
      }
    })
  })

  /** 長くなった会話を要約する。拡張機能は、会話を要約に置き換えて続ける */
  app.post('/summarize', async (c) => {
    const accepted = await accept(c)
    if (accepted instanceof Response) return accepted
    const { userId, store, settings, apiKey, messages, controller, release } = accepted
    c.req.raw.signal.addEventListener('abort', () => controller.abort())
    try {
      const reply = await completeAgent(settings.model, apiKey, { messages: agentSummaryMessages(messages), signal: controller.signal })
      store.record(userId, reply.usage)
      const summary = reply.text.trim()
      if (reply.stop !== 'end' || !summary) return c.json({ error: '会話を要約できませんでした。' }, 502)
      return c.json({ summary, usage: usagePercent(store.used(userId), settings.userLimit) })
    } catch (e) {
      if (!(e instanceof AiError)) console.error('[agent]', e instanceof Error ? e.message : typeof e)
      return c.json({ error: e instanceof AiError ? `${e.message}。` : '会話を要約できませんでした。' }, 502)
    } finally {
      release()
    }
  })

  return app
}
