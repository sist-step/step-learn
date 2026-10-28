# StepLearn

Moodle の「よく使う機能だけ」を、速く・安く・使いやすく作り直した軽量 LMS です。
Node.js（Hono）＋ SQLite で動き、教材ファイルは開発時はローカルディスク、本番は Cloudflare R2 に保存します。
1 台の小さな VPS で十分に動く構成です。

## 機能（現時点）

- **認証**：メール＋パスワードでの登録とログイン、セッション管理、プロフィールとパスワードの変更
  - 最初に登録したユーザーが自動的に管理者になります
  - ロールは 管理者 / 教師 / 学生。コースを作成できるのは教師と管理者です
- **コース**
  - コース一覧と検索、ダッシュボード（受講中・担当コース、進捗、「続きから学習」）
  - 作成・編集・削除、カラー、公開/非公開、登録キー（自己登録）
  - セクションとアイテム（ページ＝Markdown / リンク / ファイル）
  - 編集モードでの追加・並べ替え・削除
  - 学生ごとの完了チェックと進捗表示、前後ナビと目次付きの閲覧画面
  - 参加者管理（メールで追加、ロール変更、除外）
- **ユーザー管理**（管理者）：ロールの変更

## 設計方針

| 方針 | 実装 |
| --- | --- |
| 速さ | SSR（hono/jsx）。クライアント JS は約 2KB（gzip）の進化的拡張のみで、JS なしでも全操作できる。Speculation Rules による先読みと View Transitions で、ページ遷移も SPA 並みに速い |
| DB | `better-sqlite3`（WAL モード）＋ Drizzle ORM。DB サーバーは要らない。テーブル定義は `src/lib/schema.ts` で、マイグレーションは drizzle-kit で生成する。生 SQL 用のラッパーはプリペアドステートメントをキャッシュして使い回す |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。R2 を使う場合、ダウンロードは署名付き URL で R2 から直接配信されるので、サーバーの帯域を使わない（R2 は転送料無料） |
| 依存の少なさ | ランタイム依存は `hono`・`@hono/node-server`・`aws4fetch`（R2 用、数 KB）・`better-sqlite3`・`drizzle-orm` だけ。ネイティブアドオンの `better-sqlite3` 以外は 1 ファイルにバンドルされる |
| セキュリティ | PBKDF2（10 万回）、セッショントークンは SHA-256 で保存、CSRF 対策は Origin 検証と SameSite=Lax、ファイルは権限を確認したうえで配信（PDF と画像以外は添付として返す） |

## 開発

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # http://localhost:5173
```

- 初回起動時に `migrations/` のスキーマが自動で適用され、`data/step-learn.db` が作られます
- アップロードしたファイルは `data/files/` に保存されます
- データを初期化したいときはサーバーを止めて `data/` を削除してください

```sh
npm run typecheck
```

## 本番運用

```sh
npm ci
npm run build        # dist/client（CSS/JS）と dist/server/index.js を生成
npm start            # = node dist/server/index.js
```

設定は環境変数か `.env` で行います（`.env.example` を参照）。

- `PORT`：待ち受けポート（既定 3000）
- `DATA_DIR`：SQLite ファイルの置き場所（既定 `./data`）。**このディレクトリをバックアップ対象にしてください**
- `APP_ORIGIN`：nginx や Caddy などのリバースプロキシの後ろで動かす場合は、公開 URL（例 `https://lms.example.com`）を必ず設定してください
- 実行時に必要なのは `dist/`・`migrations/`・`.env` と、`better-sqlite3` を入れた `node_modules` です（`npm ci --omit=dev` で入ります）。起動したディレクトリを基準に読み込みます

### Docker で動かす

```sh
docker compose up -d --build   # http://127.0.0.1:3000
```

- 設定はリポジトリ直下の `.env` を読みます（`ENV_FILE` で別のパスを指定できます）
- `PORT` と `DATA_DIR` はコンテナ内で固定です。ホスト側のポートは `HOST_PORT`（既定 3000）で変えられます
- ポートは `127.0.0.1` にだけ公開されます。外部へはリバースプロキシ経由で公開し、`APP_ORIGIN` を設定してください
- SQLite とローカル保存の教材ファイルは Docker ボリューム `step-learn_data` に保存されます。**このボリュームをバックアップ対象にしてください**

### 自動デプロイ（GitHub Actions のセルフホストランナー）

`master` への push で CI（`.github/workflows/ci.yml`）が成功すると、`.github/workflows/deploy.yml` がセルフホストランナー上で `docker compose build` → `docker compose up -d` を実行して入れ替えます。
CI はチェックだけを行い、デプロイはしません。Actions の画面から手動で再デプロイすることもできます（`master` のみ）。

サーバー側の準備：

1. Docker（Compose v2.24 以上）を入れ、ラベル `self-hosted` / `linux` のランナーを登録する（ランナーのユーザーが `docker` を実行できること）
2. `.env` を `/opt/step-learn/.env` に置く（別の場所にする場合はリポジトリ変数 `DEPLOY_ENV_FILE` にパスを設定）
3. ホスト側のポートを変える場合はリポジトリ変数 `DEPLOY_HOST_PORT` を設定する
4. 必要に応じて、GitHub の Environment `production` に承認者などの保護ルールを設定する

### 教材ファイルを Cloudflare R2 に保存する

1. Cloudflare ダッシュボードで R2 バケットを作成する（例 `step-learn-files`）
2. 「R2 API トークンを管理」で、そのバケットへの「オブジェクト読み取りと書き込み」権限を持つトークンを発行する
3. `.env` に `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` を設定して再起動する

4 つすべてが設定されていると R2 に保存され、未設定ならローカルディスクに保存されます。
ダウンロードは、アプリで閲覧権限を確認したあと、有効期限 5 分の署名付き URL へリダイレクトして配信します。

## ディレクトリ構成

```
migrations/          drizzle-kit が生成するマイグレーション（起動時に未適用のものを自動で適用）
src/index.tsx        Hono アプリ本体（ミドルウェア、ルーティング）
src/server.ts        本番用 Node.js エントリ（静的ファイル配信、起動）
src/renderer.tsx     HTML の外枠
src/client.ts        クライアント側の小さな拡張（トースト、確認ダイアログ、完了トグルなど）
src/style.css        デザイントークンと全スタイル（ダークモード対応）
src/lib/             設定・DB・認証・HTTP ヘルパー・Markdown・ストレージ・コースの権限
src/components/      レイアウトと UI 部品
src/routes/          auth / account / admin / courses / content / participants
```
