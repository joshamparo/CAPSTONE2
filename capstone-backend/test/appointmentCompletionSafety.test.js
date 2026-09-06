'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('appointment completion claims an unfinished row before writing its audit event', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointments.js'), 'utf8');
  const completionRoute = source.slice(source.indexOf("router.post('/:id/complete'"));
  assert.match(completionRoute, /updateMany\(\{[\s\S]*completed_at:\s*null/);
  assert.match(completionRoute, /if \(Number\(claimed\?\.count \|\| 0\) === 1\) await prisma\.activity_logs\.create/);
  assert.match(completionRoute, /alreadyCompleted/);
});
