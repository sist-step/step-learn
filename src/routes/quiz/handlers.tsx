// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュール（lib/db.ts・lib/courses.ts など）を import しない。
// モードごとの DB と権限の確認は QuizBackend として受け取る（通常モードは ./backend.ts、Moodle モードは moodle-mode/quiz.ts）
import { Hono, type Context } from 'hono'
import type { CourseAccess } from '../../lib/courses'
import { type Form, intParam, readFields, readForm, redirectWith } from '../../lib/http'
import {
  MAX_QUIZ_ATTEMPTS,
  answerField,
  bestScore,
  gradeQuiz,
  isCorrectAnswer,
  readQuizAnswer,
  reviewQuiz,
  scoreOf,
  type QuizSettings,
} from '../../lib/quiz'
import type { QuizAttemptSummary, QuizStore } from '../../lib/quiz-store'
import { rateLimiter } from '../../lib/rate-limit'
import type { AppEnv } from '../../lib/types'
import { ResultPage, ResultsPage, resultsUrl, type QuestionStat, type ResultRow } from './views'

type C = Context<AppEnv>

export type QuizContext = {
  access: CourseAccess
  /** URL の :iid。通常モードはアイテムの ID、Moodle モードは活動の cmid */
  item: { id: number; title: string }
  settings: QuizSettings
  store: QuizStore
}

export type QuizBackend = {
  /** URL のコースとアイテムを、ログインしている人が開けるなら、設定と置き場所を返す。開けなければ null */
  resolve: (c: C) => Promise<QuizContext | null>
}

// 短くしないのは、遊んでいる途中で休んでも、最初の答えを忘れないようにするため
const FIRST_ANSWER_TTL = 6 * 60 * 60 * 1000

