import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_TOKENS,
  AGENT_MODEL,
  AGENT_MODEL_LABEL,
  AGENT_STATE_MESSAGES,
  AGENT_TOOLS,
  agentState,
  agentSystemPrompt,
  isAgentOpen,
  isAgentPlatform,
  parseAgentMessages,
  usagePercent,
} from '../../lib/agent'
import {
  agentApiKey,
  agentSettings,
  agentSpent,
  agentUsed,
  clearAgentKey,
  findAgentToken,
  findAgentUser,
  getAgentItem,
  issueAgentToken,
  recordAgentUsage,
  revokeAgentToken,
  saveAgentKey,
  touchAgentToken,
} from '../../lib/agent-items'
import { AiError } from '../../lib/ai-models'
import { checkAnthropicKey, completeAnthropic } from '../../lib/ai-anthropic'
import { canOpenItem } from '../../lib/availability'
import { VSCODE_EXTENSION_ID } from '../../lib/bundle'
import { claimLaunch, signLaunch } from '../../lib/bundle-token'
import { config } from '../../lib/config'
import { getCourseAccess, getCourseAccessFor, isVisibleItem } from '../../lib/courses'
import { firstError, validate } from '../../lib/forms'
import { clientIp, intParam, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import type { AppEnv, User } from '../../lib/types'

type C = Context<AppEnv>

const REF_PREFIX = 'agent-'

const editUrl = (courseId: number, itemId: number) => `/courses/${courseId}/items/${itemId}/edit`

const nowSec = () => Math.floor(Date.now() / 1000)

const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''

/** user がアイテムを開けるなら、そのアイテムと権限 */
async function openableItem(user: User, itemId: number, access?: Awaited<ReturnType<typeof getCourseAccessFor>>) {
  const item = getAgentItem(itemId)
  if (!item) return null
  const granted = access ?? (await getCourseAccessFor(user, item.courseId))
  if (!granted || granted.course.id !== item.courseId || !canOpenItem(user, granted, itemId, isVisibleItem(itemId))) return null
  return { ...item, access: granted }
}

async function pageItem(c: C) {
  const courseId = intParam(c, 'id')
  const itemId = intParam(c, 'iid')
  const access = courseId && itemId && (await getCourseAccess(c, courseId))
  if (!access) return null
  const item = await openableItem(c.var.user!, itemId, access)
  return item && { ...item, itemId }
}

const stateOf = (itemId: number, userId: number) => {
  const settings = agentSettings(itemId)
  const used = agentUsed(itemId, userId)
  const state = agentState(settings, { used, spent: agentSpent(itemId) }, nowSec())
  return { settings, used, state }
}

// ---------------------------------------------------------------- STEP Learn の画面から

/** VS Code の拡張機能にトークンを渡すリンクを作る。キーが入る前は作らない（拡張機能に使えないトークンを持たせない） */
export async function launch(c: C) {
  const item = await pageItem(c)
  if (!item) return c.notFound()
  const back = `/courses/${item.courseId}/items/${item.itemId}`
  if (!wantsJson(c)) return c.redirect(back, 303)
  if (!agentSettings(item.itemId).configured) return c.json({ error: AGENT_STATE_MESSAGES.off }, 409)
  const token = signLaunch({
    ref: `${REF_PREFIX}${item.itemId}`,
    userId: c.var.user!.id,
    course: item.access.course.title,
    title: item.title,
  })
  const query = new URLSearchParams({ server: config.appOrigin ?? new URL(c.req.url).origin, token })
  return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/agent?${query}` })
}

async function adminItem(c: C) {
  if (c.var.user?.role !== 'admin') return null
  return pageItem(c)
}

export async function saveKey(c: C) {
  const item = await adminItem(c)
  if (!item) return c.notFound()
  const back = editUrl(item.courseId, item.itemId)
  const result = validate('agentKey', await readForm(c))
  if (!result.ok) return redirectWith(c, back, firstError(result.errors), 'error')
  const { api_key: apiKey, total_limit: totalLimit } = result.values
  const configured = agentSettings(item.itemId).configured
  if (!apiKey && !configured) return redirectWith(c, back, 'API キーを入力してください。', 'error')
  if (apiKey) {
    const check = await checkAnthropicKey(apiKey, AGENT_MODEL)
    if (check === 'invalid')
      return redirectWith(c, back, `この API キーでは ${AGENT_MODEL_LABEL} を使えません。キーを確かめてください。`, 'error')
    if (check === 'unreachable')
      return redirectWith(c, back, 'Anthropic に接続できず、キーを確かめられませんでした。しばらくしてからお試しください。', 'error')
  }
  saveAgentKey(item.itemId, { apiKey: apiKey || undefined, totalLimit })
  return redirectWith(c, back, apiKey ? `「${item.title}」を有効にしました。` : '全体の上限を保存しました。')
}

export async function removeKey(c: C) {
  const item = await adminItem(c)
  if (!item) return c.notFound()
  clearAgentKey(item.itemId)
  return redirectWith(
    c,
    editUrl(item.courseId, item.itemId),
    `「${item.title}」の API キーを削除しました。学生は使えなくなります。`,
    'info',
  )
}

// ---------------------------------------------------------------- 拡張機能から

const MESSAGES_PATH = '/api/vscode/agent/messages'

/** 拡張機能が会話を送る要求か。ログインのセッションがなくても、トークンで本人と確かめられるので、本文の上限を上げてよい */
export const isAgentRequest = (c: Context) => c.req.method === 'POST' && c.req.path === MESSAGES_PATH && !!findAgentToken(bearer(c))

const TOKEN_INVALID = 'トークンが使えなくなりました。STEP Learn のアイテムの画面から、もう一度 VS Code で開いてください。'

/** 応答を作っている途中の利用者とアイテム。同じ人が並べて呼んで、上限を確かめる前に何回分も使うのを防ぐ */
const running = new Map<string, AbortController>()

/** STEP Learn for VSCode（vscode-extension/）が呼ぶ API。ログインのセッションの代わりに、アイテムごとのトークンで確かめる */
export function agentApi() {
  // 上限を付けるのは、ログインしていなくても呼べ、リンクの鍵やトークンを総当たりで試されないようにするため
  const claimLimit = rateLimiter({ limit: 30, windowSec: 60 })
  // 1 回の依頼でツールを何度も呼ぶので、拡張機能が普通に使っていて届く回数より多めにする
  const messageLimit = rateLimiter({ limit: 60, windowSec: 60 })
  const app = new Hono<AppEnv>()

  // 開けるかを毎回確かめるのは、トークンが長く使え、そのあいだにコースから外されたり、アイテムが非表示になったりするため。
  // 開けないときもトークンを使えないことにしないのは、非表示を戻したときに、学生が STEP Learn の画面から開き直さずに済ませるため
  async function tokenTarget(c: C) {
    const found = findAgentToken(bearer(c))
    if (!found) return null
    touchAgentToken(found.id)
    return { tokenId: found.id, itemId: found.itemId, user: found.user, item: await openableItem(found.user, found.itemId) }
  }

  app.post('/claim', async (c) => {
    const ip = clientIp(c)
    if (claimLimit.retryAfter(ip)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    claimLimit.hit(ip)
    const body: unknown = await c.req.json().catch(() => null)
    const raw = typeof body === 'object' && body !== null && 'token' in body && typeof body.token === 'string' ? body.token : ''
    const claims = claimLaunch(raw)
    const itemId = claims?.ref.startsWith(REF_PREFIX) ? Number(claims.ref.slice(REF_PREFIX.length)) : NaN
    const user = claims && Number.isSafeInteger(itemId) ? findAgentUser(claims.userId) : null
    const item = user && (await openableItem(user, itemId))
    if (!claims || !user || !item)
      return c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)
    return c.json({
      ref: claims.ref,
      course: item.access.course.title,
      title: item.title,
      user: { id: user.id, name: user.name },
      token: issueAgentToken(itemId, user.id),
    })
  })

  app.get('/status', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    if (!target.item) return c.json({ state: 'closed', open: false, message: AGENT_STATE_MESSAGES.closed })
    const { settings, used, state } = stateOf(target.itemId, target.user.id)
    return c.json({
      state,
      open: isAgentOpen(state),
      message: AGENT_STATE_MESSAGES[state],
      course: target.item.access.course.title,
      title: target.item.title,
      model: AGENT_MODEL_LABEL,
      opensAt: settings.opensAt,
      closesAt: settings.closesAt,
      usage: usagePercent(used, settings.userLimit),
      contextLimit: AGENT_CONTEXT_LIMIT,
    })
  })

  app.post('/revoke', async (c) => {
    const found = findAgentToken(bearer(c))
    if (found) revokeAgentToken(found.id)
    return c.body(null, 204)
  })

  app.post('/messages', async (c) => {
    const target = await tokenTarget(c)
    if (!target) return c.json({ error: TOKEN_INVALID }, 401)
    const { itemId, user, item } = target
    if (!item) return c.json({ error: AGENT_STATE_MESSAGES.closed, state: 'closed' }, 403)
    const limitKey = String(target.tokenId)
    if (messageLimit.retryAfter(limitKey)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    messageLimit.hit(limitKey)
    const body: unknown = await c.req.json().catch(() => null)
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const messages = parseAgentMessages(record.messages)
    if (!messages) return c.json({ error: '送られた会話が正しくありません。新しいチャットを始めてください。' }, 400)
    const { settings, state } = stateOf(itemId, user.id)
    const apiKey = state === 'ok' ? agentApiKey(itemId) : null
    if (!apiKey) return c.json({ error: AGENT_STATE_MESSAGES[state], state }, 403)
    const runKey = `${itemId}:${user.id}`
    if (running.has(runKey)) return c.json({ error: 'ほかのウィンドウで AI が応答を作っています。終わってからお試しください。' }, 409)
    const controller = new AbortController()
    running.set(runKey, controller)

    const system = agentSystemPrompt({
      course: item.access.course.title,
      title: item.title,
      instructions: item.body,
      platform: isAgentPlatform(record.platform) ? record.platform : null,
    })
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    // リバースプロキシの設定に任せないのは、応答をためられると、言い終えるまで VS Code に何も出ないため
    c.header('X-Accel-Buffering', 'no')
    return stream(c, async (s) => {
      const emit = (event: Record<string, unknown>) => void s.write(`${JSON.stringify(event)}\n`)
      s.onAbort(() => controller.abort())
      try {
        const reply = await completeAnthropic(
          {
            model: AGENT_MODEL,
            messages: [{ role: 'system', content: system }, ...messages],
            tools: AGENT_TOOLS,
            maxTokens: AGENT_MAX_TOKENS,
            onText: (text) => emit({ type: 'text', text }),
            signal: controller.signal,
          },
          apiKey,
        )
        recordAgentUsage(itemId, user.id, reply.usage)
        const after = agentUsed(itemId, user.id)
        emit({
          type: 'done',
          reply: { text: reply.text, toolCalls: reply.toolCalls, stop: reply.stop, native: reply.native },
          contextTokens: reply.usage.promptTokens + reply.usage.completionTokens,
          usage: usagePercent(after, settings.userLimit),
        })
      } catch (e) {
        emit({ type: 'error', message: e instanceof AiError ? `${e.message}。` : 'AI の応答を受け取れませんでした。' })
        if (!(e instanceof AiError)) console.error('[agent]', e instanceof Error ? e.message : typeof e)
      } finally {
        running.delete(runKey)
      }
    })
  })

  return app
}
