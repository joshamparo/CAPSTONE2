const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { SPECIALTIES } = require('../utils/nurseScope');
const departmentMiddleware = require('../middleware/requireNurseDepartment');
const rolePath = require.resolve('../middleware/requireRole');
const departmentPath = require.resolve('../middleware/requireNurseDepartment');
require.cache[rolePath] = { exports: () => (req, res, next) => { req.auth = { role: 'nurse', email: 'test@example.test' }; next(); } };
const departmentStub = (req, res, next) => { req.nurseDepartment = req.headers['test-department']; next(); };
Object.assign(departmentStub, departmentMiddleware);
require.cache[departmentPath] = { exports: departmentStub };
require.cache[require.resolve('../utils/prisma')] = { exports: new Proxy({}, { get: () => { throw new Error('Denied requests must not reach the database'); } }) };
const wards = require('../routes/wards');
test('all thirteen other nurse departments are denied ward mutations before database access', async () => {
  const app = express(); app.use(express.json()); app.use('/wards', wards);
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    for (const department of Object.keys(SPECIALTIES).filter(v => !['ER', 'MEDICINE'].includes(v))) {
      for (const action of ['assign-patient', 'discharge-patient']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/wards/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-department': department }, body: JSON.stringify({ patientId: 'forged' }) });
        assert.equal(response.status, 403, `${department} ${action}`);
      }
    }
    for (const department of ['ER', 'MEDICINE']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/wards/assign-patient`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-department': department }, body: JSON.stringify({ patientId: 'invalid' }) });
      assert.equal(response.status, 400, `${department} reaches input validation`);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
