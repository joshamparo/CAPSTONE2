const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDoctorPatientAccess } = require('../utils/doctorPatientAccess');

const doctor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'anesthesia@example.com',
  first_name: 'Ana',
  last_name: 'Doctor',
  specialization: 'Anesthesia'
};

function fakeDb({ appointments = [], peers = [doctor], orders = [] } = {}) {
  return {
    doctors: {
      findUnique: async () => doctor,
      findFirst: async () => doctor,
      findMany: async () => peers
    },
    patients: {
      findUnique: async () => ({ id: 'patient-1', email: 'patient@example.com' })
    },
    appointments: { findMany: async () => appointments },
    clinical_orders: { findMany: async () => orders }
  };
}

const doctorRequest = { auth: { id: doctor.id, email: doctor.email, role: 'doctor' } };

test('doctor can write clinical records for an assigned patient', async () => {
  const result = await checkDoctorPatientAccess(doctorRequest, 'patient-1', fakeDb({
    appointments: [{ doctor_uuid: doctor.id, doctor_id: 'Ana Doctor' }]
  }));
  assert.equal(result.allowed, true);
});

test('doctor can write records for a patient assigned within the same specialization', async () => {
  const peer = { id: '22222222-2222-4222-8222-222222222222', email: 'peer@example.com', first_name: 'Peer', last_name: 'Doctor' };
  const result = await checkDoctorPatientAccess(doctorRequest, 'patient-1', fakeDb({
    appointments: [{ doctor_uuid: peer.id, doctor_id: 'Peer Doctor' }],
    peers: [doctor, peer]
  }));
  assert.equal(result.allowed, true);
});

test('doctor cannot write records for an unrelated patient', async () => {
  const result = await checkDoctorPatientAccess(doctorRequest, 'patient-1', fakeDb({
    appointments: [{ doctor_uuid: '33333333-3333-4333-8333-333333333333', doctor_id: 'Other Doctor' }]
  }));
  assert.equal(result.allowed, false);
});

test('a pathologist can review a direct laboratory order without a consultation appointment', async () => {
  const pathologist = { ...doctor, specialization: 'Pathology', department: 'Laboratory' };
  const db = fakeDb({ appointments: [], peers: [pathologist], orders: [{ assigned_role: 'medtech', kind: 'Laboratory', service: 'CBC' }] });
  db.doctors.findUnique = async () => pathologist;
  const result = await checkDoctorPatientAccess(doctorRequest, 'patient-1', db);
  assert.equal(result.allowed, true);
  assert.equal(result.clinicalReview, true);
});

test('an unrelated doctor cannot review a direct ECG order', async () => {
  const result = await checkDoctorPatientAccess(doctorRequest, 'patient-1', fakeDb({
    orders: [{ assigned_role: 'ecg_operator', kind: 'Diagnostic', service: '12-lead ECG' }]
  }));
  assert.equal(result.allowed, false);
});

test('administrator access remains unrestricted', async () => {
  const result = await checkDoctorPatientAccess({ auth: { role: 'admin' } }, 'patient-1', fakeDb());
  assert.equal(result.allowed, true);
});
