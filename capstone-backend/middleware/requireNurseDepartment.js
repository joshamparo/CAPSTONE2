const prisma = require('../utils/prisma');

function normalizeNurseDepartment(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const aliases = {
    EMERGENCY: 'ER', EMERGENCYROOM: 'ER', ER: 'ER',
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

async function requireNurseDepartment(req, res, next) {
  if (req.auth?.role === 'admin') {
    req.nurseDepartment = normalizeNurseDepartment(req.query?.department || req.body?.department);
    return next();
  }
  const email = String(req.auth?.email || '').trim().toLowerCase();
  if (!email) return res.status(401).json({ message: 'Authenticated nurse email is required.' });
  try {
    const nurse = await prisma.nurses.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, is_active: true },
      select: { first_name: true, last_name: true, specialization: true, department: true }
    });
    const assigned = normalizeNurseDepartment(nurse?.specialization || nurse?.department);
    if (!assigned) return res.status(403).json({ message: 'Your nurse account has no assigned department. Contact an administrator.' });
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
