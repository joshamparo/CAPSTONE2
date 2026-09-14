const test = require('node:test');
const assert = require('node:assert/strict');
const { canSetManualVerificationStatus, validateDoctorRelease, shouldAutoReleaseResult } = require('../utils/labResultWorkflow');

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

test('authorized diagnostic staff releases uploaded results without doctor sign-off', () => {
  for (const role of ['medtech', 'radiographer', 'ecg_operator', 'physical_therapist']) {
    assert.equal(shouldAutoReleaseResult(role), true, role);
  }
  for (const role of ['doctor', 'doctor_secretary', 'nurse', 'patient']) {
    assert.equal(shouldAutoReleaseResult(role), false, role);
  }
});
