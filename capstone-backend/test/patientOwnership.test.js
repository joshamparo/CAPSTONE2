const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOwnedPatient } = require('../utils/patientOwnership');
const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const auth = { role: 'patient', id: own, email: 'me@example.com' };
function database(rows, accounts = [], appointments = []) {
  return { patients: {
    findFirst: async ({ where }) => rows.find(row => row.id === where.id) || null,
    findMany: async ({ where }) => rows.filter((row) => {
      if (where.email) return String(row.email || '').toLowerCase() === where.email.equals;
      return String(row.first_name || '').toLowerCase() === where.first_name.equals.toLowerCase()
        && String(row.last_name || '').toLowerCase() === where.last_name.equals.toLowerCase()
        && String(row.date_of_birth) === String(where.date_of_birth);
    }).slice(0, 2),
    update: () => assert.fail('Read must never assign patient ownership'),
    create: () => assert.fail('Read must never create a patient')
  }, accounts: {
    findFirst: async () => accounts[0] || null
  }, appointments: {
    findMany: async ({ where }) => appointments
      .filter((row) => String(row.email || '').toLowerCase() === where.email.equals && row.patient_id)
      .slice(0, 2)
  } };
}
test('a supplied ID cannot claim another patient with an empty email', async () => {
  await assert.rejects(resolveOwnedPatient(database([{ id: other, email: null }]), auth, other), { statusCode: 403 });
});
test('signed patient ID retains access to its own unlinked record', async () => {
  assert.equal((await resolveOwnedPatient(database([{ id: own, email: null }]), auth, own)).id, own);
});
test('matching verified session email resolves a legacy patient record', async () => {
  assert.equal((await resolveOwnedPatient(database([{ id: other, email: 'ME@example.com' }]), auth)).id, other);
});
test('duplicate emails require clinic reconciliation instead of choosing a record arbitrarily', async () => {
  await assert.rejects(resolveOwnedPatient(database([{ id: other, email: auth.email }, { id: 'another', email: auth.email }]), auth), { statusCode: 409 });
});
test('unknown patients are not created by a result or billing read', async () => {
  await assert.rejects(resolveOwnedPatient(database([]), auth), { statusCode: 404 });
});
test('a malformed patient header fails closed', async () => {
  await assert.rejects(resolveOwnedPatient(database([]), auth, '../patient'), { statusCode: 400 });
});
test('a signed app account resolves one legacy patient using name and birth date', async () => {
  const legacyAuth = { role: 'patient', id: '164', email: 'josh@example.com' };
  const birthday = new Date('2005-05-24T00:00:00.000Z');
  const patient = { id: other, email: null, first_name: 'Josh', last_name: 'Amparo', date_of_birth: birthday };
  const account = { name: 'Josh Amparo', email: legacyAuth.email, birthday, roles: 'patient' };
  assert.equal((await resolveOwnedPatient(database([patient], [account]), legacyAuth, legacyAuth.id)).id, other);
});
test('a signed app account resolves the patient UUID used by its appointments', async () => {
  const appAuth = { role: 'patient', id: '164', email: 'josh@example.com' };
  const patient = { id: other, email: null, first_name: 'Josh', last_name: 'Amparo' };
  const appointment = { patient_id: other, email: appAuth.email };
  assert.equal((await resolveOwnedPatient(database([patient], [], [appointment]), appAuth, appAuth.id)).id, other);
});
test('ambiguous legacy profiles are never selected arbitrarily', async () => {
  const legacyAuth = { role: 'patient', id: '164', email: 'josh@example.com' };
  const birthday = new Date('2005-05-24T00:00:00.000Z');
  const account = { name: 'Josh Amparo', email: legacyAuth.email, birthday, roles: 'patient' };
  const duplicates = [
    { id: own, email: null, first_name: 'Josh', last_name: 'Amparo', date_of_birth: birthday },
    { id: other, email: null, first_name: 'Josh', last_name: 'Amparo', date_of_birth: birthday }
  ];
  await assert.rejects(resolveOwnedPatient(database(duplicates, [account]), legacyAuth), { statusCode: 409 });
});
