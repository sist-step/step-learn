---
name: add-page
description: "STEP Learn に画面・ルート・フォーム処理を追加または変更する手順と型。src/routes/<name>/ のルーティング・ハンドラ・ビューを足す、新しいページを作る、フォームの送信先を作る、権限チェックやバリデーションを書く、一覧・詳細・編集・削除の画面を作るときに読み込む。「〇〇画面を作って」「〇〇できるようにして」「ページを追加」「フォームを追加」などの依頼が対象。"
---

# 画面・ルートの追加

STEP Learn は MPA。サーバーで HTML を返し、操作はすべて `<form method="post">` の送信と 303 リダイレクト（PRG）で完結させる。`client.ts` がこの送信を fetch に置き換えて再読み込みなしで遷移させる。

手本は `src/features/participants/`（一覧・追加・変更・削除がそろっていて小さい）。入力欄ごとにエラーを出すフォームは `src/features/courses/handlers.tsx` の作成・編集。書き始める前に読み、同じ形にする。

## 置き場所

```
src/routes/<name>/
  index.ts       ルーティング。new Hono<AppEnv>()、ミドルウェア（requireAuth など）、パスとハンドラの対応だけ
  handlers.tsx   処理。権限チェック・入力の検証・DB の読み書き・c.render / redirectWith を返す
  views.tsx      画面の JSX。データは props だけで受け取り、Context や db には触らない
  <name>.css     その画面だけで使う CSS（なければ作らない）
```

- 既存の領域に入るものは該当するフォルダーに足す。新しい領域なら `src/routes/<name>/` を作り、`src/app.tsx` で `app.route('/<prefix>', <name>)` する
- handlers と views の両方で使う型・定数（一覧の行の型、件数の上限など）は views.tsx から export する
- ナビゲーションに出す画面は `src/components/layout.tsx` の `links` に足す
- 複数のルートで使う部品は `src/components/`、DB の処理は `src/lib/`

### Moodle モード

Moodle モード（`MOODLE_URL` を設定したとき）は `src/moodle-mode/` の別のアプリで動く。

- Moodle モードから `src/lib/db.ts` を（間接的にも）読み込むと起動時にエラーになる
- 両方のモードで使うルートは `backend.ts`（`ai/` は `handlers.tsx` の `AiBackend`）を持っている。その `handlers.tsx` と `views.tsx` からは DB を開くモジュールを import せず、モードごとの DB と権限の確認は `XxxBackend` に書く
- AI のツールは通常モードが `features/ai/ai-tools.ts`、Moodle モードが `moodle-mode/ai-tools.ts`。どちらも `features/ai/ai-tool-kit.ts` の `defineTool`（すぐ実行）か `defineConfirmTool`（確認カード）で作る
- `src/routes/` のビューや `src/components/` の部品を変えたら、Moodle モードの画面（`src/moodle-mode/views.tsx` と、使い回している `CoursesPage` / `DashboardPage`）も崩れないか確かめる

## ハンドラ

- `export async function 動詞(c: Context<AppEnv>)` で書き、名前は短い動詞にする（`list` / `show` / `create` / `update` / `remove` / `move`。`delete` は予約語なので `remove`）。表示と送信が対になるときは `showLogin` / `submitLogin`
- ハンドラの中に JSX のマークアップを書かない。`c.render(<XxxPage ... />, { title })` で views のページを呼ぶだけにする
- `title` は「画面名」か「画面名 - コース名」。`| STEP Learn` は renderer が付ける
- `requireAuth` を通したあとは `c.var.user!` でよい

### 権限チェック（全ハンドラの先頭）

- ID は必ず `intParam` で取る（正の安全な整数以外は `null`）
- コースに関わる処理は `getCourseAccess` を通し、`canManage`（教師・管理者）/ `role` で判定する。同じ判定が続くなら `manageAccess(c)` のように handlers.tsx の中の関数にまとめる
- 権限がないときは 403 ではなく `c.notFound()`
- サイト全体のロールで絞るときは `app.use(requireAuth, requireRole('admin'))`
- 子リソース（アイテムなど）は親の ID でも絞る

### POST（更新）

- 入力の検証は `src/lib/forms.ts` の zod（`zod/mini`）のスキーマに書き、`FORMS` に名前を付けて登録する。ビューのフォームに `{...validateWith('名前')}` を付けると、`client.ts` が同じスキーマで送信前にエラーを出す
  - `forms.ts` からは DB や Node の API を使うモジュールを import しない（ブラウザでも読み込むため）。重複の確認など DB が要るものは、検証が通ったあとにハンドラで確かめる
- 入力欄ごとにエラーを出す画面は `readForm` と `validate('名前', form)` を使い、通らなければステータス 422 で同じ画面を、送られたままの値（`field(form, key, 最大長)`）と `errors` 付きで描き直す
- 一覧の中の小さなフォームなど描き直しにくいものは `readFields(c, '名前')` で読み、通らなければ `c.notFound()`。エラーの文言を伝えたいときは `validate` の結果を `redirectWith(c, back, firstError(result.errors), 'error')` で返す。JSON を受ける操作は `readJson(c, スキーマ)`
- 成功したら `redirectWith(c, url, 'メッセージ。')`（303 とトースト）。種類は `success`（既定）/ `info`（削除・退出など）/ `error`
- HTTP メソッドは GET と POST だけ。削除は `POST /.../delete`、並べ替えは `POST /.../move`
- ストレージのファイルの削除などは `inBackground(...)` で応答を待たせない
- 画面遷移なしで反映したい操作もフォーム送信の形で作り、`wantsJson(c)` のときだけ JSON を返す

### 未ログインでも使える POST

ログイン・登録のように誰でも叩ける処理には `rateLimiter`（`lib/rate-limit.ts`）を使い、キーは `clientIp(c)` やメールアドレスにする。メールアドレスの登録有無が応答からわからないようにする（`auth/handlers.tsx` 参照）。

## 終わったら

- `ui` スキルで見た目を合わせる（確認のチップ・二重送信の防止などの `data-*` もそこにある）
- `verify` スキルで確認する。権限ごと（管理者 / 教師 / 学生 / 未ログイン）に URL を直接開いて、見えてはいけないものが 404 になることも確かめる
