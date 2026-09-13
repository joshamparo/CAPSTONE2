const test = require('node:test');
const assert = require('node:assert/strict');
const { createLabFileAccessToken, verifyLabFileAccessToken, createPatientLabFileUrl } = require('../utils/labFileAccessToken');

const env = { SESSION_SECRET: 'medical-link-test-secret', PUBLIC_API_ORIGIN: 'https://api.example.test' };
const values = { resultId: '21', patientId: 'patient-1', now: 1_000_000, ttlSeconds: 300, env };

test('mobile medical links use the configured API origin and bind result access', () => {
  const url = new URL(createPatientLabFileUrl(values));
  assert.equal(url.origin, env.PUBLIC_API_ORIGIN);
  assert.match(url.pathname, /^\/api\/lab-results\/file\/mobile\/[^/]+\/21\.pdf$/);
  assert.equal(url.search, '');
  const token = decodeURIComponent(url.pathname.split('/').at(-2));
  assert.equal(verifyLabFileAccessToken(token, { resultId: '21', now: values.now, env }).pid, 'patient-1');
  assert.equal(verifyLabFileAccessToken(token, { resultId: '22', now: values.now, env }), null);
});

test('mobile medical file tokens reject expiry and tampering', () => {
  const token = createLabFileAccessToken(values);
  assert.equal(verifyLabFileAccessToken(token, { resultId: '21', now: values.now + 301_000, env }), null);
  assert.equal(verifyLabFileAccessToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), { resultId: '21', now: values.now, env }), null);
});
