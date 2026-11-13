---
name: ui
description: "STEP Learn の見た目と UI の作り方（既存の UI 部品・CSS クラス・デザイントークン・アイコン・ダークモード・スマホ対応・クライアント JS）。画面のマークアップを書く、src/styles/ や src/components/ の CSS・部品を変更する、src/client.ts に挙動を足す、デザインを調整するときに読み込む。「見た目を整えて」「ボタンを追加」「レイアウトを変えて」「画面遷移なしで反映したい」なども対象。"
---

# UI の作り方

方針は「SSR ＋ 小さなクライアント JS」。JavaScript は必須で、無効なときは renderer の noscript が案内だけを出すので、JS なしの代替は作らない。CSS は部品・画面ごとのファイルに分け、そのページで使う分だけを読み込む（下の「CSS の置き場所と読み込み」）。JS は `src/client.ts` の 1 ファイル（重いライブラリを使うものは分けて、使う画面でだけ `client.ts` が動的に読み込む。Markdown エディターの CodeMirror は `src/markdown-editor.ts`、コードのエディターの CodeMirror と各言語の文法は `src/code-editor.ts`、ログイン画面の three.js は `src/auth-art.ts`、PDF ビューアーの pdf.js は `src/pdf-viewer.ts`）。CSS フレームワークや UI ライブラリは入れない。

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
| `FileField` | ラベル付きのファイル選択（中身は `FileInput`） |
| `DateTimeField` | ラベル付きの日時（`mode="datetime"`、値は `YYYY-MM-DDTHH:mm`）か日付（`mode="date"`、値は `YYYY-MM-DD`）の選択。ブラウザ標準の `datetime-local` / `date` は使わずこれを使う。欄は「2026年11月13日（金） 14:30」と出すボタンで、押すと `client.ts` がパネルを出す。パソコン（幅 641px 以上かつ細かいポインター）では欄の下にカレンダーと時・分（5 分刻み）の一覧のポップオーバーを出し、選んだそばから欄に入れる（矢印キーで日を、PageUp / PageDown で月を移せる）。スマホ・タブレットでは下からシートを出し、カレンダーと時・分のホイールで選んで「決定」で入れる（背景を押すと取り消し）。`optional` で値を消す × とパネルの「クリア」が付く。送信されるのは隠した入力欄（`name`）の値なので、サーバー側の検証はそのまま使える |
| `ImageField` | プレビュー付きの画像選択。`src`（保存済みの画像の URL）/ `aspect`（プレビューの縦横比、既定 `16 / 9`）/ `width`。`FileInput` のドロップ領域がそのままプレビューになり、画像があるときはホバー・ドラッグ中だけ案内を重ねる。選ぶとプレビューが替わり、上限を超えるファイルは `client.ts` が送信前に取り消す。受け取ったファイルは `lib/images.ts` の `putImage(prefix, file)` で検証・保存し、`serveImage(key)` で配信する |
| `FormField` | ラベル・エラー・ヒントの枠だけ。中身を自由に組みたいとき（`children` に `Input` などを置く） |
| `Input` / `Select` / `Textarea` | ラベルなしの部品。表の中や横並びのフォームで使う（`aria-label` を付ける）。`compact` で小さくなる |
| `FileInput` | ファイル選択。ブラウザ標準の部品を隠し、点線のドロップ領域（「ドラッグ＆ドロップ または {`buttonLabel`}」、既定「ファイルを選択」。タッチ端末と幅の狭い領域ではドラッグの案内を省く）を出す。`id` は必須（領域が `label[for]` になる）。押して選ぶほか、ファイルをドロップしても選べ（`client.ts` が `accept` を確かめる）、選ぶと下に `FileChip`（名前・拡張子・サイズ・取り消しの ×）が出る。`icon` は `FileChip` のアイコン、`zoneClass` / `zoneStyle` / `children` は領域の見た目と中身（`ImageField` のプレビュー） |
| `FileChip` | ファイル 1 件の行（`name` / `meta` / `icon`、既定 `file`）。編集画面の「現在のファイル」にも使い、`FileInput` で選んだファイルと同じ見た目にそろえる |
| `SearchBox` | 一覧上部の検索欄（`/` キーでフォーカス） |
| `SegmentedControl` | ラジオボタンの切り替え（`name` / `label` / `options`（`icon` 付き可）/ `value`） |
| `MarkdownEditor`（`markdown.tsx`） | Markdown の入力欄。CodeMirror のエディターに書式ボタン（⌘B / ⌘I / ⌘K）と「書く / プレビュー」の切り替え、書き方の早見表が付く。`label` / `name` / `value` / `rows`（最低の高さ）/ `placeholder` / `error` / `hint`。`split` を付けると、欄の幅が 760px 以上のときだけ「並べる」（左に書く欄、右に入力に追従するプレビュー）が増える。並べるかどうかは端末ごとの設定（`mdSplit`、既定は並べる）で、幅の広いときに「書く / 並べる」を選ぶと覚える。アイテムの編集画面の本文・問題文・説明で使う。送信されるのは中の `textarea`（`name`）の値。Markdown を受け取る入力欄では `TextAreaField` ではなくこれを使う |
| `Switch` | オン・オフのスイッチ（`role="switch"` のボタン）。`label` / `checked` / `icon`。切り替えの処理は `data-*` を付けて `client.ts` に書く |

