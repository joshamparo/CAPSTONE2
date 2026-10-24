'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeMedicalCertificateInput } = require('../utils/medicalCertificateValidation');

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-24T04:00:00.000Z');

test('valid certificate input is trimmed and normalized', () => {
  const result = normalizeMedicalCertificateInput({
    patientId: PATIENT_ID,
    purpose: '  Fit to Work  ',
    diagnosis: ' Resolved upper respiratory infection ',
    recommendations: ' May return without restrictions ',
    validUntil: '2026-10-31'
  }, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    patientId: PATIENT_ID,
    purpose: 'Fit to Work',
    diagnosis: 'Resolved upper respiratory infection',
    recommendations: 'May return without restrictions',
    validUntil: '2026-10-31'
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'medicalCertificates.js'), 'utf8');
  assert.match(source, /req\.auth\?\.role === 'doctor'/);
  assert.match(source, /prisma\.medical_certificates\.create/);
  assert.match(source, /sendError\(res, err, 'Unable to create medical certificate\.'\)/);
  assert.doesNotMatch(source, /res\.status\(400\)\.json\(\{ message: err\.message \}\)/);
});

test('missing purpose and invalid validity dates are rejected', () => {
  assert.deepEqual(
    normalizeMedicalCertificateInput({ patientId: PATIENT_ID, purpose: '   ' }, NOW),
    { ok: false, message: 'Purpose is required.' }
  );
  assert.deepEqual(
    normalizeMedicalCertificateInput({ patientId: PATIENT_ID, purpose: 'Fit to Work', validUntil: '2026-10-23' }, NOW),
    { ok: false, message: 'Valid Until cannot be earlier than today.' }
  );
});
