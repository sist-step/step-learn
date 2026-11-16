---
name: ui
description: "STEP Learn の見た目と UI の作り方（既存の UI 部品・CSS クラス・デザイントークン・アイコン・ダークモード・スマホ対応・クライアント JS）。画面のマークアップを書く、src/styles/ や src/components/ の CSS・部品を変更する、src/client.ts に挙動を足す、デザインを調整するときに読み込む。「見た目を整えて」「ボタンを追加」「レイアウトを変えて」「画面遷移なしで反映したい」なども対象。"
---

# UI の作り方

方針は「SSR ＋ 小さなクライアント JS」。CSS フレームワークや UI ライブラリは入れない。JS は `src/client.ts` の 1 ファイルで、重いライブラリを使うものだけ別のファイルにして、使う画面でだけ `client.ts` が動的に読み込む（一覧は AGENTS.md）。

このスキルには、コードを読んでも気づきにくい規則だけを書く。部品の props や挙動は、その部品の `.tsx` を読む。

## まず既存の部品を使う

ボタン・入力欄・タブなどは生の HTML やクラスを書かず、部品を使う。部品にない属性（`data-*`、`popovertarget`、`hidden`、`aria-*` など）はそのまま渡せば要素に付く。

| ファイル | 部品 | 気をつけること |
| --- | --- | --- |
| `components/button.tsx` | `Button` / `IconButton` | `type` の既定は `button`。送信するボタンには必ず `type="submit"`。`IconButton` は `label` が必須 |
| `components/form.tsx` | `TextField` / `SelectField` / `TextAreaField` / `FileField` / `DateTimeField` / `ImageField` / `FormField` / `Input` / `Select` / `Textarea` / `FileInput` / `FileChip` / `SearchBox` / `SegmentedControl` / `Switch` | 日時はブラウザ標準の `datetime-local` / `date` ではなく `DateTimeField`。ファイルは `FileInput`（`id` 必須）、画像は `ImageField` で受けて `lib/images.ts` の `putImage` / `serveImage`。ラベルなしの部品には `aria-label` |
| `components/markdown.tsx` | `MarkdownEditor` / `Markdown` | Markdown を受け取る欄は `TextAreaField` ではなく `MarkdownEditor`。表示は `Markdown`（生の HTML は通らない） |
| `components/card.tsx` | `Card` / `DangerRow` / `Block` / `Table` / `Stats` / `Stat` / `LinkCard` | 危険な操作は `Card tone="danger"` と `DangerRow` |
| `components/overlay.tsx` | `Modal` / `Popover` / `MenuItem` | 行の「その他の操作」は `Popover class="row-menu"` に `MenuItem` を並べ、危険な操作は `class="is-danger"` |
| `components/ui.tsx` | `PageHeader` / `Tabs` / `TabPanel` / `Chip` / `Alert` / `Breadcrumbs` / `Person` / `EmptyState` / `Avatar` / `Progress` / `ProgressRing` / `formatDate` | `Tabs` を置いた画面では中身を必ず `TabPanel` で包む。一覧が空なら `EmptyState` |
| `components/course.tsx` | `CourseCard` / `CourseIcon` / `CourseHeader` / `CourseLiveSync` / `ItemBar` / `ItemEditActions` / `LessonBadge` / `LessonJump` / `OutlineToggle` など | コース配下の画面は `CourseHeader` でタブを出す |
| `components/code.tsx` | `CodeInput` / `CodeField` / `CodeWorkspace` と編集画面のカード | コードを受け取る欄は `TextAreaField` ではなく `CodeField` |
| `components/quiz.tsx` / `quiz-animal.tsx` | 小テストの編集欄・解答・結果・動物のキャラクター | |
| `components/bundle.tsx` / `restriction.tsx` / `ai-panel.tsx` / `pdf.tsx` | ファイル自動配布・アクセス制限・AI のパネル・PDF | |
| `components/mascot.tsx` | `Mascot` / `MascotYard` / `WalkingMascot` | 飾りなので、伝える情報のない空きにだけ置く |

クラス名を条件で組み立てるときは `components/cx.ts` の `cx('a', cond && 'b')`。