各 `XxxField` の `fieldClass` は外側の `.field` に付くクラス（`when-link` などの出し分け用）。

入力の検証にブラウザの `required` / `maxlength` などは使わない。フォームに `{...validateWith('名前')}`（`lib/forms.ts` の `FORMS` の名前）を付けると、`client.ts` が送信前と入力中にスキーマで確かめ、各欄の `FieldError` にエラーを出す。`XxxField` と `MarkdownEditor` は `FieldError` を含んでいる（`error` がなくても隠して置いておき、`client.ts` が `${入力欄の id}-error` で探す）。部品を使わない入力欄には、入力欄に `id` と `aria-describedby="${id}-error"` を付け、近くに `<FieldError id={id} />` を置き、`.field` で囲む（例は `components/markdown.tsx` の `MarkdownEditor`）。置き場所のない欄のエラーはトーストで出る

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
| `Stats` / `Stat` | 数字のカードを並べる。`Stat` は `label` / `value`、`href` でリンクになり矢印が付く。`label` の先頭に `<span class="stat-icon"><Icon … /></span>` を置くとアイコンが付く。`<Stats compact>` で数字を横に並べた低いカードになる（例は管理 > ユーザー） |
| `LinkCard` | アイコン付きの横長の行（外部リンク・ファイルなど）。`href` でリンクになる。`class="link-card-lg"` を渡すと、アイテム画面の主操作のパネルになる（スマホではボタンが全幅で折り返す） |
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
| `Popover` | ボタンの下に出す小さなパネル（`details` で開閉、外側クリックと Esc で閉じる）。開くときに `client.ts`（`placePopoverPanel`）が高さを測り、下に収まらなければボタンの上に開き（`is-above`）、上にも収まらなければパネル全体が見えるまでスクロールする。`trigger` に `<IconButton as="summary" …>` などの `summary` を渡す |
| `MenuItem` | メニューの 1 行（`icon`、`href` でリンク、なければボタン）。削除などの危険な操作は `class="is-danger"` |

表の行やカードの「その他の操作」は、`<Popover class="row-menu" panelClass="row-menu-panel" trigger={<IconButton as="summary" icon="ellipsis" label="その他の操作" />}>` の中に `MenuItem` を並べる（`.row-menu-panel` と `is-danger` の色は `overlay.css` にある）。

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
| `Person` | アバターと名前・補足を横に並べる（`avatar` / `name` / `meta` / `href`）。表の 1 列目など。`meta` に `userMeta(user)` の配列（`string[]`）を渡すと「@ユーザー名」とメールアドレスが別々の要素になり、メールアドレスのほうが先に省略される。スマホの表では 2 行に分かれる |
| `EmptyState` | 一覧が空のとき（`icon` / `title` / `text` / `action`）。`page` で画面全体の空状態（404 など） |
| `Markdown`（`markdown.tsx`） | Markdown を HTML にして `.prose` の見た目で出す（`source`）。`lib/markdown.ts` の変換を使うので生の HTML は通らない |
| `Avatar` | 名前から色とイニシャルを作るアイコン |
| `Progress` / `ProgressRing` | 進捗バー・リング（JS で更新できる `data-*` 付き） |
| `CourseCard` | コースのカード（名前 → コード → 概要）。コース一覧とダッシュボードのマイコースで `.course-grid` に並べる。期間外のコースには `data-course-ended`、参加していないコースには `data-course-unenrolled` が付き、コース一覧の「進行中 / すべて」の絞り込みで隠れる（下の「マークアップ」） |
| `CourseIcon` | コースの頭文字のバッジ。コースアイコンが設定されていれば画像を出す。大きさと形は `class`（`course-mono` / `course-hero-mono` / `dot`）で決める |
| `formatDate` | UNIX 秒を「2026年10月28日」形式で表示 |

### マスコット — `src/components/mascot.tsx`

