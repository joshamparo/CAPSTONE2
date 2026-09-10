const test = require('node:test');
const assert = require('node:assert/strict');
let nurse;
require.cache[require.resolve('../utils/prisma')] = { exports: { nurses: { findFirst: async () => nurse } } };
const authorize = require('../middleware/requireNurseDepartment');
async function run(overrides = {}) {
  const req = { auth: { role: 'nurse', email: 'nurse@example.test' }, query: {}, body: {}, ...overrides };
  const result = { status: 200, next: false };
  const res = { status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } };
  await authorize(req, res, () => { result.next = true; });
  return { ...result, department: req.nurseDepartment };
}
test('stored specialization takes precedence over an old general ER department', async () => {
  nurse = { specialization: 'Dental Clinic', department: 'ER', first_name: 'Nurse', last_name: 'Test' };
  assert.deepEqual(await run(), { status: 200, next: true, department: 'DENTAL CLINIC' });
});
test('request parameters cannot switch a dental nurse to ER', async () => {
  nurse = { specialization: 'Dental Clinic', department: 'ER' };
  assert.equal((await run({ body: { department: 'ER' } })).status, 403);
});
test('missing, unassigned and unknown accounts never inherit ward manager permissions', async () => {
  for (const row of [null, { department: '', specialization: '' }, { specialization: 'Unknown' }]) {
    nurse = row;
    assert.equal((await run({ nurseDepartmentFallback: 'ER' })).status, 403);
  }
});
