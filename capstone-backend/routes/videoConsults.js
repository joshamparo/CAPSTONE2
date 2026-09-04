const express = require('express');
const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

async function ensureVideoBookingTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS video_booking_holds (
      id BIGSERIAL PRIMARY KEY,
      booking_ref TEXT UNIQUE NOT NULL,
      patient_id UUID NULL,
      patient_email TEXT NULL,
      patient_name TEXT NULL,
      doctor_name TEXT NULL,
      doctor_id UUID NULL,
      specialization TEXT NULL,
      service_type TEXT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      slot_date DATE NULL,
      slot_time TIME NULL,
      status TEXT NOT NULL DEFAULT 'HOLD',
      expires_at TIMESTAMPTZ NOT NULL,
      appointment_id BIGINT NULL,
      approval_request_id BIGINT NULL,
      paymongo_checkout_session_id TEXT NULL,
      paymongo_checkout_url TEXT NULL,
      paymongo_payment_id TEXT NULL,
      paymongo_event_id TEXT NULL,
      amount INTEGER NULL,
      currency TEXT NULL DEFAULT 'PHP',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE video_booking_holds ADD COLUMN IF NOT EXISTS slot_date date;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE video_booking_holds ADD COLUMN IF NOT EXISTS slot_time time;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE video_booking_holds ADD COLUMN IF NOT EXISTS doctor_id uuid;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE video_booking_holds ADD COLUMN IF NOT EXISTS approval_request_id bigint;`);

  // A paid video booking waits in the doctor's existing approval inbox before
  // an appointment is created. Keep its payment data on that pending request.
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS booking_ref text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_payment_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS paymongo_event_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS payment_status text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS amount integer;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS currency text;`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS appointment_approval_requests_booking_ref_uidx ON appointment_approval_requests(booking_ref) WHERE booking_ref IS NOT NULL;`);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS video_booking_holds_doctor_start_idx ON video_booking_holds(doctor_name, start_at);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS video_booking_holds_patient_idx ON video_booking_holds(patient_id, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS video_booking_holds_status_idx ON video_booking_holds(status, expires_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS video_booking_holds_slot_idx ON video_booking_holds(doctor_name, slot_date, slot_time);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS video_booking_holds_doctor_id_idx ON video_booking_holds(doctor_id, start_at);`);

  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paymongo_payment_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paymongo_event_id text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paid_at timestamptz;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS amount integer;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS currency text;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_payment_idx ON appointments(paymongo_payment_id, paid_at DESC);`);
}

ensureVideoBookingTables().catch(() => {});

function inferRole(req) {
  return String(req.headers['x-user-role'] || '').trim().toLowerCase();
}

function inferEmail(req) {
  return String(req.headers['x-user-email'] || '').trim().toLowerCase();
}

function inferName(req) {
  return String(req.headers['x-user-name'] || '').trim();
}

function normalizeDoctorName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^dr\.?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateOnly(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function parseTimeOnly(timeStr) {
  const raw = String(timeStr || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [h, m] = raw.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return raw;
}

function minutesFromTimeStr(t) {
  const [h, m] = t.split(':').map((x) => Number(x));
  return h * 60 + m;
}

function timeStrFromMinutes(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function getSlotConfig() {
  const slotMinutesRaw = Number(process.env.VIDEO_SLOT_MINUTES || 30);
  const slotMinutes = Number.isFinite(slotMinutesRaw) && slotMinutesRaw >= 10 && slotMinutesRaw <= 120 ? Math.floor(slotMinutesRaw) : 30;
  const start = parseTimeOnly(process.env.VIDEO_SLOTS_START || '09:00') || '09:00';
  const end = parseTimeOnly(process.env.VIDEO_SLOTS_END || '17:00') || '17:00';
  const offset = String(process.env.VIDEO_TIMEZONE_OFFSET || '+08:00').trim() || '+08:00';
  return { slotMinutes, start, end, offset };
}

function combineDateTime(dateStr, timeStr) {
  const { offset } = getSlotConfig();
  return new Date(`${dateStr}T${timeStr}:00${offset}`);
}

function makeBookingRef() {
  return `vh_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function makeRoomId(appointmentId) {
  const raw = String(appointmentId || '').trim();
  return `pascualinga-${raw}`;
}