| 部品 | 用途 |
| --- | --- |
| `Mascot` | ロゴ（シアンの輪・黒い枠・STEP の帯）を元にした SVG のキャラクター。`act` で動きのパターン（`MASCOT_ACTS`: `greet` あいさつ / `cheer` 応援 / `advise` 助言 / `idea` ひらめき / `ask` 質問 / `think` 考える / `warn` 注意 / `agree` うなずく / `share` すすめる / `rest` 休む）を選ぶと、表情・ポーズ・動き・視線がまとめて決まる。個別に渡した `mood`（`normal` / `happy` / `sad` / `surprised` / `thinking` / `sleepy`）/ `pose`（`idle` / `wave`（振り続ける）/ `greet`（表示したときに 3 回振って下ろす）/ `cheer` / `point` / `raise`（手を挙げる）/ `open`（両手を広げる）/ `type`（両手を前に出してキーを打つ）/ `hold`（両手で前に持つ）/ `sip`（右手のマグカップを口へ運ぶ））/ `motion`（`none` / `float` / `bounce` / `hop` / `wiggle` / `nod`（うなずく）/ `tilt`（首をかしげる）/ `shake`（首を振る）/ `walk`（よちよち歩く。足・腕・体を `--mascot-step` の間隔で揺らす）/ `swing`（座って足をぶらぶらさせる）、既定 `float`）/ `look`（`front` / `left` / `right` / `up` / `down`）は `act` より優先する。`prop`（`MASCOT_PROPS`: `none` / `laptop`（ノートパソコン。顔が画面の光で色づき、記号が浮かぶ）/ `book`（本。目が行を追う）/ `mug`（右手のマグカップ。湯気が立つ）/ `magnifier`（右手の虫めがね）/ `notes`（頭のまわりに音符）、既定 `none`）で小物を持たせる。`size`（幅 px、既定 120）/ `stand`（足元の STEP の台、既定 `true`）/ `say`（右に出す吹き出し）/ `label`（渡すと `role="img"` の代替テキストになり、なければ飾りとして隠す）。値の一覧は `MASCOT_MOODS` などの配列。ダッシュボードのヒント（`lib/tips.ts`）は 1 件ずつ言葉に合う `act` を持ち、ダッシュボードでは `pose="wave"` で手を振り続ける |
| `WalkingMascot` | コースページ（教材タブ）を歩き回る `Mascot`。通常モードと Moodle モードのすべてのコースフォーマット（トピック・折りたたみ型トピック・タイル）に置く。足場は `client.ts` の `WALKER_GROUNDS` に挙げた要素の上辺（ヒーロー画像 `.course-hero-cover` と、見えている最初のセクションのカード。タイル形式で全体のセクションがなければ最初のタイル）で、その上に乗って左右に歩き、ときどき屈んでから放物線を描いて別の足場へ跳び移る（上へ跳ぶときはたまに宙返りする。見えていない足場へは跳ばない）。最初に現れる足場もランダム。置き場所は `client.ts`（`initWalkers`）が描いたあとに決める。角の丸みの分だけ端を空け、戻るリンク・タブ・編集モードのスイッチ・「すべて開く／閉じる」など（`WALKER_WALLS`）は壁にして通り抜けない。歩く・走る・虫めがねで探しながら右へ歩くのあいだに、`WALKER_ACTIVITIES` から重み付きで選んだ動作（座ってパソコンでコーディング（終わると跳ねて喜ぶ）・本を読む・コーヒーを飲む・足をぶらぶらさせる・音符を出して踊る・眠る・考える・立ち止まる）をする。座ると（`data-sitting`）胴が上辺に乗り、足が足場の前に垂れる。壁にぶつかると驚き、マウスが近づくと手を振り、クリックでハートを出して跳ね、ドラッグでつまんで離すと近い足場（下の足場を優先）に落ちて着地する。レイアウトが変わったときも足場に乗り直す。動きを減らす設定では歩かずに立っているだけ |

`Mascot` は全部の表情・腕を描いておき、ルート要素の `data-mood` / `data-pose` / `data-motion` / `data-look` で CSS が出し分ける。表示後に `client.ts` から `el.dataset.mood = 'happy'` と書き換えるだけで切り替わる（腕と視線はトランジションで動く）。`say` を渡すと吹き出しが開き、`client.ts`（`typeMascotSay`）が文字を 1 文字ずつ出す（`data-typing`）。打っているあいだは口が動き（`data-talking`）、句読点では間を置いて口を止め（`data-hush`）、「！」で言い終えると跳ねる。読み上げ用には全文を `sr-only` で置く。ほっぺ・左腕・右上の角は CSS で常に小さく揺れる。機械的に見えないよう、`client.ts`（`initMascots`）が `[data-mascot]` ごとにランダムな間隔で、まばたき（`data-blink`、ときどき 2 回）・視線（`data-glance`）・気まぐれな動作（`data-quirk`: `hop` / `lean-l` / `lean-r` / `squish` / `peek` / `tap`）・一瞬の表情（`data-mood` を驚き・笑顔・考え顔にして戻す）を付け外しする。気まぐれな動作は `.mascot-actor` で動かすので `data-motion` と重なる。これらは `transform` ではなく `translate` / `scale` / `rotate` で動かしているので、表情やポーズの `transform` と重なっても打ち消し合わない。色は `.mascot` の `--mascot-ink` / `--mascot-ring` / `--mascot-face` / `--mascot-eye` / `--mascot-cheek` で上書きできる。

```tsx
<Mascot act="cheer" say="その調子！" />
<Mascot act="think" look="left" say="どうしてだろう？" />
<Mascot mood="sleepy" motion="none" stand={false} size={64} label="眠っている STEP のキャラクター" />
```

### コード — `src/components/code.tsx`

