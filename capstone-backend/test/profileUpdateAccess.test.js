const test = require('node:test');
const assert = require('node:assert/strict');
const { nonAdminProfileFieldError } = require('../utils/profileUpdateAccess');

test('non-admin self service accepts password fields only', () => {
  assert.equal(nonAdminProfileFieldError({
    currentPassword: 'old', password: 'NewPassword1!', requiresPasswordAuth: true
  }), '');
  for (const field of ['firstName', 'lastName', 'email', 'phone', 'department', 'specialization', 'profilePicture']) {
    assert.match(nonAdminProfileFieldError({ [field]: 'changed' }), /Only your password/);
  }
});
