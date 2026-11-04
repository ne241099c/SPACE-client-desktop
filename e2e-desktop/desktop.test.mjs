// 本番・実アカウントには接続せず、実物の Electron とローカルサイトで検証する。
import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Web 側（SPACE-client）の Provider と bridge の受け口を、実際のソースで検証する。
// 既定は隣に置いた SPACE-client。無い場合はその検証だけ飛ばす（CI では SPACE_WEB_REQUIRED=1 で失敗にする）。
const webDir = path.resolve(process.env.SPACE_WEB_DIR ?? path.join(root, '../SPACE-client'));
const webReady = await fs.access(path.join(webDir, 'src/components/DesktopIntegration.tsx')).then(() => true, () => false);
if (!webReady && process.env.SPACE_WEB_REQUIRED === '1') throw new Error(`Web のソースが見つかりません: ${webDir}`);
const webSkip = webReady ? false : `Web のソース（デスクトップ対応済み）が無い: ${webDir}。SPACE_WEB_DIR で指定する`;
const webBuild = {
  alias: { '@web': path.join(webDir, 'src') }, nodePaths: [path.join(webDir, 'node_modules')],
};
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'));
const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const closeServer = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

async function launch(origin) {
  const application = await electron.launch({
    args: [root], cwd: root,
    env: { ...env, SPACE_DESKTOP_URL: origin, SPACE_DESKTOP_PROFILE: randomUUID() },
  });
  const page = await application.firstWindow();
  await page.waitForURL(`${origin}/`);
  await page.waitForFunction(() => !!window.spaceDesktop);
  return { application, page };
}
async function dispose(application) {
  const dir = await application.evaluate(({ app }) => app.getPath('userData'));
  await application.close();
  await fs.rm(dir, { recursive: true, force: true });
}

const fixture = `<!doctype html><title>検証用サイト</title><h1>検証用サイト</h1>
<script>
window.navigated = [];
spaceDesktop.onNavigate(link => { navigated.push(link); history.pushState({}, '', link); });
</script>`;

