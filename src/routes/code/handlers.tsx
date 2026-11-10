import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { filesFor, type CodeFiles } from '../../lib/code'
import { enqueueGrading, gradingEnabled, gradingStatusOf } from '../../lib/code-grading'
import {
  getCodeItem,
  getDraft,
  getSubmission,
  latestSubmission,
  listSubmissions,
  listUserSubmissions,
  reviewSubmission,
  saveDraft,
  setGradingStatus,
  submitCode,
} from '../../lib/code-items'
import { getCourseAccess, isVisibleItem } from '../../lib/courses'
import { db } from '../../lib/db'
import { firstError, validate } from '../../lib/forms'
import { field, intParam, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { SandboxError, runCode } from '../../lib/sandbox'
import { enrollments, items, users } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { SubmissionPage, SubmissionsPage, submissionsUrl, type StudentRow, type SubmissionSummary } from './views'

// 上限なしにしないのは、sandbox が同時に 4 つまでしか実行できず、1 人が繰り返し実行するとほかの人が待たされるため
const runLimit = rateLimiter({ limit: 20, windowSec: 60 })
// AI が採点するときに回数を絞るのは、提出のたびに AI の利用料がかかるため
const submitLimit = rateLimiter(gradingEnabled ? { limit: 1, windowSec: 60 } : { limit: 6, windowSec: 60 })
const running = new Set<number>()

async function codeAccess(c: Context<AppEnv>) {
  const courseId = intParam(c, 'id')
  const itemId = intParam(c, 'iid')
  const access = courseId && itemId && (await getCourseAccess(c, courseId))
  if (!access) return null
  const item = db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.courseId, courseId), eq(items.type, 'code')))
    .get()
  const code = item && getCodeItem(itemId)
  if (!code || (!access.canManage && !isVisibleItem(itemId))) return null
  return {
    access,
    code,
    courseId,
    itemId,
    userId: c.var.user!.id,
    itemUrl: `/courses/${courseId}/items/${itemId}`,
    target: { id: itemId, title: item.title, language: code.language, maxScore: code.maxScore },
  }
}

type CodeAccess = NonNullable<Awaited<ReturnType<typeof codeAccess>>>

type CodeInput = { ok: true; files: CodeFiles; stdin: string } | { ok: false; error: string }

async function readCode(c: Context<AppEnv>, { code }: CodeAccess): Promise<CodeInput> {
  const result = validate('code', await readForm(c))
  if (!result.ok) return { ok: false, error: firstError(result.errors) }
  const { stdin, ...files } = result.values
  return { ok: true, files: filesFor(code.language, files), stdin: code.language === 'python' ? stdin : '' }
}

// ---------------------------------------------------------------- 書く・実行する・提出する

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
  const wait = submitLimit.retryAfter(key)
  if (wait) return redirectWith(c, itemUrl, `続けて提出できません。${wait} 秒ほど待ってから、もう一度お試しください。`, 'error')
  submitLimit.hit(key)
  const id = submitCode(itemId, userId, input.files, input.stdin, gradingEnabled ? 'pending' : 'none')
  if (gradingEnabled) enqueueGrading(id)
  return redirectWith(c, itemUrl, gradingEnabled ? '提出しました。採点が終わると、結果が出ます。' : '提出しました。')
}

export async function reset(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx) return c.notFound()
  const { code, itemId, userId, itemUrl } = ctx
  // 書きかけのコードを消すだけにしないのは、提出済みだと、次に開いたときに提出したコードが入るため
  saveDraft(itemId, userId, filesFor(code.language, code.starter), code.stdin)
  return redirectWith(c, itemUrl, '最初のコードに戻しました。', 'info')
}

/** 自分のいちばん新しい提出が採点中かどうか（src/code-editor.ts が採点の終わりを待つのに使う） */
export async function showGrading(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  if (!ctx) return c.notFound()
  const latest = latestSubmission(ctx.itemId, ctx.userId)
  c.header('Cache-Control', 'no-store')
  return c.json({ pending: !!latest && gradingStatusOf(latest) === 'pending' })
}

// ---------------------------------------------------------------- 教師: 提出を見る・採点する

