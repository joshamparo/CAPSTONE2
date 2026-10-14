const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Admin', 'AdminDashboard.js'),
  'utf8'
);
const restockSource = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'restockRequests.js'),
  'utf8'
);

test('admin restock rejection reports failures and prevents duplicate actions', () => {
  assert.match(adminSource, /const \[restockActionId, setRestockActionId\] = useState\(''\)/);
  assert.match(adminSource, /setSuccessMessage\(String\(error\?\.message \|\| 'Failed to reject request\.'\)\)/);
  assert.match(adminSource, /Rejecting\.\.\./);
  assert.match(restockSource, /AND status IN \('Pending', 'In Progress'\)/);
  assert.match(restockSource, /already processed by another user/);
});

test('admin report printing uses a rendered same-page frame instead of a transient blank tab', () => {
  assert.match(adminSource, /document\.createElement\('iframe'\)/);
  assert.match(adminSource, /await frameDocument\.fonts\?\.ready/);
  assert.match(adminSource, /printFrame\.contentWindow\.print\(\)/);
  const helperStart = adminSource.indexOf('const printTableReport');
  const helperEnd = adminSource.indexOf('const isLowStockItem', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.doesNotMatch(adminSource.slice(helperStart, helperEnd), /window\.open\(/);
});
