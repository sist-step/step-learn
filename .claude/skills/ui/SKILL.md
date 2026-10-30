---
name: ui
description: "STEP Learn の見た目と UI の作り方（既存の UI 部品・CSS クラス・デザイントークン・アイコン・ダークモード・スマホ対応・クライアント JS）。画面のマークアップを書く、src/styles/ や src/components/ の CSS・部品を変更する、src/client.ts に挙動を足す、デザインを調整するときに読み込む。「見た目を整えて」「ボタンを追加」「レイアウトを変えて」「画面遷移なしで反映したい」なども対象。"
---

# UI の作り方

方針は「SSR ＋ 小さなクライアント JS」。JavaScript は必須で、無効なときは renderer の noscript が案内だけを出すので、JS なしの代替は作らない。CSS は部品・画面ごとのファイルに分け、そのページで使う分だけを読み込む（下の「CSS の置き場所と読み込み」）。JS は `src/client.ts` の 1 ファイル（重いライブラリを使うものは分けて、使う画面でだけ `client.ts` が動的に読み込む。Markdown エディターの CodeMirror は `src/markdown-editor.ts`、ログイン画面の three.js は `src/auth-art.ts`）。CSS フレームワークや UI ライブラリは入れない。

## まず既存の部品を使う

ボタン・入力欄・タブなどは**生の HTML やクラスを書かず、部品を使う**。部品が見た目（CSS クラス）・アクセシビリティ（`aria-*`）・既定値をまとめて持っているので、画面ごとに見た目がずれない。部品にない属性（`data-*`、`popovertarget`、`hidden`、`aria-*` など）はそのまま渡せば要素に付く。

### ボタン — `src/components/button.tsx`

| 部品 | 使い方 |
| --- | --- |
| `Button` | `variant`（`default` / `primary` / `ghost` / `danger` / `danger-outline` / `success`）、`size`（`sm` / `md` / `lg`）、`block`、`icon` / `iconEnd`（アイコン名）。`href` を渡すとリンク、`as="span"` でリンクの中に置く飾りになる |
| `IconButton` | アイコンだけのボタン。`icon` と `label`（`aria-label` と `title` になる）が必須。`danger`、`href`、`as="summary"`（`details` の開閉ボタン） |

`type` の既定は `button`。フォームを送信するボタンには必ず `type="submit"` を書く。

```tsx
<Button type="submit" variant="primary">保存</Button>
<Button href="/courses" variant="ghost" icon="chevronLeft">戻る</Button>
<form method="post" action={url} data-confirm="削除しますか？">
  <IconButton type="submit" icon="trash" label="削除" danger />
</form>
```

### フォーム — `src/components/form.tsx`

| 部品 | 使い方 |
| --- | --- |
| `TextField` | ラベル付きの 1 行入力。`label` / `name` / `error` / `hint`、`type="password"` で表示切り替え付き。`id` の既定は `f-${name}`（同じ画面に複数置くときは `id` を渡す） |
| `SelectField` | ラベル付きのセレクト。`options`（`{ value, label }[]`）と `value` |
| `TextAreaField` | ラベル付きの複数行入力 |
| `FileField` | ラベル付きのファイル選択 |
| `ImageField` | プレビュー付きの画像選択。`src`（保存済みの画像の URL）/ `aspect`（プレビューの縦横比、既定 `16 / 9`）。選ぶとプレビューが替わり、上限を超えるファイルは `client.ts` が送信前に取り消す。受け取ったファイルは `lib/images.ts` の `putImage(prefix, file)` で検証・保存し、`serveImage(key)` で配信する |
| `FormField` | ラベル・エラー・ヒントの枠だけ。中身を自由に組みたいとき（`children` に `Input` などを置く） |
| `Input` / `Select` / `Textarea` / `FileInput` | ラベルなしの部品。表の中や横並びのフォームで使う（`aria-label` を付ける）。`compact` で小さくなる |
| `SearchBox` | 一覧上部の検索欄（`/` キーでフォーカス） |
| `SegmentedControl` | ラジオボタンの切り替え（`name` / `label` / `options`（`icon` 付き可）/ `value`） |
| `MarkdownEditor`（`markdown.tsx`） | Markdown の入力欄。CodeMirror のエディターに書式ボタン（⌘B / ⌘I / ⌘K）と「書く / プレビュー」の切り替え、書き方の早見表が付く。`label` / `name` / `value` / `rows`（最低の高さ）/ `placeholder` / `error` / `hint`。送信されるのは中の `textarea`（`name`）の値。Markdown を受け取る入力欄では `TextAreaField` ではなくこれを使う |
| `Switch` | オン・オフのスイッチ（`role="switch"` のボタン）。`label` / `checked` / `icon`。切り替えの処理は `data-*` を付けて `client.ts` に書く |

