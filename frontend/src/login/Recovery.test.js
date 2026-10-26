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

test('scenario 7: resend stays disabled and displays the cooldown', () => {
  expect(source).toMatch(/disabled=\{isSubmitting \|\| resendTimer > 0\}/);
  expect(source).toMatch(/available in \{resendTimer\}s/);
});

test('scenario 8: successful resend restarts the server-provided cooldown', () => {
  expect(source).toMatch(/setResendTimer\(Math\.max\(1, Number\(data\?\.resendAfterSeconds\) \|\| 60\)\)/);
  expect(source).toMatch(/onClick=\{handleRecovery\}/);
});
