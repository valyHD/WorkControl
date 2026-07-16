const crypto = require('node:crypto');

const EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION = 1;
const EXPENSE_DOCUMENT_EXTRACTION_VERSION = 'expense-core-v1';

function clean(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sha256Buffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer invalid pentru hash document.');
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildExpenseDocumentCacheId(companyId, fileHash, scanMode = 'full') {
  const safeCompanyId = clean(companyId, 120);
  const safeFileHash = clean(fileHash, 128);
  const safeScanMode = clean(scanMode, 20) || 'full';
  return crypto
    .createHash('sha256')
    .update(`${safeCompanyId}:${safeFileHash}:${safeScanMode}:${EXPENSE_DOCUMENT_EXTRACTION_VERSION}:${EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION}`)
    .digest('hex');
}

module.exports = {
  EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION,
  EXPENSE_DOCUMENT_EXTRACTION_VERSION,
  buildExpenseDocumentCacheId,
  sha256Buffer,
};