各 `XxxField` の `fieldClass` は外側の `.field` に付くクラス（`when-link` などの出し分け用）。

入力の検証にブラウザの `required` / `maxlength` などは使わない。フォームに `{...validateWith('名前')}`（`lib/forms.ts` の `FORMS` の名前）を付けると、`client.ts` が送信前と入力中にスキーマで確かめ、各欄の `FieldError` にエラーを出す。`XxxField` と `MarkdownEditor` は `FieldError` を含んでいる（`error` がなくても隠して置いておき、`client.ts` が `${入力欄の id}-error` で探す）。部品を使わない入力欄には、入力欄に `id` と `aria-describedby="${id}-error"` を付け、近くに `<FieldError id={id} />` を置き、`.field` で囲む（例は `courses/views.tsx` のセクション追加欄）。置き場所のない欄のエラーはトーストで出る

```tsx
<TextField label="氏名" name="name" value={name} error={errors.name} />
<SelectField label="セクション" name="section_id" options={sections.map((s) => ({ value: String(s.id), label: s.title }))} value={String(current)} />
<Select name="role" compact options={ROLE_OPTIONS} value={role} aria-label="ロール" />
```

### カード・表 — `src/components/card.tsx`

| 部品 | 用途 |
| --- | --- |
| `Card` | 白い箱。`heading` / `description` / `leading`（見出しの左のアイコンなど）/ `actions`（見出しの右）。`as="form"` でフォームそのものをカードにできる（`method` などはそのまま渡す）。`tone="danger"` で危険な操作の枠 |
| `DangerRow` | `Card tone="danger"` の中の 1 行（`heading` / `description` / 右側にボタン） |
| `Block` | 見出し付きのまとまり（`heading` / `count`（件数バッジ）/ `actions`） |
| `Table` | 表。`columns`（`{ label, class?, srOnly? }[]`。`false` を混ぜると出さない）を渡し、`children` に `<tr>` を並べる |
| `Stats` / `Stat` | 数字のカードを並べる。`Stat` は `label` / `value`、`href` でリンクになり矢印が付く |
| `LinkCard` | アイコン付きの横長の行（外部リンク・ファイルなど）。`href` でリンクになる |
| `Bento` / `Tile` | ベントーグリッド（4 列）とそのタイル。`span`（1〜4 列）/ `rows`（1〜2 段）、`href` でリンクになる。幅が狭いと 2 列に組み替わる。例はダッシュボード |

```tsx
<Card heading="プロフィール" description="参加者一覧に表示されます。">…</Card>
<Card as="form" method="post" action={url} class="stack" data-loading-form heading="編集">…</Card>
<Table columns={[{ label: '名前' }, manage && { label: '進捗', class: 'hide-sm' }, { label: '操作', srOnly: true }]}>
  {rows.map((r) => <tr>…</tr>)}
</Table>
```

### 重ねて出すもの — `src/components/overlay.tsx`

| 部品 | 用途 |
| --- | --- |
| `Modal` | 中央に出すダイアログ（`id` / `heading` / `description`）。開くボタンは `<Button popovertarget={id}>`、閉じるボタンは `popovertargetaction="hide"` を足す。右上の × は部品に含まれる |
| `Popover` | ボタンの下に出す小さなパネル（`details` で開閉、外側クリックと Esc で閉じる）。`trigger` に `<IconButton as="summary" …>` などの `summary` を渡す |
| `MenuItem` | メニューの 1 行（`icon`、`href` でリンク、なければボタン） |

