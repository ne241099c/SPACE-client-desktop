// デモ版と同じく、sandbox の preload に electron 以外の require を残さない。
// electron-updater も main に同梱し、配布物へ node_modules（Web 側の依存）を入れない。
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

const common = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron'], sourcemap: true, logLevel: 'info',
};
await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  build({ ...common, entryPoints: ['electron/preload-sns.ts'], outfile: 'dist-electron/preload-sns.cjs' }),
]);
await copyFile('electron/status.html', 'dist-electron/status.html');
