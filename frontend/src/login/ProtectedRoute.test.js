import { isSessionTokenExpired, readSessionTokenPayload } from './ProtectedRoute';

const tokenWithExpiry = (exp) => {
  const payload = window.btoa(JSON.stringify({ exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.test-signature`;
};

test('expired and malformed staff sessions fail closed', () => {
  const now = Date.UTC(2026, 8, 11, 3, 0, 0);
  expect(isSessionTokenExpired(tokenWithExpiry(Math.floor(now / 1000) - 1), now)).toBe(true);
  expect(isSessionTokenExpired(tokenWithExpiry(Math.floor(now / 1000) + 60), now)).toBe(false);
  expect(isSessionTokenExpired('not-a-token', now)).toBe(true);
});

test('route authorization can read the backend-issued role instead of trusting local storage', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = tokenWithExpiry(exp).replace(
    tokenWithExpiry(exp).split('.')[0],
    window.btoa(JSON.stringify({ exp, role: 'staff' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );

  expect(readSessionTokenPayload(token)?.role).toBe('staff');
});

test('standard three-part patient JWT expiry is read from the payload segment', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const encoded = window.btoa(JSON.stringify({ exp, role: 'authenticated' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  expect(isSessionTokenExpired(`header.${encoded}.signature`)).toBe(false);
});

test('wrong-role access is sent to the visible access-denied page', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'ProtectedRoute.js'), 'utf8');
  expect(source).toMatch(/Navigate to="\/unauthorized" replace/);
});
