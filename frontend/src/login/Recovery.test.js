const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'Recovery.js'), 'utf8');

test('unknown recovery email displays the requested not-registered validation', () => {
  expect(source).toMatch(/recovery-email-allowed/);
  expect(source).toMatch(/eligibilityResponse\.status === 404/);
  expect(source).toMatch(/Email address not found or not registered\./);
});

test('recovery link is requested only after account eligibility succeeds', () => {
  const eligibilityAt = source.indexOf('/api/staff/recovery-email-allowed');
  const requestAt = source.indexOf('/api/staff/request-password-reset');

  expect(eligibilityAt).toBeGreaterThan(-1);
  expect(requestAt).toBeGreaterThan(eligibilityAt);
});
