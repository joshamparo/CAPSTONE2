'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boundedDatabaseUrl } = require('../utils/prisma').__test;

test('Prisma uses a bounded connection pool suitable for small database compute', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'prisma.js'), 'utf8');
  assert.match(source, /PRISMA_CONNECTION_LIMIT\s*\|\|\s*5/);
  assert.match(source, /Math\.max\(1,\s*Math\.min\(5/);
  assert.match(source, /pool_timeout/);
  assert.match(source, /datasources:\s*\{\s*db:\s*\{\s*url:/);
  const escapedCredential = 'postgresql://user:p%26%26word@example.test:6543/postgres?pgbouncer=true';
  const bounded = boundedDatabaseUrl(escapedCredential);
  assert.match(bounded, /p%26%26word/);
  assert.doesNotMatch(bounded, /p%2526%2526word/);
  assert.match(bounded, /connection_limit=5/);
  assert.match(bounded, /pool_timeout=45/);
});

test('notification stream polling is single-flight and not an eight-second query loop', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
  const start = source.indexOf("router.get('/notifications/stream'");
  const end = source.indexOf("router.post('/notifications/mark-all-read'", start);
  const handler = source.slice(start, end);
  assert.match(handler, /if \(closed \|\| tickRunning\) return/);
  assert.match(handler, /setInterval\(tick, 30000\)/);
  assert.doesNotMatch(handler, /setInterval\(tick, 8000\)/);
});

test('header fallback polling pauses in hidden tabs and uses a one-minute cadence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'AccountHeaderActions.js'), 'utf8');
  assert.match(source, /visibilityState === 'visible'[\s\S]{0,120}fetchNotifications/);
  assert.match(source, /fetchNotifications[\s\S]{0,120}, 60000\)/);
  assert.match(source, /visibilityState === 'visible'[\s\S]{0,120}fetchAnnouncementToast/);
});

test('cashier dashboard does not preload hidden payment and closeout queries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'OfficeStaff', 'OfficeStaffDashboard.js'), 'utf8');
  assert.match(source, /if \(view === 'dashboard'\) refreshDashboardKpis\(\)/);
  assert.match(source, /if \(view === 'billing'\) refreshInvoices\(\)/);
  assert.match(source, /if \(!\['payments', 'closeout'\]\.includes\(view\)\) return/);
  assert.match(source, /if \(!\['billing', 'lab-payments', 'closeout'\]\.includes\(view\)\) return/);
  assert.doesNotMatch(source, /\['dashboard', 'payments', 'closeout'\]/);
  assert.match(source, /view === 'dashboard' \? 8 : 200/);
  assert.match(source, /params\.set\('withTotal', '1'\)/);
});

test('clinical order list supports lightweight total-count responses', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'clinicalOrders.js'), 'utf8');
  assert.match(source, /wantsTotal = String\(req\.query\.withTotal \|\| ''\) === '1'/);
  assert.match(source, /clinical_orders\.count\(\{ where \}\)/);
  assert.match(source, /return res\.json\(\{ items: mapped, totalCount, take: limit, skip: offset \}\)/);
});