test('Electron: 信頼境界・常駐・通知クリック・通信オリジン', { timeout: 90000 }, async (t) => {
  const site = createServer((req, res) => {
    if (req.url === '/desktop-version.json') {
      res.setHeader('Content-Type', 'application/json'); res.end('{"minimum":"0.0.0"}');
    } else {
      res.setHeader('Content-Type', 'text/html'); res.end(fixture);
    }
  });
  const origin = await listen(site);
  let application;
  const sockets = new Set();
  let api;
  try {
    const launched = await launch(origin);
    application = launched.application;
    const page = launched.page;
    await t.test('sandbox と最小の bridge、保存先分離', async () => {
      assert.deepEqual(await page.evaluate(() => Object.keys(window.spaceDesktop).sort()),
        ['notify', 'onNavigate', 'onUpdateState', 'setUnreadCount', 'version']);
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      const prefs = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
      assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.webSecurity, true);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()), false);
      assert.ok(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.storagePath.endsWith('senshu-universe-production')));
    });
    await t.test('外部遷移・リダイレクト・popup・権限を拒否', async () => {
      await page.route(`${origin}/redirect`, (route) => route.fulfill({ status: 302, headers: { location: 'https://example.com' } }));
      await page.evaluate(() => { location.href = 'https://example.com'; });
      await page.waitForTimeout(200);
      assert.equal(page.url(), `${origin}/`);
      await page.evaluate(() => { location.href = '/redirect'; });
      await page.waitForTimeout(200);
      assert.equal(page.url(), `${origin}/`);
      await page.evaluate(() => window.open('javascript:alert(1)'));
      assert.equal(application.windows().length, 1);
      assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
      assert.equal(await page.evaluate(() => new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), (e) => resolve(e.code)))), 1);
    });
    await t.test('iframe へ bridge を公開しない', async () => {
      await page.evaluate(() => { const f = document.createElement('iframe'); f.src = '/child'; document.body.append(f); });
      await expect.poll(() => page.frames().length).toBe(2);
      await expect.poll(() => page.frames()[1].evaluate(() => typeof window.spaceDesktop)).toBe('undefined');
    });
    // OS の通知表示を置き換え、実通知を送らず main の通知作成とクリックを通す。
    await application.evaluate(({ Notification, app, dialog }) => {
      globalThis.desktopTest = { notifications: [], badges: [], dialogs: [] };
      Notification.isSupported = () => true;
      Notification.prototype.show = function () { globalThis.desktopTest.notifications.push(this); };
      app.setBadgeCount = (count) => { globalThis.desktopTest.badges.push(count); return true; };
      dialog.showMessageBox = async (_window, options) => { globalThis.desktopTest.dialogs.push(options.message); return { response: 1 }; };
    });
    await t.test('閉じても renderer が残り、通知クリックで復帰して遷移', async () => {
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
      await page.evaluate(() => spaceDesktop.notify({ title: 'テスト', body: 'DM を受信', link: '/dm/room1' }));
      await expect.poll(() => application.evaluate(() => globalThis.desktopTest.notifications.length)).toBe(1);
      await application.evaluate(() => globalThis.desktopTest.notifications[0].emit('click'));
      await expect(page).toHaveURL(`${origin}/dm/room1`);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    });
    await t.test('IPC の不正な送り主と引数を無視', async () => {
      await application.evaluate(({ BrowserWindow, ipcMain }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const payload = { title: '悪い通知', body: '無視する', link: '/home' };
        const badEvent = { sender: win.webContents, senderFrame: { url: win.webContents.getURL() } };
        ipcMain.emit('desktop:notify', badEvent, payload);
        ipcMain.emit('desktop:unread', badEvent, 123);
      });
      await page.evaluate(() => {
        for (const link of ['//evil.example', '/\\evil.example', '/%2fevil.example', 'https://evil.example', '/%00bad']) {
          spaceDesktop.notify({ title: '不正', body: '無視する', link });
        }
        for (const count of [-1, 1.2, NaN, Infinity, '12', 1000000]) spaceDesktop.setUnreadCount(count);
      });
      await page.waitForTimeout(100);
      assert.equal(await application.evaluate(() => globalThis.desktopTest.notifications.length), 1);
      assert.deepEqual(await application.evaluate(() => globalThis.desktopTest.badges), []);
      await page.evaluate(() => { spaceDesktop.setUnreadCount(7); spaceDesktop.setUnreadCount(0); });
      if (process.platform === 'darwin') await expect.poll(() => application.evaluate(() => globalThis.desktopTest.badges)).toEqual([7, 0]);
    });
    await t.test('連続した通知は落とさず、1秒ごとにまとめて表示', async () => {
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
      const before = await application.evaluate(() => globalThis.desktopTest.notifications.length);
      await page.evaluate(() => {
        for (const n of [1, 2, 3]) spaceDesktop.notify({ title: 'テスト', body: `連続${n}`, link: `/dm/room${n}` });
      });
      await expect.poll(() => application.evaluate(() => globalThis.desktopTest.notifications.at(-1)?.body), { timeout: 3000 })
        .toMatch(/^連続3（ほか [12] 件）$/);
      const added = await application.evaluate(() => globalThis.desktopTest.notifications.length) - before;
      assert.ok(added >= 1 && added <= 2, `通知は最大2件に抑える: ${added}`);
    });
    await t.test('別 WebContents が同じ URL を開いても IPC を受け付けない', async () => {
      await application.evaluate(async ({ BrowserWindow, ipcMain }) => {
        const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        const url = BrowserWindow.getAllWindows().find((w) => w !== other).webContents.getURL();
        await other.loadURL(url);
        ipcMain.emit('desktop:unread', { sender: other.webContents, senderFrame: other.webContents.mainFrame }, 876);
        other.destroy();
      });
      assert.equal((await application.evaluate(() => globalThis.desktopTest.badges)).includes(876), false);
    });
    await t.test('REST・SSE・Blob PUT/fetch・WebSocket の Origin を実測', async () => {
      const observed = [];
      api = createServer((req, res) => {
        observed.push({ path: req.url, method: req.method, origin: req.headers.origin });
        const allow = req.url !== '/denied';
        if (allow) res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ms-blob-type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.url === '/events') { res.setHeader('Content-Type', 'text/event-stream'); res.end('data: ok\n\n'); }
        else res.end('ok');
      });
      api.on('upgrade', (req, socket) => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        observed.push({ path: req.url, method: 'WS', origin: req.headers.origin });
        const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      });
      const apiOrigin = await listen(api);
      const results = await page.evaluate(async (apiOrigin) => {
        const rest = await fetch(`${apiOrigin}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' }, body: '{}' }).then((r) => r.text());
        const put = await fetch(`${apiOrigin}/blob`, { method: 'PUT', headers: { 'Content-Type': 'image/png', 'x-ms-blob-type': 'BlockBlob' }, body: 'test' }).then((r) => r.text());
        const blob = await fetch(`${apiOrigin}/terms`).then((r) => r.text());
        const sse = await new Promise((resolve) => { const source = new EventSource(`${apiOrigin}/events`); source.onmessage = () => { source.close(); resolve('ok'); }; });
        const ws = await new Promise((resolve) => { const socket = new WebSocket(`${apiOrigin.replace('http:', 'ws:')}/ws`); socket.onopen = () => { socket.close(); resolve('ok'); }; });
        const denied = await fetch(`${apiOrigin}/denied`).then(() => false, () => true);
        return { rest, put, blob, sse, ws, denied };
      }, apiOrigin);
      assert.deepEqual(results, { rest: 'ok', put: 'ok', blob: 'ok', sse: 'ok', ws: 'ok', denied: true });
      for (const endpoint of ['/query', '/blob', '/terms', '/events', '/ws']) {
        assert.ok(observed.some((r) => r.path === endpoint && r.origin === origin && r.method !== 'OPTIONS'), endpoint);
      }
      t.diagnostic(`実測 Origin: ${origin}（ローカルテストサイト自身のオリジン）`);
    });
    await t.test('最低版数が上がるとリモート画面を閉じる', async () => {
      await application.evaluate(({ net }) => {
        net.fetch = async () => new Response('{"minimum":"99.0.0"}', { headers: { 'Content-Type': 'application/json' } });
      });
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find((item) => item.label === '再接続').click());
      await page.waitForURL('file:///**/status.html');
      assert.equal(await page.evaluate(() => typeof window.spaceDesktop), 'undefined');
      assert.ok((await application.evaluate(() => globalThis.desktopTest.dialogs)).some((text) => text.includes('99.0.0')));
    });
  } finally {
    if (application) await dispose(application);
    for (const socket of sockets) socket.destroy();
    if (api) await closeServer(api);
    await closeServer(site);
  }
});

test('版数比較と未読集計の切り替え', { skip: webSkip }, async () => {
  // ブラウザ側の副作用がない集計関数を、実コードから束ねて確認する。
  const result = await build({ entryPoints: [path.join(webDir, 'src/lib/desktop.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
  const { desktopBadgeCount } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  assert.equal(desktopBadgeCount(3, 5), 8);
  assert.equal(desktopBadgeCount(3, 5, 'notifications'), 3);
  assert.equal(desktopBadgeCount(3, 5, 'dm'), 5);
});

test('既存の React Provider: SSE・未読・ログアウトと Web の互換性', { timeout: 90000, skip: webSkip }, async (t) => {
  const { chromium } = await import('@playwright/test');
  const fixtureBuild = await build({
    ...webBuild,
    entryPoints: ['e2e-desktop/notification-fixture.tsx'], bundle: true, platform: 'browser', format: 'esm',
    jsx: 'automatic', write: false,
    define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: '/query' }), 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  const streams = new Set();
  const site = createServer(async (req, res) => {
    if (req.url === '/desktop-version.json') { res.end('{"minimum":"0.0.0"}'); return; }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixtureBuild.outputFiles[0].text); return; }
    if (req.url.startsWith('/events?')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: connected\ndata: {}\n\n'); streams.add(res);
      req.on('close', () => streams.delete(res)); return;
    }
    if (req.url === '/query') {
      for await (const chunk of req) { void chunk; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: {
        myUnreadNotificationCount: 3, issueNotificationStreamTicket: 'fixture-ticket',
        myTermsConsentStatus: { isConsented: true, currentTerms: null },
        myUnreadDMCount: 5, myUnreadCommunityCount: 0, myCourseRoomUnreadCounts: [],
      } })); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script>');
  });
  const origin = await listen(site);
  const send = (payload) => {
    for (const stream of streams) stream.write(`event: notification\ndata: ${JSON.stringify({ id: randomUUID(), type: 'dm', message: 'DMを受信', targetType: 'room', targetID: 'room2', ...payload })}\n\n`);
  };
  let application, browser;
  try {
    const launched = await launch(origin); application = launched.application;
    const page = launched.page;
    page.on('pageerror', (error) => t.diagnostic(error.message));
    page.on('console', (message) => { if (message.type() === 'error') t.diagnostic(message.text()); });
    await application.evaluate(({ Notification, app }) => {
      globalThis.desktopTest = { notifications: [], badges: [] };
      Notification.isSupported = () => true;
      Notification.prototype.show = function () { globalThis.desktopTest.notifications.push(this); };
      app.setBadgeCount = (count) => { globalThis.desktopTest.badges.push(count); return true; };
    });
    // Spy を設定してから Provider を読み直し、初回の集計も捕捉する。
    await page.reload();
    await expect.poll(() => streams.size).toBe(1);
    await expect(page.getByText('ログイン済み')).toBeVisible();
    await page.waitForTimeout(100);
    await t.test('通知3＋DM5の合計を送る', async () => {
      if (process.platform === 'darwin') await expect.poll(() => application.evaluate(() => globalThis.desktopTest.badges.at(-1))).toBe(8);
    });
    await t.test('フォーカス中は既存トーストだけを出す', async () => {
      await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      send({ message: 'フォーカス中のDM' });
      await expect(page.locator('#toasts')).toContainText('フォーカス中のDM');
      assert.equal(await application.evaluate(() => globalThis.desktopTest.notifications.length), 0);
    });
    await t.test('非表示で60秒を過ぎても接続維持、再送は通知しない', async () => {
      await page.clock.install();
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
      // backgroundThrottling=false の Electron は visibilityState を visible に保つ場合がある。
      // hidden の分岐も明示的に発火させ、将来の Electron の動きでも接続を維持することを確認する。
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.fastForward(61000);
      assert.equal(streams.size, 1);
      send({ replayed: true, message: '再送分' });
      await page.waitForTimeout(50);
      assert.equal(await application.evaluate(() => globalThis.desktopTest.notifications.length), 0);
      send({ message: '非表示中のDM' });
      await expect(page.locator('#toasts')).toContainText('非表示中のDM');
      await expect.poll(() => application.evaluate(() => globalThis.desktopTest.notifications.length)).toBe(1);
      await application.evaluate(() => globalThis.desktopTest.notifications[0].emit('click'));
      await expect(page).toHaveURL(`${origin}/dm/room2`);
    });
    await t.test('ログアウトで通知接続と未読バッジを消去', async () => {
      await page.getByRole('button', { name: 'ログアウト' }).click();
      await expect.poll(() => streams.size).toBe(0);
      if (process.platform === 'darwin') await expect.poll(() => application.evaluate(() => globalThis.desktopTest.badges.at(-1))).toBe(0);
    });
    await dispose(application); application = undefined;
    await t.test('通常ブラウザは bridge なしで既存トースト・hidden 時の切断を維持', async () => {
      browser = await chromium.launch();
      const web = await browser.newPage();
      await web.goto(origin);
      assert.equal(await web.evaluate(() => typeof window.spaceDesktop), 'undefined');
      await expect.poll(() => streams.size).toBe(1);
      send({ message: 'WebのDM' });
      await expect(web.locator('#toasts')).toContainText('WebのDM');
      await web.clock.install();
      await web.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await web.clock.fastForward(61000);
      await expect.poll(() => streams.size).toBe(0);
    });
  } finally {
    if (application) await dispose(application);
    await browser?.close();
    for (const stream of streams) stream.end();
    await closeServer(site);
  }
});

test('ローカル更新サーバー: Mac は 0.0.1 → 0.0.2 を案内し、ダウンロードしない', { timeout: 60000 }, async (t) => {
  if (process.platform !== 'darwin') { t.skip('Mac 更新案内は macOS ランナーで確認する'); return; }
  const requests = [];
  const site = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/desktop-version.json') { res.end('{"minimum":"0.0.0"}'); return; }
    if (req.url.startsWith('/latest-mac.yml')) {
      res.end(`version: 0.0.2\nfiles:\n  - url: Senshu-Universe-0.0.2.zip\n    sha512: ${Buffer.alloc(64).toString('base64')}\n    size: 100\npath: Senshu-Universe-0.0.2.zip\nsha512: ${Buffer.alloc(64).toString('base64')}\nreleaseDate: '2026-11-04T00:00:00.000Z'\n`); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end(fixture);
  });
  const origin = await listen(site);
  await fs.mkdir('node_modules/.cache', { recursive: true });
  const helper = path.join(root, 'node_modules/.cache/desktop-updates.cjs');
  await build({ entryPoints: ['electron/updates.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'electron-updater'], outfile: helper });
  let application;
  try {
    ({ application } = await launch(origin));
    const result = await application.evaluate(async ({ app, BrowserWindow, dialog }, { origin, helper }) => {
      const require = process.getBuiltinModule('module').createRequire(helper);
      const { MacUpdater } = require('electron-updater');
      const { DesktopUpdates, compareVersions } = require(helper);
      const prompts = [];
      dialog.showMessageBox = async (_window, options) => { prompts.push(options); return { response: 1 }; };
      app.setVersion('0.0.1');
      const updater = new MacUpdater({ provider: 'generic', url: `${origin}/` });
      updater.forceDevUpdateConfig = true;
      const manager = new DesktopUpdates(BrowserWindow.getAllWindows()[0], updater);
      manager.start();
      const states = [];
      updater.on('update-available', () => states.push(manager.state));
      const checked = await updater.checkForUpdates();
      return {
        from: updater.currentVersion.version, to: checked.updateInfo.version,
        autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit,
        state: manager.state, prompts, states,
        versionChecks: [compareVersions('0.0.1', '0.0.2'), compareVersions('0.10.0', '0.2.0'), compareVersions('1.0.0', '1.0.0')],
      };
    }, { origin, helper });
    assert.equal(result.from, '0.0.1'); assert.equal(result.to, '0.0.2');
    assert.equal(result.autoDownload, false); assert.equal(result.autoInstallOnAppQuit, false);
    assert.equal(result.state.status, 'available');
    assert.equal(result.prompts[0].buttons[0], '配布ページを開く');
    assert.deepEqual(result.versionChecks, [-1, 1, 0]);
    assert.ok(requests.some((url) => url.startsWith('/latest-mac.yml')));
    assert.equal(requests.some((url) => url.endsWith('.zip')), false);
  } finally {
    if (application) await dispose(application);
    await fs.rm(helper, { force: true });
    await closeServer(site);
  }
});

test('初回の読み込み失敗から再接続でき、閉じると位置を保存する', { timeout: 30000 }, async () => {
  let unavailable = true;
  const site = createServer((req, res) => {
    if (req.url === '/desktop-version.json') { res.end('{"minimum":"0.0.0"}'); return; }
    if (unavailable) { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'text/html'); res.end(fixture);
  });
  const origin = await listen(site);
  let application;
  try {
    application = await electron.launch({ args: [root], cwd: root, env: { ...env, SPACE_DESKTOP_URL: origin, SPACE_DESKTOP_PROFILE: randomUUID() } });
    const page = await application.firstWindow();
    await page.waitForURL('file:///**/status.html');
    assert.equal(await page.evaluate(() => typeof window.spaceDesktop), 'undefined');
    await page.waitForTimeout(100);
    unavailable = false;
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find((item) => item.label === '再接続').click());
    await page.waitForURL(`${origin}/`);
    await page.waitForFunction(() => !!window.spaceDesktop);
    const bounds = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ x: 100, y: 100, width: 1000, height: 700 });
      const result = win.getNormalBounds(); win.close(); return result;
    });
    const dir = await application.evaluate(({ app }) => app.getPath('userData'));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'window.json'), 'utf8')), bounds);
  } finally {
    if (application) await dispose(application);
    await closeServer(site);
  }
});
