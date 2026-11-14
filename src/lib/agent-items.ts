import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import { AGENT_DEFAULT_LIMITS, AGENT_KIND, MAX_AGENT_TOKENS, type AgentItemRow, type AgentStore } from './agent'
import { agentTokenHash, apiKeyHintOf, newAgentToken, openApiKey, sealApiKey } from './agent-secret'
import { db } from './db'
import { agentItems, agentTokens, agentUsage, courses, items, users } from './schema'
import type { User } from './types'

const aadOf = (itemId: number) => `agent-item:${itemId}`

/** コーディングエージェントのアイテムなら、そのコースの ID・タイトル・説明 */
export const getAgentItem = (itemId: number) =>
  db
    .select({ courseId: items.courseId, title: items.title, body: items.body })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.type, AGENT_KIND)))
    .get()

const upsert = (itemId: number, set: Partial<typeof agentItems.$inferInsert>) =>
  void db
    .insert(agentItems)
    .values({ itemId, ...set })
    .onConflictDoUpdate({ target: agentItems.itemId, set })
    .run()

/** 教師が編集画面で決める、使える期間と 1 人あたりの上限 */
export const saveAgentPeriod = (itemId: number, set: { opensAt: number; closesAt: number; userLimit: number }) => upsert(itemId, set)

const costSum = sql<number>`coalesce(sum(${agentUsage.cost}), 0)`

/** 通常モード（step-learn.db）の、アイテム 1 つの設定・使用量・トークン */
export function agentStore(itemId: number): AgentStore {
  const settingsRow = () => db.select().from(agentItems).where(eq(agentItems.itemId, itemId)).get()
  const apiKey = () => {
    const sealed = settingsRow()?.apiKey
    return sealed ? openApiKey(aadOf(itemId), sealed) : null
  }
  const ofItem = eq(agentUsage.itemId, itemId)

  return {
    settings() {
      const row = settingsRow()
      const configured = !!row?.apiKey && openApiKey(aadOf(itemId), row.apiKey) !== null
      return {
        configured,
        apiKeyHint: configured ? (row?.apiKeyHint ?? '') : '',
        opensAt: row?.opensAt ?? null,
        closesAt: row?.closesAt ?? null,
        userLimit: row?.userLimit ?? AGENT_DEFAULT_LIMITS.userLimit,
        totalLimit: row?.totalLimit ?? AGENT_DEFAULT_LIMITS.totalLimit,
      }
    },
    apiKey,
    saveKey: ({ apiKey, totalLimit }) =>
      upsert(itemId, { totalLimit, ...(apiKey && { apiKey: sealApiKey(aadOf(itemId), apiKey), apiKeyHint: apiKeyHintOf(apiKey) }) }),
    clearKey: () => upsert(itemId, { apiKey: null, apiKeyHint: '' }),
    used: (userId) =>
      db
        .select({ total: costSum })
        .from(agentUsage)
        .where(and(ofItem, eq(agentUsage.userId, userId)))
        .get()!.total,
    spent: () => db.select({ total: costSum }).from(agentUsage).where(ofItem).get()!.total,
    record: (userId, usage) =>
      void db
        .insert(agentUsage)
        .values({ itemId, userId, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cost: usage.cost })
        .run(),
    usageByUser: () =>
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
        .where(ofItem)
        .groupBy(agentUsage.userId)
        .orderBy(desc(costSum))
        .limit(1000)
        .all(),
    tokenCount: () => db.select({ n: count() }).from(agentTokens).where(eq(agentTokens.itemId, itemId)).get()!.n,
    issueToken(userId) {
      const token = newAgentToken()
      db.transaction((tx) => {
        tx.insert(agentTokens)
          .values({ itemId, userId, tokenHash: agentTokenHash(token)! })
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
    },
  }
}

// ---------------------------------------------------------------- トークン

const USER = { id: users.id, email: users.email, name: users.name, username: users.username, role: users.role }

export const findAgentUser = (userId: number): User | undefined => db.select(USER).from(users).where(eq(users.id, userId)).get()

/** トークンの ID・アイテム・持ち主。知らないトークンなら null */
export function findAgentToken(token: string): { id: number; itemId: number; userId: number } | null {
  const hash = agentTokenHash(token)
  if (!hash) return null
  const row = db
    .select({ id: agentTokens.id, itemId: agentTokens.itemId, userId: agentTokens.userId })
    .from(agentTokens)
    .where(eq(agentTokens.tokenHash, hash))
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
      totalLimit: sql<number>`coalesce(${agentItems.totalLimit}, ${AGENT_DEFAULT_LIMITS.totalLimit})`,
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
