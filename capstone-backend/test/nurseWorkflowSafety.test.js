const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateMedicationAction,
  medicationTransitionError,
  isMatchingHandoverVersion
} = require('../utils/nurseWorkflowSafety');

test('held and missed medication actions require a reason', () => {
  assert.equal(validateMedicationAction({ status: 'held', note: '' }).ok, false);
  assert.equal(validateMedicationAction({ status: 'missed', note: 'no' }).ok, false);
  assert.deepEqual(validateMedicationAction({ status: 'held', note: 'Patient declined' }), {
    ok: true, status: 'held', note: 'Patient declined'
  });
});

test('administered medication requests cannot be recorded again', () => {
  assert.equal(medicationTransitionError(['administered'], 'administered'), 'This medication request has already been administered.');
  assert.equal(medicationTransitionError(['held'], 'held'), 'This medication request is already marked as held.');
  assert.equal(medicationTransitionError(['held'], 'administered'), '');
});

test('handover version must match both id and update timestamp', () => {
  const row = { id: 14n, updated_at: new Date('2026-09-05T01:00:00.000Z') };
  assert.equal(isMatchingHandoverVersion(row, '14', '2026-09-05T01:00:00.000Z'), true);
  assert.equal(isMatchingHandoverVersion(row, '15', '2026-09-05T01:00:00.000Z'), false);
  assert.equal(isMatchingHandoverVersion(row, '14', '2026-09-05T01:01:00.000Z'), false);
});
