import { isSessionTokenExpired } from './ProtectedRoute';

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
