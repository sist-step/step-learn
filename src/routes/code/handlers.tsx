// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は CodeBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/code.ts）
import { Hono, type Context } from 'hono'
import { RequestContext } from 'hono/jsx-renderer'
import * as z from 'zod/mini'
import { CodeTrialResult } from '../../components/code'
import { AiError } from '../../lib/ai'
import { VSCODE_EXTENSION_ID } from '../../lib/bundle'
import { LAUNCH_CLAIM, claimCodeLaunch, signCode, signCodeLaunch, verifyCode } from '../../lib/bundle-token'
import {
  CODE_FILES,
  appealStateOf,
  filesFor,
  goalsOf,
  isCleared,
  isVerdict,
  sameFiles,
  submitStateOf,
  type CodeConstraint,
  type CodeFiles,
  type ConstraintResult,
  type SubmitPeriod,
  type SubmitState,
} from '../../lib/code'
import { gradingEnabled, submissionsOf, submitWait, type Grader } from '../../lib/code-grader'
import type { CodeSettings, CodeStore, StudentRow, Submission, SubmissionSummary } from '../../lib/code-store'
import { config } from '../../lib/config'
import type { CourseAccess } from '../../lib/courses'
import { firstError, readConstraints, solutionOf, validate, type FormValues } from '../../lib/forms'
import { clientIp, field, intParam, readFields, readForm, readJson, redirectWith, wantsJson } from '../../lib/http'
import { rateLimiter } from '../../lib/rate-limit'
import { SandboxError, runCode, sandboxEnabled } from '../../lib/sandbox'
import type { AppEnv, Completion } from '../../lib/types'
import {
  CodePage,
  SUBMISSION_FILTERS,
  SubmissionPage,
  SubmissionsPage,
  submissionsUrl,
  type ConstraintStat,
  type SubmissionFilter,
} from './views'

type C = Context<AppEnv>

export type CodeContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  itemId: number
  /** 拡張機能に渡すアイテムの識別子。targetOf に渡すと同じアイテムが返る */
  ref: string
  settings: CodeSettings
  /** 学生が提出できる期間。null なら期間を設けない */
  period: SubmitPeriod | null
  store: CodeStore
  /** エディターの画面に出す、見ている学生の完了の状態。完了を STEP Learn で数えないモード（Moodle モード）や、学生でなければ渡さない */
  completion?: { completion: Completion; done: boolean }
}

/** 拡張機能からの要求（ログインのセッションがない）で使う、アイテムの設定と置き場所 */
export type CodeTarget = Pick<CodeContext, 'settings' | 'period' | 'store'> & {
  course: string
  /** 提出できる人（コースの学生）か */
  isStudent: boolean
  courseId: number
  itemId: number
}

const SUBMIT_CLOSED: Record<Exclude<SubmitState, 'open'>, string> = {
  unset: '提出の期間が決まっていないため、まだ提出できません。',
  upcoming: '提出の受付はまだ始まっていません。',
  closed: '提出の受付は終わりました。',
}

export type CodeBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら、設定と置き場所を返す。開けなければ null */
  resolve: (c: C) => Promise<CodeContext | null>
  /** 拡張機能からの要求で、userId の人が ref のアイテムを今も開けるなら返す。開けなければ null */
  targetOf: (ref: string, userId: number) => Promise<CodeTarget | null>
  grader: Grader
  /** Web エディターの画面（showPage） */
  pageUrl: (courseId: number, itemId: number) => string
  /** アイテムの画面 */
  itemUrl: (courseId: number, itemId: number) => string
}

/** 書きかけのコード。なければ最後の提出、それもなければ最初のコード */
function currentCode(settings: CodeSettings, store: CodeStore, userId: number) {
  const draft = store.getDraft(userId)
  const saved = draft?.files ?? store.latestSubmission(userId)?.files
  // 保存したコードに今の言語のファイルが 1 つもないとき（アイテムの言語が変えられた）に空のエディターを出さず、最初のコードから始める
  const usable = saved && Object.keys(filesFor(settings.language, {})).some((key) => key in saved)
  return { files: filesFor(settings.language, usable ? saved : settings.starter), stdin: draft?.stdin ?? settings.stdin }
}

