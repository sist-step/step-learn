import { sql } from 'drizzle-orm'
import { blob, check, customType, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { CODE_LANGUAGES, CODE_STAGES, GRADING_STATUSES, type CodeConstraint, type CodeFiles, type ConstraintResult } from './code'
import { COLLAB_KINDS, COLLAB_SCOPES } from './collab'
import { DEFAULT_PASS_PERCENT, QUIZ_LOOKS, type QuizAnswerRecord, type QuizQuestion } from './quiz'
import type { RunResult } from './sandbox'
import { LOG_KINDS } from './types'

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

/** 外部のアカウント（Microsoft）とユーザーの結び付き。subject は Microsoft のテナント ID とオブジェクト ID を : でつないだもの */
export const userIdentities = sqliteTable(
  'user_identities',
  {
    provider: text('provider', { enum: ['microsoft'] }).notNull(),
    // sub を使わないのは、アプリの登録ごとに値が変わり、登録をやり直すと全員の結び付きが切れるため
    subject: text('subject').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: textNocase('email').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    uniqueIndex('user_identities_user').on(t.userId, t.provider),
    check('user_identities_provider', sql`${t.provider} IN ('microsoft')`),
  ],
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
    /** アクセス制限。Moodle の availability と同じ形の JSON（lib/restriction.ts）。NULL は制限なし */
    availability: text('availability'),
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
    type: text('type', { enum: ['page', 'link', 'file', 'screen', 'code', 'bundle', 'agent', 'quiz', 'collab', 'presentation'] }).notNull(),
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
    /** アクセス制限。Moodle の availability と同じ形の JSON（lib/restriction.ts）。NULL は制限なし */
    availability: text('availability'),
    completion: text('completion', { enum: ['none', 'manual', 'view', 'play', 'clear', 'pass'] })
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
    check('items_type', sql`${t.type} IN ('page', 'link', 'file', 'screen', 'code', 'bundle', 'agent', 'quiz', 'collab', 'presentation')`),
    check('items_completion', sql`${t.completion} IN ('none', 'manual', 'view', 'play', 'clear', 'pass')`),
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

/**
 * AI が request_file で受け取ったファイル（lib/ai-uploads.ts）。アイテムに使うと、ファイルをコースの下へ移して行を消す。
 * 使われないまま AI_CHAT_TTL を過ぎたものは、ファイルごと消す
 */
export const aiUploads = sqliteTable(
  'ai_uploads',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    fileType: text('file_type').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('ai_uploads_user').on(t.userId), index('ai_uploads_created').on(t.createdAt)],
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
    /** 教師が用意した解答例。AI の判定の参考にし、編集画面で制約の判定を試すのにも使う。なければ空 */
    solution: text('solution', { mode: 'json' }).$type<CodeFiles>().notNull().default({}),
    /** 提出の期間が終わったあと、解答例を学生に見せるか */
    solutionPublic: integer('solution_public').notNull().default(0),
    /** 問題の確定と準備の段階（code.ts の CODE_STAGES）。NULL は確定の仕組みより前に作ったアイテム */
    stage: text('stage', { enum: CODE_STAGES }),
    /** 制約ごとの判定の基準（制約と同じ順）。確定したあとに AI が書き、判定のたびに AI に渡す */
    guides: text('guides', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (t) => [
    check('code_items_language', sql`${t.language} IN ('web', 'python')`),
    check('code_items_stage', sql`${t.stage} IS NULL OR ${t.stage} IN ('draft', 'preparing', 'ready', 'failed')`),
  ],
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

/** コーディングエージェントのアイテムの設定。管理者が API キーを入れるまで、誰も使えない */
export const agentItems = sqliteTable('agent_items', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  // 環境変数の CLAUDE_API_KEY を使わないのは、アイテムごとに請求先と上限を分け、管理者が入れたアイテムだけで使えるようにするため
  /** Anthropic の API キーを AES-256-GCM で暗号化したもの（lib/agent.ts）。NULL は未設定 */
  apiKey: blob('api_key', { mode: 'buffer' }),
  /** 入れたキーの末尾の数文字。キーそのものは画面に出さないので、どのキーかを見分けるのに使う */
  apiKeyHint: text('api_key_hint').notNull().default(''),
  /** OpenRouter の API キー（api_key と同じく暗号化したもの）。OpenRouter のモデルを選んだときに使う */
  openrouterApiKey: blob('openrouter_api_key', { mode: 'buffer' }),
  openrouterApiKeyHint: text('openrouter_api_key_hint').notNull().default(''),
  // CHECK を付けないのは、OpenRouter のモデルの ID も入り、決まった値の集合にならないため
  /** 教師が選んだモデル。Claude のモデルの ID（lib/agent.ts の AGENT_CLAUDE_MODELS）か、OpenRouter のモデルの ID */
  model: text('model').notNull().default('claude-haiku-5-5'),
  // 使うたびにモデル一覧から引かないのは、一覧から消えたり料金が変わったりしても、教師が選び直すまで同じ条件で使えるようにするため
  /** OpenRouter のモデルを選んだときの、モデル一覧の情報（JSON。lib/ai-models.ts の OpenRouterModelInfo） */
  openrouterModel: text('openrouter_model', { mode: 'json' }),
  /** 使える期間（UNIX 秒） */
  opensAt: integer('opens_at'),
  closesAt: integer('closes_at'),
  /** 1 人あたりと、アイテム全体で使える額（USD） */
  userLimit: real('user_limit').notNull().default(0.5),
  totalLimit: real('total_limit').notNull().default(10),
  // items.body に入れないのは、body は学生に見せる説明で、AI だけに渡す指示と分けるため
  /** 教師が書く AI への指示。システムプロンプトに足す */
  instructions: text('instructions').notNull().default(''),
})

/** 拡張機能に渡した、コーディングエージェントを使うためのトークン。中身ではなく SHA-256 のハッシュを置く */
export const agentTokens = sqliteTable(
  'agent_tokens',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [uniqueIndex('agent_tokens_hash').on(t.tokenHash), index('agent_tokens_item_user').on(t.itemId, t.userId)],
)

/** コーディングエージェントが AI を呼ぶたびの使用量。アイテムの API キーに請求される分で、ai_usage（CLAUDE_API_KEY の分）とは分ける */
export const agentUsage = sqliteTable(
  'agent_usage',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    // cascade にしないのは、利用者を消すとアイテムの使用額が減り、全体の上限に余裕ができてしまうため
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    cost: real('cost').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('agent_usage_item_user').on(t.itemId, t.userId)],
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
    /** 学生が判定の確認を教師に頼んだ時刻と、教師が確認した時刻。頼んでいなければ NULL */
    appealedAt: integer('appealed_at'),
    appealClosedAt: integer('appeal_closed_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('code_submissions_item_user').on(t.itemId, t.userId, t.id),
    index('code_submissions_user').on(t.userId),
    check('code_submissions_status', sql`${t.status} IN ('none', 'pending', 'graded', 'failed')`),
  ],
)

/** 小テストのアイテム（items.type が quiz）の設定。行がなければ、問題がまだない */
export const quizItems = sqliteTable(
  'quiz_items',
  {
    itemId: integer('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    // 問題ごとの行にしないのは、問題をまとめて読んでまとめて書き換えるだけで、問題をまたいだ検索をしないため
    questions: text('questions', { mode: 'json' }).$type<QuizQuestion[]>().notNull().default([]),
    /** 合格にする正解の割合（%） */
    passPercent: integer('pass_percent').notNull().default(DEFAULT_PASS_PERCENT),
    /** 採点のあとに、不正解だった問題の正解と解説も見せる */
    showAnswers: integer('show_answers').notNull().default(1),
    look: text('look', { enum: QUIZ_LOOKS }).notNull().default('plain'),
  },
  (t) => [check('quiz_items_look', sql`${t.look} IN ('plain', 'game')`)],
)

/** 小テストの受験。受け直しても前の受験は残す */
export const quizAttempts = sqliteTable(
  'quiz_attempts',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 問題ごとの答えと正誤。受けたときの問題の順 */
    answers: text('answers', { mode: 'json' }).$type<QuizAnswerRecord[]>().notNull(),
    correct: integer('correct').notNull(),
    total: integer('total').notNull(),
    // 見るたびに求めないのは、あとから合格の割合を変えても、受けたときの合否を変えないため
    passed: integer('passed').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('quiz_attempts_item_user').on(t.itemId, t.userId, t.id), index('quiz_attempts_user').on(t.userId)],
)

/** 共同編集のアイテム（items.type が collab）の設定。種類と持ち主の分け方は、追加したあとは変えない */
export const collabItems = sqliteTable(
  'collab_items',
  {
    itemId: integer('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: COLLAB_KINDS }).notNull(),
    scope: text('scope', { enum: COLLAB_SCOPES }).notNull(),
  },
  (t) => [
    check('collab_items_kind', sql`${t.kind} IN ('doc', 'sheet', 'slides', 'board')`),
    check('collab_items_scope', sql`${t.scope} IN ('course', 'student')`),
  ],
)

/** 共同編集のファイル。中身は Yjs の状態をまとめて 1 つにしたもの。画像はストレージに置く */
export const collabDocs = sqliteTable(
  'collab_docs',
  {
    id: integer('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** 持ち主（lib/collab.ts の CollabOwner）。course・template・user:<id> */
    owner: text('owner').notNull(),
    /** 持ち主の学生。学生のアカウントを消したときに、その学生のファイルも消すために持つ */
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    state: blob('state', { mode: 'buffer' }).notNull(),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: integer('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => now),
  },
  (t) => [uniqueIndex('collab_docs_item_owner').on(t.itemId, t.owner), index('collab_docs_user').on(t.userId)],
)

/**
 * 発表ファイルのアイテムの、PDF とスライドの対応と公開の状態（lib/presentation.ts）。行がなければ、PDF がまだない。
 * PDF そのものは items の file_key に置く
 */
export const presentationItems = sqliteTable('presentation_items', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  /** PDF を上げ直すたびに増やす。学生のビューアーが読み込み直すのに使う */
  version: integer('version').notNull().default(0),
  /** PDF の各ページの、PowerPoint のスライドの ID */
  slideIds: text('slide_ids', { mode: 'json' }).$type<number[]>().notNull().default([]),
  /** クリックで進むアニメーションがあるページ（1 始まり） */
  animatedPages: text('animated_pages', { mode: 'json' }).$type<number[]>().notNull().default([]),
  /** 図形を押すと動くアニメーションがあるページ（1 始まり） */
  triggerPages: text('trigger_pages', { mode: 'json' }).$type<number[]>().notNull().default([]),
  sourceName: text('source_name').notNull().default(''),
  /** これまでに公開したスライドの ID。PDF を上げ直したときに、公開の範囲を引き継ぐのに使う */
  releasedSlideIds: text('released_slide_ids', { mode: 'json' }).$type<number[]>().notNull().default([]),
  // released_slide_ids から求め直さないのは、学生の画面が数秒おきに読むため
  releasedPage: integer('released_page').notNull().default(0),
  /** 先生が映しているページ。スライドショーをしていないときは NULL */
  currentPage: integer('current_page'),
  allReleased: integer('all_released').notNull().default(0),
  /** 最後に拡張機能から届いた時刻 */
  syncedAt: integer('synced_at'),
  exportedAt: integer('exported_at'),
})

/** 操作ログ。種類ごとの保存期間を過ぎたものは消す（lib/operation-log.ts） */
export const operationLogs = sqliteTable(
  'operation_logs',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: LOG_KINDS }).notNull(),
    action: text('action').notNull(),
    path: text('path').notNull(),
    // 外部キーにしないのは、コースを削除すると、削除した記録からどのコースだったかがわからなくなるため
    courseId: integer('course_id'),
    /** 操作の対象（アイテム・セクション・ユーザー・コース）の、操作した時点の名前 */
    target: text('target'),
    ip: text('ip').notNull().default(''),
    /** ログイン・ログアウトのときだけ残す */
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('operation_logs_created').on(t.createdAt),
    index('operation_logs_user').on(t.userId),
    index('operation_logs_kind').on(t.kind),
    check('operation_logs_kind', sql`${t.kind} IN ('view', 'change', 'important')`),
  ],
)

