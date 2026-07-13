const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('service worker revalidates executable assets and keeps offline fallbacks', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'notification-sw.js'), 'utf8');
  assert.match(worker, /workcontrol-app-shell-v7/);
  assert.match(worker, /workcontrol-static-v2/);
  assert.match(worker, /\['script', 'style', 'worker'\]/);
  assert.match(worker, /fetch\(request, \{ cache: 'no-cache' \}\)/);
  assert.match(worker, /request\.destination === 'font'/);

  const executablePolicyStart = worker.indexOf("['script', 'style', 'worker']");
  const fontPolicyStart = worker.indexOf("request.destination === 'font'", executablePolicyStart);
  const executablePolicy = worker.slice(executablePolicyStart, fontPolicyStart);
  assert.ok(executablePolicy.indexOf('fetch(request') < executablePolicy.indexOf('cache.match(request)'));
});
