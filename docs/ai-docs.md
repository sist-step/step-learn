# STEP Docs を AI エージェントに取り込む

STEP Docs の本文は、非公開のリポジトリ（[sist-step/step-docs](https://github.com/sist-step/step-docs)）の `src/content/docs` にあります。step-learn は公開リポジトリなので、本文も索引もこのリポジトリとイメージには入れません。

1. step-docs の `main` の docs が変わると、step-docs のワークフロー（`.github/workflows/ai-index.yml`）が、本番のサーバーの self-hosted ランナーで動く
2. ワークフローは step-docs の docs と、step-learn の `scripts/docs-index.ts` だけを checkout し、索引（本文を見出しごとに分けた断片と、そのベクトル）をサーバーの専用ディレクトリ（既定 `/srv/step-learn/ai-docs`）の `step-docs.json` に書く
3. STEP Learn のコンテナは、`compose.yaml` でそのディレクトリを `/app/ai-docs` に読み取り専用でマウントして読む。ファイルが変わったら次の検索のときに読み直すので、再起動は要らない

- 中身が変わっていない断片は前の索引のベクトルを使い回すので、API を呼ぶのは変わった部分だけです（全部を作り直しても 1 円にもなりません）
- パスワードや API キーなどは、索引に入れる前に `[非公開: 元のドキュメントを参照]` に置き換えます（何を伏せるかは `scripts/docs-index.ts`）。ラベルなしで文中にだけ書かれたものは見つけられないので、ページを足したら `--dry-run` で確かめてください
- 索引がないあいだは、AI エージェントはドキュメントを読めないことを伝えます
- `scripts/docs-index.ts` の索引の形を変えたら、step-docs の Actions から AI の索引のワークフローを手動で実行し直してください

準備（最初に一度）:

1. 本番のサーバーで、ランナーのユーザーが書けて、コンテナ（`node` ユーザー）が読めるディレクトリを作る。例: `sudo mkdir -p /srv/step-learn/ai-docs && sudo chown <ランナーのユーザー> /srv/step-learn/ai-docs`
2. step-docs のリポジトリに、同じサーバーの self-hosted ランナー（ラベル `self-hosted` / `linux` / `beta`）を登録する。step-learn のランナーはリポジトリごとの登録なので、step-docs からは使えません
3. step-docs のリポジトリに Environment `beta` を作り、Secret `OPENROUTER_API_KEY` を登録する。ディレクトリを変えるときは、step-docs の変数 `AI_DOCS_DIR` と step-learn の変数 `DEPLOY_AI_DOCS_DIR` を同じ値にする

手元で試すとき（開発サーバーは `ai-docs/` を読む。`ai-docs/` は Git の対象外）:

```sh
npm run docs:index -- --docs ../step-docs/src/content/docs --dry-run    # 取り込むページと伏せる箇所を確かめる（何も書き込まない）
npm run docs:index -- --docs ../step-docs/src/content/docs --out ai-docs # .env の OPENROUTER_API_KEY で索引を作る
```
