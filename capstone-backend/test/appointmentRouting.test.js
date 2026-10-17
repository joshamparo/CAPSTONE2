const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newAppointmentRouting, canAssignOnsiteAppointment, doctorAppointmentScope } = require('../utils/appointmentRouting');

test('onsite appointments always start in the secretary assignment queue', () => {
  assert.deepEqual(newAppointmentRouting('onsite', 'doctor-id'), {
    doctorUuid: null,
    assignmentStatus: 'PENDING_ASSIGNMENT',
    assignedAt: null
  });
});

test('video appointments can be assigned directly to a doctor', () => {
  const routing = newAppointmentRouting('video', 'doctor-id');
  assert.equal(routing.doctorUuid, 'doctor-id');
  assert.equal(routing.assignmentStatus, 'ASSIGNED');
  assert.ok(routing.assignedAt instanceof Date);
});

test('only secretary and admin can assign onsite appointments', () => {
  assert.equal(canAssignOnsiteAppointment('doctor_secretary'), true);
  assert.equal(canAssignOnsiteAppointment('admin'), true);
  assert.equal(canAssignOnsiteAppointment('nurse'), false);
  assert.equal(canAssignOnsiteAppointment('doctor'), false);
});

test('doctor queue includes own video and assigned onsite appointments only', () => {
  const scope = doctorAppointmentScope('doctor-id');
  assert.equal(scope.AND[0].doctor_uuid, 'doctor-id');
  assert.equal(scope.AND[1].OR[1].assignment_status, 'ASSIGNED');
});

test('video appointment debug data is restricted to administrators', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/appointments.js'), 'utf8');
  assert.match(
    source,
    /router\.get\('\/debug\/video-apts',\s*requireRole\(\['admin'\]\),\s*async\s*\(req, res\)\s*=>/
  );
});
