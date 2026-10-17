'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const patientsRoute = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'patients.js'), 'utf8');
const nurseDashboard = fs.readFileSync(path.join(root, 'frontend', 'src', 'Nurse', 'NurseDashboard.js'), 'utf8');

const listStart = patientsRoute.indexOf("router.get('/', async (req, res) => {");
const listEnd = patientsRoute.indexOf("router.get('/:id/full-record'", listStart);
const listRoute = patientsRoute.slice(listStart, listEnd);

test('nurse patient list avoids redundant full-table clinical JSON loading', () => {
  assert.ok(listStart >= 0 && listEnd > listStart, 'patient list route must exist');
  assert.doesNotMatch(listRoute, /receptionPatients/);
  assert.doesNotMatch(listRoute, /take:\s*2000[\s\S]{0,120}clinical_records/);
  assert.match(listRoute, /clinicalScope\s*=\s*await clinicalScopePromise/);
});

test('nurse patient list is bounded and excludes account recovery fields', () => {
  assert.match(listRoute, /nurseListRequested\s*\?\s*500\s*:\s*null/);
  assert.match(listRoute, /select:\s*NURSE_PATIENT_LIST_SELECT/);
  const projectionStart = patientsRoute.indexOf('const NURSE_PATIENT_LIST_SELECT');
  const projectionEnd = patientsRoute.indexOf('function serializePayload', projectionStart);
  const projection = patientsRoute.slice(projectionStart, projectionEnd);
  assert.doesNotMatch(projection, /password|reset_password/i);
  assert.match(nurseDashboard, /\/api\/patients\?take=500/);
});

test('ER route enrichment only queries already-authorized returned patient ids', () => {
  assert.match(listRoute, /patient_id:\s*\{\s*in:\s*patientIds\s*\}/);
  assert.match(listRoute, /patients\.forEach\(\(patient\)\s*=>\s*\{[\s\S]*getReceptionRouteFromClinicalRecords\(patient\.clinical_records\)/);
});
