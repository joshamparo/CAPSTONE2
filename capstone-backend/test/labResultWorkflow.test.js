const test = require('node:test');
const assert = require('node:assert/strict');
const { canSetManualVerificationStatus, validateDoctorRelease } = require('../utils/labResultWorkflow');

test('doctor release requires an interpretation after automated verification', () => {
  assert.match(validateDoctorRelease('', 'matched'), /interpretation/i);
  assert.match(validateDoctorRelease('No acute findings.', 'pending'), /verification/i);
  assert.equal(validateDoctorRelease('No acute findings.', 'matched'), '');
  assert.equal(validateDoctorRelease('Clinical correlation advised.', 'flagged'), '');
});

test('manual verification cannot release a result without doctor sign-off', () => {
  assert.equal(canSetManualVerificationStatus('flagged'), true);
  assert.equal(canSetManualVerificationStatus('rejected'), true);
  assert.equal(canSetManualVerificationStatus('verified'), false);
});
