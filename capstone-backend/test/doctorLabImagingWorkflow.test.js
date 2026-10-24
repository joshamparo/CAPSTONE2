'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dashboard = fs.readFileSync(path.join(root, 'frontend', 'src', 'Doctor', 'DoctorDashboard.js'), 'utf8');
const labRoutes = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'labResults.js'), 'utf8');

test('doctor Lab and Imaging selector loads only authorized doctor patients', () => {
  const fetchPatients = dashboard.slice(
    dashboard.indexOf('const fetchPatients = async'),
    dashboard.indexOf('const fetchPatientVitalsAndTriage')
  );
  assert.match(fetchPatients, /\/api\/doctor\/patients\/patients\?scope=specialization&status=all/);
  assert.match(fetchPatients, /data\.rows\.map\(\(row\) => row\?\.patient\)/);
  assert.doesNotMatch(fetchPatients, /const data = await fetchJson\(`\/api\/patients`/);
});

test('opening Lab and Imaging refreshes its patient selector in review-only mode', () => {
  assert.match(dashboard, /if \(!userRole \|\| activeNav !== 'labs'\) return;\s*fetchPatients\(\)/);
  assert.match(dashboard, /Results are uploaded by the assigned clinical department/);
  assert.doesNotMatch(dashboard, /const saveLabResult\s*=/);
});

test('lab result upload and creation enforce signed doctor patient access', () => {
  const uploadRoute = labRoutes.slice(labRoutes.indexOf("router.post('/upload'"), labRoutes.indexOf("router.get('/mine'"));
  const createRoute = labRoutes.slice(labRoutes.indexOf("router.post('/',"), labRoutes.indexOf("router.get('/:id'"));
  assert.match(uploadRoute, /req\.auth\?\.role === 'doctor'[\s\S]*enforceDoctorPatientAccess/);
  assert.match(createRoute, /req\.auth\?\.role === 'doctor'[\s\S]*enforceDoctorPatientAccess/);
  assert.match(createRoute, /The uploaded file does not belong to this patient\./);
});