| 部品 | 用途 |
| --- | --- |
| `CodeInput` | コードの入力欄。`src/code-editor.ts` が中の textarea を VS Code に寄せた CodeMirror のエディターに置き換える（行番号・色分け・かっこの補完・打つと出る候補・折りたたみ・検索と置換・複数カーソル（Alt + クリック、⌘ / Ctrl + D）・構文の誤りの赤い波線・Tab でカーソル位置に字下げ）。候補は、JavaScript ではブラウザの window・document の名前、HTML では Emmet の略記（`ul>li*3`。タグ名でないただの単語は出さない）。ファイルのタブで並べたとき（`CodeWorkspace` / `CodeStarterCard`）は、HTML の `class` / `id` に CSS のクラス名・id、CSS のセレクターに HTML のクラス名・id、JavaScript の `getElementById` / `querySelector` / `classList` の文字列に HTML の id・クラス名も出す。Shift + Alt + F で Prettier による整形（HTML / CSS / JavaScript。Prettier は整形するときに読み込む）、⌘ / Ctrl + S は書きかけのコードの保存（`CodeWorkspace`）。`syntax`（`html` / `css` / `js` / `py` / `text`）/ `rows`（最低の高さ）/ `fill`（親の高さいっぱいに広げ、枠を消す）。送信されるのは textarea（`name`）の値で、書き換えるたびに textarea に `input` イベントが出る |
| `CodeEditorTools` | ファイルのタブの帯（`CodeWorkspace`）とカードの見出し（`CodeStarterCard`）に置く、整形のボタン（Web だけ。`data-code-format`、表示中のファイルを整形する）とキーボードショートカットの一覧（`Popover`。Mac では `code-editor.ts` がキーを ⌘ / ⌥ / ⇧ の表示に替える。タッチ端末では隠す） |
| `CodeField` | ラベル・エラー・ヒント付きの `CodeInput`（`label` / `name` / `syntax` / `value` / `rows` / `error` / `hint`）。コードを受け取る入力欄では `TextAreaField` ではなくこれを使う |
| `CodeStarterFields` / `CodeGradingFields` / `CodePeriodFields` | Moodle モードの種類ごとの入力欄（`extra-kinds.tsx`）で使う「最初のコード」（言語ごとのファイルと、Python の入力の例）・「判定」（制約と補足。制約の欄は `CodeGradingCard` と同じもの）・「提出の期間」の欄。1 枚のカードの中に並べるので、カードではなく fieldset で包む |
| `CodePeriodCard` | 通常モードの編集画面の右の列に置く「提出の期間」のカード（開始日時 `opens_at`・終了日時 `closes_at` の `datetime-local`。どちらも必須で、長さは `MAX_SUBMIT_PERIOD`（24 時間）まで）。期間の外は提出だけを止め、問題とエディターは開ける |
| `CodeSuggest` / `CodeStarterCard` / `CodeGradingCard` | 通常モードの編集画面の部品。`CodeSuggest` は問題のカードの一番下に置く、問題文から最初のコードと制約の下書きを AI に作らせる 1 行（`action` に問題文を送り、`code-editor.ts` が返ってきた最初のコードと制約を同じフォームの欄に入れ、最初のコードのカードまで移動する）。`CodeStarterCard` はファイルのタブで切り替えるエディターと、Web なら学生に見えるページのプレビューを横に並べたカード（「ひな形に戻す」付き。エラーのあるファイルのタブを最初に選び、ブラウザの検証でエラーが出たときは `client.ts` がそのタブに切り替える）。`CodeGradingCard` は「判定」のカードで、制約（1 行ずつ、学生にも見せるラベル `constraint_label[]` と、AI だけが使う判定の内容 `constraint_text[]`（空ならラベルで判定）。1 つ以上が必須。エラーは fieldset の `constraints` に出す）と補足の欄。開発サーバーでは `judge` を渡すと、制約の判定をするもの（AI / Jev）の切り替えを出す |
| `CodeBarActions` | ヘッダーの帯（`ItemBar`）に置く、提出の一覧への入口（教師）と、提出の状況（「クリア」「3 / 4 クリア」「判定中…」。押すと右の枠の提出のタブを開く）・提出ボタン（学生、`submissions`）。続けて提出できないあいだは、提出ボタンを押せなくして「あと 42 秒」と出し、`code-editor.ts` が数え直す |
| `CodeSubmissions` / `VerdictList` | 学生の提出のタブの中身（次に提出できるまでの残り・完了の状態・いちばん新しい提出の判定・開いて判定を見られるこれまでの提出）と、制約ごとの ○ / △ / × と理由の一覧（学生にはラベルだけ、`VerdictList` に `showText` を付けた教師の提出画面では判定の内容も出す。Jev の判定は理由の代わりに確からしさを出す）。判定中は `code-editor.ts` が終わりを待ち、タブの中身とヘッダーの帯の表示を取り直す |
| `CodeWorkspace` | コードのアイテムの本体（`AppShell` の `topbar` と一緒に使う）。ヘッダーの下いっぱいに置き、ページはスクロールしない（下に本文や前後のアイテムを置かない）。左に問題文と「クリアの条件」（`goals`、制約のラベル）とファイルのタブ付きのエディター、右にプレビューとコンソール（Web）か入力と実行結果（Python）。学生には `submissions`（`lib/code-grader.ts` の `submissionsOf`）を渡し、右の枠を「プレビュー / 提出」のタブにする（判定中は提出のタブから始める。`completion` は提出のタブに出す完了の状態）。コードはサーバーで描かず、`code-editor.ts` が `${base}/state` から読み込み、書きかけのコードを `${base}/draft` に自動で保存する。提出は `CODE_FORM` のフォームの送信（ヘッダーの帯のボタンに `form={CODE_FORM}` を付ける） |

