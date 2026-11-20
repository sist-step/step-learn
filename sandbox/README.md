# sandbox

コーディング問題で学生が書いた Python を、アプリとは別のコンテナで実行します。`server.py` が要求を受け、`jail.py` が権限を落として実行します。HTML / CSS / JavaScript はサーバーでは実行せず、学生のブラウザの別オリジンの iframe でプレビューするので、ここは通りません。

`docker compose up` でアプリと一緒に起動し、アプリは共有ボリュームの UNIX ドメインソケット（`SANDBOX_URL=unix:/run/sandbox/sandbox.sock`）で呼びます。`SANDBOX_URL` が未設定のサーバーでは、コーディング問題で Python を選べません。

## 隔離のしかた

- コンテナはネットワークにつながず、ルートファイルシステムは読み取り専用で、ケーパビリティは UID の切り替えに要るものだけを残します。秘密情報・環境変数・データのボリュームは置きません
- 1 回の実行ごとに別の UID と作業ディレクトリ（tmpfs）を使い、終わるたびにその UID のプロセスを止めて作業ディレクトリを空にします。止められない・消せないときは sandbox を終了させ、Docker の再起動で作り直します
- 上限の値は、コンテナ全体が `compose.yaml` の `sandbox` サービス、1 回の実行が `server.py` の定数にあります
- 同時に実行できる数は `compose.yaml` の `tmpfs` の行の数で決まります（8 まで）。増やすときは `mem_limit` も見直してください

コンテナはホストとカーネルを共有するので、カーネルの脆弱性を突かれた場合までは防げません。もう一段固くしたい場合は、サーバーに [gVisor](https://gvisor.dev/) を入れ、`SANDBOX_RUNTIME=runsc` を付けて起動すると、sandbox だけを gVisor で動かせます（gVisor での動作は未確認です。共有ボリュームにソケットを作るので、runsc の `--host-uds=create` が必要になるはずです）。

Docker Compose を使わずに `npm start` で動かす場合は、下の開発用と同じくポートで待ち受ける形になりますが、この形では実行中のコードが外部と通信できます。本番では Docker Compose で動かしてください。

## 開発サーバーから使う

sandbox だけを起動し、`.env` に接続先を書きます。

```sh
docker compose -f sandbox/compose.dev.yaml up -d --build   # 127.0.0.1:8091 で待ち受ける
```

```sh
SANDBOX_URL=http://127.0.0.1:8091
```
