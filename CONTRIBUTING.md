# 開発の進め方

## 必要なもの

- Node.js 24 以上（`.nvmrc` 参照。`nvm use` で切り替えられます）
- npm

```sh
npm install
npm run dev
```

## ブランチ

`master` から作業ブランチを切り、PR でマージします。`master` へ直接 push はしません。

| 種類 | ブランチ名の例 |
| --- | --- |
| 新機能 | `feature/assignments` |
| バグ修正 | `fix/login-redirect` |
| 開発環境・CI・依存関係 | `chore/dev-setup` |
| ドキュメント | `docs/readme-deploy` |

## コミットメッセージ

`種類: 内容` の形で、日本語で簡潔に書きます。

```
feat: 課題の提出機能を追加
fix: 登録キーが空のときに参加できない問題を修正
chore: CI に型チェックを追加
```

種類は `feat` / `fix` / `refactor` / `style` / `docs` / `chore` / `test` のいずれかです。

## プルリクエスト

1. PR テンプレートに沿って概要・動作確認を書く
2. CI（型チェック・ビルド・Docker イメージのビルドと起動・マイグレーションの確認）が通っていることを確認する
3. CODEOWNERS のレビュー承認を得てからマージする

UI を変更した場合はスクリーンショットを添付してください。
DB のスキーマを変える場合は `src/lib/schema.ts` を編集し、`npm run db:generate` で `migrations/` にマイグレーションを生成してコミットしてください（起動時に自動で適用されます）。既存のマイグレーションは編集しないでください。

CI では `npm run db:check` で次の点を確認し、問題があればマージできません。ローカルでも同じコマンドで確認できます。

- ベースブランチで適用済みのマイグレーション（SQL・スナップショット・journal のエントリ）が変更・削除されていない
- 追加したマイグレーションの作成日時が既存のものより新しい（古いと適用済みの DB で実行されない）
- `migrations/` の SQL がすべて journal に載っている
- `schema.ts` とマイグレーションが一致している（`npm run db:generate` のし忘れがない）
- 空の DB と、ベースブランチのマイグレーションを適用済みの DB の両方に適用できる

ほかの PR が先にマイグレーションを追加してマージされた場合は、ベースブランチを取り込み、自分のマイグレーションを削除してから `npm run db:generate` で作り直してください。

## AI エージェント（Claude Code / Codex）で開発する

Claude Code・Codex（バイブコーディング）で作業する場合は、リポジトリの設定がそのまま使われます。

- `AGENTS.md`：プロジェクトの概要・コマンド・守ること。作業内容ごとに読み込むスキルの一覧もここにあります（`CLAUDE.md` は `@AGENTS.md` で読み込んでいるだけなので、内容は `AGENTS.md` に書きます）
- `.claude/skills/`：コーディング規約を作業の種類ごとにまとめたスキル。Codex は `.agents/skills/` から読むため、各スキルへのシンボリックリンクを置いています
- 応答の終了時に `src/` などに変更があれば型チェックし、失敗していれば修正させるフック（`.claude/hooks/typecheck-on-stop.sh`）。Claude Code は `.claude/settings.json`、Codex は `.codex/hooks.json` から呼びます。Codex では初回に `/hooks` でフックを確認して信頼する必要があります

| スキル | 内容 |
| --- | --- |
| `coding-style` | 書式・命名・型・コメント・文言・依存の方針 |
| `add-page` | ルート・画面・フォーム処理の書き方（権限チェック、バリデーション、PRG） |
| `db-change` | スキーマ変更とマイグレーション生成、SQL の書き方 |
| `ui` | UI 部品・CSS トークン・クライアント JS の進化的拡張 |
| `verify` | 完了前の確認（型チェック・ビルド・動作確認・セルフレビュー） |
| `commit` / `create-pr` | コミットと PR の作成 |

規約を変えたときは、該当するスキルも合わせて更新してください。スキルを追加したときは、Codex からも読めるようにリンクを張ります。

```sh
ln -s ../../.claude/skills/<名前> .agents/skills/<名前>
```
