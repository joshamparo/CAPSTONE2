const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const appointmentSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointments.js'), 'utf8');
const clinicalStaffSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'ClinicalStaff', 'ClinicalStaffDashboard.js'),
  'utf8'
);
const patientSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Patient', 'PatientDashboard.js'),
  'utf8'
);

test('physical therapy video bookings are shared before start and private after claim', () => {
  assert.match(appointmentSource, /\{ meeting_started_at: null \}/);
  assert.match(appointmentSource, /\{ doctor_uuid: String\(req\.auth\?\.id \|\| ''\) \}/);
  assert.match(appointmentSource, /doctor_uuid = CASE WHEN \$\{isPhysicalTherapyQueue\}/);
  assert.match(appointmentSource, /Another physical therapist has already started this consultation/);
});

test('provider and patient clients converge on the backend-owned video room', () => {
  assert.match(clinicalStaffSource, /\/video\/start/);
  assert.match(patientSource, /\/video\/join/);
  assert.match(patientSource, /setInterval\(\(\) => loadAppointments\(\{ silent: true \}\), 10000\)/);
  assert.doesNotMatch(patientSource, /makeRoomId|create.*meeting.*room/i);
});
