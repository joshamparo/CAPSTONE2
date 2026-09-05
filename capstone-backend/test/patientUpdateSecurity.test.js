const test = require('node:test');
const assert = require('node:assert/strict');
const { patientUpdateAccess, sanitizePatientUpdateForRole } = require('../utils/patientUpdateAccess');

test('patient updates require matching signed ownership', () => {
  assert.equal(patientUpdateAccess({ role: 'patient', actorId: 'p1', patientId: 'p1' }).allowed, true);
  assert.equal(patientUpdateAccess({
    role: 'patient', actorEmail: 'me@example.test', patientEmail: 'ME@example.test', patientId: 'p2'
  }).allowed, true);
  assert.deepEqual(patientUpdateAccess({
    role: 'patient', actorId: 'p1', actorEmail: 'me@example.test', patientId: 'p2', patientEmail: 'other@example.test'
  }), { allowed: false, reason: 'ownership' });
});

test('unrelated staff roles cannot update patient records', () => {
  assert.deepEqual(patientUpdateAccess({ role: 'cashier', patientId: 'p1' }), { allowed: false, reason: 'role' });
  assert.equal(patientUpdateAccess({ role: 'nurse', patientId: 'p1' }).allowed, true);
  assert.equal(patientUpdateAccess({ role: 'doctor', patientId: 'p1' }).allowed, true);
});

test('patient and nurse payloads cannot overwrite protected clinical blobs', () => {
  const payload = {
    firstName: 'Patient', admissionStatus: 'Discharged', wardNumber: 'ICU-1',
    diagnosis: 'Changed', attendingDoctor: 'Changed', admissionDate: '2026-01-01', clinicalRecords: { forged: true }
  };
  assert.deepEqual(sanitizePatientUpdateForRole('patient', payload), { firstName: 'Patient' });
  assert.deepEqual(sanitizePatientUpdateForRole('nurse', payload), {
    firstName: 'Patient', admissionStatus: 'Discharged', wardNumber: 'ICU-1',
    diagnosis: 'Changed', attendingDoctor: 'Changed', admissionDate: '2026-01-01'
  });
});
