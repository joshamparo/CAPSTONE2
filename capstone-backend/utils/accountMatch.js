const { normalizeRole } = require('./normalize');

const MODEL_ROLE = {
  nurses: 'nurse',
  doctors: 'doctor',
  staff: 'staff'
};

function roleForMatch(match) {
  return normalizeRole(match?.user?.account_type || match?.user?.roles || MODEL_ROLE[match?.model] || '');
}

function selectCanonicalAccount(matches = []) {
  const available = matches.filter((match) => match?.user && match?.model);
  if (available.length === 0) return { selected: null, duplicate: false, conflicting: false };

  const roles = new Set(available.map(roleForMatch).filter(Boolean));
  if (roles.size > 1) return { selected: null, duplicate: true, conflicting: true };

  // Clinical/staff tables are the source of truth. The accounts row is a
  // compatibility mirror created for nurses and doctors by the staff route.
  const selected = available.find((match) => match.model !== 'accounts') || available[0];
  return { selected, duplicate: available.length > 1, conflicting: false };
}

module.exports = { roleForMatch, selectCanonicalAccount };
