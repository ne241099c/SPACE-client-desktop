# デスクトップ版の配布

## 現在の扱い

CI は配布物を Actions artifact に保存するだけで、Release の公開権限を持たない。タグの作成と Release の公開は、人が内容を確認して行う。

## Web とアプリの順序

1. Web 側（SPACE-client）の bridge 対応をレビュー・配信する。通常ブラウザでは OS 通知の IPC は発生しない。Azure の既存デプロイワークフローは変更していない。
2. テスト用アカウントで、返信・DM、クリック遷移、ログアウト、画像の PUT、規約、登録 OTP とパスワード再設定を確認する。
3. Windows 実機のチェックリストを埋める。
4. 配布版の `package.json` と lockfile の version を揃える。現在の 0.0.0 は初期開発用。最初の公開時は例えば 0.1.0 とする。プレリリース版数はこの実装の対象外。
5. ユーザーがこのリポジトリで `v<version>` タグを作って push すると、Windows と Mac の CI が配布物を作る。main への push・PR では検証だけ行い、配布物は作らない。workflow_dispatch でも試作できる。公開前に tag と package.json の一致を確認する。
6. ユーザーが CI の artifact を取得し、以下のファイルだけをこのリポジトリ（SPACE-client-desktop）の GitHub Release に添付する。draft の間は利用者に更新されない。確認後にユーザーが正式公開する。

## 添付するファイル

- Windows: `Senshu-Universe-<version>-win-x64-setup.exe`、同名 `.exe.blockmap`、`latest.yml`。
- Mac: `Senshu-Universe-<version>-mac-arm64.dmg`、`-mac-x64.dmg`、各アーキテクチャの `.zip` と `.zip.blockmap`、生成された `latest-mac.yml`。
- `builder-debug.yml`、展開済みのディレクトリ、内部の設定ファイルは配布しない。

GitHub provider は公開された最新 Release を見るため、別用途の Release を同じリポジトリで「最新」にすると更新用ファイルが見つからなくなる。このリポジトリの Release はデスクトップ配布物専用にし、最新の正式 Release は `v<version>` にする。private リポジトリの利用者向け更新は現状未対応であり、配布前に Release のファイルを未ログインでも取得できることを確認する。トークンをアプリへ埋め込まない。

## ローカルで作る

Node.js 22.12 以降で `npm ci`、`npm run typecheck`、`npm run lint`、`npm test` を行った後、`npm run dist:win` または `npm run dist:mac`。どちらも `--publish never` を指定している。Mac は macOS 上でビルドする。配布物に React 画面の dist/、API サーバー、LAN 探索、証明書ピン留め、ローカルの .env は入れない。

Windows はユーザー単位の NSIS。Mac は arm64/x64 の dmg と zip、ad-hoc 署名で、Developer ID 署名と公証は行わない。SmartScreen / Gatekeeper の表示と OS 通知は実機でも確認する。

## 更新の動き

起動時と6時間ごとに確認する。Windows は裏でダウンロードし、利用者が「再起動して更新」を選ぶとインストールする。Mac はダウンロードせず、「配布ページを開く」を出す。後回しにした案内はメニューの「更新を確認」からもう一度開ける。開発起動では本番 Release に問い合わせない。

Mac に Developer ID 署名・公証と CI の証明書を導入した後は、ビルドの ad-hoc 署名を実署名に変更し、実行時の `electron/config.ts` の `MAC_AUTO_UPDATE` を true にする。署名情報をソースへ保存しない。

## 最低版数

Web 側（SPACE-client）の `public/desktop-version.json` を Web と一緒に配信する。初期値は `{ "minimum": "0.0.0" }`。これは API 互換性ではなく、bridge・Electron 自体などネイティブ部分の互換性・安全性のために使う。画面は常に Web の最新版なので、通常の API 変更だけで上げる必要はない。

最低版数は起動時と6時間ごとに確認し、古いアプリではリモート画面を閉じて更新を案内する。取得できない場合はその起動中に最後に確認した制限を維持し、未取得なら表示を試みる。最低版数はアプリ終了後には保存しない。新しいアプリの入手方法を用意した後で引き上げること。署名の無い Mac 利用者は手動更新が必要。
