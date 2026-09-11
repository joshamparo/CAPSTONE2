const prisma = require('../utils/prisma');
const SUPPORTED_NURSE_DEPARTMENTS = new Set(['ER', 'OPD', 'PEDIA', 'MEDICINE', 'LABORATORY', 'VIDEO CONSULTATION', 'ECG', 'RADIOLOGY', 'PHYSICAL THERAPY', 'DENTAL CLINIC', 'SURGERY (MINOR)', 'ANESTHESIA', 'OTOLARYNGOLOGY (ENT)', 'PATHOLOGY', 'ORTHOPEDICS']);

function normalizeNurseDepartment(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const aliases = {
    EMERGENCY: 'ER', EMERGENCYROOM: 'ER', EMERGENCYNURSING: 'ER', ERNURSING: 'ER', ER: 'ER',
    OUTPATIENT: 'OPD', OUTPATIENTDEPARTMENT: 'OPD', OUTPATIENTDEPT: 'OPD', OPD: 'OPD',
    PEDIATRIC: 'PEDIA', PEDIATRICS: 'PEDIA', PEDIA: 'PEDIA',
    INTERNALMEDICINE: 'MEDICINE', MEDICINE: 'MEDICINE',
    LAB: 'LABORATORY', LABORATORY: 'LABORATORY',
    VIDEOCONSULT: 'VIDEO CONSULTATION', VIDEOCONSULTATION: 'VIDEO CONSULTATION',
    ECG: 'ECG', RADIOLOGY: 'RADIOLOGY', PHYSICALTHERAPY: 'PHYSICAL THERAPY',
    DENTAL: 'DENTAL CLINIC', DENTALCLINIC: 'DENTAL CLINIC',
    SURGERY: 'SURGERY (MINOR)', SURGERYMINOR: 'SURGERY (MINOR)',
    ANESTHESIA: 'ANESTHESIA', OTOLARYNGOLOGY: 'OTOLARYNGOLOGY (ENT)',
    OTOLARYNGOLOGYENT: 'OTOLARYNGOLOGY (ENT)', ENT: 'OTOLARYNGOLOGY (ENT)',
    PATHOLOGY: 'PATHOLOGY', ORTHOPEDICS: 'ORTHOPEDICS'
  };
  return aliases[compact] || raw.toUpperCase().replace(/\s+/g, ' ');
}

function resolveNurseDepartmentScope(assignedDepartment, fallbackDepartment) {
  const primary = normalizeNurseDepartment(assignedDepartment);
  const fallback = normalizeNurseDepartment(fallbackDepartment);
  if (SUPPORTED_NURSE_DEPARTMENTS.has(primary)) return primary;
  if (SUPPORTED_NURSE_DEPARTMENTS.has(fallback)) return fallback;
  return primary || fallback;
}

async function requireNurseDepartment(req, res, next) {
  if (req.auth?.role === 'admin') {
    req.nurseDepartment = normalizeNurseDepartment(req.query?.department || req.body?.department);
    return next();
  }
  const email = String(req.auth?.email || '').trim().toLowerCase();
  const nurseId = String(req.auth?.id || '').trim();
  if (!email && !nurseId) return res.status(401).json({ message: 'Authenticated nurse identity is required.' });
  try {
    const nurse = await prisma.nurses.findFirst({
      where: {
        is_active: true,
        OR: [
          ...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : []),
          ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nurseId) ? [{ id: nurseId }] : [])
        ]
      },
      select: { first_name: true, last_name: true, specialization: true, department: true }
    });
    if (!nurse) return res.status(403).json({ message: 'An active nurse account is required.' });
    const assigned = resolveNurseDepartmentScope(nurse.specialization, nurse.department);
    if (!SUPPORTED_NURSE_DEPARTMENTS.has(assigned)) return res.status(403).json({ message: 'Your nurse account needs a valid assigned specialization. Contact an administrator.' });
    const requested = normalizeNurseDepartment(req.query?.department || req.body?.department);
    if (requested && requested !== assigned) {
      return res.status(403).json({ message: 'You can only access your assigned nurse department.' });
    }
    req.nurseDepartment = assigned;
    req.nurseIdentity = {
      email,
      name: `${String(nurse.first_name || '').trim()} ${String(nurse.last_name || '').trim()}`.trim() || email
    };
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'department')) req.query.department = assigned;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'department')) req.body.department = assigned;
    return next();
  } catch (error) {
    console.error('[Nurse department authorization] Failed:', error?.message || error);
    return res.status(503).json({ message: 'Unable to verify your assigned nurse department right now.' });
  }
}

module.exports = requireNurseDepartment;
module.exports.normalizeNurseDepartment = normalizeNurseDepartment;
module.exports.resolveNurseDepartmentScope = resolveNurseDepartmentScope;
