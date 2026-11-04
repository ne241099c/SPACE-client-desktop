export const IPC = {
  notify: 'desktop:notify',
  unread: 'desktop:unread',
  navigate: 'desktop:navigate',
  navigateReady: 'desktop:navigate-ready',
  update: 'desktop:update',
  updateReady: 'desktop:update-ready',
} as const;

export type DesktopNotification = { title: string; body: string; link: string };
export type UpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'required';
  version?: string;
};

export type DesktopBridge = {
  version: string;
  notify: (notification: DesktopNotification) => void;
  setUnreadCount: (count: number) => void;
  onNavigate: (listener: (link: string) => void) => () => void;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
};
