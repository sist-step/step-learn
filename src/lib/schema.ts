import { sql } from 'drizzle-orm'
import { blob, check, customType, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { CODE_LANGUAGES, GRADING_STATUSES, type CodeConstraint, type CodeFiles, type ConstraintResult } from './code'
import type { RunResult } from './sandbox'

const now = sql`(unixepoch())`

// sqlite-core の text() には照合順序を指定する手段がないため、型名に含めて DDL に出す
const textNocase = customType<{ data: string }>({ dataType: () => 'text COLLATE NOCASE' })

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey(),
    email: textNocase('email').notNull().unique(),
    name: text('name').notNull(),
    // NOT NULL にしないのは、ユーザー名の導入前に登録したユーザーにはまだ値がないため
    username: textNocase('username'),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'teacher', 'student'] })
      .notNull()
      .default('student'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('users_username').on(t.username), check('users_role', sql`${t.role} IN ('admin', 'teacher', 'student')`)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('sessions_user').on(t.userId)],
)

export const emailVerifications = sqliteTable(
  'email_verifications',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: textNocase('email').notNull(),
    next: text('next').notNull().default(''),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('email_verifications_email').on(t.email)],
)

export const passwordResets = sqliteTable(
  'password_resets',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('password_resets_user').on(t.userId)],
)

export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey(),
  code: text('code').notNull().default(''),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  color: text('color').notNull().default('indigo'),
  heroImage: text('hero_image'),
  iconImage: text('icon_image'),
  enrollKey: text('enroll_key'),
  visible: integer('visible').notNull().default(1),
  completionEnabled: integer('completion_enabled').notNull().default(1),
  startAt: integer('start_at'),
  endAt: integer('end_at'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at')
    .notNull()
    .default(now)
    .$onUpdate(() => now),
})

export const enrollments = sqliteTable(
  'enrollments',
  {
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['teacher', 'student'] })
      .notNull()
      .default('student'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.userId] }),
    index('enrollments_user').on(t.userId),
    check('enrollments_role', sql`${t.role} IN ('teacher', 'student')`),
  ],
)

export const sections = sqliteTable(
  'sections',
  {
    id: integer('id').primaryKey(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    hidden: integer('hidden').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('sections_course').on(t.courseId, t.position)],
)

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['page', 'link', 'file', 'screen', 'code', 'bundle'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    url: text('url').notNull().default(''),
    linkTarget: text('link_target', { enum: ['new', 'same', 'embed'] })
      .notNull()
      .default('new'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    fileType: text('file_type'),
    hidden: integer('hidden').notNull().default(0),
    completion: text('completion', { enum: ['none', 'manual', 'view', 'play', 'clear'] })
      .notNull()
      .default('none'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => now),
  },
  (t) => [
    index('items_section').on(t.sectionId, t.position),
    index('items_course').on(t.courseId),
    check('items_type', sql`${t.type} IN ('page', 'link', 'file', 'screen', 'code', 'bundle')`),
    check('items_completion', sql`${t.completion} IN ('none', 'manual', 'view', 'play', 'clear')`),
    check('items_link_target', sql`${t.linkTarget} IN ('new', 'same', 'embed')`),
  ],
)

export const completions = sqliteTable(
  'completions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    completedAt: integer('completed_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId] }),
    index('completions_user_course').on(t.userId, t.courseId),
    index('completions_item').on(t.itemId),
  ],
)

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

/** AI エージェントのチャット。閉じたら消し、閉じずに置かれたものも最後の発言から AI_CHAT_TTL で消す（lib/ai-chat.ts） */
export const aiChats = sqliteTable(
  'ai_chats',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CHECK を付けないのは、モデルを入れ替えたときに、それまでに始めたチャットの行が制約に引っかかるため
    model: text('model').notNull(),
    /** AES-256-GCM で暗号化した会話（lib/ai-chat.ts の sealChat） */
    content: blob('content', { mode: 'buffer' }).notNull(),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => now),
  },
  (t) => [index('ai_chats_user').on(t.userId), index('ai_chats_updated').on(t.updatedAt)],
)

