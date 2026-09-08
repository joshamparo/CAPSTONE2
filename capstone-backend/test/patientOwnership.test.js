const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOwnedPatient } = require('../utils/patientOwnership');
const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const auth = { role: 'patient', id: own, email: 'me@example.com' };
function database(rows) {
  return { patients: {
    findFirst: async ({ where }) => rows.find(row => row.id === where.id) || null,
    findMany: async ({ where }) => rows.filter(row => String(row.email || '').toLowerCase() === where.email.equals).slice(0, 2),
    update: () => assert.fail('Read must never assign patient ownership'),
    create: () => assert.fail('Read must never create a patient')
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
