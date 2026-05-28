const express = require('express');
const router = express.Router();
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset, parseDate } = require('../utils/normalize');
const { createClient } = require('@supabase/supabase-js');

const DOCTOR_SPECIALIZATION_MASTER_LIST = [
  'Surgery',
  'Orthopedics',
  'Anesthesia',
  'Ophthalmology',
  'Obstetrics-Gynecology',
  'Pediatrics',
  'Dermatology',
  'Otolaryngology',
  'Urology',
  'Pathology',
  'Radiology',
  'Dental Medicine',
  'Medicine'
];


function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}

function toTimeStr(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeToMinutes(time) {
  const t = toTimeStr(time);
  if (!t) return null;
  const [hh, mm] = t.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function minutesToTime(mins) {
  const v = Math.max(0, Math.min(24 * 60, Math.trunc(Number(mins) || 0)));
  const hh = Math.floor(v / 60);
  const mm = v % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function dateKey(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

let supabaseAdmin = null;
function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  return supabaseAdmin;
}

async function loadBlockedDatesSupabase({ doctorId, from, to }) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from('doctor_availability')
    .select('id, doctor_id, available_date, start_time, end_time, is_available, reason')
    .eq('doctor_id', doctorId)
    .eq('is_available', false)
    .gte('available_date', from)
    .lte('available_date', to)
    .order('available_date', { ascending: true });
  if (error) throw new Error(error.message || 'Supabase read failed');
  return Array.isArray(data) ? data : [];
}

async function upsertBlockedDateSupabase({ doctorId, date, startTime, endTime, reason }) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const { data: existing, error: existingErr } = await sb
    .from('doctor_availability')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('available_date', date)
    .order('id', { ascending: false })
    .limit(1);
  if (existingErr) throw new Error(existingErr.message || 'Supabase lookup failed');
  const row = Array.isArray(existing) ? existing[0] : null;

  if (row?.id != null) {
    const { data, error } = await sb
      .from('doctor_availability')
      .update({
        start_time: startTime,
        end_time: endTime,
        is_available: false,
        reason: reason ?? null
      })
      .eq('id', row.id)
      .eq('doctor_id', doctorId)
      .select('id, doctor_id, available_date, start_time, end_time, is_available, reason')
      .limit(1);
    if (error) throw new Error(error.message || 'Supabase update failed');
    return Array.isArray(data) ? data[0] : null;
  }

  const { data, error } = await sb
    .from('doctor_availability')
    .insert([
      {
        doctor_id: doctorId,
        available_date: date,
        start_time: startTime,
        end_time: endTime,
        is_available: false,
        reason: reason ?? null
      }
    ])
    .select('id, doctor_id, available_date, start_time, end_time, is_available, reason')
    .limit(1);
  if (error) throw new Error(error.message || 'Supabase insert failed');
  return Array.isArray(data) ? data[0] : null;
}

async function upsertBlockedDatesSupabaseBulk({ doctorIds, date, startTime, endTime, reason }) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const list = (Array.isArray(doctorIds) ? doctorIds : []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!list.length) return [];

  const rows = list.map((doctorId) => ({
    doctor_id: doctorId,
    available_date: date,
    start_time: startTime,
    end_time: endTime,
    is_available: false,
    reason: reason ?? null
  }));

  const canUpsert = typeof sb.from('doctor_availability').upsert === 'function';
  if (canUpsert) {
    const { data, error } = await sb
      .from('doctor_availability')
      .upsert(rows, { onConflict: 'doctor_id,available_date' })
      .select('id, doctor_id, available_date, start_time, end_time, is_available, reason');
    if (error) throw new Error(error.message || 'Supabase bulk upsert failed');
    return Array.isArray(data) ? data : [];
  }

  const results = [];
  for (const doctorId of list) {
    const r = await upsertBlockedDateSupabase({ doctorId, date, startTime, endTime, reason });
    if (r) results.push(r);
  }
  return results;
}

async function deleteBlockedDatesSupabaseBulk({ doctorIds, date }) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const list = (Array.isArray(doctorIds) ? doctorIds : []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!list.length) return { ok: true };
  const { error } = await sb
    .from('doctor_availability')
    .delete()
    .in('doctor_id', list)
    .eq('available_date', date);
  if (error) throw new Error(error.message || 'Supabase bulk delete failed');
  return { ok: true };
}

async function deleteBlockedDateSupabase({ doctorId, id }) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { error } = await sb
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('id', id);
  if (error) throw new Error(error.message || 'Supabase delete failed');
  return { ok: true };
}

