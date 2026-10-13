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
const videoConsultSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'videoConsults.js'), 'utf8');
const approvalSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'approvalRequests.js'), 'utf8');

test('physical therapy video bookings are shared before start and private after claim', () => {
  assert.match(appointmentSource, /\{ meeting_started_at: null \}/);
  assert.match(appointmentSource, /\{ doctor_uuid: String\(req\.auth\?\.id \|\| ''\) \}/);
  assert.match(appointmentSource, /doctor_uuid = CASE WHEN \$\{isPhysicalTherapyQueue\}/);
  assert.match(appointmentSource, /Another physical therapist has already started this consultation/);
});

test('provider and patient clients converge on the backend-owned video room', () => {
  assert.match(clinicalStaffSource, /\/video\/start/);
  assert.match(clinicalStaffSource, /\/video\/join/);
  assert.match(patientSource, /\/video\/join/);
  assert.match(patientSource, /setInterval\(\(\) => loadAppointments\(\{ silent: true \}\), 10000\)/);
  assert.doesNotMatch(patientSource, /makeRoomId|create.*meeting.*room/i);
});

test('all web providers re-read the persisted room through join after start', () => {
  const doctorSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'Doctor', 'DoctorDashboard.js'),
    'utf8'
  );
  for (const source of [doctorSource, clinicalStaffSource]) {
    const start = source.indexOf('/video/start');
    const join = source.indexOf('/video/join', start);
    assert.ok(start >= 0 && join > start, 'provider must call join after start');
  }
});

test('mobile PT procedure names retain their Physical Therapy video routing', () => {
  for (const procedure of ['therapeutic exercise', 'manual therapy', 'post-op rehabilitation']) {
    assert.match(videoConsultSource.toLowerCase(), new RegExp(procedure));
    assert.match(appointmentSource.toLowerCase(), new RegExp(procedure));
    assert.match(approvalSource.toLowerCase(), new RegExp(procedure));
  }
});

test('mobile PT appointment reasons do not need to repeat the video label', () => {
  assert.match(appointmentSource, /The mobile app persists the selected PT service/);
  assert.match(appointmentSource, /if \(isPhysicalTherapyReason\) return 'Physical Therapy'/);
  const earlyVideoGuard = appointmentSource.indexOf("if (!lower.includes('video consultation')) return '';");
  const ptReturn = appointmentSource.indexOf("if (isPhysicalTherapyReason) return 'Physical Therapy';");
  assert.ok(ptReturn >= 0 && earlyVideoGuard > ptReturn, 'PT routing must run before the legacy video-label guard');
});

test('PT queue reads do not run reconciliation and call opening does not await refresh', () => {
  assert.match(appointmentSource, /start && end && role !== 'physical_therapist'/);
  assert.match(clinicalStaffSource, /timeoutMs: 15000/);
  assert.match(clinicalStaffSource, /void refreshVideoAppointments\(\)/);
  assert.doesNotMatch(clinicalStaffSource, /setVideoActionError[\s\S]{0,160}catch[\s\S]{0,160}await refreshVideoAppointments/);
});

test('duplicate app and web appointment IDs resolve through the same payment reference', () => {
  assert.match(appointmentSource, /function extractVideoPaymentReference/);
  assert.match(appointmentSource, /PAYREF\\s\*:\\s\*/);
  assert.match(appointmentSource, /async function resolveCanonicalVideoAppointment/);
  assert.ok(appointmentSource.split('apt = await resolveCanonicalVideoAppointment(apt);').length - 1 >= 2);
});

test('provider reuses the exact approval room already exposed to the patient', () => {
  assert.match(approvalSource, /meeting_room_id:\s*null/);
  assert.match(approvalSource, /const approvalRoomId = `apt-\$\{String\(appt\.id\)\}-\$\{crypto\.randomBytes/);
  assert.match(appointmentSource, /if \(!currentRoomId\) \{/);
  assert.equal(appointmentSource.split('meetingRoomId: apt.meeting_room_id ? toClientRoomId(apt.meeting_room_id) : null').length - 1, 2);
  assert.doesNotMatch(appointmentSource, /currentRoomId !== canonicalRoomId/);
  assert.doesNotMatch(appointmentSource, /roomNeedsUpgrade/);
});
