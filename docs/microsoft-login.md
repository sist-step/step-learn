# Microsoft アカウントでのログイン

[Microsoft Entra 管理センター](https://entra.microsoft.com/) の「アプリの登録」で、次のようにアプリを登録します。

1. 「新規登録」で、サポートされているアカウントの種類を「任意の組織ディレクトリ内のアカウントと個人用 Microsoft アカウント」にする（`MICROSOFT_TENANT` で絞るなら、それに合わせる）
2. リダイレクト URI に「Web」で `<APP_ORIGIN>/auth/microsoft/callback`（例 `https://lms.example.com/auth/microsoft/callback`）を登録する。手元の開発では `http://localhost:<ポート>/auth/microsoft/callback` も足す
3. 「証明書とシークレット」でクライアントシークレットを作り、値を `MICROSOFT_CLIENT_SECRET` に、概要の「アプリケーション (クライアント) ID」を `MICROSOFT_CLIENT_ID` に設定する。シークレットには期限があるので、切れる前に作り直してください
4. 「トークン構成」で、ID トークンに省略可能な要求 `email` と `xms_edov` を追加する。`xms_edov` がないと、組織のアカウントのメールアドレスを確かめられず、既存のアカウントとの照合と新規登録ができません（アカウント画面からの連携はできます）

- 戻り先の URL は `APP_ORIGIN`（なければ要求の URL）から作ります。リバースプロキシの後ろでは `APP_ORIGIN` を設定してください
- `MICROSOFT_TENANT` は既定で `common`（組織と個人のどちらのアカウントでも可）です。`organizations`（組織のアカウントだけ）・`consumers`（個人のアカウントだけ）・テナント ID（その組織だけ）も選べます。`MICROSOFT_CLIENT_ID` を設定するなら `MICROSOFT_CLIENT_SECRET` も必須で、Moodle モードでは使いません
