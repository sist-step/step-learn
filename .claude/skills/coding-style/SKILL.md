---
name: coding-style
description: "StepLearn の TypeScript / TSX の書き方（書式・命名・型・import・コメント・エラーメッセージ・依存の追加方針）。src/ や scripts/ のコードを新規作成・修正・リファクタリングするときは、種類を問わず書き始める前に必ず読み込む。「実装して」「直して」「追加して」「リファクタして」などコードを書く依頼すべてが対象。"
---

# コーディングスタイル

既存コードと見分けがつかないコードを書くこと。迷ったら同じディレクトリの近いファイルを読んで真似る。

## 書式

TS・TSX・JSON・YAML は Prettier（`.prettierrc.json`）で整える。書いたら `npm run format` をかけ、手で整形しない。設定はインデント 2・セミコロンなし・シングルクォート・末尾カンマあり・140 文字。

CSS は 1 行にまとめたルールを残すため Prettier の対象外（`.prettierignore`）。`.editorconfig` に合わせて手で書く。

lint は oxlint（`.oxlintrc.json`）。ルールを止めるときは `// oxlint-disable-next-line <ルール> -- <理由>` と理由を書く。

Prettier では決まらないもの:

- 数値リテラルは桁区切りを使う: `600_000`、`10_000`

## import

- 相対パスで書き、拡張子は付けない（パスエイリアスはない）
- 型だけなら `import type`。値と混ざるなら `import { foo, type Bar }`
- 外部パッケージ → `../components` → `../lib` の順に並べる

## 命名

| 対象 | 規則 | 例 |
| --- | --- | --- |
| 変数・関数 | camelCase | `getCourseAccess`、`redirectWith` |
| コンポーネント・型 | PascalCase | `PageHeader`、`CourseAccess` |
| モジュール定数 | UPPER_SNAKE | `SESSION_TTL`、`MAX_FILE_SIZE` |
| DB の行を表す型のプロパティ | schema.ts と同じ camelCase | `enrollKey`、`createdAt` |
| Drizzle スキーマのプロパティ | camelCase（カラム名は snake_case で指定） | `enrollKey: text('enroll_key')` |
| 表示ラベルの対応表 | `XXX_LABELS: Record<Union, string>` | `ROLE_LABELS` |

## 型

- `type` を使う。`interface` は複数の実装を差し替える場合だけ（`Mailer`、`Storage`）
- 列挙は文字列リテラルのユニオン。`enum` は使わない
- 値の集合は `as const` の配列: `COURSE_COLORS`
- ハンドラでは `Hono<AppEnv>` と `Context<AppEnv>` を使う
- `requireAuth` を通したあとは `c.var.user!` でよい
- 外部入力の絞り込みは型ガード: `const isCourseRole = (r: string): r is CourseRole => ...`
- `any` は使わない。DB の結果は `.first<T>()` / `.all<T>()` で型を付ける

## 関数とモジュール

- 小さなヘルパーは `const f = (...) => ...`、複数行に及ぶ処理や公開 API は `function` / `async function`
- 差し替え可能な外部サービスは「interface ＋ 実装クラス ＋ config で選んだシングルトンを export」の形にする（`lib/mail.ts`、`lib/storage.ts`）
- 環境変数を読むのは `lib/config.ts` だけ。追加したら `.env.example` と README の「本番運用」も更新する
- 日時は UNIX 秒（整数）で扱う。表示は `formatDate`（Asia/Tokyo）
- 処理の完了を待たなくてよい後片付けは `inBackground(...)` に渡す

## コメント

- コードコメントには「なぜ別のやり方を採らないか（Why not）」だけを書く
  - 良い例: `// 起動ごとにランダム生成しないのは、再起動のたびに全員がログアウトされるのを避けるため`
  - 良い例: `// 先頭はクライアントが自由に書けるので、直前のプロキシが追記した末尾を使う`
  - 悪い例: `// ユーザーを取得する`、`// ループで回す`（コードを読めばわかる）
- 処理の中身はコードで表現する。コメントで補いたくなったら、変数名・関数名・分割を見直す
- 大きなルートファイルにある区切りコメント（`// ---------------------------------------------------------------- 作成`）は、同じファイルに処理を足すときに合わせてよい
- コメントは日本語

## 文言

- 画面に出す文言はすべて日本語
- バリデーションエラー: 「〜を入力してください。」「〜が正しくありません。」（句点あり）
- 完了トースト: 「〜しました。」「「${title}」を削除しました。」
- 人名は「${name} さん」
- 設定ミスで起動を止めるときは日本語メッセージで `throw new Error(...)`

## 依存

- ランタイム依存は増やさない。まず Web 標準（`crypto.subtle`、`Intl`、`URL`、`fetch`）と Node 標準モジュールで書けないか考える
- どうしても必要なら、理由を PR に書き、README の「依存の少なさ」の行も更新する
