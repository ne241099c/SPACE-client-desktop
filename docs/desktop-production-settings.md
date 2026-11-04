# 本番接続と安全設定

## 本番の設定変更は不要

画面の URL は https://senshu-universe.com。API はその Web 画面の設定をそのまま使う。app:// の画面を作らないので、サーバーの ALLOWED_ORIGINS と Blob の CORS にアプリ用オリジンを追加しない。Web と同じ Origin、メソッド、ヘッダーを許可する既存の設定を使う。本番の設定は変更していない。

## 実測と未確認の範囲

実物の Electron 45.2.2 とループバックの Web/API サーバーで、POST（JSON＋Authorization）、SSE、WebSocket、Blob 相当の PUT（Content-Type と x-ms-blob-type）、規約相当の fetch を送信した。すべての Origin は開いているテスト用 Web サイト自身の `http://127.0.0.1:<port>` だった。POST と PUT の OPTIONS も同じ Origin だった。CORS の許可を返さない fetch はブラウザに拒否された。

本番のログイン画面も Electron 内で表示でき、JavaScript の実行エラーはなかった。本番アカウントを使う REST/WS/SSE・Blob アップロード・規約の取得は未確認。ローカルの模擬サーバーでの実測を、本番での全通信の実測とは扱わない。

## アプリ側の制限

- nodeIntegration=false、contextIsolation=true、sandbox=true、webSecurity=true。配布物の DevTools は無効。
- 遷移・リダイレクトは本番の完全一致オリジンに限定。子フレームへの遷移、webview、権限の要求を拒否する。
- window.open はウィンドウを作らず、資格情報を含まない http(s) URL だけを既定のブラウザに渡す。
- HTML の受信時、アプリ内にだけ追加の CSP を付ける。connect-src は自身・本番 API の HTTPS/WSS・Azure Blob の HTTPS に限定。画像・メディアの HTTPS と data/blob は用途に応じて許可。既存 HTML の初期テーマ用 inline script と React の inline style は許可している。unsafe-eval、object、子フレームは許可しない。サーバーが返す既存の CSP は残す。
- 証明書の検証を差し替えない。CORS を無効化せず、通信の Origin ヘッダーも書き換えない。
- preload は信頼した URL のメインフレームだけに5種類の bridge を渡す。IPC の受信時は URL に加え、対象 WebContents と mainFrame の一致を検証する。
- 通知の文言は長さを制限。リンクは内部の絶対パスだけを許可し、//、バックスラッシュ、制御文字を拒否する。未読数は0以上999999以下の整数だけを受け付ける。
- appId だけでなく userData も `jp.senshu-universe.app`、partition も `persist:senshu-universe-production` としてデモから分離する。
- 開発起動だけループバックの HTTP オリジンを指定できる。配布物では関連の環境変数を無視する。

安全設定の参考：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)。