Moodle モードの種類ごとの入力欄（`moodle-mode/extra-kinds.tsx`）は 1 枚のカードの中に並べるので、`XxxFields` の部品はカードではなく fieldset で包む。

### 入力の検証とエラーの置き場所

フォームに `{...validateWith('名前')}` を付けると、`client.ts` が各欄の `FieldError` にエラーを出す。`XxxField` と `MarkdownEditor` は `FieldError` を含んでいる。部品を使わない入力欄では、入力欄に `id` と `aria-describedby="${id}-error"` を付け、近くに `<FieldError id={id} />` を置いて `.field` で囲む（`client.ts` が `${id}-error` で探すため。例は `MarkdownEditor`）。

### 画面の骨組み

- ログイン後は `AppShell`、ログイン前は `AuthShell` で必ず包む。コース配下の画面では `AppShell` の `tone` にコースの色を渡す
- アイテムを画面いっぱいに出す画面（PDF・コード・アイテムの編集画面）は、`AppShell` の `topbar` に `ItemBar` を渡す
- アイテムの編集画面（通常モードと Moodle モードの `ItemEditPage`）は、左の列（`editor-main` / `editor-extra`）にカード、右の列（`editor-side`）に設定のカードを置く
- コースの内容を見せる画面（コースページ・アイテム）には `CourseLiveSync` を置く。コースの版は描画の前に読む（読み出しの後だと変更を取りこぼす）

### 部品を足す・直すとき

- 2 か所以上で同じマークアップを書いたら部品にし、上の表の該当するファイルに置く。表には 1 行で足す（props や挙動の説明は書かない）
- 見出しは `title` ではなく `heading` で受ける（`title` は HTML のツールチップ属性とぶつかる）
- 見た目の違いは `variant` / `size` / `tone` のような文字列リテラルのユニオンで受け、CSS の修飾クラスに対応させる。真偽値を何個も並べない
- 残りの属性は `...rest` で要素に渡し、型は `JSX.IntrinsicElements['button']` などと交差させる
- 部品が出すクラスや `data-*` は `client.ts` も参照している。名前を変えるときは `client.ts` も検索する
- 新しい部品は、描画時に `useStyle('/src/components/<部品>.css')` で自分の CSS を登録する
- 2 か所に足さないと動かないものがある
  - マスコットの足場: `mascot.css` の `.mascot-yard-block.is-<名前>` と、`client.ts` の `WALKER_GROUNDS`
  - 小テストの出題形式: `lib/quiz.ts` の `QUIZ_KINDS` と種類ごとの分岐、`components/quiz.tsx` の編集欄・解答・結果、`client.ts` の `quizAnswered`
  - 小テストの動物: `quiz-animal.tsx` の `QUIZ_ANIMALS` と `quiz-game.css` の色
  - AI のツールが変えた内容をその場で反映する画面: 画面の要素に `data-ai-watch`（`item:<id>`。コースは `CourseLiveSync` が `course:<id>` を持つ）と、ツールの `success` の 3 つ目に `lib/ai-tool-kit.ts` の `inCourse` / `inItem`

### アイコン

