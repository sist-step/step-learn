# 自動デプロイ（GitHub Actions のセルフホストランナー）

`master` への push で CI（`.github/workflows/ci.yml`）が成功すると、`.github/workflows/deploy.yml` が動きます。

1. GitHub のランナー（`ubuntu-latest`）で app・sandbox・browser の 3 つのイメージをビルドし、GitHub Container Registry（`ghcr.io/<リポジトリ>/step-learn` など、タグはコミットの SHA）に push する
2. beta のサーバーのセルフホストランナーが、そのイメージを `docker compose pull` して `docker compose up -d --no-build` で入れ替える
3. beta が起動できたら、本番のサーバーのセルフホストランナーが同じイメージで入れ替える（リポジトリの変数 `DEPLOY_PRODUCTION` が `true` のときだけ）

サーバーではビルドしません（小さな VPS で、動いている本番の横で `npm ci` と `vite build` を走らせるとメモリが足りなくなるため）。3 日より古い使っていないイメージと、ビルドキャッシュはデプロイのたびに消します。
CI はチェックだけを行い、デプロイはしません。Actions の画面から手動で再デプロイすることもできます（`master` のみ）。
サーバーでの手順は `.github/workflows/deploy-server.yml` にあり、beta と本番で同じものを使います。

| デプロイ | ランナーのラベル | Environment | Compose のプロジェクト（ボリューム） |
| --- | --- | --- | --- |
| beta | `beta` | `beta` | `step-learn-beta`（`step-learn-beta_data`） |
| 本番 | `production` | `production` | `step-learn`（`step-learn_data`） |

サーバー側の準備（beta と本番のそれぞれで行う）：

1. Docker（Compose v2.24 以上）を入れ、ラベル `self-hosted` / `linux` と、上の表のラベル（`beta` か `production`）を付けたランナーを登録する（ランナーのユーザーが `docker` を実行できること）
2. GitHub の Environment（`beta` か `production`）に設定値を登録する。デプロイのたびに、ここから `.env` をランナーの一時ディレクトリに書き出してコンテナに渡し、終わったら消します
   - Secrets：`SESSION_SECRET` / `SMTP_PASS` / `MOODLE_EXCHANGE_TOKEN` / `MOODLE_BACKCHANNEL_SECRET` / `OPENROUTER_API_KEY` / `CLAUDE_API_KEY` / `MICROSOFT_CLIENT_SECRET`
   - Variables：`APP_ORIGIN` / `TRUST_PROXY` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` / `MOODLE_URL` / `AI_EMAIL_DOMAIN` / `MICROSOFT_CLIENT_ID` / `MICROSOFT_TENANT`
   - 使わない項目は登録しなくてかまいません。値に `'` と改行は使えません
   - Moodle モードで動かす場合は `MOODLE_URL` などを登録します
3. ホスト側のポートを変える場合は変数 `DEPLOY_HOST_PORT` を、公開するアドレスを変える場合は変数 `DEPLOY_HOST_BIND` を、Environment に設定する（リポジトリに設定すると beta と本番の両方に効きます）
   - データが上の表とは別のボリュームに入っている場合は、変数 `DEPLOY_COMPOSE_PROJECT` にそのプロジェクト名を設定する（ボリューム `<プロジェクト名>_data` を使います）。違う名前のままデプロイすると、空の DB で起動します
   - コンテナのメモリの上限は変数 `DEPLOY_APP_MEM_LIMIT` / `DEPLOY_APP_HEAP_MB` / `DEPLOY_SANDBOX_MEM_LIMIT` / `DEPLOY_BROWSER_MEM_LIMIT` / `DEPLOY_BROWSER_SLOTS` で変えられます（[小さな VPS で動かす](docker.md)）。設定しなければ `compose.yaml` の既定を使います
   - AI エージェントが検索する STEP Docs の索引を置くディレクトリ（既定 `/srv/step-learn/ai-docs`）を変える場合は変数 `DEPLOY_AI_DOCS_DIR` を設定する（[STEP Docs を AI エージェントに取り込む](ai-docs.md)）
4. 必要に応じて、Environment に承認者などの保護ルールを設定する。本番を承認してから入れたい場合は、Environment `production` の Required reviewers を設定します
   - 承認を待っている間は次のデプロイ（beta を含む）も待ちます。続けてマージした場合は、待っているうちの最新の 1 つだけが残ります
5. 本番は、ランナーと Environment を用意してから、リポジトリの変数 `DEPLOY_PRODUCTION` を `true` にすると、次のデプロイから入れ替わります
   - ランナーがない状態で有効にすると、本番のジョブがランナーを待ったまま止まり、その間は beta のデプロイも進みません