### ファイル自動配布 — `src/components/bundle.tsx`

| 部品 | 用途 |
| --- | --- |
| `BundleOpen` | ファイル自動配布のアイテムの画面の本体。「VS Code で開く」（`data-vscode-launch` のフォームで、`client.ts` が鍵付きの `vscode://` のリンクを受け取って開く）・拡張機能の案内・データの同期の案内と変更履歴への入口（`sync`。`lib/bundle-sync.ts` の `syncStateOf` で作る）・zip のダウンロード・配るファイルの木。ファイルがなければ空の表示（`editHref` を渡すと教師向けのアップロードへの入口） |
| `BundleEditPanel` | 編集画面の、配るファイルのアップロード（フォルダー・ファイルの選択とドラッグ＆ドロップ。`client.ts` がフォルダーの中の場所を `paths` として一緒に送る）と削除ボタン付きの木、その下の「データを同期する」の切り替え（`${base}/sync` へのフォーム）。保存のフォームの外に置く（通常モードの `ItemEditPage` と、Moodle モードの `ExtraKind` の `Panel`） |
| `BundleTree` | 配るファイルのフォルダーの木（`files`、`deleteAction` を渡すと行ごとの削除ボタン） |

### AI アシスタント — `src/components/ai-panel.tsx`

| 部品 | 用途 |
| --- | --- |
| `AiPanel` | 右に出す AI のパネル。`AppShell` が `c.var.aiPanel`（通常モードは `app.tsx`、Moodle モードは `moodle-mode/app.tsx` で設定。AI を使えない利用者には設定しない）を呼んで、本文の後ろに置く。会話は描いた時点のものをサーバーが出し、そのあと `client.ts` が `template[data-ai-template]` を複製して書き足す（`data-keep` があるので、再読み込みなしの遷移では中身を差し替えない）。送信は `/ai/chat` への POST で、応答は NDJSON（`lib/ai-agent.ts` の `AiAgentEvent`）で届いた分から出す。AI が確認の要るツールを呼ぶと、会話に確認カード（変更前と変更後。複数行の文章は `lib/diff.ts` の差分）を出し、「実行する／取り消す」は `/ai/chat/confirm` への送信で、応答は同じく NDJSON で流れる。カードを出したあとや送信のあとは、`client.ts` が `/ai/chat`（パネルだけのページ）を取り直して、サーバーの描いたものに置き換える。ヘッダーには今のモデルを出し、入力欄の下の「難しい依頼」（`data-ai-hard`、`aria-pressed`）を押すと、`client.ts` がヘッダーのモデル名と送信する `hard` を切り替える（任せる先は `lib/ai-models.ts` の `AI_HARD_TASK_MODELS`。チャットを開き直したときは、最後の発言で選んでいたかを出す）。開閉は端末ごとの設定（`aiPanel`）で、`<html data-ai-open>`。幅 1100px 以上では本文を狭めて横に並べ、それより狭いと本文に重ねる |
| `AiPanelToggle` | ヘッダーの右に置く開閉ボタン |

### PDF — `src/components/pdf.tsx`

| 部品 | 用途 |
| --- | --- |
| `PdfBar` | PDF のアイテムで `AppShell` の `topbar` に渡す帯（パンくず・タイトル・「ビューアー / ブラウザ」の切り替え・`children` の操作ボタン）。帯そのものは `components/course.tsx` の `ItemBar`（`type` か `icon`（種類のアイコンの代わり。Moodle モードの `KindIcon` など）/ `crumbs` / `title` / `hiddenNote` / `children`）で、アイテムを画面いっぱいに出すほかの画面（コード・アイテムの編集画面）もこれを使う。切り替えは保存せず、`client.ts` がその場で `PdfStage` の中身を入れ替える（開いているあいだは再読み込みなしの遷移でも保ち、再読み込みすると既定のビューアーに戻る） |
| `PdfStage` | ヘッダーの下いっぱいの PDF 表示。既定は pdf.js の自作ビューアー（`src/pdf-viewer.ts`。`client.ts` が PDF のある画面でだけ読み込む）、ブラウザを選ぶと iframe でブラウザ標準のビューアー（サーバーは両方を描き、iframe は選ばれるまで `hidden` のまま `src` を入れない）。ビューアーは左にページのサムネイルの一覧を出し（ツールバーの左端のボタンで開閉。開閉は端末ごとの設定（`pdfThumbs`）に保存し、スマホ幅では閉じた状態から始めてページに重ねて出す）、今のページを `aria-current` で示す |

