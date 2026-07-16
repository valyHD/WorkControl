const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION,
  EXPENSE_DOCUMENT_EXTRACTION_VERSION,
  buildExpenseDocumentCacheId,
  sha256Buffer,
} = require('./expenseDocumentCache');

test('builds deterministic expense analysis cache ids', () => {
  const hash = sha256Buffer(Buffer.from('bon test'));
  const first = buildExpenseDocumentCacheId('company-a', hash, 'full');

  assert.equal(EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION, 1);
  assert.equal(EXPENSE_DOCUMENT_EXTRACTION_VERSION, 'expense-core-v1');
  assert.equal(first, buildExpenseDocumentCacheId('company-a', hash, 'full'));
  assert.notEqual(first, buildExpenseDocumentCacheId('company-b', hash, 'full'));
  assert.notEqual(first, buildExpenseDocumentCacheId('company-a', hash, 'fast'));
});

test('rejects empty buffers for expense document hashing', () => {
  assert.throws(() => sha256Buffer(Buffer.alloc(0)), /Buffer invalid/);
});
