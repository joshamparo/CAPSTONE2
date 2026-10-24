'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'clinicalOrders.js'), 'utf8');
const nurse = fs.readFileSync(path.join(root, 'frontend', 'src', 'Nurse', 'NurseDashboard.js'), 'utf8');
const doctor = fs.readFileSync(path.join(root, 'frontend', 'src', 'Doctor', 'DoctorDashboard.js'), 'utf8');

test('doctor nurse-assigned orders connect to the shared nurse queue', () => {
  assert.match(doctor, /assignedRole:\s*defaultAssignedRoleForKind\(orderForm\.kind\)/);
  assert.match(route, /or\.push\(\{ assigned_role:\s*'nurse', assigned_to:\s*null \}\)/);
  assert.match(route, /patients:\s*\{\s*is:\s*req\.nursePatientScope\s*\}/);
});

test('doctor consultation exposes automatic clinical ordering and keeps result upload with clinical staff', () => {
  assert.match(doctor, /Order Clinical Service/);
  assert.match(doctor, /Automatic Destination/);
  assert.match(doctor, /Complete Blood Count \(CBC\)/);
  assert.match(doctor, /Chest X-Ray/);
  assert.match(doctor, /Standard 12-Lead ECG/);
  assert.doesNotMatch(doctor, /const saveLabResult\s*=/);
  assert.doesNotMatch(doctor, />\s*Add Result\s*</);
  assert.match(route, /resolveClinicalServiceRouting\(\{ kind, service \}\)/);
});

test('nurse order modal uses a bounded non-billing query and lazy supply loading', () => {
  assert.match(nurse, /params\.set\('take', '50'\)/);
  assert.match(nurse, /params\.set\('includeBilling', '0'\)/);
  assert.match(route, /includeBilling && orderIdsForLookup\.length > 0/);
  const openStart = nurse.indexOf('const openEROrdersForPatient');
  const openEnd = nurse.indexOf('const closeEROrdersModal', openStart);
  const openFlow = nurse.slice(openStart, openEnd);
  assert.doesNotMatch(openFlow, /refreshSupplyCatalog|refreshMyRestockRequests/);
});

test('only diagnostic staff completion requires a verified result', () => {
  assert.match(route, /newStatus === 'Completed'[\s\S]{0,160}SCHEDULABLE_ROLE_SET\.has\(assignedRoleNorm\)/);
});
