'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function walkInHandlerSource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'patients.js'), 'utf8');
  const start = source.indexOf("router.post('/walk-in-intake'");
  const end = source.indexOf('// POST create new patient', start);
  assert.ok(start >= 0 && end > start, 'walk-in intake handler must remain discoverable');
  return source.slice(start, end);
}

test('walk-in intake does not run schema DDL during a patient request', () => {
  const handler = walkInHandlerSource();
  assert.doesNotMatch(handler, /\b(?:CREATE|ALTER)\s+(?:TABLE|INDEX)\b/i);
});

test('walk-in intake does not scan historical invoices or wait for email delivery', () => {
  const handler = walkInHandlerSource();
  assert.doesNotMatch(handler, /interval\s+'120 days'/i);
  assert.doesNotMatch(handler, /LIMIT\s+9999/i);
  assert.doesNotMatch(handler, /await\s+Promise\.race\s*\(/i);
});

test('walk-in HMO recovery is bounded to invoices created for the current intake window', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /created_at\s+>=\s+\(now\(\)\s+-\s+interval\s+'15 minutes'\)/i);
  assert.doesNotMatch(handler, /ON CONFLICT\s+\(invoice_id\)/i);
  assert.match(handler, /upsertWalkInHmoClaim\s*\(/i);
});

test('direct clinical routes create selected services once instead of using the concern as a duplicate order', () => {
  const handler = walkInHandlerSource();
  assert.match(handler, /routeServices\[0\]\s*\|\|\s*payload\.mainConcern/i);
  assert.match(handler, /routeMeta\.type === 'lab'\s*\?\s*payload\.selectedLabServices\.slice\(1\)/i);
  assert.match(handler, /routeMeta\.type === 'imaging'\s*\?\s*payload\.selectedImagingServices\.slice\(1\)/i);
});
