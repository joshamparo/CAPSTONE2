'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const staffRoute = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'staff.js'), 'utf8');

test('staff account lookup checks independent account tables concurrently', () => {
  const helper = staffRoute.slice(
    staffRoute.indexOf('async function findUserById'),
    staffRoute.indexOf('async function findUserByEmail')
  );

  assert.match(helper, /Promise\.all\(\[/);
  for (const model of ['staff', 'nurses', 'doctors', 'accounts']) {
    assert.match(helper, new RegExp(`prisma\\.${model}\\.findUnique`));
  }
});

test('deactivation commits account updates and its audit record atomically', () => {
  const route = staffRoute.slice(
    staffRoute.indexOf("router.delete('/:id'"),
    staffRoute.indexOf("router.post('/:id/reactivate'")
  );

  assert.match(route, /const auditEntry = prisma\.activity_logs\.create/);
  assert.match(route, /prisma\.accounts\.updateMany[\s\S]*auditEntry[\s\S]*\]\);/);
  assert.doesNotMatch(route, /await prisma\.activity_logs\.create/);
});

test('permanent deletion parallelizes conflict reads and uses a bounded transaction', () => {
  const route = staffRoute.slice(
    staffRoute.indexOf("router.delete('/:id/permanent'"),
    staffRoute.indexOf("router.post('/recovery-email-allowed'")
  );

  assert.match(route, /Promise\.all\(models\.map/);
  assert.match(route, /await prisma\.\$transaction\(deleteOperations\)/);
  assert.doesNotMatch(route, /for \(const model of \['staff', 'nurses', 'doctors', 'accounts'\]\)/);
  assert.doesNotMatch(route, /prisma\.\$transaction\(async/);
});