/** 管理画面で変える、アプリ全体の設定（端末ごとの設定は lib/settings.ts） */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** コード採点のアイテム（items.type が code）の設定 */
export const codeItems = sqliteTable(
  'code_items',
  {
    itemId: integer('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    language: text('language', { enum: CODE_LANGUAGES }).notNull(),
    /** 学生が最初に開いたときに入っているコード */
    starter: text('starter', { mode: 'json' }).$type<CodeFiles>().notNull(),
    /** Python の標準入力の例。学生の入力欄に最初から入れておき、採点のときの実行にも使う */
    stdin: text('stdin').notNull().default(''),
    /** AI に渡す補足。制約にしにくい観点（読みやすさなど）を書く。学生には見せない */
    criteria: text('criteria').notNull().default(''),
    /** 判定の観点（制約）。AI は制約ごとに 3 段階で判定し、すべてできていればクリア。空のアイテム（古いもの）は講評だけを返す */
    constraints: text('constraints', { mode: 'json' }).$type<CodeConstraint[]>().notNull().default([]),
    /** 学生が提出できる期間（長さは MAX_SUBMIT_PERIOD まで）。決まっていない（NULL）あいだは提出を受け付けない */
    opensAt: integer('opens_at'),
    closesAt: integer('closes_at'),
  },
  (t) => [check('code_items_language', sql`${t.language} IN ('web', 'python')`)],
)

/** ファイル自動配布のアイテム（items.type が bundle）で配るファイル。path はアイテムの中での場所（/ 区切り） */
export const bundleFiles = sqliteTable(
  'bundle_files',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    // NOCASE にするのは、Windows と macOS では大文字と小文字だけが違う名前を同じファイルとして扱うため
    path: textNocase('path').notNull(),
    fileKey: text('file_key').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('bundle_files_item_path').on(t.itemId, t.path)],
)

/** ファイル自動配布のアイテムの設定。行がなければ、すべて既定のまま */
export const bundleItems = sqliteTable('bundle_items', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  /** データを同期する（学生が VS Code で保存した内容を、変更履歴として残す） */
  sync: integer('sync').notNull().default(0),
})

/** データを同期するアイテムで、学生が VS Code で保存したファイルの記録。保存のたびに 1 行ずつ足し、前の記録は残す */
export const bundleSyncVersions = sqliteTable(
  'bundle_sync_versions',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // NOCASE にしないのは、学生の PC（Linux など）では大文字と小文字だけが違う名前が別のファイルになるため
    path: text('path').notNull(),
    /** ファイルを消した記録なら 1。中身はない */
    deleted: integer('deleted').notNull().default(0),
    sha256: text('sha256').notNull().default(''),
    size: integer('size').notNull().default(0),
    /** 1 つ前の記録（なければ配ったファイル）と比べて、増えた行と減った行の数 */
    added: integer('added').notNull().default(0),
    removed: integer('removed').notNull().default(0),
    // ストレージに置かないのは、数 KB のファイルが保存のたびに増え、アイテムや利用者を消すときに cascade で一緒に消せるようにするため
    /** gzip で縮めた中身 */
    content: blob('content', { mode: 'buffer' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('bundle_sync_versions_item_user').on(t.itemId, t.userId, t.id), index('bundle_sync_versions_user').on(t.userId)],
)

/** 書きかけのコード。利用者ごとに 1 つで、編集のたびに上書きする */
export const codeDrafts = sqliteTable(
  'code_drafts',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
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
  (t) => [primaryKey({ columns: [t.itemId, t.userId] }), index('code_drafts_user').on(t.userId)],
)

/** 提出したコード。出し直しても前の提出は残す */
export const codeSubmissions = sqliteTable(
  'code_submissions',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    files: text('files', { mode: 'json' }).$type<CodeFiles>().notNull(),
    /** AI の採点の状態。none は採点しない（AI が設定されていない）提出 */
    status: text('status', { enum: GRADING_STATUSES }).notNull().default('none'),
    /** AI の講評 */
    feedback: text('feedback').notNull().default(''),
    /** 採点のときに sandbox で実行した結果（Python） */
    output: text('output', { mode: 'json' }).$type<RunResult>(),
    /** AI の制約ごとの判定。制約のないアイテムの提出と、採点していない提出は null */
    verdicts: text('verdicts', { mode: 'json' }).$type<ConstraintResult[]>(),
    /** 教師から学生へのコメント */
    teacherComment: text('teacher_comment').notNull().default(''),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('code_submissions_item_user').on(t.itemId, t.userId, t.id),
    index('code_submissions_user').on(t.userId),
    check('code_submissions_status', sql`${t.status} IN ('none', 'pending', 'graded', 'failed')`),
  ],
)
