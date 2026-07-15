const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUserOperationalView,
  cleanIds,
  cleanNames,
  userOperationalViewId,
} = require('./userOperationalView');

test('user operational view contains directory fields without privileged profile settings', () => {
  const view = buildUserOperationalView('user-a', 'company-a', {
    fullName: 'User A',
    email: 'a@example.test',
    role: 'angajat',
    active: true,
    isOnline: true,
    lastSeenAt: 100,
    lastActiveAt: 120,
    companyIds: ['company-a'],
    primaryCompanyId: 'company-a',
    primaryCompanyName: 'Company A',
    companyNames: ['Company A'],
    globalAdmin: true,
    permissions: ['secret'],
    timesheetDefaultProjectId: 'secret-project',
  });
  assert.equal(view.uid, 'user-a');
  assert.equal(view.companyId, 'company-a');
  assert.equal(view.primaryCompanyId, 'company-a');
  assert.equal(view.primaryCompanyName, 'Company A');
  assert.deepEqual(view.companyNames, ['Company A']);
  assert.equal(view.active, true);
  assert.equal(view.isOnline, true);
  assert.equal(view.lastSeenAt, 100);
  assert.equal(view.lastActiveAt, 120);
  assert.equal(Object.hasOwn(view, 'globalAdmin'), false);
  assert.equal(Object.hasOwn(view, 'permissions'), false);
  assert.equal(Object.hasOwn(view, 'timesheetDefaultProjectId'), false);
});

test('company IDs are normalized and view IDs are deterministic', () => {
  assert.deepEqual(cleanIds(['company-b', 'company-a', 'company-b'], 'company-a'), [
    'company-b',
    'company-a',
  ]);
  assert.equal(userOperationalViewId('company-a', 'user-a'), 'company-a__user-a');
});

test('company names are normalized for legacy user projections', () => {
  assert.deepEqual(cleanNames(['Company B', 'Company A', 'Company B'], 'Company A'), [
    'Company B',
    'Company A',
  ]);
  const view = buildUserOperationalView('user-a', 'company-a', {
    companyId: 'company-a',
    primaryCompanyName: 'Company A',
  });
  assert.equal(view.primaryCompanyName, 'Company A');
  assert.deepEqual(view.companyNames, ['Company A']);
});

test('presence fields are included in the user operational payload', () => {
  const base = {
    fullName: 'User A',
    role: 'angajat',
    active: true,
    isOnline: true,
    lastSeenAt: 100,
    updatedAt: 100,
  };
  const next = {
    ...base,
    isOnline: false,
    lastSeenAt: 200,
    lastActiveAt: 200,
    updatedAt: 200,
  };

  const before = buildUserOperationalView('user-a', 'company-a', base);
  const after = buildUserOperationalView('user-a', 'company-a', next);

  assert.equal(before.isOnline, true);
  assert.equal(before.lastSeenAt, 100);
  assert.equal(after.isOnline, false);
  assert.equal(after.lastSeenAt, 200);
  assert.equal(after.lastActiveAt, 200);
});
