const express = require('express');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

function normalizeIncidentStatus(value) {
  const raw = String(value || '').trim();
  const v = raw.toLowerCase();
  if (!v) return null;
  if (v === 'pending' || v === 'submitted') return 'submitted';
  if (v === 'reviewed') return 'resolved';
  if (v === 'resolved') return 'resolved';
  if (v === 'in progress' || v === 'in_progress' || v === 'inprogress') return 'in_progress';
  if (v === 'escalated') return 'escalated';
  return raw;
}

const serialize = (row) =>
  JSON.parse(JSON.stringify(row, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));

async function ensureIncidentColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS severity text NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS escalated_to text NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS patient_id uuid NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS patient_name text NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS follow_up_status text NULL;`).catch(() => {});
}

let incidentSchemaPromise = null;
function ensureIncidentSchemaOnce() {
  if (!incidentSchemaPromise) incidentSchemaPromise = ensureIncidentColumns();
  return incidentSchemaPromise;
}

router.get('/', requireRole(['admin', 'nurse']), async (_req, res) => {
  try {
    await ensureIncidentSchemaOnce();
    const takeRaw = Number(_req.query.take);
    const skipRaw = Number(_req.query.skip);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 500) : 200;
    const skip = Number.isFinite(skipRaw) ? Math.min(Math.max(skipRaw, 0), 5000) : 0;
    const incidents = await prisma.$queryRawUnsafe(`
      SELECT id::text AS id, created_at, updated_at, created_by_email, incident_type, incident_date,
             incident_time, location, description, action_taken, status, severity,
             escalated_to, patient_id::text AS patient_id, patient_name, follow_up_status
      FROM public.incidents
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, take, skip);
    res.json(Array.isArray(incidents) ? incidents.map(serialize) : []);
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.post('/', requireRole(['admin', 'nurse']), async (req, res) => {
  try {
    await ensureIncidentColumns();
    const {
      incident_date,
      incident_time,
      incident_type,
      location,
      description,
      action_taken,
      created_by_email,
      severity,
      escalated_to,
      patient_id,
      patient_name,
      follow_up_status
    } = req.body || {};

    const rows = await prisma.$queryRawUnsafe(
      `
        INSERT INTO public.incidents
          (incident_date, incident_time, incident_type, location, description, action_taken,
           created_by_email, status, severity, escalated_to, patient_id, patient_name, follow_up_status)
        VALUES
          ($1::date, $2::time, $3, $4, $5, $6, $7, 'submitted', $8, $9, $10::uuid, $11, $12)
        RETURNING id::text AS id, created_at, updated_at, created_by_email, incident_type, incident_date,
                  incident_time, location, description, action_taken, status, severity,
                  escalated_to, patient_id::text AS patient_id, patient_name, follow_up_status
      `,
      incident_date,
      incident_time,
      incident_type,
      location || null,
      description || null,
      action_taken || null,
      created_by_email,
      severity || 'Moderate',
      escalated_to || null,
      patient_id || null,
      patient_name || null,
      follow_up_status || 'For Review'
    );

    res.status(201).json(serialize(Array.isArray(rows) ? rows[0] : null));
  } catch (error) {
    console.error('Error creating incident:', error);
    res.status(500).json({ error: 'Failed to create incident report' });
  }
});

router.patch('/:id/status', requireRole(['admin']), async (req, res) => {
  try {
    await ensureIncidentColumns();
    const { id } = req.params;
    const next = normalizeIncidentStatus(req.body?.status);
    if (!next) return res.status(400).json({ error: 'status is required' });

    const rows = await prisma.$queryRawUnsafe(
      `
        UPDATE public.incidents
        SET status = $2,
            follow_up_status = COALESCE($3, follow_up_status),
            escalated_to = COALESCE($4, escalated_to),
            updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text AS id, created_at, updated_at, created_by_email, incident_type, incident_date,
                  incident_time, location, description, action_taken, status, severity,
                  escalated_to, patient_id::text AS patient_id, patient_name, follow_up_status
      `,
      id,
      next,
      req.body?.followUpStatus || null,
      req.body?.escalatedTo || null
    );

    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Incident not found' });
    res.json(serialize(rows[0]));
  } catch (error) {
    console.error('Error updating incident status:', error);
    res.status(500).json({ error: 'Failed to update incident status' });
  }
});

module.exports = router;