async function ensureAvailabilityTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.doctor_availability (
      id BIGSERIAL PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
      available_date DATE NOT NULL,
      start_time TIME NULL,
      end_time TIME NULL,
      is_available BOOLEAN NOT NULL DEFAULT true,
      reason TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (doctor_id, available_date)
    );
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS start_time TIME NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS end_time TIME NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS reason TEXT NULL;`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN IF NOT EXISTS available_date DATE NOT NULL DEFAULT CURRENT_DATE;`).catch(() => {});

  try {
    const info = await prisma.$queryRaw(
      Prisma.sql`
        SELECT udt_name AS "udtName"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'doctor_availability'
          AND column_name = 'doctor_id'
        LIMIT 1
      `
    );
    const udt = Array.isArray(info) && info.length ? String(info[0]?.udtName || '') : '';
    if (udt && udt !== 'uuid') {
      const cntRows = await prisma.$queryRaw(
        Prisma.sql`SELECT count(*)::bigint AS cnt FROM public.doctor_availability`
      );
      const cnt = Array.isArray(cntRows) && cntRows.length ? Number(cntRows[0]?.cnt) : 0;
      if (!Number.isFinite(cnt) || cnt !== 0) {
        throw new Error('doctor_availability.doctor_id type mismatch and table is not empty');
      }
      await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability DROP COLUMN doctor_id CASCADE;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.doctor_availability ADD COLUMN doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE;`);
    }
  } catch (_) {}

  await prisma
    .$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS doctor_availability_doctor_date_uidx ON public.doctor_availability(doctor_id, available_date);`
    )
    .catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_doc_idx ON public.doctor_availability(doctor_id);`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_doc_date_idx ON public.doctor_availability(doctor_id, available_date);`).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.doctor_availability_rules (
      id BIGSERIAL PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'onsite',
      day_of_week INT NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      slot_minutes INT NOT NULL DEFAULT 30,
      max_per_slot INT NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_rules_doc_idx ON public.doctor_availability_rules(doctor_id);`).catch(() => {});
  await prisma
    .$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_rules_doc_dow_idx ON public.doctor_availability_rules(doctor_id, day_of_week);`)
    .catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_rules_mode_idx ON public.doctor_availability_rules(mode);`).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.doctor_availability_exceptions (
      id BIGSERIAL PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'onsite',
      date DATE NOT NULL,
      start_time TIME NULL,
      end_time TIME NULL,
      kind TEXT NOT NULL DEFAULT 'block',
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_exceptions_doc_idx ON public.doctor_availability_exceptions(doctor_id);`).catch(() => {});
  await prisma
    .$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_exceptions_doc_date_idx ON public.doctor_availability_exceptions(doctor_id, date);`)
    .catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_exceptions_mode_idx ON public.doctor_availability_exceptions(mode);`).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.doctor_availability_day_offs (
      id BIGSERIAL PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'onsite',
      day_of_week INT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (doctor_id, mode, day_of_week)
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_day_offs_doc_idx ON public.doctor_availability_day_offs(doctor_id);`).catch(() => {});
  await prisma
    .$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_day_offs_doc_dow_idx ON public.doctor_availability_day_offs(doctor_id, day_of_week);`)
    .catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.doctor_availability_date_windows (
      id BIGSERIAL PRIMARY KEY,
      doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'onsite',
      date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      slot_minutes INT NOT NULL DEFAULT 30,
      max_per_slot INT NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_date_windows_doc_idx ON public.doctor_availability_date_windows(doctor_id);`).catch(() => {});
  await prisma
    .$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_date_windows_doc_date_idx ON public.doctor_availability_date_windows(doctor_id, date);`)
    .catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doctor_availability_date_windows_mode_idx ON public.doctor_availability_date_windows(mode);`).catch(() => {});
}

let doctorAvailabilityEnsuredAt = 0;
let doctorAvailabilityEnsurePromise = null;
const DOCTOR_AVAILABILITY_AUTO_ENSURE = false; // Disabled to prevent Request Timeouts in production

async function ensureAvailabilityTablesOnce() {
  // Logic disabled to prevent slow DDL operations during requests
  return;
}

function inferRole(req) {
  return String(req.headers['x-user-role'] || '').trim().toLowerCase();
}

async function resolvePatientForRequest(req) {
  const explicitPatientId = String(req.headers['x-patient-id'] || '').trim();
  const requesterEmail = normalizeEmail(String(req.headers['x-user-email'] || ''));
  const requesterName = String(req.headers['x-user-name'] || '').trim();

  let patient = null;
  if (isUuid(explicitPatientId)) {
    patient = await prisma.patients
      .findFirst({ where: { id: explicitPatientId }, select: { id: true, email: true, first_name: true, last_name: true } })
      .catch(() => null);
  }

  if (patient?.id && requesterEmail) {
    const stored = normalizeEmail(String(patient.email || ''));
    if (!stored) {
      await prisma.patients
        .update({ where: { id: String(patient.id) }, data: { email: requesterEmail } })
        .then(() => {
          patient.email = requesterEmail;
        })
        .catch(() => {});
    }
    if (stored && stored !== requesterEmail) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }

  if (!patient?.id) {
    if (!requesterEmail) {
      const err = new Error('Missing user email or x-patient-id');
      err.statusCode = 401;
      throw err;
    }
    patient = await prisma.patients
      .findFirst({ where: { email: { equals: requesterEmail, mode: 'insensitive' } }, select: { id: true, email: true, first_name: true, last_name: true } })
      .catch(() => null);
  }

  if (!patient?.id) {
    const err = new Error('Patient not found');
    err.statusCode = 404;
    throw err;
  }

  const patientName =
    `${String(patient.first_name || '').trim()} ${String(patient.last_name || '').trim()}`.trim() ||
    requesterName ||
    null;

  return { id: String(patient.id), email: normalizeEmail(String(patient.email || '')), name: patientName };
}

async function loadRules({ doctorId, mode }) {
  await ensureAvailabilityTablesOnce();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        id::text AS id,
        doctor_id AS "doctorId",
        mode,
        day_of_week AS "dayOfWeek",
        to_char(start_time, 'HH24:MI') AS "startTime",
        to_char(end_time, 'HH24:MI') AS "endTime",
        slot_minutes AS "slotMinutes",
        max_per_slot AS "maxPerSlot",
        active
      FROM public.doctor_availability_rules
      WHERE doctor_id = ${String(doctorId)}::uuid
        AND lower(mode) = ${String(mode || 'onsite').toLowerCase()}
        AND active = true
      ORDER BY day_of_week ASC, start_time ASC
    `
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function loadExceptions({ doctorId, mode, from, to }) {
  await ensureAvailabilityTablesOnce();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        id::text AS id,
        doctor_id AS "doctorId",
        mode,
        date AS date,
        to_char(start_time, 'HH24:MI') AS "startTime",
        to_char(end_time, 'HH24:MI') AS "endTime",
        kind,
        note
      FROM public.doctor_availability_exceptions
      WHERE doctor_id = ${String(doctorId)}::uuid
        AND lower(mode) = ${String(mode || 'onsite').toLowerCase()}
        AND date >= ${from}::date
        AND date <= ${to}::date
      ORDER BY date ASC, start_time ASC NULLS FIRST
    `
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function loadBlockedDates({ doctorId, from, to }) {
  await ensureAvailabilityTablesOnce();
  let rows = null;
  let usedSupabase = false;
  try {
    rows = await loadBlockedDatesSupabase({ doctorId, from, to });
    usedSupabase = true;
  } catch (_) {
    rows = null;
  }

  if (!rows) {
    rows = await prisma
      .$queryRaw(
        Prisma.sql`
          SELECT
            id::text AS id,
            doctor_id AS "doctorId",
            available_date AS date,
            to_char(start_time, 'HH24:MI') AS "startTime",
            to_char(end_time, 'HH24:MI') AS "endTime",
            reason
          FROM public.doctor_availability
          WHERE doctor_id = ${String(doctorId)}::uuid
            AND available_date >= ${from}::date
            AND available_date <= ${to}::date
            AND is_available = false
          ORDER BY available_date ASC
        `
      )
      .catch(() => []);
  }

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    doctorId: String(row.doctorId || row.doctor_id || doctorId),
    date: row.date || row.available_date,
    startTime: row.startTime || (row.start_time ? String(row.start_time).slice(0, 5) : null) || null,
    endTime: row.endTime || (row.end_time ? String(row.end_time).slice(0, 5) : null) || null,
    reason: row.reason || null
  }));
}

async function loadDateWindows({ doctorId, mode, from, to }) {
  await ensureAvailabilityTablesOnce();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        id::text AS id,
        doctor_id AS "doctorId",
        mode,
        date AS date,
        to_char(start_time, 'HH24:MI') AS "startTime",
        to_char(end_time, 'HH24:MI') AS "endTime",
        slot_minutes AS "slotMinutes",
        max_per_slot AS "maxPerSlot",
        active
      FROM public.doctor_availability_date_windows
      WHERE doctor_id = ${String(doctorId)}::uuid
        AND lower(mode) = ${String(mode || 'onsite').toLowerCase()}
        AND active = true
        AND date >= ${from}::date
        AND date <= ${to}::date
      ORDER BY date ASC, start_time ASC
    `
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function loadDayOffs({ doctorId, mode }) {
  await ensureAvailabilityTablesOnce();
  const rows = await prisma
    .$queryRaw(
      Prisma.sql`
        SELECT day_of_week AS "dayOfWeek"
        FROM public.doctor_availability_day_offs
        WHERE doctor_id = ${String(doctorId)}::uuid
          AND lower(mode) = ${String(mode || 'onsite').toLowerCase()}
          AND active = true
        ORDER BY day_of_week ASC
      `
    )
    .catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r) => Number(r?.dayOfWeek))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 6);
}

