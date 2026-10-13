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
const embeddedJitsiSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'EmbeddedJitsiMeeting.js'),
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
  assert.match(clinicalStaffSource, /\/video\/join/);
  assert.match(patientSource, /\/video\/join/);
  assert.match(patientSource, /visibilityState === 'visible'[\s\S]{0,100}loadAppointments\(\{ silent: true \}\)[\s\S]{0,40}30000/);
  assert.doesNotMatch(patientSource, /makeRoomId|create.*meeting.*room/i);
});

test('provider start enters the shared room without stopping on Jitsi prejoin', () => {
  assert.match(embeddedJitsiSource, /prejoinConfig:\s*\{ enabled: false \}/);
  assert.match(embeddedJitsiSource, /prejoinPageEnabled:\s*false/);
  assert.match(appointmentSource, /config\.prejoinConfig\.enabled=false/);
  assert.match(appointmentSource, /rawRoom\.includes\('#'\) \? '&' : '#'/);
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

test('provider joins bypass caches and refuse mismatched rooms', () => {
  const doctorSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'Doctor', 'DoctorDashboard.js'),
    'utf8'
  );
  assert.match(appointmentSource, /Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate/);
  for (const source of [doctorSource, clinicalStaffSource]) {
    assert.match(source, /video\/join\?_=/);
    assert.match(source, /cache:\s*'no-store'/);
    assert.match(source, /The video room changed while opening/);
    assert.match(source, /data\?\.roomId \|\| data\?\.canonicalRoomId/);
  }
  assert.ok(appointmentSource.includes("if (/^https?:\\/\\//i.test(raw)) return raw;"));
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

test('new triage reasons retain Pathology video routing without a legacy video label', () => {
  assert.match(appointmentSource, /const triageSpecialty = raw\.match/);
  assert.match(appointmentSource, /if \(triageSpecialty\) return triageSpecialty/);

  const doctorSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'Doctor', 'DoctorDashboard.js'),
    'utf8'
  );
  assert.match(doctorSource, /if \(triageSpecialty\) return normalizeSpecKey\(triageSpecialty\)/);
  assert.match(doctorSource, /compact\.includes\('patholog'\)/);
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

test('approval does not race the patient app with a competing random room', () => {
  assert.match(approvalSource, /patient app owns room materialization/);
  assert.doesNotMatch(approvalSource, /const approvalRoomId/);
  assert.doesNotMatch(approvalSource, /meeting_room_id:\s*approvalRoomId/);
  assert.match(appointmentSource, /if \(!currentRoomId\) \{/);
  assert.equal(appointmentSource.split('meetingRoomId: apt.meeting_room_id ? toClientRoomId(apt.meeting_room_id) : null').length - 1, 2);
  assert.doesNotMatch(appointmentSource, /currentRoomId !== canonicalRoomId/);
  assert.doesNotMatch(appointmentSource, /roomNeedsUpgrade/);
});

test('provider start waits for the mobile room before creating a fallback', () => {
  assert.match(appointmentSource, /async function waitForPersistedVideoRoom/);
  assert.match(appointmentSource, /meeting_started_at = COALESCE\(meeting_started_at/);
  const waitIndex = appointmentSource.indexOf('await waitForPersistedVideoRoom(resolvedAppointmentId)');
  const fallbackIndex = appointmentSource.indexOf('const fallbackRoom = makeRoomId', waitIndex);
  assert.ok(waitIndex >= 0 && fallbackIndex > waitIndex, 'mobile room wait must precede fallback generation');
});
