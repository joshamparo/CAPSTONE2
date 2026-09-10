const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const patientId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
let stored = null;
const audit = [];
const db = {
  patients: { findFirst: async ({ where }) => where.AND[0].id === patientId ? { id: patientId } : null },
  clinical_orders: { findFirst: async ({ where }) => where.id === 7n && where.patient_id === patientId ? { id: 7n } : null },
  activity_logs: { create: async ({ data }) => { audit.push(data); return data; } },
  clinical_order_events: { create: async ({ data }) => data },
  $executeRaw: async () => 1,
  $transaction: async action => action(db),
  $queryRaw: async (strings, ...values) => {
    const sql = strings.join('?');
    if (sql.startsWith('SELECT * FROM')) return stored && stored.id === values[0] && stored.patient_id === values[1] && stored.department === values[2] ? [stored] : [];
    if (sql.startsWith('SELECT id')) return stored && stored.stage !== 'Completed' ? [{ id: stored.id }] : [];
    if (sql.startsWith('INSERT INTO')) {
      stored = { id: episodeId, patient_id: values[0], department: values[1], stage: values[2], checks: JSON.parse(values[3]), notes: JSON.parse(values[4]), handoff_to: values[5], order_id: values[6] ? String(values[6]) : null, history: JSON.parse(values[7]), version: 1 };
      return [stored];
    }
    if (sql.startsWith('UPDATE')) {
      stored = { ...stored, stage: values[0], checks: JSON.parse(values[1]), notes: JSON.parse(values[2]), handoff_to: values[3], history: JSON.parse(values[4]), version: stored.version + 1 };
      return [stored];
    }
    return stored ? [stored] : [];
  }
};
require.cache[require.resolve('../utils/prisma')] = { exports: db };
require.cache[require.resolve('../utils/nurseCareStorage')] = { exports: { ensureNurseCareTable: async () => {} } };
const scopePath = require.resolve('../utils/nurseScope');
const scope = require(scopePath);
require.cache[scopePath] = { exports: { ...scope, resolveNursePatientScope: async () => ({ id: patientId }) } };
const router = require('../routes/nurseSpecialtyCare');
test('specialty API saves linked care, rejects stale edits and outsiders, and exposes shared history', async () => {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { role: 'nurse', email: 'nurse@example.test' }; req.nurseDepartment = 'LABORATORY'; next(); });
  app.use('/care', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/care`;
  const post = (id, body) => fetch(`${url}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const config = await (await fetch(`${url}/config`)).json();
    const body = { stage: 'Preparation', checks: config.checks.map(() => true), notes: config.fields.map(() => 'Documented'), handoffTo: '', orderId: '7' };
    assert.equal((await post('33333333-3333-4333-8333-333333333333', body)).status, 403);
    assert.equal((await post(patientId, { ...body, orderId: '8' })).status, 400);
    const created = await post(patientId, body);
    assert.equal(created.status, 200);
    const row = await created.json();
    assert.equal(row.order_id, '7');
    assert.equal(row.history[0].by, 'nurse@example.test');
    assert.equal((await post(patientId, body)).status, 409);
    assert.equal((await post(patientId, { ...body, id: row.id, version: 0 })).status, 409);
    assert.equal((await post(patientId, { ...body, id: row.id, version: 1, stage: 'In progress' })).status, 200);
    assert.equal((await post(patientId, { ...body, id: row.id, version: 1, stage: 'Handed off' })).status, 409);
    const timeline = await (await fetch(`${url}/${patientId}`)).json();
    assert.equal(timeline[0].history.length, 2);
    assert.equal(audit.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
