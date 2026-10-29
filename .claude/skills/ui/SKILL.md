---
name: ui
description: "StepLearn の見た目と UI の作り方（既存の UI 部品・CSS クラス・デザイントークン・アイコン・ダークモード・スマホ対応・クライアント JS）。画面のマークアップを書く、src/style.css や src/components/ を変更する、src/client.ts に挙動を足す、デザインを調整するときに読み込む。「見た目を整えて」「ボタンを追加」「レイアウトを変えて」「画面遷移なしで反映したい」なども対象。"
---

# UI の作り方

方針は「SSR ＋ 小さなクライアント JS」。JavaScript は必須で、無効なときは renderer の noscript が案内だけを出すので、JS なしの代替は作らない。CSS は `src/style.css` の 1 ファイル、JS は `src/client.ts` の 1 ファイル。CSS フレームワークや UI ライブラリは入れない。

## まず既存の部品を使う

`src/components/ui.tsx`

| 部品 | 用途 |
| --- | --- |
| `PageHeader` | 画面上部の見出し（`eyebrow` / `title` / `description` / `actions`） |
| `Field` | 1 行入力。`error` / `hint` / `type="password"`（表示切り替え付き） |
| `TextArea` | 複数行入力 |
| `EmptyState` | 一覧が空のとき（`icon` / `title` / `text` / `action`） |
| `Avatar` | 名前から色とイニシャルを作るアイコン |
| `Progress` / `ProgressRing` | 進捗バー・リング（JS で更新できる `data-*` 付き） |
| `CourseCard` | コース一覧のカード |
| `formatDate` | UNIX 秒を「2026年10月28日」形式で表示 |

`src/components/layout.tsx` の `AppShell`（ログイン後）/ `AuthShell`（ログイン前）で必ず包む。コース配下の画面は `components/course.tsx` の `CourseHeader` でタブを出す。

アイコンは `<Icon name="..." size={16} />`（`components/icons.tsx`）。使える名前は `svgs` のキー。アイコンは [Heroicons](https://heroicons.com/) の 24px outline だけを使い、足すときは devDependency の `heroicons` から `import foo from 'heroicons/24/outline/<名前>.svg?raw'` で読み込んで `svgs` に加える（ビルド時に文字列として埋め込まれるので、実行時の依存は増えない）。パスを手書きしたり、外部のアイコンフォントや画像を使ったりしない。

## よく使う CSS クラス

- レイアウト: `stack` `stack-lg`（縦並び）、`row`、`grid-2`、`settings-grid`、`toolbar`、`form-actions`
- 箱: `card` ＋ `card-head`、`table-card` ＋ `table`、`block` ＋ `block-title`、`danger-zone` ＋ `danger-row`
- ボタン: `btn` に `btn-primary` / `btn-ghost` / `btn-danger` / `btn-danger-outline` / `btn-success`、サイズ `btn-sm` / `btn-lg` / `btn-block`。アイコンだけなら `icon-btn`（`aria-label` と `title` 必須）
- 文字: `muted`、`small`、`strong`、`truncate`、`eyebrow`、`sr-only`
- バッジ: `chip`、`chip-accent`、`chip-success`
- 人: `person` ＋ `person-meta`
- スマホで隠す列: `hide-sm`

新しいクラスを作る前に、`grep -n "^\.<名前>" src/style.css` で似たものがないか探す。

## CSS を書くとき

- 色・角丸・影は必ずトークン（`var(--surface)` `var(--border)` `var(--text-2)` `var(--muted)` `var(--primary)` `var(--radius)` `var(--shadow)` など）を使う。色コードを直接書かない
- トークンを足すときは `:root` と `:root[data-theme='dark']` の両方に定義する。ダークモードは OS の設定ではなく、利用者がヘッダーのボタンで選んだときだけ（`theme` クッキー → `<html data-theme>`）。ダーク用の上書きは `[data-theme='dark'] .foo` で書き、`prefers-color-scheme` は使わない。ダークモードで必ず見た目を確認する
- 薄い色は `color-mix(in srgb, var(--primary) 12%, transparent)` で作る
- コースの色は `tone-${color}` クラスと `--c1` / `--c2` を使う
- スマホ対応は既存のブレークポイント（`max-width: 640px` / `900px`）に合わせる
- 関係する既存ブロック（`/* ===== */` の見出しで区切られている）の近くに追記する
- クラス名は kebab-case で、`ブロック-要素` の形（`course-card` `course-title`）。状態は `is-done` `active` `has-error`

## マークアップ

- 操作はリンクか `<form method="post">`。フォームを送信しないボタンには `type="button"` を書く
- 送信に時間がかかるフォームには `data-loading-form`（二重送信防止）
- 取り消せない操作のフォームには `data-confirm="〜しますか？"`
- `select` を変えたら即送信するフォームには `data-autosubmit`
- 開閉は `<details>` / `<summary>` で作る（ポップオーバーは `details.popover`）
- モーダルは `<div popover="auto" class="modal">` と `<button type="button" popovertarget="...">` で作る（開閉・Esc・外側クリックをブラウザに任せられる。例は `components/course.tsx` の `CreateCourseButton`）。`popover` は値まで書く（真偽値で書くと hono が `popover="true"` と出力し、manual 扱いになって Esc や外側のクリックで閉じない）。`<dialog>` は開閉の処理を `client.ts` に書くことになるので使わない
- 先読みさせたくないリンク（ログアウト・ダウンロードなど）は `data-no-prefetch`
- リンクとフォーム送信は `client.ts` が fetch に置き換え、body を差し替えて再読み込みなしで遷移する。通常の遷移で開かせたいリンク・フォームには `data-reload`（`download` 付きのリンクと `target` 付きは自動で対象外）
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
