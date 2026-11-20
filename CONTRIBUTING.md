# 開発の進め方

## 必要なもの

- Node.js 24 以上（`.nvmrc` 参照。`nvm use` で切り替えられます）
- npm

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev:users    # 開発用のユーザー admin / teacher / student（パスワードはユーザー名と同じ）
```

- 初回起動時に `migrations/` のスキーマが自動で適用され、`data/step-learn.db` が作られます
- アップロードしたファイルは `data/files/` に保存されます
- データを初期化したいときはサーバーを止めて `data/` を削除してください
- SMTP を設定していない間は、確認メールは送信されずにサーバーのログに出力されます
- 本番と同じ手順で管理者を作るときは [docs/production.md](docs/production.md) の「ユーザーを CLI で作成する」

```sh
npm run typecheck
npm run lint          # oxlint
npm run format        # Prettier で整形（確認だけなら format:check）
npm run build
```

## ドキュメントの置き場所

読む人ごとに置き場所を分けます。

| 書くもの | 置き場所 |
| --- | --- |
| 何のソフトか・動かし方・ドキュメントの案内 | `README.md` |
| 機能の使い方（教師・学生向け） | [STEP Docs](https://step-docs.siststep.workers.dev/)（step-docs リポジトリ） |
| 全体に関わる運用の手順と設定（環境変数・Docker・デプロイ・バックアップなど） | `docs/` のテーマごとのファイル |
| 特定のディレクトリだけに関わる手順（`sandbox/`・`browser/`・`moodle/`・`vscode-extension/`） | そのディレクトリの README（拡張機能は `DEVELOPMENT.md`。`README.md` は Marketplace のページになるため） |
| 開発の規則 | `AGENTS.md`、`.claude/skills/`（人向けの流れはこのファイル） |
| なぜそうしたか | コミットメッセージと PR の本文 |

- README には機能の一覧や仕様を書きません。機能を足しても README は変えません
- `docs/` とディレクトリの README に書くのは、コードを読んでもわからない手順だけです。外のサービスの設定、サーバーの準備、障害のときの戻し方などで、仕組みの説明や挙動の仕様は書きません
- 挙動の細かい仕様と上限の値はコードと設定ファイルが正です。ドキュメントに写すとずれるので、関数名・定数名・数値は書かず、どのファイルにあるかを書きます
- 環境変数は `docs/production.md` の表に 1 行で、何を設定するかと、設定しないとどうなるかだけを書きます
- 運用の手順が増えたときは該当するファイルに書きます。テーマが新しければファイルを足し、README の一覧に 1 行加えます

## ブランチ

`master` から作業ブランチを切り、PR でマージします。`master` へ直接 push はしません。

| 種類 | ブランチ名の例 |
| --- | --- |
| 新機能 | `feature/assignments` |
| バグ修正 | `fix/login-redirect` |
| 開発環境・CI・依存関係 | `chore/dev-setup` |
| ドキュメント | `docs/readme-deploy` |

## 並行して作業する（worktree）

複数の Claude Code のセッションで同時に作業できるよう、ファイルを編集する作業はセッションごとに git の worktree（`.claude/worktrees/<名前>`）で行います。

- 普通に `claude` で起動したセッションでも、編集を伴う依頼をすると Claude が最初の編集の前に worktree を作って移ります（`AGENTS.md` の指示）。質問や調査だけならメインの作業ディレクトリのままです
- 自分で作るときは `claude -w feature-quiz` で起動します
- `WorktreeCreate` フック（`scripts/worktree.ts`）が `origin/master` から worktree を作り、`npm ci`・`.env` のコピー・`data/` のコピーまで行います。DB は起動中の開発サーバーがあっても壊れないよう、SQLite のバックアップ機能で複製します
- 名前が `feature/` `fix/` `chore/` `docs/`（または `feature-` など）で始まるとブランチは `feature/…` などになり、それ以外は `worktree-<名前>` になります。同じ名前のブランチがあれば、それを開きます
- 開発サーバーはポートを分けて起動します。作成時に空いているポート（5180 番から）が表示されます: `npm run dev -- --port 5180 --strictPort`
- PR を作ると、Claude が worktree を削除してメインの作業ディレクトリに戻ります（`create-pr` スキル）。`WorktreeRemove` フックが worktree を消し、マージ済みのブランチだけを削除します。マージ前のブランチはプッシュ済みのまま残ります
- Claude Code 以外（Codex や `git worktree add`）で作った worktree では、その中で `npm run worktree:setup` を実行すると同じ準備ができます

気をつけること:

- `data/` は作成時点のコピーなので、worktree での変更はメインの DB に反映されません
- ブラウザの Cookie はポートで分かれないため、どれか 1 つでログアウトや別のユーザーでのログインをすると、ほかのポートのログインも切れます
- Moodle モードの確認は、プラグインの戻り先に合わせて 5174 番で行う必要があるため、同時に 1 か所でしかできません
- 2 つのブランチがそれぞれマイグレーションを生成すると、後からマージする側で作り直しになります（「プルリクエスト」の最後を参照）。DB を変える作業は同時に 1 つにします


## コミットメッセージ

Conventional Commits の形で、スコープを付けて日本語で書きます。本文にはなぜ変えたかを書きます。型の一覧と細かい決まりは [.claude/skills/commit/SKILL.md](.claude/skills/commit/SKILL.md) にあります。

```
feat(quiz): 小テストに並べ替えの形式を足す
fix(auth): 登録キーが空のときに参加できない問題を直す
```

## プルリクエスト

1. PR テンプレートに沿って概要・動作確認を書く
2. CI（型チェック・lint・フォーマット・ビルド・Docker イメージのビルドと起動・マイグレーションの確認）が通っていることを確認する
3. CODEOWNERS のレビュー承認を得てからマージする

UI を変更した場合はスクリーンショットを添付してください。
DB のスキーマを変える場合は `src/lib/schema.ts` を編集し、`npm run db:generate` で `migrations/` にマイグレーションを生成してコミットしてください（起動時に自動で適用されます）。既存のマイグレーションは編集しないでください。

CI では `npm run db:check` で次の点を確認し、問題があればマージできません。ローカルでも同じコマンドで確認できます。

- ベースブランチで適用済みのマイグレーション（SQL・スナップショット・journal のエントリ）が変更・削除されていない
- 追加したマイグレーションの作成日時が既存のものより新しい（古いと適用済みの DB で実行されない）
- `migrations/` の SQL がすべて journal に載っている
- `schema.ts` とマイグレーションが一致している（`npm run db:generate` のし忘れがない）
- 空の DB と、ベースブランチのマイグレーションを適用済みの DB の両方に適用できる

ほかの PR が先にマイグレーションを追加してマージされた場合は、ベースブランチを取り込みます。自分のマイグレーションを自分の開発 DB にしか適用していなければ、削除して `npm run db:generate` で作り直します。ほかの環境に適用済みなら削除せず、journal と最後のスナップショットだけを直して両立させます（`db-change` スキル）。

## AI エージェント（Claude Code / Codex）で開発する

Claude Code・Codex で作業する場合は、リポジトリの設定がそのまま使われます。

- `AGENTS.md`：コマンド・守ること・書き方と、作業の種類ごとに読み込むスキルの一覧。`CLAUDE.md` は `@AGENTS.md` で読み込んでいるだけなので、内容は `AGENTS.md` に書きます
- `.claude/skills/`：作業の種類ごとの手順と規則。Codex は `.agents/skills/` から読むため、各スキルへのシンボリックリンクを置いています
- 応答の終了時に `src/` などに変更があれば型チェックし、失敗していれば修正させるフック（`.claude/hooks/typecheck-on-stop.sh`）。Claude Code は `.claude/settings.json`、Codex は `.codex/hooks.json` から呼びます。Codex では初回に `/hooks` でフックを確認して信頼する必要があります

規則の正本は `AGENTS.md` とスキルです。このファイルやほかの文書には書き写しません。

- どの作業でも要る規則は `AGENTS.md`、特定の作業でだけ要る規則はスキルに書きます
- lint・型・Prettier で確かめられるものは、文書ではなく設定に足します
- スキルには規則だけを書きます。機能の仕様や「どこに足すか」の一覧は書き足しません（型で縛るか、定義の場所に Why not のコメントを書きます）

スキルを追加したときは、Codex からも読めるようにリンクを張ります。

```sh
ln -s ../../.claude/skills/<名前> .agents/skills/<名前>
```
