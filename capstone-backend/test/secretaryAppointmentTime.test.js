'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('secretary inbox returns appointment TIME as HH:mm', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointments.js'), 'utf8');
  const start = source.indexOf("router.get('/unassigned'");
  const end = source.indexOf('// PATCH update status or assign doctor', start);
  const handler = source.slice(start, end);
  assert.match(handler, /appointmentTime:\s*formatHHmm\(a\.appointment_time\)\s*\|\|\s*null/);
  assert.doesNotMatch(handler, /appointmentTime:\s*a\.appointment_time[,\n]/);
});

test('secretary UI treats serialized database TIME as wall-clock clinic time', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'DoctorSecretary', 'DoctorSecretaryDashboard.js'),
    'utf8'
  );
  assert.match(source, /A database TIME is clinic wall-clock time/);
  assert.match(source, /s\.match\(\/\(\?:T\|\^\)\(\\d\{2\}\):\(\\d\{2\}\)\//);
  assert.match(source, /s\.match\(\/T\(\\d\{2\}\):\(\\d\{2\}\)\//);
});

test('nurse slots and intake use only secretary-managed doctors', () => {
  const availability = fs.readFileSync(path.join(__dirname, '..', 'routes', 'doctorAvailability.js'), 'utf8');
  const patients = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  assert.match(availability, /getIntakeDoctorIds\(prisma, specialization\)/);
  assert.match(patients, /getIntakeDoctorIds\(tx, selectedSpec\)/);
});
