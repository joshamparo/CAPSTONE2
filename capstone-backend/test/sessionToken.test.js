const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'automated-session-test-secret';

const { createSessionToken, verifySessionToken } = require('../utils/sessionToken');
const requireRole = require('../middleware/requireRole');

function invoke(middleware, token, extraHeaders = {}) {
  const req = { method: 'GET', headers: { authorization: `Bearer ${token}`, ...extraHeaders } };
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; }
  };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { req, response, nextCalled };
}

test('signed sessions verify and tampered sessions fail', () => {
  const token = createSessionToken({ id: 'doctor-1', email: 'doctor@example.com', role: 'doctor' });
  assert.equal(verifySessionToken(token).email, 'doctor@example.com');
  assert.equal(verifySessionToken(`${token}x`), null);
});

test('role middleware uses signed identity instead of spoofed headers', () => {
  const token = createSessionToken({ id: 'doctor-1', email: 'doctor@example.com', role: 'doctor' });
  const result = invoke(requireRole(['doctor']), token, { 'x-user-role': 'admin', 'x-user-email': 'attacker@example.com' });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.headers['x-user-role'], 'doctor');
  assert.equal(result.req.headers['x-user-email'], 'doctor@example.com');
});

test('role middleware rejects valid sessions with the wrong role', () => {
  const token = createSessionToken({ id: 'patient-1', email: 'patient@example.com', role: 'patient' });
  const result = invoke(requireRole(['doctor']), token);
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.statusCode, 403);
});
