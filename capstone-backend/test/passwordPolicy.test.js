const test = require('node:test');
const assert = require('node:assert/strict');

const { resetPasswordCriteria, isValidResetPassword } = require('../utils/passwordPolicy');

test('reset password rejects an otherwise valid all-lowercase password', () => {
  assert.deepEqual(resetPasswordCriteria('amparogs_123'), {
    length: true,
    number: true,
    special: true,
    uppercase: false
  });
  assert.equal(isValidResetPassword('amparogs_123'), false);
});

test('reset password accepts the same password with an uppercase letter', () => {
  assert.equal(isValidResetPassword('Amparogs_123'), true);
});

test('uppercase does not replace the existing length, number, or special requirements', () => {
  assert.equal(isValidResetPassword('Amparogs_abc'), false);
  assert.equal(isValidResetPassword('Amparogs1234'), false);
  assert.equal(isValidResetPassword('Amp_123'), false);
});
