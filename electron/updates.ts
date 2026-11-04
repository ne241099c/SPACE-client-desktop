import { app, dialog, net, shell, type BrowserWindow } from 'electron';
// 名前付きで読み込む。default 経由だと、esbuild が package.json の "type" によって
// CommonJS の扱いを変え、undefined になる場合がある。
import { autoUpdater } from 'electron-updater';
import { IPC, type UpdateState } from '../shared/desktop';
import { MAC_AUTO_UPDATE, RELEASES_URL } from './config';

export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!pattern.test(a) || !pattern.test(b)) throw new Error('版数は x.y.z 形式にしてください。');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export async function minimumVersion(origin: string): Promise<string | undefined> {
  const response = await net.fetch(`${origin}/desktop-version.json`, {
    cache: 'no-store', signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw new Error('最低版数を取得できません。');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('minimum' in data) || typeof data.minimum !== 'string') {
    throw new Error('最低版数の形式が不正です。');
  }
  compareVersions(data.minimum, '0.0.0');
  return data.minimum;
}

export class DesktopUpdates {
  state: UpdateState = { status: 'idle' };
  private started = false;
  private promptedVersion = '';
  constructor(private win: BrowserWindow, private updater = autoUpdater) {}

  publish(state: UpdateState): void {
    this.state = state;
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.update, state);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.updater.autoDownload = process.platform === 'win32' || MAC_AUTO_UPDATE;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.on('checking-for-update', () => this.publish({ status: 'checking' }));
    this.updater.on('update-not-available', () => this.publish({ status: 'idle' }));
    this.updater.on('error', () => this.publish({ status: 'error' }));
    this.updater.on('download-progress', () => this.publish({ status: 'downloading', version: this.state.version }));
    this.updater.on('update-available', (info) => {
      this.publish({ status: 'available', version: info.version });
      if (!this.updater.autoDownload) void this.prompt(info.version, false).catch(() => this.publish({ status: 'error' }));
    });
    this.updater.on('update-downloaded', (info) => {
      this.publish({ status: 'downloaded', version: info.version });
      void this.prompt(info.version, true).catch(() => this.publish({ status: 'error' }));
    });
  }

  async prompt(version: string, downloaded: boolean): Promise<void> {
    if (this.promptedVersion === version) return;
    this.promptedVersion = version;
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'info', title: 'Senshu-Universe の更新', message: `新しい版 ${version} があります。`,
      buttons: [downloaded ? '再起動して更新' : '配布ページを開く', '後で'], defaultId: 0, cancelId: 1,
    });
    if (response !== 0) return;
    if (downloaded) this.updater.quitAndInstall();
    else await shell.openExternal(RELEASES_URL);
  }

  async check(manual = false): Promise<void> {
    this.start();
    // 開発起動から本番の Release へ問い合わせたり、更新をインストールしたりしない。
    if (!app.isPackaged) {
      if (manual) await dialog.showMessageBox(this.win, { message: '開発起動では更新の配信を確認しません。' });
      return;
    }
    if (manual && this.state.version && ['available', 'downloaded'].includes(this.state.status)) {
      this.promptedVersion = '';
      await this.prompt(this.state.version, this.state.status === 'downloaded');
      return;
    }
    try {
      const result = await this.updater.checkForUpdates();
      if (manual && result && compareVersions(result.updateInfo.version, app.getVersion()) <= 0) {
        await dialog.showMessageBox(this.win, { message: '最新の版を使っています。' });
      }
    } catch {
      if (manual) await dialog.showMessageBox(this.win, { type: 'warning', message: '更新を確認できませんでした。時間をおいて再試行してください。' });
    }
  }
}
