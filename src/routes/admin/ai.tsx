// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/ai-usage.ts など）を import しない。
// モードごとの DB は AiAdminBackend として受け取る（通常モードは ./handlers.tsx、Moodle モードは moodle-mode/app.tsx）
import type { Context } from 'hono'
import { AI_PROVIDERS, type AiProvider } from '../../lib/ai'
import type { AiLedger, AiUserUsage } from '../../lib/ai-ledger'
import { validate, type FieldErrors } from '../../lib/forms'
import { field, readForm, redirectWith } from '../../lib/http'
import type { AppEnv } from '../../lib/types'
import { AiPage, aiLimitField } from './views'

type C = Context<AppEnv>

export type AiAdminBackend = {
  ledger: AiLedger
  usageByUser: () => AiUserUsage[]
  /** Moodle モードのときの、Moodle のサイト管理の URL。ユーザーとコースの管理は Moodle で行う */
  moodleAdminUrl?: string
}

const perProvider = <T,>(value: (provider: AiProvider) => T) =>
  Object.fromEntries(AI_PROVIDERS.map((p) => [p, value(p)])) as Record<AiProvider, T>

export function createAiAdminHandlers({ ledger, usageByUser, moodleAdminUrl }: AiAdminBackend) {
  const render = (c: C, form?: { values: Record<AiProvider, string>; errors: FieldErrors }) => {
    const overviews = AI_PROVIDERS.map((p) => ledger.aiOverview(p))
    const saved = Object.fromEntries(overviews.map((o) => [o.provider, String(o.monthlyLimit)])) as Record<AiProvider, string>
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
        return render(c, { values: perProvider((p) => field(form, aiLimitField(p), 20)), errors: result.errors })
      }
      ledger.setMonthlyLimits(perProvider((p) => result.values[aiLimitField(p)]))
      return redirectWith(c, '/admin/ai', '月の上限を保存しました。')
    },
  }
}