/** reused は、前に判定した提出と同じコードで、AI を呼ばずにその判定を写した */
type Accepted = { ok: true; graded: boolean; reused: boolean } | { ok: false; error: string }

const sameConstraints = (verdicts: readonly ConstraintResult[], constraints: readonly CodeConstraint[]) =>
  verdicts.length === constraints.length &&
  constraints.every((c, i) => c.label === verdicts[i].label && c.text === verdicts[i].text && !c.optional === !verdicts[i].optional)

/** 同じコードを判定していないか確かめる、さかのぼる提出の数 */
const REUSE_LOOKBACK = 10

/** 同じコードを、今と同じ制約で判定した提出。いちばん新しい提出だけを見ないのは、別のコードを 1 回挟めば、同じコードをもう一度 AI に判定させられるため */
function judgedBefore(
  { settings, store }: Pick<CodeContext, 'settings' | 'store'>,
  userId: number,
  files: CodeFiles,
): Submission | undefined {
  for (const s of store.listUserSubmissions(userId).slice(0, REUSE_LOOKBACK)) {
    if (s.status !== 'graded' || !s.verdicts || !sameConstraints(s.verdicts, settings.constraints)) continue
    const submission = store.getSubmission(s.id)
    if (submission && sameFiles(settings.language, submission.files, files)) return submission
  }
  return undefined
}

/** 提出を受け付けて、AI で判定できるなら判定を待つ列に入れる。受け付けられなければ、その理由 */
function acceptSubmission(
  grader: Grader,
  ctx: Pick<CodeContext, 'settings' | 'store' | 'period'>,
  userId: number,
  files: CodeFiles,
  stdin: string,
): Accepted {
  const { settings, store, period } = ctx
  const state = submitStateOf(period)
  if (state !== 'open') return { ok: false, error: SUBMIT_CLOSED[state] }
  if (sameFiles(settings.language, files, filesFor(settings.language, settings.starter)))
    return { ok: false, error: '最初のコードから変わっていません。コードを書いてから提出してください。' }
  // レート制限（rateLimiter）にしないのは、残りの秒数を画面のカウントダウンと合わせるため。提出の時刻から求めれば、再起動しても同じになる
  const wait = submitWait(store.latestSubmission(userId)?.createdAt)
  if (wait) return { ok: false, error: `続けて提出できません。${wait} 秒待ってから、もう一度お試しください。` }
  // 同じコードをもう一度 AI に判定させないのは、判定が揺れたときに、通るまで出し直せばクリアにできてしまうため
  const previous = judgedBefore(ctx, userId, files)
  const graded = !!previous || grader.canGrade()
  const id = store.submit(userId, files, stdin, graded ? 'pending' : 'none')
  if (previous) grader.reuse(id, previous)
  else if (graded) grader.enqueue(id)
  return { ok: true, graded, reused: !!previous }
}

const submittedMessage = (accepted: Extract<Accepted, { ok: true }>) =>
  accepted.reused
    ? '提出しました。前に判定したコードと同じなので、そのときの判定を出しています。'
    : accepted.graded
      ? '提出しました。採点が終わると、結果が出ます。'
      : '提出しました。'

const serverOrigin = (c: Context) => config.appOrigin ?? new URL(c.req.url).origin

