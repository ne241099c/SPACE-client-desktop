// Windows 実機の更新検証専用。通常の配布スクリプトからは読み込まない。
const { build } = require('../package.json');
module.exports = {
  ...build,
  publish: { provider: 'generic', url: 'http://127.0.0.1:9081' },
};
