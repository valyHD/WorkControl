const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('service worker caches the PWA shell and versioned static assets', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'notification-sw.js'), 'utf8');
  assert.match(worker, /workcontrol-app-shell-v7/);
  assert.match(worker, /STATIC_CACHE_NAME/);
  assert.match(worker, /\['script', 'style', 'font', 'worker'\]/);
});
