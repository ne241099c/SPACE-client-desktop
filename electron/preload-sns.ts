import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type DesktopBridge, type DesktopNotification, type UpdateState } from '../shared/desktop';
import { isInternalLink, isTrustedUrl } from './security';

const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = argument('space-origin');

// 同じ preload が失敗ページや子フレームで動いても、権限を渡さない。
if (process.isMainFrame && origin && isTrustedUrl(window.location.href, origin)) {
  const bridge: DesktopBridge = {
    version: argument('space-version') ?? '0.0.0',
    notify: (payload: DesktopNotification) => ipcRenderer.send(IPC.notify, payload),
    setUnreadCount: (count: number) => ipcRenderer.send(IPC.unread, count),
    onNavigate: (listener: (link: string) => void) => {
      const handler = (_event: IpcRendererEvent, link: unknown) => {
        if (isInternalLink(link)) listener(link);
      };
      ipcRenderer.on(IPC.navigate, handler);
      ipcRenderer.send(IPC.navigateReady);
      return () => ipcRenderer.removeListener(IPC.navigate, handler);
    },
    onUpdateState: (listener: (state: UpdateState) => void) => {
      const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on(IPC.update, handler);
      ipcRenderer.send(IPC.updateReady);
      return () => ipcRenderer.removeListener(IPC.update, handler);
    },
  };
  contextBridge.exposeInMainWorld('spaceDesktop', bridge);
}