```tsx
<Button variant="primary" icon="plus" popovertarget="create-x">作成</Button>
<Modal id="create-x" heading="作成">…</Modal>

<Popover trigger={<IconButton as="summary" icon="pencil" label="編集" />}>
  <form method="post" class="stack">…</form>
</Popover>
```

### 表示 — `src/components/ui.tsx`

| 部品 | 用途 |
| --- | --- |
| `PageHeader` | 画面上部の見出し（`eyebrow` / `title` / `description` / `actions`） |
| `Tabs` | ページを切り替えるタブ（`label` / `items`（`{ href, label, active }[]`）/ `block` で横幅いっぱい）。切り替えると選択中の背景が前のタブから滑る（`client.ts` の `markTabSwitch`） |
| `TabPanel` | `Tabs` の下の中身を包む。タブを切り替えたとき、中身が切り替えた向きに少し流れて入れ替わる。`Tabs` を置いた画面では必ず使う |
| `Chip` | 小さなラベル（`tone`: `default` / `accent` / `success` / `live`、`icon`） |
| `Alert` | 帯状のメッセージ（`tone`: `error` / `info` / `success` / `warning`）。フォームのエラーなど |
| `Breadcrumbs` | パンくず（`items`: `{ label, href? }[]`。最後は現在地なので `href` なし） |
| `Person` | アバターと名前・補足を横に並べる（`avatar` / `name` / `meta` / `href`）。表の 1 列目など |
| `EmptyState` | 一覧が空のとき（`icon` / `title` / `text` / `action`）。`page` で画面全体の空状態（404 など） |
| `Markdown`（`markdown.tsx`） | Markdown を HTML にして `.prose` の見た目で出す（`source`）。`lib/markdown.ts` の変換を使うので生の HTML は通らない |
| `Avatar` | 名前から色とイニシャルを作るアイコン |
| `Progress` / `ProgressRing` | 進捗バー・リング（JS で更新できる `data-*` 付き） |
| `CourseCard` | コース一覧のカード |
| `CourseIcon` | コースの頭文字のバッジ。コースアイコンが設定されていれば画像を出す。大きさと形は `class`（`course-mono` / `course-hero-mono` / `dot`）で決める |
| `CourseRow` | コースの 1 行表示（頭文字・名前・コード、学生は進捗、教師は「担当」）。タイルの中などの狭い場所で使う |
| `formatDate` | UNIX 秒を「2026年10月28日」形式で表示 |

ログイン前の画面（`AuthShell`）の右側は、`src/auth-art.ts` が three.js で描く 3D アニメーション（背景は無地で、台座の上で小さなキューブが 14 種類の形（ロケット・ネコ・家・アイスクリームなど。`MODELS`）に組み上がっては組み替わる。クリックでつつくとキューブが弾け、3 回続けると次の形へ。ドラッグで回せる）。`data-auth-art` の要素に `client.ts` が canvas を置き、再読み込みなしの遷移では同じ canvas を新しい要素へ移して続きから動かす。色は `--art-deep` / `--art-mid` / `--art-bright` / `--art-shine` とコースの色（`tone-*`）を読み取る。スマホ幅（非表示）では three.js を読み込まない

クラス名を条件で組み立てるときは `components/cx.ts` の `cx('a', cond && 'b')` を使う。

### 部品を足す・直すとき

- 2 か所以上で同じマークアップを書いたら部品にする。置き場所はボタンなら `button.tsx`、入力なら `form.tsx`、箱や表なら `card.tsx`、ダイアログやメニューなら `overlay.tsx`、その他の表示は `ui.tsx`、コース専用なら `course.tsx`
- 見出しは `title` ではなく `heading` で受ける（`title` は HTML のツールチップ属性とぶつかる）
- 見た目の違いは `variant` / `size` / `tone` のような文字列リテラルのユニオンで受け、CSS の修飾クラス（`btn-primary` など）に対応させる。真偽値を何個も並べない
- 残りの属性は `...rest` で要素に渡し、型は `JSX.IntrinsicElements['button']` などと交差させる（`data-*` や `aria-*` をそのまま受けられる）
- 部品が出すクラスは `src/client.ts` も参照している（`btn-success` の切り替え、`data-toggle-password` など）。名前を変えるときは `client.ts` も検索する
- 部品を足したら、この表にも追記する