function buildSlotListForDate({ date, rules, dateWindows, dayOffs, exceptions, bookedByTime }) {
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return [];
  const dow = day.getDay();
  const dKey = dateKey(day);

  if (Array.isArray(dayOffs) && dayOffs.includes(dow)) return [];

  const exc = (Array.isArray(exceptions) ? exceptions : []).filter((e) => dateKey(e?.date) === dKey);
  const fullDayBlocked = exc.some((e) => !e.startTime && !e.endTime);
  if (fullDayBlocked) return [];

  const dayWindows = (Array.isArray(dateWindows) ? dateWindows : []).filter((w) => dateKey(w?.date) === dKey);
  const sources = dayWindows.length
    ? dayWindows.map((w) => ({
      startTime: w.startTime,
      endTime: w.endTime,
      slotMinutes: w.slotMinutes,
      maxPerSlot: w.maxPerSlot
    }))
    : (Array.isArray(rules) ? rules : [])
        .filter((r) => Number(r?.dayOfWeek) === dow)
        .map((r) => ({
          startTime: r.startTime,
          endTime: r.endTime,
          slotMinutes: r.slotMinutes,
          maxPerSlot: r.maxPerSlot
        }));
  if (!sources.length) {
    sources.push({
      startTime: '09:00',
      endTime: '17:00',
      slotMinutes: 30,
      maxPerSlot: 1
    });
  }

  const slots = [];
  const seen = new Set();

  for (const r of sources) {
    const startMin = timeToMinutes(r.startTime);
    const endMin = timeToMinutes(r.endTime);
    const step = Math.max(5, Math.min(240, Math.trunc(Number(r.slotMinutes || 30) || 30)));
    const maxPer = Math.max(1, Math.min(20, Math.trunc(Number(r.maxPerSlot || 1) || 1)));
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;

    for (let t = startMin; t + step <= endMin; t += step) {
      const time = minutesToTime(t);
      const isBlocked = exc.some((e) => {
        const es = timeToMinutes(e.startTime);
        const ee = timeToMinutes(e.endTime);
        if (es === null || ee === null) return false;
        return t >= es && t < ee;
      });
      if (isBlocked) continue;
      const bookedCount = bookedByTime?.get(time) ? Number(bookedByTime.get(time)) : 0;
      if (bookedCount >= maxPer) continue;
      if (seen.has(time)) continue;
      seen.add(time);
      slots.push({ time });
    }
  }

  return slots;
}

async function computeDoctorAvailabilityDays({ doctorId, mode, fromKey, toKey }) {
  const from = new Date(fromKey);
  const to = new Date(toKey);
  const diffDays = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 62) return [];

  const rules = await loadRules({ doctorId, mode });
  const dateWindows = await loadDateWindows({ doctorId, mode, from: fromKey, to: toKey });
  const dayOffs = await loadDayOffs({ doctorId, mode });
  const exceptions = await loadExceptions({ doctorId, mode, from: fromKey, to: toKey });
  const blockedDates = await loadBlockedDates({ doctorId, from: fromKey, to: toKey });
  const combinedExceptions = [...(Array.isArray(exceptions) ? exceptions : []), ...(Array.isArray(blockedDates) ? blockedDates : [])];
  const blockedSet = new Set(
    (Array.isArray(blockedDates) ? blockedDates : [])
      .filter((row) => !row?.startTime && !row?.endTime)
      .map((row) => dateKey(row?.date))
      .filter(Boolean)
  );

  const appts = await prisma.appointments
    .findMany({
      where: {
        doctor_uuid: doctorId,
        consultation_mode: 'onsite',
        appointment_date: { gte: from, lte: to }
      },
      select: { appointment_date: true, appointment_time: true, status: true }
    })
    .catch(() => []);

  const booked = new Map();
  for (const a of Array.isArray(appts) ? appts : []) {
    const st = String(a.status || '').trim().toLowerCase();
    if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
    const d = dateKey(a.appointment_date);
    const t = a.appointment_time ? new Date(a.appointment_time) : null;
    const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
    if (!d || !time) continue;
    const key = `${d}T${time}`;
    booked.set(key, (booked.get(key) || 0) + 1);
  }

  const days = [];
  for (let i = 0; i <= diffDays; i += 1) {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    const dKey = dateKey(d);
    if (blockedSet.has(dKey)) {
      days.push({ date: dKey, isAvailable: false, availableSlots: 0 });
      continue;
    }
    const bookedByTime = new Map();
    for (const [k, c] of booked.entries()) {
      if (k.startsWith(`${dKey}T`)) bookedByTime.set(k.slice(11), c);
    }
    const daySlots = buildSlotListForDate({ date: d, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime });
    days.push({ date: dKey, isAvailable: daySlots.length > 0, availableSlots: daySlots.length });
  }

  return days;
}

