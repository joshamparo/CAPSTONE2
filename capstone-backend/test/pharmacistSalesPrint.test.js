'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Pharmacist', 'PharmacistDashboard.js'),
  'utf8'
);

test('pharmacist sales report keeps a writable print window', () => {
  const start = source.indexOf('const printSalesReport');
  const end = source.indexOf('const notifyApiDown', start);
  const handler = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'sales report print handler must exist');
  assert.match(handler, /window\.open\('', '_blank', 'width=1100,height=800,scrollbars=yes'\)/);
  assert.doesNotMatch(handler, /window\.open\([^\n]+noopener/);
  assert.match(handler, /w\.opener = null/);
  assert.match(handler, /w\.document\.write/);
  assert.match(handler, /Print Report/);
  assert.match(handler, /window\.setTimeout[\s\S]{0,100}window\.print\(\)/);
});
