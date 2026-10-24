const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { enforceDoctorPatientAccess } = require('../utils/doctorPatientAccess');
const { sendError } = require('../utils/httpErrors');
const { normalizeMedicalCertificateInput } = require('../utils/medicalCertificateValidation');

router.get('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) return res.json([]);
    const access = await enforceDoctorPatientAccess(req, res, patientId);
    if (!access.allowed) return;

    const certs = await prisma.$queryRaw`
      SELECT id, patient_id, doctor_name, purpose, diagnosis, recommendations, valid_until, created_at
      FROM medical_certificates
      WHERE patient_id = ${patientId}::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const serialized = (Array.isArray(certs) ? certs : []).map((c) => ({
      ...c,
      id: c.id.toString(),
      patientId: c.patient_id,
      doctorName: c.doctor_name
    }));

    res.json(serialized);
  } catch (err) {
    sendError(res, err, 'Unable to load medical certificates.');
  }
});

router.post('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const validation = normalizeMedicalCertificateInput(req.body);
    if (!validation.ok) return res.status(400).json({ message: validation.message });
    const { patientId, purpose, diagnosis, recommendations, validUntil } = validation.value;
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
      : String(req.body?.doctorName || req.auth?.name || '').trim();
    if (!actorName) return res.status(401).json({ message: 'Unable to resolve the authenticated doctor.' });

    const created = await prisma.medical_certificates.create({
      data: {
        patient_id: patientId,
        doctor_name: actorName,
        purpose,
        diagnosis,
        recommendations,
        valid_until: validUntil ? new Date(`${validUntil}T00:00:00.000Z`) : null
      }
    });

    prisma.activity_logs.create({
      data: {
        actor_name: actorName,
        role: 'Doctor',
        action: 'Create',
        target: `Patient:${patientId}`,
        details: 'Created medical certificate'
      }
    }).catch(() => {});

    res.status(201).json({
      ...created,
      id: created.id.toString(),
      patientId: created.patient_id,
      doctorName: created.doctor_name
    });
  } catch (err) {
    sendError(res, err, 'Unable to create medical certificate.');
  }
});

module.exports = router;

