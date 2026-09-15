const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('patient full record exposes only released lab results', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  assert.match(source, /requesterRole === 'patient'[\s\S]*verification_status[\s\S]*= 'verified'/);
  assert.match(source, /results: \(requesterRole === 'patient' \? \[\]/);
  assert.match(source, /createPatientLabFileUrl\(\{ resultId, patientId: patient\.id \}\)/);
  assert.match(source, /file_url: patientFileUrl/);
});
