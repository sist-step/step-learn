---
name: add-page
description: "StepLearn に画面・ルート・フォーム処理を追加または変更する手順と型。src/routes/ にハンドラを足す、新しいページを作る、フォームの送信先を作る、権限チェックやバリデーションを書く、一覧・詳細・編集・削除の画面を作るときに読み込む。「〇〇画面を作って」「〇〇できるようにして」「ページを追加」「フォームを追加」などの依頼が対象。"
---

# 画面・ルートの追加

StepLearn は MPA。サーバーで HTML を返し、操作はすべて `<form method="post">` の送信と 303 リダイレクト（PRG）で完結させる。`client.ts` がこの送信を fetch に置き換えて再読み込みなしで遷移させる（JavaScript は必須）。

## 置き場所

- 既存の機能領域に入るものは、該当する `src/routes/*.tsx` に足す
  - `courses.tsx`（コース本体・設定）、`content.tsx`（セクション・アイテム）、`participants.tsx`（参加者）、`account.tsx`、`admin.tsx`、`auth.tsx`
- 新しい領域なら `src/routes/<name>.tsx` を作り、`src/index.tsx` で `app.route('/<prefix>', <name>)` する
- ナビゲーションに出す画面は `src/components/layout.tsx` の `links` に足す（ヘッダーのピルと左のアイコンレールの両方に出る。権限で出し分ける）
- 複数の画面で使う部品は `src/components/`、コース関連の部品は `components/course.tsx`

## ファイルの骨組み

```tsx
import { Hono } from 'hono'
import { AppShell } from '../components/layout'
import { Field, PageHeader } from '../components/ui'
import { requireAuth } from '../lib/auth'
import { getCourseAccess } from '../lib/courses'
import { field, intParam, readForm, redirectWith } from '../lib/http'
import type { AppEnv } from '../lib/types'
import { db } from '../lib/db'

const app = new Hono<AppEnv>()
app.use(requireAuth)

type Errors = Partial<Record<'title', string>>

const NotePage = ({ values, errors = {} }: { values: { title?: string }; errors?: Errors }) => (
  <AppShell>
    <PageHeader title="ノート" description="..." />
    <form method="post" class="stack" data-loading-form>
      <Field label="タイトル" name="title" value={values.title} error={errors.title} required maxlength={120} />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">
          保存
        </button>
      </div>
    </form>
  </AppShell>
)

export default app
```

## ハンドラの型

### 権限チェック（全ハンドラの先頭）

```ts
const id = intParam(c, 'id')
const access = id && (await getCourseAccess(c, id))
if (!access || !access.canManage) return c.notFound()
```

- ID は必ず `intParam` で取る（正の安全な整数以外は `null`）
- コースに関わる処理は `getCourseAccess` を通す。参加していないコースは（管理者以外）`null` になる。`canManage`（教師・管理者）/ `role` で判定する
- 権限がないときは 403 ではなく `c.notFound()`。存在を知らせない
- サイト全体のロールで絞るときは `app.use(requireAuth, requireRole('admin'))`
- 同じ判定を何度も書くなら `manageAccess(c)` のようにファイル内の関数にまとめる（`participants.tsx` 参照）
- 子リソース（アイテムなど）は親の ID でも絞る: `WHERE id = ? AND course_id = ?`

### GET（表示）

```ts
app.get('/:id/notes', async (c) => {
  // 権限チェック
  return c.render(<NotePage values={{}} />, { title: `ノート - ${access.course.title}` })
})
```

- `title` は「画面名」か「画面名 - コース名」。`| StepLearn` は renderer が付ける
- 複数のクエリは `db.batch([...])` でまとめる
- 一覧が空のときは `EmptyState` を出す

### POST（更新）

```ts
app.post('/:id/notes', async (c) => {
  // 権限チェック
  const form = await readForm(c)
  const title = field(form, 'title', 120)
  if (!title) {
    c.status(422)
    return c.render(<NotePage values={{ title }} errors={{ title: 'タイトルを入力してください。' }} />, { title: 'ノート' })
  }
  await db.prepare('INSERT INTO notes (course_id, title) VALUES (?, ?)').bind(id, title).run()
  return redirectWith(c, `/courses/${id}/notes`, 'ノートを追加しました。')
})
```

- フォームの値は `field(form, key, 最大長)` で取る（trim と長さの切り詰めを兼ねる）。最大長は必ず指定する
- 入力欄ごとのエラーは、ステータス 422 で同じ画面を `values` と `errors` 付きで描き直す
- 一覧画面の小さなフォームなど描き直しにくいものは `redirectWith(c, back, 'メッセージ。', 'error')`
- 成功したら `redirectWith(c, url, 'メッセージ。')`（303 とトースト）。種類は `success`（既定）/ `info`（削除・退出など）/ `error`
- 選択肢の値は型ガードで検証し、不正なら `c.notFound()`
- バリデーションが長くなるなら `parseXxxForm(form): { values, errors, ok }` に切り出す（`courses.tsx` の `parseCourseForm` 参照）

### 削除・状態変更

- HTTP メソッドは GET と POST だけ。削除は `POST /.../delete`、並べ替えは `POST /.../move`
- 取り消せない操作のフォームには `data-confirm="〜しますか？"` を付ける（`client.ts` が確認ダイアログを出す）
- ストレージのファイル削除などは `inBackground(...)` で応答を待たせない

### JS からの呼び出し

画面遷移なしで反映したい操作もフォーム送信の形で作り、`wantsJson(c)` のときだけ JSON を返す。

```ts
if (wantsJson(c)) return c.json({ completed, ...stats })
return c.redirect(c.req.header('referer') ?? `/courses/${id}`, 303)
```

### 未ログインでも使える POST

ログイン・登録のように誰でも叩ける処理には `rateLimiter`（`lib/rate-limit.ts`）を使い、キーは `clientIp(c)` やメールアドレスにする。メールアドレスの登録有無が応答からわからないようにする（`auth.tsx` 参照）。

## 終わったら

- `ui` スキルで見た目を合わせる
- `verify` スキルで確認する。権限ごと（管理者 / 教師 / 学生 / 未ログイン）に URL を直接開いて、見えてはいけないものが 404 になることも確かめる
