import { app, BrowserWindow, session, shell, screen, type Rectangle } from 'electron';
import path from 'node:path';
import { externalUrl, isTrustedUrl } from './security';

export function createSnsWindow(origin: string, version: string, bounds?: Rectangle): BrowserWindow {
  const ses = session.fromPartition('persist:senshu-universe-production');
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // 本番のレスポンスを変更せず、アプリ内で受け取る HTML にだけ CSP を追加する。
  // 既存 index.html の初期テーマ設定は inline script のため許可する。
  const developmentConnections = origin.startsWith('http:') ? ' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*' : '';
  const csp = [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' https://api.senshu-universe.com wss://api.senshu-universe.com https://*.blob.core.windows.net${developmentConnections}`,
    "img-src 'self' https: data: blob:", "media-src 'self' https: blob:", "font-src 'self' data:",
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-src 'none'", "form-action 'self'",
  ].join('; ');
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.resourceType === 'mainFrame' && isTrustedUrl(details.url, origin)) {
      const name = Object.keys(headers).find((key) => key.toLowerCase() === 'content-security-policy') ?? 'Content-Security-Policy';
      headers[name] = [...(headers[name] ?? []), csp];
    }
    callback({ responseHeaders: headers });
  });
  ses.on('will-download', (_event, item) => {
    // ダウンロード完了後も、ファイルを自動で開く処理は設けない。
    item.setSaveDialogOptions({ title: '添付ファイルを保存' });
  });
  const visibleBounds = bounds && screen.getAllDisplays().some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x
    && bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y);
  const win = new BrowserWindow({
    width: 1280, height: 860, ...(visibleBounds ? bounds : {}), minWidth: 900, minHeight: 600,
    title: 'Senshu-Universe', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      session: ses, preload: path.join(__dirname, 'preload-sns.cjs'),
      additionalArguments: [`--space-origin=${origin}`, `--space-version=${version}`],
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, origin)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url, origin)) event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedUrl(event.url, origin)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  return win;
}
