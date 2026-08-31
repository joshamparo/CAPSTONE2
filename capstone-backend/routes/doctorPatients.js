const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset } = require('../utils/normalize');
const { canRequestPatientScope } = require('../utils/doctorAccess');


const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

const normalizeAssignee = (v) =>
  String(v || '')
    .toLowerCase()
    .replace(/^dr\.?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getRole = (req) => String(req.headers['x-user-role'] || '').toLowerCase();

const getActor = async (req) => {
  const email = normalizeEmail(String(req.headers['x-user-email'] || '').trim());
  const headerName = String(req.headers['x-user-name'] || '').trim();

  let name = headerName;
  let specialization = '';
  let doctorId = '';

  if (email) {
    const doc = await prisma.doctors
      .findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, first_name: true, last_name: true, specialization: true } })
      .catch(() => null);
    if (doc) {
      const full = `${doc.first_name || ''} ${doc.last_name || ''}`.trim();
      if (!name && full) name = full;
      specialization = String(doc.specialization || '');
      doctorId = String(doc.id || '');
    }
  }

  return {
    email: email || null,
    name: name || null,
    specialization: specialization || null,
    id: doctorId || null
  };
};

const getAppointmentStatuses = (raw) => {
  const v = String(raw || '').trim();
  if (!v) return ['Confirmed', 'Completed', 'Done'];
  if (v.toLowerCase() === 'all') return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const matchDoctor = (apt, actor) => {
  const doctorUuid = String(apt?.doctor_uuid || apt?.doctorUuid || '').trim();
  const actorId = String(actor?.id || '').trim();
  if (doctorUuid && actorId && doctorUuid === actorId) return true;

  const doctorLabel = normalizeAssignee(apt?.doctor_id || apt?.doctor || apt);
  if (!doctorLabel) return false;

  const candidates = [];
  if (actor?.name) candidates.push(normalizeAssignee(actor.name));
  if (actor?.email) candidates.push(normalizeAssignee(actor.email));
  if (actor?.email) candidates.push(normalizeAssignee(String(actor.email).split('@')[0]));

  return candidates.some((c) => c && (doctorLabel === c || doctorLabel.includes(c) || c.includes(doctorLabel)));
};

const ensurePatientByEmail = async (apt) => {
  const email = normalizeEmail(String(apt.email || '').trim());
  if (!email) return null;

  let patient = await prisma.patients.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }).catch(() => null);
  if (patient) return patient;

  const first = String(apt.first_name || '').trim() || 'Unknown';
  const last = String(apt.last_name || '').trim() || 'Unknown';
  const phone = String(apt.phone || '').trim() || null;
  const dob = apt.date_of_birth ? new Date(apt.date_of_birth) : null;

  try {
    patient = await prisma.patients.create({
      data: {
        first_name: first,
        last_name: last,
        middle_name: apt.middle_name || null,
        email,
        contact_number: phone,
        date_of_birth: dob
      }
    });
    return patient;
  } catch (_) {
    patient = await prisma.patients.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }).catch(() => null);
    return patient;
  }
};

