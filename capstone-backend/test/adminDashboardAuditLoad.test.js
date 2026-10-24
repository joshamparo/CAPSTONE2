'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Admin', 'AdminDashboard.js'),
  'utf8'
);

test('admin dashboard loads its audit card without visiting the activity-log page', () => {
  const fetchStart = dashboard.indexOf('const fetchDashboardData = async');
  const fetchEnd = dashboard.indexOf('const fetchSalesMonitoring', fetchStart);
  const dashboardFetch = dashboard.slice(fetchStart, fetchEnd);
  const cardStart = dashboard.indexOf('Audit Log', dashboard.indexOf('admin-dashboard-side-column'));
  const cardEnd = dashboard.indexOf('renderOperationalSnapshotPanel', cardStart);
  const auditCard = dashboard.slice(cardStart, cardEnd);

  assert.match(dashboardFetch, /setDashboardAuditLogs\(mapped\.slice\(0, 8\)\)/);
  assert.match(auditCard, /dashboardAuditLogs === null/);
  assert.match(auditCard, /dashboardAuditLogs\.map/);
  assert.doesNotMatch(auditCard, /activityLogs\.map/);
});
