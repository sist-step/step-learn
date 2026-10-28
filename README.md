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
| DB | Node 24 標準の `node:sqlite`（WAL モード）。ネイティブモジュールのビルドが不要で、DB サーバーも要らない。プリペアドステートメントはキャッシュして使い回す |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。R2 を使う場合、ダウンロードは署名付き URL で R2 から直接配信されるので、サーバーの帯域を使わない（R2 は転送料無料） |
| 依存の少なさ | ランタイム依存は `hono`・`@hono/node-server`・`aws4fetch`（R2 用、数 KB）だけ。ビルド結果は 1 ファイルにバンドルされ、本番では `node_modules` が要らない |
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
- 実行時に必要なのは `dist/`・`migrations/`・`.env` だけです。起動したディレクトリを基準に読み込みます

### 教材ファイルを Cloudflare R2 に保存する

1. Cloudflare ダッシュボードで R2 バケットを作成する（例 `step-learn-files`）
2. 「R2 API トークンを管理」で、そのバケットへの「オブジェクト読み取りと書き込み」権限を持つトークンを発行する
3. `.env` に `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` を設定して再起動する

4 つすべてが設定されていると R2 に保存され、未設定ならローカルディスクに保存されます。
ダウンロードは、アプリで閲覧権限を確認したあと、有効期限 5 分の署名付き URL へリダイレクトして配信します。

## ディレクトリ構成

```
migrations/          SQLite スキーマ（起動時に未適用のものを自動で適用）
src/index.tsx        Hono アプリ本体（ミドルウェア、ルーティング）
src/server.ts        本番用 Node.js エントリ（静的ファイル配信、起動）
src/renderer.tsx     HTML の外枠
src/client.ts        クライアント側の小さな拡張（トースト、確認ダイアログ、完了トグルなど）
src/style.css        デザイントークンと全スタイル（ダークモード対応）
src/lib/             設定・DB・認証・HTTP ヘルパー・Markdown・ストレージ・コースの権限
src/components/      レイアウトと UI 部品
src/routes/          auth / account / admin / courses / content / participants
```