export function createCodeHandlers({ resolve, grader, pageUrl, itemUrl }: CodeBackend) {
  // 上限なしにしないのは、sandbox が同時に 4 つまでしか実行できず、1 人が繰り返し実行するとほかの人が待たされるため
  const runLimit = rateLimiter({ limit: 20, windowSec: 60 })
  // 回数を絞るのは、押すたびに AI の利用料がかかるため
  const suggestLimit = rateLimiter({ limit: 5, windowSec: 60 })
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
      target: { id: itemId, title: settings.title, language: settings.language },
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

  function gradeOf({ store, userId }: Opened) {
    const latest = store.latestSubmission(userId)
    return latest ? { ...latest, status: grader.statusOf(latest) } : null
  }

  // ---------------------------------------------------------------- 書く・実行する・提出する

  async function showState(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    c.header('Cache-Control', 'no-store')
    return c.json(currentCode(ctx.settings, ctx.store, ctx.userId))
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
    const { userId, page } = ctx
    const input = await readCode(c, ctx)
    if (!input.ok) return redirectWith(c, page, input.error, 'error')
    const accepted = acceptSubmission(grader, ctx, userId, input.files, input.stdin)
    if (!accepted.ok) return redirectWith(c, page, accepted.error, 'error')
    return redirectWith(c, page, submittedMessage(accepted))
  }

  /** 学生が、自分のいちばん新しい提出の判定を、教師に確かめてもらうよう頼む */
  async function appeal(c: C) {
    const ctx = await open(c)
    if (!ctx || ctx.access.role !== 'student') return c.notFound()
    const latest = gradeOf(ctx)
    if (latest?.status !== 'graded' || !latest.verdicts?.length) return c.notFound()
    if (appealStateOf(latest) === 'none') ctx.store.appeal(latest.id)
    return redirectWith(c, c.req.header('referer') ?? ctx.page, '教師に知らせました。教師が判定を確かめます。')
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
    const latest = gradeOf(ctx)
    return c.json({ pending: latest?.status === 'pending', ahead: latest ? grader.aheadOf(latest.id) : 0 })
  }

  /** Web エディターの画面 */
  async function showPage(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    const { access, target, settings, courseId, itemId } = ctx
    return c.render(
      <CodePage
        access={access}
        item={target}
        itemUrl={itemUrl(courseId, itemId)}
        body={settings.body}
        goals={goalsOf(settings.constraints)}
        canRun={sandboxEnabled}
        submissions={access.role === 'student' ? submissionsOf(ctx.store, ctx.userId, grader, ctx.period) : null}
        completion={ctx.completion}
      />,
      { title: `Web エディター - ${settings.title}` },
    )
  }

  /** VS Code で開くリンク。拡張機能が鍵を引き換えて、書きかけのコードを受け取る */
  async function launch(c: C) {
    const ctx = await open(c)
    if (!ctx) return c.notFound()
    const { ref, userId, courseId, itemId } = ctx
    if (!wantsJson(c)) return c.redirect(itemUrl(courseId, itemId), 303)
    const query = new URLSearchParams({ server: serverOrigin(c), token: signCodeLaunch({ ref, userId }) })
    return c.json({ url: `vscode://${VSCODE_EXTENSION_ID}/code?${query}` })
  }

  // ---------------------------------------------------------------- 教師: 提出を見る・採点する

  async function manage(c: C) {
    const ctx = await open(c)
    return ctx && ctx.access.canManage ? ctx : null
  }

  /** 学生ごとの、提出の回数・いちばん新しい提出・どれかの提出でクリアしたか */
  function studentRows(store: CodeStore): StudentRow[] {
    const byStudent = new Map<number, Omit<StudentRow, 'student'>>()
    for (const s of store.listSubmissions()) {
      const cleared = s.status === 'graded' && isCleared(s.verdicts)
      const appealed = appealStateOf(s) === 'open' ? s.id : null
      const entry = byStudent.get(s.userId)
      if (entry) {
        entry.count++
        entry.cleared ||= cleared
        entry.appealed ??= appealed
      } else byStudent.set(s.userId, { count: 1, latest: summary(s), cleared, appealed })
    }
    const none = { count: 0, latest: null, cleared: false, appealed: null }
    return store.listStudents().map((student) => ({ student, ...(byStudent.get(student.id) ?? none) }))
  }

  /** 今の制約ごとに、いちばん新しい提出でできている学生の数。judged は、その制約を判定した提出のある学生の数 */
  function constraintStats(constraints: readonly CodeConstraint[], rows: readonly StudentRow[]): ConstraintStat[] {
    const judged = rows.flatMap((r) => (r.latest?.status === 'graded' && r.latest.verdicts ? [r.latest.verdicts] : []))
    return constraints.map(({ label, optional }) => {
      const verdicts = judged.flatMap((list) => list.find((v) => v.label === label) ?? [])
      return { label, optional: !!optional, passed: verdicts.filter((v) => v.verdict === 'pass').length, judged: verdicts.length }
    })
  }

  const FILTERS: Record<SubmissionFilter, (row: StudentRow) => boolean> = {
    all: () => true,
    unsubmitted: (r) => !r.latest,
    uncleared: (r) => !!r.latest && !r.cleared,
    appeal: (r) => r.appealed !== null,
  }

  /** 提出の一覧が変わったかを見分ける値。提出・採点の終わり・確認の依頼のどれでも変わる */
  function listRevision(store: CodeStore) {
    const all = store.listSubmissions()
    const count = (test: (s: SubmissionSummary) => boolean) => all.filter(test).length
    return [all.length, all[0]?.id ?? 0, count((s) => s.status === 'graded'), count((s) => appealStateOf(s) === 'open')].join('-')
  }

  async function list(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, store, target, page, settings, courseId, itemId } = ctx
    // 一覧を読む前に求めるのは、あとで求めると、そのあいだの変更を取りこぼすため
    const revision = listRevision(store)
    const rows = studentRows(store)
    const wanted = c.req.query('show')
    const filter = SUBMISSION_FILTERS.find((f) => f === wanted) ?? 'all'
    return c.render(
      <SubmissionsPage
        access={access}
        item={target}
        pageUrl={page}
        rows={rows.filter(FILTERS[filter])}
        counts={{
          students: rows.length,
          submitted: rows.filter((r) => r.latest).length,
          cleared: rows.filter((r) => r.cleared).length,
          unsubmitted: rows.filter(FILTERS.unsubmitted).length,
          uncleared: rows.filter(FILTERS.uncleared).length,
          appeal: rows.filter(FILTERS.appeal).length,
        }}
        filter={filter}
        stats={constraintStats(settings.constraints, rows)}
        live={{ url: `${submissionsUrl(courseId, itemId)}/revision`, revision }}
        gradingEnabled={gradingEnabled}
      />,
      { title: `提出 - ${target.title}` },
    )
  }

  async function showListRevision(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    c.header('Cache-Control', 'no-store')
    return c.json({ revision: listRevision(ctx.store) })
  }

  /** 制約を直したあとなどに、学生ごとのいちばん新しい提出を、まとめて AI に判定し直させる */
  async function regradeAll(c: C) {
    const ctx = await manage(c)
    if (!ctx || !gradingEnabled) return c.notFound()
    const { store, courseId, itemId } = ctx
    const url = submissionsUrl(courseId, itemId)
    if (!grader.canGrade()) return redirectWith(c, url, 'AI の今月の上限に達しているため、判定できません。', 'error')
    // 教師が判定を変えた提出を除くのは、教師が確かめて直した判定を、AI の判定で消してしまうため
    const targets = studentRows(store).flatMap((r) =>
      r.latest && r.latest.status !== 'pending' && !r.latest.verdicts?.some((v) => v.aiVerdict) ? [r.latest] : [],
    )
    for (const target of targets) {
      store.setStatus(target.id, 'pending')
      grader.enqueue(target.id)
    }
    const message = targets.length ? `${targets.length} 件の提出を、AI が判定し直しています。` : '判定し直す提出はありません。'
    return redirectWith(c, url, message, 'info')
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
    const { store, courseId, itemId, student, history } = ctx
    const result = validate('codeReview', await readForm(c))
    if (!result.ok) return redirectWith(c, submissionsUrl(courseId, itemId, student.id), firstError(result.errors), 'error')
    const { submission, comment } = result.values
    const target = history.find((h) => h.id === Number(submission))
    if (!target) return c.notFound()
    store.review(target.id, comment)
    return redirectWith(c, submissionsUrl(courseId, itemId, student.id, target.id), 'コメントを保存しました。')
  }

  /** 教師が、AI の判定を制約ごとに変える。学生が頼んでいた確認も済んだことにする */
  async function override(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx) return c.notFound()
    const { store, courseId, itemId, student, history } = ctx
    const form = await readForm(c)
    const fields = validate('codeVerdicts', form)
    const target = fields.ok ? history.find((h) => h.id === fields.values.submission) : undefined
    const submission = target?.status === 'graded' ? store.getSubmission(target.id) : undefined
    if (!submission?.verdicts?.length) return c.notFound()
    const verdicts = submission.verdicts.map((v, i): ConstraintResult => {
      const chosen = field(form, `verdict_${i}`, 10)
      if (!isVerdict(chosen) || chosen === v.verdict) return v
      const { aiVerdict = v.verdict, ...rest } = v
      return chosen === aiVerdict ? { ...rest, verdict: chosen } : { ...rest, verdict: chosen, aiVerdict }
    })
    store.overrideVerdicts(submission.id, verdicts)
    if (appealStateOf(submission) === 'open') store.closeAppeal(submission.id)
    return redirectWith(c, submissionsUrl(courseId, itemId, student.id, submission.id), '判定を保存しました。')
  }

  /** 教師が、学生に頼まれた判定の確認を、判定を変えずに済ませる */
  async function closeAppeal(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx) return c.notFound()
    const { store, courseId, itemId, student, history } = ctx
    const fields = await readFields(c, 'regrade')
    const target = fields && history.find((h) => h.id === fields.submission)
    if (!target || appealStateOf(target) !== 'open') return c.notFound()
    store.closeAppeal(target.id)
    return redirectWith(c, submissionsUrl(courseId, itemId, student.id, target.id), '確認済みにしました。')
  }

  /**
   * 編集画面から AI に作らせる要求を受ける。form のスキーマで読んだ値を make に渡し、返したものを JSON で返す。
   * what は作るものの名前（「下書き」など）で、断るときの文言に使う
   */
  /** 断るときの文言に使う、頼まれたこと。what は作るもの（「下書き」など）、did は「〜できません」の形 */
  type Asked = { what: string; did: string }

  async function suggestWith<F extends 'codeSuggest' | 'codeConstraintsSuggest' | 'codeTrial', T extends object>(
    c: C,
    form: F,
    { what, did }: Asked,
    make: (ctx: Opened, values: FormValues<F>) => Promise<T | { error: string } | null>,
    respond: (made: T) => Response | Promise<Response> = (made) => c.json(made),
  ) {
    const ctx = await manage(c)
    if (!ctx || !gradingEnabled) return c.notFound()
    if (!wantsJson(c)) return c.redirect(ctx.page, 303)
    const result = validate(form, await readForm(c))
    if (!result.ok) return c.json({ error: firstError(result.errors) }, 422)
    const key = String(ctx.userId)
    const wait = suggestLimit.retryAfter(key)
    if (wait) return c.json({ error: `続けて${did}。${wait} 秒ほど待ってから、もう一度お試しください。` }, 429)
    if (!grader.canGrade()) return c.json({ error: `AI の今月の上限に達しているため、${what}を${did}。` }, 503)
    suggestLimit.hit(key)
    try {
      const made = await make(ctx, result.values)
      if (made && 'error' in made) return c.json(made, 422)
      if (made) return await respond(made)
    } catch (e) {
      if (!(e instanceof AiError)) throw e
      console.error('[grading]', e.message)
    }
    return c.json({ error: `${what}を${did}でした。少し待ってから、もう一度お試しください。` }, 502)
  }

  const MAKE = '作れません'

  /** 編集画面の問題文から、最初のコード・解答例・制約の下書きを作る（src/code-editor.ts が編集画面の欄に入れる） */
  const suggest = (c: C) =>
    suggestWith(c, 'codeSuggest', { what: '下書き', did: MAKE }, async ({ settings, userId }, { title, body }) => {
      const draft = await grader.draftSetup({ title: title || settings.title, body, language: settings.language }, userId)
      return draft && { draft }
    })

  /** 編集画面の問題文と最初のコードから、制約だけを作る（src/code-editor.ts が編集画面の制約の欄に入れる） */
  const suggestConstraints = (c: C) =>
    suggestWith(
      c,
      'codeConstraintsSuggest',
      { what: '制約', did: MAKE },
      async ({ settings, userId }, { title, body, stdin: _, ...files }) => {
        const input = { title: title || settings.title, body, language: settings.language, starter: filesFor(settings.language, files) }
        const constraints = await grader.draftConstraints(input, userId)
        return constraints && { constraints }
      },
    )

  /**
   * 編集画面に入っている保存前の問題で、解答例と最初のコードを試しに判定する（src/code-editor.ts が、返した HTML を解答例のカードに入れる）。
   * c.render で返さないのは、カードの中身だけを差し替えるのにページ全体のレイアウトは要らないため
   */
  const trial = (c: C) =>
    suggestWith(
      c,
      'codeTrial',
      { what: '制約', did: '判定できません' },
      async ({ settings, userId }, values) => {
        const { constraints, error } = readConstraints(values)
        if (error) return { error }
        const { language } = settings
        return grader.trial(
          {
            ...settings,
            title: values.title || settings.title,
            body: values.body,
            starter: filesFor(language, values),
            stdin: language === 'python' ? values.stdin : '',
            criteria: values.criteria,
            constraints,
            solution: filesFor(language, solutionOf(values)),
          },
          userId,
        )
      },
      (result) =>
        c.html(
          <RequestContext.Provider value={c}>
            <CodeTrialResult result={result} />
          </RequestContext.Provider>,
        ),
    )

  async function regrade(c: C) {
    const ctx = await studentSubmissions(c)
    if (!ctx || !gradingEnabled) return c.notFound()
    const { store, courseId, itemId, student, history } = ctx
    const fields = await readFields(c, 'regrade')
    const target = fields && history.find((h) => h.id === fields.submission)
    if (!target) return c.notFound()
    const url = submissionsUrl(courseId, itemId, student.id, target.id)
    if (target.status === 'pending') return redirectWith(c, url, 'すでに採点しています。', 'info')
    if (!grader.canGrade()) return redirectWith(c, url, 'AI の今月の上限に達しているため、採点できません。', 'error')
    store.setStatus(target.id, 'pending')
    grader.enqueue(target.id)
    return redirectWith(c, url, 'AI が採点しています。少し待ってから、ページを読み込み直してください。', 'info')
  }

  return {
    showState,
    save,
    run,
    submit,
    appeal,
    reset,
    showGrading,
    showPage,
    launch,
    list,
    showListRevision,
    regradeAll,
    show,
    review,
    override,
    closeAppeal,
    regrade,
    suggest,
    suggestConstraints,
    trial,
  }
}

