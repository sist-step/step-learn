---
name: db-change
description: "StepLearn の DB スキーマ変更とマイグレーション生成、SQL クエリの書き方。テーブルやカラム・インデックスを追加・変更する、src/lib/schema.ts や migrations/ に触れる、db.prepare / db.batch で SQL を書く、データの保存方法を設計するときに読み込む。「〇〇を保存できるようにして」「カラムを追加」「テーブルを作って」なども対象。"
---

# DB の変更とクエリ

SQLite（better-sqlite3、WAL）。スキーマ定義とマイグレーションは Drizzle、クエリは `lib/db.ts` の薄いラッパーで生 SQL を書く。Drizzle のクエリビルダー（`db.orm`）はクエリには使わない。

## スキーマを変える手順

1. `src/lib/schema.ts` を編集する
2. `src/lib/types.ts` に行の型を足す・直す（プロパティはカラム名そのままの snake_case）
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

- テーブル名・カラム名は snake_case、テーブル名は複数形
- 主キーは `integer('id').primaryKey()`。中間テーブルは複合主キー `primaryKey({ columns: [...] })`
- 日時は UNIX 秒の `integer`、既定値は `now`（`unixepoch()`）
- 真偽値は `integer` の 0 / 1
- 文字列は空文字を既定値にして `notNull()` にする。「未設定」を区別したいときだけ NULL 可
- 列挙は `text(..., { enum })` に加えて `check()` 制約も付ける
- 外部キーには `onDelete` を必ず指定する（親と一緒に消えるなら `cascade`、残すなら `set null`）
- 大文字小文字を区別しないメールアドレスなどは `textNocase`
- インデックス名は `<テーブル>_<カラム>`。WHERE や ORDER BY に使う列に張る

## クエリの書き方

```ts
import { db } from '../lib/db'

const row = await db.prepare('SELECT id, title FROM notes WHERE id = ? AND course_id = ?').bind(nid, id).first<Note>()
const { results } = await db.prepare('SELECT * FROM notes WHERE course_id = ? ORDER BY created_at DESC').bind(id).all<Note>()
const res = await db.prepare('DELETE FROM notes WHERE id = ? AND course_id = ?').bind(nid, id).run()
if (!res.meta.changes) return c.notFound()
```

- 値は必ず `?` で渡す。ユーザー入力を SQL に連結しない
- テーブル名など識別子を差し込むのは、呼び出し側の固定文字列リテラルに限る（`moveRow` 参照）
- 同じ値を何度も使うときは `?1` `?2` の番号付きにする
- 挿入した行の ID などは `RETURNING` で受け取る: `.first<{ id: number }>()`
- 重複を許す挿入は `INSERT OR IGNORE` と `res.meta.changes` で判定する
- 更新時は `updated_at = unixepoch()` も更新する
- 書き込みを複数まとめるときは `db.batch([...])`（1 トランザクションになる）。読み取りを複数するときもまとめてよい
- 一覧には上限を付ける（`LIMIT 200` など）
- 親子関係のあるリソースは、子の ID だけでなく親の ID でも絞る（URL の改ざん対策）
- 件数や進捗は相関サブクエリでまとめて取る（`participants.tsx` の `done` 参照）
- 同じ SQL 文字列はプリペアドステートメントがキャッシュされるので、SQL を動的に組み立てない

## データを消すとき

- 外部キーの `cascade` に任せ、子テーブルを個別に DELETE しない
- ストレージのファイルなど DB の外にあるものは、DB から消す前に `file_key` を SELECT しておき、消したあと `inBackground(deleteKeys(...))` で消す（`content.tsx` のセクション削除参照）
