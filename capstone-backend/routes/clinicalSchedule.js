const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, normalizeRole, parseLimit, parseOffset, parseDate } = require('../utils/normalize');


const ROLE_SET = new Set(['medtech', 'radiographer', 'ecg_operator', 'physical_therapist']);
router.use(requireRole([...ROLE_SET, 'admin']));

const serializeEvent = (ev) => ({
  id: ev.id != null ? ev.id.toString() : null,
  role: ev.role || null,
  staffEmail: ev.staff_email || null,
  orderId: ev.order_id != null ? ev.order_id.toString() : null,
  patientId: ev.patient_id || null,
  title: ev.title || null,
  startAt: ev.start_at || null,
  endAt: ev.end_at || null,
  location: ev.location || null,
  status: ev.status || null,
  notes: ev.notes || null,
  createdBy: ev.created_by || null,
  createdAt: ev.created_at || null,
  updatedAt: ev.updated_at || null
});

router.get('/', async (req, res) => {
  try {
    const { role, staffEmail, dateFrom, dateTo, take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 500, fallback: 300 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const df = dateFrom ? parseDate(dateFrom) : null;
    const dt = dateTo ? parseDate(dateTo) : null;
    if (dateFrom && !df) return res.status(400).json({ message: 'Invalid dateFrom' });
    if (dateTo && !dt) return res.status(400).json({ message: 'Invalid dateTo' });

    const conditions = [];
    if (role) {
      const r = normalizeRole(role);
      conditions.push({ role: r });
    }
    if (staffEmail) {
      conditions.push({ staff_email: normalizeEmail(staffEmail) });
    }
    if (df) {
      conditions.push({ start_at: { gte: df } });
    }
    if (dt) {
      conditions.push({ start_at: { lte: dt } });
    }

    const where = conditions.length ? { AND: conditions } : {};
    const rows = await prisma.clinical_schedule_events.findMany({
      where,
      orderBy: { start_at: 'asc' },
      take: limit,
      skip: offset
    });

    res.json((Array.isArray(rows) ? rows : []).map(serializeEvent));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_schedule_events') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_schedule_events table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      role,
      staffEmail,
      orderId,
      patientId,
      title,
      startAt,
      endAt,
      location,
      status,
      notes,
      createdBy
    } = req.body || {};

    const roleNorm = normalizeRole(role);
    if (roleNorm && !ROLE_SET.has(roleNorm)) return res.status(400).json({ message: 'Invalid role' });
    if (!startAt) return res.status(400).json({ message: 'startAt is required' });
    const stAt = parseDate(startAt);
    if (!stAt) return res.status(400).json({ message: 'Invalid startAt' });
    const enAt = endAt ? parseDate(endAt) : null;
    if (endAt && !enAt) return res.status(400).json({ message: 'Invalid endAt' });

    const st = String(status || 'Scheduled').trim() || 'Scheduled';

    const created = await prisma.clinical_schedule_events.create({
      data: {
        role: roleNorm || null,
        staff_email: staffEmail ? normalizeEmail(staffEmail) : null,
        order_id: orderId ? BigInt(orderId) : null,
        patient_id: patientId ? String(patientId) : null,
        title: title || null,
        start_at: stAt,
        end_at: enAt,
        location: location || null,
        status: st,
        notes: notes || null,
        created_by: createdBy || null
      }
    });

    res.status(201).json(serializeEvent(created));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_schedule_events') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_schedule_events table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(400).json({ message: msg || 'Bad request' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Invalid id' });

    const {
      role,
      staffEmail,
      orderId,
      patientId,
      title,
      startAt,
      endAt,
      location,
      status,
      notes
    } = req.body || {};

    const data = {};
    if (role !== undefined) {
      const roleNorm = normalizeRole(role);
      if (roleNorm && !ROLE_SET.has(roleNorm)) return res.status(400).json({ message: 'Invalid role' });
      data.role = roleNorm || null;
    }
    if (staffEmail !== undefined) data.staff_email = staffEmail ? normalizeEmail(staffEmail) : null;
    if (orderId !== undefined) data.order_id = orderId ? BigInt(orderId) : null;
    if (patientId !== undefined) {
      data.patient_id = patientId ? String(patientId) : null;
    }
    if (title !== undefined) data.title = title || null;
    if (startAt !== undefined) {
      if (!startAt) return res.status(400).json({ message: 'startAt cannot be empty' });
      const stAt = parseDate(startAt);
      if (!stAt) return res.status(400).json({ message: 'Invalid startAt' });
      data.start_at = stAt;
    }
    if (endAt !== undefined) {
      const enAt = endAt ? parseDate(endAt) : null;
      if (endAt && !enAt) return res.status(400).json({ message: 'Invalid endAt' });
      data.end_at = enAt;
    }
    if (location !== undefined) data.location = location || null;
    if (status !== undefined) data.status = String(status || 'Scheduled').trim() || 'Scheduled';
    if (notes !== undefined) data.notes = notes || null;

    const updated = await prisma.clinical_schedule_events.update({
      where: { id: BigInt(id) },
      data
    });

    res.json(serializeEvent(updated));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_schedule_events') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_schedule_events table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(400).json({ message: msg || 'Bad request' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Invalid id' });

    await prisma.clinical_schedule_events.delete({ where: { id: BigInt(id) } });

    res.json({ success: true });
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_schedule_events') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_schedule_events table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(400).json({ message: msg || 'Bad request' });
  }
});

module.exports = router;