/** /courses の下に組み込むルート。ログインの確認は、組み込む側で先に済ませておく */
export function codeRoutes(h: ReturnType<typeof createCodeHandlers>) {
  const app = new Hono<AppEnv>()
  app.get('/:id/items/:iid/code', h.showPage)
  app.post('/:id/items/:iid/code/launch', h.launch)
  app.get('/:id/items/:iid/code/state', h.showState)
  app.post('/:id/items/:iid/code/draft', h.save)
  app.post('/:id/items/:iid/code/run', h.run)
  app.post('/:id/items/:iid/code/submit', h.submit)
  app.post('/:id/items/:iid/code/appeal', h.appeal)
  app.post('/:id/items/:iid/code/reset', h.reset)
  app.get('/:id/items/:iid/code/grading', h.showGrading)
  app.get('/:id/items/:iid/code/submissions', h.list)
  app.get('/:id/items/:iid/code/submissions/revision', h.showListRevision)
  app.post('/:id/items/:iid/code/submissions/regrade', h.regradeAll)
  app.get('/:id/items/:iid/code/submissions/:uid', h.show)
  app.post('/:id/items/:iid/code/submissions/:uid/review', h.review)
  app.post('/:id/items/:iid/code/submissions/:uid/verdicts', h.override)
  app.post('/:id/items/:iid/code/submissions/:uid/appeal/close', h.closeAppeal)
  app.post('/:id/items/:iid/code/submissions/:uid/regrade', h.regrade)
  app.post('/:id/items/:iid/code/suggest', h.suggest)
  app.post('/:id/items/:iid/code/constraints', h.suggestConstraints)
  app.post('/:id/items/:iid/code/trial', h.trial)
  return app
}

