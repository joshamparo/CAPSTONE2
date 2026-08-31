const { verifySessionToken } = require('../utils/sessionToken');

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

function requireRole(allowedRoles = []) {
  const normalizedAllowed = allowedRoles.map((r) => normalizeRoleHeader(r));

  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const authHeader = String(req.headers.authorization || '').trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const session = match ? verifySessionToken(match[1]) : null;
    if (!session) return res.status(401).json({ message: 'Authentication required. Please sign in again.' });
    const role = normalizeRoleHeader(session.role);
    if (!role || (normalizedAllowed.length > 0 && !normalizedAllowed.includes(role))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.auth = { id: session.sub, email: session.email, role };
    req.headers['x-user-role'] = role;
    req.headers['x-user-email'] = session.email;
    req.headers['x-user-id'] = session.sub;
    next();
  };
}

module.exports = requireRole;
