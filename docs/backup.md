# バックアップ

SQLite は WAL で書き込むので、動いている最中に `data/` のファイルをそのままコピーすると、壊れた複製になることがあります。DB は次のコマンドで複製してください（サーバーは止めなくてよい）。

```sh
npm run db:backup                                   # data/backups/step-learn-<日時>.db に書き出し、7 世代を残す
npm run db:backup -- --out /backup --keep 14        # 書き出す先と残す世代を変える
docker compose exec app node dist/server/backup.js  # Docker のとき（ボリュームの data/backups に書き出す）
```

Moodle モードの `moodle-mode.db` があれば、それも一緒に複製します。教材ファイル（`data/files`）は書き換えないので、そのままコピーしてかまいません。たとえば Docker では、毎日 cron で次を実行し、できたファイルをサーバーの外へ送ります。

```sh
docker compose exec -T app node dist/server/backup.js
docker run --rm -v step-learn_data:/data:ro -v /srv/backup:/backup busybox \
  tar czf /backup/step-learn-$(date +%F).tgz -C /data --exclude='./step-learn.db*' --exclude='./moodle-mode.db*' .
```

戻すときは、サーバーを止めてから、複製した `.db` を `step-learn.db`（Moodle モードは `moodle-mode.db`）の名前で `data/` に置き、同じ名前の `-wal` と `-shm` のファイルを消してください。
