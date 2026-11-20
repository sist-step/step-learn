# STEP Learn

Hono（hono/jsx の SSR）＋ SQLite（better-sqlite3 / Drizzle）で動く軽量 LMS。概要は README.md、運用は docs/、人向けの開発の流れは CONTRIBUTING.md にある。AI エージェント向けの規則の正本はこのファイルと `.claude/skills/` で、ほかの文書に書き写さない。

## コマンド

```sh
npm run dev        # http://localhost:5173（data/ に DB が自動作成される）
npm run typecheck  # 型チェック
npm run lint       # oxlint（型情報を使うルールも含む）
npm run format     # Prettier で整形（CI は format:check）
npm run build      # dist/ を生成。CLI（user:create）もこれで作られる
npm run db:generate  # schema.ts からマイグレーションを生成
npm run db:check     # マイグレーションの整合性を確認（CI と同じ）
npm run dev:users    # 開発用のユーザー admin / teacher / student を作る（パスワードはユーザー名と同じ）
npm run docs:index -- --docs ../step-docs/src/content/docs --out ai-docs  # AI エージェントが検索する STEP Docs の索引を手元に作る（本番は step-docs のワークフローが作る）
```

テストフレームワークはない。完了の基準は `typecheck`・`lint`・`format:check`・`build` が通り、変更した画面を実際に動かして確かめたこと。

## 作業の進め方

- `master` に直接コミットしない。`feature/` `fix/` `chore/` `docs/` のブランチを切る
- ファイルを編集する作業は worktree で行う（複数のセッションで並行して作業するため。詳しくは CONTRIBUTING.md の「並行して作業する」）
  - Claude Code では、メインの作業ディレクトリにいるときに編集を伴う依頼を受けたら、最初のファイルを編集する前に `EnterWorktree` で worktree を作って移る。ユーザーに確認しなくてよい。名前は作業内容に合わせて `feature/quiz` `fix/login-redirect` のように付ける（そのままブランチ名になる）
  - 質問への回答や調査だけなら worktree は作らない。調査の途中で編集が必要になったら、その時点で作る
  - すでに worktree の中にいるときは新しく作らない
  - worktree は `origin/master` から作られる。メインの作業ディレクトリの未プッシュのブランチを土台にする作業なら、作る前にユーザーに確認する
  - 開発サーバーは 5173 番（メイン）・5174 番（Moodle 検証環境）を使わず、作成時に表示されたポートで `npm run dev -- --port <番号> --strictPort` を自分で起動する
  - マイグレーションを生成する作業は、同時に 1 つの worktree だけで行う
  - PR を作ったら worktree を削除してメインの作業ディレクトリに戻る（`create-pr` スキルの最後の手順）
- 作業内容に応じて、以下のスキルを**書き始める前に**読み込む。スキルの実体は `.claude/skills/<名前>/SKILL.md`（Codex 向けに `.agents/skills/` からシンボリックリンクしている）

| 作業 | スキル |
| --- | --- |
| 画面・ルート・フォームの追加や変更 | `add-page` |
| テーブル・カラムの追加、DB を読み書きする | `db-change` |
| 見た目・CSS・UI 部品・クライアント JS | `ui` |
| 実装を終えて報告する前 | `verify` |
| コミット | `commit` |
| PR を作る | `create-pr` |

## 守ること

- JavaScript は必須。無効な環境では全画面で「JavaScript を有効にしてください」だけを出す（`src/renderer.tsx` の noscript）ので、JS なしの代替は作らない
- データを変える操作はフォーム送信（POST → 303 リダイレクト）で作り、`src/client.ts` が再読み込みなしの遷移にする
- クライアント JS は `src/client.ts` に書く。重いライブラリを使うものだけ別のファイルにし、使う画面でだけ `client.ts` が `import()` で読み込む。画面が直接読み込むのは画面共有の `src/screen-share.ts` だけで、増やさない
- 権限がないリソースは 403 ではなく `c.notFound()` を返す（存在を知らせない）
- 入力の検証は `src/lib/forms.ts` の zod スキーマに書き、サーバー（`validate`）とクライアント（フォームの `validateWith`）で同じものを使う。HTML の `required` / `maxlength` などは書かない
- DB の読み書きは Drizzle のクエリビルダーで書く。生 SQL の文字列は書かず、`sql` テンプレートを使うときも値を文字列連結しない
- 既存のマイグレーションは編集しない。スキーマは `src/lib/schema.ts` を変えて生成する
- README.md に機能の一覧や仕様を書き足さない。運用の手順は `docs/` か、そのディレクトリの README に、コードからわからない手順だけを書く（分け方は CONTRIBUTING.md の「ドキュメントの置き場所」）

## 書き方

既存のコードと見分けがつかないコードを書く。迷ったら同じディレクトリの近いファイルを読んで真似る。書式は Prettier（`npm run format`）、`any` や型だけの import の書き方は lint が確かめるので、ここには書かない。CSS は Prettier の対象外なので `.editorconfig` に合わせて手で書く。

- lint のルールを止めるときは `// oxlint-disable-next-line <ルール> -- <理由>`
- 数値リテラルは桁区切りを使う（`600_000`）
- import は相対パスで、拡張子を付けない。外部パッケージ → `components` → `lib` → `./views` の順に並べる
- 命名: 変数・関数は camelCase、コンポーネント・型は PascalCase、モジュール定数は UPPER_SNAKE、表示ラベルの対応表は `XXX_LABELS: Record<Union, string>`
- 型は `type` で書く。`interface` は複数の実装を差し替えるときだけ（`lib/mail.ts`、`lib/storage.ts`）
- 列挙は文字列リテラルのユニオンか `as const` の配列で書き、`enum` は使わない
- 外部入力の絞り込みは型ガード（`(v: string): v is ImageExt => ...`）
- 小さなヘルパーは `const f = (...) => ...`、複数行に及ぶ処理や公開 API は `function` / `async function`
- 差し替えられる外部サービスは「interface ＋ 実装クラス ＋ config で選んだシングルトンを export」の形にする
- 環境変数を読むのは `lib/config.ts` だけ。足したら `.env.example` と `docs/production.md` の環境変数も更新する
- 日時は UNIX 秒（整数）で扱い、表示は `formatDate`（Asia/Tokyo）
- 処理の完了を待たなくてよい後片付けは `inBackground(...)` に渡す
- ランタイム依存は増やさない。まず Web 標準と Node 標準モジュールで書けないか考え、どうしても要るなら理由を PR に書く

### コメント

- コードコメントには「なぜ別のやり方を採らないか（Why not）」だけを日本語で書く
  - 良い例: `// 起動ごとにランダム生成しないのは、再起動のたびに全員がログアウトされるのを避けるため`
  - 悪い例: `// ユーザーを取得する`（コードを読めばわかる）
- コメントで補いたくなったら、変数名・関数名・分割を見直す
- 大きなルートファイルの区切りコメント（`// ---------------------------------------------------------------- 作成`）は、同じファイルに処理を足すときに合わせてよい

### 文言

- 画面に出す文言はすべて日本語
- バリデーションエラーは「〜を入力してください。」「〜が正しくありません。」（句点あり）
- 完了のトーストは「〜しました。」「「${title}」を削除しました。」
- 人名は「${name} さん」
- 設定ミスで起動を止めるときは日本語のメッセージで `throw new Error(...)`
