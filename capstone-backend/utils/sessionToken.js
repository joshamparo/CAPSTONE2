const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function getSecret() {
  const secret = String(
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  return secret;
}

function signatureFor(encodedPayload) {
  return crypto.createHmac('sha256', getSecret()).update(encodedPayload).digest('base64url');
}

function createSessionToken({ id, email, role }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(id || ''),
    email: String(email || '').trim().toLowerCase(),
    role: String(role || '').trim().toLowerCase(),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signatureFor(encoded)}`;
}

function verifySessionToken(token) {
  const [encoded, suppliedSignature, extra] = String(token || '').trim().split('.');
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = signatureFor(encoded);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.sub || !payload?.email || !payload?.role || !Number.isFinite(payload?.exp) || payload.exp <= now) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { createSessionToken, verifySessionToken };