ログイン前の画面（`AuthShell`）の右側は、`src/auth-art.ts` が three.js で描く 3D アニメーション（背景は無地で、台座の上で小さなキューブが 14 種類の形（ロケット・ネコ・家・アイスクリームなど。`MODELS`）に組み上がっては組み替わる。クリックでつつくとキューブが弾け、3 回続けると次の形へ。ドラッグで回せる）。`data-auth-art` の要素に `client.ts` が canvas を置き、再読み込みなしの遷移では同じ canvas を新しい要素へ移して続きから動かす。色は `--art-deep` / `--art-mid` / `--art-bright` / `--art-shine` とコースの色（`tone-*`）を読み取る。スマホ幅（非表示）では three.js を読み込まない

クラス名を条件で組み立てるときは `components/cx.ts` の `cx('a', cond && 'b')` を使う。

### 部品を足す・直すとき

- 2 か所以上で同じマークアップを書いたら部品にする。置き場所はボタンなら `button.tsx`、入力なら `form.tsx`、箱や表なら `card.tsx`、ダイアログやメニューなら `overlay.tsx`、その他の表示は `ui.tsx`、コース専用なら `course.tsx`
- 見出しは `title` ではなく `heading` で受ける（`title` は HTML のツールチップ属性とぶつかる）
- 見た目の違いは `variant` / `size` / `tone` のような文字列リテラルのユニオンで受け、CSS の修飾クラス（`btn-primary` など）に対応させる。真偽値を何個も並べない
- 残りの属性は `...rest` で要素に渡し、型は `JSX.IntrinsicElements['button']` などと交差させる（`data-*` や `aria-*` をそのまま受けられる）
- 部品が出すクラスは `src/client.ts` も参照している（`btn-success` の切り替え、`data-toggle-password` など）。名前を変えるときは `client.ts` も検索する
- 部品を足したら、この表にも追記する

アイテムの編集画面（通常モードの `routes/content/views.tsx` と Moodle モードの `moodle-mode/views.tsx` の `ItemEditPage`）は、`AppShell` の `topbar` に `ItemBar` を渡し、その `children` に `components/course.tsx` の `ItemEditActions`（「編集中」・表示・保存（`ITEM_FORM` のフォームを送る）と、削除を入れた「その他の操作」）を置く。本文は `content.css` の `.item-editor` で、横幅いっぱい（最大 1920px）のグリッドの左の列にカード（`editor-main` / `editor-extra`）、右の列（`editor-side`）に設定のカードを置く。右の列はスクロールしても見えたまま止まり、画面より高ければその中だけスクロールする。幅 900px 以下では 1 列にして、設定を最後に回す。ファイルのアイテムの今のファイルと差し替えの欄は `ItemFileField`（幅があれば横に並べる）。Moodle モードのアクセス制限の画面は、従来の `.editor-head` / `.editor` のまま

`src/components/layout.tsx` の `AppShell`（ログイン後。コース配下の画面では `tone` にコースの色を渡す。`topbar` に中身を渡すとヘッダーにその画面の見出しや操作を置き、レールを畳んで本文をヘッダーの下いっぱいに広げる。例は PDF のアイテム）/ `AuthShell`（ログイン前）で必ず包む。コース配下の画面は `components/course.tsx` の `CourseHeader` でタブを出す。

