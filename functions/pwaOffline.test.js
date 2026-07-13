const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('service worker keeps updates waiting until the user accepts them', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'notification-sw.js'), 'utf8');
  const installHandler = worker.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';

  assert.doesNotMatch(installHandler, /self\.skipWaiting\(\)/);
  assert.match(worker, /event\?\.data\?\.type === 'SKIP_WAITING'/);
  assert.match(worker, /workcontrol-app-shell-v8/);
  assert.match(worker, /workcontrol-static-v2/);
  assert.match(worker, /STATIC_CACHE_NAME/);
  assert.match(worker, /\['script', 'style', 'font', 'worker'\]/);
  assert.match(worker, /isValidStaticResponse/);
});