async function computeDoctorAvailabilitySlots({ doctorId, mode, dateKey: dKey }) {
  const dt = new Date(dKey);
  if (Number.isNaN(dt.getTime())) return [];

  // Run initial checks and loads in parallel to speed up processing
  const [blockedDates, rules, dateWindows, dayOffs, exceptions] = await Promise.all([
    loadBlockedDates({ doctorId, from: dKey, to: dKey }),
    loadRules({ doctorId, mode }),
    loadDateWindows({ doctorId, mode, from: dKey, to: dKey }),
    loadDayOffs({ doctorId, mode }),
    loadExceptions({ doctorId, mode, from: dKey, to: dKey })
  ]).catch(() => [[], [], [], [], []]);

  const dayBlocked = (Array.isArray(blockedDates) ? blockedDates : []).some((b) => !b?.startTime && !b?.endTime);
  if (dayBlocked) return [];

  const combinedExceptions = [...(Array.isArray(exceptions) ? exceptions : []), ...(Array.isArray(blockedDates) ? blockedDates : [])];

  const appts = await prisma.appointments
    .findMany({
      where: {
        doctor_uuid: doctorId,
        consultation_mode: 'onsite',
        appointment_date: dt
      },
      select: { appointment_time: true, status: true }
    })
    .catch(() => []);

  const bookedByTime = new Map();
  for (const a of Array.isArray(appts) ? appts : []) {
    const st = String(a.status || '').trim().toLowerCase();
    if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
    const t = a.appointment_time ? new Date(a.appointment_time) : null;
    const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
    if (!time) continue;
    bookedByTime.set(time, (bookedByTime.get(time) || 0) + 1);
  }

  const slots = buildSlotListForDate({ date: dt, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime });
  return Array.isArray(slots) ? slots : [];
}

router.get('/doctors/specializations', requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']), async (req, res) => {
  try {
    const rows = await prisma
      .$queryRaw(
        Prisma.sql`
          SELECT label
          FROM (
            SELECT trim(specialization) AS label
            FROM public.doctors
            WHERE specialization IS NOT NULL
              AND length(trim(specialization)) > 0
            UNION
            SELECT trim(department) AS label
            FROM public.doctors
            WHERE department IS NOT NULL
              AND length(trim(department)) > 0
            UNION
            SELECT trim(specialization) AS label
            FROM public.video_booking_holds
            WHERE specialization IS NOT NULL
              AND length(trim(specialization)) > 0
          ) src
          ORDER BY label ASC
        `
      )
      .catch(() => []);
    const seen = new Map();
    DOCTOR_SPECIALIZATION_MASTER_LIST.forEach((label) => {
      const clean = String(label || '').trim();
      if (!clean) return;
      seen.set(clean.toLowerCase(), clean);
    });
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const label = String(r?.label || '').trim();
      if (!label) return;
      const key = label.toLowerCase();
      if (!seen.has(key)) seen.set(key, label);
    });
    const list = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/doctors/:doctorId/availability/day-offs', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const days = await loadDayOffs({ doctorId, mode });
    res.json({ doctorId, mode, days });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/doctors/:doctorId/availability/day-offs', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.body?.mode || req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const days = Array.isArray(req.body?.days) ? req.body.days : [];
    const normalized = days
      .map((d) => Math.trunc(Number(d)))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    const uniq = Array.from(new Set(normalized)).sort((a, b) => a - b);

    await ensureAvailabilityTablesOnce();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          DELETE FROM public.doctor_availability_day_offs
          WHERE doctor_id = ${String(doctorId)}::uuid
            AND lower(mode) = ${mode}
        `
      );

      if (uniq.length) {
        const values = uniq.map((d) => Prisma.sql`(${String(doctorId)}::uuid, ${mode}, ${d}, true, now(), now())`);
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO public.doctor_availability_day_offs
              (doctor_id, mode, day_of_week, active, created_at, updated_at)
            VALUES ${Prisma.join(values)}
          `
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get(
  '/doctors',
  requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']),
  async (req, res) => {
    try {
      const specialization = String(req.query.specialization || req.query.department || '').trim();
      const q = String(req.query.q || '').trim().toLowerCase();
      const limit = parseLimit(req.query.take, { min: 1, max: 200, fallback: 80 });

      const where = {};
      if (specialization) where.specialization = { equals: specialization, mode: 'insensitive' };

      const doctors = await prisma.doctors
        .findMany({
          where: Object.keys(where).length ? where : undefined,
          select: {
            id: true,
            first_name: true,
            last_name: true,
            specialization: true,
            status: true
          },
          take: limit,
          orderBy: [{ specialization: 'asc' }, { last_name: 'asc' }]
        })
        .catch(() => []);

      const filtered = (Array.isArray(doctors) ? doctors : []).filter((d) => {
        if (!q) return true;
        const name = `${String(d.first_name || '')} ${String(d.last_name || '')}`.trim().toLowerCase();
        const spec = String(d.specialization || '').toLowerCase();
        return name.includes(q) || spec.includes(q);
      });

      res.json(
        filtered.map((d) => ({
          id: String(d.id),
          name: `Dr. ${String(d.first_name || '').trim()} ${String(d.last_name || '').trim()}`.trim(),
          specialization: d.specialization || null,
          status: d.status || null
        }))
      );
    } catch (err) {
      res.status(500).json({ message: 'Server error' });
    }
  }
);

router.get(
  '/doctors/availability/specialization',
  requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']),
  async (req, res) => {
    try {
      const specialization = String(req.query.specialization || '').trim();
      if (!specialization) return res.status(400).json({ message: 'specialization is required' });
      const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      if (!from || !to) return res.status(400).json({ message: 'from and to are required' });
      const fromKey = dateKey(from);
      const toKey = dateKey(to);
      if (!fromKey || !toKey) return res.status(400).json({ message: 'Invalid from/to' });

      const start = new Date(fromKey);
      const end = new Date(toKey);
      const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays < 0 || diffDays > 62) return res.status(400).json({ message: 'Date range too large' });

      const doctors = await prisma.doctors
        .findMany({
          where: { specialization: { equals: specialization, mode: 'insensitive' } },
          select: { id: true }
        })
        .catch(() => []);
      const doctorIds = (Array.isArray(doctors) ? doctors : []).map((d) => String(d.id)).filter(Boolean);

      const merged = new Map();
      if (doctorIds.length) {
        for (const doctorId of doctorIds) {
          const days = await computeDoctorAvailabilityDays({ doctorId, mode, fromKey, toKey }).catch(() => []);
          for (const day of Array.isArray(days) ? days : []) {
            const dKey = String(day?.date || '').trim();
            if (!dKey) continue;
            const prev = merged.get(dKey) || { date: dKey, isAvailable: false, availableSlots: 0, availableDoctors: 0 };
            const slots = Number(day?.availableSlots || 0) || 0;
            const has = Boolean(day?.isAvailable) && slots > 0;
            merged.set(dKey, {
              date: dKey,
              isAvailable: prev.isAvailable || has,
              availableSlots: prev.availableSlots + (slots > 0 ? slots : 0),
              availableDoctors: prev.availableDoctors + (has ? 1 : 0)
            });
          }
        }
      }

      const days = [];
      for (let i = 0; i <= diffDays; i += 1) {
        const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
        const dKey = dateKey(d);
        const row = merged.get(dKey) || { date: dKey, isAvailable: false, availableSlots: 0, availableDoctors: 0 };
        days.push(row);
      }

      res.json({
        specialization,
        mode,
        from: fromKey,
        to: toKey,
        doctorCount: doctorIds.length,
        days
      });
    } catch (err) {
      res.status(500).json({ message: 'Server error' });
    }
  }
);

