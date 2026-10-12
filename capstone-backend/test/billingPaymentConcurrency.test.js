const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'billing.js'), 'utf8');
const start = source.indexOf("router.post('/payments'");
const end = source.indexOf("router.get('/invoices/by-appointment", start);
const handler = source.slice(start, end);

test('payment creation locks its invoice before recomputing the balance', () => {
  const lock = handler.indexOf('FOR UPDATE');
  const transactionBalance = handler.indexOf('computeInvoiceFinancials(tx, invoiceId)');
  const create = handler.indexOf('tx.billing_payments.create');

  assert.ok(lock > -1, 'invoice row lock is required');
  assert.ok(transactionBalance > lock, 'balance must be computed after acquiring the lock');
  assert.ok(create > transactionBalance, 'payment must be created after the locked balance check');
  assert.doesNotMatch(handler, /computeInvoiceFinancials\(prisma, invoiceId\)/);
});

test('different idempotency keys cannot pay an already settled invoice', () => {
  assert.match(handler, /lockedBalance <= 0\.00001/);
  assert.match(handler, /Invoice is already fully paid/);
  assert.match(handler, /amountRaw - lockedBalance > 0\.00001/);
});

test('same-key retries remain idempotent inside the invoice lock', () => {
  const lock = handler.indexOf('FOR UPDATE');
  const retryLookup = handler.indexOf('idempotency_key: idempotencyKey', lock);
  assert.ok(retryLookup > lock, 'same-key lookup must be repeated while holding the invoice lock');
  assert.match(handler, /return \{ payment: existing, reused: true \}/);
  assert.match(handler, /paymentResult\.reused \? 200 : 201/);
  assert.match(handler, /if \(!paymentResult\.reused\) setImmediate/);
});