function inferSpecializationFromServiceType(serviceType) {
  const raw = String(serviceType || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/^video consultation\s*-\s*/i, '')
    .replace(/\(online\)/gi, '')
    .trim();
  const head = cleaned.split(':')[0]?.trim() || cleaned;
  const low = head.toLowerCase();

  if (low.includes('pedi')) return 'Pediatrics';
  if (low.includes('pedia')) return 'Pediatrics';
  if (low.includes('physical therapy') || low === 'pt' || low.includes('physiotherapy')) return 'Physical Therapy';
  if (low.includes('ob') || low.includes('ob-gyn') || low.includes('obgyn')) return 'OB-GYN';
  if (low.includes('derma')) return 'Dermatology';
  if (low.includes('ophthalm') || low.includes('opthalm') || low.includes('optha')) return 'Ophthalmology';
  if (low.includes('cardio')) return 'Cardiology';
  if (low.includes('surg')) return 'Surgery';
  if (low.includes('ortho')) return 'Orthopedics';
  if (low.includes('medicine') || low.includes('internal')) return 'Medicine';

  const tokens = head.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens.slice(0, 2).join(' ') : '';
}

function buildDoctorSpecializationWhere(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return {};
  const low = raw.toLowerCase();
  if (low.includes('pedi') || low.includes('pedia')) {
    return {
      OR: [
        { specialization: { contains: 'Pediatrics', mode: 'insensitive' } },
        { specialization: { contains: 'Pedia', mode: 'insensitive' } },
        { specialization: { equals: 'PEDIA', mode: 'insensitive' } }
      ]
    };
  }
  if (low === 'physical therapy') {
    return {
      OR: [
        { specialization: { contains: 'Physical Therapy', mode: 'insensitive' } },
        { specialization: { equals: 'PT', mode: 'insensitive' } },
        { specialization: { contains: 'Physio', mode: 'insensitive' } }
      ]
    };
  }
  if (low === 'ob-gyn') {
    return {
      OR: [
        { specialization: { contains: 'OB-GYN', mode: 'insensitive' } },
        { specialization: { contains: 'OBGYN', mode: 'insensitive' } },
        { specialization: { equals: 'OB', mode: 'insensitive' } }
      ]
    };
  }
  if (low.includes('ortho')) {
    return {
      OR: [
        { specialization: { contains: 'Ortho', mode: 'insensitive' } },
        { department: { contains: 'Ortho', mode: 'insensitive' } }
      ]
    };
  }
  if (low.includes('ophthalm') || low.includes('opthalm') || low.includes('optha')) {
    return {
      OR: [
        { specialization: { contains: 'Ophthalmology', mode: 'insensitive' } },
        { specialization: { contains: 'Opthalmology', mode: 'insensitive' } },
        { specialization: { contains: 'Optha', mode: 'insensitive' } },
        { department: { contains: 'Ophthalmology', mode: 'insensitive' } },
        { department: { contains: 'Opthalmology', mode: 'insensitive' } }
      ]
    };
  }
  return { specialization: { contains: raw, mode: 'insensitive' } };
}

