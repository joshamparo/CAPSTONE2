const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', ...parts), 'utf8');

test('shared print utility waits for rendering and cleans up its isolated frame', () => {
  const source = read('utils', 'printDocument.js');
  assert.match(source, /document\.createElement\('iframe'\)/);
  assert.match(source, /await frameDocument\.fonts\?\.ready/);
  assert.match(source, /frameWindow\.onafterprint/);
  assert.match(source, /frameWindow\.print\(\)/);
});

test('major admin and patient-record print actions use the shared reliable printer', () => {
  for (const source of [
    read('Admin', 'AdminDashboard.js'),
    read('Doctor', 'DoctorDashboard.js'),
    read('components', 'PatientFullRecordModal.js')
  ]) {
    assert.match(source, /printHtmlDocument/);
  }
});

test('doctor document printing waits for React to render and clears its print state', () => {
  const source = read('Doctor', 'DoctorDashboard.js');
  assert.match(source, /requestAnimationFrame\(\(\) => \{\s*secondFrame = window\.requestAnimationFrame/);
  assert.match(source, /addEventListener\('afterprint', clearPrintDocument/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => window\.print\(\), 50\)/);
});

test('patient-record popup never closes itself before the print dialog completes', () => {
  const source = read('DoctorSecretary', 'DoctorSecretaryDashboard.js');
  const start = source.indexOf('const printPatientRecords');
  const end = source.indexOf('const refreshAvailability', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /window\.print\(\);window\.close\(\)/);
  assert.match(source.slice(start, end), /Confidential - Authorized hospital use only/);
});