async function manageAccess(c: Context<AppEnv>) {
  const ctx = await codeAccess(c)
  return ctx && ctx.access.canManage ? ctx : null
}

const summary = (s: SubmissionSummary): SubmissionSummary => ({ ...s, status: gradingStatusOf(s) })

export async function list(c: Context<AppEnv>) {
  const ctx = await manageAccess(c)
  if (!ctx) return c.notFound()
  const { access, courseId, itemId, target } = ctx
  const students = db
    .select({ id: users.id, name: users.name, username: users.username, email: users.email })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, 'student')))
    .orderBy(users.name)
    .limit(1000)
    .all()
  const byStudent = new Map<number, { count: number; latest: SubmissionSummary }>()
  for (const s of listSubmissions(itemId)) {
    const entry = byStudent.get(s.userId)
    if (entry) entry.count++
    else byStudent.set(s.userId, { count: 1, latest: summary(s) })
  }
  const rows: StudentRow[] = students.map((student) => ({ student, ...(byStudent.get(student.id) ?? { count: 0, latest: null }) }))
  return c.render(<SubmissionsPage access={access} item={target} rows={rows} />, { title: `提出 - ${target.title}` })
}

async function studentSubmissions(c: Context<AppEnv>) {
  const ctx = await manageAccess(c)
  const studentId = intParam(c, 'uid')
  if (!ctx || !studentId) return null
  const student = db
    .select({ id: users.id, name: users.name, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.id, studentId))
    .get()
  const history = listUserSubmissions(ctx.itemId, studentId).map(summary)
  if (!student || history.length === 0) return null
  return { ...ctx, student, history, back: submissionsUrl(ctx.courseId, ctx.itemId, studentId) }
}

export async function show(c: Context<AppEnv>) {
  const ctx = await studentSubmissions(c)
  if (!ctx) return c.notFound()
  const { access, itemId, target, student, history } = ctx
  const wanted = Number(c.req.query('submission')) || history[0].id
  // ほかの学生の提出の ID を付けた URL で開けないよう、この学生の提出の中から選ぶ
  const chosen = history.find((h) => h.id === wanted)
  const submission = chosen && getSubmission(itemId, chosen.id)
  if (!submission) return c.notFound()
  return c.render(
    <SubmissionPage
      access={access}
      item={target}
      student={student}
      submission={{ ...submission, status: chosen.status }}
      history={history}
      gradingEnabled={gradingEnabled}
    />,
    { title: `${student.name} さんの提出 - ${target.title}` },
  )
}

export async function review(c: Context<AppEnv>) {
  const ctx = await studentSubmissions(c)
  if (!ctx) return c.notFound()
  const { code, itemId, history, back, courseId, student } = ctx
  const result = validate('codeReview', await readForm(c))
  if (!result.ok) return redirectWith(c, back, firstError(result.errors), 'error')
  const { submission, score, comment } = result.values
  const target = history.find((h) => h.id === Number(submission))
  if (!target) return c.notFound()
  const url = submissionsUrl(courseId, itemId, student.id, target.id)
  if (score && Number(score) > code.maxScore) return redirectWith(c, url, `点数は ${code.maxScore} 点までで入力してください。`, 'error')
  reviewSubmission(itemId, target.id, score ? Number(score) : null, comment)
  return redirectWith(c, url, '採点を保存しました。')
}

export async function regrade(c: Context<AppEnv>) {
  const ctx = await studentSubmissions(c)
  if (!ctx || !gradingEnabled) return c.notFound()
  const { itemId, history, courseId, student } = ctx
  const wanted = Number(field(await readForm(c), 'submission', 20))
  const target = history.find((h) => h.id === wanted)
  if (!target) return c.notFound()
  const url = submissionsUrl(courseId, itemId, student.id, target.id)
  if (target.status === 'pending') return redirectWith(c, url, 'すでに採点しています。', 'info')
  setGradingStatus(itemId, target.id, 'pending')
  enqueueGrading(target.id)
  return redirectWith(c, url, 'AI が採点しています。少し待ってから、ページを読み込み直してください。', 'info')
}
