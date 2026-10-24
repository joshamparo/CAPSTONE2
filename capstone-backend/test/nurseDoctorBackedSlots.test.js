'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.join(__dirname, '..');
const availability = fs.readFileSync(path.join(backendRoot, 'routes', 'doctorAvailability.js'), 'utf8');
const patients = fs.readFileSync(path.join(backendRoot, 'routes', 'patients.js'), 'utf8');
const appointments = fs.readFileSync(path.join(backendRoot, 'routes', 'appointments.js'), 'utf8');
const nurse = fs.readFileSync(path.join(backendRoot, '..', 'frontend', 'src', 'Nurse', 'NurseDashboard.js'), 'utf8');
const secretary = fs.readFileSync(path.join(backendRoot, '..', 'frontend', 'src', 'DoctorSecretary', 'DoctorSecretaryDashboard.js'), 'utf8');

test('nurse appointment slots identify the scheduled doctor and reserve that doctor', () => {
  assert.match(availability, /getIntakeDoctorIds\(prisma, specialization\)/);
  assert.match(availability, /return \{ time, doctorId: selectedDoctor\?\.doctorId/);
  assert.match(nurse, /reservedDoctorId: String\(slot\?\.doctorId/);
  assert.match(nurse, /reservedDoctorId: addPatientData\.reservedDoctorId \|\| null/);
  assert.match(patients, /specDoctorIds\.includes\(reservedDoctorId\)/);
  assert.match(patients, /doctor_uuid: routeMeta\.type === 'onsite_consult' \? reservedDoctorId/);
});

test('reserved bookings reach only the linked secretary and keep strict schedule checks', () => {
  assert.match(appointments, /OR: \[\{ doctor_uuid: String\(req\.headers\['x-linked-doctor-id'\]/);
  assert.doesNotMatch(appointments, /acceptingExistingRequestedTime/);
  assert.match(secretary, /excludeAppointmentId=/);
  assert.match(availability, /excludeAppointmentId[\s\S]{0,900}id: \{ not: excludeAppointmentId \}/);
});
