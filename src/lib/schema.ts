import { sql } from 'drizzle-orm'
import { check, customType, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch())`

// sqlite-core の text() には照合順序を指定する手段がないため、型名に含めて DDL に出す
const textNocase = customType<{ data: string }>({ dataType: () => 'text COLLATE NOCASE' })

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey(),
    email: textNocase('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'teacher', 'student'] }).notNull().default('student'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [check('users_role', sql`${t.role} IN ('admin', 'teacher', 'student')`)],
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

export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey(),
  code: text('code').notNull().default(''),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  color: text('color').notNull().default('indigo'),
  enrollKey: text('enroll_key'),
  visible: integer('visible').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
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
    role: text('role', { enum: ['teacher', 'student'] }).notNull().default('student'),
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
    type: text('type', { enum: ['page', 'link', 'file'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    url: text('url').notNull().default(''),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    fileType: text('file_type'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('items_section').on(t.sectionId, t.position),
    index('items_course').on(t.courseId),
    check('items_type', sql`${t.type} IN ('page', 'link', 'file')`),
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
