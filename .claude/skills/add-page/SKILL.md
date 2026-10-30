---
name: add-page
description: "STEP Learn に画面・ルート・フォーム処理を追加または変更する手順と型。src/routes/<name>/ のルーティング・ハンドラ・ビューを足す、新しいページを作る、フォームの送信先を作る、権限チェックやバリデーションを書く、一覧・詳細・編集・削除の画面を作るときに読み込む。「〇〇画面を作って」「〇〇できるようにして」「ページを追加」「フォームを追加」などの依頼が対象。"
---

# 画面・ルートの追加

STEP Learn は MPA。サーバーで HTML を返し、操作はすべて `<form method="post">` の送信と 303 リダイレクト（PRG）で完結させる。`client.ts` がこの送信を fetch に置き換えて再読み込みなしで遷移させる（JavaScript は必須）。

## 置き場所

ルートごとにフォルダーを作り、「ルーティング / 処理 / ビュー」をファイルで分ける。

```
src/routes/<name>/
  index.ts       ルーティング。new Hono<AppEnv>()、ミドルウェア（requireAuth など）、パスとハンドラの対応だけを書く
  handlers.tsx   処理。権限チェック・入力の検証・DB の読み書き・c.render / redirectWith を返すハンドラ関数
  views.tsx      ビュー。画面と部品の JSX。データは props だけで受け取り、Context や db には触らない
  <name>.css     その画面だけで使う CSS（なければ作らない）
```

- 既存の機能領域に入るものは、該当するフォルダーに足す
  - `courses/`（コース一覧・作成・コースページ・設定）、`dashboard/`、`content/`（セクション・アイテム）、`participants/`（参加者）、`account/`、`admin/`、`auth/`、`screen/`（画面共有）
- 新しい領域なら `src/routes/<name>/` を作り、`src/index.tsx` で `app.route('/<prefix>', <name>)` する
- ナビゲーションに出す画面は `src/components/layout.tsx` の `links` に足す（左のアイコンレールに出る。権限で出し分ける）
- 複数のルートで使う部品は `src/components/`、コース関連の部品は `components/course.tsx`。複数のルートで使う DB の処理は `src/lib/`（`lib/courses.ts` など）
- handlers と views の両方で使う型・定数（一覧の行の型、件数の上限など）は views.tsx から export する

## ファイルの骨組み

`index.ts`

```ts
import { Hono } from 'hono'
import { requireAuth } from '../../lib/auth'
import type { AppEnv } from '../../lib/types'
import { create, list } from './handlers'

const app = new Hono<AppEnv>()
app.use(requireAuth)

app.get('/:id/notes', list)
app.post('/:id/notes', create)

export default app
```

`views.tsx`

```tsx
import { Button } from '../../components/button'
import { TextField, validateWith } from '../../components/form'
import { AppShell } from '../../components/layout'
import { Styles } from '../../components/style'
import { PageHeader } from '../../components/ui'
import type { FieldErrors } from '../../lib/forms'

export const NotePage = ({ values, errors = {} }: { values: { title?: string }; errors?: FieldErrors }) => (
  <AppShell>
    <Styles use={['/src/routes/notes/notes.css']} />
    <PageHeader title="ノート" description="..." />
    <form method="post" class="stack" data-loading-form {...validateWith('note')}>
      <TextField label="タイトル" name="title" value={values.title} error={errors.title} />
      <div class="form-actions">
        <Button type="submit" variant="primary">
          保存
        </Button>
      </div>
    </form>
  </AppShell>
)
```

`handlers.tsx`

```tsx
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCourseAccess } from '../../lib/courses'
import { db } from '../../lib/db'
import { field, intParam, readForm, redirectWith } from '../../lib/http'
import { notes } from '../../lib/schema'
import type { AppEnv } from '../../lib/types'
import { NotePage } from './views'

export async function list(c: Context<AppEnv>) {
  // 権限チェック → データ取得 → c.render(<NotePage ... />, { title })
}
```

