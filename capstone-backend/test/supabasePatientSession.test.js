const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySupabasePatientSession } = require('../utils/supabasePatientSession');
const { resolveOwnedPatient } = require('../utils/patientOwnership');
const requireRole = require('../middleware/requireRole');
const prisma = require('../utils/prisma');
const patientId = '11111111-1111-4111-8111-111111111111';
const user = { id: 'auth-user', email: 'patient@example.com', email_confirmed_at: '2026-01-01', user_metadata: { role: 'admin' } };
const env = { SUPABASE_URL: 'https://trusted.example', SUPABASE_ANON_KEY: 'test-key' };
function options(overrides = {}) {
  return {
    env,
    prisma: { patients: {
      findMany: async ({ where }) => { assert.equal(where.email.equals, user.email); return [{ id: patientId, email: user.email }]; }
    } },
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://trusted.example/auth/v1/user');
      assert.equal(request.headers.Authorization, 'Bearer a.b.c');
      assert.equal(request.redirect, 'error');
      return { ok: true, status: 200, json: async () => user };
    }, ...overrides
  };
}
test('verified Supabase identity resolves to patient only, ignoring metadata roles', async () => {
  const session = await verifySupabasePatientSession('a.b.c', options());
  assert.deepEqual(session, { sub: patientId, email: user.email, role: 'patient', sv: 0 });
});
test('expired, forged, and wrong-project tokens fail Auth verification', async () => {
  for (const status of [400, 401, 403]) {
    assert.equal(await verifySupabasePatientSession('a.b.c', options({ fetchImpl: async () => ({ status, ok: false }) })), null);
  }
  assert.equal(await verifySupabasePatientSession('invalid', options({ fetchImpl: () => assert.fail('must not fetch') })), null);
});
test('unconfirmed emails and anonymous sessions cannot resolve patient records', async () => {
  for (const identity of [{ ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }]) {
    assert.equal(await verifySupabasePatientSession('a.b.c', options({ fetchImpl: async () => ({ ok: true, json: async () => identity }) })), null);
  }
});
test('Auth outages fail closed with a retryable error', async () => {
  await assert.rejects(verifySupabasePatientSession('a.b.c', options({ fetchImpl: async () => { throw new Error('offline'); } })), { statusCode: 503 });
});
test('ambiguous patient identities fail rather than selecting a record', async () => {
  await assert.rejects(verifySupabasePatientSession('a.b.c', options({ prisma: { patients: { findMany: async () => [{ id: 'one' }, { id: 'two' }] } } })), { statusCode: 409 });
});
test('resolved Supabase patient cannot request another patient record', async () => {
  const session = await verifySupabasePatientSession('a.b.c', options());
  await assert.rejects(resolveOwnedPatient({ patients: { findFirst: async () => ({ id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }) } },
    { id: session.sub, email: session.email, role: session.role }, '22222222-2222-4222-8222-222222222222'), { statusCode: 403 });
});
test('route middleware accepts Supabase patients, overwrites spoofed identity, and rejects staff access', async () => {
  const savedFetch = global.fetch;
  const savedFind = prisma.patients.findMany;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  const savedSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = 'test-only';
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
    global.fetch = options().fetchImpl;
    prisma.patients.findMany = options().prisma.patients.findMany;
    const req = { method: 'GET', headers: { authorization: 'Bearer a.b.c', 'x-user-role': 'admin', 'x-user-email': 'other@example.com' } };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let allowed = false;
    await requireRole(['patient'])(req, res, () => { allowed = true; });
    assert.equal(allowed, true);
    assert.equal(req.auth.id, patientId);
    assert.equal(req.headers['x-user-role'], 'patient');
    assert.equal(req.headers['x-user-email'], user.email);
    await requireRole(['admin'])(req, res, () => assert.fail('staff access must fail'));
    assert.equal(res.code, 401);
  } finally {
    global.fetch = savedFetch;
    prisma.patients.findMany = savedFind;
    for (const [key, value] of Object.entries({ SUPABASE_URL: savedUrl, SUPABASE_ANON_KEY: savedKey, SESSION_SECRET: savedSecret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
