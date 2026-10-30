# StepLearn

Moodle の「よく使う機能だけ」を、速く・安く・使いやすく作り直した軽量 LMS です。
Node.js（Hono）＋ SQLite で動き、教材ファイルは開発時はローカルディスク、本番は Cloudflare R2 に保存します。
1 台の小さな VPS で十分に動く構成です。

## 機能（現時点）

- **認証**：メール＋パスワードでの登録とログイン、セッション管理、プロフィールとパスワードの変更
  - 新規登録はメールアドレスの確認が必要です（届いたリンクから氏名・ユーザー名・パスワードを設定）
  - ログインはメールアドレスとユーザー名のどちらでもできます。ユーザー名の導入前に登録したユーザーは、アカウント画面で設定します
  - 管理者は CLI（`npm run user:create`）で作成します。Web からの登録はすべて学生になります
  - ロールは 管理者 / 教師 / 学生。コースを作成できるのは管理者だけです
- **コース**
  - コース一覧と検索（参加しているコースのみ。管理者はすべてのコース）、ダッシュボード（受講中・担当コース、進捗、「続きから学習」）
  - 作成（管理者がコース一覧や管理画面のモーダルから）・編集・削除、カラー、コースアイコンとヒーロー画像（PNG / JPEG / WebP / GIF、最大 5MB。アイコンは未設定なら頭文字を表示）
  - 学生の自己登録はなく、管理者か教師が参加者として追加したコースだけが見える
  - セクションとアイテム（ページ＝Markdown / リンク / ファイル / 画面共有）
  - 編集モードでの追加・並べ替え・削除（オンにするとブラウザを閉じるかログアウトするまで、どのコースでも続く）。オフのときは教師にも学生と同じ見え方で表示する
  - セクション・アイテムごとの「学生に非表示」（学生には一覧にも出さず、URL を開いても 404。進捗の計算からも外す）
  - 学生ごとの完了チェックと進捗表示、前後ナビと目次付きの閲覧画面
  - 参加者管理（メールで追加、ロール変更、除外）
  - 画面共有：セクションに「画面共有」アイテムを追加すると、教師がブラウザから画面をライブ配信でき、参加者はアイテムを開くと別タブいっぱいに映像を視聴できる（最大 1920×1080・30fps、回線と画面の動きに応じた可変ビットレート）
- **管理画面**（管理者、`/admin`）：ユーザーのロール変更、全コースの一覧と作成
- **テーマ**：既定はライト。ヘッダーのユーザーメニューで選んだときだけダークにし、選択はクッキーで保持する

## 設計方針

| 方針 | 実装 |
| --- | --- |
| 速さ | SSR（hono/jsx）＋ 小さなクライアント JS。リンクとフォーム送信を fetch に置き換え、ホバー時の先読みと View Transitions で再読み込みなしに遷移する（SPA）。JavaScript は必須で、無効なブラウザには有効化を求める案内だけを表示する |
| DB | `better-sqlite3`（WAL モード）＋ Drizzle ORM。DB サーバーは要らない。テーブル定義は `src/lib/schema.ts` で、マイグレーションは drizzle-kit で生成する。クエリも Drizzle のクエリビルダーで書き、結果に型が付く |
| コスト | 必要なのは Node.js が動くサーバー 1 台だけ。R2 を使う場合、ダウンロードは署名付き URL で R2 から直接配信されるので、サーバーの帯域を使わない（R2 は転送料無料） |
| 依存の少なさ | ランタイム依存は `hono`・`@hono/node-server`・`aws4fetch`（R2 用、数 KB）・`nodemailer`（確認メールの SMTP 送信）・`better-sqlite3`・`drizzle-orm`・`socket.io`（画面共有の中継）だけ。ネイティブアドオンの `better-sqlite3` 以外は 1 ファイルにバンドルされる。ブラウザ側のライブラリは Markdown エディターの CodeMirror だけで、エディターのある画面でだけ読み込む |
| セキュリティ | PBKDF2（60 万回、ログイン時に旧設定のハッシュを再計算）、推測されやすいパスワードの拒否、ログイン失敗と確認メール送信のレート制限、登録画面からメールアドレスの登録有無がわからない設計、セッション Cookie は HMAC-SHA256 で署名しトークンは SHA-256 で保存、CSRF 対策は Origin 検証と SameSite=Lax、ファイルは権限を確認したうえで配信（PDF と画像以外は添付として返す） |

