'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');

test('admin dashboard requests the lightweight patient list and a bounded activity feed', () => {
  const dashboard = read('frontend/src/Admin/AdminDashboard.js');
  assert.match(dashboard, /\/api\/patients\?summary=1&take=2000/);
  assert.match(dashboard, /\/api\/activity-logs\?take=50/);
});

test('patient summary mode is admin-only and excludes sensitive or heavy fields', () => {
  const route = read('capstone-backend/routes/patients.js');
  const selectStart = route.indexOf('const ADMIN_PATIENT_SUMMARY_SELECT');
  const selectEnd = route.indexOf('});', selectStart);
  assert.ok(selectStart >= 0 && selectEnd > selectStart, 'summary projection must remain discoverable');

  const projection = route.slice(selectStart, selectEnd);
  assert.match(projection, /first_name:\s*true/);
  assert.match(projection, /last_name:\s*true/);
  assert.match(projection, /contact_number:\s*true/);
  assert.doesNotMatch(projection, /clinical_records|password|reset_password|diagnosis|allergies/);

  assert.match(route, /requesterRole === 'admin' && String\(req\.query\.summary \|\| ''\)/);
  assert.match(route, /adminSummaryRequested \? \{ select: ADMIN_PATIENT_SUMMARY_SELECT \} : \{\}/);
});
