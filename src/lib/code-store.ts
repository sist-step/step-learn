// 通常モードと Moodle モードの両方が読み込むので、DB を開くモジュールを import しない
import type { CodeFiles, CodeLanguage, GradingStatus } from './code'
import type { RunResult } from './sandbox'

export type Student = { id: number; name: string; username: string | null; email: string }

/** 提出の一覧に出す項目。中身のコードは含めない */
export type SubmissionSummary = {
  id: number
  userId: number
  status: GradingStatus
  score: number | null
  teacherScore: number | null
  createdAt: number
}

export type Submission = SubmissionSummary & {
  files: CodeFiles
  feedback: string
  output: RunResult | null
  teacherComment: string
}

/** 提出の一覧の 1 行。count は提出の回数、latest はいちばん新しい提出 */
export type StudentRow = { student: Student; count: number; latest: SubmissionSummary | null }

/** コードのアイテムの設定 */
export type CodeSettings = {
  title: string
  /** 問題文（Markdown） */
  body: string
  language: CodeLanguage
  starter: CodeFiles
  stdin: string
  criteria: string
  maxScore: number
}

/** AI が付けた採点の結果。採点できなかったときは status が failed で、点数と講評はない */
export type GradingResult = { status: 'graded'; score: number; feedback: string } | { status: 'failed' }

/**
 * コードのアイテム 1 つの、書きかけのコードと提出の置き場所。通常モードは step-learn.db（lib/code-items.ts）、
 * Moodle モードは moodle-mode.db（moodle-mode/code.tsx）に置く
 */
export interface CodeStore {
  getDraft(userId: number): { files: CodeFiles; stdin: string } | undefined
  saveDraft(userId: number, files: CodeFiles, stdin: string): void
  /** 提出を残し、書きかけのコードも同じ内容にそろえる。提出の ID を返す */
  submit(userId: number, files: CodeFiles, stdin: string, status: GradingStatus): number
  getSubmission(id: number): Submission | undefined
  latestSubmission(userId: number): Submission | undefined
  /** すべての提出（新しい順） */
  listSubmissions(): SubmissionSummary[]
  listUserSubmissions(userId: number): SubmissionSummary[]
  review(id: number, teacherScore: number | null, teacherComment: string): void
  setStatus(id: number, status: GradingStatus): void
  /** 提出の一覧に並べる学生 */
  listStudents(): Student[]
  findUser(userId: number): Student | undefined
}