アイコンは `<Icon name="..." size={16} />`（`components/icons.tsx`）。使える名前は `svgs` のキー。アイコンは [Heroicons](https://heroicons.com/) の 24px outline だけを使い、足すときは devDependency の `heroicons` から `import foo from 'heroicons/24/outline/<名前>.svg?raw'` で読み込んで `svgs` に加える（ビルド時に文字列として埋め込まれるので、実行時の依存は増えない）。パスを手書きしたり、外部のアイコンフォントや画像を使ったりしない。

## よく使う CSS クラス

- レイアウト: `stack` `stack-lg`（縦並び）、`row`、`grid-2`、`toolbar`、`form-actions`
- 戻るリンク: `back-link`（`<a href="/courses" class="back-link"><Icon name="chevronLeft" size={16} />コース一覧</a>`。コースヘッダーの上に置く、親へ戻るだけの小さなリンク。粗いポインターでは高さが `--tap` になる）
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
- 文字の大きさは `--fs-xs`（12px）/ `--fs-sm` / `--fs-base` / `--fs-md` / `--fs-lg` / `--fs-xl` / `--fs-2xl` / `--fs-3xl`（ページの見出し）/ `--fs-display`（数字）から選ぶ。数値を直接書かない（例外は、iOS の拡大を避ける入力欄の 16px と、ロゴ・`kbd` のような部品固有の大きさ）
- 白い面（カード・タイル・表など）は `border: 1px solid var(--card-border)` と `box-shadow: var(--shadow-card)` で背景から分ける。ホバーで持ち上げるのは `@media (hover: hover)` の中で `--border-strong` ＋ `--shadow` ＋ `translateY(-1px)`
- 状態色を文字に使うときは `--danger-text` / `--success-text` / `--warning-text` / `--info-text`（`--danger` などは背景や枠用。白地で文字にすると薄い）。塗りのボタンは `--danger-strong` / `--success-strong`
- フォーカスは全体の `:focus-visible`（`--focus` の outline）に任せる。入力欄は `border-color: var(--focus)` と `box-shadow: var(--ring-field)`、角丸の小さな部品のリングは `var(--ring)`
- トークンを足すときは `:root` と `:root[data-theme='dark']` の両方に定義する。ダークモードは OS の設定ではなく、利用者がヘッダーのユーザーメニューで選んだときだけ（端末ごとの設定の `theme` → `<html data-theme>`。サーバーは常にライトで描き、`renderer.tsx` の `<head>` の小さなスクリプトが描画前にダークへ切り替える）。ダーク用の上書きは `[data-theme='dark'] .foo` で書き、`prefers-color-scheme` は使わない。ダークモードで必ず見た目を確認する
- 薄い色は `color-mix(in srgb, var(--primary) 12%, transparent)` で作る
- コースの色は `tone-${color}` クラスと `--c1` / `--c2` を使う
- 選択中のタブ・メニュー・セクション番号など「今いる場所」の色は `--c-ink`（文字）/ `--c-soft`（背景）を使う。コースの外ではブランドのシアン、`AppShell` に `tone={access.course.color}` を渡したコース配下の画面ではそのコースの色になる。主ボタンは `--primary`（ライトでは黒）のまま
- `--primary` の塗りは主ボタンとスイッチのオンだけに使う。切り替え（`SegmentedControl` / Markdown エディターの `md-modes`）は `--track` ＋ `inset` の `--track-border` のトラックに、つまみ（`--thumb` ＋ `--shadow-sm` ＋ `inset` の `--card-border`）、現在地（`Tabs` / 目次 / レール）は `--c-soft` で示す
- 見出しの段は「ページタイトル `--fs-3xl` → カード・セクションの見出し `--fs-lg` → 行のタイトル `--fs-md` → 本文 `--fs-base` → メタ `--fs-sm` / `--fs-xs`」の 5 段にする。間の大きさを新しく作らない
- 操作部品（入力欄・チェック・スイッチ）の輪郭は `--field-border`、ほかの面の上に重なる面は `--surface-raised`（輪郭は `--overlay-border`）を使い、粗いポインター（`@media (max-width: 640px), (pointer: coarse)`）でのタップ領域は `--tap` 以上にする
- `:hover` は `@media (hover: hover)` の中に書く（タッチ端末でタップ後にホバーの見た目が残らないように）。押下（`:active`）のフィードバックは `base.css` の `@media (hover: none)` にまとめる（背景は `--press`、カード類は `scale(0.985)`）。ボタンの押下は `button.css` にある
- 入力欄（1 行入力・`select`・`textarea`・Markdown エディター・画像プレビュー）の角丸は `--radius-field`、ボタン・タブ・検索欄・Segmented はピル（`999px`）にする
- 用語: コースの中身のまとまりは「教材」、1 件の単位は「アイテム」と呼ぶ
- スマホ対応は既存のブレークポイント（`max-width: 640px` / `900px`）に合わせる
- 関係する既存ブロック（`/* ===== */` の見出しで区切られている）の近くに追記する
- クラス名は kebab-case で、`ブロック-要素` の形（`course-card` `course-title`）。状態は `is-done` `active` `has-error`

### デザイントークン（`src/styles/base.css`）

| 用途 | トークン |
| --- | --- |
| 面 | `--bg`（ページの背景）/ `--chrome`（トップバー・レール）/ `--surface`（カード・表）/ `--surface-2` / `--surface-3`（一段沈んだ面・ホバー）/ `--surface-raised`（ポップオーバー・モーダル・ダイアログ・トースト・スマホのドロワー。ダークでは影の代わりに `--surface` より明るくして高さを示す） |
| 線 | `--border` / `--border-strong`（区切り線・ホバー時の枠）/ `--card-border`（白い面の輪郭）/ `--field-border`（入力欄・チェック・スイッチなど操作部品の輪郭。背景に対して 3:1 以上）/ `--overlay-border`（`--surface-raised` の面の輪郭）/ `--control-border`（枠だけのボタンの輪郭。ダークでは半透明の白）|
| 操作部品の面 | `--control-bg`（枠だけのボタンの面。ライトは `--surface`、ダークは半透明の白でカードから浮かせる）/ `--track` / `--track-border`（Tabs・Segmented・`md-modes` のトラック。半透明なのでどの面の上でも一段沈んで見える）/ `--thumb`（Segmented・`md-modes` の選択中のつまみ）/ `--press`（タッチ端末での押下の背景）/ `--success-strong-hover` / `--danger-strong-hover`（`--success-strong` / `--danger-strong` の塗りのホバー・押下） |
| 文字 | `--text` / `--text-2` / `--muted`（メタ情報）/ `--on-primary`（`--primary` の上）/ `--on-strong`（`--danger-strong` / `--success-strong` の塗りの上。両テーマとも白） |
| 中立色の値 | ライト: `--bg #eceef0` `--chrome #f6f7f9` `--surface-2 #f5f6f8` `--surface-3 #e9ecef` `--border #e7e9ec` `--border-strong #d5d9de` `--text-2 #363a41` `--muted #60656d`。ダーク: `--bg #0a0b0d` `--chrome #141518` `--surface #16171a` `--surface-2 #1e1f23` `--surface-3 #2a2b30` `--border #26282c` `--border-strong #36383d` `--text #eceef1` `--text-2 #c3c6cc` `--muted #8e9299`（どちらもわずかに寒色に寄せてそろえている。灰色を足すときもこの温度に合わせる） |
| 寸法 | `--control-h` / `--control-h-sm`（スマホ幅では 40px）/ `--control-h-lg`、`--tap`（44px。粗いポインターでの最小タップ寸法）、`--radius-sm` / `--radius` / `--radius-lg` / `--radius-field`（入力欄の角丸。12px）、`--brand-mark`（ロゴの幅と高さ。`layout.css` がトップバーの左余白の計算に使う） |
| コースの色 | `tone-*` が `--c1` / `--c2` / `--c-on`（塗りの上の文字。既定は白）/ `--c-deep`（白文字を載せても 4.5:1 になる塗り。黒文字のトーンでは `--c1`。頭文字のバッジ `.dot` やダッシュボードのタイルに使う）/ `--c-ink` / `--c-soft` を決める |

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
- ダッシュボード・レールのマイコースには、サーバーが進行中のコースだけを描く。コース一覧には、参加しているコースのうち開始前のもの（教師として登録しているコースは除く）以外を描き、管理者にはすべてのコースを描く。コース一覧の絞り込み（「進行中 / すべて」と管理者の「登録外も表示」）は端末ごとの設定で、`client.ts` が端末ごとの設定（`coursesAll` / `coursesOthers`）から `<html>` に `data-courses-all` / `data-courses-others` を付け、`base.css` が `data-course-ended` / `data-course-unenrolled` の要素を隠す。サーバーは候補のコースをすべて描き、件数や空の表示は既定（進行中・参加しているコースだけ）で描く。件数は `[data-course-list]` の中の `[data-course-count]`、絞り込みで空になったときの案内は `[data-courses-empty]` に置くと `client.ts` が合わせる
- コースの内容を見せる画面（コースページ・アイテム）には `components/course.tsx` の `CourseLiveSync` を置く。`client.ts` が 10 秒ごとにコースの版（`lib/courses.ts` の `courseRevision`。`/courses/:id/` 配下の POST で進む）を確かめ、変わっていたら同じ URL を取り直して、前回描いた内容との差分だけを `<main>` に当てる。入力中の欄・開いているポップオーバーやモーダル・再生中の動画を含む部分は、使い終わるまで差し替えない。描画前に版を読むこと（読み出しの後だと変更を取りこぼす）
- body を差し替えても `<script>` は実行されないので、専用スクリプトを読み込むページは自動で通常の読み込みになる。毎回の表示で必要な初期化は `client.ts` の `initPage()` に足す
- 入力欄には `label`、アイコンボタンには `aria-label`、状態は `aria-pressed` / `aria-invalid` で伝える
- 文言はすべて日本語

## クライアント JS（src/client.ts）

- データを変える操作はフォーム送信で作り、`client.ts` で画面遷移なしに反映する。テーマのような表示だけの状態は端末ごとの設定に保存し、`client.ts` が読んで表示を切り替える（POST のルートは作らない）
- 要素には `data-*` 属性で目印を付け、`document` へのイベント委譲で拾う（要素ごとに addEventListener しない）
- 区切りは `// --- 何の処理か` の見出しに合わせる
- `fetch` するときは `Accept: application/json` を付け、サーバー側は `wantsJson(c)` で分岐する（`add-page` スキル参照）
- 失敗したら元の状態に戻し、`toast('〜できませんでした。', 'error')` を出す
- 端末ごとの設定は `lib/settings.ts` の `getSetting('theme')` / `setSetting('editMode', true)` / `updateSetting('collapsedSections', (ids) => …)` で読み書きする。中身は localStorage の `settings` 1 つに JSON でまとめて保存する。項目を足すときは `SETTINGS` のスキーマに `.catch(既定値)` 付きで足す（キー名と値の型が補完・型チェックされる）。localStorage を直接触るキーを新しく作らない
- それ以外で `localStorage` を使うときは try/catch で包む
- ライブラリは入れない。`alert` / `confirm` は使わず、確認は `data-confirm` の独自ダイアログを使う

## 確認

- ライト / ダークの両方
- スマホ幅（375px 前後）でレイアウトが崩れない・横スクロールが出ない
- UI を変えた PR にはスクリーンショット（Before / After）を付ける
