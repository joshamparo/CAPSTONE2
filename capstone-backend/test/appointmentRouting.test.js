const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newAppointmentRouting, canAssignOnsiteAppointment, doctorAppointmentScope, doctorDepartmentAppointmentScope } = require('../utils/appointmentRouting');

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

test('doctor department queue is restricted to active resolved colleague ids', () => {
  const scope = doctorDepartmentAppointmentScope(['doctor-a', 'doctor-b', 'doctor-a', '', null]);
  assert.deepEqual(scope.AND[0].doctor_uuid.in, ['doctor-a', 'doctor-b']);
  assert.equal(scope.AND[1].OR[0].consultation_mode, 'video');
  assert.equal(scope.AND[1].OR[1].assignment_status, 'ASSIGNED');
});

test('doctor queue frontend sends scope, mode, and exact-date filters to the backend', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/Doctor/DoctorDashboard.js'), 'utf8');
  assert.match(source, /scope: queueScope === 'specialization' \? 'department' : 'mine'/);
  assert.match(source, /queueDateMode === 'date'\) params\.set\('date', dateStr\)/);
  assert.match(source, /queueFilter === 'video'\) params\.set\('consultationMode', 'video'\)/);
  assert.match(source, /queueScope === 'specialization'\) return true/);
  assert.doesNotMatch(source, /queueFilter === 'video' && queueScope !== 'specialization'/);
});

test('doctor department scope is resolved server-side from the signed doctor profile', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/appointments.js'), 'utf8');
  assert.match(source, /requestedScope === 'department'/);
  assert.match(source, /prisma\.doctors\.findUnique\([\s\S]*req\.auth\?\.id/);
  assert.match(source, /doctorDepartmentAppointmentScope\(departmentDoctors\.map/);
  assert.doesNotMatch(source, /req\.headers\['x-(?:department|specialization)'\]/);
});

test('video appointment debug data is restricted to administrators', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/appointments.js'), 'utf8');
  assert.match(
    source,
    /router\.get\('\/debug\/video-apts',\s*requireRole\(\['admin'\]\),\s*async\s*\(req, res\)\s*=>/
  );
});
