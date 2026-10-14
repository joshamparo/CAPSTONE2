const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readFrontend = (...parts) => fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', ...parts),
  'utf8'
);

test('clinical staff polling pauses in hidden tabs and prevents overlap', () => {
  const source = readFrontend('ClinicalStaff', 'ClinicalStaffDashboard.js');
  assert.match(source, /refreshInFlight \|\| document\.visibilityState !== 'visible'/);
  assert.match(source, /await Promise\.allSettled\(tasks\)/);
});

test('nurse polling is active-view scoped and guarded against overlap', () => {
  const source = readFrontend('Nurse', 'NurseDashboard.js');
  assert.match(source, /document\.visibilityState !== 'visible' \|\| refreshInFlight/);
  assert.match(source, /if \(view !== 'overview'\) return undefined;\s*let statsInFlight = false;/);
  assert.match(source, /document\.visibilityState !== 'visible' \|\| statsInFlight/);
});

test('patient result polling pauses when hidden and prevents overlap', () => {
  const source = readFrontend('Patient', 'PatientDashboard.js');
  assert.match(source, /let loadInFlight = false;/);
  assert.match(source, /cancelled \|\| loadInFlight \|\| document\.visibilityState !== 'visible'/);
});