export function createQuizHandlers({ resolve }: QuizBackend) {
  // ゲームの見た目で、学生が扉で問題ごとに最初に確かめた答え。ゴールの採点に使う。
  // ブラウザが送る「最初の答え」で採点しないのは、扉で正解を確かめてから、最初から正解していたと偽って送れるため。
  // DB に残さないのは、遊んでいる途中の 1 回分だけの状態で、再起動で忘れても、その回が最後の答えで採点されるだけのため
  const firstAnswers = new Map<string, { at: number; answers: Map<string, Form> }>()
  // 扉は 1 問に何回も押せるが、普通に遊んで届く回数ではない。総当たりで正解を探させないため
  const checkLimit = rateLimiter({ limit: 30, windowSec: 60 })

  const playKey = (ctx: QuizContext, userId: number) => `${ctx.access.course.id}:${ctx.item.id}:${userId}`

  function firstAnswersOf(key: string) {
    const now = Date.now()
    for (const [k, v] of firstAnswers) if (now - v.at > FIRST_ANSWER_TTL) firstAnswers.delete(k)
    return firstAnswers.get(key)?.answers ?? new Map<string, Form>()
  }

  async function open(c: C) {
    const ctx = await resolve(c)
    return ctx && { ...ctx, page: `/courses/${ctx.access.course.id}/items/${ctx.item.id}` }
  }

  async function manage(c: C) {
    const ctx = await open(c)
    return ctx && ctx.access.canManage ? ctx : null
  }

  // ---------------------------------------------------------------- 学生: 受ける

  async function submit(c: C) {
    const ctx = await open(c)
    if (!ctx || ctx.access.role !== 'student') return c.notFound()
    const { settings, store, page } = ctx
    const userId = c.var.user!.id
    if (settings.questions.length === 0) return redirectWith(c, page, '問題がまだありません。', 'error')
    const form = await readForm(c)
    // 本文を読む前に数えないのは、読む（await）あいだに同時に送られた分が、どれも上限の前として通ってしまうため
    if (store.listOf(userId).length >= MAX_QUIZ_ATTEMPTS)
      return redirectWith(c, page, `受けられる回数の上限（${MAX_QUIZ_ATTEMPTS} 回）に達しました。`, 'error')
    const key = playKey(ctx, userId)
    const firsts = settings.look === 'game' ? firstAnswersOf(key) : new Map<string, Form>()
    const graded = gradeQuiz(settings.questions, (field, q) => (firsts.get(q.id) ?? form)[field])
    const passed = store.record(userId, graded, settings.passPercent)
    firstAnswers.delete(key)
    const waiting = !passed && graded.pending > 0 ? `${graded.pending} 問は先生の採点を待っています。` : ''
    return redirectWith(
      c,
      page,
      `${graded.total} 問中 ${graded.correct} 問正解でした。${passed ? '合格です。' : waiting}`,
      passed ? 'success' : 'info',
    )
  }

  /**
   * ゲームの見た目で、扉のレバーを引いたときに、問題 1 つの答えを確かめる。正解なら解説も返す（まちがえたあとの正解で、client.ts が見せる）。
   * 教師も使えるのは、プレビューで扉を開けて先の部屋を確かめられるようにするため。受験は残さない（採点はゴールの submit）
   */
  async function check(c: C) {
    const ctx = await open(c)
    if (!ctx || ctx.settings.look !== 'game') return c.notFound()
    const userId = c.var.user!.id
    const key = playKey(ctx, userId)
    if (checkLimit.retryAfter(key)) return c.json({ error: 'しばらく待ってから、もう一度ためしてね。' }, 429)
    checkLimit.hit(key)
    const form = await readForm(c)
    const q = ctx.settings.questions.find((other) => other.id === form.q)
    if (!q) return c.notFound()
    const field = answerField(q)
    const answer = readQuizAnswer(q, form[field])
    // 採点待ちの記述も扉を開けるのは、教師が採点するまで先へ進めなくなるため（点数はゴールで残し、あとで教師が採点する）
    const correct = isCorrectAnswer(q, answer) ?? answer !== null
    if (ctx.access.role === 'student') {
      const answers = firstAnswersOf(key)
      if (!answers.has(q.id)) answers.set(q.id, { [field]: form[field] ?? '' })
      firstAnswers.set(key, { at: Date.now(), answers })
    }
    return c.json(correct ? { correct, explanation: q.explanation } : { correct })
  }

  // ---------------------------------------------------------------- 教師: 受験結果を見る

  async function list(c: C) {
    const ctx = await manage(c)
    if (!ctx) return c.notFound()
    const { access, item, settings, store, page } = ctx
    const byStudent = new Map<number, QuizAttemptSummary[]>()
    for (const attempt of store.listAll()) byStudent.set(attempt.userId, [...(byStudent.get(attempt.userId) ?? []), attempt])
    const rows: ResultRow[] = store.listStudents().map((student) => {
      const attempts = byStudent.get(student.id) ?? []
      return {
        student,
        count: attempts.length,
        latest: attempts[0] ?? null,
        best: bestScore(attempts),
        pending: attempts.reduce((sum, a) => sum + a.pending, 0),
      }
    })
    // 最高点の受験ではなくいちばん新しい受験で数えるのは、受け直して答えを覚えた分を除き、今つまずいている問題を見るため
    const latestAnswers = store.answersOf(rows.flatMap((r) => (r.latest ? [r.latest.id] : []))).flatMap((a) => a.answers)
    const stats: QuestionStat[] = settings.questions.map((q) => {
      // 採点待ちを数えないのは、まだ正誤の決まらない答えで、正答率を下げないため
      const records = latestAnswers.filter((r) => r.id === q.id && r.correct !== null)
      return { kind: q.kind, prompt: q.prompt, answered: records.length, correct: records.filter((r) => r.correct).length }
    })
    return c.render(<ResultsPage access={access} item={item} pageUrl={page} rows={rows} stats={stats} />, {
      title: `受験結果 - ${item.title}`,
    })
  }

  async function show(c: C) {
    const ctx = await manage(c)
    const studentId = intParam(c, 'uid')
    if (!ctx || !studentId) return c.notFound()
    const { access, item, settings, store, page } = ctx
    const student = store.findUser(studentId)
    const history = store.listOf(studentId)
    if (!student || history.length === 0) return c.notFound()
    // 学生の ID でも絞るのは、ほかの学生の受験の ID を付けた URL で開けないようにするため
    const attempt = store.get(studentId, Number(c.req.query('attempt')) || history[0].id)
    if (!attempt) return c.notFound()
    return c.render(
      <ResultPage
        access={access}
        item={item}
        pageUrl={page}
        student={student}
        attempt={attempt}
        history={history}
        review={reviewQuiz(settings.questions, attempt.answers, 'all')}
      />,
      { title: `${student.name} さんの受験 - ${item.title}` },
    )
  }

  /** 教師が記述の問題を正解・不正解にして、受験の点数と合否を数え直す */
  async function grade(c: C) {
    const ctx = await manage(c)
    const studentId = intParam(c, 'uid')
    const fields = await readFields(c, 'quizGrade')
    if (!ctx || !studentId || !fields) return c.notFound()
    const { access, item, settings, store } = ctx
    const attempt = store.get(studentId, fields.attempt)
    const q = settings.questions.find((other) => other.id === fields.q)
    // 記述だけに限るのは、ほかの形式は正解との照合で決まり、教師が変えると、受け直した学生の点数と食い違うため
    if (!attempt || q?.kind !== 'essay' || !attempt.answers.some((r) => r.id === q.id)) return c.notFound()
    const records = attempt.answers.map((r) => (r.id === q.id ? { ...r, correct: fields.verdict === 'right' } : r))
    store.regrade(studentId, attempt.id, { ...scoreOf(records), records }, settings.passPercent)
    return redirectWith(
      c,
      resultsUrl(access.course.id, item.id, studentId, attempt.id),
      fields.verdict === 'right' ? '正解にしました。' : '不正解にしました。',
    )
  }

  return { submit, check, list, show, grade }
}

/** /courses の下に組み込むルート。ログインの確認は、組み込む側で先に済ませておく */
export function quizRoutes(h: ReturnType<typeof createQuizHandlers>) {
  const app = new Hono<AppEnv>()
  app.post('/:id/items/:iid/quiz/submit', h.submit)
  app.post('/:id/items/:iid/quiz/check', h.check)
  app.get('/:id/items/:iid/quiz/results', h.list)
  app.get('/:id/items/:iid/quiz/results/:uid', h.show)
  app.post('/:id/items/:iid/quiz/results/:uid/grade', h.grade)
  return app
}