/** MCP の OAuth で登録したクライアント（Claude・ChatGPT・手元のエディターなど）。id がクライアント ID */
export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  /** 登録のときにクライアントが名乗った名前。同意の画面と接続中のアプリの一覧に出す */
  name: text('name').notNull().default(''),
  redirectUris: text('redirect_uris', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: integer('created_at').notNull().default(now),
})

/** 同意した直後に発行し、トークンと 1 回だけ交換できる認可コード。id はコードの SHA-256 */
export const oauthCodes = sqliteTable(
  'oauth_codes',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    /** PKCE の S256 のチャレンジ */
    codeChallenge: text('code_challenge').notNull(),
    resource: text('resource').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('oauth_codes_expires').on(t.expiresAt)],
)

/**
 * 利用者がクライアントに許可した接続。アクセストークンとリフレッシュトークンは SHA-256 だけを持ち、使うたびに入れ替える。
 * 消すと接続が解除される
 */
export const oauthGrants = sqliteTable(
  'oauth_grants',
  {
    id: integer('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    accessHash: text('access_hash').notNull(),
    accessExpiresAt: integer('access_expires_at').notNull(),
    refreshHash: text('refresh_hash').notNull(),
    /** 1 つ前のリフレッシュトークン。これがもう一度使われたら、漏れたとみなして接続ごと消す */
    previousRefreshHash: text('previous_refresh_hash'),
    refreshExpiresAt: integer('refresh_expires_at').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    lastUsedAt: integer('last_used_at').notNull().default(now),
  },
  (t) => [
    index('oauth_grants_user').on(t.userId),
    index('oauth_grants_client').on(t.clientId),
    uniqueIndex('oauth_grants_access_hash').on(t.accessHash),
    uniqueIndex('oauth_grants_refresh_hash').on(t.refreshHash),
    index('oauth_grants_previous_refresh_hash').on(t.previousRefreshHash),
  ],
)
