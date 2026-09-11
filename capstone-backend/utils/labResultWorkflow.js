const REVIEWABLE_STATUSES = new Set(['matched', 'flagged', 'verified']);
const MANUAL_REVIEW_STATUSES = new Set(['flagged', 'rejected']);

function validateDoctorRelease(note, verificationStatus) {
  if (!String(note || '').trim()) return 'An interpretation is required before signing and releasing this result.';
  if (!REVIEWABLE_STATUSES.has(String(verificationStatus || '').trim().toLowerCase())) {
    return 'Automated file verification must finish before doctor sign-off.';
  }
  return '';
}

function canSetManualVerificationStatus(status) {
  return MANUAL_REVIEW_STATUSES.has(String(status || '').trim().toLowerCase());
}

module.exports = { canSetManualVerificationStatus, validateDoctorRelease };
