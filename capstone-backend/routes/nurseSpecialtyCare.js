const express = require('express');
const prisma = require('../utils/prisma');
const { CARE_CONFIG, validateCare } = require('../utils/nurseSpecialtyCare');
const { resolveNursePatientScope } = require('../utils/nurseScope');
const { sendError } = require('../utils/httpErrors');
const router = express.Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { ensureNurseCareTable: ensureTable } = require('../utils/nurseCareStorage');
async function patientAllowed(req, patientId) {
  const scope = await resolveNursePatientScope(prisma, req.nurseDepartment, req.auth.email);
  return prisma.patients.findFirst({ where: { AND: [{ id: patientId }, scope] }, select: { id: true } });
}
router.get('/config', (req, res) => {
  const config = CARE_CONFIG[req.nurseDepartment];
  return config ? res.json(config) : res.status(403).json({ message: 'Your nurse specialization is not configured.' });
});
router.get('/:patientId/orders', async (req, res) => {
  try {
    if (!uuid.test(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient ID.' });
    if (!await patientAllowed(req, req.params.patientId)) return res.status(403).json({ message: 'Patient is outside your department.' });
    const rows = await prisma.clinical_orders.findMany({ where: { patient_id: req.params.patientId },
      select: { id: true, kind: true, service: true, status: true, scheduled_at: true }, orderBy: { created_at: 'desc' } });
    res.json(rows.map(row => ({ ...row, id: String(row.id) })));
  } catch (error) { sendError(res, error, 'Unable to load patient orders.'); }
});
router.get('/:patientId', async (req, res) => {
  try {
    if (!uuid.test(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient ID.' });
    if (!await patientAllowed(req, req.params.patientId)) return res.status(403).json({ message: 'Patient is outside your department.' });
    await ensureTable();
    // Shared patient timeline connects specialty work to ER and the other authorized care teams.
    const rows = await prisma.$queryRaw`SELECT *, order_id::text AS order_id FROM public.nurse_specialty_care WHERE patient_id = ${req.params.patientId}::uuid ORDER BY created_at DESC`;
    res.json(rows);
  } catch (error) { sendError(res, error, 'Unable to load specialty care records.'); }
});
router.post('/:patientId', async (req, res) => {
  try {
    const patientId = req.params.patientId;
    if (!uuid.test(patientId)) return res.status(400).json({ message: 'Invalid patient ID.' });
    if (!await patientAllowed(req, patientId)) return res.status(403).json({ message: 'Patient is outside your department.' });
    const body = req.body || {};
    const config = CARE_CONFIG[req.nurseDepartment];
    if (body.id && !uuid.test(body.id)) return res.status(400).json({ message: 'Invalid care record ID.' });
    if (body.orderId && !/^\d+$/.test(String(body.orderId))) return res.status(400).json({ message: 'Invalid order reference.' });
    await ensureTable();
    const saved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`specialty:${patientId}:${req.nurseDepartment}`}))`;
      const rows = body.id ? await tx.$queryRaw`SELECT * FROM public.nurse_specialty_care WHERE id = ${body.id}::uuid AND patient_id = ${patientId}::uuid AND department = ${req.nurseDepartment} FOR UPDATE` : [];
      const current = rows[0];
      const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
      if (body.id && !current) fail(404, 'Care record not found in your department.');
      if (current && Number(body.version) !== current.version) fail(409, 'Another nurse updated this record. Reload before saving.');
      if (!current) {
        const active = await tx.$queryRaw`SELECT id FROM public.nurse_specialty_care WHERE patient_id = ${patientId}::uuid AND department = ${req.nurseDepartment} AND stage NOT IN ('Completed', 'Cancelled') LIMIT 1`;
        if (active.length) fail(409, 'An active care episode already exists. Reload to continue it.');
      }
      const error = validateCare(body, config, current);
      if (error) fail(400, error);
      const orderId = current?.order_id || body.orderId ? BigInt(current?.order_id || body.orderId) : null;
      if (orderId) {
        const order = await tx.clinical_orders.findFirst({ where: { id: orderId, patient_id: patientId }, select: { id: true } });
        if (!order) fail(400, 'The linked order does not belong to this patient.');
      }
      const event = { at: new Date().toISOString(), by: req.auth.email, department: req.nurseDepartment,
        stage: body.stage, checks: body.checks, notes: body.notes.map(v => v.trim()), handoffTo: String(body.handoffTo || '').trim() };
      const history = JSON.stringify([...(current?.history || []), event]);
      let result;
      if (current) result = await tx.$queryRaw`UPDATE public.nurse_specialty_care SET stage = ${body.stage}, checks = ${JSON.stringify(body.checks)}::jsonb,
        notes = ${JSON.stringify(event.notes)}::jsonb, handoff_to = ${event.handoffTo}, history = ${history}::jsonb,
        version = version + 1, updated_at = now() WHERE id = ${current.id}::uuid RETURNING *, order_id::text AS order_id`;
      else result = await tx.$queryRaw`INSERT INTO public.nurse_specialty_care (patient_id, department, stage, checks, notes, handoff_to, order_id, history)
        VALUES (${patientId}::uuid, ${req.nurseDepartment}, ${body.stage}, ${JSON.stringify(body.checks)}::jsonb,
        ${JSON.stringify(event.notes)}::jsonb, ${event.handoffTo}, ${orderId}, ${history}::jsonb) RETURNING *, order_id::text AS order_id`;
      await tx.activity_logs.create({ data: { actor_name: req.auth.email, role: 'nurse', action: 'Specialty Care Updated', target: `Patient:${patientId}`, details: `${req.nurseDepartment}: ${body.stage}` } });
      if (orderId) await tx.clinical_order_events.create({ data: { order_id: orderId, actor_name: req.auth.email, actor_role: 'nurse', action: 'Nursing support', note: `${req.nurseDepartment}: ${body.stage}${event.handoffTo ? `; handed off to ${event.handoffTo}` : ''}` } });
      return result[0];
    });
    res.json(saved);
  } catch (error) { sendError(res, error, 'Unable to save specialty care.'); }
});
module.exports = router;
