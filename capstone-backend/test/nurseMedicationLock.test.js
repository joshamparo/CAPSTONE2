const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('medication administration executes advisory lock without deserializing void', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'nurseWorkflow.js'), 'utf8');
  assert.match(
    source,
    /tx\.\$executeRawUnsafe\('SELECT pg_advisory_xact_lock\(\$1::bigint\)', requestId\)/
  );
  assert.doesNotMatch(
    source,
    /tx\.\$queryRawUnsafe\('SELECT pg_advisory_xact_lock\(\$1::bigint\)', requestId\)/
  );
});
