const test = require('node:test');
const assert = require('node:assert/strict');
const { adminDeactivationBlock } = require('../utils/adminAccountSafety');

test('an administrator cannot deactivate their own account', () => {
  assert.match(adminDeactivationBlock({
    actorEmail: 'Admin@Hospital.test',
    targetEmail: 'admin@hospital.test',
    targetRole: 'admin',
    activeAdminCount: 3
  }), /your own/i);
});

test('the final active administrator cannot be deactivated', () => {
  assert.match(adminDeactivationBlock({
    actorEmail: 'owner@hospital.test',
    targetEmail: 'admin@hospital.test',
    targetRole: 'admin',
    activeAdminCount: 1
  }), /last active administrator/i);
});

test('a different account can be deactivated when another admin remains', () => {
  assert.equal(adminDeactivationBlock({
    actorEmail: 'owner@hospital.test',
    targetEmail: 'staff@hospital.test',
    targetRole: 'staff',
    activeAdminCount: 1
  }), '');
  assert.equal(adminDeactivationBlock({
    actorEmail: 'owner@hospital.test',
    targetEmail: 'admin2@hospital.test',
    targetRole: 'admin',
    activeAdminCount: 2
  }), '');
});
