---
name: db-change
description: "STEP Learn の DB スキーマ変更とマイグレーション生成、Drizzle でのクエリの書き方。テーブルやカラム・インデックスを追加・変更する、src/lib/schema.ts や migrations/ に触れる、db.select / db.insert などでデータを読み書きする、データの保存方法を設計するときに読み込む。「〇〇を保存できるようにして」「カラムを追加」「テーブルを作って」なども対象。"
---

# DB の変更とクエリ

SQLite（better-sqlite3、WAL）。スキーマ定義・マイグレーション・クエリのすべてを Drizzle で書く。`lib/db.ts` の `db` が Drizzle のインスタンスで、生 SQL の文字列でクエリを書かない。

## スキーマを変える手順

1. `src/lib/schema.ts` を編集する
2. 行の型が要るなら `src/lib/types.ts` に `typeof notes.$inferSelect` で足す（プロパティは schema.ts の camelCase になる）
3. `npm run db:generate` でマイグレーションを生成する
4. 生成された `migrations/XXXX_*.sql` を読み、意図どおりの DDL か確認する（テーブルの作り直しでデータが消えないか特に注意）
5. `npm run db:check` で整合性を確認する
6. `npm run dev` を起動し直し、起動時に自動で適用されることを確認する

### 禁止

- `migrations/` の既存ファイル（SQL・`meta/` のスナップショットと journal）を編集・削除しない
- マイグレーションの SQL を手で書かない。必ず `db:generate` で作る
- 他の PR が先にマイグレーションを追加した場合は、ベースブランチを取り込み、自分のマイグレーションを消してから作り直す

## schema.ts の書き方

```ts
export const notes = sqliteTable(
  'notes',
  {
    id: integer('id').primaryKey(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    kind: text('kind', { enum: ['memo', 'todo'] }).notNull().default('memo'),
    pinned: integer('pinned').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('notes_course').on(t.courseId), check('notes_kind', sql`${t.kind} IN ('memo', 'todo')`)],
)
```

- テーブル名・カラム名は snake_case、テーブル名は複数形。TS のプロパティ名は camelCase
- 主キーは `integer('id').primaryKey()`。中間テーブルは複合主キー `primaryKey({ columns: [...] })`
- 日時は UNIX 秒の `integer`、既定値は `now`（`unixepoch()`）
- 真偽値は `integer` の 0 / 1
- 文字列は空文字を既定値にして `notNull()` にする。「未設定」を区別したいときだけ NULL 可
- 列挙は `text(..., { enum })` に加えて `check()` 制約も付ける
- 外部キーには `onDelete` を必ず指定する（親と一緒に消えるなら `cascade`、残すなら `set null`）
- 大文字小文字を区別しないメールアドレスなどは `textNocase`
- インデックス名は `<テーブル>_<カラム>`。WHERE や ORDER BY に使う列に張る
- 一意にしたい列は `uniqueIndex('<テーブル>_<カラム>')`。NULL 可の列でも、NULL どうしは重複扱いにならない
- `updated_at` には `.$onUpdate(() => now)` を付け、`db.update()` のたびに自動で更新させる

## クエリの書き方

```ts
import { and, desc, eq } from 'drizzle-orm'
import { contains, db } from '../lib/db'
import { notes } from '../lib/schema'

const note = db.select().from(notes).where(and(eq(notes.id, nid), eq(notes.courseId, id))).get()
const list = db.select({ id: notes.id, title: notes.title }).from(notes).where(eq(notes.courseId, id)).orderBy(desc(notes.createdAt)).all()
const { id: noteId } = db.insert(notes).values({ courseId: id, title }).returning({ id: notes.id }).get()
const res = db.delete(notes).where(and(eq(notes.id, nid), eq(notes.courseId, id))).run()
if (!res.changes) return c.notFound()
```

- better-sqlite3 は同期 API なので、`.get()`（1 行。なければ `undefined`）/ `.all()` / `.run()` で同期的に実行する。`await` は付けない
- 件数は `await db.$count(table, 条件)`。SELECT の列に置けば相関サブクエリになる（`participants.tsx` の `done`、`lib/courses.ts` の `memberCount` 参照）
- 結果のプロパティは schema.ts の camelCase（`createdAt`、`fileKey`）。必要な列だけを `select({ ... })` で選ぶ
- 条件の組み立ては `and()` / `or()` に `undefined` を混ぜると無視されるので、検索語が空のときなどは `q ? or(...) : undefined` と書く
- 部分一致の検索は `like()` ではなく `contains(column, q)`（`lib/db.ts`）。入力の `%` `_` をエスケープする
- 重複を許す挿入は `.onConflictDoNothing()` と `res.changes` で判定する
- 複数の書き込みは `db.transaction((tx) => { ... })` にまとめる。コールバックは同期関数にし、中では `tx` を使う。パスワードのハッシュなど `await` が要る処理は先に済ませておく
- 末尾に追加する行の `position` は `nextPosition(table, 条件)`、並べ替えは `moveRow(table, 条件, id, dir)`（`lib/courses.ts`）
- Drizzle にない関数（`group_concat` など）だけ `sql` テンプレートで書く。値は `${}` で埋め込めば自動でプレースホルダになる。`sql.raw()` にユーザー入力を渡さない
- 同じテーブルを 2 回使うサブクエリは `alias(table, 't')` で別名を付ける（`teacherNames` 参照）
- 一覧には上限を付ける（`.limit(200)` など）
- 親子関係のあるリソースは、子の ID だけでなく親の ID でも絞る（URL の改ざん対策）
- 生成される SQL を確かめたいときは、`.toSQL()` で文字列とパラメータを見る

## データを消すとき

- 外部キーの `cascade` に任せ、子テーブルを個別に DELETE しない
- ストレージのファイルなど DB の外にあるものは、DB から消す前に `file_key` を SELECT しておき、消したあと `inBackground(deleteKeys(...))` で消す（`content.tsx` のセクション削除参照）
