import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CodeFiles, GradingStatus } from '../lib/code'
import type { RunResult } from '../lib/sandbox'

const now = sql`(unixepoch())`

/** Moodle のユーザーの写し。id は Moodle のユーザー ID */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  username: text('username').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  siteAdmin: integer('site_admin').notNull().default(0),
  /** STEP Learn 用サービスのトークン（AES-GCM で暗号化） */
  token: text('token').notNull(),
  /** トークンの期限（UNIX 秒、0 は無期限） */
  tokenExpiresAt: integer('token_expires_at').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at')
    .notNull()
    .default(now)
    .$onUpdate(() => now),
})

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ログインした Moodle のセッション ID の SHA-256。Moodle でログアウトされたら、これで探して消す */
    moodleSid: text('moodle_sid').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('sessions_user').on(t.userId), index('sessions_moodle_sid').on(t.moodleSid)],
)

/** Moodle モードだけにある種類のアイテムの中身。Moodle には、この位置に /m/<key> へ移る URL の活動を置く。完全移行では引き継がない */
export const extraItems = sqliteTable(
  'extra_items',
  {
    key: text('key').primaryKey(),
    /** 作ったコース。Moodle でコースをコピーすると、同じ key を指す活動がほかのコースにもできる */
    courseId: integer('course_id').notNull(),
    /** 作った活動（URL の活動の cmid） */
    cmid: integer('cmid').notNull(),
    // CHECK を付けないのは、種類を足すたびに SQLite ではテーブルの作り直しになり、種類の一覧は extra.tsx で決まるため
    type: text('type').notNull(),
    // 種類ごとに列を足さないのは、完全移行で捨てる一時的なデータで、種類を足すたびにマイグレーションを作らずに済ませるため
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => now),
  },
  (t) => [index('extra_items_course').on(t.courseId)],
)

/** コードのアイテム（extra-kinds.tsx の code）の、書きかけのコード。利用者ごとに 1 つで、編集のたびに上書きする。完全移行では引き継がない */
export const codeDrafts = sqliteTable(
  'code_drafts',
  {
    key: text('key')
      .notNull()
      .references(() => extraItems.key, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    files: text('files', { mode: 'json' }).$type<CodeFiles>().notNull(),
    stdin: text('stdin').notNull().default(''),
    updatedAt: integer('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => now),
  },
  (t) => [primaryKey({ columns: [t.key, t.userId] })],
)

/** コードのアイテムに提出したコードと採点。出し直しても前の提出は残す。完全移行では引き継がない */
export const codeSubmissions = sqliteTable(
  'code_submissions',
  {
    id: integer('id').primaryKey(),
    key: text('key')
      .notNull()
      .references(() => extraItems.key, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    files: text('files', { mode: 'json' }).$type<CodeFiles>().notNull(),
    // CHECK を付けないのは、完全移行で捨てる一時的なデータで、状態を足すたびにテーブルを作り直すマイグレーションを作らずに済ませるため
    status: text('status').$type<GradingStatus>().notNull().default('none'),
    score: integer('score'),
    feedback: text('feedback').notNull().default(''),
    output: text('output', { mode: 'json' }).$type<RunResult>(),
    teacherScore: integer('teacher_score'),
    teacherComment: text('teacher_comment').notNull().default(''),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('code_submissions_key_user').on(t.key, t.userId, t.id)],
)

/**
 * AI の呼び出しごとの使用量。月の上限と週の枠の計算（lib/ai-ledger.ts）に使う。完全移行では引き継がない。
 * 通常モードの ai_usage（lib/schema.ts）と同じ形にしておく（ai-ledger.ts が両方のテーブルを同じ型で受け取る）
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: integer('id').primaryKey(),
    // cascade にしないのは、ユーザーを消すとその月の消費が減り、月の上限に余裕ができてしまうため
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    // 整数（セント）にしないのは、1 回の呼び出しが 1 セントに満たず、丸めると 0 になるため
    cost: real('cost').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('ai_usage_created').on(t.createdAt), index('ai_usage_user').on(t.userId, t.createdAt)],
)

/** アプリ全体の設定（AI の月の上限など）。通常モードの app_settings と同じ形。完全移行では引き継がない */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
