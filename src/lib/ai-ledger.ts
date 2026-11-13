// DB を読み込まず、渡された DB とテーブルで動かすのは、通常モード（step-learn.db）と Moodle モード（moodle-mode.db）の両方で同じ計算を使うため
import { and, countDistinct, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  AI_LIMITED_MODELS,
  AI_PROVIDER_MODELS,
  AI_PROVIDERS,
  AI_RESERVE_THRESHOLD,
  AI_RETIRED_PROVIDER_MODELS,
  OPENROUTER_DECISION_MODELS,
  aiProvider,
  isLimitedModel,
  isModelPaused,
  isProviderEnabled,
  isReserveModel,
  type AiLimitedModel,
  type AiModel,
  type DecisionModel,
  type AiProvider,
  type AiUsage,
} from './ai'
import {
  AI_ACTIVE_WINDOW,
  AI_DEFAULT_MONTHLY_LIMITS,
  AI_DEFAULT_WEEKLY_SHARES,
  aiModelQuota,
  aiPeriod,
  aiPool,
  aiQuota,
  type AiQuota,
} from './ai-quota'
import type { aiUsage as aiUsageTable, appSettings as appSettingsTable } from './schema'

const limitKey = (provider: AiProvider) => `ai_monthly_limit_${provider}`

const shareKey = (model: AiLimitedModel) => `ai_weekly_share_${model}`

const unixNow = () => Math.floor(Date.now() / 1000)

export type AiOverview = {
  provider: AiProvider
  enabled: boolean
  monthlyLimit: number
  monthSpent: number
  /** 今週の全体枠 */
  pool: number
  activeUsers: number
  /** この提供元のモデルだけの週の枠と、提供元の 1 人あたりの枠に対する割合 */
  shares: { model: AiLimitedModel; share: number }[]
}

/** ユーザーとモデルの組ごとの使用量。name などが null の行は、利用者に数えない使用量と、削除されたユーザーの分をまとめたもの */
export type AiUserUsage = {
  id: number | null
  name: string | null
  username: string | null
  email: string | null
  model: string
  week: number
  month: number
  calls: number
}

export type AiLedger = ReturnType<typeof createAiLedger>

