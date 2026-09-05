const MED_ADMIN_STATUSES = new Set(['administered', 'held', 'missed']);

function validateMedicationAction({ status, note }) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const normalizedNote = String(note || '').trim();
  if (!MED_ADMIN_STATUSES.has(normalizedStatus)) {
    return { ok: false, message: `Invalid medication status '${normalizedStatus}'. Allowed: administered, held, missed.` };
  }
  if ((normalizedStatus === 'held' || normalizedStatus === 'missed') && normalizedNote.length < 3) {
    return { ok: false, message: `A reason of at least 3 characters is required when medication is ${normalizedStatus}.` };
  }
  return { ok: true, status: normalizedStatus, note: normalizedNote || null };
}

function medicationTransitionError(existingStatuses, nextStatus) {
  const statuses = new Set((existingStatuses || []).map((value) => String(value || '').trim().toLowerCase()));
  if (statuses.has('administered')) return 'This medication request has already been administered.';
  if (statuses.has(nextStatus)) return `This medication request is already marked as ${nextStatus}.`;
  return '';
}

function isMatchingHandoverVersion(actual, expectedId, expectedUpdatedAt) {
  if (!actual || String(actual.id) !== String(expectedId || '')) return false;
  const actualTime = new Date(actual.updated_at || actual.updatedAt || 0).getTime();
  const expectedTime = new Date(expectedUpdatedAt || 0).getTime();
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
}

module.exports = {
  validateMedicationAction,
  medicationTransitionError,
  isMatchingHandoverVersion
};
