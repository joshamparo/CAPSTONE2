const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { enforceDoctorPatientAccess } = require('../utils/doctorPatientAccess');
const { sendError } = require('../utils/httpErrors');

async function ensureClinicalDetailsColumn() {
  await prisma.$executeRawUnsafe('ALTER TABLE public.doctor_notes ADD COLUMN IF NOT EXISTS clinical_details jsonb;');
}

function cleanText(value, max = 5000) {
  const text = String(value || '').trim();
  return text.length <= max ? text : null;
}

router.get('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    await ensureClinicalDetailsColumn();
    const { patientId } = req.query;
    if (!patientId) return res.json([]);
    const access = await enforceDoctorPatientAccess(req, res, patientId);
    if (!access.allowed) return;
    const notes = await prisma.doctor_notes.findMany({
      where: { patient_id: patientId },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    
    // Serialize ID
    const serialized = notes.map(n => ({
        ...n,
        id: n.id.toString(),
        patientId: n.patient_id,
        doctorName: n.doctor_name,
        clinicalDetails: n.clinical_details || {}
    }));
    
    res.json(serialized);
  } catch (err) {
    sendError(res, err, 'Unable to load clinical notes.');
  }
});

router.post('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    await ensureClinicalDetailsColumn();
    const { patientId, doctorName, subjective, objective, assessment, plan, vitals, clinicalDetails } = req.body;
    if (!patientId || !doctorName) {
      return res.status(400).json({ message: 'patientId and doctorName are required' });
    }
    const access = await enforceDoctorPatientAccess(req, res, patientId);
    if (!access.allowed) return;
    const authenticatedDoctor = req.auth?.role === 'doctor'
      ? await prisma.doctors.findFirst({
          where: { email: { equals: req.auth.email, mode: 'insensitive' } },
          select: { first_name: true, last_name: true }
        })
      : null;
    const actorName = authenticatedDoctor
      ? `${authenticatedDoctor.first_name || ''} ${authenticatedDoctor.last_name || ''}`.trim()
      : String(doctorName || '').trim();
    if (!actorName) return res.status(401).json({ message: 'Unable to resolve the authenticated doctor.' });
    const requiredFields = { subjective, objective, assessment, plan };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !String(value || '').trim())
      .map(([field]) => field.charAt(0).toUpperCase() + field.slice(1));
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Complete the required consultation fields: ${missingFields.join(', ')}.`
      });
    }
    const invalidFields = Object.entries(requiredFields)
      .filter(([, value]) => {
        const length = String(value || '').trim().length;
        return length < 3 || length > 5000;
      })
      .map(([field]) => field.charAt(0).toUpperCase() + field.slice(1));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `SOAP fields must contain 3 to 5,000 characters: ${invalidFields.join(', ')}.` });
    }
    const allowedClinicalFields = [
      'specialization', 'vaccinationHistory', 'milestones', 'heartRateRhythm', 'ecgNotes',
      'chestPainDuration', 'lesionType', 'affectedArea', 'skinType', 'lmp', 'fetalHeartRate',
      'operationType', 'anesthesiaType', 'surgicalSite'
    ];
    const cleanClinicalDetails = {};
    for (const field of allowedClinicalFields) {
      const value = cleanText(clinicalDetails?.[field], 2000);
      if (value === null) return res.status(400).json({ message: `${field} cannot exceed 2,000 characters.` });
      if (value) cleanClinicalDetails[field] = value;
    }

    const created = await prisma.doctor_notes.create({
      data: {
        patient_id: patientId,
        doctor_name: actorName,
        subjective: String(subjective).trim(),
        objective: String(objective).trim(),
        assessment: String(assessment).trim(),
        plan: String(plan).trim(),
        vitals,
        clinical_details: cleanClinicalDetails
      }
    });

    prisma.activity_logs.create({
      data: {
        actor_name: actorName,
        role: 'Doctor',
        action: 'Create',
        target: `Patient:${patientId}`,
        details: 'Created consultation note'
      }
    }).catch(() => {});

    res.status(201).json({
        ...created,
        id: created.id.toString(),
        clinicalDetails: created.clinical_details || {}
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

