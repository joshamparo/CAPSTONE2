'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('admin audit view uses bounded server-side pagination', () => {
  const frontend = fs.readFileSync(path.join(root, 'frontend', 'src', 'Admin', 'AdminDashboard.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'activityLogs.js'), 'utf8');

  assert.match(frontend, /ACTIVITY_LOGS_PER_PAGE\s*=\s*12/);
  assert.match(frontend, /params\.set\('includeTotal', '1'\)/);
  assert.match(frontend, /params\.set\('skip'/);
  assert.doesNotMatch(frontend, /activity-logs\?take=200/);
  assert.match(backend, /includeTotal/);
  assert.match(backend, /activity_logs\.count/);
});

test('admin read indexes cover audit ordering and signed-session account lookups', () => {
  const migration = fs.readFileSync(
    path.join(root, 'capstone-backend', 'prisma', 'manual_migration_admin_read_performance.sql'),
    'utf8'
  );

  assert.match(migration, /activity_logs\s*\(timestamp DESC\)/i);
  for (const table of ['staff', 'nurses', 'doctors', 'accounts']) {
    assert.match(migration, new RegExp(`ON public\\.${table} \\(lower\\(email\\)\\)`, 'i'));
  }
  assert.doesNotMatch(migration, /DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\S+\s+SET/i);
});