// ---------------------------------------------------------------- STEP Learn for VSCode（vscode-extension/）が呼ぶ API

/** 拡張機能が送るコード。ファイル名（index.html など）ごとの中身 */
const CODE_UPLOAD = z.object({ files: z.record(z.string(), z.string()) })

/**
 * 拡張機能からコードを受け取る要求の本文の上限。ファイルの上限（MAX_CODE_LENGTH 文字）が JSON のエスケープで
 * 1 文字 6 バイトになっても、Web の 3 ファイルが収まる大きさ
 */
export const CODE_BODY_LIMIT = 512 * 1024

const CODE_API = '/api/vscode/code/'

const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''

/** 拡張機能がコードを送る要求か。ログインのセッションがなくても、鍵で本人と確かめられるので、本文の上限を上げてよい */
export const isCodeRequest = (c: Context) => c.req.method === 'POST' && c.req.path.startsWith(CODE_API) && !!verifyCode(bearer(c))

const EXPIRED = '期限が切れたか、このアイテムを開けなくなりました。STEP Learn の画面から、もう一度 VS Code で開いてください。'

/** 拡張機能に渡すファイルの一覧。ファイルの名前は Web エディターのタブと同じ */
const fileList = (settings: CodeSettings, files: CodeFiles) =>
  CODE_FILES[settings.language].map((f) => ({ path: f.name, content: files[f.key] ?? '' }))

