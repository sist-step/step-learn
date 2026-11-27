import type { Context } from 'hono'
import { formatDateTime } from '../../components/ui'
import { csvHeaders, csvText } from '../../lib/csv'
import { firstError } from '../../lib/forms'
import { readForm, redirectWith } from '../../lib/http'
import { openItem } from '../../lib/item-access'
import type { AppEnv } from '../../lib/types'
import { answerText, readSurveyAnswers, summarizeSurvey, surveyPhase } from './survey'
import { getSurveySettings, responseOf, responsesOf, saveResponse, studentCount, surveyItemUrl } from './survey-items'
import { ResultsPage } from './views'

async function open(c: Context<AppEnv>) {
  const opened = await openItem(c, 'survey')
  if (!opened) return null
  const { access, itemId, item } = opened
  return {
    access,
    item: { id: itemId, title: item.title },
    settings: getSurveySettings(itemId),
    page: surveyItemUrl(access.course.id, itemId),
  }
}

async function manage(c: Context<AppEnv>) {
  const ctx = await open(c)
  return ctx && ctx.access.canManage ? ctx : null
}

export async function submit(c: Context<AppEnv>) {
  const ctx = await open(c)
  if (!ctx || ctx.access.role !== 'student') return c.notFound()
  const { access, item, settings, page } = ctx
  const userId = c.var.user!.id
  if (settings.questions.length === 0) return redirectWith(c, page, '問いがまだありません。', 'error')
  const phase = surveyPhase(settings, Math.floor(Date.now() / 1000))
  if (phase !== 'open') return redirectWith(c, page, phase === 'before' ? 'まだ回答を受け付けていません。' : '締め切りました。', 'error')

  const { answers, issues } = readSurveyAnswers(settings.questions, await readForm(c, { all: true }))
  if (issues.length) return redirectWith(c, page, firstError(Object.fromEntries(issues.map((i) => [i.key, i.message]))), 'error')
  const replace = settings.allowEdit === 1
  const had = !!responseOf(item.id, userId)
  if (!saveResponse(access.course.id, item.id, userId, answers, replace)) return redirectWith(c, page, 'すでに回答しています。', 'error')
  return redirectWith(c, page, had ? '回答を送り直しました。' : '回答を送りました。')
}

export async function results(c: Context<AppEnv>) {
  const ctx = await manage(c)
  if (!ctx) return c.notFound()
  const { access, item, settings, page } = ctx
  const responses = responsesOf(item.id)
  return c.render(
    <ResultsPage
      access={access}
      item={item}
      pageUrl={page}
      settings={settings}
      summaries={summarizeSurvey(settings.questions, settings.anonymous ? shuffled(responses) : responses)}
      responses={settings.anonymous ? null : responses}
      total={responses.length}
      students={await studentCount(access.course.id)}
    />,
    { title: `アンケートの結果 - ${item.title}` },
  )
}

/** 匿名のアンケートの回答の並び。回答した順のままにしないのは、並び順から、だれの回答かを推し量れないようにするため */
function shuffled<T>(list: T[]) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 回答の一覧の CSV。匿名なら名前と回答日時の列を出さない */
export async function csv(c: Context<AppEnv>) {
  const ctx = await manage(c)
  if (!ctx) return c.notFound()
  const { item, settings } = ctx
  const named = settings.anonymous === 0
  const responses = responsesOf(item.id)
  const head = [...(named ? ['氏名', 'ユーザー名', '回答日時'] : []), ...settings.questions.map((q) => q.prompt)]
  const rows = (named ? responses : shuffled(responses)).map((r) => [
    ...(named ? [r.name, r.username ?? '', formatDateTime(r.updatedAt)] : []),
    ...settings.questions.map((q) => answerText(r.answers.find((a) => a.id === q.id))),
  ])
  return new Response(csvText([head, ...rows]), { headers: csvHeaders(`${item.title}-回答.csv`) })
}
