const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { createClient } = require('@supabase/supabase-js');

let supabaseAdmin = null;
function getSupabaseAdmin() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  if (!supabaseAdmin) supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  return supabaseAdmin;
}

function normalizeTimeToHHMM(value) {
  if (value == null) return '';
  if (value instanceof Date) {
    const hh = String(value.getHours()).padStart(2, '0');
    const mm = String(value.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeToMinutesLoose(value) {
  const t = normalizeTimeToHHMM(value);
  if (!t) return null;
  const [hh, mm] = t.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

async function loadDoctorAvailabilityBlocksSupabase({ doctorId, dateKey }) {
  const supa = getSupabaseAdmin();
  if (!supa) return null;
  const { data, error } = await supa
    .from('doctor_availability')
    .select('id, doctor_id, available_date, start_time, end_time, is_available')
    .eq('doctor_id', String(doctorId))
    .eq('available_date', String(dateKey))
    .eq('is_available', false);
  if (error) throw new Error(String(error.message || 'Supabase query failed'));
  const rows = Array.isArray(data) ? data : [];
  const dayBlocked = rows.some((r) => !r?.start_time && !r?.end_time);
  const ranges = rows
    .map((r) => {
      const s = timeToMinutesLoose(r?.start_time);
      const e = timeToMinutesLoose(r?.end_time);
      if (s === null || e === null) return null;
      if (e <= s) return null;
      return [s, e];
    })
    .filter(Boolean);
  return { dayBlocked, ranges };
}

function isMinutesBlockedByAvailability({ minutes, blocks }) {
  if (!blocks) return false;
  if (blocks.dayBlocked) return true;
  if (!Array.isArray(blocks.ranges) || !blocks.ranges.length) return false;
  for (const [s, e] of blocks.ranges) {
    if (minutes >= s && minutes < e) return true;
  }
  return false;
}

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_approval_requests (
      id BIGSERIAL PRIMARY KEY,
      patient_id UUID,
      patient_name TEXT,
      doctor_name TEXT,
      doctor_id UUID,
      nurse_name TEXT,
      requested_date DATE,
      requested_time TIME,
      service_type TEXT,
      service_category TEXT,
      department_key TEXT,
      service_name TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      suggested_date DATE,
      suggested_time TIME,
      suggested_note TEXT,
      appointment_id BIGINT,
      doctor_last_read_at TIMESTAMPTZ,
      nurse_last_read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS service_type TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS doctor_id uuid;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS service_category text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS department_key text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE appointment_approval_requests ADD COLUMN IF NOT EXISTS service_name text;`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS appointment_messages (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES appointment_approval_requests(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL,
      sender_name TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointment_approval_requests_doctor_status_idx ON appointment_approval_requests(doctor_name, status, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointment_approval_requests_nurse_status_idx ON appointment_approval_requests(nurse_name, status, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointment_messages_request_created_idx ON appointment_messages(request_id, created_at DESC);`);
}

ensureTables().catch(() => {});

router.use(requireRole(['doctor', 'nurse', 'admin', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']));

function inferRequester(req) {
  const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
  const name = String(req.headers['x-user-name'] || '').trim();
  const email = String(req.headers['x-user-email'] || '').trim();
  return { role: role || '', name: name || '', email: email || '' };
}

function timeToDateObj(hhmm) {
  if (!hhmm) return null;
  const parts = String(hhmm).split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function serializeRequestRow(r) {
  const id = r.id?.toString?.() ? r.id.toString() : String(r.id);
  const appointmentId = r.appointment_id !== null && r.appointment_id !== undefined
    ? (r.appointment_id?.toString?.() ? r.appointment_id.toString() : String(r.appointment_id))
    : null;
  return {
    id,
    sourceTable: 'appointment_approval_requests',
    patientId: r.patient_id || null,
    patientName: r.patient_name || null,
    doctorId: r.doctor_id || null,
    doctorName: r.doctor_name || null,
    nurseName: r.nurse_name || null,
    requestedDate: r.requested_date || null,
    requestedTime: r.requested_time || null,
    serviceType: r.service_type || null,
    serviceCategory: r.service_category || null,
    departmentKey: r.department_key || null,
    serviceName: r.service_name || null,
    reason: r.reason || null,
    status: r.status || 'Pending',
    suggestedDate: r.suggested_date || null,
    suggestedTime: r.suggested_time || null,
    suggestedNote: r.suggested_note || null,
    appointmentId,
    doctorLastReadAt: r.doctor_last_read_at || null,
    nurseLastReadAt: r.nurse_last_read_at || null,
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null
  };
}

function inferRoutingFields(r) {
  const rawServiceType = String(r?.service_type || '').trim();
  const rawReason = String(r?.reason || '').trim();
  const stripTag = (s) => String(s || '').replace(/^\[[^\]]*\]\s*/i, '').trim();
  const cleanedReason = stripTag(rawReason);
  const head = stripTag(rawServiceType || (cleanedReason.includes(':') ? cleanedReason.split(':')[0].trim() : cleanedReason));
  const name = rawReason.includes(':') ? rawReason.split(':').slice(1).join(':').trim() : '';
  const headKey = normalizeServiceKey(head).toLowerCase();

  const pick = (departmentKey, serviceCategory) => ({
    departmentKey,
    serviceCategory,
    serviceName: name || null
  });

  if (headKey.includes('video')) return pick('video', 'Video');
  if (headKey.includes('laboratory') || headKey === 'lab') return pick('laboratory', 'Lab');
  if (headKey.includes('radiology') || headKey.includes('x-ray') || headKey.includes('xray')) return pick('radiology', 'Radiology');
  if (headKey.includes('ecg')) return pick('ecg', 'ECG');
  if (headKey.includes('physical therapy') || headKey.includes('pt')) return pick('physical_therapy', 'PT');
  if (headKey.includes('dental')) return pick('dental', 'Consultation');
  if (headKey.includes('surgery')) return pick('surgery_minor', 'Consultation');
  return pick(headKey || null, 'Consultation');
}

function serializeMessageRow(m) {
  return {
    id: m.id?.toString?.() ? m.id.toString() : String(m.id),
    requestId: m.request_id?.toString?.() ? m.request_id.toString() : String(m.request_id),
    senderRole: m.sender_role,
    senderName: m.sender_name || null,
    body: m.body,
    createdAt: m.created_at
  };
}

function inferServiceType(r) {
  const stripTag = (s) => String(s || '').replace(/^\[[^\]]*\]\s*/i, '').trim();
  const direct = stripTag(String(r?.service_type || '').trim());
  if (direct) return direct;
  const reason = stripTag(String(r?.reason || '').trim());
  if (!reason) return '';
  const idx = reason.indexOf(':');
  if (idx > 0) return reason.slice(0, idx).trim();
  return reason;
}

function normalizeServiceKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function inferServiceKey(r) {
  return normalizeServiceKey(inferServiceType(r));
}

function parseServiceFromReason(reason) {
  const raw = String(reason || '').trim();
  if (!raw) return { category: '', service: '' };
  const idx = raw.indexOf(':');
  if (idx < 0) return { category: raw, service: '' };
  return {
    category: raw.slice(0, idx).trim(),
    service: raw.slice(idx + 1).trim()
  };
}

const ROLE_SERVICE_KEYS = {
  medtech: ['laboratory'],
  radiographer: ['radiology'],
  ecg_operator: ['ecg'],
  physical_therapist: ['physical therapy']
};

function inferConsultationMode(reqRow) {
  const direct = String(reqRow?.consultation_mode || reqRow?.consultationMode || '').trim().toLowerCase();
  if (direct === 'video' || direct === 'onsite') return direct;
  const k = inferServiceKey(reqRow);
  if (k.includes('video') || k.startsWith('teleconsult')) return 'video';
  const dept = String(reqRow?.department_key || '').trim().toLowerCase();
  if (dept === 'video') return 'video';
  const reason = String(reqRow?.reason || '').trim().toLowerCase();
  if (reason.includes('(online)') || reason.startsWith('video:') || reason.includes('video consultation')) return 'video';
  return 'onsite';
}

async function resolvePatientForRequestRow(requestRow) {
  let patientId = requestRow.patient_id || null;
  let patientName = String(requestRow.patient_name || '').trim();
  let firstName = '';
  let lastName = '';
  let email = requestRow?.email ? String(requestRow.email).trim() : null;
  let phone = null;
  let dateOfBirth = null;

  if (patientId) {
    const p = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
    if (p) {
      firstName = p.first_name || '';
      lastName = p.last_name || '';
      email = p.email || email || null;
      phone = p.contact_number || null;
      dateOfBirth = p.date_of_birth || null;
      if (!patientName) patientName = `${firstName} ${lastName}`.trim();
    }
  }

  if (!firstName || !lastName) {
    const parts = patientName.split(' ').filter(Boolean);
    firstName = firstName || parts.slice(0, 1).join(' ') || patientName || 'Patient';
    lastName = lastName || parts.slice(1).join(' ') || 'Unknown';
  }

  if (!patientId) {
    let found = null;
    if (email) {
      found = await prisma.patients.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        orderBy: { created_at: 'desc' }
      }).catch(() => null);
    }
    if (!found) {
      found = await prisma.patients.findFirst({
        where: { first_name: firstName, last_name: lastName },
        orderBy: { created_at: 'desc' }
      }).catch(() => null);
    }

    if (found) {
      patientId = found.id;
      email = found.email || email || null;
      phone = phone || found.contact_number || null;
      dateOfBirth = dateOfBirth || found.date_of_birth || null;
    } else {
      const created = await prisma.patients.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          ...(email ? { email } : {}),
          ...(phone ? { contact_number: phone } : {}),
          ...(dateOfBirth ? { date_of_birth: new Date(dateOfBirth) } : {})
        }
      });
      patientId = created.id;
    }
  }

  return { patientId, patientName: patientName || `${firstName} ${lastName}`.trim(), firstName, lastName, email, phone, dateOfBirth };
}

