import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