`src/components/layout.tsx` の `AppShell`（ログイン後）/ `AuthShell`（ログイン前）で必ず包む。コース配下の画面は `components/course.tsx` の `CourseHeader` でタブを出す。

アイコンは `<Icon name="..." size={16} />`（`components/icons.tsx`）。使える名前は `svgs` のキー。アイコンは [Heroicons](https://heroicons.com/) の 24px outline だけを使い、足すときは devDependency の `heroicons` から `import foo from 'heroicons/24/outline/<名前>.svg?raw'` で読み込んで `svgs` に加える（ビルド時に文字列として埋め込まれるので、実行時の依存は増えない）。パスを手書きしたり、外部のアイコンフォントや画像を使ったりしない。

## よく使う CSS クラス

- レイアウト: `stack` `stack-lg`（縦並び）、`row`、`grid-2`、`settings-grid`、`toolbar`、`form-actions`
- 文字: `muted`、`small`、`strong`、`truncate`、`eyebrow`、`sr-only`
- スマホで隠す列: `hide-sm`

新しいクラスを作る前に、`grep -rn "^\.<名前>" src --include='*.css'` で似たものがないか探す。

## CSS の置き場所と読み込み

CSS は 1 ファイルにまとめず、使う部品・画面の隣に置く。ページには、そのページで描かれた部品が使う CSS だけが `<link>` で読み込まれる。

| ファイル | 中身 | 読み込まれる条件 |
| --- | --- | --- |
| `src/styles/base.css` | デザイントークン・リセット・共通ユーティリティ（`stack` `row` `muted` `form-actions` `toolbar` `row-actions` など）・アニメーション | 常に |
| `src/components/<部品>.css` | その `.tsx` の部品の見た目（`button.css` なら `Button` / `IconButton`） | 部品が描かれたとき |
| `src/routes/<ルート>/<ルート>.css` | その画面だけで使うクラス（`courses/courses.css` ならセクションやアイテムの行） | 画面が `<Styles use={[...]} />` で登録したとき |

- 部品は描画時に `useStyle('/src/components/button.css')` で自分の CSS を登録する（`src/components/style.tsx`）。新しい部品を作ったら、使う CSS をこれで登録する
- 画面専用の CSS は、その画面の `views.tsx` のマークアップの先頭に `<Styles use={['/src/routes/courses/courses.css']} />` を置いて登録する
- CSS ファイルを足したら、`src/components/style.tsx` の `STYLESHEETS` に追加する。並びがカスケードの順（同じ詳細度なら後ろが勝つ）なので、上書きしたいファイルより後ろに置く。パスは型で決まるので、登録し忘れや書き間違いは型チェックで分かる
- ビルドでは `src/**/*.css` がすべてクライアント側の入力になる（`vite.config.ts`）。追加の設定は要らない
- 再読み込みなしの画面遷移では、移動先に必要で未読み込みの CSS を、読み込み終わってから本文を差し替える（`client.ts` の `loadStyles`）。読み込み済みの CSS は外さない

## CSS を書くとき

- 入力欄とボタンの高さはトークン（`--control-h` / `--control-h-sm` / `--control-h-lg`）で揃えている。数値を直接書かない
- 色・角丸・影は必ずトークン（`var(--surface)` `var(--border)` `var(--text-2)` `var(--muted)` `var(--primary)` `var(--radius)` `var(--shadow)` など）を使う。色コードを直接書かない
- トークンを足すときは `:root` と `:root[data-theme='dark']` の両方に定義する。ダークモードは OS の設定ではなく、利用者がヘッダーのユーザーメニューで選んだときだけ（`theme` クッキー → `<html data-theme>`）。ダーク用の上書きは `[data-theme='dark'] .foo` で書き、`prefers-color-scheme` は使わない。ダークモードで必ず見た目を確認する
- 薄い色は `color-mix(in srgb, var(--primary) 12%, transparent)` で作る
- コースの色は `tone-${color}` クラスと `--c1` / `--c2` を使う
- スマホ対応は既存のブレークポイント（`max-width: 640px` / `900px`）に合わせる
- 関係する既存ブロック（`/* ===== */` の見出しで区切られている）の近くに追記する
- クラス名は kebab-case で、`ブロック-要素` の形（`course-card` `course-title`）。状態は `is-done` `active` `has-error`

## マークアップ

- 操作はリンクか `<form method="post">`。送信ボタンは `<Button type="submit">` / `<IconButton type="submit">`（部品の `type` の既定は `button`）
- 送信に時間がかかるフォームには `data-loading-form`（二重送信防止）
- 取り消せない操作のフォームには `data-confirm="〜しますか？"`
- `select` を変えたら即送信するフォームには `data-autosubmit`
- 編集画面の保存ボタンには `data-save-shortcut`（⌘S / Ctrl+S で押される。フォームの外に置くときは `form="<id>"` を付ける）
- 開閉は `<details>` / `<summary>` で作る（ボタンの下に出すパネルは `Popover` 部品）
- モーダルは `Modal` 部品と `<Button popovertarget="...">` で作る（開閉・Esc・外側クリックをブラウザに任せられる。例は `components/course.tsx` の `CreateCourseButton`）。自前で書く場合も `popover` は値まで書く（真偽値で書くと hono が `popover="true"` と出力し、manual 扱いになって Esc や外側のクリックで閉じない）。`<dialog>` は開閉の処理を `client.ts` に書くことになるので使わない
- 先読みさせたくないリンク（ログアウト・ダウンロードなど）は `data-no-prefetch`
- リンクとフォーム送信は `client.ts` が fetch に置き換え、body を差し替えて再読み込みなしで遷移する。通常の遷移で開かせたいリンク・フォームには `data-reload`（`download` 付きのリンクと `target` 付きは自動で対象外）
- 遷移しても DOM ごと残したい要素（開いたまま保ちたいサイドバーなど）には `id` と `data-persist` を付ける。その要素は丸ごと差し替えず、新しいページとの違い（属性・文字・増減した子要素）だけを書き換える。入力途中の値まで持ち越されるので、フォームには付けない
- コースの内容を見せる画面（コースページ・アイテム）には `components/course.tsx` の `CourseLiveSync` を置く。`client.ts` が 10 秒ごとにコースの版（`lib/courses.ts` の `courseRevision`。`/courses/:id/` 配下の POST で進む）を確かめ、変わっていたら同じ URL を取り直して、前回描いた内容との差分だけを `<main>` に当てる。入力中の欄・開いているポップオーバーやモーダル・再生中の動画を含む部分は、使い終わるまで差し替えない。描画前に版を読むこと（読み出しの後だと変更を取りこぼす）
- body を差し替えても `<script>` は実行されないので、専用スクリプトを読み込むページは自動で通常の読み込みになる。毎回の表示で必要な初期化は `client.ts` の `initPage()` に足す
- 入力欄には `label`、アイコンボタンには `aria-label`、状態は `aria-pressed` / `aria-invalid` で伝える
- 文言はすべて日本語

## クライアント JS（src/client.ts）

- データを変える操作はフォーム送信で作り、`client.ts` で画面遷移なしに反映する。テーマのような表示だけの状態は、`client.ts` がクッキーを書き、サーバーはそれを読んで描く（POST のルートは作らない）
- 要素には `data-*` 属性で目印を付け、`document` へのイベント委譲で拾う（要素ごとに addEventListener しない）
- 区切りは `// --- 何の処理か` の見出しに合わせる
- `fetch` するときは `Accept: application/json` を付け、サーバー側は `wantsJson(c)` で分岐する（`add-page` スキル参照）
- 失敗したら元の状態に戻し、`toast('〜できませんでした。', 'error')` を出す
- `localStorage` は try/catch で包む
- ライブラリは入れない。`alert` / `confirm` は使わず、確認は `data-confirm` の独自ダイアログを使う

## 確認

- ライト / ダークの両方
- スマホ幅（375px 前後）でレイアウトが崩れない・横スクロールが出ない
- UI を変えた PR にはスクリーンショット（Before / After）を付ける
