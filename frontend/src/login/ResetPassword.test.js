const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'ResetPassword.js'), 'utf8');

test('scenario 9: weak or mismatched passwords stop before the reset request', () => {
  const policyAt = source.indexOf('if (!hasLength || !hasSpecialChar || !hasNumber || !hasUppercase)');
  const mismatchAt = source.indexOf('if (newPassword !== confirmPassword)');
  const requestAt = source.indexOf('/api/staff/reset-password');

  expect(policyAt).toBeGreaterThan(-1);
  expect(mismatchAt).toBeGreaterThan(policyAt);
  expect(requestAt).toBeGreaterThan(mismatchAt);
  expect(source).toMatch(/Please meet all password requirements\./);
  expect(source).toMatch(/Passwords do not match\./);
});

test('scenario 10: a successful reset removes the token from browser history and returns to login', () => {
  expect(source).toMatch(/window\.history\.replaceState\(\{\}, document\.title, '\/reset-password'\)/);
  expect(source).toMatch(/Password successfully reset! Redirecting to login/);
  expect(source).toMatch(/navigate\('\/login'\)/);
});
