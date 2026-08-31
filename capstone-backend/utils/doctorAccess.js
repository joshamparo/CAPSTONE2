function canRequestPatientScope(role, scope) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedScope = String(scope || 'mine').trim().toLowerCase();
  return normalizedScope !== 'all' || normalizedRole === 'admin';
}

module.exports = { canRequestPatientScope };
