// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/ai-usage.ts など）を import しない。
// モードごとの DB は AiAdminBackend として受け取る（通常モードは ./handlers.tsx、Moodle モードは moodle-mode/app.tsx）
import type { Context } from 'hono'
import { AI_LIMITED_MODELS, AI_PROVIDERS, type AiLimitedModel, type AiProvider } from '../../lib/ai'
import type { AiLedger, AiUserUsage } from '../../lib/ai-ledger'
import { validate, type FieldErrors } from '../../lib/forms'
import { field, readForm, redirectWith } from '../../lib/http'
import type { AppEnv } from '../../lib/types'
import { AiPage, aiLimitField, aiShareField, type AiSettingValues } from './views'

type C = Context<AppEnv>

export type AiAdminBackend = {
  ledger: AiLedger
  usageByUser: () => AiUserUsage[]
  /** Moodle モードのときの、Moodle のサイト管理の URL。ユーザーとコースの管理は Moodle で行う */
  moodleAdminUrl?: string
}

const perProvider = <T,>(value: (provider: AiProvider) => T) =>
  Object.fromEntries(AI_PROVIDERS.map((p) => [p, value(p)])) as Record<AiProvider, T>

const perLimitedModel = <T,>(value: (model: AiLimitedModel) => T) =>
  Object.fromEntries(AI_LIMITED_MODELS.map((m) => [m, value(m)])) as Record<AiLimitedModel, T>

export function createAiAdminHandlers({ ledger, usageByUser, moodleAdminUrl }: AiAdminBackend) {
  const render = (c: C, form?: { values: AiSettingValues; errors: FieldErrors }) => {
    const overviews = AI_PROVIDERS.map((p) => ledger.aiOverview(p))
    const saved: AiSettingValues = {
      limits: perProvider((p) => String(ledger.getMonthlyLimit(p))),
      shares: perLimitedModel((m) => String(Math.round(ledger.getWeeklyShare(m) * 100))),
    }
    return c.render(
      <AiPage
        overviews={overviews}
        list={usageByUser()}
        values={form?.values ?? saved}
        errors={form?.errors}
        moodleAdminUrl={moodleAdminUrl}
      />,
      { title: 'AI - 管理' },
    )
  }

  return {
    show: (c: C) => render(c),
    update: async (c: C) => {
      const form = await readForm(c)
      const result = validate('aiSettings', form)
      if (!result.ok) {
        c.status(422)
        const values = {
          limits: perProvider((p) => field(form, aiLimitField(p), 20)),
          shares: perLimitedModel((m) => field(form, aiShareField(m), 20)),
        }
        return render(c, { values, errors: result.errors })
      }
      ledger.setLimits(
        perProvider((p) => result.values[aiLimitField(p)]),
        perLimitedModel((m) => result.values[aiShareField(m)] / 100),
      )
      return redirectWith(c, '/admin/ai', '上限を保存しました。')
    },
  }
}
