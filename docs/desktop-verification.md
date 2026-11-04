# デスクトップ版の検証記録

2026-11-04、macOS arm64 上で実施。当時は SPACE-client のブランチ内で作業しており、以下のコマンド名・パスはその時点のもの（現在は `npm test` など。README を参照）。基点は SPACE-client の main `e2634df`。ブランチは `feature/production-desktop`。本番へ書き込む操作、こちらからの push・タグ作成・Release 公開・Azure 設定変更は行っていない。

## 各段階の結果

| 段階 | 確認済み | 残る確認 |
| --- | --- | --- |
| 骨組み | 型検査、lint、Web 本番ビルド、Electron 起動、本番ログイン画面の表示 | 実アカウントのログイン・投稿・DM・画像・規約・登録 OTP・パスワード再設定 |
| 通信・安全 | 実 Electron で REST/SSE/WS/PUT/fetch の Origin、CORS 拒否、外部遷移・リダイレクト・popup・権限の拒否、子フレームと別 WebContents の IPC 拒否 | 本番認証後の通信の実測 |
| 通知・常駐 | 実 React Provider と模擬 SSE、通知＋DM の合計、フォーカス時の OS 通知抑制、閉じて60秒後も接続を維持、再送を通知しない、通知クリックで復帰、ログアウトで接続とバッジを消去、ウィンドウ位置の保存、読み込み失敗からの復帰 | OS の通知センター・Windows トースト・集中モード・ログイン時起動・二重起動・モニター切り離しの実機確認 |
| 更新・配布 | 最低版数でリモート画面を閉じる。ローカル generic provider の 0.0.1 → 0.0.2 を Mac の実 updater で検出し、ダウンロードしないことを確認。NSIS x64、Mac arm64/x64 の dmg/zip の生成 | Windows でのインストールと自動更新による再起動、Intel Mac の実行、Gatekeeper の確認 |
| 文書 | 方針・本番設定の扱い・配布・Windows 実機手順を記載。actionlint 合格 | 実機結果の追記、ユーザーによるレビュー・配信 |

実機を必要とする完了条件が残るため、全段階の受け入れ完了・公開可能とは扱わない。

## 自動確認

- `npm run typecheck`: 合格。
- `npm run lint`: 合格。
- `npm run build`: 合格。
- `npm run test:desktop`: 18件、全件合格。通知表示は OS へ実送信せず、Electron の Notification.show をテスト内で置き換え、実物の通知オブジェクトのクリックを発火した。
- 既存 Web の `refresh-fallback`、`chat-stamps`、`chat-threads`、`integration-admin`: 9件、全件合格。ローカルの Vite と既存の API モックを使用。
- 通常ブラウザで bridge が無いとき、トーストと hidden 時の SSE 切断を維持することを追加テストで確認。
- actionlint 1.7.7 で `.github/workflows/desktop.yml`: 合格。
- Node.js 20.20.2 で別ディレクトリへの `npm ci` と Web の Vite 本番ビルド: 合格。Electron 関連の Node.js 22.12 以降を要求する依存には EBADENGINE 警告が出るが、この確認では失敗しなかった。デスクトップの開発と CI は Node.js 22.12 以降を使用する。
- 本番ログイン画面: URL `https://senshu-universe.com/`、メールアドレス入力の表示、bridge の公開、JavaScript 実行エラー0件を確認。ログイン操作はしていない。
- app.asar を検査し、画面の dist/・src/・同梱サーバーが無いことと、main/preload/更新ライブラリが入っていることを確認。

## 実装上の判断

常駐のため backgroundThrottling=false にすると、非表示でも document.hasFocus() が true、visibilityState が visible のままになる場合があった。画面側で通知を落とさず、main の BrowserWindow.isFocused() を最終判断にした。デスクトップの hidden 分岐もテストで明示的に発火し、接続を閉じないことを確認した。

外部への遷移が拒否された際、did-start-navigation で通知の受信準備まで解除すると、その後の通知クリックが効かなくなる問題が見つかった。文書が実際に切り替わった did-navigate でだけ解除するように修正し、回帰テストを通した。

アプリの画面は本番の Web なので、このブランチの Web bridge 対応を配信するまで、本番アプリの OS 通知・バッジは有効にならない。デモの React コードやサーバーは移植していない。

最終配布物の latest.yml / latest-mac.yml は対象ファイルのサイズと SHA-512 が一致した。Windows と Mac 両アーキテクチャの app.asar の main が最終ビルドと一致した。Mac 両アーキテクチャは codesign の deep/strict 検証に合格し、arm64 のパッケージを実際に起動して起動直後に終了しないことを確認した。ダウンロード後の quarantine / Gatekeeper と Intel Mac の実行は未確認。
