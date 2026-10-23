const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'wards.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'Nurse', 'NurseDashboard.js'), 'utf8');
const assignmentRoute = routeSource.slice(
  routeSource.indexOf("router.post('/assign-patient'"),
  routeSource.indexOf("router.post('/discharge-patient'")
);

test('ward assignment avoids registry rebuilds and runtime schema work', () => {
  assert.doesNotMatch(assignmentRoute, /buildWardRegistry\s*\(/);
  assert.doesNotMatch(assignmentRoute, /ensureNurseCareTable\s*\(/);
  assert.match(assignmentRoute, /SELECT status, ward_name FROM public\.ward_rooms/);
});

test('ward assignment allows hosted database latency without blocking UI refreshes', () => {
  assert.match(assignmentRoute, /\{ maxWait: 5000, timeout: 15000 \}/);
  const confirmation = frontendSource.slice(
    frontendSource.indexOf('const confirmBedAssignment = async'),
    frontendSource.indexOf('const handleDischargePatient = async')
  );
  assert.match(confirmation, /void Promise\.allSettled\(\[fetchWardRegistry\(\), refreshPatientsList\(\)\]\)/);
  assert.doesNotMatch(confirmation, /await Promise\.all\(\[fetchWardRegistry\(\), refreshPatientsList\(\)\]\)/);
});
