---
name: ui
description: "StepLearn の見た目と UI の作り方（既存の UI 部品・CSS クラス・デザイントークン・アイコン・ダークモード・スマホ対応・クライアント JS の進化的拡張）。画面のマークアップを書く、src/style.css や src/components/ を変更する、src/client.ts に挙動を足す、デザインを調整するときに読み込む。「見た目を整えて」「ボタンを追加」「レイアウトを変えて」「画面遷移なしで反映したい」なども対象。"
---

# UI の作り方

方針は「JS なしで全部動く SSR ＋ 小さな進化的拡張」。CSS は `src/style.css` の 1 ファイル、JS は `src/client.ts` の 1 ファイル。CSS フレームワークや UI ライブラリは入れない。

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

アイコンは `<Icon name="..." size={16} />`（`components/icons.tsx`）。使える名前は `paths` のキー。足すときは Lucide 風の 24x24・stroke の path を `paths` に追加する。外部のアイコンフォントや画像は使わない。

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
- トークンを足すときは `:root` と `@media (prefers-color-scheme: dark)` の両方に定義する。ダークモードで必ず見た目を確認する
- 薄い色は `color-mix(in srgb, var(--primary) 12%, transparent)` で作る
- コースの色は `tone-${color}` クラスと `--c1` / `--c2` を使う
- スマホ対応は既存のブレークポイント（`max-width: 640px` / `900px`）に合わせる
- 関係する既存ブロック（`/* ===== */` の見出しで区切られている）の近くに追記する
- クラス名は kebab-case で、`ブロック-要素` の形（`course-card` `course-title`）。状態は `is-done` `active` `has-error`

## マークアップ

- 操作はリンクか `<form method="post">`。フォームを送信しないボタンには `type="button"` を書く
- 送信に時間がかかるフォームには `data-loading-form`（二重送信防止）
- 取り消せない操作のフォームには `data-confirm="〜しますか？"`
- `select` を変えたら即送信するフォームは `data-autosubmit` と、JS なし用の `<noscript><button>` をセットで
- 開閉は `<details>` / `<summary>` で作る（ポップオーバーは `details.popover`）
- 先読みさせたくないリンク（ログアウト・ダウンロードなど）は `data-no-prefetch`
- 入力欄には `label`、アイコンボタンには `aria-label`、状態は `aria-pressed` / `aria-invalid` で伝える
- 文言はすべて日本語

## クライアント JS（src/client.ts）

- 先に JS なしで動くものを作り、そのうえで体験を良くする処理だけを足す
- 要素には `data-*` 属性で目印を付け、`document` へのイベント委譲で拾う（要素ごとに addEventListener しない）
- 区切りは `// --- 何の処理か` の見出しに合わせる
- `fetch` するときは `Accept: application/json` を付け、サーバー側は `wantsJson(c)` で分岐する（`add-page` スキル参照）
- 失敗したら元の状態に戻し、`toast('〜できませんでした。', 'error')` を出す
- `localStorage` は try/catch で包む
- ライブラリは入れない。`alert` / `confirm` は使わず、確認は `data-confirm` の独自ダイアログを使う

## 確認

- ライト / ダークの両方
- スマホ幅（375px 前後）でレイアウトが崩れない・横スクロールが出ない
- JS を無効にしても操作できる
- UI を変えた PR にはスクリーンショット（Before / After）を付ける
