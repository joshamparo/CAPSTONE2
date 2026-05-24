const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

router.get('/', async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) return res.json([]);

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
    res.status(500).json({ message: err.message });
  }
});

router.post('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const { patientId, doctorName, purpose, diagnosis, recommendations, validUntil } = req.body;
    if (!patientId || !doctorName || !purpose) {
      return res.status(400).json({ message: 'patientId, doctorName, and purpose are required' });
    }

    const rows = await prisma.$queryRaw`
      INSERT INTO medical_certificates (patient_id, doctor_name, purpose, diagnosis, recommendations, valid_until)
      VALUES (
        ${patientId}::uuid,
        ${doctorName},
        ${purpose},
        ${diagnosis || null},
        ${recommendations || null},
        ${validUntil ? new Date(validUntil) : null}::date
      )
      RETURNING id, patient_id, doctor_name, purpose, diagnosis, recommendations, valid_until, created_at
    `;
    const created = Array.isArray(rows) ? rows[0] : rows;

    prisma.activity_logs.create({
      data: {
        actor_name: doctorName,
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
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

