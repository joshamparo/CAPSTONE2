const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 15 * 60;

function getSecret(env = process.env) {
  const secret = String(env.SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.DATABASE_URL || '').trim();
  if (!secret) throw new Error('Medical file access secret is not configured.');
  return secret;
}

function sign(payload, env = process.env) {
  return crypto.createHmac('sha256', getSecret(env)).update(payload).digest('base64url');
}

function createLabFileAccessToken({ resultId, patientId, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS, env = process.env }) {
  const rid = String(resultId || '').trim();
  const pid = String(patientId || '').trim();
  if (!/^\d+$/.test(rid) || !pid) throw new Error('Invalid medical file access request.');
  const ttl = Math.max(60, Math.min(15 * 60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS));
  const encoded = Buffer.from(JSON.stringify({ rid, pid, exp: Math.floor(now / 1000) + ttl })).toString('base64url');
  return `${encoded}.${sign(encoded, env)}`;
}

function verifyLabFileAccessToken(token, { resultId, now = Date.now(), env = process.env } = {}) {
  const [encoded, suppliedSignature, extra] = String(token || '').trim().split('.');
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = sign(encoded, env);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!/^\d+$/.test(String(payload?.rid || '')) || !String(payload?.pid || '').trim()) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(now / 1000)) return null;
    if (resultId != null && String(payload.rid) !== String(resultId)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function createPatientLabFileUrl({ resultId, patientId, origin, now, ttlSeconds, env = process.env }) {
  const configuredOrigin = String(origin || env.PUBLIC_API_ORIGIN || 'https://api.pascualinga.com').trim().replace(/\/+$/, '');
  const target = new URL('/api/lab-results/file/mobile', configuredOrigin);
  target.searchParams.set('id', String(resultId));
  target.searchParams.set('token', createLabFileAccessToken({ resultId, patientId, now, ttlSeconds, env }));
  return target.href;
}

module.exports = { DEFAULT_TTL_SECONDS, createLabFileAccessToken, verifyLabFileAccessToken, createPatientLabFileUrl };
