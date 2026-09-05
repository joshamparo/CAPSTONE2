const { verifySessionToken } = require('../utils/sessionToken');
const prisma = require('../utils/prisma');

let sessionSchemaPromise = null;
function ensureSessionSchema() {
  if (!sessionSchemaPromise) {
    sessionSchemaPromise = (async () => {
      for (const table of ['staff', 'nurses', 'doctors', 'accounts']) {
        await prisma.$executeRawUnsafe(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`);
        await prisma.$executeRawUnsafe(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0`);
      }
    })().catch((error) => {
      sessionSchemaPromise = null;
      throw error;
    });
  }
  return sessionSchemaPromise;
}

function normalizeRoleHeader(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'administrator' || raw === 'administrator_account') return 'admin';
  if (raw.includes('doctor') && raw.includes('secretary')) return 'doctor_secretary';
  if (raw.includes('office') && raw.includes('staff')) return 'staff';
  if (raw.includes('clinical') && raw.includes('staff')) return 'staff';
  if (raw.includes('physical') && raw.includes('therap')) return 'physical_therapist';
  if (raw.includes('radiograph') || raw.includes('x-ray') || raw.includes('xray')) return 'radiographer';
  if (raw.includes('medtech')) return 'medtech';
  if (raw.includes('ecg')) return 'ecg_operator';
  if (raw.includes('cashier')) return 'cashier';
  if (raw.includes('pharmacist')) return 'pharmacist';
  if (raw.includes('nurse')) return 'nurse';
  if (raw.includes('pediatric') || raw.includes('pedia')) return 'doctor';
  if (raw.includes('doctor')) return 'doctor';
  if (raw.includes('admin')) return 'admin';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function verifyActiveSessionAccount(session, normalizedRole) {
  if (normalizedRole === 'patient') return true;
  await ensureSessionSchema();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT account_type::text AS account_role, is_active, session_version FROM public.staff WHERE lower(email) = lower($1)
    UNION ALL
    SELECT account_type::text AS account_role, is_active, session_version FROM public.nurses WHERE lower(email) = lower($1)
    UNION ALL
    SELECT account_type::text AS account_role, is_active, session_version FROM public.doctors WHERE lower(email) = lower($1)
    UNION ALL
    SELECT roles::text AS account_role, is_active, session_version FROM public.accounts WHERE lower(email) = lower($1)
  `, String(session.email || '').trim().toLowerCase());
  return (Array.isArray(rows) ? rows : []).some((row) => (
    normalizeRoleHeader(row.account_role) === normalizedRole
    && row.is_active === true
    && Number(row.session_version) === Number(session.sv)
  ));
}

let sessionAccountVerifier = verifyActiveSessionAccount;
let secretaryDoctorResolver = async (session) => {
  const linkedRows = await prisma.$queryRawUnsafe(
    `SELECT linked_doctor_id::text AS linked_doctor_id
     FROM public.accounts
     WHERE (id::text = $1 OR lower(email) = lower($2))
       AND lower(roles::text) IN ('doctor_secretary', 'doctor secretary')
     LIMIT 1`,
    String(session.sub || ''),
    String(session.email || '')
  );
  return String(linkedRows?.[0]?.linked_doctor_id || '').trim();
};

function requireRole(allowedRoles = []) {
  const normalizedAllowed = allowedRoles.map((role) => normalizeRoleHeader(role));
  return async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const authHeader = String(req.headers.authorization || '').trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const session = match ? verifySessionToken(match[1]) : null;
    if (!session) return res.status(401).json({ message: 'Authentication required. Please sign in again.' });
    const role = normalizeRoleHeader(session.role);
    if (!role || (normalizedAllowed.length > 0 && !normalizedAllowed.includes(role))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    try {
      const sessionIsCurrent = await sessionAccountVerifier(session, role);
      if (!sessionIsCurrent) return res.status(401).json({ message: 'Your session is no longer active. Please sign in again.' });
    } catch (error) {
      console.error('[Session authorization] Account verification failed:', error?.message || error);
      return res.status(503).json({ message: 'Unable to verify your session right now. Please try again.' });
    }
    req.auth = { id: session.sub, email: session.email, role, sessionVersion: session.sv };
    req.headers['x-user-role'] = role;
    req.headers['x-user-email'] = session.email;
    req.headers['x-user-id'] = session.sub;
    delete req.headers['x-linked-doctor-id'];
    if (role === 'doctor_secretary') {
      try {
        const linkedDoctorId = String(await secretaryDoctorResolver(session) || '').trim();
        if (linkedDoctorId) req.headers['x-linked-doctor-id'] = linkedDoctorId;
      } catch (error) {
        console.error('[Session authorization] Linked doctor verification failed:', error?.message || error);
        return res.status(503).json({ message: 'Unable to verify your linked doctor right now.' });
      }
    }
    next();
  };
}

requireRole.setSessionAccountVerifier = (verifier) => {
  sessionAccountVerifier = typeof verifier === 'function' ? verifier : verifyActiveSessionAccount;
};

requireRole.setSecretaryDoctorResolver = (resolver) => {
  secretaryDoctorResolver = typeof resolver === 'function' ? resolver : secretaryDoctorResolver;
};

module.exports = requireRole;
