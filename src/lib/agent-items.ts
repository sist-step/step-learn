import crypto from 'node:crypto'
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import { AGENT_KIND, MAX_AGENT_TOKENS, type AgentSettings } from './agent'
import type { AiUsage } from './ai-models'
import { config } from './config'
import { db } from './db'
import { agentItems, agentTokens, agentUsage, courses, items, users } from './schema'
import type { User } from './types'

// SESSION_SECRET をそのまま鍵にしないのは、Cookie の署名や会話の暗号化とこの鍵を使い回さないため
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'step-learn', 'agent-api-key', 32))
const IV_LENGTH = 12
const TAG_LENGTH = 16

function sealApiKey(itemId: number, apiKey: string) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  // アイテムの ID を付けるのは、DB の行を入れ替えられても、ほかのアイテムのキーとして読み出せないようにするため
  cipher.setAAD(Buffer.from(`agent-item:${itemId}`))
  const body = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

function openApiKey(itemId: number, sealed: Buffer): string | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, sealed.subarray(0, IV_LENGTH))
    decipher.setAAD(Buffer.from(`agent-item:${itemId}`))
    decipher.setAuthTag(sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))
    return Buffer.concat([decipher.update(sealed.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8')
  } catch {
    // SESSION_SECRET を変えると読み出せなくなる。そのときは入っていないものとして扱い、管理者に入れ直してもらう
    return null
  }
}

/** コーディングエージェントのアイテムなら、そのコースの ID・タイトル・説明 */
export const getAgentItem = (itemId: number) =>
  db
    .select({ courseId: items.courseId, title: items.title, body: items.body })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.type, AGENT_KIND)))
    .get()

const settingsRow = (itemId: number) => db.select().from(agentItems).where(eq(agentItems.itemId, itemId)).get()

const DEFAULTS = { userLimit: 0.5, totalLimit: 10 }

export function agentSettings(itemId: number): AgentSettings {
  const row = settingsRow(itemId)
  const configured = !!row?.apiKey && openApiKey(itemId, row.apiKey) !== null
  return {
    configured,
    apiKeyHint: configured ? (row?.apiKeyHint ?? '') : '',
    opensAt: row?.opensAt ?? null,
    closesAt: row?.closesAt ?? null,
    userLimit: row?.userLimit ?? DEFAULTS.userLimit,
    totalLimit: row?.totalLimit ?? DEFAULTS.totalLimit,
  }
}

/** アイテムの API キー。入っていないか、読み出せなければ null */
export function agentApiKey(itemId: number) {
  const sealed = settingsRow(itemId)?.apiKey
  return sealed ? openApiKey(itemId, sealed) : null
}

const upsert = (itemId: number, set: Partial<typeof agentItems.$inferInsert>) =>
  void db
    .insert(agentItems)
    .values({ itemId, ...set })
    .onConflictDoUpdate({ target: agentItems.itemId, set })
    .run()

/** 教師が編集画面で決める、使える期間と 1 人あたりの上限 */
export const saveAgentPeriod = (itemId: number, set: { opensAt: number; closesAt: number; userLimit: number }) => upsert(itemId, set)

// 末尾を 4 文字にするのは、見分けるのに足り、キーそのものを推測する手がかりにならない長さのため
/** 管理者が入れる API キーと、アイテム全体の上限。apiKey を渡さなければ、キーはそのままにする */
export const saveAgentKey = (itemId: number, { apiKey, totalLimit }: { apiKey?: string; totalLimit: number }) =>
  upsert(itemId, { totalLimit, ...(apiKey && { apiKey: sealApiKey(itemId, apiKey), apiKeyHint: apiKey.slice(-4) }) })

export const clearAgentKey = (itemId: number) => upsert(itemId, { apiKey: null, apiKeyHint: '' })

// ---------------------------------------------------------------- 使用量

const costSum = sql<number>`coalesce(sum(${agentUsage.cost}), 0)`

export const agentUsed = (itemId: number, userId: number) =>
  db
    .select({ total: costSum })
    .from(agentUsage)
    .where(and(eq(agentUsage.itemId, itemId), eq(agentUsage.userId, userId)))
    .get()!.total

export const agentSpent = (itemId: number) =>
  db.select({ total: costSum }).from(agentUsage).where(eq(agentUsage.itemId, itemId)).get()!.total

export const recordAgentUsage = (itemId: number, userId: number, usage: AiUsage) =>
  void db
    .insert(agentUsage)
    .values({ itemId, userId, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cost: usage.cost })
    .run()

