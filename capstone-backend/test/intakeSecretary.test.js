const test = require('node:test');
const assert = require('node:assert/strict');
const { getIntakeDoctorIds, hasIntakeSecretary } = require('../utils/intakeSecretary');

test('intake requires a usable secretary linked to an active doctor in the requested specialization', async () => {
  let rows = [];
  const db = {
    doctors: { findMany: async (query) => {
      assert.deepEqual(query.where, { specialization: { equals: 'Dental', mode: 'insensitive' }, is_active: true });
      return [{ id: 'dental-doctor' }];
    } },
    accounts: { findMany: async (query) => {
      assert.deepEqual(query.where.linked_doctor_id, { in: ['dental-doctor'] });
      assert.equal(query.where.roles.equals, 'doctor_secretary');
      return rows;
    } }
  };
  assert.equal(await hasIntakeSecretary(db, 'Dental'), false);
  rows = [
    { linked_doctor_id: 'dental-doctor', status: 'Inactive' },
    { linked_doctor_id: 'dental-doctor', status: ' disabled ' },
    { linked_doctor_id: 'dental-doctor', status: 'Suspended' }
  ];
  assert.equal(await hasIntakeSecretary(db, 'Dental'), false);
  rows.push({ linked_doctor_id: 'dental-doctor', status: 'Active' });
  assert.equal(await hasIntakeSecretary(db, 'Dental'), true);
  assert.deepEqual(await getIntakeDoctorIds(db, 'Dental'), ['dental-doctor']);
});

test('intake cannot use an unrelated secretary when no active specialist exists', async () => {
  assert.equal(await hasIntakeSecretary({
    doctors: { findMany: async () => [] },
    accounts: { findMany: async () => { throw new Error('must not query unrelated accounts'); } }
  }, 'Dental'), false);
});
