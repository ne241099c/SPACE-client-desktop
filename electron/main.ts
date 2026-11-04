import { app, ipcMain, Menu, nativeImage, Notification, Tray, powerMonitor, dialog } from 'electron';
import path from 'node:path';
import { APP_ID, PRODUCT_NAME, USER_DATA_DIR, siteOrigin } from './config';
import { createSnsWindow } from './windows';
import { isInternalLink, isTrustedSender, isTrustedUrl, validNotification } from './security';
import { loadBounds, saveBounds } from './settings';
import { IPC, type DesktopNotification } from '../shared/desktop';
import { setBadge } from './badge';
import { compareVersions, DesktopUpdates, minimumVersion, UPDATE_INTERVAL } from './updates';

// appId だけでは Electron の userData 名は変わらないため、保存先も明示的に分ける。
app.setName(PRODUCT_NAME);
const devProfile = !app.isPackaged ? process.env.SPACE_DESKTOP_PROFILE : undefined;
if (devProfile && !/^[a-zA-Z0-9_-]{1,48}$/.test(devProfile)) throw new Error('プロファイル名が不正です。');
app.setPath('userData', devProfile
  ? path.join(app.getPath('temp'), `senshu-universe-test-${devProfile}`)
  : path.join(app.getPath('appData'), USER_DATA_DIR));
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let quitting = false;
  let openWindow: (() => void) | undefined;
  app.on('second-instance', () => openWindow?.());
  app.on('activate', () => openWindow?.());
  app.on('before-quit', () => { quitting = true; });
  // 閉じる操作ではウィンドウを破棄しない。SSE を扱う画面を残す。
  app.on('window-all-closed', () => { if (quitting) app.quit(); });

  void app.whenReady().then(() => {
    const origin = siteOrigin();
    const win = createSnsWindow(origin, app.getVersion(), loadBounds());
    const updates = new DesktopUpdates(win);
    let pendingLink: string | undefined;
    let navigationReady = false;
    let retryNeeded = false;
    let loading = false;
    let requiredVersion: string | undefined;
    const activeNotifications = new Set<Notification>();
    let lastNotificationAt = 0;
    let pendingNotification: { payload: DesktopNotification; count: number } | undefined;
    let notificationTimer: NodeJS.Timeout | undefined;

    const show = () => {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
    };
    openWindow = show;
    const status = () => win.loadFile(path.join(__dirname, 'status.html')).catch(() => {});
    const load = async () => {
      if (loading || quitting) return;
      loading = true;
      try {
        try {
          const minimum = await minimumVersion(origin);
          requiredVersion = minimum && compareVersions(app.getVersion(), minimum) < 0 ? minimum : undefined;
        } catch { /* オフライン時は最後に確認した最低版数を維持する。 */ }
        if (requiredVersion) {
          retryNeeded = true;
          updates.publish({ status: 'required', version: requiredVersion });
          await status();
          show();
          await dialog.showMessageBox(win, { type: 'warning', message: `このアプリは ${requiredVersion} 以降への更新が必要です。メニューの「更新を確認」を選んでください。` });
          return;
        }
        retryNeeded = false;
        await win.loadURL(`${origin}/`);
      } catch {
        retryNeeded = true;
        await status();
      } finally { loading = false; }
    };
    const navigate = (link: string) => {
      if (!isInternalLink(link)) return;
      show();
      if (navigationReady && isTrustedUrl(win.webContents.getURL(), origin)) win.webContents.send(IPC.navigate, link);
      else { pendingLink = link; if (!isTrustedUrl(win.webContents.getURL(), origin)) void load(); }
    };

    win.on('close', (event) => {
      saveBounds(win.getNormalBounds());
      if (!quitting) { event.preventDefault(); win.hide(); }
    });
    // 拒否された遷移では元の文書が残るため、文書が実際に切り替わった時だけ解除する。
    win.webContents.on('did-navigate', () => { navigationReady = false; });
    win.webContents.on('render-process-gone', () => { navigationReady = false; retryNeeded = true; });

    ipcMain.on(IPC.navigateReady, (event) => {
      if (!isTrustedSender(event, win.webContents, origin)) return;
      navigationReady = true;
      if (pendingLink) { const link = pendingLink; pendingLink = undefined; navigate(link); }
    });
    ipcMain.on(IPC.updateReady, (event) => {
      if (isTrustedSender(event, win.webContents, origin)) event.reply(IPC.update, updates.state);
    });
    ipcMain.on(IPC.unread, (event, count: unknown) => {
      if (!isTrustedSender(event, win.webContents, origin) || typeof count !== 'number'
        || !Number.isSafeInteger(count) || count < 0 || count > 999999) return;
      setBadge(win, count);
    });
    const showNotification = (payload: DesktopNotification, skipped: number) => {
      lastNotificationAt = Date.now();
      if (activeNotifications.size >= 20) {
        const oldest = activeNotifications.values().next().value;
        oldest?.close();
        if (oldest) activeNotifications.delete(oldest);
      }
      const body = skipped > 0 ? `${payload.body}（ほか ${skipped} 件）` : payload.body;
      const notification = new Notification({ title: payload.title, body });
      activeNotifications.add(notification);
      notification.on('click', () => { navigate(payload.link); activeNotifications.delete(notification); });
      notification.on('close', () => activeNotifications.delete(notification));
      notification.on('failed', () => activeNotifications.delete(notification));
      notification.show();
    };
    ipcMain.on(IPC.notify, (event, payload: unknown) => {
      if (!isTrustedSender(event, win.webContents, origin) || !validNotification(payload)
        || win.isFocused() || !Notification.isSupported()) return;
      // OS 通知は1秒に1件までにする。間に届いた分は落とさず、最新の1件に「ほか N 件」としてまとめる。
      // 内容や送信先をログへ残さない。
      const wait = 1000 - (Date.now() - lastNotificationAt);
      if (wait <= 0 && !pendingNotification) { showNotification(payload, 0); return; }
      pendingNotification = { payload, count: (pendingNotification?.count ?? 0) + 1 };
      notificationTimer ??= setTimeout(() => {
        notificationTimer = undefined;
        const pending = pendingNotification;
        pendingNotification = undefined;
        if (pending && !win.isFocused()) showNotification(pending.payload, pending.count - 1);
      }, Math.max(0, wait));
    });

    const toggleStartup = () => {
      if (!app.isPackaged) return;
      app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin });
      menu();
    };
    const trayImage = nativeImage.createFromPath(path.join(__dirname, '../build/icon.png')).resize({ width: 20, height: 20 });
    const tray = new Tray(trayImage);
    tray.setToolTip(PRODUCT_NAME);
    tray.on('click', show);
    tray.on('double-click', show);
    function menu() {
      const startup = {
        label: 'ログイン時に起動', type: 'checkbox' as const, enabled: app.isPackaged,
        checked: app.isPackaged && app.getLoginItemSettings().openAtLogin, click: toggleStartup,
      };
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '開く', click: show }, startup, { type: 'separator' }, { label: '終了', role: 'quit' },
      ]));
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: PRODUCT_NAME, submenu: [
          { label: '開く', click: show }, { label: '再接続', click: () => void load() },
          { label: '更新を確認', click: () => void updates.check(true) }, startup,
          { type: 'separator' }, { label: '終了', role: 'quit' },
        ] },
        { role: 'editMenu', label: '編集' },
        { label: '表示', submenu: [
          { label: '再読み込み', role: 'reload' }, { label: '実際のサイズ', role: 'resetZoom' },
          { label: '拡大', role: 'zoomIn' }, { label: '縮小', role: 'zoomOut' },
          { label: '全画面表示', role: 'togglefullscreen' },
          ...(!app.isPackaged ? [{ label: '開発者ツール', role: 'toggleDevTools' as const }] : []),
        ] },
        { role: 'windowMenu', label: 'ウィンドウ' },
      ]));
    }
    menu();
    const retryTimer = setInterval(() => { if (retryNeeded && !requiredVersion) void load(); }, 30000);
    const updateTimer = setInterval(() => {
      void updates.check();
      // 最低版数の確認は画面を読み込み直さず行う。
      void minimumVersion(origin).then(async (minimum) => {
        if (!minimum || compareVersions(app.getVersion(), minimum) >= 0) return;
        requiredVersion = minimum;
        navigationReady = false;
        setBadge(win, 0);
        await status();
        show();
        await dialog.showMessageBox(win, { type: 'warning', message: `${minimum} 以降への更新が必要です。` });
      }).catch(() => {});
    }, UPDATE_INTERVAL);
    powerMonitor.on('resume', () => { if (retryNeeded) void load(); });
    app.once('will-quit', () => {
      clearInterval(retryTimer); clearInterval(updateTimer);
      if (notificationTimer) clearTimeout(notificationTimer);
      tray.destroy();
      for (const notification of activeNotifications) notification.close();
    });
    void load();
    void updates.check();
  }).catch(() => {
    dialog.showErrorBox(PRODUCT_NAME, 'アプリを起動できませんでした。再起動してください。');
    app.quit();
  });
}