export type AgentUserUsage = { id: number | null; name: string; username: string | null; cost: number; calls: number; lastAt: number }

/** 編集画面に出す、利用者ごとの使った額。多い順 */
export const agentUsageByUser = (itemId: number): AgentUserUsage[] =>
  db
    .select({
      id: agentUsage.userId,
      name: sql<string>`coalesce(${users.name}, '削除されたユーザー')`,
      username: users.username,
      cost: costSum,
      calls: count(),
      lastAt: sql<number>`${max(agentUsage.createdAt)}`,
    })
    .from(agentUsage)
    .leftJoin(users, eq(users.id, agentUsage.userId))
    .where(eq(agentUsage.itemId, itemId))
    .groupBy(agentUsage.userId)
    .orderBy(desc(costSum))
    .limit(1000)
    .all()

// ---------------------------------------------------------------- トークン

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

const TOKEN_PREFIX = 'slagent_'

/** 拡張機能に渡すトークンを作る。1 人が持てる数を超えたら、古いものから使えなくする */
export function issueAgentToken(itemId: number, userId: number) {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  db.transaction((tx) => {
    tx.insert(agentTokens)
      .values({ itemId, userId, tokenHash: hashToken(token) })
      .run()
    const stale = tx
      .select({ id: agentTokens.id })
      .from(agentTokens)
      .where(and(eq(agentTokens.itemId, itemId), eq(agentTokens.userId, userId)))
      .orderBy(desc(agentTokens.id))
      .offset(MAX_AGENT_TOKENS)
      .limit(1000)
      .all()
    if (stale.length)
      tx.delete(agentTokens)
        .where(
          inArray(
            agentTokens.id,
            stale.map((s) => s.id),
          ),
        )
        .run()
  })
  return token
}

const USER = { id: users.id, email: users.email, name: users.name, username: users.username, role: users.role }

export const findAgentUser = (userId: number): User | undefined => db.select(USER).from(users).where(eq(users.id, userId)).get()

/** トークンの持ち主とアイテム。知らないトークンなら null */
export function findAgentToken(token: string): { id: number; itemId: number; user: User } | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
  const row = db
    .select({ id: agentTokens.id, itemId: agentTokens.itemId, user: USER })
    .from(agentTokens)
    .innerJoin(users, eq(users.id, agentTokens.userId))
    .where(eq(agentTokens.tokenHash, hashToken(token)))
    .get()
  return row ?? null
}

export const touchAgentToken = (id: number) =>
  void db
    .update(agentTokens)
    .set({ lastUsedAt: sql`(unixepoch())` })
    .where(eq(agentTokens.id, id))
    .run()

export const revokeAgentToken = (id: number) => void db.delete(agentTokens).where(eq(agentTokens.id, id)).run()

export const agentTokenCount = (itemId: number) => db.$count(agentTokens, eq(agentTokens.itemId, itemId))

export type AgentItemRow = {
  courseId: number
  courseTitle: string
  itemId: number
  title: string
  configured: boolean
  opensAt: number | null
  closesAt: number | null
  totalLimit: number
  spent: number
}

/** 管理画面に出す、すべてのコーディングエージェントのアイテム。キーを入れていないものを先に、新しい順 */
export function listAgentItems(): AgentItemRow[] {
  const spent = db
    .select({ itemId: agentUsage.itemId, total: costSum.as('total') })
    .from(agentUsage)
    .groupBy(agentUsage.itemId)
    .as('spent')
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: items.id,
      title: items.title,
      configured: sql<number>`${agentItems.apiKey} IS NOT NULL`,
      opensAt: agentItems.opensAt,
      closesAt: agentItems.closesAt,
      totalLimit: sql<number>`coalesce(${agentItems.totalLimit}, ${DEFAULTS.totalLimit})`,
      spent: sql<number>`coalesce(${spent.total}, 0)`,
    })
    .from(items)
    .innerJoin(courses, eq(courses.id, items.courseId))
    .leftJoin(agentItems, eq(agentItems.itemId, items.id))
    .leftJoin(spent, eq(spent.itemId, items.id))
    .where(eq(items.type, AGENT_KIND))
    .orderBy(sql`${agentItems.apiKey} IS NOT NULL`, desc(items.id))
    .limit(500)
    .all()
    .map((r) => ({ ...r, configured: !!r.configured }))
}
