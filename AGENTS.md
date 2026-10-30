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
- データを変える操作はフォーム送信（POST → 303 リダイレクト）で作り、`src/client.ts` が再読み込みなしの遷移にする。クライアント JS は `src/client.ts` の 1 ファイル（例外は、使う画面でだけ `client.ts` が動的に読み込む `src/markdown-editor.ts`）
- 権限がないリソースは 403 ではなく `c.notFound()` を返す（存在を知らせない）
- 入力の検証は `src/lib/forms.ts` の zod スキーマに書き、サーバー（`validate`）とクライアント（フォームの `validateWith`）で同じものを使う。HTML の `required` / `maxlength` などは書かない
- DB の読み書きは Drizzle のクエリビルダーで書く。生 SQL の文字列は書かず、`sql` テンプレートを使うときも値を文字列連結しない
- 既存のマイグレーションは編集しない。スキーマは `src/lib/schema.ts` を変えて生成する
- ランタイム依存を増やさない。Web 標準 API・Node 標準モジュール・既存の依存で済ませる
- 画面の文言・メッセージは日本語
- コードコメントは「なぜ別の方法を採らないか」だけを書く。何をしているかの説明コメントは書かない
