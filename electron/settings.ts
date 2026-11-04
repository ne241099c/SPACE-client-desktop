import { app, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function loadBounds(): Rectangle | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'));
    if (!value || typeof value !== 'object') return;
    const b = value as Rectangle;
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite)
      && b.width >= 900 && b.width <= 10000 && b.height >= 600 && b.height <= 10000) return b;
  } catch { /* 初回起動・壊れた設定は既定値へ戻す。 */ }
}

export function saveBounds(bounds: Rectangle): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'window.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(bounds));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* 設定を保存できなくてもアプリの終了は妨げない。 */ }
}
