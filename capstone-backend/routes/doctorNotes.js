const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

router.get('/', async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) return res.json([]);
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
        doctorName: n.doctor_name
    }));
    
    res.json(serialized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    const { patientId, doctorName, subjective, objective, assessment, plan, vitals } = req.body;
    if (!patientId || !doctorName) {
      return res.status(400).json({ message: 'patientId and doctorName are required' });
    }
    const requiredFields = { subjective, objective, assessment, plan };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !String(value || '').trim())
      .map(([field]) => field.charAt(0).toUpperCase() + field.slice(1));
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Complete the required consultation fields: ${missingFields.join(', ')}.`
      });
    }

    const created = await prisma.doctor_notes.create({
      data: {
        patient_id: patientId,
        doctor_name: doctorName,
        subjective: String(subjective).trim(),
        objective: String(objective).trim(),
        assessment: String(assessment).trim(),
        plan: String(plan).trim(),
        vitals
      }
    });

    prisma.activity_logs.create({
      data: {
        actor_name: doctorName,
        role: 'Doctor',
        action: 'Create',
        target: `Patient:${patientId}`,
        details: 'Created consultation note'
      }
    }).catch(() => {});

    res.status(201).json({
        ...created,
        id: created.id.toString()
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

