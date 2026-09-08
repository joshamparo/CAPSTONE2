const express = require('express');
const { resolveOwnedPatient } = require('../utils/patientOwnership');
const { readMedicalFile } = require('../utils/labStorage');

module.exports = function createLabFileRouter({ prisma, requireRole, authorizeNurseDepartment, enforceNursePatientAccess, enforceClinicalOrderAccess, enforceDoctorPatientAccess, getStorage, readFile = readMedicalFile }) {
  const router = express.Router();
  router.get('/', requireRole(['patient', 'admin', 'doctor', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']), authorizeNurseDepartment, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    try {
      const id = String(req.query.id || '');
      const url = String(req.query.url || '');
      if ((!id && !url) || (id && !/^\d+$/.test(id)) || url.length > 4096) return res.status(400).json({ message: 'Invalid lab result.' });
      // Verification columns are maintained by the existing SQL migrations,
      // and are not present in the generated Prisma lab_results model.
      const rows = id
        ? await prisma.$queryRaw`SELECT id, patient_id, order_id, url, verification_status FROM public.lab_results WHERE id = ${BigInt(id)} LIMIT 1`
        : await prisma.$queryRaw`SELECT id, patient_id, order_id, url, verification_status FROM public.lab_results WHERE url = ${url} LIMIT 1`;
      const row = rows[0];
      if (!row) return res.status(404).json({ message: 'Lab result not found.' });
      const role = req.auth.role;
      if (role === 'patient') {
        await resolveOwnedPatient(prisma, req.auth, String(row.patient_id));
        if (String(row.verification_status || '').toLowerCase() !== 'verified') return res.status(403).json({ message: 'This result has not been released by the clinic.' });
      }
      if (role === 'doctor' && !(await enforceDoctorPatientAccess(req, res, row.patient_id)).allowed) return;
      if (!(await enforceNursePatientAccess(req, res, row.patient_id))) return;
      if (['medtech', 'radiographer', 'ecg_operator', 'physical_therapist'].includes(role)
        && !(await enforceClinicalOrderAccess(req, res, { orderId: row.order_id, patientId: row.patient_id }))) return;
      const file = await readFile(row.url, getStorage());
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      res.send(file.buffer);
    } catch (error) {
      const status = [400, 401, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 503;
      res.status(status).json({ message: status === 503 ? 'Unable to load the medical file. Please contact the clinic if this continues.' : error.message });
    }
  });
  return router;
};
