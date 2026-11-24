# 自動デプロイ（GitHub Actions のセルフホストランナー）

`master` への push で CI（`.github/workflows/ci.yml`）が成功すると、`.github/workflows/deploy.yml` が動きます。

1. GitHub のランナー（`ubuntu-latest`）で app・sandbox・browser の 3 つのイメージをビルドし、GitHub Container Registry（`ghcr.io/<リポジトリ>/step-learn` など、タグはコミットの SHA）に push する
2. 本番のサーバーのセルフホストランナーが、そのイメージを `docker compose pull` して `docker compose up -d --no-build` で入れ替える

サーバーではビルドしません（小さな VPS で、動いている本番の横で `npm ci` と `vite build` を走らせるとメモリが足りなくなるため）。3 日より古い使っていないイメージと、ビルドキャッシュはデプロイのたびに消します。
CI はチェックだけを行い、デプロイはしません。Actions の画面から手動で再デプロイすることもできます（`master` のみ）。

| デプロイ | ランナーのラベル | Environment | Compose のプロジェクト（ボリューム） |
| --- | --- | --- | --- |
| 本番 | `production` | `production` | `step-learn`（`step-learn_data`） |

サーバー側の準備：

1. Docker（Compose v2.24 以上）を入れ、ラベル `self-hosted` / `linux` と、ラベル `production` を付けたランナーを登録する（ランナーのユーザーが `docker` を実行できること）
2. GitHub の Environment `production` に設定値を登録する。デプロイのたびに、ここから `.env` をランナーの一時ディレクトリに書き出してコンテナに渡し、終わったら消します
   - Secrets：`SESSION_SECRET` / `SMTP_PASS` / `MOODLE_EXCHANGE_TOKEN` / `MOODLE_BACKCHANNEL_SECRET` / `OPENROUTER_API_KEY` / `CLAUDE_API_KEY` / `MICROSOFT_CLIENT_SECRET`
   - Variables：`APP_ORIGIN` / `TRUST_PROXY` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MOODLE_URL` / `AI_EMAIL_DOMAIN` / `MICROSOFT_CLIENT_ID` / `MICROSOFT_TENANT`
   - 使わない項目は登録しなくてかまいません。値に `'` と改行は使えません
   - Moodle モードで動かす場合は `MOODLE_URL` などを登録します
3. ホスト側のポートを変える場合は変数 `DEPLOY_HOST_PORT` を、公開するアドレスを変える場合は変数 `DEPLOY_HOST_BIND` を、Environment かリポジトリに設定する
   - コンテナのメモリの上限は変数 `DEPLOY_APP_MEM_LIMIT` / `DEPLOY_APP_HEAP_MB` / `DEPLOY_SANDBOX_MEM_LIMIT` / `DEPLOY_BROWSER_MEM_LIMIT` / `DEPLOY_BROWSER_SLOTS` で変えられます（[小さな VPS で動かす](docker.md)）。設定しなければ `compose.yaml` の既定を使います
   - AI エージェントが検索する STEP Docs の索引を置くディレクトリ（既定 `/srv/step-learn/ai-docs`）を変える場合は変数 `DEPLOY_AI_DOCS_DIR` を設定する（[STEP Docs を AI エージェントに取り込む](ai-docs.md)）
4. 必要に応じて、Environment に承認者などの保護ルールを設定する

## データを別のボリュームに移す

Compose のプロジェクト名を変えると、データのボリュームも変わります（`<プロジェクト名>_data`）。今のデータを使い続けるには、デプロイの前にサーバーで中身を移します。例として、`step-learn-beta_data` から `step-learn_data` に移す場合です。

```sh
# 書き込みの途中で写さないように、先に止める（-v は付けない。付けるとボリュームごと消える）
docker compose -p step-learn-beta down

docker volume create step-learn_data
docker run --rm -v step-learn-beta_data:/from:ro -v step-learn_data:/to alpine sh -c 'cp -a /from/. /to/'
```

- 止めてから、新しいプロジェクト名でデプロイし終わるまでの間は、サービスが止まります
- 移す先のボリュームがもうあって中身が入っている場合は、写す前に中身を確かめてください。上のコマンドは同じ名前のファイルを上書きします
- 新しいほうで動くのを確かめるまで、元のボリュームは消さずに残します。確かめたら `docker volume rm step-learn-beta_data` で消します
