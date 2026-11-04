import { app } from 'electron';

export const APP_ID = 'jp.senshu-universe.app';
export const PRODUCT_NAME = 'Senshu-Universe';
export const PRODUCTION_ORIGIN = 'https://senshu-universe.com';
export const RELEASES_URL = 'https://github.com/ne241099c/SPACE-client-desktop/releases';
// Developer ID による署名・公証を導入した後、この値を切り替える。
export const MAC_AUTO_UPDATE = false;

export function siteOrigin(): string {
  if (app.isPackaged || !process.env.SPACE_DESKTOP_URL) return PRODUCTION_ORIGIN;
  const url = new URL(process.env.SPACE_DESKTOP_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('開発用 URL はループバックの HTTP オリジンを指定してください。');
  }
  return url.origin;
}