async function resolveSecretaryLinkedDoctor(hdr) {
  if (!hdr?.email) {
    throw new Error('Unauthorized');
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS linked_doctor_id uuid;`).catch(() => {});
  const linkRows = await prisma.$queryRawUnsafe(
    `SELECT linked_doctor_id FROM accounts WHERE lower(coalesce(email, '')) = lower($1) LIMIT 1`,
    hdr.email
  ).catch(() => []);
  const linkRow = Array.isArray(linkRows) ? linkRows[0] : null;
  const linked = linkRow?.linked_doctor_id ? String(linkRow.linked_doctor_id) : '';
  if (!linked) {
    throw new Error('Your account is not linked to a doctor yet. Please ask admin to set the linked doctor.');
  }

  const doc = await prisma.doctors.findUnique({
    where: { id: linked },
    select: { first_name: true, last_name: true }
  }).catch(() => null);
  if (!doc) {
    throw new Error('Linked doctor not found. Please ask admin to re-link.');
  }

  return {
    doctorUuid: linked,
    doctorName: `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim()
  };
}

async function createAppointmentFromSecretaryApproval({ id, hdr, requestRow, secretaryName, department, overriddenDoctorId }) {
  if (department) {
    const reqService = inferServiceKey(requestRow);
    const deptKey = normalizeServiceKey(department);
    if (reqService && deptKey && reqService !== deptKey) {
      throw new Error('Forbidden: service type mismatch.');
    }
  }

  if (String(requestRow.status || '') === 'Rejected') {
    throw new Error('Request cannot be finalized in current status.');
  }

  if (requestRow.appointment_id) {
    return requestRow;
  }

  const overriddenClean = overriddenDoctorId && isUuid(overriddenDoctorId) ? String(overriddenDoctorId).toLowerCase() : null;
  let doctorUuid;
  let doctorName;
  if (overriddenClean) {
    doctorUuid = overriddenClean;
    const doc = await prisma.doctors.findUnique({ where: { id: overriddenClean } }).catch(() => null);
    if (doc) {
      doctorName = `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
    } else {
      doctorName = requestRow.doctor_name ? String(requestRow.doctor_name).trim() : '';
    }
  } else {
    const resolved = await resolveSecretaryLinkedDoctor(hdr);
    doctorUuid = resolved.doctorUuid;
    doctorName = resolved.doctorName;
  }

  const reqDoctorId = requestRow?.doctor_id ? String(requestRow.doctor_id) : '';
  if (reqDoctorId && doctorUuid && reqDoctorId !== doctorUuid) {
    throw new Error('Forbidden');
  }

  const apptDate = requestRow.requested_date ? new Date(requestRow.requested_date) : null;
  const apptTime = requestRow.requested_time ? new Date(requestRow.requested_time) : null;
  if (!apptDate || !apptTime) {
    throw new Error('Missing requested schedule.');
  }

  const patient = await resolvePatientForRequestRow(requestRow);
  const consultationMode = inferConsultationMode(requestRow);
  const modeKey = String(consultationMode || '').trim().toLowerCase() || 'onsite';
  if (modeKey === 'onsite' && doctorUuid) {
    const dateKey = apptDate.toISOString().slice(0, 10);
    const minutes = timeToMinutesLoose(apptTime);
    if (minutes !== null) {
      let blocks = null;
      try {
        blocks = await loadDoctorAvailabilityBlocksSupabase({ doctorId: doctorUuid, dateKey });
      } catch (_) {
        blocks = null;
      }
      if (blocks?.dayBlocked || (blocks && isMinutesBlockedByAvailability({ minutes, blocks }))) {
        const err = new Error(blocks?.dayBlocked ? 'Doctor is not available on this date.' : 'Selected time is not available.');
        err.statusCode = 409;
        throw err;
      }
    }
  }
  const effectiveEmail = patient.email || (requestRow?.email ? String(requestRow.email).trim() : null) || null;
  if (patient.patientId && effectiveEmail) {
    prisma.patients.update({ where: { id: patient.patientId }, data: { email: effectiveEmail } }).catch(() => {});
  }

  const appt = await prisma.appointments.create({
    data: {
      first_name: patient.firstName || null,
      last_name: patient.lastName || null,
      email: effectiveEmail,
      phone: patient.phone || null,
      date_of_birth: patient.dateOfBirth ? new Date(patient.dateOfBirth) : null,
      reason: requestRow.service_type || requestRow.reason || 'Appointment',
      appointment_date: apptDate,
      appointment_time: apptTime,
      doctor_id: doctorName,
      doctor_uuid: doctorUuid || null,
      patient_id: patient.patientId,
      consultation_mode: consultationMode,
      status: 'Confirmed'
    }
  });

  const updatedRows = await prisma.$queryRaw`
    UPDATE appointment_approval_requests
    SET status = 'Approved',
        doctor_name = ${doctorName},
        doctor_id = COALESCE(doctor_id, ${doctorUuid || null}::uuid),
        appointment_id = ${appt.id},
        patient_id = COALESCE(patient_id, ${patient.patientId}::uuid),
        nurse_last_read_at = now(),
        updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;

  const msgBody = `Approved and forwarded to doctor by ${secretaryName || 'Doctor Secretary'}`;
  await prisma.$queryRaw`
    INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
    VALUES (${id}, 'doctor_secretary', ${secretaryName}, ${msgBody}, now())
  `;

  const patientMsg = `Your appointment request is confirmed. Please proceed to the hospital on your scheduled date/time.`;
  await prisma.$queryRaw`
    INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
    VALUES (${id}, 'system', 'Hospital Services', ${patientMsg}, now())
  `;

  prisma.activity_logs.create({
    data: {
      actor_name: secretaryName,
      role: 'Doctor Secretary',
      action: 'Create',
      target: `Appointment:${appt.id.toString()}`,
      details: `Finalized appointment for ${patient.firstName || ''} ${patient.lastName || ''}`.trim()
    }
  }).catch(() => {});

  return updated;
}

router.get('/inbox', async (req, res) => {
  try {
    const hdr = inferRequester(req);
    const role = String(req.query.role || hdr.role || '').trim().toLowerCase();
    const name = String(req.query.name || hdr.name || '').trim();
    const doctorId = String(req.query.doctorId || '').trim();
    const department = String(req.query.department || req.query.serviceType || '').trim();
    const take = Math.min(Math.max(Number(req.query.take || 50) || 50, 1), 200);
    const status = String(req.query.status || '').trim();

    const normalizeLooseKey = (v) =>
      String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const isGenericDoctorName = (v) => {
      const k = normalizeLooseKey(v);
      return !k || k === 'doctor' || k === 'dr' || k === 'dr.' || k === 'unknown' || k === 'n/a' || k === 'na';
    };

    const allowedRoles = new Set(['doctor', 'nurse', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']);
    if (!allowedRoles.has(role)) return res.status(400).json({ message: 'Unsupported role' });
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== role) return res.status(403).json({ message: 'Forbidden' });
    if (role === 'doctor' && !name && !doctorId) return res.status(400).json({ message: 'doctorId or name is required' });
    if (role === 'nurse' && !name && !department) return res.status(400).json({ message: 'name or department is required' });
    if (role === 'doctor_secretary' && !hdr.email && !(hdr.role === 'admin' && doctorId)) return res.status(400).json({ message: 'email is required' });

    const filterField = role === 'doctor' ? 'doctor_name' : 'nurse_name';
    const readField = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';

    const params = [];
    let i = 1;
    let where = '';
    let doctorSecretaryCtx = null;

    if (role === 'doctor_secretary') {
      let linked = '';
      let linkedName = '';
      let linkedSpecialization = '';
      let linkedSpecializationVariants = [];
      if (hdr.role === 'admin' && doctorId) {
        linked = doctorId;
      } else {
        await prisma.$executeRawUnsafe(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS linked_doctor_id uuid;`).catch(() => {});
        const linkedHeader = String(req.headers['x-linked-doctor-id'] || '').trim();
        if (linkedHeader) {
          linked = linkedHeader;
        } else {
          const linkRows = await prisma.$queryRawUnsafe(
            `SELECT linked_doctor_id FROM accounts WHERE lower(coalesce(email, '')) = lower($1) LIMIT 1`,
            hdr.email
          ).catch(() => []);
          const linkRow = Array.isArray(linkRows) ? linkRows[0] : null;
          linked = linkRow?.linked_doctor_id ? String(linkRow.linked_doctor_id) : '';
        }
      }
      if (!linked) return res.status(400).json({ message: 'Your account is not linked to a doctor yet. Please ask admin to set the linked doctor.' });
      const doc = await prisma.doctors.findUnique({ where: { id: linked }, select: { first_name: true, last_name: true, specialization: true } }).catch(() => null);
      if (doc) {
        linkedName = `${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
        linkedSpecialization = String(doc.specialization || '').trim();
      }
      {
        const base = String(linkedSpecialization || '').trim();
        const lower = base.toLowerCase();
        const variants = [base].filter(Boolean);
        if (lower.includes('pediatrics') && !variants.some((v) => String(v).toLowerCase() === 'pedia')) variants.push('Pedia');
        if (lower.includes('otolaryngology') && !variants.some((v) => String(v).toLowerCase() === 'ent')) variants.push('ENT');
        if ((lower.includes('obstetrics') || lower.includes('gynecology')) && !variants.some((v) => String(v).toLowerCase() === 'obgyn')) variants.push('OBGYN');
        if (lower.includes('orthopedics') && !variants.some((v) => String(v).toLowerCase() === 'ortho')) variants.push('Ortho');
        if (lower.includes('ophthalmology') && !variants.some((v) => String(v).toLowerCase() === 'optha')) variants.push('Optha');
        linkedSpecializationVariants = variants.filter(Boolean);
      }
      doctorSecretaryCtx = { linked, linkedName, linkedSpecialization, linkedSpecializationVariants };

      const categoryExpr = `lower(coalesce(nullif(r.service_category, ''), ''))`;
      const serviceExpr = `
        lower(
          coalesce(
            nullif(regexp_replace(coalesce(r.department_key, ''), '^\\[[^\\]]*\\]\\s*', ''), ''),
            nullif(regexp_replace(coalesce(r.service_type, ''), '^\\[[^\\]]*\\]\\s*', ''), ''),
            nullif(regexp_replace(split_part(coalesce(r.reason, ''), ':', 1), '^\\[[^\\]]*\\]\\s*', ''), '')
          )
        )
      `.trim();
      const consultClause = `(
        ${categoryExpr} = 'consultation'
        OR (${categoryExpr} = '' AND ${serviceExpr} NOT IN ('laboratory','radiology','ecg','physical therapy','video consultation'))
      )`;

      const specStart = i + (linkedName ? 2 : 1);
      const unassignedDoctorNameSql = `lower(trim(coalesce(r.doctor_name,''))) IN ('','doctor','dr','dr.','unknown','n/a','na')`;
      const specializationMatchClause = linkedSpecializationVariants.length
        ? `OR (coalesce(r.doctor_id::text,'') = '' AND ${unassignedDoctorNameSql} AND (${linkedSpecializationVariants
            .map((_, idx) => `(${serviceExpr} LIKE '%' || lower($${specStart + idx}) || '%' OR lower($${specStart + idx}) LIKE '%' || ${serviceExpr} || '%')`)
            .join(' OR ')}))`
        : '';

      where = `
        WHERE ${consultClause}
          AND (
            r.doctor_id = $${i}::uuid
            ${linkedName ? `OR regexp_replace(regexp_replace(lower(coalesce(r.doctor_name, '')), '^(dr\\.?\\s*)', ''), '\\s+', ' ', 'g')
                = regexp_replace(regexp_replace(lower($${i + 1}), '^(dr\\.?\\s*)', ''), '\\s+', ' ', 'g')` : ''}
            ${specializationMatchClause}
          )
      `;
      params.push(linked);
      i += 1;
      if (linkedName) {
        params.push(linkedName);
        i += 1;
      }
      if (linkedSpecializationVariants.length) {
        params.push(...linkedSpecializationVariants);
        i += linkedSpecializationVariants.length;
      }
    } else
    if (role === 'doctor' && doctorId) {
      where = `
        WHERE (
          r.doctor_id = $${i}::uuid
          ${name ? `OR regexp_replace(regexp_replace(lower(coalesce(r.doctor_name, '')), '^(dr\\.?\\s*)', ''), '\\s+', ' ', 'g')
              = regexp_replace(regexp_replace(lower($${i + 1}), '^(dr\\.?\\s*)', ''), '\\s+', ' ', 'g')` : ''}
        )
      `;
      params.push(doctorId);
      i += 1;
      if (name) {
        params.push(name);
        i += 1;
      }
    } else
    if ((role === 'nurse' && department) || ROLE_SERVICE_KEYS[role]) {
      const deptNorm = String(department || '').trim().toLowerCase();
      const serviceExpr = `
        lower(
          coalesce(
            nullif(r.department_key, ''),
            nullif(r.service_type, ''),
            nullif(split_part(coalesce(r.reason, ''), ':', 1), '')
          )
        )
      `.trim();

      const allowed = (() => {
        if (role === 'nurse') {
          if (deptNorm === 'er' || deptNorm === 'emergency' || deptNorm === 'emergency room') {
            return ['ER', 'Emergency', 'Emergency Room', 'Surgery', 'Surgery (Minor)', 'Surgery_Minor', 'Minor Surgery'];
          }
          return [department];
        }
        if (ROLE_SERVICE_KEYS[role]) {
          return ROLE_SERVICE_KEYS[role];
        }
        return [department];
      })();

      const clause = allowed.map((_, idx) => `${serviceExpr} = lower($${i + idx})`).join(' OR ');
      where = `
        WHERE (${clause})
      `;
      params.push(...allowed);
      i += allowed.length;
    } else {
      where = `
        WHERE regexp_replace(regexp_replace(lower(coalesce(r.${filterField}, '')), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
            = regexp_replace(regexp_replace(lower($${i}), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
      `;
      params.push(name);
      i += 1;
    }

    const otherRoleParam = `$${i}`;
    params.push(role);
    i += 1;

    let statusClause = '';
    if (status) {
      statusClause = `AND r.status = $${i}`;
      params.push(status);
      i += 1;
    }

    const rows = await prisma.$queryRawUnsafe(
      `
        WITH base AS (
          SELECT r.*
          FROM appointment_approval_requests r
          ${where}
          ${statusClause}
          ORDER BY r.updated_at DESC, r.created_at DESC
          LIMIT ${take}
        ),
        last_msg AS (
          SELECT DISTINCT ON (m.request_id) m.request_id, m.body, m.created_at
          FROM appointment_messages m
          JOIN base b ON b.id = m.request_id
          ORDER BY m.request_id, m.created_at DESC
        ),
        unread AS (
          SELECT b.id AS request_id, COUNT(*)::int AS unread_count
          FROM base b
          JOIN appointment_messages m ON m.request_id = b.id
          WHERE m.created_at > COALESCE(b.${readField}, to_timestamp(0))
            AND m.sender_role <> ${otherRoleParam}
          GROUP BY b.id
        )
        SELECT
          b.*,
          lm.body AS last_body,
          lm.created_at AS last_at,
          COALESCE(u.unread_count, 0) AS unread_count
        FROM base b
        LEFT JOIN last_msg lm ON lm.request_id = b.id
        LEFT JOIN unread u ON u.request_id = b.id
        ORDER BY COALESCE(lm.created_at, b.created_at) DESC
      `,
      ...params
    );

    const baseRows = Array.isArray(rows) ? rows : [];

    const normalizeKey = (v) =>
      String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const stripPrefixTag = (s) => String(s || '').replace(/^\[[^\]]*\]\s*/i, '').trim();
    const getHeadServiceKey = (r) => {
      const direct = String(r?.department_key || r?.service_type || '').trim();
      const raw = direct || String(r?.reason || '').trim();
      const cleaned = stripPrefixTag(raw);
      const idx = cleaned.indexOf(':');
      const head = idx > 0 ? cleaned.slice(0, idx).trim() : cleaned;
      return normalizeKey(head);
    };

    if (role === 'doctor_secretary' && doctorSecretaryCtx?.linked) {
      const variants = Array.isArray(doctorSecretaryCtx.linkedSpecializationVariants) && doctorSecretaryCtx.linkedSpecializationVariants.length
        ? doctorSecretaryCtx.linkedSpecializationVariants
        : [doctorSecretaryCtx.linkedSpecialization].filter(Boolean);
      const specKeys = variants.map((v) => normalizeKey(v)).filter(Boolean);
      for (const r of baseRows) {
        const hasDoctorId = Boolean(r?.doctor_id);
        const hasDoctorName = !isGenericDoctorName(r?.doctor_name);
        if (hasDoctorId || hasDoctorName) continue;
        if (!specKeys.length) continue;
        const headKey = getHeadServiceKey(r);
        const exact = headKey && specKeys.includes(headKey);
        const loose =
          !exact &&
          headKey &&
          specKeys.some((sk) => (headKey.includes(sk) || sk.includes(headKey)) && Math.min(headKey.length, sk.length) >= 4);
        if (!exact && !loose) continue;

        const rid = r.id?.toString?.() ? r.id.toString() : String(r.id);
        const docDisplay = doctorSecretaryCtx.linkedName ? `Dr. ${doctorSecretaryCtx.linkedName}` : null;
        await prisma.$queryRawUnsafe(
          `
            UPDATE appointment_approval_requests
            SET doctor_id = $1::uuid,
                doctor_name = CASE
                  WHEN lower(trim(coalesce(doctor_name,''))) IN ('','doctor','dr','dr.','unknown','n/a','na') THEN $2
                  ELSE doctor_name
                END,
                updated_at = updated_at
            WHERE id = $3
              AND doctor_id IS NULL
              AND lower(trim(coalesce(doctor_name,''))) IN ('','doctor','dr','dr.','unknown','n/a','na')
          `,
          doctorSecretaryCtx.linked,
          docDisplay,
          BigInt(rid)
        ).catch(() => {});
        r.doctor_id = r.doctor_id || doctorSecretaryCtx.linked;
        r.doctor_name = r.doctor_name || docDisplay;
      }
    }

    for (const r of baseRows) {
      const hasDept = String(r?.department_key || '').trim();
      const hasCat = String(r?.service_category || '').trim();
      const deptLooksTagged = hasDept && hasDept.toLowerCase().startsWith('[triage');
      if (hasDept && hasCat && !deptLooksTagged) continue;
      const inferred = inferRoutingFields(r);
      const deptKey = String(inferred.departmentKey || '').trim();
      const cat = String(inferred.serviceCategory || '').trim();
      const svcName = inferred.serviceName ? String(inferred.serviceName) : null;
      if (!deptKey && !cat && !svcName) continue;
      const rid = r.id?.toString?.() ? r.id.toString() : String(r.id);
      await prisma.$queryRawUnsafe(
        `
          UPDATE appointment_approval_requests
          SET department_key = CASE
                WHEN department_key IS NULL THEN $1
                WHEN trim(department_key) = '' THEN $1
                WHEN lower(trim(department_key)) LIKE '[triage%' THEN $1
                ELSE department_key
              END,
              service_category = COALESCE(NULLIF(service_category,''), $2),
              service_name = COALESCE(NULLIF(service_name,''), $3),
              updated_at = updated_at
          WHERE id = $4
        `,
        deptKey || null,
        cat || null,
        svcName,
        BigInt(rid)
      ).catch(() => {});
      if (!String(r.department_key || '').trim() || String(r.department_key || '').trim().toLowerCase().startsWith('[triage')) {
        r.department_key = deptKey || null;
      }
      r.service_category = r.service_category || cat || null;
      r.service_name = r.service_name || svcName || null;
    }

    let filteredRows = baseRows;
    if (role === 'doctor_secretary' && doctorSecretaryCtx?.linked) {
      const variants = Array.isArray(doctorSecretaryCtx.linkedSpecializationVariants) && doctorSecretaryCtx.linkedSpecializationVariants.length
        ? doctorSecretaryCtx.linkedSpecializationVariants
        : [doctorSecretaryCtx.linkedSpecialization].filter(Boolean);
      const specKeys = variants
        .map((v) => normalizeKey(v))
        .filter(Boolean);
      filteredRows = baseRows.filter((r) => {
        const reqDoctorId = r?.doctor_id ? String(r.doctor_id) : '';
        if (reqDoctorId && reqDoctorId === doctorSecretaryCtx.linked) return true;

        const hasDoctorName = !isGenericDoctorName(r?.doctor_name);
        if (hasDoctorName) return false;

        if (!specKeys.length) return false;
        const headKey = getHeadServiceKey(r);
        if (!headKey) return false;
        return specKeys.some((sk) => (headKey.includes(sk) || sk.includes(headKey)) && Math.min(headKey.length, sk.length) >= 4);
      });
    }

    const list = filteredRows.map((r) => ({
      ...serializeRequestRow(r),
      lastMessage: r.last_body || '',
      lastAt: r.last_at || r.updated_at || r.created_at,
      unreadCount: Number(r.unread_count || 0) || 0
    }));

    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/cleanup-demo', async (req, res) => {
  try {
    const nurseName = String(req.query.nurseName || '').trim();
    const confirm = String(req.query.confirm || '').trim().toUpperCase();

    if (!nurseName) return res.status(400).json({ message: 'nurseName is required' });
    if (confirm !== 'YES') {
      return res.status(400).json({ message: 'Add ?confirm=YES to run cleanup.' });
    }

    const ip = String(req.ip || '');
    const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1');
    if (!isLocal) {
      return res.status(403).json({ message: 'Cleanup endpoint is only available locally.' });
    }

    const reqs = await prisma.$queryRawUnsafe(
      `SELECT id, appointment_id FROM appointment_approval_requests WHERE lower(coalesce(nurse_name,'')) = lower($1)`,
      nurseName
    );
    const reqIds = (Array.isArray(reqs) ? reqs : []).map((r) => r.id);
    const apptIds = (Array.isArray(reqs) ? reqs : []).map((r) => r.appointment_id).filter(Boolean);

    let deletedAppointments = 0;
    for (const aid of apptIds) {
      try {
        await prisma.appointments.delete({ where: { id: BigInt(aid) } });
        deletedAppointments += 1;
      } catch (_) {}
    }

    const deletedMessages = await prisma.$executeRawUnsafe(
      `DELETE FROM appointment_messages WHERE lower(coalesce(sender_name,'')) = lower($1)`,
      nurseName
    );
    const deletedRequests = await prisma.$executeRawUnsafe(
      `DELETE FROM appointment_approval_requests WHERE lower(coalesce(nurse_name,'')) = lower($1)`,
      nurseName
    );
    const deletedActivity = await prisma.activity_logs.deleteMany({ where: { actor_name: nurseName } }).catch(() => ({ count: 0 }));

    res.json({
      nurseName,
      requestIds: reqIds.map((v) => v.toString()),
      deletedAppointments,
      deletedMessages,
      deletedRequests,
      deletedActivityLogs: deletedActivity.count
    });
  } catch (err) {
    res.status(Number(err?.statusCode) || 400).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const rows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return res.status(404).json({ message: 'Request not found' });
    res.json(serializeRequestRow(r));
  } catch (err) {
    res.status(Number(err?.statusCode) || 400).json({ message: err.message });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const hdr = inferRequester(req);
    const role = String(req.query.role || hdr.role || '').trim().toLowerCase();
    const name = String(req.query.name || hdr.name || '').trim();

    if (role !== 'doctor' && role !== 'nurse') return res.status(400).json({ message: 'role must be doctor or nurse' });
    if (!name) return res.status(400).json({ message: 'name is required' });
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== role) return res.status(403).json({ message: 'Forbidden' });

    const reqRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const requestRow = Array.isArray(reqRows) ? reqRows[0] : null;
    if (!requestRow) return res.status(404).json({ message: 'Request not found' });

    const field = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';
    await prisma.$executeRawUnsafe(`UPDATE appointment_approval_requests SET ${field} = now(), updated_at = now() WHERE id = $1`, id);

    const msgRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_messages
      WHERE request_id = ${id}
      ORDER BY created_at ASC
    `;

    res.json({
      request: serializeRequestRow(requestRow),
      messages: (Array.isArray(msgRows) ? msgRows : []).map(serializeMessageRow)
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const hdr = inferRequester(req);
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== 'nurse') return res.status(403).json({ message: 'Forbidden' });
    const nurseName = String(req.body.nurseName || '').trim();
    const doctorName = String(req.body.doctorName || '').trim();
    const patientId = req.body.patientId ? String(req.body.patientId).trim() : null;
    let patientName = String(req.body.patientName || '').trim();
    const serviceType = String(req.body.serviceType || req.body.service_type || '').trim() || null;
    const requestedDate = req.body.requestedDate ? new Date(req.body.requestedDate) : null;
    const requestedTime = req.body.requestedTime ? timeToDateObj(req.body.requestedTime) : null;
    const reason = String(req.body.reason || '').trim();
    const firstMessage = String(req.body.message || reason || '').trim();

    if (!nurseName) return res.status(400).json({ message: 'nurseName is required' });
    if (!doctorName) return res.status(400).json({ message: 'doctorName is required' });
    if (!patientId && !patientName) return res.status(400).json({ message: 'patientId or patientName is required' });
    if (!requestedDate) return res.status(400).json({ message: 'requestedDate is required' });
    if (!requestedTime) return res.status(400).json({ message: 'requestedTime is required' });
    if (!firstMessage) return res.status(400).json({ message: 'message or reason is required' });

    if (patientId && !patientName) {
      const p = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
      if (p) patientName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    }

    const rows = await prisma.$queryRawUnsafe(
      `
        INSERT INTO appointment_approval_requests (
          patient_id, patient_name, doctor_name, nurse_name, requested_date, requested_time,
          service_type, reason, status, nurse_last_read_at, created_at, updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6,
          $7, $8, 'Pending', now(), now(), now()
        )
        RETURNING *
      `,
      patientId,
      patientName || null,
      doctorName,
      nurseName,
      requestedDate,
      requestedTime,
      serviceType,
      reason || null
    );
    const created = Array.isArray(rows) ? rows[0] : rows;

    await prisma.$queryRaw`
      INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
      VALUES (${created.id}, 'nurse', ${nurseName}, ${firstMessage}, now())
    `;

    prisma.activity_logs.create({
      data: {
        actor_name: nurseName,
        role: 'Nurse',
        action: 'Create',
        target: `AppointmentApproval:${created.id.toString()}`,
        details: `Requested appointment approval with Dr. ${doctorName}`
      }
    }).catch(() => {});

    res.status(201).json(serializeRequestRow(created));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const hdr = inferRequester(req);
    const senderRole = String(req.body.senderRole || '').trim().toLowerCase();
    const senderName = String(req.body.senderName || '').trim() || null;
    const body = String(req.body.body || '').trim();

    if (senderRole !== 'doctor' && senderRole !== 'nurse') return res.status(400).json({ message: 'senderRole must be doctor or nurse' });
    if (!body) return res.status(400).json({ message: 'body is required' });
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== senderRole) return res.status(403).json({ message: 'Forbidden' });

    const reqRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const requestRow = Array.isArray(reqRows) ? reqRows[0] : null;
    if (!requestRow) return res.status(404).json({ message: 'Request not found' });

    const rows = await prisma.$queryRaw`
      INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
      VALUES (${id}, ${senderRole}, ${senderName}, ${body}, now())
      RETURNING *
    `;
    const created = Array.isArray(rows) ? rows[0] : rows;

    const updateField = senderRole === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';
    await prisma.$executeRawUnsafe(`UPDATE appointment_approval_requests SET ${updateField} = now(), updated_at = now() WHERE id = $1`, id);

    prisma.activity_logs.create({
      data: {
        actor_name: senderName,
        role: senderRole === 'doctor' ? 'Doctor' : 'Nurse',
        action: 'Message',
        target: `AppointmentApproval:${id.toString()}`,
        details: body.length > 180 ? `${body.slice(0, 180)}…` : body
      }
    }).catch(() => {});

    res.status(201).json(serializeMessageRow(created));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const idStr = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idStr)) return res.status(400).json({ message: 'Invalid request id.' });
    const id = BigInt(idStr);
    const hdr = inferRequester(req);
    const status = String(req.body.status || '').trim();
    const actor = String(req.body.actor || '').trim();
    const role = String(req.body.role || hdr.role || 'nurse').trim().toLowerCase();
    const department = String(req.body.department || req.body.serviceType || '').trim();
    const suggestedDate = req.body.suggestedDate ? new Date(req.body.suggestedDate) : null;
    const suggestedTime = req.body.suggestedTime ? timeToDateObj(req.body.suggestedTime) : null;
    const noteRaw = String(req.body.note || '').trim();
    const note = noteRaw || null;
    if (!status) return res.status(400).json({ message: 'status cannot be empty.' });

    if (status === 'Suggested') {
      if (!suggestedDate || Number.isNaN(suggestedDate.getTime())) {
        return res.status(400).json({ message: 'suggestedDate is required when status=Suggested.' });
      }
    }
    if (status === 'Rejected' && !note) {
      // ok (note optional by schema default); guard length if present:
    }
    if (note && note.length > 2000) {
      return res.status(400).json({ message: 'note cannot exceed 2000 characters.' });
    }

    const reqRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const requestRow = Array.isArray(reqRows) ? reqRows[0] : null;
    if (!requestRow) return res.status(404).json({ message: 'Request not found' });

    if (department) {
      const reqService = inferServiceKey(requestRow);
      const deptKey = normalizeServiceKey(department);
      if (reqService && deptKey && reqService !== deptKey) {
        return res.status(403).json({ message: 'Forbidden: service type mismatch.' });
      }
    }

    const currentStatus = String(requestRow.status || '');
    if (currentStatus === 'Approved' || currentStatus === 'Rejected') {
      return res.status(409).json({ message: 'Request already closed.' });
    }

    if (status !== 'Approved' && status !== 'Rejected' && status !== 'Suggested') {
      return res.status(400).json({ message: 'status must be Approved, Rejected, or Suggested' });
    }

    if (hdr.role && hdr.role !== 'admin' && hdr.role !== role) return res.status(403).json({ message: 'Forbidden' });

    if (role === 'doctor_secretary' && hdr.role === 'doctor_secretary') {
      const { doctorUuid } = await resolveSecretaryLinkedDoctor(hdr);
      const reqDoctorId = requestRow?.doctor_id ? String(requestRow.doctor_id) : '';
      if (reqDoctorId && reqDoctorId !== doctorUuid) return res.status(403).json({ message: 'Forbidden' });
    }

    if (role === 'doctor_secretary' && status === 'Approved') {
      const secretaryName = String(actor || req.body.secretaryName || req.body.actor || req.body.name || '').trim() || requestRow.doctor_name || null;
      const updated = await createAppointmentFromSecretaryApproval({
        id,
        hdr,
        requestRow,
        secretaryName,
        department
      });
      return res.json(serializeRequestRow(updated));
    }

    const updateField = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';

    const rows = await prisma.$queryRawUnsafe(
      `
        UPDATE appointment_approval_requests
        SET status = $1,
            suggested_date = $2,
            suggested_time = $3,
            suggested_note = $4,
            ${updateField} = now(),
            updated_at = now()
        WHERE id = $5
        RETURNING *
      `,
      status,
      status === 'Suggested' ? suggestedDate : null,
      status === 'Suggested' ? suggestedTime : null,
      status === 'Suggested' ? note : (status === 'Rejected' ? note : null),
      id
    );
    const updated = Array.isArray(rows) ? rows[0] : rows;

    const roleName = role.charAt(0).toUpperCase() + role.slice(1);
    const systemBody = status === 'Approved'
      ? `Approved by ${actor || requestRow[`${role}_name`] || roleName}`
      : status === 'Rejected'
        ? `Rejected by ${actor || requestRow[`${role}_name`] || roleName}${note ? `: ${note}` : ''}`
        : `Suggested new schedule by ${actor || requestRow[`${role}_name`] || roleName}${note ? `: ${note}` : ''}`;

    await prisma.$queryRaw`
      INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
      VALUES (${id}, ${role}, ${actor || requestRow[`${role}_name`] || null}, ${systemBody}, now())
    `;

    prisma.activity_logs.create({
      data: {
        actor_name: actor || requestRow[`${role}_name`] || null,
        role: roleName,
        action: 'Update',
        target: `AppointmentApproval:${id.toString()}`,
        details: `Set approval request to ${status}`
      }
    }).catch(() => {});

    if (status === 'Approved' && ROLE_SERVICE_KEYS[role]) {
      const existing = await prisma.clinical_orders.findFirst({
        where: { notes: { contains: `ApprovalRequest:${id.toString()}` } }
      }).catch(() => null);

      if (!existing) {
        const { patientId, patientName } = await resolvePatientForRequestRow(requestRow);
        const { category, service } = parseServiceFromReason(requestRow.reason);
        const kind = category.toLowerCase() === 'radiology'
          ? 'Imaging'
          : category.toLowerCase() === 'ecg'
            ? 'ECG'
            : category.toLowerCase() === 'laboratory'
              ? 'Lab'
              : category.toLowerCase() === 'physical therapy'
                ? 'PT'
                : category;

        await prisma.clinical_orders.create({
          data: {
            patient_id: patientId,
            patient_name: patientName || null,
            kind: kind || null,
            service: service || null,
            priority: 'Routine',
            status: 'For Payment',
            notes: `From appointment approval request ${id.toString()} (ApprovalRequest:${id.toString()})`,
            ordered_by_name: patientName || null,
            ordered_by_role: 'patient',
            assigned_role: role,
            assigned_to: hdr.email || null
          }
        }).catch(() => {});
      }
    }

    res.json(serializeRequestRow(updated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/secretary-finalize', async (req, res) => {
  try {
    const idStr = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idStr)) return res.status(400).json({ message: 'Invalid request id.' });
    const id = BigInt(idStr);
    const hdr = inferRequester(req);
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== 'doctor_secretary') return res.status(403).json({ message: 'Forbidden' });

    const doctorId = String(req.body.doctorId || '').trim();
    if (!doctorId) return res.status(400).json({ message: 'doctorId is required.' });
    if (!isUuid(doctorId)) return res.status(400).json({ message: 'doctorId must be a valid UUID.' });

    const secretaryName = String(req.body.secretaryName || req.body.actor || '').trim() || null;
    const department = String(req.body.department || req.body.serviceType || '').trim();

    const reqRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const requestRow = Array.isArray(reqRows) ? reqRows[0] : null;
    if (!requestRow) return res.status(404).json({ message: 'Request not found' });
    const updated = await createAppointmentFromSecretaryApproval({
      id,
      hdr,
      requestRow,
      secretaryName,
      department,
      overriddenDoctorId: doctorId
    });
    res.json(serializeRequestRow(updated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/finalize', async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const hdr = inferRequester(req);
    if (hdr.role && hdr.role !== 'admin' && hdr.role !== 'nurse') return res.status(403).json({ message: 'Forbidden' });
    const nurseName = String(req.body.nurseName || req.body.actor || '').trim() || null;
    const department = String(req.body.department || req.body.serviceType || '').trim();

    const reqRows = await prisma.$queryRaw`
      SELECT *
      FROM appointment_approval_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const requestRow = Array.isArray(reqRows) ? reqRows[0] : null;
    if (!requestRow) return res.status(404).json({ message: 'Request not found' });

    if (department) {
      const reqService = inferServiceType(requestRow);
      if (reqService && reqService.toLowerCase() !== department.toLowerCase()) {
        return res.status(403).json({ message: 'Forbidden: service type mismatch.' });
      }
    }

    const currentStatus = String(requestRow.status || '');
    if (currentStatus === 'Rejected') {
      return res.status(409).json({ message: 'Request cannot be finalized in current status.' });
    }

    if (requestRow.appointment_id) {
      return res.json(serializeRequestRow(requestRow));
    }

    const patient = await resolvePatientForRequestRow(requestRow);

    const apptDate = requestRow.requested_date ? new Date(requestRow.requested_date) : null;
    const apptTime = requestRow.requested_time ? new Date(requestRow.requested_time) : null;
    if (!apptDate || !apptTime) return res.status(400).json({ message: 'Missing requested schedule.' });
    const consultationMode = inferConsultationMode(requestRow);
    const doctorUuid = requestRow?.doctor_id ? String(requestRow.doctor_id) : '';
    const modeKey = String(consultationMode || '').trim().toLowerCase() || 'onsite';
    if (modeKey === 'onsite' && doctorUuid) {
      const dateKey = apptDate.toISOString().slice(0, 10);
      const minutes = timeToMinutesLoose(apptTime);
      if (minutes !== null) {
        let blocks = null;
        try {
          blocks = await loadDoctorAvailabilityBlocksSupabase({ doctorId: doctorUuid, dateKey });
        } catch (_) {
          blocks = null;
        }
        if (blocks?.dayBlocked || (blocks && isMinutesBlockedByAvailability({ minutes, blocks }))) {
          return res.status(409).json({ message: blocks?.dayBlocked ? 'Doctor is not available on this date.' : 'Selected time is not available.' });
        }
      }
    }

    const appt = await prisma.appointments.create({
      data: {
        first_name: patient.firstName || null,
        last_name: patient.lastName || null,
        email: patient.email || null,
        phone: patient.phone || null,
        date_of_birth: patient.dateOfBirth ? new Date(patient.dateOfBirth) : null,
        reason: requestRow.service_type || requestRow.reason || 'Appointment',
        appointment_date: apptDate,
        appointment_time: apptTime,
        doctor_id: requestRow.doctor_name,
        doctor_uuid: doctorUuid || null,
        patient_id: patient.patientId,
        consultation_mode: consultationMode,
        status: 'Confirmed'
      }
    });

    const updatedRows = await prisma.$queryRaw`
      UPDATE appointment_approval_requests
      SET status = 'Approved',
          appointment_id = ${appt.id},
          patient_id = COALESCE(patient_id, ${patient.patientId}::uuid),
          nurse_last_read_at = now(),
          updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;

    const msgBody = `Appointment scheduled by ${nurseName || requestRow.nurse_name || 'Nurse'}`;
    await prisma.$queryRaw`
      INSERT INTO appointment_messages (request_id, sender_role, sender_name, body, created_at)
      VALUES (${id}, 'nurse', ${nurseName || requestRow.nurse_name || null}, ${msgBody}, now())
    `;

    prisma.activity_logs.create({
      data: {
        actor_name: nurseName || requestRow.nurse_name || null,
        role: 'Nurse',
        action: 'Create',
        target: `Appointment:${appt.id.toString()}`,
        details: `Finalized approved appointment for ${patient.firstName || ''} ${patient.lastName || ''}`.trim()
      }
    }).catch(() => {});

    res.json(serializeRequestRow(updated));
  } catch (err) {
    res.status(Number(err?.statusCode) || 400).json({ message: err.message });
  }
});

module.exports = router;

