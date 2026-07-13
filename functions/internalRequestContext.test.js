const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInternalCompanyContext } = require('./internalRequestContext');

test('allows a global administrator to access global operations without a company', () => {
  assert.deepEqual(buildInternalCompanyContext({ globalAdmin: true }, 'admin'), {
    companyId: '',
    companyIds: [],
    globalAdmin: true,
    requiresCompany: false,
  });
});

test('still requires a company for non-global internal users', () => {
  assert.equal(buildInternalCompanyContext({}, 'manager').requiresCompany, true);
  assert.equal(
    buildInternalCompanyContext({ globalAdmin: false }, 'admin').requiresCompany,
    true
  );
});

test('normalizes and deduplicates the assigned company context', () => {
  assert.deepEqual(
    buildInternalCompanyContext(
      {
        primaryCompanyId: ' company-main ',
        companyIds: ['company-secondary', 'company-main', 'company-main', ''],
      },
      'manager'
    ),
    {
      companyId: 'company-main',
      companyIds: ['company-secondary', 'company-main'],
      globalAdmin: false,
      requiresCompany: false,
    }
  );
});
