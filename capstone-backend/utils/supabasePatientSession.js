const { resolveOwnedPatient } = require('./patientOwnership');

// Validate with the configured Auth server; never trust decoded JWT claims or
// client metadata for identity, project selection, or staff privileges.
async function verifySupabasePatientSession(token, { prisma, env = process.env, fetchImpl = fetch } = {}) {
  if (String(token || '').split('.').length !== 3) return null;
  const origin = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) return null;
  let response;
  try {
    response = await fetchImpl(`${origin}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000), redirect: 'error'
    });
  } catch (_) {
    throw Object.assign(new Error('Unable to verify your session right now.'), { statusCode: 503 });
  }
  if ([400, 401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw Object.assign(new Error('Unable to verify your session right now.'), { statusCode: 503 });
  const user = await response.json();
  if (!user?.id || !user.email || !user.email_confirmed_at || user.is_anonymous) return null;
  // Resolve by verified email rather than assuming an Auth UUID is a clinical UUID.
  const patient = await resolveOwnedPatient(prisma, { role: 'patient', email: user.email });
  return { sub: String(patient.id), email: String(user.email).trim().toLowerCase(), role: 'patient', sv: 0 };
}

module.exports = { verifySupabasePatientSession };
