'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'requests.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'Pharmacist', 'PharmacistDashboard.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'manual_migration_pharmacy_requests.sql'), 'utf8');

test('pharmacy request actions do not run schema DDL', () => {
  assert.doesNotMatch(route, /ensureRequestsSchema|ensureStockMovementsTableExist|ensureBillingTablesExist/);
  assert.doesNotMatch(route, /CREATE TABLE IF NOT EXISTS|ALTER TABLE|CREATE INDEX IF NOT EXISTS/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.requests/);
  assert.match(migration, /requests_status_created_idx/);
});

test('request fulfillment is idempotent and locks request and inventory rows', () => {
  assert.match(route, /requireIdempotency\('pharmacy-request-fulfill'\)/);
  assert.match(route, /FROM public\.requests[\s\S]*FOR UPDATE/);
  assert.match(route, /FROM public\.medicines WHERE id = \$\{id\} FOR UPDATE/);
  assert.match(route, /FROM public\.supplies WHERE id = \$\{id\} FOR UPDATE/);
});

test('pharmacist request actions update rows before background refreshes', () => {
  assert.match(dashboard, /setRequestActionIds/);
  assert.match(dashboard, /'x-idempotency-key': idempotencyKey/);
  assert.match(dashboard, /setRequests\(\(current\) => current\.map/);
  assert.match(dashboard, /Promise\.allSettled\(\[fetchRequests\(\), fetchMedicines\(\), fetchSupplies\(\)\]\)/);
  assert.doesNotMatch(dashboard, /await Promise\.all\(\[fetchRequests\(\), fetchMedicines\(\), fetchSupplies\(\)\]\)/);
});