async function fetchDoctorList({ specialization, department, status }) {
  const spec = String(specialization || '').trim();
  const dept = String(department || '').trim();
  const st = String(status || '').trim();
  const where = {};
  if (spec) Object.assign(where, buildDoctorSpecializationWhere(spec));
  if (dept) where.department = dept;
  if (st) where.status = st;
  const rows = await prisma.doctors.findMany({
    where,
    select: { id: true, first_name: true, last_name: true, specialization: true, department: true, email: true, status: true }
  });
  const list = (rows || []).map((d) => ({
    id: d.id,
    name: `Dr. ${String(d.first_name || '').trim()} ${String(d.last_name || '').trim()}`.trim(),
    email: d.email,
    specialization: d.specialization || null,
    department: d.department || null,
    status: d.status || null
  }));

  // Physical therapists are clinical providers but their accounts are stored
  // in `staff`, not `doctors`. Include them in the same provider/slot pipeline
  // so PayMongo completion creates a normal video appointment just like every
  // other online-consultation specialty.
  const specKey = String(spec || '').trim().toLowerCase();
  if (specKey.includes('physical therapy') || specKey === 'pt' || specKey.includes('physiotherapy')) {
    const staffWhere = { account_type: 'physical_therapist' };
    if (st) staffWhere.status = st;
    const therapists = await prisma.staff.findMany({
      where: staffWhere,
      select: { id: true, first_name: true, last_name: true, email: true, status: true }
    }).catch(() => []);
    for (const therapist of therapists || []) {
      const firstName = String(therapist.first_name || '').trim();
      const lastName = String(therapist.last_name || '').trim();
      list.push({
        id: therapist.id,
        name: `${firstName} ${lastName}`.trim() || therapist.email || 'Physical Therapist',
        email: therapist.email || null,
        specialization: 'Physical Therapy',
        department: 'Physical Therapy',
        status: therapist.status || null,
        providerType: 'physical_therapist'
      });
    }
  }

  const unique = Array.from(new Map(list.map((provider) => [String(provider.id), provider])).values());

  const score = (s) => (String(s || '').trim().toLowerCase() === 'online' ? 1 : 0);
  unique.sort((a, b) => {
    const sa = score(a.status);
    const sb = score(b.status);
    if (sa !== sb) return sb - sa;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
  return unique;
}

async function getBookedTimesForDoctor(doctorName, dateStr) {
  const day = parseDateOnly(dateStr);
  if (!day) return new Set();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT to_char(appointment_time, 'HH24:MI') AS t
      FROM appointments
      WHERE lower(regexp_replace(coalesce(doctor_id, ''), '^dr\\.?\\s*', '')) = ${normalizeDoctorName(doctorName)}
        AND appointment_date = ${day}::date
        AND lower(coalesce(status, '')) NOT LIKE '%cancel%'
        AND lower(coalesce(status, '')) NOT LIKE '%no-show%'
        AND lower(coalesce(status, '')) NOT LIKE '%no show%'
    `
  );
  const set = new Set();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const t = String(r?.t || '').trim();
    if (t) set.add(t);
  });
  return set;
}

async function getHeldTimesForDoctor(doctorName, dateStr) {
  const day = parseDateOnly(dateStr);
  if (!day) return new Set();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT to_char(slot_time, 'HH24:MI') AS t, status, expires_at
      FROM video_booking_holds
      WHERE lower(regexp_replace(coalesce(doctor_name, ''), '^dr\\.?\\s*', '')) = ${normalizeDoctorName(doctorName)}
        AND slot_date = ${day}::date
    `
  );
  const set = new Set();
  const now = Date.now();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const status = String(r?.status || '').trim().toUpperCase();
    const expiresAt = r?.expires_at ? new Date(r.expires_at).getTime() : 0;
    if (status === 'CANCELLED' || status === 'EXPIRED') return;
    if (expiresAt && expiresAt < now && status === 'HOLD') return;
    const t = String(r?.t || '').trim();
    if (t) set.add(t);
  });
  return set;
}