- ハンドラは `export async function 動詞(c: Context<AppEnv>)` で書き、名前は短い動詞にする（`list` / `show` / `create` / `update` / `remove` / `move` など。`delete` は予約語なので `remove`）。同じフォルダーで表示と送信が対になるときは `showLogin` / `submitLogin` のようにする
- ハンドラの中に JSX のマークアップを書かない。`c.render(<XxxPage ... />, { title })` で views のページを呼ぶだけにする
- import は 外部パッケージ → `../../components` → `../../lib` → `./views` の順

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
- 同じ判定を何度も書くなら `manageAccess(c)` のように handlers.tsx 内の関数にまとめる（`participants/handlers.tsx` 参照）
- 子リソース（アイテムなど）は親の ID でも絞る: `WHERE id = ? AND course_id = ?`

### GET（表示）

```tsx
export async function show(c: Context<AppEnv>) {
  // 権限チェック
  return c.render(<NotePage values={{}} />, { title: `ノート - ${access.course.title}` })
}
```

- `title` は「画面名」か「画面名 - コース名」。`| STEP Learn` は renderer が付ける
- クエリは `db.select()...get()` / `.all()` で書く（書き方は `db-change` スキル）
- 一覧が空のときは `EmptyState` を出す

### POST（更新）

```tsx
export async function create(c: Context<AppEnv>) {
  // 権限チェック
  const form = await readForm(c)
  const result = validate('note', form)
  if (!result.ok) {
    c.status(422)
    return c.render(<NotePage values={{ title: field(form, 'title', 120) }} errors={result.errors} />, { title: 'ノート' })
  }
  db.insert(notes).values({ courseId: id, title: result.values.title }).run()
  return redirectWith(c, `/courses/${id}/notes`, 'ノートを追加しました。')
}
```

- 入力の検証は `src/lib/forms.ts` の zod（`zod/mini`）のスキーマに書き、`FORMS` に名前を付けて登録する。ハンドラは `validate('名前', form)` で確かめ、通れば `result.values`（trim・型の変換済み）を使う
  - 同じスキーマを `client.ts` も読み込み、ビューのフォームに `{...validateWith('名前')}` を付けると、送信前と入力中に同じ規則・同じ文言で各欄の下にエラーを出す
  - そのため `forms.ts` からは DB や Node の API を使うモジュールを import しない。重複の確認（`isUsernameTaken`）やファイルの中身の確認のように DB やサーバーが要るものは、`validate` が通ったあとにハンドラで確かめる
  - HTML の `required` / `maxlength` / `minlength` / `pattern` は書かない（`validateWith` が `novalidate` も付ける）
  - 文言は「〜を入力してください。」「〜は120文字以内で入力してください。」。スキーマの `text(ラベル, 最大長, { required })` が作る
- 入力欄ごとのエラーは、ステータス 422 で同じ画面を `values`（`field(form, key, 最大長)` で取った送られたままの値）と `errors={result.errors}` 付きで描き直す
- 一覧画面の小さなフォームなど描き直しにくいものは `redirectWith(c, back, firstError(result.errors), 'error')`
- 成功したら `redirectWith(c, url, 'メッセージ。')`（303 とトースト）。種類は `success`（既定）/ `info`（削除・退出など）/ `error`
- 選択肢の値は型ガードで検証し、不正なら `c.notFound()`

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

ログイン・登録のように誰でも叩ける処理には `rateLimiter`（`lib/rate-limit.ts`）を使い、キーは `clientIp(c)` やメールアドレスにする。メールアドレスの登録有無が応答からわからないようにする（`auth/handlers.tsx` 参照）。

## 終わったら

- `ui` スキルで見た目を合わせる
- `verify` スキルで確認する。権限ごと（管理者 / 教師 / 学生 / 未ログイン）に URL を直接開いて、見えてはいけないものが 404 になることも確かめる
