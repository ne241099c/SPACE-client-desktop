# Senshu-Universe デスクトップ

Electron 内で `https://senshu-universe.com` を開く、本番接続のデスクトップアプリです。画面と API は Web の配信（[SPACE-client](https://github.com/Cityboypenguin/SPACE-client)）に追従し、アプリには画面・サーバーを同梱しません。

Web 側には、このアプリとやり取りする小さな受け口だけがあります（`src/lib/desktop.ts`、`src/components/DesktopIntegration.tsx`、`public/desktop-version.json`）。bridge の型は `shared/desktop.ts` と Web 側の `src/lib/desktop.ts` に同じものを置いているので、変えるときは両方を直してください。

```sh
# Node.js 22.12 以降
npm ci
npm start                 # 本番サイトに接続して起動
npm run typecheck
npm run lint
npx playwright install chromium
npm test                  # Web 側の検証には隣の ../SPACE-client を使う（SPACE_WEB_DIR で変更可）
```

開発起動だけ `SPACE_DESKTOP_URL=http://127.0.0.1:5173` でローカルの Web 画面に接続できます。配布アプリでは URL の差し替えを無視し、本番にだけ接続します。

VS Code のターミナルでは `ELECTRON_RUN_AS_NODE=1` が設定されていることがあり、そのままだと Electron が Node として動いて起動に失敗します。`env -u ELECTRON_RUN_AS_NODE npm start` で起動してください。

- 閉じるボタンは非表示にします。Windows はトレイ、Mac は Dock とメニューバーから再表示できます。終了はアプリまたはトレイの「終了」を選びます。
- 起動中でフォーカスが無いときに OS 通知を出します。1秒以内に続いた通知は、最新の1件に「ほか N 件」としてまとめます。終了中・スリープ中の通知受信は対象外です。
- 通知をクリックすると該当ページを開きます。Web 側の受け口が本番配信されるまでは、OS 通知と未読バッジは利用できません。
- バッジは通知の未読数＋DM の未読数です。Web 側 `src/lib/desktop.ts` の `DESKTOP_BADGE_POLICY` で変えられます。
- ログイン時の起動は既定でオフです。メニューで変更できます。
- Windows は NSIS インストーラーと自動更新です。Mac は Developer ID 署名・公証を導入するまで、新版を案内して配布ページを開きます。
- コード署名が無いため、Windows は SmartScreen、Mac は Gatekeeper の警告が出る可能性があります。

[通信と安全設定](docs/desktop-production-settings.md)、[配布手順](docs/release.md)、[Windows 実機確認](docs/windows-verification.md)、[検証記録](docs/desktop-verification.md) を参照してください。
