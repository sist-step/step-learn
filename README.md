# STEP Learn

Moodle の「よく使う機能だけ」を、速く・安く・使いやすく作り直した軽量 LMS です。
Node.js（Hono）＋ SQLite で動き、教材ファイルはサーバーのローカルディスク（`data/files`）に保存します。
1 台の小さな VPS で十分に動く構成です。

## 動かす

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev:users    # 開発用のユーザー admin / teacher / student（パスワードはユーザー名と同じ）
```

開発の進め方は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ドキュメント

| 読む人 | 置き場所 |
| --- | --- |
| 使う人（教師・学生） | [STEP Docs](https://step-docs.siststep.workers.dev/) |
| 開発する人 | [CONTRIBUTING.md](CONTRIBUTING.md)、AI エージェント向けは [AGENTS.md](AGENTS.md) と `.claude/skills/` |
| 運用する人 | [docs/](docs/) と、各ディレクトリの README |

運用のドキュメント:

- [本番運用](docs/production.md)：起動、環境変数、ユーザーの作成
- [Docker で動かす・小さな VPS で動かす](docs/docker.md)
- [自動デプロイ](docs/deploy.md)
- [バックアップ](docs/backup.md)
- [Microsoft アカウントでのログイン](docs/microsoft-login.md)
- [STEP Docs を AI エージェントに取り込む](docs/ai-docs.md)
- [AI アプリから使う（MCP）](docs/mcp.md)

特定のディレクトリだけに関わるもの:

- [sandbox/README.md](sandbox/README.md)・[browser/README.md](browser/README.md)：コードを実行する・Web の提出を開くコンテナ
- [moodle/README.md](moodle/README.md)：Moodle モード、Moodle からの直接の取り込み、プラグイン
- [vscode-extension/DEVELOPMENT.md](vscode-extension/DEVELOPMENT.md)：VS Code の拡張機能の開発と公開

## 設計方針

| 方針 | 実装 |
| --- | --- |
| 速さ | SSR（hono/jsx）＋ 小さなクライアント JS。リンクとフォーム送信を fetch に置き換え、再読み込みなしに遷移する。JavaScript は必須 |
| DB | `better-sqlite3`（WAL モード）＋ Drizzle ORM。DB サーバーは要らない |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。DB も教材ファイルも同じサーバーのディスクに置く |
| 依存の少なさ | ランタイム依存は最小限にし、重いブラウザ側のライブラリは使う画面でだけ読み込む |
| セキュリティ | 権限のないリソースは存在を知らせない（404）、CSRF は Origin 検証と SameSite=Lax、ファイルは権限を確認したうえで配信する |

## ディレクトリ構成

```
src/                 アプリ本体（src/index.tsx が入口）
src/features/<機能>/ 機能ごとのルーティング・処理・画面・部品・CSS・クライアントの JS
src/components/      いくつもの機能で使う UI 部品
src/lib/             いくつもの機能で使う処理（DB・認証・設定など）
src/client/          いくつもの機能で使うクライアントの JS
src/moodle-mode/     Moodle モード（完全移行のあとは削除する）
migrations/          drizzle-kit が生成するマイグレーション
migrations-moodle/   Moodle モードの DB のマイグレーション
moodle/              Moodle モード用の Moodle プラグインと検証用の Moodle
sandbox/             学生が書いたコードを実行するコンテナ
browser/             Web の提出を headless Chromium で開くコンテナ
vscode-extension/    VS Code の拡張機能（STEP Learn for VSCode）
docs/                運用のドキュメント
```