`<Icon name="..." size={16} />`（`components/icons.tsx`）。[Heroicons](https://heroicons.com/) の 24px outline だけを使い、足すときは `import foo from 'heroicons/24/outline/<名前>.svg?raw'` で読み込んで `svgs` に加える。パスを手書きしたり、アイコンフォントや画像を使ったりしない。

## CSS

### 置き場所と読み込み

| ファイル | 中身 | 読み込まれる条件 |
| --- | --- | --- |
| `src/styles/base.css` | デザイントークン・リセット・共通ユーティリティ・アニメーション | 常に |
| `src/components/<部品>.css` | その部品の見た目 | 部品が `useStyle` で登録したとき |
| `src/routes/<ルート>/<ルート>.css` | その画面だけで使うクラス | 画面が `<Styles use={[...]} />` で登録したとき |

- CSS ファイルを足したら `components/style.tsx` の `STYLESHEETS` に追加する。並びがカスケードの順なので、上書きしたいファイルより後ろに置く
- 新しいクラスを作る前に `grep -rn "^\.<名前>" src --include='*.css'` で似たものを探す。よく使うのは `stack` `stack-lg` `row` `grid-2` `toolbar` `form-actions` `back-link` `muted` `small` `strong` `truncate` `eyebrow` `sr-only` `hide-sm`
- クラス名は kebab-case の `ブロック-要素`（`course-card` `course-title`）。状態は `is-done` `active` `has-error`
- 関係する既存ブロック（`/* ===== */` の見出しで区切られている）の近くに追記する

### 値はトークンで書く

色・角丸・影・文字の大きさ・操作部品の高さは、`base.css` のトークンを使う。数値や色コードを直接書かない。

- 文字の大きさは「ページタイトル `--fs-3xl` → カード・セクションの見出し `--fs-lg` → 行のタイトル `--fs-md` → 本文 `--fs-base` → メタ `--fs-sm` / `--fs-xs`」の段から選び、間の大きさを作らない（例外は iOS の拡大を避ける入力欄の 16px と、ロゴ・`kbd` などの部品固有の大きさ）
- 入力欄とボタンの高さは `--control-h` / `--control-h-sm` / `--control-h-lg`
- 状態色を文字に使うときは `--danger-text` などの `-text`（`--danger` は背景や枠用で、文字にすると薄い）。塗りのボタンは `--danger-strong` / `--success-strong`
- 「今いる場所」（選択中のタブ・メニュー・セクション番号）は `--c-ink` / `--c-soft`。コース配下ではコースの色になる。主ボタンは `--primary` のまま
- `--primary` の塗りは主ボタンとスイッチのオンだけ。切り替え（`SegmentedControl` など）はトラック（`--track`）とつまみ（`--thumb`）で示す
- 操作部品の輪郭は `--field-border`、ほかの面の上に重なる面は `--surface-raised`（輪郭は `--overlay-border`）
- 薄い色は `color-mix(in srgb, var(--primary) 12%, transparent)`
- 灰色を足すときは、既存の中立色と同じわずかに寒色に寄せた温度に合わせる
- トークンを足すときは `:root` と `:root[data-theme='dark']` の両方に定義する

### ガラスの面

背景の色のにじみ（`layout.css` の `.content::before`）の上に、半透明のガラスの面を置く。

- ページに直接置く面（カード・タイル・表・検索欄）は `--glass` ＋ `--glass-border` ＋ `--shadow-card`。`--glass` はグラデーションなので `background` にだけ使い、`color-mix()` には渡さない（薄くするなら `--glass-faint`）
- カードの中に置く面（入力欄・行・小さな部品）は不透明の `--surface` / `--surface-2` と `--card-border`
- カードには `backdrop-filter` を付けない。枚数だけぼかしを合成し直すことになり、スクロールが重くなる。ぼかし（`--glass-blur`）は本文の上に重なる面（ヘッダー・ポップオーバー・トースト・AI パネル・モーダル）にだけ付ける
- `backdrop-filter` や `view-transition-name` の付いた要素の中に、その外へはみ出すガラスの面を置かない（ぼかしの範囲が区切られて、はみ出した部分がぼけない。ヘッダーの中のポップオーバーが不透明なのはこのため）
- スマホ幅で下から出すシートは、下に固定した行で中身を隠すので不透明（`--surface-raised`）のまま
- アイテムを読む画面（`.reader`）の面は影を `--shadow-rest` にする。本文・前後のアイテム・目次がそれぞれ浮いて見えると落ち着かないため
- ガラスの面は必ずトークンで書く。`prefers-reduced-transparency` / `prefers-contrast` で `base.css` がトークンを不透明の面に置き換えるので、`rgb(255 255 255 / 0.6)` のように直接書くと切り替えが効かない

### ダークモード

利用者がユーザーメニューで選んだときだけ（`<html data-theme>`）。サーバーは常にライトで描き、`renderer.tsx` の `<head>` のスクリプトが描画前に切り替える。上書きは `[data-theme='dark'] .foo` で書き、`prefers-color-scheme` は使わない。

### 操作と形

- `:hover` は `@media (hover: hover)` の中に書く（タッチ端末でタップ後にホバーの見た目が残らないように）。押下のフィードバックは `base.css` の `@media (hover: none)` にまとめてある
- ホバーで持ち上げる面は `--glass-hover` ＋ `--shadow` ＋ `translateY(-2px)`
- フォーカスは全体の `:focus-visible` に任せる。入力欄は `border-color: var(--focus)` と `box-shadow: var(--ring-field)`
- 入力欄の角丸は `--radius-field`、ボタン・タブ・検索欄・Segmented はピル（`999px`）
- 粗いポインター（`@media (max-width: 640px), (pointer: coarse)`）ではタップ領域を `--tap` 以上にする
- ブレークポイントは既存の `max-width: 640px` / `900px` に合わせる。AI のパネルを開くと本文だけが狭くなるので、本文の中の組み替えは画面の幅ではなく `@container` で決める
- マスコットは `transform` ではなく `translate` / `scale` / `rotate` で動かしている。表情やポーズの `transform` と打ち消し合わないように、動きを足すときも合わせる
- ダッシュボードに数字のタイルや大きなヒーローは置かない

## マークアップ

- 操作はリンクか `<form method="post">`
- 送信に時間がかかるフォームには `data-loading-form`（二重送信防止）
- 取り消せない操作のフォームには `data-confirm="〜しますか？"`
- `select` を変えたら即送信するフォームには `data-autosubmit`
- 編集画面の保存ボタンには `data-save-shortcut`（⌘S / Ctrl+S。フォームの外に置くときは `form="<id>"`）
- 開閉は `<details>` / `<summary>`、ボタンの下に出すパネルは `Popover`
- モーダルは `Modal` と `<Button popovertarget="...">`。自前で書くときも `popover` は値まで書く（真偽値で書くと hono が `popover="true"` と出力し、manual 扱いになって Esc や外側のクリックで閉じない）。`<dialog>` は開閉の処理を `client.ts` に書くことになるので使わない
- 先読みさせたくないリンク（ログアウト・ダウンロードなど）は `data-no-prefetch`
- 通常の遷移で開かせたいリンク・フォームには `data-reload`（`download` や `target` 付きは自動で対象外）
- 遷移しても DOM ごと残したい要素には `id` と `data-persist`。違いだけを書き換えるので入力途中の値も持ち越される。フォームには付けない
- 端末ごとの設定で絞り込む表示（コース一覧の「進行中 / すべて」など）は、サーバーが候補をすべて描き、`client.ts` が `<html>` の `data-*` で隠す
- 入力欄には `label`、アイコンボタンには `aria-label`、状態は `aria-pressed` / `aria-invalid`
- 用語: コースの中身のまとまりは「教材」、1 件の単位は「アイテム」

## クライアント JS（src/client.ts）

- データを変える操作はフォーム送信で作る。テーマのような表示だけの状態は端末ごとの設定に保存し、POST のルートは作らない
- 要素には `data-*` で目印を付け、`document` へのイベント委譲で拾う（要素ごとに addEventListener しない）
- body を差し替えても `<script>` は実行されない。毎回の表示で要る初期化は `initPage()` に足す
- 区切りは `// --- 何の処理か` の見出しに合わせる
- `fetch` するときは `Accept: application/json` を付け、サーバーは `wantsJson(c)` で分ける
- 失敗したら元の状態に戻し、`toast('〜できませんでした。', 'error')` を出す
- 端末ごとの設定は `lib/settings.ts` の `getSetting` / `setSetting` / `updateSetting` で読み書きし、項目は `SETTINGS` のスキーマに `.catch(既定値)` 付きで足す。localStorage を直接触るキーを新しく作らない。それ以外で `localStorage` を使うときは try/catch で包む
- `alert` / `confirm` は使わず、確認は `data-confirm` の独自ダイアログを使う

## 確認

- ライト / ダークの両方
- スマホ幅（375px 前後）でレイアウトが崩れない・横スクロールが出ない
- UI を変えた PR にはスクリーンショット（Before / After）を付ける