router.get(
  '/doctors/availability/specialization/slots',
  requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']),
  async (req, res) => {
    try {
      const specialization = String(req.query.specialization || '').trim();
      if (!specialization) return res.status(400).json({ message: 'specialization is required' });
      const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
      const dateRaw = String(req.query.date || '').trim();
      if (!dateRaw) return res.status(400).json({ message: 'date is required' });
      const dt = new Date(dateRaw);
      if (Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
      const dKey = dateKey(dt);

      const doctors = await prisma.doctors
        .findMany({
          where: { specialization: { equals: specialization, mode: 'insensitive' } },
          select: { id: true }
        })
        .catch(() => []);
      const doctorIds = (Array.isArray(doctors) ? doctors : []).map((d) => String(d.id)).filter(Boolean);

      const byTime = new Map();
      if (doctorIds.length) {
        // Parallelize slot computation for all doctors in the specialization to avoid timeouts
        const slotResults = await Promise.all(
          doctorIds.map(doctorId => 
            computeDoctorAvailabilitySlots({ doctorId, mode, dateKey: dKey }).catch(() => [])
          )
        );

        for (const slots of slotResults) {
          for (const s of Array.isArray(slots) ? slots : []) {
            const t = String(s?.time || '').trim();
            if (!t) continue;
            byTime.set(t, (byTime.get(t) || 0) + 1);
          }
        }
      }

      const slots = Array.from(byTime.entries())
        .map(([time, availableDoctors]) => ({ time, availableDoctors }))
        .sort((a, b) => a.time.localeCompare(b.time));

      res.json({ specialization, mode, date: dKey, slots });
    } catch (err) {
      res.status(500).json({ message: 'Server error' });
    }
  }
);

router.get(
  '/doctors/:doctorId/availability',
  requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']),
  async (req, res) => {
    try {
      const doctorId = String(req.params.doctorId || '').trim();
      if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });

      const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      if (!from || !to) return res.status(400).json({ message: 'from and to are required' });
      const fromKey = dateKey(from);
      const toKey = dateKey(to);
      if (!fromKey || !toKey) return res.status(400).json({ message: 'Invalid from/to' });

      const start = new Date(fromKey);
      const end = new Date(toKey);
      const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays < 0 || diffDays > 62) return res.status(400).json({ message: 'Date range too large' });

      const rules = await loadRules({ doctorId, mode });
      const dateWindows = await loadDateWindows({ doctorId, mode, from: fromKey, to: toKey });
      const dayOffs = await loadDayOffs({ doctorId, mode });
      const exceptions = await loadExceptions({ doctorId, mode, from: fromKey, to: toKey });
      const blockedDates = await loadBlockedDates({ doctorId, from: fromKey, to: toKey });
      const combinedExceptions = [...(Array.isArray(exceptions) ? exceptions : []), ...(Array.isArray(blockedDates) ? blockedDates : [])];
      const blockedSet = new Set(
        (Array.isArray(blockedDates) ? blockedDates : [])
          .filter((row) => !row?.startTime && !row?.endTime)
          .map((row) => dateKey(row?.date))
          .filter(Boolean)
      );

      const appts = await prisma.appointments
        .findMany({
          where: {
            doctor_uuid: doctorId,
            consultation_mode: 'onsite',
            appointment_date: { gte: start, lte: end }
          },
          select: { appointment_date: true, appointment_time: true, status: true }
        })
        .catch(() => []);

      const booked = new Map();
      for (const a of Array.isArray(appts) ? appts : []) {
        const st = String(a.status || '').trim().toLowerCase();
        if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
        const d = dateKey(a.appointment_date);
        const t = a.appointment_time ? new Date(a.appointment_time) : null;
        const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
        if (!d || !time) continue;
        const key = `${d}T${time}`;
        booked.set(key, (booked.get(key) || 0) + 1);
      }

      const days = [];
      for (let i = 0; i <= diffDays; i += 1) {
        const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
        const dKey = dateKey(d);
        if (blockedSet.has(dKey)) {
          days.push({ date: dKey, isAvailable: false, availableSlots: 0 });
          continue;
        }
        const bookedByTime = new Map();
        for (const [k, c] of booked.entries()) {
          if (k.startsWith(`${dKey}T`)) bookedByTime.set(k.slice(11), c);
        }
        const daySlots = buildSlotListForDate({ date: d, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime });
        days.push({ date: dKey, isAvailable: daySlots.length > 0, availableSlots: daySlots.length });
      }

      res.json({ doctorId, mode, from: fromKey, to: toKey, days });
    } catch (err) {
      res.status(500).json({ message: 'Server error' });
    }
  }
);

