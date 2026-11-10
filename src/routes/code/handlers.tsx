import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { filesFor, type CodeFiles } from '../../lib/code'
import { getCodeItem, getDraft, latestSubmission, saveDraft, submitCode } from '../../lib/code-items'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { firstError, validate } from '../../lib/forms'
import { intParam, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { SandboxError, runCode } from '../../lib/sandbox'
import { items } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'

// 上限なしにしないのは、sandbox が同時に 4 つまでしか実行できず、1 人が繰り返し実行するとほかの人が待たされるため
const runLimit = rateLimiter({ limit: 20, windowSec: 60 })
const submitLimit = rateLimiter({ limit: 6, windowSec: 60 })
const running = new Set<number>()

async function codeAccess(c: Context<AppEnv>) {
  const courseId = intParam(c, 'id')
  const itemId = intParam(c, 'iid')
  const access = courseId && itemId && (await getCourseAccess(c, courseId))
  if (!access) return null
  const item = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, 'code')))
    .get()
  const code = item && getCodeItem(itemId)
  if (!code || (!access.canManage && !isVisibleItem(itemId))) return null
  return { access, code, itemId, userId: c.var.user!.id, itemUrl: `/courses/${courseId}/items/${itemId}` }
}

type CodeAccess = NonNullable<Awaited<ReturnType<typeof codeAccess>>>

type CodeInput = { ok: true; files: CodeFiles; stdin: string } | { ok: false; error: string }

async function readCode(c: Context<AppEnv>, { code }: CodeAccess): Promise<CodeInput> {
  const result = validate('code', await readForm(c))
  if (!result.ok) return { ok: false, error: firstError(result.errors) }
  const { stdin, ...files } = result.values
  return { ok: true, files: filesFor(code.language, files), stdin: code.language === 'python' ? stdin : '' }
}

export async function showState(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx) return c.notFound()
  const { code, itemId, userId } = ctx
  const draft = getDraft(itemId, userId)
  const files = draft?.files ?? latestSubmission(itemId, userId)?.files ?? code.starter
  c.header('Cache-Control', 'no-store')
  return c.json({ files: filesFor(code.language, files), stdin: draft?.stdin ?? code.stdin })
}

export async function save(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx) return c.notFound()
  if (!wantsJson(c)) return c.redirect(ctx.itemUrl, 303)
  const input = await readCode(c, ctx)
  if (!input.ok) return c.json({ error: input.error }, 422)
  saveDraft(ctx.itemId, ctx.userId, input.files, input.stdin)
  return c.json({ saved: true })
}

export async function run(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx || ctx.code.language !== 'python') return c.notFound()
  if (!wantsJson(c)) return c.redirect(ctx.itemUrl, 303)
  const { itemId, userId } = ctx
  const input = await readCode(c, ctx)
  if (!input.ok) return c.json({ error: input.error }, 422)
  saveDraft(itemId, userId, input.files, input.stdin)

  const key = String(userId)
  const wait = runLimit.retryAfter(key)
  if (wait) return c.json({ error: `実行の回数が多すぎます。${wait} 秒ほど待ってから、もう一度お試しください。` }, 429)
  if (running.has(userId)) return c.json({ error: '前の実行が終わるまでお待ちください。' }, 429)
  runLimit.hit(key)
  running.add(userId)
  try {
    return c.json({ result: await runCode({ language: 'python', code: input.files.py ?? '', stdin: input.stdin }) })
  } catch (e) {
    if (!(e instanceof SandboxError)) throw e
    return c.json({ error: `${e.message}。` }, 503)
  } finally {
    running.delete(userId)
  }
}

export async function submit(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx || ctx.access.role !== 'student') return c.notFound()
  const { itemId, userId, itemUrl } = ctx
  const input = await readCode(c, ctx)
  if (!input.ok) return redirectWith(c, itemUrl, input.error, 'error')
  const key = String(userId)
  if (submitLimit.retryAfter(key))
    return redirectWith(c, itemUrl, '提出の回数が多すぎます。少し待ってから、もう一度お試しください。', 'error')
  submitLimit.hit(key)
  submitCode(itemId, userId, input.files, input.stdin)
  return redirectWith(c, itemUrl, '提出しました。')
}

export async function reset(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx) return c.notFound()
  const { code, itemId, userId, itemUrl } = ctx
  // 書きかけのコードを消すだけにしないのは、提出済みだと、次に開いたときに提出したコードが入るため
  saveDraft(itemId, userId, filesFor(code.language, code.starter), code.stdin)
  return redirectWith(c, itemUrl, '最初のコードに戻しました。', 'info')
}
