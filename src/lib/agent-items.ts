import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import {
  AGENT_DEFAULT_LIMITS,
  AGENT_KIND,
  MAX_AGENT_TOKENS,
  agentModelLabel,
  agentModelOf,
  openRouterInfoOf,
  type AgentItemRow,
  type AgentModel,
  type AgentProvider,
  type AgentStore,
} from './agent'
import { agentTokenHash, apiKeyHintOf, newAgentToken, openApiKey, sealApiKey } from './agent-secret'
import { db } from './db'
import { agentItems, agentTokens, agentUsage, courses, items, users } from './schema'

// 提供元ごとに付加データを変えるのは、暗号化したキーを別の列へ書き写されても、別の提供元のキーとして開けないようにするため
const aadOf = (itemId: number, provider: AgentProvider) =>
  provider === 'anthropic' ? `agent-item:${itemId}` : `agent-item:${itemId}:openrouter`

const KEY_COLUMNS = {
  anthropic: { key: 'apiKey', hint: 'apiKeyHint' },
  openrouter: { key: 'openrouterApiKey', hint: 'openrouterApiKeyHint' },
} as const satisfies Record<AgentProvider, { key: keyof typeof agentItems.$inferSelect; hint: keyof typeof agentItems.$inferSelect }>

const upsert = (itemId: number, set: Partial<typeof agentItems.$inferInsert>) =>
  void db
    .insert(agentItems)
    .values({ itemId, ...set })
    .onConflictDoUpdate({ target: agentItems.itemId, set })
    .run()

/** 教師が編集画面で決める、モデル・使える期間・1 人あたりの上限・AI への指示 */
export const saveAgentOptions = (
  itemId: number,
  { model, ...set }: { model: AgentModel; opensAt: number; closesAt: number; userLimit: number; instructions: string },
) =>
  upsert(itemId, {
    ...set,
    model: model.id,
    openrouterModel: model.provider === 'openrouter' ? openRouterInfoOf(model) : null,
  })

/** 保存してあるモデル。編集画面で選び直さなかったときに、OpenRouter のモデルの情報を引き継ぐのに使う */
export const savedAgentModel = (itemId: number) => {
  const row = db
    .select({ model: agentItems.model, openrouterModel: agentItems.openrouterModel })
    .from(agentItems)
    .where(eq(agentItems.itemId, itemId))
    .get()
  return row ? agentModelOf(row.model, row.openrouterModel) : null
}

const costSum = sql<number>`coalesce(sum(${agentUsage.cost}), 0)`

/** 通常モード（step-learn.db）の、アイテム 1 つの設定・使用量・トークン */
export function agentStore(itemId: number): AgentStore {
  const settingsRow = () => db.select().from(agentItems).where(eq(agentItems.itemId, itemId)).get()
  const openKey = (row: typeof agentItems.$inferSelect | undefined, provider: AgentProvider) => {
    const sealed = row?.[KEY_COLUMNS[provider].key]
    return sealed ? openApiKey(aadOf(itemId, provider), sealed) : null
  }
  const keyState = (row: typeof agentItems.$inferSelect | undefined, provider: AgentProvider) => {
    const configured = openKey(row, provider) !== null
    return { configured, hint: configured ? (row?.[KEY_COLUMNS[provider].hint] ?? '') : '' }
  }
  const ofItem = eq(agentUsage.itemId, itemId)

  return {
    settings() {
      const row = settingsRow()
      const model = agentModelOf(row?.model, row?.openrouterModel)
      const keys = { anthropic: keyState(row, 'anthropic'), openrouter: keyState(row, 'openrouter') }
      return {
        configured: keys[model.provider].configured,
        keys,
        model,
        opensAt: row?.opensAt ?? null,
        closesAt: row?.closesAt ?? null,
        userLimit: row?.userLimit ?? AGENT_DEFAULT_LIMITS.userLimit,
        totalLimit: row?.totalLimit ?? AGENT_DEFAULT_LIMITS.totalLimit,
        instructions: row?.instructions ?? '',
      }
    },
    apiKey: (provider) => openKey(settingsRow(), provider),
    saveKey: ({ keys, totalLimit }) =>
      upsert(itemId, {
        totalLimit,
        ...Object.fromEntries(
          (Object.keys(KEY_COLUMNS) as AgentProvider[]).flatMap((provider) => {
            const key = keys[provider]
            const { key: keyColumn, hint } = KEY_COLUMNS[provider]
            return key
              ? [
                  [keyColumn, sealApiKey(aadOf(itemId, provider), key)],
                  [hint, apiKeyHintOf(key)],
                ]
              : []
          }),
        ),
      }),
    clearKey: (provider) => upsert(itemId, { [KEY_COLUMNS[provider].key]: null, [KEY_COLUMNS[provider].hint]: '' }),
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
  const rows = db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      itemId: items.id,
      title: items.title,
      anthropicKey: sql<number>`${agentItems.apiKey} IS NOT NULL`,
      openrouterKey: sql<number>`${agentItems.openrouterApiKey} IS NOT NULL`,
      model: agentItems.model,
      openrouterModel: agentItems.openrouterModel,
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
    .orderBy(desc(items.id))
    .limit(500)
    .all()
    .map(({ anthropicKey, openrouterKey, model: id, openrouterModel, ...r }) => {
      const model = agentModelOf(id, openrouterModel)
      const configured = !!(model.provider === 'anthropic' ? anthropicKey : openrouterKey)
      return { ...r, configured, model: agentModelLabel(model) }
    })
  // 並べ替えをクエリに任せないのは、キーが入っているかが選んでいるモデルの提供元で決まるため
  return rows.sort((a, b) => Number(a.configured) - Number(b.configured))
}
