const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('../middleware/requireIdempotency');
const { actorKey, requestHash } = guard.__test;

test('request fingerprints are stable across object key order and sensitive to data changes', () => {
  assert.equal(requestHash({ patientId: 'p1', items: [{ quantity: 1, id: 2 }] }), requestHash({ items: [{ id: 2, quantity: 1 }], patientId: 'p1' }));
  assert.notEqual(requestHash({ amount: 100 }), requestHash({ amount: 200 }));
});

test('idempotency records are scoped to the signed actor', () => {
  assert.equal(actorKey({ auth: { role: 'nurse', email: 'NURSE@EXAMPLE.TEST' } }), 'nurse:nurse@example.test');
  assert.notEqual(actorKey({ auth: { role: 'nurse', email: 'a@example.test' } }), actorKey({ auth: { role: 'nurse', email: 'b@example.test' } }));
});

test('critical creation routes use the shared idempotency guard', () => {
  const cases = [
    ['routes/patients.js', /router\.post\('\/walk-in-intake', requireRole\(\['admin', 'nurse'\]\), requireIdempotency\('walk-in-intake'\)/],
    ['routes/clinicalOrders.js', /router\.post\('\/', requireIdempotency\('clinical-order-create'\)/],
    ['routes/billing.js', /router\.post\('\/invoices', requireIdempotency\('billing-invoice-create'\)/],
    ['routes/sales.js', /router\.post\('\/', requireRole\(\['pharmacist', 'admin'\]\), requireIdempotency\('pharmacy-sale-create'\)/]
  ];
  for (const [file, pattern] of cases) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, pattern, file);
  }
});

test('migration enforces one request key per operation and actor', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'manual_migration_idempotency_requests.sql'), 'utf8');
  assert.match(sql, /PRIMARY KEY \(operation, actor_key, idempotency_key\)/i);
  assert.match(sql, /response_body jsonb/i);
  assert.match(sql, /expires_at timestamptz/i);
});
