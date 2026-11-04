import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import type { DesktopNotification } from '../shared/desktop';

export function isTrustedUrl(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

export function isInternalLink(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return false;
  const hasControl = (value: string) => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (/[\\\s]/.test(raw) || hasControl(raw)) return false;
  try {
    const decoded = decodeURIComponent(raw);
    return !decoded.startsWith('//') && !decoded.includes('\\') && !hasControl(decoded)
      && new URL(raw, 'https://senshu-universe.com').origin === 'https://senshu-universe.com';
  } catch { return false; }
}

export function validNotification(value: unknown): value is DesktopNotification {
  if (!value || typeof value !== 'object') return false;
  const { title, body, link } = value as Partial<DesktopNotification>;
  return typeof title === 'string' && title.trim().length > 0 && title.length <= 120
    && typeof body === 'string' && body.length <= 2000 && isInternalLink(link);
}

export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent, contents: WebContents, origin: string): boolean {
  return !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame
    && isTrustedUrl(event.senderFrame.url, origin);
}

export function externalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* 不正なリンクは開かない。 */ }
}
