import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'
import {
  AGENT_DEFAULT_LIMITS,
  MAX_AGENT_TOKENS,
  agentModelOf,
  openRouterInfoOf,
  type AgentModel,
  type AgentProvider,
  type AgentStore,
} from '../features/agent/agent'
import { agentTokenHash, apiKeyHintOf, newAgentToken, openApiKey, sealApiKey } from '../features/agent/agent-secret'
import { db } from './db'
import { agentItems, agentTokens, agentUsage, users } from './schema'

const unix = (v: unknown) => (typeof v === 'number' ? v : null)

/** extra_items の data（extra-kinds.tsx の agent の toData が作る）の、教師が書く AI への指示 */
const agentInstructionsOf = (data: Record<string, unknown>) => (typeof data.instructions === 'string' ? data.instructions : '')

/** extra_items の data の、教師が決める使える期間と 1 人あたりの上限 */
export const agentPeriodOf = (data: Record<string, unknown>) => ({
  opensAt: unix(data.opensAt),
  closesAt: unix(data.closesAt),
  userLimit: typeof data.userLimit === 'number' ? data.userLimit : AGENT_DEFAULT_LIMITS.userLimit,
})

/** extra_items の data の、教師が選んだモデル */
export const agentModelOfData = (data: Record<string, unknown>) => agentModelOf(data.model, data.openrouterModel)

/** extra_items の data に入れる、教師が選んだモデル */
export const agentModelData = (model: AgentModel) => ({
  model: model.id,
  openrouterModel: model.provider === 'openrouter' ? openRouterInfoOf(model) : null,
})

// 提供元ごとに付加データを変えるのは、暗号化したキーを別の列へ書き写されても、別の提供元のキーとして開けないようにするため
const aadOf = (key: string, provider: AgentProvider) =>
  provider === 'anthropic' ? `moodle-agent-item:${key}` : `moodle-agent-item:${key}:openrouter`

const KEY_COLUMNS = {
  anthropic: { key: 'apiKey', hint: 'apiKeyHint' },
  openrouter: { key: 'openrouterApiKey', hint: 'openrouterApiKeyHint' },
} as const satisfies Record<AgentProvider, { key: keyof typeof agentItems.$inferSelect; hint: keyof typeof agentItems.$inferSelect }>

const costSum = sql<number>`coalesce(sum(${agentUsage.cost}), 0)`

/** Moodle モード（moodle-mode.db）の、アイテム 1 つの設定・使用量・トークン。key は extra_items の key、data はその中身 */
export function agentStore(key: string, data: Record<string, unknown>): AgentStore {
  const keyRow = () => db.select().from(agentItems).where(eq(agentItems.key, key)).get()
  const openKey = (row: typeof agentItems.$inferSelect | undefined, provider: AgentProvider) => {
    const sealed = row?.[KEY_COLUMNS[provider].key]
    return sealed ? openApiKey(aadOf(key, provider), sealed) : null
  }
  const keyState = (row: typeof agentItems.$inferSelect | undefined, provider: AgentProvider) => {
    const configured = openKey(row, provider) !== null
    return { configured, hint: configured ? (row?.[KEY_COLUMNS[provider].hint] ?? '') : '' }
  }
  const saveRow = (set: Partial<typeof agentItems.$inferInsert>) =>
    void db
      .insert(agentItems)
      .values({ key, ...set })
      .onConflictDoUpdate({ target: agentItems.key, set })
      .run()
  const ofItem = eq(agentUsage.key, key)

  return {
    settings() {
      const row = keyRow()
      const model = agentModelOfData(data)
      const keys = { anthropic: keyState(row, 'anthropic'), openrouter: keyState(row, 'openrouter') }
      return {
        configured: keys[model.provider].configured,
        keys,
        model,
        ...agentPeriodOf(data),
        totalLimit: row?.totalLimit ?? AGENT_DEFAULT_LIMITS.totalLimit,
        instructions: agentInstructionsOf(data),
      }
    },
    apiKey: (provider) => openKey(keyRow(), provider),
    saveKey: ({ keys, totalLimit }) =>
      saveRow({
        totalLimit,
        ...Object.fromEntries(
          (Object.keys(KEY_COLUMNS) as AgentProvider[]).flatMap((provider) => {
            const apiKey = keys[provider]
            const columns = KEY_COLUMNS[provider]
            return apiKey
              ? [
                  [columns.key, sealApiKey(aadOf(key, provider), apiKey)],
                  [columns.hint, apiKeyHintOf(apiKey)],
                ]
              : []
          }),
        ),
      }),
    clearKey: (provider) => saveRow({ [KEY_COLUMNS[provider].key]: null, [KEY_COLUMNS[provider].hint]: '' }),
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
        .values({ key, userId, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cost: usage.cost })
        .run(),
    // 学生の一覧を Moodle から取らないのは、参加者が Moodle にあり、使った人だけを並べれば足りるため
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
    tokenCount: () => db.select({ n: count() }).from(agentTokens).where(eq(agentTokens.key, key)).get()!.n,
    issueToken(userId) {
      const token = newAgentToken()
      db.transaction((tx) => {
        tx.insert(agentTokens)
          .values({ key, userId, tokenHash: agentTokenHash(token)! })
          .run()
        const stale = tx
          .select({ id: agentTokens.id })
          .from(agentTokens)
          .where(and(eq(agentTokens.key, key), eq(agentTokens.userId, userId)))
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

/** トークンの ID・アイテムの key・持ち主。知らないトークンなら null */
export function findAgentToken(token: string) {
  const hash = agentTokenHash(token)
  if (!hash) return null
  return (
    db
      .select({ id: agentTokens.id, key: agentTokens.key, userId: agentTokens.userId })
      .from(agentTokens)
      .where(eq(agentTokens.tokenHash, hash))
      .get() ?? null
  )
}

export const touchAgentToken = (id: number) =>
  void db
    .update(agentTokens)
    .set({ lastUsedAt: sql`(unixepoch())` })
    .where(eq(agentTokens.id, id))
    .run()

export const revokeAgentToken = (id: number) => void db.delete(agentTokens).where(eq(agentTokens.id, id)).run()

/** 管理画面の一覧の、アイテムごとの提供元ごとのキーの有無と使った額 */
export function agentKeyStates(keys: string[]) {
  if (!keys.length) return new Map<string, { keys: Record<AgentProvider, boolean>; totalLimit: number; spent: number }>()
  const rows = db
    .select({
      key: agentItems.key,
      anthropic: sql<number>`${agentItems.apiKey} IS NOT NULL`,
      openrouter: sql<number>`${agentItems.openrouterApiKey} IS NOT NULL`,
      totalLimit: agentItems.totalLimit,
    })
    .from(agentItems)
    .where(inArray(agentItems.key, keys))
    .all()
  const spent = db
    .select({ key: agentUsage.key, total: costSum })
    .from(agentUsage)
    .where(inArray(agentUsage.key, keys))
    .groupBy(agentUsage.key)
    .all()
  const spentOf = new Map(spent.map((s) => [s.key, s.total]))
  const rowOf = new Map(rows.map((r) => [r.key, r]))
  return new Map(
    keys.map((k) => [
      k,
      {
        keys: { anthropic: !!rowOf.get(k)?.anthropic, openrouter: !!rowOf.get(k)?.openrouter },
        totalLimit: rowOf.get(k)?.totalLimit ?? AGENT_DEFAULT_LIMITS.totalLimit,
        spent: spentOf.get(k) ?? 0,
      },
    ]),
  )
}