function normalizeTimeToHHMM(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function loadDoctorAvailabilityBlocks({ doctorId, date }) {
  const docId = String(doctorId || '').trim();
  const day = parseDateOnly(date);
  if (!docId || !day) return { dayBlocked: false, ranges: [] };

  try {
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT start_time, end_time
        FROM public.doctor_availability
        WHERE doctor_id = ${docId}::uuid
          AND available_date = ${day}::date
          AND is_available = false
      `
    );

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { dayBlocked: false, ranges: [] };

    const ranges = [];
    for (const r of list) {
      const st = r?.start_time ? normalizeTimeToHHMM(r.start_time) : '';
      const et = r?.end_time ? normalizeTimeToHHMM(r.end_time) : '';
      if (!st || !et) return { dayBlocked: true, ranges: [] };
      const sMin = minutesFromTimeStr(st);
      const eMin = minutesFromTimeStr(et);
      if (!Number.isFinite(sMin) || !Number.isFinite(eMin) || eMin <= sMin) return { dayBlocked: true, ranges: [] };
      ranges.push([sMin, eMin]);
    }

    return { dayBlocked: false, ranges };
  } catch (_) {
    return { dayBlocked: false, ranges: [] };
  }
}

function isTimeBlockedByAvailability({ time, blocks }) {
  if (!blocks) return false;
  if (blocks.dayBlocked) return true;
  const t = parseTimeOnly(time);
  if (!t) return false;
  const mins = minutesFromTimeStr(t);
  if (!Number.isFinite(mins)) return false;
  for (const [s, e] of blocks.ranges || []) {
    if (mins >= s && mins < e) return true;
  }
  return false;
}

router.get('/doctors', requireRole(['patient', 'doctor_secretary', 'admin', 'nurse']), async (req, res) => {
  try {
    const specialization = String(req.query.specialization || '').trim();
    const department = String(req.query.department || '').trim();
    const status = String(req.query.status || '').trim();
    const doctors = await fetchDoctorList({ specialization, department, status });
    res.json(doctors);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/doctors/:id', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Doctor id is required.' });
    const row = await prisma.doctors.findUnique({
      where: { id },
      select: { id: true, first_name: true, last_name: true, specialization: true, email: true }
    });
    if (!row) return res.status(404).json({ message: 'Doctor not found.' });
    res.json({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      specialization: row.specialization || null,
      name: `Dr. ${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim()
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/slots', requireRole(['patient']), async (req, res) => {
  try {
    const date = parseDateOnly(req.query.date);
    if (!date) return res.status(400).json({ message: 'Invalid date.' });
    const doctorName = String(req.query.doctorName || '').trim();
    const doctorId = String(req.query.doctorId || '').trim();
    const specialization = String(req.query.specialization || '').trim();
    const serviceType = String(req.query.serviceType || '').trim();
    const autoAssign = String(req.query.autoAssign || '').trim().toLowerCase() === 'true';
    const { slotMinutes, start, end } = getSlotConfig();

    const startMin = minutesFromTimeStr(start);
    const endMin = minutesFromTimeStr(end);
    const allTimes = [];
    for (let m = startMin; m + slotMinutes <= endMin; m += slotMinutes) {
      allTimes.push(timeStrFromMinutes(m));
    }

    if (!autoAssign) {
      let dn = doctorName;
      let docUuid = null;
      if (doctorId) {
        const doc = await prisma.doctors
          .findUnique({ where: { id: doctorId }, select: { id: true, first_name: true, last_name: true } })
          .catch(() => null);
        if (doc) {
          docUuid = doc.id;
          dn = `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
        }
      }
      if (!dn) return res.status(400).json({ message: 'Missing doctorName.' });
      if (!docUuid) {
        docUuid = await resolveDoctorUuidFromDoctorName(dn);
      }
      const blocks = docUuid ? await loadDoctorAvailabilityBlocks({ doctorId: docUuid, date }) : { dayBlocked: false, ranges: [] };
      if (blocks.dayBlocked) return res.status(409).json({ message: 'Doctor is not available on this date.' });
      const booked = await getBookedTimesForDoctor(dn, date);
      const held = await getHeldTimesForDoctor(dn, date);
      const slots = allTimes
        .filter((t) => !booked.has(t) && !held.has(t) && !isTimeBlockedByAvailability({ time: t, blocks }))
        .map((t) => ({ date, time: t, doctorName: dn, doctorId: docUuid }));
      return res.json(slots);
    }

    const specEff = specialization || inferSpecializationFromServiceType(serviceType);
    const doctors = await fetchDoctorList({ specialization: specEff });
    const result = [];
    const blockCache = new Map();
    const bookedCache = new Map();
    const heldCache = new Map();

    const getBlocksForDoctor = async (doc) => {
      const id = doc?.id ? String(doc.id) : '';
      if (!id) return { dayBlocked: false, ranges: [] };
      if (blockCache.has(id)) return blockCache.get(id);
      const b = await loadDoctorAvailabilityBlocks({ doctorId: id, date });
      blockCache.set(id, b);
      return b;
    };

    const getBookedCached = async (dn) => {
      const key = String(dn || '').trim().toLowerCase();
      if (bookedCache.has(key)) return bookedCache.get(key);
      const s = await getBookedTimesForDoctor(dn, date);
      bookedCache.set(key, s);
      return s;
    };

    const getHeldCached = async (dn) => {
      const key = String(dn || '').trim().toLowerCase();
      if (heldCache.has(key)) return heldCache.get(key);
      const s = await getHeldTimesForDoctor(dn, date);
      heldCache.set(key, s);
      return s;
    };

    if (doctors.length) {
      const dayBlocks = await Promise.all(doctors.map((d) => getBlocksForDoctor(d)));
      const allBlocked = dayBlocks.every((b) => b?.dayBlocked);
      if (allBlocked) return res.status(409).json({ message: 'All doctors are unavailable on this date.' });
    }

    for (const t of allTimes) {
      for (const doc of doctors) {
        const dn = doc?.name;
        if (!dn) continue;
        const blocks = await getBlocksForDoctor(doc);
        if (isTimeBlockedByAvailability({ time: t, blocks })) continue;
        const [booked, held] = await Promise.all([getBookedCached(dn), getHeldCached(dn)]);
        if (booked.has(t) || held.has(t)) continue;
        result.push({ date, time: t, doctorName: dn, doctorId: doc?.id || null });
        break;
      }
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/holds', requireRole(['patient']), async (req, res) => {
  try {
    const { patientId, patientEmail, patientName, doctorName, doctorId, specialization, serviceType, date, time, amount, currency, autoAssign } = req.body || {};
    const role = inferRole(req);
    if (role !== 'patient') return res.status(401).json({ message: 'Unauthorized' });
    const email = inferEmail(req) || String(patientEmail || '').trim().toLowerCase();
    const name = inferName(req) || String(patientName || '').trim();

    const day = parseDateOnly(date);
    const t = parseTimeOnly(time);
    if (!day || !t) return res.status(400).json({ message: 'Invalid date/time.' });

    let dn = String(doctorName || '').trim();
    let docUuid = String(doctorId || '').trim() || null;
    const spec = String(specialization || '').trim() || inferSpecializationFromServiceType(serviceType);
    const auto = !!autoAssign;
    if (auto) {
      const options = await fetchDoctorList({ specialization: spec });
      for (const doc of options) {
        const candidate = doc?.name;
        if (!candidate) continue;
        const blocks = await loadDoctorAvailabilityBlocks({ doctorId: doc?.id ? String(doc.id) : '', date: day });
        if (isTimeBlockedByAvailability({ time: t, blocks })) continue;
        const [booked, held] = await Promise.all([getBookedTimesForDoctor(candidate, day), getHeldTimesForDoctor(candidate, day)]);
        if (!booked.has(t) && !held.has(t)) {
          dn = candidate;
          docUuid = doc?.id ? String(doc.id) : docUuid;
          break;
        }
      }
      if (!dn) return res.status(409).json({ message: 'No doctor available for that slot.' });
    } else {
      if (docUuid && !dn) {
        const doc = await prisma.doctors
          .findUnique({ where: { id: docUuid }, select: { id: true, first_name: true, last_name: true } })
          .catch(() => null);
        if (doc) {
          dn = `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
        }
      }
      if (!dn) return res.status(400).json({ message: 'Missing doctorName.' });
      if (!docUuid) {
        docUuid = await resolveDoctorUuidFromDoctorName(dn);
      }
      const blocks = docUuid ? await loadDoctorAvailabilityBlocks({ doctorId: docUuid, date: day }) : { dayBlocked: false, ranges: [] };
      if (isTimeBlockedByAvailability({ time: t, blocks })) return res.status(409).json({ message: 'Doctor is not available for that slot.' });
      const [booked, held] = await Promise.all([getBookedTimesForDoctor(dn, day), getHeldTimesForDoctor(dn, day)]);
      if (booked.has(t) || held.has(t)) return res.status(409).json({ message: 'Slot is no longer available.' });
    }

    const startAt = combineDateTime(day, t);
    const { slotMinutes } = getSlotConfig();
    const endAt = new Date(startAt.getTime() + slotMinutes * 60 * 1000);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const bookingRef = makeBookingRef();
    const amt = Number(amount);
    const safeAmount = Number.isFinite(amt) && amt > 0 ? Math.floor(amt) : Number(process.env.VIDEO_CONSULT_PRICE_CENTS || 50000);
    const cur = String(currency || 'PHP').trim().toUpperCase() || 'PHP';
    const st = String(serviceType || '').trim() || 'Video Consultation';

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO video_booking_holds (
          booking_ref, patient_id, patient_email, patient_name,
          doctor_name, doctor_id, specialization, service_type,
          start_at, end_at, slot_date, slot_time, status, expires_at,
          amount, currency
        )
        VALUES (
          ${bookingRef},
          ${patientId ? String(patientId) : null}::uuid,
          ${email || null},
          ${name || null},
          ${dn || null},
          ${docUuid ? String(docUuid) : null}::uuid,
          ${spec || null},
          ${st || null},
          ${startAt}::timestamptz,
          ${endAt}::timestamptz,
          ${day}::date,
          ${t}::time,
          'HOLD',
          ${expiresAt}::timestamptz,
          ${safeAmount},
          ${cur}
        )
      `
    );

    res.status(201).json({
      bookingRef,
      doctorName: dn,
      specialization: spec || null,
      serviceType: st,
      date: day,
      time: t,
      amount: safeAmount,
      currency: cur,
      expiresAt: expiresAt.toISOString()
    });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create hold.' });
  }
});

function getPaymongoSecretKey() {
  const key = String(process.env.PAYMONGO_SECRET_KEY || '').trim();
  return key || null;
}

async function paymongoCreateCheckoutSession({ amount, currency, description, successUrl, cancelUrl, metadata }) {
  const key = getPaymongoSecretKey();
  if (!key) throw new Error('Missing PAYMONGO_SECRET_KEY');
  const auth = Buffer.from(`${key}:`).toString('base64');
  const payload = {
    data: {
      attributes: {
        line_items: [
          {
            amount,
            currency,
            name: description,
            quantity: 1
          }
        ],
        payment_method_types: ['card', 'gcash'],
        send_email_receipt: false,
        show_line_items: true,
        description,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: metadata || {}
      }
    }
  };

  const res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.errors?.[0]?.detail || json?.message || 'PayMongo request failed';
    throw new Error(msg);
  }
  const attrs = json?.data?.attributes || {};
  return {
    id: json?.data?.id || null,
    checkoutUrl: attrs.checkout_url || null
  };
}

router.post('/checkout', requireRole(['patient']), async (req, res) => {
  try {
    const bookingRef = String(req.body?.bookingRef || '').trim();
    if (!bookingRef) return res.status(400).json({ message: 'Missing bookingRef.' });

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT booking_ref, doctor_name, service_type, amount, currency, expires_at, status
        FROM video_booking_holds
        WHERE booking_ref = ${bookingRef}
        LIMIT 1
      `
    );
    const hold = Array.isArray(rows) ? rows[0] : null;
    if (!hold) return res.status(404).json({ message: 'Hold not found.' });

    const expiresAt = hold?.expires_at ? new Date(hold.expires_at) : null;
    if (expiresAt && expiresAt.getTime() < Date.now() && String(hold.status || '').toUpperCase() === 'HOLD') {
      await prisma.$executeRaw(Prisma.sql`UPDATE video_booking_holds SET status = 'EXPIRED', updated_at = now() WHERE booking_ref = ${bookingRef}`);
      return res.status(409).json({ message: 'Hold expired.' });
    }

    const status = String(hold.status || '').trim().toUpperCase();
    if (status === 'PAID' || status === 'APPROVAL_PENDING' || status === 'APPOINTMENT_CREATED') {
      return res.json({ bookingRef, status: status.toLowerCase() });
    }

    const amount = Number(hold.amount || 0);
    const currency = String(hold.currency || 'PHP').trim().toUpperCase() || 'PHP';
    const desc = String(hold.service_type || 'Video Consultation').trim();

    const successUrl = String(process.env.PAYMONGO_SUCCESS_URL || '').trim() || 'https://example.com/success';
    const cancelUrl = String(process.env.PAYMONGO_CANCEL_URL || '').trim() || 'https://example.com/cancel';

    const { id, checkoutUrl } = await paymongoCreateCheckoutSession({
      amount,
      currency,
      description: desc,
      successUrl,
      cancelUrl,
      metadata: { bookingRef }
    });
    if (!id || !checkoutUrl) return res.status(500).json({ message: 'PayMongo did not return a checkout_url.' });

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE video_booking_holds
        SET paymongo_checkout_session_id = ${id},
            paymongo_checkout_url = ${checkoutUrl},
            status = 'CHECKOUT_CREATED',
            updated_at = now()
        WHERE booking_ref = ${bookingRef}
      `
    );

    res.json({ bookingRef, checkoutUrl, checkoutSessionId: id });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create checkout.' });
  }
});

router.get('/holds/:ref', requireRole(['patient']), async (req, res) => {
  try {
    const bookingRef = String(req.params.ref || '').trim();
    if (!bookingRef) return res.status(400).json({ message: 'Invalid ref.' });
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT booking_ref, doctor_name, specialization, service_type, start_at, end_at, status, expires_at, appointment_id, paymongo_checkout_url
        FROM video_booking_holds
        WHERE booking_ref = ${bookingRef}
        LIMIT 1
      `
    );
    const hold = Array.isArray(rows) ? rows[0] : null;
    if (!hold) return res.status(404).json({ message: 'Not found.' });
    res.json({
      bookingRef: hold.booking_ref,
      doctorName: hold.doctor_name || null,
      specialization: hold.specialization || null,
      serviceType: hold.service_type || null,
      startAt: hold.start_at ? new Date(hold.start_at).toISOString() : null,
      endAt: hold.end_at ? new Date(hold.end_at).toISOString() : null,
      status: String(hold.status || '').toLowerCase(),
      expiresAt: hold.expires_at ? new Date(hold.expires_at).toISOString() : null,
      appointmentId: hold.appointment_id ? String(hold.appointment_id) : null,
      checkoutUrl: hold.paymongo_checkout_url || null
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

function parsePaymongoSignatureHeader(headerValue) {
  const raw = String(headerValue || '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim());
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (!k || !v) continue;
    out[k.trim()] = v.trim();
  }
  return out.t ? out : null;
}

function verifyPaymongoWebhook({ rawBody, signatureHeader, secret, livemode }) {
  const parsed = parsePaymongoSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const ts = String(parsed.t || '').trim();
  const sigKey = livemode ? 'li' : 'te';
  const expectedSig = String(parsed[sigKey] || '').trim();
  if (!ts || !expectedSig) return false;
  const msg = `${ts}.${rawBody}`;
  const computed = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig));
  } catch (_) {
    return false;
  }
}

async function resolveDoctorUuidFromDoctorName(doctorName) {
  const dn = String(doctorName || '').trim();
  if (!dn) return null;
  try {
    const cleaned = dn.replace(/^Dr\.?\s*/i, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const firstToken = parts[0] || '';
    const lastToken = parts.length > 1 ? parts[parts.length - 1] : '';

    const rows = await prisma.doctors.findMany({
      where: {
        OR: [
          ...(firstToken ? [{ first_name: { contains: firstToken, mode: 'insensitive' } }] : []),
          ...(lastToken ? [{ last_name: { contains: lastToken, mode: 'insensitive' } }] : []),
          { specialization: { contains: cleaned, mode: 'insensitive' } }
        ]
      },
      select: { id: true, first_name: true, last_name: true },
      take: 25
    });

    const target = normalizeDoctorName(dn);
    for (const d of rows || []) {
      const full = `Dr. ${String(d.first_name || '').trim()} ${String(d.last_name || '').trim()}`.trim();
      if (normalizeDoctorName(full) === target) return d.id;
    }

    const fallback = await prisma.doctors.findFirst({
      where: {
        OR: [
          { first_name: { equals: firstToken || '', mode: 'insensitive' } },
          { email: { equals: dn, mode: 'insensitive' } }
        ]
      },
      select: { id: true }
    });
    return fallback?.id || null;
  } catch (_) {
    return null;
  }
}

router.post('/paymongo/webhook', async (req, res) => {
  try {
    const secret = String(process.env.PAYMONGO_WEBHOOK_SECRET || '').trim();
    if (!secret) return res.status(500).json({ message: 'Missing webhook secret.' });

    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : req.rawBody ? req.rawBody.toString('utf8') : '';
    const signature = req.headers['paymongo-signature'];
    const livemode = !!req.body?.data?.attributes?.livemode;

    const ok = verifyPaymongoWebhook({ rawBody, signatureHeader: signature, secret, livemode });
    if (!ok) return res.status(400).json({ message: 'Invalid signature' });

    const eventId = req.body?.data?.id || null;
    const type = req.body?.data?.attributes?.type || '';
    const eventData = req.body?.data?.attributes?.data || null;

    const checkoutSession = eventData?.type === 'checkout_session' ? eventData : null;
    const checkoutId = checkoutSession?.id || null;
    const bookingRef = checkoutSession?.attributes?.metadata?.bookingRef || null;
    const paymentId = checkoutSession?.attributes?.payments?.[0]?.id || checkoutSession?.attributes?.payment_intent?.payments?.[0]?.id || null;

    if (!bookingRef) return res.json({ ok: true });

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT booking_ref, patient_id, patient_email, patient_name, doctor_name, doctor_id, specialization, service_type,
               start_at, end_at, slot_date, slot_time, status, expires_at, amount, currency, appointment_id,
               approval_request_id, paymongo_event_id
        FROM video_booking_holds
        WHERE booking_ref = ${String(bookingRef)}
        LIMIT 1
      `
    );
    const hold = Array.isArray(rows) ? rows[0] : null;
    if (!hold) return res.json({ ok: true });
    if (hold.paymongo_event_id && String(hold.paymongo_event_id) === String(eventId)) return res.json({ ok: true });

    const expiresAt = hold?.expires_at ? new Date(hold.expires_at) : null;
    if (expiresAt && expiresAt.getTime() < Date.now() && String(hold.status || '').toUpperCase() === 'HOLD') {
      await prisma.$executeRaw(Prisma.sql`UPDATE video_booking_holds SET status = 'EXPIRED', updated_at = now() WHERE booking_ref = ${String(bookingRef)}`);
      return res.json({ ok: true });
    }

    if (String(type).toLowerCase() !== 'checkout_session.payment.paid' && String(type).toLowerCase() !== 'payment.paid') {
      if (String(type).toLowerCase().includes('failed')) {
        await prisma.$executeRaw(
          Prisma.sql`
            UPDATE video_booking_holds
            SET status = 'PAYMENT_FAILED',
                paymongo_event_id = ${eventId},
                updated_at = now()
            WHERE booking_ref = ${String(bookingRef)}
          `
        );
      }
      return res.json({ ok: true });
    }

    if (hold.appointment_id) {
      await prisma.$executeRaw(
        Prisma.sql`
          UPDATE video_booking_holds
          SET status = 'APPOINTMENT_CREATED',
              paymongo_event_id = ${eventId},
              paymongo_payment_id = ${paymentId},
              updated_at = now()
          WHERE booking_ref = ${String(bookingRef)}
        `
      );
      return res.json({ ok: true });
    }

    const day = hold.slot_date ? new Date(hold.slot_date).toISOString().slice(0, 10) : null;
    const time = hold.slot_time ? String(hold.slot_time).slice(0, 5) : null;
    if (!day || !time) return res.json({ ok: true });
    let firstName = null;
    let lastName = null;
    let patientEmail = hold.patient_email ? String(hold.patient_email) : null;
    const patientId = hold.patient_id ? String(hold.patient_id) : null;
    if (patientId) {
      const p = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
      if (p) {
        firstName = p.first_name || null;
        lastName = p.last_name || null;
        patientEmail = patientEmail || p.email || null;
      }
    }
    if (!firstName || !lastName) {
      const nm = String(hold.patient_name || '').trim();
      if (nm) {
        const parts = nm.split(/\s+/).filter(Boolean);
        firstName = firstName || parts[0] || null;
        lastName = lastName || (parts.length > 1 ? parts.slice(1).join(' ') : null);
      }
    }

    const doctorName = hold.doctor_name ? String(hold.doctor_name).trim() : '';
    const holdDoctorId = hold.doctor_id ? String(hold.doctor_id).trim() : '';
    const doctorUuid = holdDoctorId || (doctorName ? await resolveDoctorUuidFromDoctorName(doctorName) : null);

    if (!doctorUuid) throw new Error('Paid booking has no valid assigned doctor.');
    const specialization = String(hold.specialization || '').trim();
    const serviceType = String(hold.service_type || '').trim() || 'Video Consultation';
    const patientName = [firstName, lastName].filter(Boolean).join(' ').trim()
      || String(hold.patient_name || '').trim()
      || patientEmail
      || 'Patient';
    const reason = `Video Consultation${specialization ? ` - ${specialization}` : ''} (Paid; PAYREF:${paymentId || checkoutId || bookingRef})`;

    const requestRows = await prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO appointment_approval_requests (
          patient_id, patient_name, doctor_name, doctor_id, nurse_name,
          requested_date, requested_time, service_type, service_category,
          department_key, service_name, reason, status, booking_ref,
          paymongo_checkout_session_id, paymongo_payment_id, paymongo_event_id,
          payment_status, paid_at, amount, currency, created_at, updated_at
        ) VALUES (
          ${patientId}::uuid, ${patientName}, ${doctorName || null}, ${doctorUuid}::uuid, 'Online Consultation',
          ${day}::date, ${time}::time, ${serviceType}, 'consultation',
          ${specialization || serviceType}, ${specialization || serviceType}, ${reason}, 'Pending', ${String(bookingRef)},
          ${checkoutId}, ${paymentId}, ${eventId}, 'paid', now(),
          ${hold.amount ? Number(hold.amount) : null}, ${hold.currency ? String(hold.currency) : 'PHP'}, now(), now()
        )
        ON CONFLICT (booking_ref) WHERE booking_ref IS NOT NULL
        DO UPDATE SET
          paymongo_event_id = EXCLUDED.paymongo_event_id,
          paymongo_payment_id = COALESCE(appointment_approval_requests.paymongo_payment_id, EXCLUDED.paymongo_payment_id),
          payment_status = 'paid', paid_at = COALESCE(appointment_approval_requests.paid_at, now()), updated_at = now()
        RETURNING id
      `
    );
    const approvalRequestId = Array.isArray(requestRows) ? requestRows[0]?.id : requestRows?.id;

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE video_booking_holds
        SET status = 'APPROVAL_PENDING',
            approval_request_id = ${approvalRequestId ? BigInt(approvalRequestId) : null},
            paymongo_checkout_session_id = ${checkoutId},
            paymongo_payment_id = ${paymentId},
            paymongo_event_id = ${eventId},
            updated_at = now()
        WHERE booking_ref = ${String(bookingRef)}
      `
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: 'Webhook error' });
  }
});

module.exports = router;

