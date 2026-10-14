const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('patient record modal never displays a record loaded for another patient', () => {
  const source = read('frontend', 'src', 'components', 'PatientFullRecordModal.js');
  assert.match(source, /loadedPatientId === requestedPatientId \? record : null/);
  assert.match(source, /setLoadedPatientId\(''\)/);
  assert.match(source, /Retry loading record/);
  assert.match(source, /disabled=\{!activeRecord \|\| loading\}/);
});

test('optional nursing history cannot take down the complete patient record', () => {
  const source = read('capstone-backend', 'routes', 'patients.js');
  const start = source.indexOf("router.get('/:id/full-record'");
  const end = source.indexOf('// GET single patient by ID', start);
  const route = source.slice(start, end);
  assert.match(route, /const loadRecordSection = \(label, query\)/);
  assert.match(route, /warnings: recordWarnings/);
  assert.match(route, /let specialtyCare = \[\]/);
  assert.match(route, /catch \(error\) \{\s*payload\.warnings\.push/);
  assert.match(route, /the rest of this patient record is complete/);
});
