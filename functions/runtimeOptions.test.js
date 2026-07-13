const test = require('node:test');
const assert = require('node:assert/strict');

const { GLOBAL_RUNTIME_OPTIONS } = require('./runtimeOptions');

test('uses fractional CPU compatibility defaults for second-generation functions', () => {
  assert.deepEqual(GLOBAL_RUNTIME_OPTIONS, {
    cpu: 'gcf_gen1',
  });
  assert.equal(Object.isFrozen(GLOBAL_RUNTIME_OPTIONS), true);
});