/** AI の月の上限と使用量を、db の ai_usage と app_settings で扱う。Moodle モードのテーブルも同じ形にする（moodle-mode/schema.ts） */
export function createAiLedger<S extends Record<string, unknown>>({
  db,
  aiUsage,
  appSettings,
}: {
  db: BetterSQLite3Database<S>
  aiUsage: typeof aiUsageTable
  appSettings: typeof appSettingsTable
}) {
  const totalCost = sql<number>`coalesce(sum(${aiUsage.cost}), 0)`
  const weekCost = (start: number) => sql<number>`coalesce(sum(case when ${aiUsage.createdAt} >= ${start} then ${aiUsage.cost} end), 0)`

  // 提供元の列を持たないのは、モデルから決まるので、記録と一覧がずれる余地を作らないため
  const ofProvider = (provider: AiProvider) =>
    inArray(aiUsage.model, [
      ...AI_PROVIDER_MODELS[provider],
      ...AI_RETIRED_PROVIDER_MODELS[provider],
      ...(provider === 'openrouter' ? OPENROUTER_DECISION_MODELS : []),
    ])

  /** 月の上限（USD）。0 なら、その提供元のモデルは使えない */
  function getMonthlyLimit(provider: AiProvider) {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, limitKey(provider)))
      .get()
    const limit = row ? Number(row.value) : AI_DEFAULT_MONTHLY_LIMITS[provider]
    return Number.isFinite(limit) && limit > 0 ? limit : 0
  }

  /** model だけの週の枠の、提供元の 1 人あたりの週の枠に対する割合（0〜1）。0 なら、そのモデルは使えない */
  function getWeeklyShare(model: AiLimitedModel) {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, shareKey(model)))
      .get()
    const share = row ? Number(row.value) : AI_DEFAULT_WEEKLY_SHARES[model]
    return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0
  }

  function setLimits(limits: Record<AiProvider, number>, shares: Record<AiLimitedModel, number>) {
    const entries = [
      ...AI_PROVIDERS.map((p) => [limitKey(p), limits[p]] as const),
      ...AI_LIMITED_MODELS.map((m) => [shareKey(m), shares[m]] as const),
    ]
    db.transaction((tx) => {
      for (const [key, n] of entries) {
        const value = String(n)
        tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
      }
    })
  }

  /** userId が null のものは、特定の利用者に数えない使用量（コードのアイテムの採点） */
  function recordUsage(userId: number | null, model: AiModel | DecisionModel, usage: AiUsage) {
    db.insert(aiUsage)
      .values({ userId, model, ...usage })
      .run()
  }

  const spent = (
    provider: AiProvider,
    from: number,
    { until, userId, model }: { until?: number; userId?: number; model?: AiLimitedModel } = {},
  ) =>
    db
      .select({ cost: totalCost })
      .from(aiUsage)
      .where(
        and(
          model === undefined ? ofProvider(provider) : eq(aiUsage.model, model),
          gte(aiUsage.createdAt, from),
          until === undefined ? undefined : lt(aiUsage.createdAt, until),
          userId === undefined ? undefined : eq(aiUsage.userId, userId),
        ),
      )
      .get()?.cost ?? 0

  const activeUsers = (provider: AiProvider, at: number, except?: number) =>
    db
      .select({ n: countDistinct(aiUsage.userId) })
      .from(aiUsage)
      .where(
        and(
          ofProvider(provider),
          gte(aiUsage.createdAt, at - AI_ACTIVE_WINDOW),
          except === undefined ? undefined : ne(aiUsage.userId, except),
        ),
      )
      .get()?.n ?? 0

  /** model を使うときに確かめる、本人の今週の枠と使った額。先頭は提供元の枠で、model だけの枠があれば続ける */
  function getQuotas(userId: number, model: AiModel, at = unixNow()): AiQuota[] {
    const provider = aiProvider(model)
    const period = aiPeriod(at)
    const quota = aiQuota({
      monthlyLimit: getMonthlyLimit(provider),
      monthSpent: spent(provider, period.monthStart),
      spentBefore: spent(provider, period.monthStart, { until: period.start }),
      userSpent: spent(provider, period.start, { userId }),
      // 本人を必ず数えるのは、初めて使う人の枠が、ほかの人数だけで割った大きい額にならないようにするため
      activeUsers: activeUsers(provider, at, userId) + 1,
      period,
    })
    if (!isLimitedModel(model)) return [quota]
    const used = spent(provider, period.start, { userId, model })
    return [quota, aiModelQuota(quota, { model, share: getWeeklyShare(model), used })]
  }

  /** model を今使えるかを決める枠。使えない枠があればそれを、なければ提供元の枠を返す */
  function getQuota(userId: number, model: AiModel, at = unixNow()): AiQuota {
    const quotas = getQuotas(userId, model, at)
    return quotas.find((q) => q.state !== 'ok') ?? quotas[0]
  }

  /** 全体で、今月の使用量が月の上限に達していないか */
  function withinMonthlyLimit(provider: AiProvider, at = unixNow()) {
    return spent(provider, aiPeriod(at).monthStart) < getMonthlyLimit(provider)
  }

  /** model を今使えるか（API キーの有無は別に確かめる）。予備のモデル（AI_RESERVE_MODELS）は、Claude を使えないときと、Anthropic の今月の使用量が月の上限の AI_RESERVE_THRESHOLD を超えたときだけ使える */
  function isModelAvailable(model: AiModel | DecisionModel, at = unixNow()) {
    if (isModelPaused(model)) return false
    if (!isReserveModel(model)) return true
    const limit = getMonthlyLimit('anthropic')
    return !isProviderEnabled('anthropic') || limit === 0 || spent('anthropic', aiPeriod(at).monthStart) > limit * AI_RESERVE_THRESHOLD
  }

  function aiOverview(provider: AiProvider, at = unixNow()): AiOverview {
    const period = aiPeriod(at)
    const monthlyLimit = getMonthlyLimit(provider)
    return {
      provider,
      enabled: isProviderEnabled(provider),
      monthlyLimit,
      monthSpent: spent(provider, period.monthStart),
      pool: aiPool(monthlyLimit, spent(provider, period.monthStart, { until: period.start }), period),
      activeUsers: activeUsers(provider, at),
      shares: AI_LIMITED_MODELS.filter((m) => aiProvider(m) === provider).map((model) => ({ model, share: getWeeklyShare(model) })),
    }
  }

  return {
    totalCost,
    weekCost,
    getMonthlyLimit,
    getWeeklyShare,
    setLimits,
    recordUsage,
    getQuotas,
    getQuota,
    withinMonthlyLimit,
    isModelAvailable,
    aiOverview,
  }
}