const assertDoctorAccessToPatient = async ({ role, actor, patient }) => {
  if (role === 'admin') return true;
  const patientId = String(patient?.id || '').trim();
  const patientEmail = normalizeEmail(String(patient?.email || '').trim());
  if (!patientId && !patientEmail) return false;

  const apts = await prisma.appointments
    .findMany({
      where: {
        OR: [
          ...(patientId ? [{ patient_id: String(patientId) }] : []),
          ...(patientEmail ? [{ email: { equals: patientEmail, mode: 'insensitive' } }] : [])
        ]
      },
      select: { doctor_id: true, doctor_uuid: true, status: true }
    })
    .catch(() => []);

  const allowedStatuses = new Set(['Confirmed', 'Completed', 'Done']);
  const activeAppointments = (Array.isArray(apts) ? apts : []).filter((a) => allowedStatuses.has(String(a.status || '')));
  if (activeAppointments.some((a) => matchDoctor(a, actor))) return true;
  if (!actor?.specialization) return false;

  const sameSpecDoctors = await prisma.doctors.findMany({
    where: { specialization: { equals: actor.specialization, mode: 'insensitive' } },
    select: { id: true, first_name: true, last_name: true, email: true }
  }).catch(() => []);
  return activeAppointments.some((appointment) => sameSpecDoctors.some((doctor) => matchDoctor(appointment, {
    id: doctor.id,
    name: `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim(),
    email: doctor.email
  })));
};

router.get('/patients', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const role = getRole(req);
    const actor = await getActor(req);
    const q = String(req.query.q || '').trim().toLowerCase();
    const scope = String(req.query.scope || 'mine').trim().toLowerCase();
    if (!canRequestPatientScope(role, scope)) return res.status(403).json({ message: 'All-patient scope is restricted to administrators.' });
    const statuses = getAppointmentStatuses(req.query.status);
    const take = parseLimit(req.query.take, { min: 1, max: 50, fallback: 15 });
    const skip = parseOffset(req.query.skip, { min: 0, max: 5000, fallback: 0 });

    const where = {};
    if (statuses.length) where.status = { in: statuses };

    const raw = await prisma.appointments.findMany({
      where,
      orderBy: [{ appointment_date: 'desc' }, { created_at: 'desc' }],
      take: 1000
    });

    let filtered = Array.isArray(raw) ? raw : [];
    if (q) {
      filtered = filtered.filter((a) => {
        const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
        const email = String(a.email || '').toLowerCase();
        return fullName.includes(q) || email.includes(q);
      });
    }

    if (scope === 'specialization' && actor.specialization) {
      const sameSpecDoctors = await prisma.doctors.findMany({
        where: { specialization: { equals: actor.specialization, mode: 'insensitive' } },
        select: { id: true, first_name: true, last_name: true, email: true }
      }).catch(() => []);

      filtered = filtered.filter((a) => {
        // Match against any doctor in the same specialization
        return sameSpecDoctors.some(doc => {
          const docName = `${doc.first_name} ${doc.last_name}`;
          const docActor = { id: doc.id, name: docName, email: doc.email };
          return matchDoctor(a, docActor);
        });
      });
    } else if (scope !== 'all' && role !== 'admin') {
      filtered = filtered.filter((a) => matchDoctor(a, actor));
    }

    const byKey = new Map();
    for (const a of filtered) {
      const pid = String(a.patient_id || '').trim();
      const email = normalizeEmail(String(a.email || '').trim());
      const key = pid || email;
      if (!key) continue;
      const prev = byKey.get(key);
      const aTs = new Date(a.appointment_date || a.created_at || 0).getTime();
      const pTs = prev ? new Date(prev.appointment_date || prev.created_at || 0).getTime() : -1;
      if (!prev || aTs >= pTs) byKey.set(key, a);
    }

    const uniq = Array.from(byKey.values()).sort(
      (a, b) => new Date(b.appointment_date || b.created_at || 0) - new Date(a.appointment_date || a.created_at || 0)
    );

    const total = uniq.length;
    const page = uniq.slice(skip, skip + take);

    const rows = [];
    for (const apt of page) {
      const patient = await (async () => {
        const pid = String(apt.patient_id || '').trim();
        if (pid) {
          const p = await prisma.patients.findUnique({ where: { id: pid } }).catch(() => null);
          if (p) return p;
        }
        return ensurePatientByEmail(apt);
      })();
      rows.push({
        patient: patient
          ? {
              id: patient.id,
              first_name: patient.first_name,
              last_name: patient.last_name,
              middle_name: patient.middle_name,
              email: patient.email,
              contact_number: patient.contact_number,
              date_of_birth: patient.date_of_birth,
              gender: patient.gender,
              blood_type: patient.blood_type,
              allergies: patient.allergies,
              admission_status: patient.admission_status,
              ward_number: patient.ward_number,
              diagnosis: patient.diagnosis,
              attending_doctor: patient.attending_doctor
            }
          : null,
        lastVisitAt: (apt.appointment_date || apt.created_at || null),
        lastAppointment: {
          id: apt.id,
          status: apt.status || null,
          reason: apt.reason || null,
          main_concern: apt.main_concern || null,
          appointment_date: apt.appointment_date || null,
          appointment_time: apt.appointment_time || null,
          doctor_id: apt.doctor_id || null
        }
      });
    }

    res.json(serialize({ total, take, skip, rows }));
  } catch (err) {
    console.error('ERROR in /patients:', err);
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

router.get('/patients/:id/profile', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const role = getRole(req);
    const actor = await getActor(req);
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ message: 'Invalid patient id' });

    const patient = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const allowed = await assertDoctorAccessToPatient({ role, actor, patient });
    if (!allowed) return res.status(403).json({ message: 'Forbidden' });

    const [notesCount, rxCount, labsCount, certsCount, allNotes] = await Promise.all([
      prisma.doctor_notes.count({ where: { patient_id: patientId } }).catch(() => 0),
      prisma.prescriptions.count({ where: { patient_id: patientId } }).catch(() => 0),
      prisma.lab_results.count({ where: { patient_id: patientId } }).catch(() => 0),
      prisma.medical_certificates.count({ where: { patient_id: patientId } }).catch(() => 0),
      prisma.doctor_notes.findMany({ where: { patient_id: patientId }, select: { assessment: true } }).catch(() => [])
    ]);

    // Simple keyword extraction from notes assessment
    const keywords = new Set();
    allNotes.forEach(n => {
      const text = String(n.assessment || '').toLowerCase();
      // Simple split by comma, semicolon or common separators
      const parts = text.split(/[,;.\n]/).map(p => p.trim()).filter(p => p.length > 3 && p.length < 30);
      parts.forEach(p => keywords.add(p));
    });

    res.json(
      serialize({
        patient,
        counts: {
          notes: notesCount,
          prescriptions: rxCount,
          results: labsCount,
          certificates: certsCount
        },
        summary: {
          diagnosis: patient.diagnosis,
          clinical_records: patient.clinical_records,
          extractedKeywords: Array.from(keywords).slice(0, 10) // top 10
        }
      })
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/patients/:id/history', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const role = getRole(req);
    const actor = await getActor(req);
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ message: 'Invalid patient id' });

    const patient = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const allowed = await assertDoctorAccessToPatient({ role, actor, patient });
    if (!allowed) return res.status(403).json({ message: 'Forbidden' });

    const email = normalizeEmail(String(patient.email || '').trim());
    const [notes, prescriptions, labResults, certificates, appointments] = await Promise.all([
      prisma.doctor_notes.findMany({ where: { patient_id: patientId }, orderBy: { created_at: 'desc' }, take: 100 }).catch(() => []),
      prisma.prescriptions.findMany({ where: { patient_id: patientId }, orderBy: { created_at: 'desc' }, take: 100 }).catch(() => []),
      prisma.lab_results.findMany({ where: { patient_id: patientId }, orderBy: { created_at: 'desc' }, take: 100 }).catch(() => []),
      prisma.medical_certificates.findMany({ where: { patient_id: patientId }, orderBy: { created_at: 'desc' }, take: 100 }).catch(() => []),
      email
        ? prisma.appointments
            .findMany({ where: { email: { equals: email, mode: 'insensitive' } }, orderBy: [{ appointment_date: 'desc' }, { created_at: 'desc' }], take: 100 })
            .catch(() => [])
        : Promise.resolve([])
    ]);

    res.json(
      serialize({
        patientId,
        notes: notes.map((n) => ({ ...n, id: n.id.toString(), patientId: n.patient_id, doctorName: n.doctor_name })),
        prescriptions: prescriptions.map((p) => ({ ...p, id: p.id.toString(), patientId: p.patient_id, doctorName: p.doctor_name })),
        labResults: labResults.map((r) => ({ ...r, id: r.id.toString(), patientId: r.patient_id })),
        certificates: certificates.map((c) => ({ ...c, id: c.id.toString(), patientId: c.patient_id, doctorName: c.doctor_name })),
        appointments: appointments.map((a) => ({
          id: a.id.toString(),
          firstName: a.first_name,
          lastName: a.last_name,
          email: a.email,
          reason: a.reason,
          status: a.status,
          appointmentDate: a.appointment_date,
          appointmentTime: a.appointment_time,
          mainConcern: a.main_concern,
          doctor: a.doctor_id,
          createdAt: a.created_at
        }))
      })
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

