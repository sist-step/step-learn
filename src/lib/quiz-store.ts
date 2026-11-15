// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない
import {
  bestScore,
  reviewQuiz,
  takeQuestions,
  type QuizAnswerRecord,
  type QuizLook,
  type QuizReviewItem,
  type QuizScore,
  type QuizSettings,
  type QuizTakeQuestion,
} from './quiz'

/** 受験の一覧に出す項目。答えは含めない */
export type QuizAttemptSummary = QuizScore & { id: number; userId: number; passed: number; createdAt: number }

export type QuizAttempt = QuizAttemptSummary & { answers: QuizAnswerRecord[] }

export type QuizStudent = { id: number; name: string; username: string | null; email: string }

/**
 * 小テストのアイテム 1 つの、受験の記録の置き場所。通常モードは step-learn.db（lib/quiz-items.ts）、
 * Moodle モードは moodle-mode.db（moodle-mode/quiz.ts）に置く
 */
export interface QuizStore {
  /** 学生 1 人の受験（新しい順） */
  listOf(userId: number): QuizAttemptSummary[]
  get(userId: number, id: number): QuizAttempt | undefined
  latest(userId: number): QuizAttempt | undefined
  /** すべての受験（新しい順） */
  listAll(): QuizAttemptSummary[]
  answersOf(ids: number[]): { answers: QuizAnswerRecord[] }[]
  /** 受験を残し、合格したかを返す */
  record(userId: number, graded: QuizScore & { records: QuizAnswerRecord[] }, passPercent: number): boolean
  /** 受験結果の一覧に並べる学生 */
  listStudents(): QuizStudent[]
  findUser(userId: number): QuizStudent | undefined
}

export type QuizAttemptView = { score: QuizScore; passed: boolean; createdAt: number; review: QuizReviewItem[] }

/** アイテムの画面に出す小テスト（components/quiz.tsx の QuizPanel） */
export type QuizView = {
  /** 受験と結果のルートの土台（/courses/:id/items/:iid/quiz） */
  base: string
  /** アイテムの画面 */
  itemUrl: string
  questions: QuizTakeQuestion[]
  passPercent: number
  look: QuizLook
  /** 見ている学生の受験。学生でなければ null */
  mine: {
    count: number
    best: QuizScore | null
    /** いちばん新しい受験。まだ受けていなければ null */
    latest: QuizAttemptView | null
    /** 受けたあとでも、結果ではなく解答の画面を出す */
    retake: boolean
  } | null
}

export function quizViewOf(
  store: QuizStore,
  { questions, passPercent, showAnswers, look }: QuizSettings,
  { itemUrl, userId, student, retake }: { itemUrl: string; userId: number; student: boolean; retake: boolean },
): QuizView {
  // 並べ替えの混ぜ方を学生とアイテムで変えるのは、隣の学生やほかのアイテムと同じ並びにしないため
  const view = { base: `${itemUrl}/quiz`, itemUrl, questions: takeQuestions(questions, `${userId}:${itemUrl}`), passPercent, look }
  if (!student) return { ...view, mine: null }
  const attempts = store.listOf(userId)
  const latest = store.latest(userId)
  return {
    ...view,
    mine: {
      count: attempts.length,
      best: bestScore(attempts),
      latest: latest
        ? {
            score: { correct: latest.correct, total: latest.total },
            passed: !!latest.passed,
            createdAt: latest.createdAt,
            review: reviewQuiz(questions, latest.answers, showAnswers ? 'all' : 'correct'),
          }
        : null,
      retake,
    },
  }
}
