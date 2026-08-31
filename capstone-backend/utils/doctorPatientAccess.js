const prisma = require('./prisma');
const { normalizeEmail } = require('./normalize');

const normalizeAssignee = (value) => String(value || '')
  .toLowerCase()
  .replace(/^dr\.?\s*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const appointmentMatchesDoctor = (appointment, doctor) => {
  const appointmentDoctorId = String(appointment?.doctor_uuid || '').trim();
  const doctorId = String(doctor?.id || '').trim();
  if (appointmentDoctorId && doctorId && appointmentDoctorId === doctorId) return true;
  const assigned = normalizeAssignee(appointment?.doctor_id);
  if (!assigned) return false;
  const candidates = [doctor?.name, doctor?.email, String(doctor?.email || '').split('@')[0]]
    .map(normalizeAssignee)
    .filter(Boolean);
  return candidates.some((candidate) => assigned === candidate || assigned.includes(candidate) || candidate.includes(assigned));
};

const resolveAuthenticatedDoctor = async (req, db = prisma) => {
  if (String(req.auth?.role || '').toLowerCase() !== 'doctor') return null;
  const id = String(req.auth?.id || '').trim();
  const email = normalizeEmail(req.auth?.email);
  let row = id ? await db.doctors.findUnique({ where: { id } }).catch(() => null) : null;
  if (!row && email) row = await db.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }).catch(() => null);
  if (!row) return null;
  return {
    id: String(row.id),
    email: normalizeEmail(row.email),
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    specialization: String(row.specialization || row.department || '').trim()
  };
};

const checkDoctorPatientAccess = async (req, patientId, db = prisma) => {
  const role = String(req.auth?.role || '').toLowerCase();
  if (role === 'admin') return { allowed: true, actor: null, patient: null };
  if (role !== 'doctor') return { allowed: false, actor: null, patient: null };
  const cleanPatientId = String(patientId || '').trim();
  if (!cleanPatientId) return { allowed: false, actor: null, patient: null };
  const [actor, patient] = await Promise.all([
    resolveAuthenticatedDoctor(req, db),
    db.patients.findUnique({ where: { id: cleanPatientId }, select: { id: true, email: true } }).catch(() => null)
  ]);
  if (!actor || !patient) return { allowed: false, actor, patient };

  const patientEmail = normalizeEmail(patient.email);
  const appointments = await db.appointments.findMany({
    where: {
      OR: [
        { patient_id: cleanPatientId },
        ...(patientEmail ? [{ email: { equals: patientEmail, mode: 'insensitive' } }] : [])
      ],
      status: { in: ['Confirmed', 'Completed', 'Done'] }
    },
    select: { doctor_id: true, doctor_uuid: true }
  }).catch(() => []);
  if (appointments.some((appointment) => appointmentMatchesDoctor(appointment, actor))) {
    return { allowed: true, actor, patient };
  }
  if (!actor.specialization) return { allowed: false, actor, patient };
  const peers = await db.doctors.findMany({
    where: { specialization: { equals: actor.specialization, mode: 'insensitive' } },
    select: { id: true, first_name: true, last_name: true, email: true }
  }).catch(() => []);
  const allowed = appointments.some((appointment) => peers.some((peer) => appointmentMatchesDoctor(appointment, {
    id: peer.id,
    email: peer.email,
    name: `${peer.first_name || ''} ${peer.last_name || ''}`.trim()
  })));
  return { allowed, actor, patient };
};

const enforceDoctorPatientAccess = async (req, res, patientId) => {
  const result = await checkDoctorPatientAccess(req, patientId);
  if (!result.allowed) res.status(403).json({ message: 'You are not authorized to access this patient.' });
  return result;
};

module.exports = {
  appointmentMatchesDoctor,
  resolveAuthenticatedDoctor,
  checkDoctorPatientAccess,
  enforceDoctorPatientAccess
};
