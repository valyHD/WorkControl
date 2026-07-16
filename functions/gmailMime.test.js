const assert = require('node:assert/strict');
const test = require('node:test');

const { createGmailMimeBoundary } = require('./gmailMime');

test('creates a deterministic MIME boundary through Node crypto bytes', () => {
  const boundary = createGmailMimeBoundary(1721131200000, (size) => {
    assert.equal(size, 6);
    return Buffer.from('a1b2c3d4e5f6', 'hex');
  });

  assert.equal(boundary, 'workcontrol_1721131200000_a1b2c3d4e5f6');
});

test('creates a Gmail-safe boundary with the default Node crypto implementation', () => {
  assert.match(createGmailMimeBoundary(), /^workcontrol_\d+_[a-f0-9]{12}$/);
});
