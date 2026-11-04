import { app, nativeImage, type BrowserWindow } from 'electron';

// オーバーレイは外部画像や HTML を読み込まず、固定の数字から描く。
const digits = ['111101101101111', '010110010010111', '111001111100111', '111001111001111',
  '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

export function setBadge(win: BrowserWindow, count: number): void {
  if (process.platform === 'darwin') app.setBadgeCount(count);
  if (process.platform !== 'win32') return;
  if (!count) { win.setOverlayIcon(null, '未読なし'); return; }
  const size = 32;
  const bitmap = Buffer.alloc(size * size * 4);
  const paint = (x: number, y: number, white = false) => {
    const p = (y * size + x) * 4;
    bitmap[p] = white ? 255 : 65; bitmap[p + 1] = white ? 255 : 55;
    bitmap[p + 2] = white ? 255 : 215; bitmap[p + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 < 250) paint(x, y);
  }
  const label = count > 99 ? '99' : String(count);
  const start = Math.floor((size - (label.length * 8 - 2)) / 2);
  [...label].forEach((digit, index) => {
    [...digits[Number(digit)]].forEach((pixel, i) => {
      if (pixel !== '1') return;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        paint(start + index * 8 + (i % 3) * 2 + dx, 11 + Math.floor(i / 3) * 2 + dy, true);
      }
    });
  });
  win.setOverlayIcon(nativeImage.createFromBitmap(bitmap, { width: size, height: size }), `${count} 件の未読`);
}
