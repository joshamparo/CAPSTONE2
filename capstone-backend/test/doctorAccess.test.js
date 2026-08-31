const test = require('node:test');
const assert = require('node:assert/strict');
const { canRequestPatientScope } = require('../utils/doctorAccess');

test('doctors cannot request unrestricted all-patient scope', () => {
  assert.equal(canRequestPatientScope('doctor', 'all'), false);
  assert.equal(canRequestPatientScope('doctor', 'mine'), true);
  assert.equal(canRequestPatientScope('doctor', 'specialization'), true);
});

test('administrators retain all-patient scope', () => {
  assert.equal(canRequestPatientScope('admin', 'all'), true);
});
