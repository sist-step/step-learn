// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は CodeBackend として受け取る（通常モードは ./index.ts、Moodle モードは moodle-mode/code.tsx）
import { Hono, type Context } from 'hono'
import { filesFor, type CodeFiles } from '../../lib/code'
import { gradingEnabled, type Grader } from '../../lib/code-grader'
import type { CodeSettings, CodeStore, StudentRow, SubmissionSummary } from '../../lib/code-store'
import type { CourseAccess } from '../../lib/courses'
import { firstError, validate } from '../../lib/forms'
import { field, intParam, readForm, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { SandboxError, runCode, sandboxEnabled } from '../../lib/sandbox'
import type { AppEnv } from '../../lib/types'
import { CodePage, SubmissionPage, SubmissionsPage, submissionsUrl } from './views'

type C = Context<AppEnv>

export type CodeContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  settings: CodeSettings
  store: CodeStore
}

export type CodeBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら、設定と置き場所を返す。開けなければ null */
  resolve: (c: C) => Promise<CodeContext | null>
  grader: Grader
  /** エディターのある画面。通常モードはアイテムの画面、Moodle モードは専用の画面（showPage） */
  pageUrl: (courseId: number, itemId: number) => string
}

export function createCodeHandlers({ resolve, grader, pageUrl }: CodeBackend) {
  // 上限なしにしないのは、sandbox が同時に 4 つまでしか実行できず、1 人が繰り返し実行するとほかの人が待たされるため
  const runLimit = rateLimiter({ limit: 20, windowSec: 60 })
  // AI が採点するときに回数を絞るのは、提出のたびに AI の利用料がかかるため
  const submitLimit = rateLimiter(gradingEnabled ? { limit: 1, windowSec: 60 } : { limit: 6, windowSec: 60 })
  const running = new Set<number>()

  async function open(c: C) {
    const ctx = await resolve(c)
    if (!ctx) return null
    const { access, itemId, settings } = ctx
    return {
      ...ctx,
      userId: c.var.user!.id,
      courseId: access.course.id,
      page: pageUrl(access.course.id, itemId),
      target: { id: itemId, title: settings.title, language: settings.language, maxScore: settings.maxScore },
    }
  }

  type Opened = NonNullable<Awaited<ReturnType<typeof open>>>

  type CodeInput = { ok: true; files: CodeFiles; stdin: string } | { ok: false; error: string }

  async function readCode(c: C, { settings }: Opened): Promise<CodeInput> {
    const result = validate('code', await readForm(c))
    if (!result.ok) return { ok: false, error: firstError(result.errors) }
    const { stdin, ...files } = result.values
    return { ok: true, files: filesFor(settings.language, files), stdin: settings.language === 'python' ? stdin : '' }
  }

  const summary = (s: SubmissionSummary): SubmissionSummary => ({ ...s, status: grader.statusOf(s) })

  function gradeOf({ store, settings, userId }: Opened) {
    const latest = store.latestSubmission(userId)
    return latest ? { ...latest, status: grader.statusOf(latest), maxScore: settings.maxScore } : null
  }

  // ---------------------------------------------------------------- 書く・実行する・提出する

  async function showState(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    const { settings, store, userId } = ctx
    const draft = store.getDraft(userId)
    const saved = draft?.files ?? store.latestSubmission(userId)?.files
    // 保存したコードに今の言語のファイルが 1 つもないとき（アイテムの言語が変えられた）に空のエディターを出さず、最初のコードから始める
    const usable = saved && Object.keys(filesFor(settings.language, {})).some((key) => key in saved)
    c.header('Cache-Control', 'no-store')
    return c.json({ files: filesFor(settings.language, usable ? saved : settings.starter), stdin: draft?.stdin ?? settings.stdin })
  }

  async function save(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    if (!wantsJson(c)) return c.redirect(ctx.page, 303)
    const input = await readCode(c, ctx)
    if (!input.ok) return c.json({ error: input.error }, 422)
    ctx.store.saveDraft(ctx.userId, input.files, input.stdin)
    return c.json({ saved: true })
  }

  async function run(c: C) {
    const ctx = await open(c)
    if (!ctx || ctx.settings.language !== 'python') return c.notFound()
    if (!wantsJson(c)) return c.redirect(ctx.page, 303)
    const { store, userId } = ctx
    const input = await readCode(c, ctx)
    if (!input.ok) return c.json({ error: input.error }, 422)
    store.saveDraft(userId, input.files, input.stdin)

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

  async function submit(c: C) {
    const ctx = await open(c)
    if (!ctx || ctx.access.role !== 'student') return c.notFound()
    const { store, userId, page } = ctx
    const input = await readCode(c, ctx)
    if (!input.ok) return redirectWith(c, page, input.error, 'error')
    const key = String(userId)
    const wait = submitLimit.retryAfter(key)
    if (wait) return redirectWith(c, page, `続けて提出できません。${wait} 秒ほど待ってから、もう一度お試しください。`, 'error')
    submitLimit.hit(key)
    const id = store.submit(userId, input.files, input.stdin, gradingEnabled ? 'pending' : 'none')
    if (gradingEnabled) grader.enqueue(id)
    return redirectWith(c, page, gradingEnabled ? '提出しました。採点が終わると、結果が出ます。' : '提出しました。')
  }

  async function reset(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    const { settings, store, userId, page } = ctx
    // 書きかけのコードを消すだけにしないのは、提出済みだと、次に開いたときに提出したコードが入るため
    store.saveDraft(userId, filesFor(settings.language, settings.starter), settings.stdin)
    return redirectWith(c, page, '最初のコードに戻しました。', 'info')
  }

  /** 自分のいちばん新しい提出が採点中かどうか（src/code-editor.ts が採点の終わりを待つのに使う） */
  async function showGrading(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    c.header('Cache-Control', 'no-store')
    return c.json({ pending: gradeOf(ctx)?.status === 'pending' })
  }

  /** エディターだけの画面。アイテムの画面にエディターを組み込まないモード（Moodle モード）で使う */
  async function showPage(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    const { access, target, settings } = ctx
    return c.render(
      <CodePage
        access={access}
        item={target}
        body={settings.body}
        canRun={sandboxEnabled}
        grade={access.role === 'student' ? gradeOf(ctx) : null}
      />,
      { title: settings.title },
    )
  }

  // ---------------------------------------------------------------- 教師: 提出を見る・採点する

  async function manage(c: C) {
    const ctx = await open(c)
    return ctx && ctx.access.canManage ? ctx : null
  }

  async function list(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, store, target, page } = ctx
    const byStudent = new Map<number, { count: number; latest: SubmissionSummary }>()
    for (const s of store.listSubmissions()) {
      const entry = byStudent.get(s.userId)
      if (entry) entry.count++
      else byStudent.set(s.userId, { count: 1, latest: summary(s) })
    }
    const rows: StudentRow[] = store
      .listStudents()
      .map((student) => ({ student, ...(byStudent.get(student.id) ?? { count: 0, latest: null }) }))
    return c.render(<SubmissionsPage access={access} item={target} pageUrl={page} rows={rows} />, { title: `提出 - ${target.title}` })
  }

  async function studentSubmissions(c: C) {
    const ctx = await manage(c)
    const studentId = intParam(c, 'uid')
    if (!ctx || !studentId) return null
    const student = ctx.store.findUser(studentId)
    const history = ctx.store.listUserSubmissions(studentId).map(summary)
    if (!student || history.length === 0) return null
    return { ...ctx, student, history }
  }

  async function show(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx) return c.notFound()
    const { access, store, target, page, student, history } = ctx
    const wanted = Number(c.req.query('submission')) || history[0].id
    // ほかの学生の提出の ID を付けた URL で開けないよう、この学生の提出の中から選ぶ
    const chosen = history.find((h) => h.id === wanted)
    const submission = chosen && store.getSubmission(chosen.id)
    if (!submission) return c.notFound()
    return c.render(
      <SubmissionPage
        access={access}
        item={target}
        pageUrl={page}
        student={student}
        submission={{ ...submission, status: chosen.status }}
        history={history}
        gradingEnabled={gradingEnabled}
      />,
      { title: `${student.name} さんの提出 - ${target.title}` },
    )
  }

  async function review(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx) return c.notFound()
    const { settings, store, courseId, itemId, student, history } = ctx
    const result = validate('codeReview', await readForm(c))
    if (!result.ok) return redirectWith(c, submissionsUrl(courseId, itemId, student.id), firstError(result.errors), 'error')
    const { submission, score, comment } = result.values
    const target = history.find((h) => h.id === Number(submission))
    if (!target) return c.notFound()
    const url = submissionsUrl(courseId, itemId, student.id, target.id)
    if (score && Number(score) > settings.maxScore)
      return redirectWith(c, url, `点数は ${settings.maxScore} 点までで入力してください。`, 'error')
    store.review(target.id, score ? Number(score) : null, comment)
    return redirectWith(c, url, '採点を保存しました。')
  }

  async function regrade(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx || !gradingEnabled) return c.notFound()
    const { store, courseId, itemId, student, history } = ctx
    const wanted = Number(field(await readForm(c), 'submission', 20))
    const target = history.find((h) => h.id === wanted)
    if (!target) return c.notFound()
    const url = submissionsUrl(courseId, itemId, student.id, target.id)
    if (target.status === 'pending') return redirectWith(c, url, 'すでに採点しています。', 'info')
    store.setStatus(target.id, 'pending')
    grader.enqueue(target.id)
    return redirectWith(c, url, 'AI が採点しています。少し待ってから、ページを読み込み直してください。', 'info')
  }

  return { showState, save, run, submit, reset, showGrading, showPage, list, show, review, regrade }
}

/** /courses の下に組み込むルート。ログインの確認は、組み込む側で先に済ませておく */
export function codeRoutes(h: ReturnType<typeof createCodeHandlers>) {
  const app = new Hono<AppEnv>()
  app.get('/:id/items/:iid/code/state', h.showState)
  app.post('/:id/items/:iid/code/draft', h.save)
  app.post('/:id/items/:iid/code/run', h.run)
  app.post('/:id/items/:iid/code/submit', h.submit)
  app.post('/:id/items/:iid/code/reset', h.reset)
  app.get('/:id/items/:iid/code/grading', h.showGrading)
  app.get('/:id/items/:iid/code/submissions', h.list)
  app.get('/:id/items/:iid/code/submissions/:uid', h.show)
  app.post('/:id/items/:iid/code/submissions/:uid/review', h.review)
  app.post('/:id/items/:iid/code/submissions/:uid/regrade', h.regrade)
  return app
}