/** 拡張機能が送ったファイルを、アイテムの言語のファイルとして読む。ほかの名前のファイルは使わない */
function readUpload(
  settings: CodeSettings,
  upload: z.output<typeof CODE_UPLOAD>,
): { ok: true; files: CodeFiles } | { ok: false; error: string } {
  const keys = new Map(CODE_FILES[settings.language].map((f) => [f.name, f.key]))
  const form = Object.fromEntries(Object.entries(upload.files).flatMap(([name, text]) => (keys.has(name) ? [[keys.get(name)!, text]] : [])))
  const result = validate('code', form)
  if (!result.ok) return { ok: false, error: firstError(result.errors) }
  return { ok: true, files: filesFor(settings.language, result.values) }
}

/** 拡張機能が呼ぶ API。ログインのセッションの代わりに、リンクの鍵と、それと引き換えた鍵で確かめる */
export function codeVscodeApi({ targetOf, grader, pageUrl }: Pick<CodeBackend, 'targetOf' | 'grader' | 'pageUrl'>) {
  // 上限を付けるのは、ログインしていなくても呼べ、鍵を総当たりで試されないようにするため
  const claimLimit = rateLimiter({ limit: 30, windowSec: 60 })
  // 拡張機能は保存から少し待ってまとめて送るので、普通に使っていて届く回数ではない
  const draftLimit = rateLimiter({ limit: 60, windowSec: 60 })
  const app = new Hono<AppEnv>()

  // 送るたびにアイテムを確かめるのは、鍵が半年使え、そのあいだにコースから外れたり、アイテムが非表示になったりするため
  async function targetFrom(c: C) {
    const claims = verifyCode(bearer(c))
    const target = claims && (await targetOf(claims.ref, claims.userId))
    if (!claims || !target || !target.store.findUser(claims.userId)) return null
    return { ...target, userId: claims.userId, limitKey: `${claims.ref} ${claims.userId}` }
  }

  /** 拡張機能がフォルダーを用意するのに使う、アイテムの名前と今のコード */
  const stateOf = (c: C, { settings, store, isStudent, courseId, itemId }: CodeTarget, userId: number) => ({
    title: settings.title,
    language: settings.language,
    files: fileList(settings, currentCode(settings, store, userId).files),
    canSubmit: isStudent,
    page: new URL(pageUrl(courseId, itemId), serverOrigin(c)).href,
  })

  app.post('/claim', async (c) => {
    const ip = clientIp(c)
    if (claimLimit.retryAfter(ip)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    claimLimit.hit(ip)
    const claims = claimCodeLaunch((await readJson(c, LAUNCH_CLAIM))?.token ?? '')
    const target = claims && (await targetOf(claims.ref, claims.userId))
    const user = claims && target?.store.findUser(claims.userId)
    if (!claims || !target || !user)
      return c.json({ error: 'リンクの期限が切れているか、すでに使われています。STEP Learn の画面からもう一度開いてください。' }, 401)
    return c.json({
      ...stateOf(c, target, claims.userId),
      ref: claims.ref,
      course: target.course,
      user: { id: user.id, name: user.name },
      token: signCode({ ref: claims.ref, userId: claims.userId }),
    })
  })

  // 拡張機能がフォルダーを開き直したときに、Web エディターで書き換えた分を取り込むのに使う
  app.get('/state', async (c) => {
    const target = await targetFrom(c)
    if (!target) return c.json({ error: EXPIRED }, 401)
    c.header('Cache-Control', 'no-store')
    return c.json(stateOf(c, target, target.userId))
  })

  app.post('/draft', async (c) => {
    const target = await targetFrom(c)
    if (!target) return c.json({ error: EXPIRED }, 401)
    if (draftLimit.retryAfter(target.limitKey)) return c.json({ error: 'しばらく待ってから、もう一度お試しください。' }, 429)
    draftLimit.hit(target.limitKey)
    const upload = await readJson(c, CODE_UPLOAD)
    const read = upload && readUpload(target.settings, upload)
    if (!read) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    if (!read.ok) return c.json({ error: read.error }, 422)
    const { settings, store, userId } = target
    // 入力（stdin）は VS Code にないので、Web エディターで書いたものを残す
    store.saveDraft(userId, read.files, currentCode(settings, store, userId).stdin)
    return c.json({ saved: true })
  })

  app.post('/submit', async (c) => {
    const target = await targetFrom(c)
    if (!target) return c.json({ error: EXPIRED }, 401)
    if (!target.isStudent) return c.json({ error: '提出できるのは、コースの学生だけです。' }, 403)
    const upload = await readJson(c, CODE_UPLOAD)
    const read = upload && readUpload(target.settings, upload)
    if (!read) return c.json({ error: '送られた内容が正しくありません。' }, 400)
    if (!read.ok) return c.json({ error: read.error }, 422)
    const { settings, store, userId } = target
    const accepted = acceptSubmission(grader, target, userId, read.files, currentCode(settings, store, userId).stdin)
    if (!accepted.ok) return c.json({ error: accepted.error }, 409)
    return c.json({ submitted: true, graded: accepted.graded })
  })

  app.get('/result', async (c) => {
    const target = await targetFrom(c)
    if (!target) return c.json({ error: EXPIRED }, 401)
    c.header('Cache-Control', 'no-store')
    const latest = target.store.latestSubmission(target.userId)
    if (!latest) return c.json({ submission: null })
    const status = grader.statusOf(latest)
    const graded = status === 'graded'
    return c.json({
      submission: {
        status,
        createdAt: latest.createdAt,
        verdicts: graded
          ? (latest.verdicts ?? []).map(({ label, verdict, reason, optional }) => ({ label, verdict, reason, optional: !!optional }))
          : [],
        feedback: graded ? latest.feedback : '',
        teacherComment: latest.teacherComment,
      },
    })
  })

  return app
}
