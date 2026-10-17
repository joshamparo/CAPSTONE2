'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sales.js'), 'utf8');
const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Pharmacist', 'PharmacistDashboard.js'),
  'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'manual_migration_pharmacy_sale_links.sql'),
  'utf8'
);

test('pharmacy checkout uses the deployed billing schema', () => {
  assert.doesNotMatch(routeSource, /billing_invoice_items \(invoice_id, line_no,/);
  assert.doesNotMatch(routeSource, /billing_payments[^\n]*payment_date/);
  assert.match(routeSource, /invoice_id: result\.invoice/);
});

test('pharmacy checkout rejects stale or insufficient inventory server-side', () => {
  assert.match(routeSource, /FOR UPDATE/);
  assert.match(routeSource, /is no longer available/);
  assert.match(routeSource, /Insufficient stock for/);
  assert.match(routeSource, /Price changed for/);
  assert.match(routeSource, /statusCode = 409/);
});

test('pharmacy checkout schema changes run at deployment instead of per request', () => {
  const postRoute = routeSource.slice(routeSource.indexOf("router.post('/', requireRole"));
  assert.doesNotMatch(postRoute, /ALTER TABLE public\.sales/);
  assert.doesNotMatch(postRoute, /CREATE TABLE IF NOT EXISTS public\.stock_movements/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS patient_id uuid/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS invoice_id bigint/);
});

test('pharmacy POS refreshes stale inventory after a checkout conflict', () => {
  assert.match(dashboardSource, /Number\(err\?\.status\) === 409/);
  assert.match(dashboardSource, /Promise\.allSettled\(\[fetchMedicines\(\), fetchSupplies\(\), fetchPosProducts\(\)\]\)/);
});

test('sales report routes never call removed runtime schema setup', () => {
  assert.doesNotMatch(routeSource, /ensureSalesLinkColumns/);
});

test('sales report sections load concurrently and isolate endpoint failures', () => {
  assert.match(dashboardSource, /const reportRequests = await Promise\.allSettled\(/);
  assert.match(dashboardSource, /failedSections\.push\('Daily Summary'\)/);
  assert.match(dashboardSource, /failedSections\.push\('Transactions'\)/);
  assert.match(dashboardSource, /failedSections\.push\('Items Sold'\)/);
});
