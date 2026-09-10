const test = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../utils/nurseCareStorage')] = { exports: { ensureNurseCareTable: async () => {} } };
const { SPECIALTIES, resolveNursePatientScope, nurseAppointmentScope } = require('../utils/nurseScope');

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => matches(row, item));
    if (key === 'OR') return value.some(item => matches(row, item));
    if (value === null || typeof value !== 'object') return row[key] === value;
    if (value.some) return (row[key] || []).some(item => matches(item, value.some));
    if (value.in) return value.in.includes(row[key]);
    if (value.not !== undefined) return row[key] !== value.not;
    const actual = value.mode === 'insensitive' ? String(row[key] || '').toLowerCase() : row[key];
    if (value.equals !== undefined) return actual === (value.mode === 'insensitive' ? value.equals.toLowerCase() : value.equals);
    if (value.startsWith !== undefined) return String(actual || '').startsWith(value.mode === 'insensitive' ? value.startsWith.toLowerCase() : value.startsWith);
    throw new Error('Unsupported test condition: ' + key);
  });
}
const doctors = Object.keys(SPECIALTIES).map((department, i) => ({ id: `doctor-${i}`, specialization: SPECIALTIES[department][0], department }));
const appointments = doctors.map((doctor, i) => ({ id: i, doctor_uuid: doctor.id, patient_id: `patient-${i}`, consultation_mode: doctor.department === 'VIDEO CONSULTATION' ? 'video' : 'onsite', reason: '' }));
const db = {
  doctors: { findMany: async ({ where }) => doctors.filter(row => matches(row, where)) },
  appointments: { findMany: async ({ where }) => appointments.filter(row => matches(row, where)) },
  $queryRaw: async () => []
};
for (const [i, department] of Object.keys(SPECIALTIES).entries()) {
  test(`${department}: assigned appointments reach the correct patient list only`, async () => {
    const scope = await resolveNursePatientScope(db, department);
    assert.equal(matches({ id: `patient-${i}` }, scope), true);
    assert.equal(matches({ id: 'unrelated', admission_status: 'Outpatient', date_of_birth: new Date() }, scope), false);
    const appointmentScope = await nurseAppointmentScope(db, department);
    assert.equal(matches(appointments[i], appointmentScope), true);
    assert.equal(matches({ id: 99, doctor_uuid: 'unrelated', consultation_mode: 'onsite', reason: 'Unrelated' }, appointmentScope), false);
  });
}
test('clinical service and ward assignments are explicit', async () => {
  const lab = await resolveNursePatientScope(db, 'Laboratory');
  assert.equal(matches({ clinical_orders: [{ assigned_role: 'medtech' }] }, lab), true);
  assert.equal(matches({ clinical_orders: [{ assigned_role: 'radiographer' }] }, lab), false);
  const pedia = await resolveNursePatientScope(db, 'PEDIA');
  assert.equal(matches({ admission_status: 'Inpatient', ward_number: 'PD-01' }, pedia), true);
  assert.equal(matches({ admission_status: 'Inpatient', ward_number: 'GW-01', date_of_birth: new Date() }, pedia), false);
});
test('unknown departments fail closed without invalid UUIDs or database reads', async () => {
  assert.deepEqual(await resolveNursePatientScope({}, 'unknown'), { id: { in: [] } });
  assert.deepEqual(await nurseAppointmentScope({}, ''), { id: { in: [] } });
});
test('recorded historical care keeps discharged patients accessible to the treating department', async () => {
  const scope = await resolveNursePatientScope({ ...db, $queryRaw: async (sql) => sql.join('').includes('nurse_patient_departments') ? [{ id: 'historical' }] : [] }, 'MEDICINE');
  assert.equal(matches({ id: 'historical', admission_status: 'Discharged' }, scope), true);
});
test('configured wards take precedence over room-code guesses', async () => {
  const registryDb = { ...db, $queryRaw: async (sql) => {
    const query = sql.join('');
    if (query.includes('to_regclass')) return [{ name: 'ward_rooms' }];
    if (query.includes('JOIN public.ward_rooms')) return [{ id: 'actual-pediatric-patient' }];
    return [];
  } };
  const scope = await resolveNursePatientScope(registryDb, 'PEDIA');
  assert.equal(matches({ id: 'actual-pediatric-patient', ward_number: 'CUSTOM-101' }, scope), true);
  assert.equal(matches({ id: 'unrelated', ward_number: 'PD-99', admission_status: 'Inpatient' }, scope), false);
});
