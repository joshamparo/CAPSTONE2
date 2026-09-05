const UPDATE_ROLES = new Set(['admin', 'nurse', 'doctor', 'patient']);
const PATIENT_PROTECTED_FIELDS = [
  'admissionStatus', 'wardNumber', 'diagnosis', 'attendingDoctor', 'admissionDate', 'clinicalRecords'
];

function patientUpdateAccess({ role, actorId, actorEmail, patientId, patientEmail }) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!UPDATE_ROLES.has(normalizedRole)) return { allowed: false, reason: 'role' };
  if (normalizedRole !== 'patient') return { allowed: true };
  const idMatch = String(actorId || '').trim() && String(actorId || '').trim() === String(patientId || '').trim();
  const emailMatch = String(actorEmail || '').trim().toLowerCase()
    && String(actorEmail || '').trim().toLowerCase() === String(patientEmail || '').trim().toLowerCase();
  return idMatch || emailMatch ? { allowed: true } : { allowed: false, reason: 'ownership' };
}

function sanitizePatientUpdateForRole(role, updateData) {
  const safe = { ...(updateData || {}) };
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'patient') PATIENT_PROTECTED_FIELDS.forEach((field) => delete safe[field]);
  if (normalizedRole === 'nurse') delete safe.clinicalRecords;
  return safe;
}

module.exports = { patientUpdateAccess, sanitizePatientUpdateForRole };