## 開発

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # http://localhost:5173
```

- 初回起動時に `migrations/` のスキーマが自動で適用され、`data/step-learn.db` が作られます
- アップロードしたファイルは `data/files/` に保存されます
- データを初期化したいときはサーバーを止めて `data/` を削除してください
- SMTP を設定していない間は、確認メールは送信されずにサーバーのログに出力されます

最初の管理者は CLI で作成します（CLI は `npm run build` で生成されます）。

```sh
npm run build
npm run user:create -- --email admin@example.com --name "管理者" --username admin
```

```sh
npm run typecheck
npm run lint          # oxlint
npm run format        # Prettier で整形（確認だけなら format:check）
```

## 本番運用

```sh
npm ci
npm run build        # dist/client（CSS/JS）と dist/server/index.js を生成
npm start            # = node dist/server/index.js
```

設定は環境変数か `.env` で行います（`.env.example` を参照）。

- `PORT`：待ち受けポート（既定 3000）
- `APP_ORIGIN`：nginx や Caddy などのリバースプロキシの後ろで動かす場合は、公開 URL（例 `https://lms.example.com`）を必ず設定してください
- `SESSION_SECRET`：セッション Cookie の署名鍵（32 文字以上）。未設定なら `data/session-secret` を自動生成して使います。変更すると全員がログアウトされます
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`：確認メールの送信に使う SMTP サーバー。`SMTP_HOST` を設定する場合は `MAIL_FROM` と `APP_ORIGIN` も必須です
- `TRUST_PROXY`：リバースプロキシの後ろで動かす場合は `1` にしてください。`X-Forwarded-For` からクライアントの IP を取ってレート制限に使います（未設定だと全員がプロキシの IP として扱われます）
- 画面共有は `/socket.io/` で WebSocket を使います。リバースプロキシでは WebSocket の Upgrade を通してください（nginx なら `proxy_http_version 1.1;` と `Upgrade` / `Connection` ヘッダーの転送）。通らない場合は HTTP のロングポーリングに切り替わって動きますが、遅延と負荷が増えます
- 配信中の状態はプロセスのメモリに持つため、複数のプロセスやサーバーに分散させないでください
- 実行時に必要なのは `dist/`・`migrations/`・`.env` と、`better-sqlite3` を入れた `node_modules` です（`npm ci --omit=dev` で入ります）。起動したディレクトリを基準に読み込みます
- SQLite・セッション署名鍵・（ローカル保存時の）教材ファイルは、起動したディレクトリの `data/` に保存されます（変更はできません）。**このディレクトリをバックアップ対象にしてください**

### ユーザーを CLI で作成する

```sh
npm run user:create -- --email admin@example.com --name "管理者" --username admin [--role admin|teacher|student]
```

- `--role` を省略すると管理者になります
- `--username` は半角英数字と `.` `_` `-` で 3〜30 文字です
- パスワードは対話的に入力します。パイプで渡した場合は 1 行目を使います（例 `cat password.txt | npm run user:create -- ...`）
- Web の新規登録と同じパスワードの基準を満たす必要があります

### Docker で動かす

```sh
docker compose up -d --build   # http://127.0.0.1:3000
```

- 設定はリポジトリ直下の `.env` を読みます（`ENV_FILE` で別のパスを指定できます）
- `PORT` と `DATA_DIR` はコンテナ内で固定です。ホスト側のポートは `HOST_PORT`（既定 3000）で変えられます
- ポートは既定で `127.0.0.1` にだけ公開されます。外部へはリバースプロキシ経由で公開し、`APP_ORIGIN` を設定してください
- リバースプロキシが別のホストにある場合は、`HOST_BIND` で公開するアドレスを変えます（例 `HOST_BIND=192.168.0.10` や `0.0.0.0`）
  - Docker の公開ポートは ufw / firewalld の INPUT ルールを通りません。送信元をリバースプロキシに絞るには、iptables の `DOCKER-USER` チェーンかホストの外のファイアウォールで制限してください
  - 例：`iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3000 ! -s <リバースプロキシの IP> -j DROP`
- SQLite とローカル保存の教材ファイルは Docker ボリューム `step-learn_data` に保存されます。**このボリュームをバックアップ対象にしてください**

### 自動デプロイ（GitHub Actions のセルフホストランナー）

`master` への push で CI（`.github/workflows/ci.yml`）が成功すると、`.github/workflows/deploy.yml` がセルフホストランナー上で `docker compose build` → `docker compose up -d` を実行して入れ替えます。
CI はチェックだけを行い、デプロイはしません。Actions の画面から手動で再デプロイすることもできます（`master` のみ）。

サーバー側の準備：

1. Docker（Compose v2.24 以上）を入れ、ラベル `self-hosted` / `linux` のランナーを登録する（ランナーのユーザーが `docker` を実行できること）
2. GitHub の Environment `production` に設定値を登録する。デプロイのたびに、ここから `.env` をランナーの一時ディレクトリに書き出してコンテナに渡し、終わったら消します
   - Secrets：`SESSION_SECRET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `SMTP_PASS`
   - Variables：`APP_ORIGIN` / `TRUST_PROXY` / `R2_ACCOUNT_ID` / `R2_BUCKET` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM`
   - 使わない項目は登録しなくてかまいません。値に `'` と改行は使えません
3. ホスト側のポートを変える場合は変数 `DEPLOY_HOST_PORT` を、公開するアドレスを変える場合は変数 `DEPLOY_HOST_BIND` を設定する（リポジトリと Environment `production` のどちらでもかまいません）
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
src/client.ts        クライアント側の小さな拡張（再読み込みなしの画面遷移、トースト、確認ダイアログ、完了トグルなど）
src/styles/base.css  デザイントークンと共通スタイル（ダークモード対応）。部品・画面ごとの CSS は各 .tsx の隣に置き、使うページでだけ読み込む
src/lib/             設定・DB・認証・HTTP ヘルパー・Markdown・ストレージ・画像アップロード・コースの権限
src/components/      レイアウトと UI 部品
src/routes/<ルート>/ auth / account / admin / dashboard / courses / content / participants / screen。
                     ルートごとに index.ts（ルーティング）・handlers.tsx（処理）・views.tsx（画面）・<ルート>.css に分ける
```