router.get(
  '/doctors/:doctorId/availability/slots',
  requireRole(['patient', 'doctor', 'doctor_secretary', 'admin', 'nurse']),
  async (req, res) => {
    try {
      const doctorId = String(req.params.doctorId || '').trim();
      if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
      const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
      const dateRaw = String(req.query.date || '').trim();
      if (!dateRaw) return res.status(400).json({ message: 'date is required' });
      const dt = new Date(dateRaw);
      if (Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
      const dKey = dateKey(dt);
      const blockedDates = await loadBlockedDates({ doctorId, from: dKey, to: dKey });
      const dayBlocked = (Array.isArray(blockedDates) ? blockedDates : []).some((b) => !b?.startTime && !b?.endTime);
      if (dayBlocked) {
        return res.json({ doctorId, mode, date: dKey, slots: [] });
      }

      const rules = await loadRules({ doctorId, mode });
      const dateWindows = await loadDateWindows({ doctorId, mode, from: dKey, to: dKey });
      const dayOffs = await loadDayOffs({ doctorId, mode });
      const exceptions = await loadExceptions({ doctorId, mode, from: dKey, to: dKey });
      const combinedExceptions = [...(Array.isArray(exceptions) ? exceptions : []), ...(Array.isArray(blockedDates) ? blockedDates : [])];

      const appts = await prisma.appointments
        .findMany({
          where: {
            doctor_uuid: doctorId,
            consultation_mode: 'onsite',
            appointment_date: dt
          },
          select: { appointment_time: true, status: true }
        })
        .catch(() => []);

      const bookedByTime = new Map();
      for (const a of Array.isArray(appts) ? appts : []) {
        const st = String(a.status || '').trim().toLowerCase();
        if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
        const t = a.appointment_time ? new Date(a.appointment_time) : null;
        const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
        if (!time) continue;
        bookedByTime.set(time, (bookedByTime.get(time) || 0) + 1);
      }

      const slots = buildSlotListForDate({ date: dt, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime });
      res.json({ doctorId, mode, date: dKey, slots });
    } catch (err) {
      res.status(500).json({ message: 'Server error' });
    }
  }
);

router.get('/doctors/:doctorId/availability/date-windows', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const from = parseDate(req.query.from) || new Date();
    const to = parseDate(req.query.to) || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const fromKey = dateKey(from);
    const toKey = dateKey(to);
    const rows = await loadDateWindows({ doctorId, mode, from: fromKey, to: toKey });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/doctors/:doctorId/availability/date-windows', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.body?.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const dateRaw = String(req.body?.date || '').trim();
    const dt = new Date(dateRaw);
    if (!dateRaw || Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const dKey = dateKey(dt);
    const startTime = toTimeStr(req.body?.startTime);
    const endTime = toTimeStr(req.body?.endTime);
    const slotMinutes = Math.max(5, Math.min(240, Math.trunc(Number(req.body?.slotMinutes || 30) || 30)));
    const maxPerSlot = Math.max(1, Math.min(20, Math.trunc(Number(req.body?.maxPerSlot || 1) || 1)));
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);
    if (!startTime || !endTime) return res.status(400).json({ message: 'startTime and endTime are required' });
    const s = timeToMinutes(startTime);
    const e = timeToMinutes(endTime);
    if (s === null || e === null || e <= s) return res.status(400).json({ message: 'Invalid time range' });

    await ensureAvailabilityTablesOnce();
    const rows = await prisma
      .$queryRaw(
        Prisma.sql`
          INSERT INTO public.doctor_availability_date_windows
            (doctor_id, mode, date, start_time, end_time, slot_minutes, max_per_slot, active, created_at, updated_at)
          VALUES
            (${String(doctorId)}::uuid, ${mode}, ${dKey}::date, ${startTime}::time, ${endTime}::time, ${slotMinutes}, ${maxPerSlot}, ${active}, now(), now())
          RETURNING
            id::text AS id,
            doctor_id AS "doctorId",
            mode,
            date AS date,
            to_char(start_time, 'HH24:MI') AS "startTime",
            to_char(end_time, 'HH24:MI') AS "endTime",
            slot_minutes AS "slotMinutes",
            max_per_slot AS "maxPerSlot",
            active
        `
      )
      .catch(() => []);
    res.status(201).json(Array.isArray(rows) ? rows[0] : null);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/doctors/:doctorId/availability/date-windows/:id', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    await ensureAvailabilityTablesOnce();
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM public.doctor_availability_date_windows
        WHERE id = ${BigInt(idRaw)}
          AND doctor_id = ${String(doctorId)}::uuid
      `
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/doctors/:doctorId/availability/rules', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
    await ensureAvailabilityTablesOnce();

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          id::text AS id,
          doctor_id AS "doctorId",
          mode,
          day_of_week AS "dayOfWeek",
          to_char(start_time, 'HH24:MI') AS "startTime",
          to_char(end_time, 'HH24:MI') AS "endTime",
          slot_minutes AS "slotMinutes",
          max_per_slot AS "maxPerSlot",
          active
        FROM public.doctor_availability_rules
        WHERE doctor_id = ${String(doctorId)}::uuid
          AND lower(mode) = ${mode}
        ORDER BY day_of_week ASC, start_time ASC
      `
    ).catch(() => []);

    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/doctors/:doctorId/availability/rules', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.body?.mode || req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
    await ensureAvailabilityTablesOnce();

    const normalized = rules
      .map((r) => {
        const dayOfWeek = Math.trunc(Number(r?.dayOfWeek));
        const startTime = toTimeStr(r?.startTime);
        const endTime = toTimeStr(r?.endTime);
        const slotMinutes = Math.max(5, Math.min(240, Math.trunc(Number(r?.slotMinutes || 30) || 30)));
        const maxPerSlot = Math.max(1, Math.min(20, Math.trunc(Number(r?.maxPerSlot || 1) || 1)));
        const active = r?.active === undefined ? true : Boolean(r.active);
        if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;
        if (!startTime || !endTime) return null;
        const s = timeToMinutes(startTime);
        const e = timeToMinutes(endTime);
        if (s === null || e === null || e <= s) return null;
        return { dayOfWeek, startTime, endTime, slotMinutes, maxPerSlot, active };
      })
      .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          DELETE FROM public.doctor_availability_rules
          WHERE doctor_id = ${String(doctorId)}::uuid
            AND lower(mode) = ${mode}
        `
      );

      if (normalized.length) {
        const values = normalized.map((r) =>
          Prisma.sql`(${String(doctorId)}::uuid, ${mode}, ${r.dayOfWeek}, ${r.startTime}::time, ${r.endTime}::time, ${r.slotMinutes}, ${r.maxPerSlot}, ${r.active}, now(), now())`
        );
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO public.doctor_availability_rules
              (doctor_id, mode, day_of_week, start_time, end_time, slot_minutes, max_per_slot, active, created_at, updated_at)
            VALUES ${Prisma.join(values)}
          `
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/doctors/:doctorId/availability/exceptions', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.query.mode || 'onsite').trim().toLowerCase() || 'onsite';

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const fromKey = dateKey(from || new Date());
    const toKey = dateKey(to || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));

    let rows = null;
    let usedSupabase = false;
    try {
      rows = await loadBlockedDatesSupabase({ doctorId, from: fromKey, to: toKey });
      usedSupabase = true;
    } catch (_) {
      rows = null;
    }
    if (!rows) {
      rows = await loadBlockedDates({ doctorId, from: fromKey, to: toKey });
      if (!usedSupabase && getSupabaseAdmin() && Array.isArray(rows) && rows.length) {
        try {
          for (const r of rows) {
            const d = r?.date || r?.available_date;
            if (!d) continue;
            await upsertBlockedDateSupabase({
              doctorId,
              date: String(d).slice(0, 10),
              startTime: r?.startTime || null,
              endTime: r?.endTime || null,
              reason: r?.reason || null
            });
          }
        } catch (_) {
        }
      }
    }
    res.json(
      (Array.isArray(rows) ? rows : []).map((row) => ({
        id: String(row.id),
        doctorId: String(row.doctorId || row.doctor_id || doctorId),
        mode,
        date: row.date || row.available_date,
        startTime: row.startTime || (row.start_time ? String(row.start_time).slice(0, 5) : null) || null,
        endTime: row.endTime || (row.end_time ? String(row.end_time).slice(0, 5) : null) || null,
        kind: 'block',
        note: row.reason || row.note || null
      }))
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/doctors/:doctorId/availability/exceptions', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const mode = String(req.body?.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const dateRaw = String(req.body?.date || '').trim();
    if (!dateRaw) return res.status(400).json({ message: 'date is required' });
    const dt = new Date(dateRaw);
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const dKey = dateKey(dt);

    const startTime = toTimeStr(req.body?.startTime) || null;
    const endTime = toTimeStr(req.body?.endTime) || null;
    const note = req.body?.note != null ? String(req.body.note).trim() : null;

    let supaRow = null;
    try {
      supaRow = await upsertBlockedDateSupabase({ doctorId, date: dKey, startTime, endTime, reason: note });
    } catch (e) {
      return res.status(500).json({ message: String(e?.message || 'Supabase sync failed') });
    }

    try {
      await ensureAvailabilityTablesOnce();
      await prisma.$queryRaw(
        Prisma.sql`
          INSERT INTO public.doctor_availability
            (doctor_id, available_date, start_time, end_time, is_available, reason, created_at, updated_at)
          VALUES
            (${String(doctorId)}::uuid, ${dKey}::date, ${startTime}::time, ${endTime}::time, false, ${note}, now(), now())
          ON CONFLICT (doctor_id, available_date)
          DO UPDATE SET
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            is_available = false,
            reason = EXCLUDED.reason,
            updated_at = now()
        `
      ).catch(() => {});
    } catch (_) {
    }

    const payload = supaRow
      ? {
          id: String(supaRow.id),
          doctorId: String(supaRow.doctor_id || doctorId),
          mode,
          date: supaRow.available_date || dKey,
          startTime: supaRow.start_time ? String(supaRow.start_time).slice(0, 5) : startTime,
          endTime: supaRow.end_time ? String(supaRow.end_time).slice(0, 5) : endTime,
          kind: 'block',
          note: supaRow.reason || note || null
        }
      : {
          id: '',
          doctorId,
          mode,
          date: dKey,
          startTime: startTime || null,
          endTime: endTime || null,
          kind: 'block',
          note: note || null
        };

    res.status(201).json(payload);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/availability/exceptions/bulk', requireRole(['admin']), async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const specialization = String(req.body?.specialization || req.body?.department || '').trim();
    if (!specialization) return res.status(400).json({ message: 'specialization is required' });

    const dateRaw = String(req.body?.date || '').trim();
    if (!dateRaw) return res.status(400).json({ message: 'date is required' });
    const dt = new Date(dateRaw);
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const dKey = dateKey(dt);

    const startTime = toTimeStr(req.body?.startTime) || null;
    const endTime = toTimeStr(req.body?.endTime) || null;
    const note = req.body?.note != null ? String(req.body.note).trim() : null;

    const doctors = await prisma.doctors
      .findMany({
        where: { specialization: { equals: specialization, mode: 'insensitive' } },
        select: { id: true }
      })
      .catch(() => []);
    const doctorIds = (Array.isArray(doctors) ? doctors : []).map((d) => String(d?.id || '').trim()).filter(Boolean);
    if (!doctorIds.length) return res.status(404).json({ message: `No doctors found for specialization: ${specialization}` });

    try {
      await upsertBlockedDatesSupabaseBulk({ doctorIds, date: dKey, startTime, endTime, reason: note });
    } catch (e) {
      return res.status(500).json({ message: String(e?.message || 'Supabase bulk sync failed') });
    }

    try {
      await ensureAvailabilityTablesOnce();
      const values = doctorIds.map((id) => Prisma.sql`(${String(id)}::uuid, ${dKey}::date, ${startTime}::time, ${endTime}::time, false, ${note}, now(), now())`);
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO public.doctor_availability
            (doctor_id, available_date, start_time, end_time, is_available, reason, created_at, updated_at)
          VALUES
            ${Prisma.join(values, Prisma.sql`, `)}
          ON CONFLICT (doctor_id, available_date)
          DO UPDATE SET
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            is_available = false,
            reason = EXCLUDED.reason,
            updated_at = now()
        `
      ).catch(() => {});
    } catch (_) {
    }

    res.status(201).json({ ok: true, mode, specialization, date: dKey, affectedDoctors: doctorIds.length });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/availability/exceptions/bulk', requireRole(['admin']), async (req, res) => {
  try {
    const mode = String(req.body?.mode || req.query?.mode || 'onsite').trim().toLowerCase() || 'onsite';
    const specialization = String(req.body?.specialization || req.body?.department || req.query?.specialization || req.query?.department || '').trim();
    if (!specialization) return res.status(400).json({ message: 'specialization is required' });

    const dateRaw = String(req.body?.date || req.query?.date || '').trim();
    if (!dateRaw) return res.status(400).json({ message: 'date is required' });
    const dt = new Date(dateRaw);
    if (Number.isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const dKey = dateKey(dt);

    const doctors = await prisma.doctors
      .findMany({
        where: { specialization: { equals: specialization, mode: 'insensitive' } },
        select: { id: true }
      })
      .catch(() => []);
    const doctorIds = (Array.isArray(doctors) ? doctors : []).map((d) => String(d?.id || '').trim()).filter(Boolean);
    if (!doctorIds.length) return res.status(404).json({ message: `No doctors found for specialization: ${specialization}` });

    try {
      await deleteBlockedDatesSupabaseBulk({ doctorIds, date: dKey });
    } catch (e) {
      return res.status(500).json({ message: String(e?.message || 'Supabase bulk delete failed') });
    }

    try {
      await ensureAvailabilityTablesOnce();
      await prisma.$executeRaw(
        Prisma.sql`
          DELETE FROM public.doctor_availability
          WHERE available_date = ${dKey}::date
            AND doctor_id IN (${Prisma.join(doctorIds.map((id) => Prisma.sql`${String(id)}::uuid`), Prisma.sql`, `)})
        `
      ).catch(() => {});
    } catch (_) {
    }

    res.json({ ok: true, mode, specialization, date: dKey, affectedDoctors: doctorIds.length });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/doctors/:doctorId/availability/exceptions/:id', requireRole(['doctor_secretary', 'admin', 'doctor']), async (req, res) => {
  try {
    const doctorId = String(req.params.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'Invalid doctorId' });
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    try {
      await deleteBlockedDateSupabase({ doctorId, id: idRaw });
    } catch (e) {
      return res.status(500).json({ message: String(e?.message || 'Supabase delete failed') });
    }

    try {
      await ensureAvailabilityTablesOnce();
      await prisma.$executeRaw(
        Prisma.sql`
          DELETE FROM public.doctor_availability
          WHERE id = ${BigInt(idRaw)}
            AND doctor_id = ${String(doctorId)}::uuid
        `
      );
    } catch (_) {
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/appointments/onsite', requireRole(['patient']), async (req, res) => {
  try {
    await ensureAvailabilityTablesOnce();
    const patient = await resolvePatientForRequest(req);
    const doctorId = String(req.body?.doctorId || '').trim();
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'doctorId is required' });

    const dateRaw = String(req.body?.date || '').trim();
    const timeRaw = String(req.body?.time || '').trim();
    const timePreferenceRaw = String(req.body?.timePreference || '').trim().toLowerCase();
    const dateObj = new Date(dateRaw);
    if (!dateRaw || Number.isNaN(dateObj.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const timeStr = toTimeStr(timeRaw);
    const timePreference = ['morning', 'afternoon', 'any'].includes(timePreferenceRaw) ? timePreferenceRaw : (timePreferenceRaw ? '' : 'any');
    if (timeRaw && !timeStr) return res.status(400).json({ message: 'Invalid time' });
    if (!timeStr && !timePreference) return res.status(400).json({ message: 'Invalid timePreference' });
    const blocked = await loadBlockedDates({ doctorId, from: dateKey(dateObj), to: dateKey(dateObj) });
    const dayBlocked = (Array.isArray(blocked) ? blocked : []).some((b) => !b?.startTime && !b?.endTime);
    if (dayBlocked) {
      return res.status(409).json({ message: 'Doctor is not available on this date.' });
    }

    const reasonBase = String(req.body?.reason || req.body?.serviceType || 'Onsite Consultation').trim();
    const prefLabel = timeStr
      ? null
      : (timePreference === 'morning' ? 'Morning' : timePreference === 'afternoon' ? 'Afternoon' : timePreference === 'any' ? 'Any time' : null);
    const reason = prefLabel ? `${reasonBase} (Preferred: ${prefLabel})` : reasonBase;
    const firstName = String(req.body?.firstName || '').trim() || null;
    const lastName = String(req.body?.lastName || '').trim() || null;
    const email = patient.email || null;
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;

    const rules = await loadRules({ doctorId, mode: 'onsite' });
    const dateWindows = await loadDateWindows({ doctorId, mode: 'onsite', from: dateKey(dateObj), to: dateKey(dateObj) });
    const dayOffs = await loadDayOffs({ doctorId, mode: 'onsite' });
    const exceptions = await loadExceptions({ doctorId, mode: 'onsite', from: dateKey(dateObj), to: dateKey(dateObj) });
    const combinedExceptions = [...(Array.isArray(exceptions) ? exceptions : []), ...(Array.isArray(blocked) ? blocked : [])];

    if (timeStr) {
      const appts = await prisma.appointments
        .findMany({
          where: {
            doctor_uuid: doctorId,
            consultation_mode: 'onsite',
            appointment_date: dateObj
          },
          select: { appointment_time: true, status: true }
        })
        .catch(() => []);

      const bookedByTime = new Map();
      for (const a of Array.isArray(appts) ? appts : []) {
        const st = String(a.status || '').trim().toLowerCase();
        if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
        const t = a.appointment_time ? new Date(a.appointment_time) : null;
        const time = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
        if (!time) continue;
        bookedByTime.set(time, (bookedByTime.get(time) || 0) + 1);
      }

      const slots = buildSlotListForDate({ date: dateObj, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime });
      const ok = slots.some((s) => s.time === timeStr);
      if (!ok) return res.status(409).json({ message: 'Selected slot is no longer available.' });
    } else {
      const slots = buildSlotListForDate({ date: dateObj, rules, dateWindows, dayOffs, exceptions: combinedExceptions, bookedByTime: new Map() });
      if (!slots.length) return res.status(409).json({ message: 'Doctor is not available on this date.' });
    }

    const doctor = await prisma.doctors.findUnique({ where: { id: doctorId }, select: { first_name: true, last_name: true } }).catch(() => null);
    const doctorLabel = doctor ? `Dr. ${String(doctor.first_name || '').trim()} ${String(doctor.last_name || '').trim()}`.trim() : null;

    let dummy = null;
    if (timeStr) {
      const [hh, mm] = timeStr.split(':').map((v) => parseInt(v, 10));
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      dummy = d;
    }

    const apt = await prisma.appointments.create({
      data: {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        reason,
        appointment_date: dateObj,
        appointment_time: dummy,
        doctor_id: doctorLabel,
        doctor_uuid: doctorId,
        patient_id: patient.id,
        consultation_mode: 'onsite',
        status: 'Pending'
      }
    });

    res.status(201).json({
      id: apt.id.toString(),
      doctorId,
      doctor: doctorLabel,
      date: dateKey(dateObj),
      time: timeStr || null,
      timePreference: timeStr ? null : (timePreference || null),
      status: apt.status
    });
  } catch (err) {
    const code = Number(err && err.statusCode) || 500;
    res.status(code).json({ message: String(err && err.message ? err.message : 'Server error') });
  }
});

module.exports = router;


