# 拡張機能の開発と公開

使い方は [README.md](README.md)（Marketplace のページにもなる）にあります。このファイルは開発する人向けです。

本体とは別のパッケージで、型チェック・lint・ビルドも別に行います。本体の `npm run lint` は拡張機能を対象から外し、入れ子の設定も読まないので、拡張機能の中の `.oxlintrc.json` で検査します。実行時の依存はなく、esbuild で 1 ファイルにまとめます。

```sh
cd vscode-extension
npm install
npm run typecheck
npm run lint
npm run package     # step-learn-for-vscode-<バージョン>.vsix を作る（手元の VS Code に「VSIX からのインストール」で入れて試せる）
```

拡張機能が受け取るのは、リンクに書かれた https のサーバー（手元の開発では `http://localhost`）だけです。STEP Learn が「VS Code で開く」のリンクに入れるサーバーは `APP_ORIGIN`（なければ要求の URL）なので、リバースプロキシの配下では `APP_ORIGIN` を設定してください。

## Marketplace への公開（無料）

1. Microsoft アカウントで [Azure DevOps](https://dev.azure.com/) の組織を作り、「Personal access tokens」で Organization を「All accessible organizations」、Scopes を「Marketplace の Manage」にしたトークンを作る
2. [Marketplace の管理画面](https://marketplace.visualstudio.com/manage) で publisher `mint1535` を作る
3. `cd vscode-extension && npm ci && npx vsce login mint1535`（トークンを入力）→ `npm run publish`。`npm ci` を省くと、グローバルに入っている古い vsce が使われて `unknown option '--skip-license'` で失敗することがある。更新するときは `package.json` の `version` を上げてから `npm run publish`

publisher か名前を変えるときは、`src/features/bundle/bundle.ts` の `VSCODE_EXTENSION_ID` もそろえてください。そろっていないと、「VS Code で開く」のリンクが拡張機能に届きません。
