# STEP Learn

Hono（hono/jsx の SSR）＋ SQLite（better-sqlite3 / Drizzle）で動く軽量 LMS。概要と運用は README.md、開発ルールは CONTRIBUTING.md を参照する。

## コマンド

```sh
npm run dev        # http://localhost:5173（data/ に DB が自動作成される）
npm run typecheck  # 型チェック
npm run lint       # oxlint（型情報を使うルールも含む）
npm run format     # Prettier で整形（CI は format:check）
npm run build      # dist/ を生成。CLI（user:create）もこれで作られる
npm run db:generate  # schema.ts からマイグレーションを生成
npm run db:check     # マイグレーションの整合性を確認（CI と同じ）
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
| TypeScript / TSX を書く・直す（常に） | `coding-style` |
| 画面・ルート・フォームの追加や変更 | `add-page` |
| テーブル・カラムの追加、DB を読み書きする | `db-change` |
| 見た目・CSS・UI 部品・クライアント JS | `ui` |
| 実装を終えて報告する前 | `verify` |
| コミット | `commit` |
| PR を作る | `create-pr` |

## 守ること（要点）

- JavaScript は必須。無効な環境では全画面で「JavaScript を有効にしてください」だけを出す（`src/renderer.tsx` の noscript）ので、JS なしの代替は作らない
- データを変える操作はフォーム送信（POST → 303 リダイレクト）で作り、`src/client.ts` が再読み込みなしの遷移にする。クライアント JS は `src/client.ts` の 1 ファイル（例外は、使う画面でだけ `client.ts` が動的に読み込む `src/markdown-editor.ts`・`src/code-editor.ts`・`src/auth-art.ts`・`src/pdf-viewer.ts`）
- 権限がないリソースは 403 ではなく `c.notFound()` を返す（存在を知らせない）
- 入力の検証は `src/lib/forms.ts` の zod スキーマに書き、サーバー（`validate`）とクライアント（フォームの `validateWith`）で同じものを使う。HTML の `required` / `maxlength` などは書かない
- DB の読み書きは Drizzle のクエリビルダーで書く。生 SQL の文字列は書かず、`sql` テンプレートを使うときも値を文字列連結しない
- 既存のマイグレーションは編集しない。スキーマは `src/lib/schema.ts` を変えて生成する
- 画面の文言・メッセージは日本語
- コードコメントは「なぜ別の方法を採らないか」だけを書く。何をしているかの説明コメントは書かない
