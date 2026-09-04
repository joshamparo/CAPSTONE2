const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function adminDeactivationBlock({ actorEmail, targetEmail, targetRole, activeAdminCount }) {
  const actor = normalizeEmail(actorEmail);
  const target = normalizeEmail(targetEmail);
  if (actor && target && actor === target) return 'You cannot deactivate your own administrator account.';
  if (String(targetRole || '').trim().toLowerCase() === 'admin' && Number(activeAdminCount) <= 1) {
    return 'The last active administrator cannot be deactivated.';
  }
  return '';
}

module.exports = { adminDeactivationBlock };
