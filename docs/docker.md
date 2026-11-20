# Docker で動かす

```sh
docker compose up -d --build   # http://127.0.0.1:3000
```

- 設定はリポジトリ直下の `.env` を読みます（`ENV_FILE` で別のパスを指定できます）
- `PORT` と `DATA_DIR` はコンテナ内で固定です。ホスト側のポートは `HOST_PORT`（既定 3000）で変えられます
- ポートは既定で `127.0.0.1` にだけ公開されます。外部へはリバースプロキシ経由で公開し、`APP_ORIGIN` を設定してください
- リバースプロキシが別のホストにある場合は、`HOST_BIND` で公開するアドレスを変えます（例 `HOST_BIND=192.168.0.10` や `0.0.0.0`）
  - Docker の公開ポートは ufw / firewalld の INPUT ルールを通りません。送信元をリバースプロキシに絞るには、iptables の `DOCKER-USER` チェーンかホストの外のファイアウォールで制限してください
  - 例：`iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3000 ! -s <リバースプロキシの IP> -j DROP`
- SQLite とローカル保存の教材ファイルは Docker ボリューム `step-learn_data` に保存されます。**このボリュームをバックアップ対象にしてください**（[バックアップ](backup.md)）
- ヘルスチェックは `/healthz` で、DB を読めることと `data/` に書き込めることを確かめます
- ログは json-file で、コンテナごとに 10MB × 3 ファイルまで残します
- 一緒に起動する `sandbox` サービスは、学生が書いたコードを実行するコンテナです（[sandbox/README.md](../sandbox/README.md)）。ボリューム `step-learn_sandbox-socket` はアプリとの通信用のソケットを置くだけなので、バックアップは要りません
- 一緒に起動する `browser` サービスは、Web の提出を採点の前に開くコンテナです（[browser/README.md](../browser/README.md)）。ボリューム `step-learn_browser-socket` も、ソケットを置くだけなのでバックアップは要りません

## 小さな VPS で動かす

`compose.yaml` のメモリの上限は、環境変数で変えられます。

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `APP_MEM_LIMIT` | `512m` | app のコンテナの上限 |
| `APP_HEAP_MB` | `320` | Node のヒープの上限（MB）。`APP_MEM_LIMIT` より十分小さくする |
| `SANDBOX_MEM_LIMIT` | `512m` | sandbox のコンテナの上限 |
| `BROWSER_MEM_LIMIT` | `1g` | browser のコンテナの上限 |
| `BROWSER_SLOTS` | `2` | browser で同時に開く提出の数 |

上限はそれぞれの最大で、ふだん使う量ではありません（待機中は 3 つ合わせて 200MB ほど）。メモリ 1GB の VPS では、次を目安にしてください。

- スワップを 1〜2GB 作る（足りなくなったときに、app が落とされるのを防ぐ）
- `SANDBOX_MEM_LIMIT=384m`・`BROWSER_MEM_LIMIT=512m`・`BROWSER_SLOTS=1` に下げる
- イメージはサーバーでビルドせず、ほかの場所でビルドしたものを pull する（[自動デプロイ](deploy.md)はそうしている）
