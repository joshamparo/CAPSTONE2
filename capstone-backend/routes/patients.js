const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset } = require('../utils/normalize');
const { resolveClinicalServicePricing } = require('../utils/clinicalServiceCatalog');
const { ensureBillingTablesExist, toMoney, syncHmoDataFromAppointmentToInvoice } = require('../utils/billingLedger');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/mailer');
const { appointmentEmail } = require('../utils/emailTemplates');
const { patientUpdateAccess, sanitizePatientUpdateForRole } = require('../utils/patientUpdateAccess');
const requireNurseDepartment = require('../middleware/requireNurseDepartment');
const { sendError } = require('../utils/httpErrors');
const { nursePatientScope, isCentralIntakeRequest } = require('../utils/nursePatientAccess');

let _supabaseAdmin = null;
function getSupabaseAdmin() {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    if (!_supabaseAdmin) {
        _supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
    }
    return _supabaseAdmin;
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
    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    const dayBlocked = rows.some((r) => !r?.start_time && !r?.end_time);
    const toMin = (v) => {
        const raw = String(v || '').trim();
        const m = raw.match(/^(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const ranges = rows
        .map((r) => {
            const s = toMin(r?.start_time);
            const e = toMin(r?.end_time);
            if (s === null || e === null || e <= s) return null;
            return [s, e];
        })
        .filter(Boolean);
    return { dayBlocked, ranges };
}

async function enforceDoctorAvailability({ doctorId, dateKey, mode = 'onsite', requestedMin }) {
    // Supabase direct blocks
    try {
        const blocks = await loadDoctorAvailabilityBlocksSupabase({ doctorId, dateKey });
        if (blocks) {
            if (blocks.dayBlocked) return { blocked: true, reason: 'Doctor is not available on this date.' };
            for (const [s, e] of Array.isArray(blocks.ranges) ? blocks.ranges : []) {
                if (requestedMin >= s && requestedMin < e) return { blocked: true, reason: 'Selected time is not available.' };
            }
        }
    } catch (_) {}

    // Prisma tables (rules / day-offs / exceptions / date-windows)
    try {
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
    } catch (_) {}

    const toMin = (v) => {
        const raw = String(v || '').trim();
        const m = raw.match(/^(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const modeLower = String(mode || 'onsite').trim().toLowerCase() || 'onsite';
    const requestedDate = new Date(`${dateKey}T00:00:00.000Z`);
    const dow = Number.isNaN(requestedDate.getUTCDay()) ? new Date().getUTCDay() : requestedDate.getUTCDay();

    // Day offs
    try {
        const offRows = await prisma.$queryRawUnsafe(`
            SELECT day_of_week AS "dayOfWeek"
            FROM public.doctor_availability_day_offs
            WHERE doctor_id = $1::uuid
              AND lower(mode) = $2
              AND active = true
        `, doctorId, modeLower);
        const offs = (Array.isArray(offRows) ? offRows : []).map((r) => Number(r?.dayOfWeek)).filter((v) => Number.isFinite(v) && v >= 0 && v <= 6);
        if (offs.includes(dow)) return { blocked: true, reason: 'Doctor is not available on this day.' };
    } catch (_) {}

    // Exceptions
    try {
        const excRows = await prisma.$queryRawUnsafe(`
            SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                   to_char(end_time, 'HH24:MI')   AS "endTime"
            FROM public.doctor_availability_exceptions
            WHERE doctor_id = $1::uuid
              AND lower(mode) = $2
              AND date = $3::date
        `, doctorId, modeLower, dateKey);
        const excArr = Array.isArray(excRows) ? excRows : [];
        if (excArr.some((e) => !e?.startTime && !e?.endTime)) {
            return { blocked: true, reason: 'Doctor is not available on this date.' };
        }
        for (const e of excArr) {
            const s = toMin(e?.startTime);
            const en = toMin(e?.endTime);
            if (s !== null && en !== null && en > s && requestedMin >= s && requestedMin < en) {
                return { blocked: true, reason: 'Selected time is not available.' };
            }
        }
    } catch (_) {}

    // Date-windows
    try {
        const dwRows = await prisma.$queryRawUnsafe(`
            SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                   to_char(end_time, 'HH24:MI')   AS "endTime",
                   slot_minutes AS "slotMinutes",
                   max_per_slot AS "maxPerSlot"
            FROM public.doctor_availability_date_windows
            WHERE doctor_id = $1::uuid
              AND lower(mode) = $2
              AND date = $3::date
              AND active = true
            ORDER BY start_time ASC
        `, doctorId, modeLower, dateKey);
        const dwArr = Array.isArray(dwRows) ? dwRows : [];
        if (dwArr.length > 0) {
            const hit = dwArr.find((r) => {
                const s = toMin(r?.startTime);
                const en = toMin(r?.endTime);
                const step = Math.max(5, Math.min(240, Math.trunc(Number(r?.slotMinutes || 30) || 30)));
                if (s === null || en === null) return false;
                if (requestedMin < s || requestedMin + step > en) return false;
                if ((requestedMin - s) % step !== 0) return false;
                return true;
            });
            if (!hit) return { blocked: true, reason: 'Selected time is not available.' };
            return { blocked: false, rule: hit };
        }
    } catch (_) {}

    // Weekly rules
    try {
        const ruleRows = await prisma.$queryRawUnsafe(`
            SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                   to_char(end_time, 'HH24:MI')   AS "endTime",
                   slot_minutes AS "slotMinutes",
                   max_per_slot AS "maxPerSlot"
            FROM public.doctor_availability_rules
            WHERE doctor_id = $1::uuid
              AND lower(mode) = $2
              AND day_of_week = $3
              AND active = true
            ORDER BY start_time ASC
        `, doctorId, modeLower, dow);
        const rulesArr = Array.isArray(ruleRows) ? ruleRows : [];
        if (!rulesArr.length) return { blocked: true, reason: 'Doctor has no availability schedule configured for this day.' };
        const hit = rulesArr.find((r) => {
            const s = toMin(r?.startTime);
            const en = toMin(r?.endTime);
            const step = Math.max(5, Math.min(240, Math.trunc(Number(r?.slotMinutes || 30) || 30)));
            if (s === null || en === null) return false;
            if (requestedMin < s || requestedMin + step > en) return false;
            if ((requestedMin - s) % step !== 0) return false;
            return true;
        });
        if (!hit) return { blocked: true, reason: 'Selected time is not available.' };
        return { blocked: false, rule: hit };
    } catch (_) {
        return { blocked: true, reason: 'Unable to verify doctor availability.' };
    }
}

router.use(requireRole(['admin', 'nurse', 'doctor', 'pharmacist', 'staff', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']));
router.use((req, res, next) => {
    if (req.auth?.role !== 'nurse' || isCentralIntakeRequest(req.method, req.path)) return next();
    req.nurseDepartmentFallback = 'ER';
    return requireNurseDepartment(req, res, next);
});

function getRequesterRole(req) {
    return String(req.auth?.role || '').trim().toLowerCase();
}

function getRequesterEmail(req) {
    const raw = String(req.auth?.email || '');
    return normalizeEmail(raw);
}

function inferRequesterName(req) {
    const raw = String(req.nurseIdentity?.name || '').trim();
    if (raw) return raw;
    const email = getRequesterEmail(req);
    return email || 'System User';
}

function manilaDateKeyFromNow(now = new Date()) {
    const manilaMs = now.getTime() + 8 * 60 * 60 * 1000;
    const d = new Date(manilaMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function normalizeServiceKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

let walkInCounterSchemaPromise = null;
let nurseTasksTablePromise = null;
let walkInHmoSchemaPromise = null;
function ensureWalkInCounterSchemaOnce() {
    if (!walkInCounterSchemaPromise) {
        walkInCounterSchemaPromise = prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS public.walkin_ticket_counters (
                ticket_date date NOT NULL,
                doctor_key text NOT NULL DEFAULT '',
                last_seq integer NOT NULL DEFAULT 0,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (ticket_date, doctor_key)
            );
        `).catch((err) => {
            walkInCounterSchemaPromise = null;
            throw err;
        });
    }
    return walkInCounterSchemaPromise;
}

async function nextWalkInTicket(tx, dateKey, doctorKey = null) {
    // Atomic counter per date (+ optional doctor key) to prevent duplicates under concurrency.
    const rows = await tx.$queryRawUnsafe(
        `
            INSERT INTO public.walkin_ticket_counters (ticket_date, doctor_key, last_seq, updated_at)
            VALUES ($1::date, $2, 1, now())
            ON CONFLICT (ticket_date, doctor_key)
            DO UPDATE SET last_seq = public.walkin_ticket_counters.last_seq + 1, updated_at = now()
            RETURNING last_seq::int AS seq
        `,
        dateKey,
        doctorKey ? String(doctorKey) : ''
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const seq = row?.seq != null ? Number(row.seq) : 0;
    if (!Number.isFinite(seq) || seq <= 0) throw new Error('Unable to generate walk-in ticket');
    return { seq, ticket: `W-${String(seq).padStart(3, '0')}` };
}

async function sendAppointmentSummaryEmail({ to, subject, templateParams }) {
    try {
        const body = [templateParams?.message_body, `Service: ${templateParams?.service_label || ''}`, `Schedule: ${templateParams?.scheduled_time || ''}`, `Status: ${templateParams?.status_label || ''}`, templateParams?.footer_note].filter(Boolean).join('\n\n');
        return await sendEmail({
            to, subject, text: body,
            html: appointmentEmail({ title: templateParams?.subject || subject, message: templateParams?.message_body, service: templateParams?.service_label, schedule: templateParams?.scheduled_time, status: templateParams?.status_label, footer: templateParams?.footer_note }),
            templateId: process.env.EMAILJS_APPOINTMENT_TEMPLATE_ID || 'template_65mdd0e',
            templateParams: { subject, message_html: '', ...templateParams }
        });
    } catch (e) {
        console.error('Appointment email error:', e?.message || e);
        return { ok: false, error: String(e?.message || e) };
    }
}

const CLINICAL_STAFF_ROLES = new Set(['medtech', 'radiographer', 'ecg_operator', 'physical_therapist']);

function clinicalPatientOrderScope(req) {
    const role = getRequesterRole(req);
    if (role === 'nurse') return nursePatientScope(req.nurseDepartment);
    if (!CLINICAL_STAFF_ROLES.has(role)) return null;
    const email = getRequesterEmail(req);
    return {
        clinical_orders: {
            some: {
                assigned_role: role,
                ...(email ? { OR: [{ assigned_to: email }, { assigned_to: null }] } : { assigned_to: null })
            }
        }
    };
}

async function logNursePatientAccess(req, action, target, details) {
    if (getRequesterRole(req) !== 'nurse') return;
    await prisma.activity_logs.create({
        data: {
            actor_name: inferRequesterName(req),
            role: 'nurse',
            action,
            target,
            details: String(details || '').slice(0, 500)
        }
    }).catch(() => null);
}

async function enforceClinicalPatientAccess(req, res, patientId) {
    const scope = clinicalPatientOrderScope(req);
    if (!scope) return true;
    let match = await prisma.patients.findFirst({
        where: { id: String(patientId), ...scope },
        select: { id: true }
    });
    if (!match && getRequesterRole(req) === 'nurse' && req.nurseDepartment === 'ER') {
        const receptionPatient = await prisma.patients.findUnique({
            where: { id: String(patientId) },
            select: { id: true, clinical_records: true }
        });
        if (receptionPatient && getReceptionRouteFromClinicalRecords(receptionPatient.clinical_records)) match = { id: receptionPatient.id };
    }
    if (!match) {
        res.status(403).json({ message: 'This patient is not assigned to your clinical service.' });
        return false;
    }
    return true;
}

function normalizeWalkInRouteType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'er_consult';
    if (['er', 'er_consult', 'emergency', 'emergency_consult'].includes(raw)) return 'er_consult';
    if (['consult', 'consultation', 'onsite', 'onsite_consult', 'doctor_consult'].includes(raw)) return 'onsite_consult';
    if (['lab', 'laboratory'].includes(raw)) return 'lab';
    if (['imaging', 'radiology', 'ecg'].includes(raw)) return 'imaging';
    if (['pharmacy', 'otc', 'medicine_pickup'].includes(raw)) return 'pharmacy';
    if (['admission', 'admission_eval', 'admit'].includes(raw)) return 'admission_eval';
    return 'er_consult';
}

const WALK_IN_ROUTE_INPUTS = new Set([
    'er', 'er_consult', 'emergency', 'emergency_consult',
    'consult', 'consultation', 'onsite', 'onsite_consult', 'doctor_consult',
    'lab', 'laboratory', 'imaging', 'radiology', 'ecg',
    'pharmacy', 'otc', 'medicine_pickup', 'admission', 'admission_eval', 'admit'
]);

function getWalkInRouteMeta(routeType) {
    const type = normalizeWalkInRouteType(routeType);
    if (type === 'onsite_consult') {
        return {
            type,
            label: 'Appointment',
            needsDoctor: false,
            creates: 'appointment',
            reasonPrefix: '[APPOINTMENT][CLINIC] Appointment'
        };
    }
    if (type === 'lab') {
        return {
            type,
            label: 'Laboratory',
            needsDoctor: false,
            creates: 'clinical_order',
            requestTarget: 'Laboratory',
            reasonPrefix: '[WALK-IN][LAB]'
        };
    }
    if (type === 'imaging') {
        return {
            type,
            label: 'Imaging / ECG',
            needsDoctor: false,
            creates: 'clinical_order',
            requestTarget: 'Imaging',
            reasonPrefix: '[WALK-IN][IMAGING]'
        };
    }
    if (type === 'pharmacy') {
        return {
            type,
            label: 'Pharmacy',
            needsDoctor: false,
            creates: 'request',
            requestTarget: 'Pharmacy',
            reasonPrefix: '[WALK-IN][PHARMACY]'
        };
    }
    if (type === 'admission_eval') {
        return {
            type,
            label: 'Admission Evaluation',
            needsDoctor: true,
            creates: 'appointment',
            reasonPrefix: '[WALK-IN][ADMISSION] Admission Evaluation'
        };
    }
    return {
        type: 'er_consult',
        label: 'ER Consultation',
        needsDoctor: false,
        creates: 'appointment',
        reasonPrefix: '[TRIAGE][WALK-IN] ER Consultation'
    };
}

function buildWalkInClinicalRecordEntry({ routeMeta, requesterName, now, payload, triage }) {
    return {
        type: routeMeta.type,
        label: routeMeta.label,
        createdAt: now.toISOString(),
        createdBy: requesterName,
        specialization: String(payload.selectedSpecialization || '').trim() || null,
        consultTiming: String(payload.consultTiming || 'same_day').trim() || 'same_day',
        preferredDate: String(payload.preferredDate || '').trim() || null,
        preferredTime: String(payload.preferredTime || '').trim() || null,
        mainConcern: String(payload.mainConcern || '').trim() || null,
        existingConditions: String(payload.existingConditions || '').trim() || null,
        routeNote: String(payload.routeNote || '').trim() || null,
        painLevel: Number.isFinite(Number(payload.painLevel)) ? Number(payload.painLevel) : null,
        vitals: {
            temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : null,
            bloodPressure:
                payload.bp_systolic && payload.bp_diastolic
                    ? `${payload.bp_systolic}/${payload.bp_diastolic}`
                    : null,
            heartRate: Number.isFinite(Number(payload.heartRate)) ? Number(payload.heartRate) : null,
            respiratoryRate: Number.isFinite(Number(payload.respiratoryRate)) ? Number(payload.respiratoryRate) : null,
            spo2: Number.isFinite(Number(payload.spo2)) ? Number(payload.spo2) : null,
            weight: Number.isFinite(Number(payload.weight)) ? Number(payload.weight) : null,
            height: Number.isFinite(Number(payload.height)) ? Number(payload.height) : null
        },
        triage
    };
}

function mergeWalkInClinicalRecords(currentValue, entry) {
    const base =
        currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
            ? { ...currentValue }
            : {};
    const existing = Array.isArray(base.walkInIntakes) ? base.walkInIntakes : [];
    base.walkInIntakes = [entry, ...existing].slice(0, 50);
    if (entry.type === 'er_consult') {
        base.erRegistration = entry;
    }
    return base;
}

async function upsertWalkInHmoClaim(db, {
    invoiceId, appointmentId, patientId, patientName, provider, loaNumber,
    cardNumber, philhealthDeduction, approvedAmount, status, coverageJson,
    notes, requester
}) {
    const invoiceKey = typeof invoiceId === 'bigint' ? invoiceId : BigInt(String(invoiceId));
    // Serialize claim writes per invoice without depending on a legacy unique
    // constraint that may not exist in older production databases.
    await db.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::bigint)', invoiceKey);
    const updated = await db.$executeRawUnsafe(`
        UPDATE public.billing_hmo_claims
        SET appointment_id = COALESCE(appointment_id, $2::bigint),
            patient_id = COALESCE(patient_id, $3::uuid),
            patient_name = COALESCE(patient_name, $4::text),
            hmo_provider = $5::text,
            hmo_loa_number = $6::text,
            hmo_card_number = $7::text,
            philhealth_deduction = $8::numeric,
            loa_approved_amount = $9::numeric,
            status = $10::text,
            coverage_json = COALESCE($11::jsonb, coverage_json),
            notes = COALESCE($12::text, notes),
            requested_by = COALESCE(requested_by, $13::text),
            updated_by = $13::text,
            updated_at = now()
        WHERE invoice_id = $1::bigint
    `, invoiceKey, appointmentId || null, patientId || null, patientName || null,
        provider || null, loaNumber || null, cardNumber || null,
        Number(philhealthDeduction || 0), Number(approvedAmount || 0), status,
        coverageJson || null, notes || null, requester || null);
    if (Number(updated) > 0) return { created: false };

    await db.$executeRawUnsafe(`
        INSERT INTO public.billing_hmo_claims
            (invoice_id, appointment_id, patient_id, patient_name, hmo_provider, hmo_loa_number,
             hmo_card_number, philhealth_deduction, loa_approved_amount, status, coverage_json,
             notes, requested_by, updated_by, created_at, updated_at)
        VALUES
            ($1::bigint, $2::bigint, $3::uuid, $4::text, $5::text, $6::text,
             $7::text, $8::numeric, $9::numeric, $10::text, $11::jsonb,
             $12::text, $13::text, $13::text, now(), now())
    `, invoiceKey, appointmentId || null, patientId || null, patientName || null,
        provider || null, loaNumber || null, cardNumber || null,
        Number(philhealthDeduction || 0), Number(approvedAmount || 0), status,
        coverageJson || null, notes || null, requester || null);
    return { created: true };
}

function getReceptionRouteFromClinicalRecords(clinicalRecords) {
    const entries = clinicalRecords && typeof clinicalRecords === 'object' && Array.isArray(clinicalRecords.walkInIntakes)
        ? clinicalRecords.walkInIntakes
        : [];
    const intake = entries.find((entry) => entry && typeof entry === 'object');
    if (!intake) return null;
    const type = String(intake.type || '').trim().toLowerCase();
    const context = `${intake.specialization || ''} ${intake.label || ''} ${intake.mainConcern || ''}`;
    if (type === 'er_consult') return { route: 'ER', status: 'ER Intake' };
    if (type === 'onsite_consult') return /physical\s*therapy|physiotherapy|rehab/i.test(context)
        ? { route: 'PHYSICAL_THERAPY', status: 'Sent to Physical Therapy' }
        : { route: 'ONSITE', status: 'Awaiting Secretary' };
    if (type === 'lab') return { route: 'LAB', status: 'Sent to Laboratory' };
    if (type === 'imaging') return /\becg\b/i.test(context)
        ? { route: 'ECG', status: 'Sent to ECG' }
        : { route: 'IMAGING', status: 'Sent to Imaging' };
    if (type === 'pharmacy') return { route: 'PHARMACY', status: 'Sent to Pharmacy' };
    if (type === 'admission_eval') return { route: 'ADMISSION', status: 'Admission Evaluation' };
    return null;
}

function toPatientResponse(row) {
    if (!row || typeof row !== 'object') return row;
    const {
        password: _password,
        reset_password_token: _resetPasswordToken,
        reset_password_expires: _resetPasswordExpires,
        ...safeRow
    } = row;
    return {
        ...safeRow,
        id: row.id,
        firstName: row.first_name ?? null,
        middleName: row.middle_name ?? null,
        lastName: row.last_name ?? null,
        dateOfBirth: row.date_of_birth ?? null,
        contactNumber: row.contact_number ?? null,
        emergencyName: row.emergency_name ?? null,
        emergencyRelation: row.emergency_relation ?? null,
        emergencyPhone: row.emergency_phone ?? null,
        philHealthNumber: row.philhealth_number ?? null,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null
    };
}

function serializePayload(value) {
    return JSON.parse(
        JSON.stringify(value, (_key, current) => {
            if (typeof current === 'bigint') return current.toString();
            if (current instanceof Date) return current.toISOString();
            return current;
        })
    );
}

function toDisplayPatientName(patient) {
    return `${String(patient?.first_name || patient?.firstName || '').trim()} ${String(patient?.last_name || patient?.lastName || '').trim()}`.trim() || 'Patient';
}

function summarizeClinicalRecords(clinicalRecords) {
    const base = clinicalRecords && typeof clinicalRecords === 'object' && !Array.isArray(clinicalRecords)
        ? clinicalRecords
        : {};
    return {
        walkInIntakes: Array.isArray(base.walkInIntakes) ? base.walkInIntakes : [],
        erRegistration: base.erRegistration || null
    };
}

function buildTimelineEntries({
    appointments = [],
    notes = [],
    prescriptions = [],
    results = [],
    orders = [],
    invoices = [],
    payments = [],
    certificates = [],
    requests = [],
    walkIns = []
}) {
    const rows = [];

    appointments.forEach((appointment) => {
        rows.push({
            id: `appointment:${appointment.id}`,
            type: 'appointment',
            title: appointment.reason || appointment.mainConcern || 'Consultation encounter',
            date: appointment.appointmentDate || appointment.createdAt || null,
            meta: {
                status: appointment.status || null,
                consultationMode: appointment.consultationMode || null,
                doctor: appointment.doctorName || null
            }
        });
    });

    notes.forEach((note) => {
        rows.push({
            id: `note:${note.id}`,
            type: 'doctor_note',
            title: note.assessment || 'Doctor note added',
            date: note.createdAt || null,
            meta: { doctor: note.doctorName || null }
        });
    });

    prescriptions.forEach((prescription) => {
        rows.push({
            id: `prescription:${prescription.id}`,
            type: 'prescription',
            title: prescription.diagnosis || 'Prescription issued',
            date: prescription.createdAt || null,
            meta: {
                doctor: prescription.doctorName || null,
                itemCount: Array.isArray(prescription.items) ? prescription.items.length : 0
            }
        });
    });

    results.forEach((result) => {
        rows.push({
            id: `result:${result.id}`,
            type: 'result',
            title: result.title || result.type || 'Result uploaded',
            date: result.createdAt || result.resultDate || null,
            meta: {
                kind: result.type || null,
                uploadedBy: result.uploadedBy || null
            }
        });
    });

    orders.forEach((order) => {
        rows.push({
            id: `order:${order.id}`,
            type: 'clinical_order',
            title: order.service || order.kind || 'Clinical order created',
            date: order.updatedAt || order.createdAt || null,
            meta: {
                status: order.status || null,
                kind: order.kind || null,
                assignedRole: order.assignedRole || null
            }
        });
    });

    invoices.forEach((invoice) => {
        rows.push({
            id: `invoice:${invoice.id}`,
            type: 'invoice',
            title: `Invoice ${invoice.status || 'Draft'}`,
            date: invoice.updatedAt || invoice.createdAt || null,
            meta: {
                totalAmount: invoice.totalAmount || 0,
                balance: invoice.balance || 0
            }
        });
    });

    payments.forEach((payment) => {
        rows.push({
            id: `payment:${payment.id}`,
            type: 'payment',
            title: `Payment received (${payment.method || 'Unspecified'})`,
            date: payment.createdAt || null,
            meta: {
                amount: payment.amount || 0,
                receivedBy: payment.receivedBy || null
            }
        });
    });

    certificates.forEach((certificate) => {
        rows.push({
            id: `certificate:${certificate.id}`,
            type: 'certificate',
            title: certificate.purpose || 'Medical certificate issued',
            date: certificate.createdAt || certificate.validUntil || null,
            meta: {
                doctor: certificate.doctorName || null
            }
        });
    });

    requests.forEach((request) => {
        rows.push({
            id: `request:${request.id}`,
            type: 'request',
            title: request.message || 'Service request created',
            date: request.createdAt || null,
            meta: { status: request.status || null }
        });
    });

    walkIns.forEach((walkIn, index) => {
        rows.push({
            id: `walkin:${walkIn.createdAt || index}`,
            type: 'walk_in',
            title: walkIn.label || walkIn.type || 'Walk-in intake',
            date: walkIn.createdAt || null,
            meta: {
                mainConcern: walkIn.mainConcern || null,
                triage: walkIn.triage?.label || null
            }
        });
    });

    return rows
        .filter((row) => row.date)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function resolveDoctorSelection({ doctorId, doctorName }) {
    const id = String(doctorId || '').trim();
    const nameRaw = String(doctorName || '').trim();
    if (id) {
        const row = await prisma.doctors.findUnique({
            where: { id },
            select: { id: true, first_name: true, last_name: true, specialization: true }
        });
        if (!row) return null;
        const fullName = `Dr. ${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim();
        return {
            doctorUuid: row.id,
            doctorName: fullName,
            specialization: String(row.specialization || '').trim() || null
        };
    }
    if (!nameRaw) return null;
    const cleaned = nameRaw.replace(/^dr\.?\s*/i, '').trim();
    if (!cleaned) return null;
    const row = await prisma.doctors.findFirst({
        where: {
            OR: [
                { first_name: { contains: cleaned, mode: 'insensitive' } },
                { last_name: { contains: cleaned, mode: 'insensitive' } },
                {
                    AND: cleaned.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => ({
                        OR: [
                            { first_name: { contains: part, mode: 'insensitive' } },
                            { last_name: { contains: part, mode: 'insensitive' } }
                        ]
                    }))
                }
            ]
        },
        select: { id: true, first_name: true, last_name: true, specialization: true },
        orderBy: { id: 'desc' }
    });
    if (!row) {
        return { doctorUuid: null, doctorName: nameRaw, specialization: null };
    }
    return {
        doctorUuid: row.id,
        doctorName: `Dr. ${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim(),
        specialization: String(row.specialization || '').trim() || null
    };
}

async function ensureNurseTasksTable() {
    if (!nurseTasksTablePromise) {
        nurseTasksTablePromise = prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS public.nurse_tasks (
                id bigserial PRIMARY KEY,
                department text NOT NULL,
                shift_label text NULL,
                title text NOT NULL,
                priority text NOT NULL DEFAULT 'routine',
                due_time text NULL,
                patient_id uuid NULL,
                patient_name text NULL,
                status text NOT NULL DEFAULT 'open',
                completed boolean NOT NULL DEFAULT false,
                created_by_name text NULL,
                created_by_email text NULL,
                completed_by_name text NULL,
                completed_by_email text NULL,
                completed_at timestamptz NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `).catch((error) => {
            nurseTasksTablePromise = null;
            throw error;
        });
    }

    return nurseTasksTablePromise.catch(() => null);
}

async function ensureWalkInHmoSupport() {
    if (!walkInHmoSchemaPromise) {
        walkInHmoSchemaPromise = (async () => {
            const cols = [
                ['hmo_provider', 'VARCHAR(100)'],
                ['hmo_loa_number', 'VARCHAR(100)'],
                ['hmo_card_number', 'VARCHAR(100)'],
                ['hmo_notes', 'TEXT'],
                ['philhealth_number', 'VARCHAR(50)'],
                ['philhealth_deduction', 'DECIMAL(12,2) DEFAULT 0'],
                ['hmo_covered_json', 'JSONB'],
                ['is_hmo', 'BOOLEAN DEFAULT FALSE'],
                ['hmo_status', 'VARCHAR(40) DEFAULT \'Awaiting LOA\'']
            ];
            for (const [name, type] of cols) {
                await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ${name} ${type};`).catch(() => {});
            }
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.billing_hmo_claims (
                    id bigserial PRIMARY KEY,
                    invoice_id bigint NULL,
                    appointment_id bigint NULL,
                    patient_id uuid NULL,
                    patient_name text NULL,
                    hmo_provider text NULL,
                    hmo_loa_number text NULL,
                    hmo_card_number text NULL,
                    hmo_amount numeric(12,2) NOT NULL DEFAULT 0,
                    philhealth_amount numeric(12,2) NOT NULL DEFAULT 0,
                    claim_status text NOT NULL DEFAULT 'Pending - Nurse Intake',
                    coverage_json JSONB NULL,
                    notes text NULL,
                    created_by text NULL,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );
            `).catch(() => {});
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_appointment ON public.billing_hmo_claims (appointment_id);`).catch(() => {});
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient ON public.billing_hmo_claims (patient_id);`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_provider text NULL`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_loa_number text NULL`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_card_number text NULL`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_hmo_claims ADD COLUMN IF NOT EXISTS coverage_json jsonb NULL`).catch(() => {});
        })().catch((err) => {
            walkInHmoSchemaPromise = null;
            throw err;
        });
    }
    return walkInHmoSchemaPromise.catch(() => null);
}

// GET all patients
router.get('/', async (req, res) => {
    try {
        const requesterRole = getRequesterRole(req);
        if (requesterRole === 'patient') {
            const requesterEmail = getRequesterEmail(req);
            const emailParam = normalizeEmail(String(req.query.email || ''));
            if (!requesterEmail) return res.status(401).json({ message: "Missing user email" });
            if (!emailParam || emailParam !== requesterEmail) return res.status(403).json({ message: "Forbidden" });

            const patients = await prisma.patients.findMany({
                where: { email: { equals: requesterEmail, mode: 'insensitive' } },
                take: 1
            });
            return res.json(patients.map(toPatientResponse));
        }

        const { q, email, take, skip } = req.query;
        const limit = take !== undefined ? parseLimit(take, { min: 1, max: 2000, fallback: 200 }) : null;
        const offset = skip !== undefined ? parseOffset(skip, { min: 0, max: 20000, fallback: 0 }) : 0;

        const query = String(q || '').trim();
        const e = email ? normalizeEmail(email) : '';

        const where = {};
        if (e) where.email = { equals: e, mode: 'insensitive' };
        if (query) {
            where.OR = [
                { first_name: { contains: query, mode: 'insensitive' } },
                { last_name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } }
            ];
        }

        let clinicalScope = clinicalPatientOrderScope(req);
        const receptionRoutes = new Map();

        // Central reception scope. Intake history is authoritative, so ER nurses
        // can see reception-created service patients without exposing unrelated
        // outpatient records. Appointment state enriches ER/onsite routing.
        if (requesterRole === 'nurse' && req.nurseDepartment === 'ER') {
            const receptionPatients = await prisma.patients.findMany({
                select: { id: true, clinical_records: true },
                orderBy: { created_at: 'desc' },
                take: 2000
            });
            receptionPatients.forEach((row) => {
                const reception = getReceptionRouteFromClinicalRecords(row.clinical_records);
                if (reception) receptionRoutes.set(row.id, reception);
            });
            const receptionAppointments = await prisma.appointments.findMany({
                where: {
                    patient_id: { not: null },
                    OR: [
                        { reason: { startsWith: '[TRIAGE][WALK-IN] ER Consultation' } },
                        { reason: { startsWith: '[APPOINTMENT][CLINIC]' } }
                    ]
                },
                select: { patient_id: true, reason: true, status: true, assignment_status: true, doctor_uuid: true },
                orderBy: { created_at: 'desc' },
                take: 2000
            });
            const enrichedAppointmentRoutes = new Set();
            receptionAppointments.forEach((row) => {
                if (!row.patient_id || enrichedAppointmentRoutes.has(row.patient_id)) return;
                const onsite = String(row.reason || '').startsWith('[APPOINTMENT][CLINIC]');
                const existingRoute = receptionRoutes.get(row.patient_id);
                const appointmentRoute = onsite ? 'ONSITE' : 'ER';
                if (existingRoute && existingRoute.route !== appointmentRoute) return;
                receptionRoutes.set(row.patient_id, {
                    route: appointmentRoute,
                    status: onsite
                        ? (row.doctor_uuid ? 'Doctor Assigned' : (row.assignment_status === 'PENDING_ASSIGNMENT' ? 'Awaiting Secretary' : (row.status || 'Scheduled')))
                        : (row.status || 'ER Intake')
                });
                enrichedAppointmentRoutes.add(row.patient_id);
            });
            if (receptionRoutes.size) {
                clinicalScope = {
                    OR: [
                        clinicalScope,
                        { id: { in: Array.from(receptionRoutes.keys()) } }
                    ]
                };
            }
        }
        const scopedWhere = clinicalScope
            ? (Object.keys(where).length ? { AND: [where, clinicalScope] } : clinicalScope)
            : (Object.keys(where).length ? where : undefined);
        const patients = await prisma.patients.findMany({
            where: scopedWhere,
            orderBy: { created_at: 'desc' },
            ...(limit ? { take: limit } : {}),
            ...(offset ? { skip: offset } : {})
        });
        res.json(patients.map((patient) => {
            const reception = receptionRoutes.get(patient.id);
            const normalizedPatient = reception?.route === 'ER'
                ? { ...patient, admission_status: 'Emergency' }
                : patient;
            return { ...toPatientResponse(normalizedPatient), receptionRoute: reception?.route || null, routingStatus: reception?.status || null };
        }));
    } catch (err) {
        res.status(500).json({ message: "Error fetching patients" });
    }
});

router.get('/:id/full-record', async (req, res) => {
    try {
        const requesterRole = getRequesterRole(req);
        const requesterEmail = getRequesterEmail(req);
        const patientId = String(req.params.id || '').trim();
        if (!patientId) return res.status(400).json({ message: 'Invalid patient id' });

        const patient = await prisma.patients.findUnique({ where: { id: patientId } }).catch(() => null);
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        if (!(await enforceClinicalPatientAccess(req, res, patientId))) return;

        if (requesterRole === 'patient') {
            if (!requesterEmail) return res.status(401).json({ message: 'Missing user email' });
            const patientEmail = normalizeEmail(String(patient.email || ''));
            if (!patientEmail || patientEmail !== requesterEmail) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }

        const patientEmail = normalizeEmail(String(patient.email || ''));
        const appointmentWhere = patientEmail
            ? {
                OR: [
                    { patient_id: patient.id },
                    { email: { equals: patientEmail, mode: 'insensitive' } }
                ]
            }
            : { patient_id: patient.id };

        const [
            appointmentsRaw,
            notesRaw,
            prescriptionsRaw,
            resultsRaw,
            ordersRaw,
            certificatesRaw,
            requestsRaw,
            invoicesRaw
        ] = await Promise.all([
            prisma.appointments.findMany({
                where: appointmentWhere,
                orderBy: [{ appointment_date: 'desc' }, { created_at: 'desc' }],
                take: 200
            }).catch(() => []),
            prisma.doctor_notes.findMany({
                where: { patient_id: patient.id },
                orderBy: { created_at: 'desc' },
                take: 200
            }).catch(() => []),
            prisma.prescriptions.findMany({
                where: { patient_id: patient.id },
                orderBy: { created_at: 'desc' },
                take: 200
            }).catch(() => []),
            prisma.lab_results.findMany({
                where: { patient_id: patient.id },
                orderBy: { created_at: 'desc' },
                take: 200
            }).catch(() => []),
            prisma.clinical_orders.findMany({
                where: { patient_id: patient.id },
                include: {
                    events: { orderBy: { created_at: 'desc' } },
                    lab_results: { orderBy: { created_at: 'desc' } }
                },
                orderBy: { created_at: 'desc' },
                take: 200
            }).catch(() => []),
            prisma.medical_certificates.findMany({
                where: { patient_id: patient.id },
                orderBy: { created_at: 'desc' },
                take: 100
            }).catch(() => []),
            prisma.requests.findMany({
                where: { patient_id: patient.id },
                orderBy: { created_at: 'desc' },
                take: 100
            }).catch(() => []),
            prisma.billing_invoices.findMany({
                where: { patient_id: patient.id },
                include: {
                    items: true,
                    payments: true
                },
                orderBy: { created_at: 'desc' },
                take: 100
            }).catch(() => [])
        ]);

        const appointments = appointmentsRaw.map((appointment) => ({
            id: appointment.id.toString(),
            status: appointment.status || null,
            reason: appointment.reason || null,
            mainConcern: appointment.main_concern || null,
            description: appointment.description || null,
            appointmentDate: appointment.appointment_date || null,
            appointmentTime: appointment.appointment_time || null,
            consultationMode: appointment.consultation_mode || null,
            doctorName: appointment.doctor_id || null,
            doctorUuid: appointment.doctor_uuid || null,
            assignmentStatus: appointment.assignment_status || null,
            triageLevel: appointment.triage_level ?? null,
            triageStatus: appointment.triage_status || null,
            triageReasons: appointment.triage_reasons || null,
            paymentStatus: appointment.payment_status || null,
            amount: appointment.amount ?? null,
            wardTicket: appointment.walkin_ticket || null,
            completedAt: appointment.completed_at || null,
            completedBy: appointment.completed_by || null,
            createdAt: appointment.created_at || null
        }));

        const notes = notesRaw.map((note) => ({
            id: note.id.toString(),
            doctorName: note.doctor_name || null,
            subjective: note.subjective || null,
            objective: note.objective || null,
            assessment: note.assessment || null,
            plan: note.plan || null,
            vitals: note.vitals || null,
            createdAt: note.created_at || null
        }));

        const prescriptions = prescriptionsRaw.map((prescription) => ({
            id: prescription.id.toString(),
            doctorName: prescription.doctor_name || null,
            diagnosis: prescription.diagnosis || null,
            instructions: prescription.instructions || null,
            items: Array.isArray(prescription.items) ? prescription.items : [],
            sentToPharmacy: Boolean(prescription.is_sent_to_pharmacy),
            createdAt: prescription.created_at || null
        }));

        const results = resultsRaw.map((result) => ({
            id: result.id.toString(),
            orderId: result.order_id != null ? result.order_id.toString() : null,
            type: result.type || null,
            title: result.title || null,
            url: result.url || null,
            resultDate: result.result_date || null,
            uploadedBy: result.uploaded_by || null,
            createdAt: result.created_at || null
        }));

        const orders = ordersRaw.map((order) => ({
            id: order.id.toString(),
            kind: order.kind || null,
            service: order.service || null,
            priority: order.priority || null,
            status: order.status || null,
            notes: order.notes || null,
            orderedByName: order.ordered_by_name || null,
            orderedByRole: order.ordered_by_role || null,
            assignedRole: order.assigned_role || null,
            assignedTo: order.assigned_to || null,
            scheduledAt: order.scheduled_at || null,
            completedAt: order.completed_at || null,
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            events: (Array.isArray(order.events) ? order.events : []).map((event) => ({
                id: event.id.toString(),
                actorName: event.actor_name || null,
                actorRole: event.actor_role || null,
                action: event.action || null,
                fromStatus: event.from_status || null,
                toStatus: event.to_status || null,
                note: event.note || null,
                createdAt: event.created_at || null
            })),
            results: (Array.isArray(order.lab_results) ? order.lab_results : []).map((result) => ({
                id: result.id.toString(),
                title: result.title || null,
                type: result.type || null,
                url: result.url || null,
                resultDate: result.result_date || null,
                createdAt: result.created_at || null
            }))
        }));

        const certificates = certificatesRaw.map((certificate) => ({
            id: certificate.id.toString(),
            doctorName: certificate.doctor_name || null,
            purpose: certificate.purpose || null,
            diagnosis: certificate.diagnosis || null,
            recommendations: certificate.recommendations || null,
            validUntil: certificate.valid_until || null,
            createdAt: certificate.created_at || null
        }));

        const requests = requestsRaw.map((request) => ({
            id: request.id.toString(),
            patientName: request.patient_name || null,
            requestedBy: request.requested_by || null,
            message: request.message || null,
            status: request.status || null,
            createdAt: request.created_at || null
        }));

        const invoicePayments = [];
        const invoices = invoicesRaw.map((invoice) => {
            const items = Array.isArray(invoice.items) ? invoice.items : [];
            const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
            const totalAmount = Number(invoice.total_amount || 0);
            const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
            const balance = Math.max(0, totalAmount - paidAmount);

            payments.forEach((payment) => {
                invoicePayments.push({
                    id: payment.id.toString(),
                    invoiceId: invoice.id.toString(),
                    amount: Number(payment.amount || 0),
                    method: payment.method || null,
                    reference: payment.reference || null,
                    receivedBy: payment.received_by || null,
                    createdAt: payment.created_at || null
                });
            });

            return {
                id: invoice.id.toString(),
                appointmentId: invoice.appointment_id != null ? invoice.appointment_id.toString() : null,
                status: invoice.status || null,
                notes: invoice.notes || null,
                createdBy: invoice.created_by || null,
                totalAmount,
                paidAmount,
                balance,
                createdAt: invoice.created_at || null,
                updatedAt: invoice.updated_at || null,
                items: items.map((item) => ({
                    id: item.id.toString(),
                    description: item.description || null,
                    quantity: item.quantity ?? 0,
                    unitPrice: Number(item.unit_price || 0),
                    lineTotal: Number(item.line_total || 0),
                    createdAt: item.created_at || null
                })),
                payments: payments.map((payment) => ({
                    id: payment.id.toString(),
                    amount: Number(payment.amount || 0),
                    method: payment.method || null,
                    reference: payment.reference || null,
                    receivedBy: payment.received_by || null,
                    createdAt: payment.created_at || null
                }))
            };
        });

        const clinicalSummary = summarizeClinicalRecords(patient.clinical_records);
        const patientDisplayName = toDisplayPatientName(patient);
        const currentDoctor =
            String(patient.attending_doctor || '').trim() ||
            String(appointments.find((appointment) => appointment.doctorName)?.doctorName || '').trim() ||
            null;

        const payload = {
            patient: {
                ...toPatientResponse(patient),
                displayName: patientDisplayName
            },
            overview: {
                displayName: patientDisplayName,
                currentDoctor,
                admissionStatus: patient.admission_status || null,
                wardNumber: patient.ward_number || null,
                diagnosis: patient.diagnosis || null,
                counts: {
                    encounters: appointments.length,
                    notes: notes.length,
                    prescriptions: prescriptions.length,
                    results: results.length,
                    orders: orders.length,
                    invoices: invoices.length,
                    certificates: certificates.length
                }
            },
            encounters: appointments,
            notes,
            prescriptions,
            results,
            orders,
            certificates,
            requests,
            billing: {
                invoices,
                payments: invoicePayments,
                totals: {
                    invoiced: invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0),
                    paid: invoicePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                }
            },
            admission: {
                status: patient.admission_status || null,
                wardNumber: patient.ward_number || null,
                attendingDoctor: patient.attending_doctor || null,
                admissionDate: patient.admission_date || null
            },
            clinicalRecords: {
                raw: patient.clinical_records || null,
                walkInIntakes: clinicalSummary.walkInIntakes,
                erRegistration: clinicalSummary.erRegistration
            }
        };

        payload.timeline = buildTimelineEntries({
            appointments,
            notes,
            prescriptions,
            results,
            orders,
            invoices,
            payments: invoicePayments,
            certificates,
            requests,
            walkIns: clinicalSummary.walkInIntakes
        });

        await logNursePatientAccess(req, 'Full Patient Record Viewed', `Patient:${patientId.slice(0, 8)}`, 'Viewed the complete patient record.');
        res.json(serializePayload(payload));
    } catch (err) {
        res.status(500).json({ message: 'Error fetching full patient record' });
    }
});

// GET single patient by ID
router.get('/:id', async (req, res) => {
    try {
        const requesterRole = getRequesterRole(req);
        if (requesterRole === 'patient') {
            const requesterEmail = getRequesterEmail(req);
            if (!requesterEmail) return res.status(401).json({ message: "Missing user email" });
            const own = await prisma.patients.findFirst({
                where: { email: { equals: requesterEmail, mode: 'insensitive' } },
                select: { id: true }
            });
            if (!own) return res.status(404).json({ message: "Patient not found" });
            if (String(own.id) !== String(req.params.id)) return res.status(403).json({ message: "Forbidden" });
        }

        if (!(await enforceClinicalPatientAccess(req, res, req.params.id))) return;
        const patient = await prisma.patients.findUnique({
            where: { id: req.params.id }
        });
        if (!patient) return res.status(404).json({ message: "Patient not found" });
        await logNursePatientAccess(req, 'Patient Record Viewed', `Patient:${String(patient.id).slice(0, 8)}`, 'Viewed patient profile details.');
        res.json(toPatientResponse(patient));
    } catch (err) {
        res.status(500).json({ message: "Error fetching patient" });
    }
});

router.post('/er-registration', requireRole(['admin', 'nurse']), async (req, res) => {
    try {
        const {
            firstName, lastName, middleName, dateOfBirth, gender,
            contactNumber, email, address, bloodType,
            temperature, bp_systolic, bp_diastolic, heartRate, respiratoryRate, spo2,
            weight, height, mainConcern, existingConditions, painLevel
        } = req.body || {};

        const normalizedEmail = email ? normalizeEmail(email) : '';
        if (!String(firstName || '').trim() || !String(lastName || '').trim() || !String(dateOfBirth || '').trim()) {
            return res.status(400).json({ message: 'First name, last name, and date of birth are required.' });
        }

        const existingPatient = normalizedEmail
            ? await prisma.patients.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } })
            : null;
        if (existingPatient) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const now = new Date();
        const requesterName = inferRequesterName(req);
        const sys = Number(bp_systolic);
        const temp = Number(temperature);
        const oxygen = Number(spo2);
        const hr = Number(heartRate);

        let score = 50;
        let label = 'Non-Urgent';
        let level = 4;
        const reasons = [];

        if (oxygen > 0 && oxygen < 90) { score += 40; level = 1; label = 'Emergent'; reasons.push('Low Oxygen Saturation'); }
        if (sys > 180 || (sys > 0 && sys < 90)) { score += 25; level = Math.min(level, 2); label = level === 1 ? 'Emergent' : 'Urgent'; reasons.push('Critical Blood Pressure'); }
        if (temp > 39 || (temp > 0 && temp < 35)) { score += 15; level = Math.min(level, 3); reasons.push('Abnormal Temperature'); }
        if (hr > 120 || (hr > 0 && hr < 50)) { score += 15; level = Math.min(level, 3); reasons.push('Abnormal Heart Rate'); }

        const clinicalRecords = {
            erRegistration: {
                createdAt: now.toISOString(),
                createdBy: requesterName,
                mainConcern: String(mainConcern || '').trim() || null,
                existingConditions: String(existingConditions || '').trim() || null,
                painLevel: Number.isFinite(Number(painLevel)) ? Number(painLevel) : null,
                vitals: {
                    temperature: Number.isFinite(temp) ? temp : null,
                    bloodPressure: (bp_systolic && bp_diastolic) ? `${bp_systolic}/${bp_diastolic}` : null,
                    heartRate: Number.isFinite(hr) ? hr : null,
                    respiratoryRate: Number.isFinite(Number(respiratoryRate)) ? Number(respiratoryRate) : null,
                    spo2: Number.isFinite(oxygen) ? oxygen : null,
                    weight: Number.isFinite(Number(weight)) ? Number(weight) : null,
                    height: Number.isFinite(Number(height)) ? Number(height) : null
                },
                triage: {
                    level,
                    score,
                    label,
                    reasons
                }
            }
        };

        const result = await prisma.$transaction(async (tx) => {
            const patient = await tx.patients.create({
                data: {
                    first_name: String(firstName || '').trim(),
                    last_name: String(lastName || '').trim(),
                    middle_name: String(middleName || '').trim() || null,
                    date_of_birth: dateOfBirth ? new Date(dateOfBirth) : null,
                    gender: String(gender || '').trim() || null,
                    contact_number: String(contactNumber || '').trim() || null,
                    email: normalizedEmail || null,
                    street: String(address || '').trim() || null,
                    blood_type: String(bloodType || '').trim() || null,
                    clinical_records: clinicalRecords
                }
            });

            const appointment = await tx.appointments.create({
                data: {
                    first_name: String(firstName || '').trim(),
                    middle_name: String(middleName || '').trim() || null,
                    last_name: String(lastName || '').trim(),
                    email: normalizedEmail || null,
                    phone: String(contactNumber || '').trim() || null,
                    date_of_birth: dateOfBirth ? new Date(dateOfBirth) : null,
                    gender: String(gender || '').trim() || null,
                    reason: `[TRIAGE] ER Consultation: ${String(mainConcern || 'Walk-in').trim() || 'Walk-in'}`,
                    appointment_date: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
                    appointment_time: new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`),
                    main_concern: String(mainConcern || '').trim() || null,
                    description: String(existingConditions || '').trim() || null,
                    status: 'Confirmed',
                    consultation_mode: 'onsite',
                    patient_id: patient.id,
                    triage_level: level,
                    triage_status: 'Assessed',
                    triage_reasons: {
                        score,
                        label,
                        reasons,
                        vitals: clinicalRecords.erRegistration.vitals
                    },
                    triaged_by: requesterName,
                    triaged_at: now
                }
            });

            return { patient, appointment };
        }, { timeout: 30000 });

        res.status(201).json({
            patient: result.patient,
            appointment: {
                ...result.appointment,
                id: result.appointment.id?.toString?.() ? result.appointment.id.toString() : result.appointment.id,
                triageLevel: result.appointment.triage_level ?? null,
                triageStatus: result.appointment.triage_status || 'Assessed',
                triageReasons: result.appointment.triage_reasons ?? null
            }
        });
    } catch (err) {
        sendError(res, err, 'Unable to register ER patient.');
    }
});

router.post('/walk-in-intake', requireRole(['admin', 'nurse']), async (req, res) => {
    try {
        // Schema is installed by the prestart bootstrap. Keep request handling
        // focused on the intake itself; DDL here previously made the first
        // submission slow and could consume most of the transaction timeout.
        await ensureBillingTablesExist(prisma);
        const payload = req.body || {};
        const routeTypeRaw = String(payload.routeType || '').trim();
        if (routeTypeRaw && !WALK_IN_ROUTE_INPUTS.has(routeTypeRaw.toLowerCase())) {
            return res.status(400).json({ message: 'Select a valid walk-in destination.' });
        }
        const routeMeta = getWalkInRouteMeta(routeTypeRaw);
        const patientMode = String(payload.patientMode || 'new').trim().toLowerCase() === 'existing' ? 'existing' : 'new';
        const now = new Date();
        const manilaDateKey = manilaDateKeyFromNow(now);
        const requesterName = inferRequesterName(req);
        const normalizedEmail = payload.email ? normalizeEmail(payload.email) : '';

        const hmoApprovalStatusRaw = String(payload.hmoApprovalStatus || '').trim().toLowerCase();
        const hmoPaymentModeRaw = String(payload.hmoPaymentMode || '').trim().toLowerCase();
        const hmoRejectedFlag = Boolean(payload.hmoRejected === true || hmoApprovalStatusRaw === 'rejected');
        let desiredHmoStatus = null;
        if (hmoRejectedFlag) desiredHmoStatus = null; // EXPLICITLY REJECTED → skip ALL claim inserts, no HMO monitoring row
        else if (hmoApprovalStatusRaw === 'approved') desiredHmoStatus = 'Approved';
        else if (hmoApprovalStatusRaw === 'awaiting_loa') desiredHmoStatus = 'Awaiting LOA';
        if (Boolean(payload.hasHmo)) {
            const provider = String(payload.hmoProvider || '').trim();
            const cardNumber = String(payload.hmoCardNumber || '').trim();
            const loaNumber = String(payload.hmoLoaNumber || '').trim();
            const approvedAmount = Number(payload.hmoLoaApprovedAmount || 0);
            if (!hmoRejectedFlag && !desiredHmoStatus) {
                return res.status(400).json({ message: 'Select the HMO result: Approved, Awaiting LOA, or Rejected.' });
            }
            if (!hmoRejectedFlag && (!provider || !cardNumber)) {
                return res.status(400).json({ message: 'HMO provider and card number are required.' });
            }
            if (desiredHmoStatus === 'Approved' && (!loaNumber || !Number.isFinite(approvedAmount) || approvedAmount <= 0)) {
                return res.status(400).json({ message: 'Approved HMO claims require an LOA number and an approved amount greater than zero.' });
            }
        }
        const paymentModeNoteTag = (() => {
          if (hmoPaymentModeRaw === 'temp_cash') return '[Patient temp paid full - refund HMO later]';
          if (hmoPaymentModeRaw === 'guarantee') return '[Hospital Guarantee / Charge on Account]';
          return '';
        })();

        if (!routeMeta?.type) {
            return res.status(400).json({ message: 'Invalid walk-in destination.' });
        }
        if (patientMode === 'existing' && !String(payload.existingPatientId || '').trim()) {
            return res.status(400).json({ message: 'Select an existing patient first.' });
        }
        if (patientMode === 'new') {
            if (!String(payload.firstName || '').trim() || !String(payload.lastName || '').trim() || !String(payload.dateOfBirth || '').trim()) {
                return res.status(400).json({ message: 'First name, last name, and date of birth are required.' });
            }
        }
        if (!String(payload.mainConcern || '').trim()) {
            return res.status(400).json({ message: 'Main concern is required for walk-in intake.' });
        }
        if (routeMeta.type === 'onsite_consult' && !String(payload.selectedSpecialization || '').trim()) {
            return res.status(400).json({ message: 'Select the clinic specialization for this consultation.' });
        }
        if (routeMeta.type === 'onsite_consult' && !normalizedEmail) {
            return res.status(400).json({ message: 'Email is required so we can send the appointment summary.' });
        }
        if (routeMeta.type === 'onsite_consult') {
            const selectedSpecialization = String(payload.selectedSpecialization || '').trim();
            const activeDoctor = await prisma.doctors.findFirst({
                where: { specialization: { equals: selectedSpecialization, mode: 'insensitive' }, is_active: true },
                select: { id: true }
            });
            if (!activeDoctor) return res.status(400).json({ message: 'Select a clinic specialization with an active doctor.' });
            const preferredDateRaw = String(payload.preferredDate || '').trim();
            const preferredTimeRaw = String(payload.preferredTime || '').trim();
            if (!preferredDateRaw) return res.status(400).json({ message: 'Preferred date is required for an appointment.' });
            if (!preferredTimeRaw) return res.status(400).json({ message: 'Preferred time is required for an appointment.' });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDateRaw)) return res.status(400).json({ message: 'Invalid preferred date.' });
            if (!/^\d{2}:\d{2}$/.test(preferredTimeRaw)) return res.status(400).json({ message: 'Invalid preferred time.' });
            const tomorrowKey = manilaDateKeyFromNow(new Date(now.getTime() + 24 * 60 * 60 * 1000));
            if (preferredDateRaw < tomorrowKey) {
                return res.status(400).json({ message: 'Appointment must be scheduled on a future date.' });
            }
        }

        const doctorSelection = routeMeta.needsDoctor
            ? await resolveDoctorSelection({ doctorId: payload.doctorId, doctorName: payload.doctorName })
            : null;

        if (routeMeta.needsDoctor && !doctorSelection?.doctorName) {
            return res.status(400).json({ message: 'Select the doctor for this walk-in consultation first.' });
        }

        const sys = Number(payload.bp_systolic);
        const dia = Number(payload.bp_diastolic);
        const temp = Number(payload.temperature);
        const oxygen = Number(payload.spo2);
        const hr = Number(payload.heartRate);
        const rr = Number(payload.respiratoryRate);
        const pain = Number(payload.painLevel);

        const validateRange = (val, min, max) => Number.isFinite(val) && val >= min && val <= max;
        const isER = routeMeta.type === 'er_consult';

        if (isER) {
            const missing = [];
            if (!Number.isFinite(temp)) missing.push('temperature');
            if (!Number.isFinite(sys)) missing.push('bp_systolic');
            if (!Number.isFinite(dia)) missing.push('bp_diastolic');
            if (!Number.isFinite(hr)) missing.push('heartRate');
            if (!Number.isFinite(rr)) missing.push('respiratoryRate');
            if (!Number.isFinite(oxygen)) missing.push('spo2');
            if (missing.length) {
                return res.status(400).json({ message: `ER quick triage requires vitals: ${missing.join(', ')}.` });
            }
            if (!validateRange(temp, 30, 45)) return res.status(400).json({ message: 'Temperature looks invalid.' });
            if (!validateRange(sys, 50, 260)) return res.status(400).json({ message: 'Systolic BP looks invalid.' });
            if (!validateRange(dia, 30, 160)) return res.status(400).json({ message: 'Diastolic BP looks invalid.' });
            if (!validateRange(hr, 20, 250)) return res.status(400).json({ message: 'Heart rate looks invalid.' });
            if (!validateRange(rr, 6, 80)) return res.status(400).json({ message: 'Respiratory rate looks invalid.' });
            if (!validateRange(oxygen, 50, 100)) return res.status(400).json({ message: 'SpO₂ looks invalid.' });
            if (Number.isFinite(pain) && !validateRange(pain, 0, 10)) return res.status(400).json({ message: 'Pain score looks invalid.' });
        }
        let score = routeMeta.type === 'er_consult' ? 50 : 35;
        let label = routeMeta.type === 'er_consult' ? 'Non-Urgent' : 'Routine';
        let level = routeMeta.type === 'er_consult' ? 4 : 3;
        const reasons = [];

        // System Recommendation based on vitals
        if (oxygen > 0 && oxygen < 90) { score += 40; level = 1; label = 'Emergent'; reasons.push('Low Oxygen Saturation'); }
        if (sys > 180 || (sys > 0 && sys < 90)) { score += 25; level = Math.min(level, 2); label = level === 1 ? 'Emergent' : 'Urgent'; reasons.push('Critical Blood Pressure'); }
        if (temp > 39 || (temp > 0 && temp < 35)) { score += 15; level = Math.min(level, 3); reasons.push('Abnormal Temperature'); }
        if (hr > 120 || (hr > 0 && hr < 50)) { score += 15; level = Math.min(level, 3); reasons.push('Abnormal Heart Rate'); }
        if (rr > 0 && (rr >= 30 || rr <= 8)) { score += 15; level = Math.min(level, 2); label = level === 1 ? 'Emergent' : 'Urgent'; reasons.push('Abnormal Respiratory Rate'); }
        if (pain >= 8) { score += 10; level = Math.min(level, 2); reasons.push('Severe pain score'); }

        // Nurse Override Logic (Professor's suggestion)
        const finalTriageLevel = Number.isFinite(Number(payload.triageLevel)) ? Number(payload.triageLevel) : level;
        const triageNote = String(payload.triageNote || '').trim();
        const triageOverridden = finalTriageLevel !== level;

        const triage = { 
            level: finalTriageLevel, 
            recommendedLevel: level,
            overridden: triageOverridden,
            overrideReason: triageNote,
            score, 
            label: finalTriageLevel === 1 ? 'Resuscitation' : finalTriageLevel === 2 ? 'Emergent' : finalTriageLevel === 3 ? 'Urgent' : 'Less Urgent', 
            reasons 
        };
        const intakeEntry = buildWalkInClinicalRecordEntry({ routeMeta, requesterName, now, payload, triage });

        const result = await prisma.$transaction(async (tx) => {
            let patient = null;

            if (patientMode === 'existing') {
                patient = await tx.patients.findUnique({ where: { id: String(payload.existingPatientId).trim() } });
                if (!patient) {
                    const err = new Error('Selected patient no longer exists.');
                    err.statusCode = 404;
                    throw err;
                }
                const updatedClinicalRecords = mergeWalkInClinicalRecords(patient.clinical_records, intakeEntry);
                patient = await tx.patients.update({
                    where: { id: patient.id },
                    data: {
                        contact_number: String(payload.contactNumber || '').trim() || patient.contact_number || null,
                        email: normalizedEmail || patient.email || null,
                        street: String(payload.address || '').trim() || patient.street || null,
                        blood_type: String(payload.bloodType || '').trim() || patient.blood_type || null,
                        admission_status: routeMeta.type === 'er_consult' ? 'Emergency' : patient.admission_status,
                        clinical_records: updatedClinicalRecords
                    }
                });
            } else {
                const existingPatient = normalizedEmail
                    ? await tx.patients.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } })
                    : null;
                if (existingPatient) {
                    const err = new Error('Email already exists');
                    err.statusCode = 400;
                    throw err;
                }
                patient = await tx.patients.create({
                    data: {
                        first_name: String(payload.firstName || '').trim(),
                        last_name: String(payload.lastName || '').trim(),
                        middle_name: String(payload.middleName || '').trim() || null,
                        date_of_birth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
                        gender: String(payload.gender || '').trim() || null,
                        contact_number: String(payload.contactNumber || '').trim() || null,
                        email: normalizedEmail || null,
                        street: String(payload.address || '').trim() || null,
                        blood_type: String(payload.bloodType || '').trim() || null,
                        admission_status: routeMeta.type === 'er_consult' ? 'Emergency' : 'Outpatient',
                        clinical_records: mergeWalkInClinicalRecords(null, intakeEntry)
                    }
                });
            }

            const patientName = `${String(patient.first_name || '').trim()} ${String(patient.last_name || '').trim()}`.trim() || 'Walk-in Patient';
            let createdRecord = null;
            let linkedInvoiceId = null;
            let mainClinicalOrderHmoCoveredCents = 0;
            let extraHmoTotalCents = 0;

            if (routeMeta.creates === 'appointment') {
                const selectedSpecialization = String(payload.selectedSpecialization || '').trim() || null;
                const preferredDateRaw = String(payload.preferredDate || '').trim();
                const preferredTimeRaw = String(payload.preferredTime || '').trim();
                const consultServiceKey = selectedSpecialization ? normalizeServiceKey(`${selectedSpecialization}_consultation`) : 'general_consultation';
                const consultServiceName = selectedSpecialization ? `${selectedSpecialization} Consultation` : 'General Consultation';
                const appointmentDateValue =
                    routeMeta.type === 'onsite_consult' && preferredDateRaw
                        ? new Date(`${preferredDateRaw}T00:00:00.000Z`)
                        : new Date(`${manilaDateKey}T00:00:00.000Z`);
                const timeValue =
                    routeMeta.type === 'onsite_consult' && preferredTimeRaw
                        ? new Date(`1970-01-01T${preferredTimeRaw}:00`)
                        : new Date(`1970-01-01T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`);
                if (routeMeta.type === 'onsite_consult') {
                    if (Number.isNaN(appointmentDateValue.getTime())) {
                        const err = new Error('Invalid preferred date.');
                        err.statusCode = 400;
                        throw err;
                    }
                    if (Number.isNaN(timeValue.getTime())) {
                        const err = new Error('Invalid preferred time.');
                        err.statusCode = 400;
                        throw err;
                    }

                    const timeHh = String(timeValue.getUTCHours()).padStart(2, '0');
                    const timeMm = String(timeValue.getUTCMinutes()).padStart(2, '0');
                    const requestedMin = parseInt(timeHh, 10) * 60 + parseInt(timeMm, 10);
                    const dateKey = `${appointmentDateValue.getUTCFullYear()}-${String(appointmentDateValue.getUTCMonth() + 1).padStart(2, '0')}-${String(appointmentDateValue.getUTCDate()).padStart(2, '0')}`;
                    const selectedSpec = String(payload.selectedSpecialization || '').trim();

                    const specDoctorIds = selectedSpec
                      ? (await prisma.doctors.findMany({
                            where: { specialization: { equals: selectedSpec, mode: 'insensitive' } },
                            select: { id: true }
                        }).catch(() => []) || []).map((d) => String(d?.id || '')).filter(Boolean)
                      : [];

                    if (doctorSelection?.doctorUuid || specDoctorIds.length) {
                        const doctorsToCheck = doctorSelection?.doctorUuid
                            ? [doctorSelection.doctorUuid]
                            : specDoctorIds;
                        let anyAvailable = false;
                        let slotMaxPerSlot = 1;
                        for (const dId of doctorsToCheck) {
                            const enforceRes = await enforceDoctorAvailability({
                                doctorId: dId,
                                dateKey,
                                mode: 'onsite',
                                requestedMin
                            });
                            if (!enforceRes?.blocked) {
                                anyAvailable = true;
                                if (enforceRes?.rule?.maxPerSlot && Number.isFinite(Number(enforceRes.rule.maxPerSlot))) {
                                    slotMaxPerSlot = Math.max(1, Math.min(20, Math.trunc(Number(enforceRes.rule.maxPerSlot))));
                                }
                                break;
                            }
                        }
                        if (!anyAvailable) {
                            const err = new Error('Selected time is not available.');
                            err.statusCode = 409;
                            throw err;
                        }

                        const sameSlotRows = specDoctorIds.length
                            ? await tx.appointments.findMany({
                                  where: {
                                      doctor_uuid: { in: specDoctorIds },
                                      consultation_mode: 'onsite',
                                      appointment_date: appointmentDateValue
                                  },
                                  select: { id: true, appointment_time: true, status: true, doctor_uuid: true }
                              }).catch(() => [])
                            : await tx.appointments.findMany({
                                  where: {
                                      doctor_uuid: doctorsToCheck[0],
                                      consultation_mode: 'onsite',
                                      appointment_date: appointmentDateValue
                                  },
                                  select: { id: true, appointment_time: true, status: true }
                              }).catch(() => []);
                        const sameSlot = Array.isArray(sameSlotRows) ? sameSlotRows : [];
                        const byDoctor = new Map();
                        for (const a of sameSlot) {
                            const st = String(a.status || '').trim().toLowerCase();
                            if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) continue;
                            const t = a.appointment_time ? new Date(a.appointment_time) : null;
                            if (!t) continue;
                            const tHhMm = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
                            if (tHhMm !== `${timeHh}:${timeMm}`) continue;
                            const key = String(a.doctor_uuid || doctorSelection?.doctorUuid || '');
                            byDoctor.set(key, (byDoctor.get(key) || 0) + 1);
                        }
                        let totalRemainingCapacity = 0;
                        for (const dId of doctorsToCheck) {
                            const enforceRes = await enforceDoctorAvailability({
                                doctorId: dId,
                                dateKey,
                                mode: 'onsite',
                                requestedMin
                            }).catch(() => null);
                            if (enforceRes?.blocked) continue;
                            const maxPerSlot = (enforceRes?.rule?.maxPerSlot && Number.isFinite(Number(enforceRes.rule.maxPerSlot)))
                                ? Math.max(1, Math.min(20, Math.trunc(Number(enforceRes.rule.maxPerSlot))))
                                : 1;
                            totalRemainingCapacity += Math.max(0, maxPerSlot - (byDoctor.get(dId) || 0));
                        }
                        const pendingUnassigned = specDoctorIds.length
                            ? await tx.appointments.count({
                                where: {
                                    doctor_uuid: null,
                                    assignment_status: 'PENDING_ASSIGNMENT',
                                    consultation_mode: 'onsite',
                                    appointment_date: appointmentDateValue,
                                    appointment_time: timeValue,
                                    reason: { contains: selectedSpec, mode: 'insensitive' },
                                    status: { notIn: ['Cancelled', 'Rejected', 'No-show'] }
                                }
                              }).catch(() => 0)
                            : 0;
                        if (totalRemainingCapacity <= Number(pendingUnassigned || 0)) {
                            const err = new Error('Selected slot is already full.');
                            err.statusCode = 409;
                            throw err;
                        }
                    }
                }

                const overlapRows = await tx.appointments
                    .findMany({
                        where: {
                            appointment_date: appointmentDateValue,
                            appointment_time: timeValue,
                            OR: [
                                { patient_id: patient.id },
                                ...(patient.email ? [{ email: { equals: String(patient.email).trim(), mode: 'insensitive' } }] : [])
                            ]
                        },
                        select: { id: true, status: true }
                    })
                    .catch(() => []);
                const overlap = (Array.isArray(overlapRows) ? overlapRows : []).some((a) => {
                    const st = String(a?.status || '').trim().toLowerCase();
                    if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) return false;
                    if (st.includes('completed') || st.includes('done')) return false;
                    return true;
                });
                if (overlap) {
                    const err = new Error('Patient already has an appointment at the selected date/time.');
                    err.statusCode = 409;
                    throw err;
                }
                const ticketDoctorKey = routeMeta.type === 'onsite_consult'
                    ? (selectedSpecialization || null)
                    : (doctorSelection?.doctorName || null);
                const ticketDateKey = routeMeta.type === 'onsite_consult' && preferredDateRaw ? preferredDateRaw : manilaDateKey;
                const { seq: walkinSeq, ticket: walkinTicket } = await nextWalkInTicket(tx, ticketDateKey, ticketDoctorKey);
                const walkinTicketDate = new Date(`${ticketDateKey}T00:00:00.000Z`);

                const appointment = await tx.appointments.create({
                    data: {
                        first_name: patient.first_name,
                        middle_name: patient.middle_name || null,
                        last_name: patient.last_name,
                        email: patient.email || null,
                        phone: patient.contact_number || null,
                        date_of_birth: patient.date_of_birth || null,
                        gender: patient.gender || null,
                        reason: routeMeta.type === 'onsite_consult'
                            ? `[APPOINTMENT][CLINIC] ${consultServiceName}: ${String(payload.mainConcern || 'Appointment').trim() || 'Appointment'}`
                            : `${routeMeta.reasonPrefix}${selectedSpecialization ? ` [${selectedSpecialization}]` : ''}: ${String(payload.mainConcern || 'Walk-in').trim() || 'Walk-in'}`,
                        appointment_date: appointmentDateValue,
                        appointment_time: timeValue,
                        main_concern: String(payload.mainConcern || '').trim() || null,
                        description: [
                            selectedSpecialization ? `Clinic specialization: ${selectedSpecialization}` : null,
                            routeMeta.type === 'onsite_consult' ? `Service key: ${consultServiceKey}` : null,
                            routeMeta.type === 'onsite_consult' ? `Requested schedule: ${preferredDateRaw}${preferredTimeRaw ? ` ${preferredTimeRaw}` : ''}` : null,
                            String(payload.existingConditions || '').trim() || null,
                            String(payload.routeNote || '').trim() ? `Intake note: ${String(payload.routeNote || '').trim()}` : null
                        ].filter(Boolean).join('\n') || null,
                        blood_pressure: (payload.bp_systolic && payload.bp_diastolic) ? `${payload.bp_systolic}/${payload.bp_diastolic}` : null,
                        heart_rate: Number.isFinite(hr) ? hr : null,
                        respiratory_rate: Number.isFinite(rr) ? rr : null,
                        spo2: Number.isFinite(oxygen) ? oxygen : null,
                        temperature: Number.isFinite(temp) ? temp : null,
                        triage_override_reason: triageNote || null,
                        triage_decided_by: requesterName,
                        triage_final_level: finalTriageLevel,
                        status: routeMeta.type === 'onsite_consult' ? 'Scheduled' : 'Checked-in',
                        consultation_mode: 'onsite',
                        patient_id: patient.id,
                        doctor_id: routeMeta.type === 'onsite_consult' ? selectedSpecialization : (doctorSelection?.doctorName || null),
                        doctor_uuid: routeMeta.type === 'onsite_consult' ? null : (doctorSelection?.doctorUuid || null),
                        walkin_ticket: walkinTicket,
                        walkin_ticket_seq: walkinSeq,
                        walkin_ticket_date: walkinTicketDate,
                        ...(routeMeta.type === 'er_consult'
                            ? {
                                triage_level: triage.level,
                                triage_status: 'Assessed',
                                triage_reasons: {
                                    ...triage,
                                    route: routeMeta.label,
                                    vitals: intakeEntry.vitals
                                },
                                triaged_by: requesterName,
                                triaged_at: now
                            }
                            : {}),
                        assignment_status: routeMeta.type === 'onsite_consult' ? 'PENDING_ASSIGNMENT' : undefined
                    }
                });

                const isHmoActive = Boolean(payload.hasHmo) || Boolean(payload.hasPhilhealth);
                if (isHmoActive) {
                    const hmoProvider = String(payload.hmoProvider || '').trim() || null;
                    const hmoLoa = String(payload.hmoLoaNumber || '').trim() || null;
                    const hmoCard = String(payload.hmoCardNumber || '').trim() || null;
                    const hmoNotesValRaw = String(payload.hmoNotes || '').trim() || null;
                    const hmoNotesVal = paymentModeNoteTag
                        ? [hmoNotesValRaw, paymentModeNoteTag].filter(Boolean).join(' · ')
                        : hmoNotesValRaw;
                    const phNumber = String(payload.philhealthNumber || '').trim() || null;
                    const phDeduct = Number(payload.philhealthDeduction) || 0;
                    const coverageJson = payload.hmoCoveredServices && typeof payload.hmoCoveredServices === 'object'
                        ? JSON.stringify(payload.hmoCoveredServices)
                        : null;
                    const finalHmoStatus = desiredHmoStatus || 'Awaiting LOA';
                    await tx.$executeRawUnsafe(`
                        UPDATE public.appointments
                        SET hmo_provider = ($1::text),
                            hmo_loa_number = ($2::text),
                            hmo_card_number = ($3::text),
                            hmo_notes = ($4::text),
                            philhealth_number = ($5::text),
                            philhealth_deduction = ($6::numeric),
                            hmo_covered_json = ($7::jsonb),
                            is_hmo = TRUE,
                            hmo_status = ($9::text)
                        WHERE id = ($8::bigint)
                    `, hmoProvider, hmoLoa, hmoCard, hmoNotesVal, phNumber, phDeduct, coverageJson, Number(appointment.id), finalHmoStatus).catch(() => {});

                    if (phNumber) {
                        await tx.patients.update({
                            where: { id: patient.id },
                            data: { philhealth_number: patient.philhealth_number || phNumber }
                        }).catch(() => {});
                    }
                }

                if (routeMeta.type === 'onsite_consult') {
                    try {
                        await ensureBillingTablesExist(tx);
                        const amountMoney = toMoney(100);
                        const description = `Consultation Fee - ${consultServiceName}`;

                        let inv = await tx.billing_invoices.findFirst({
                            where: { appointment_id: appointment.id },
                            orderBy: { created_at: 'desc' }
                        }).catch(() => null);
                        if (!inv) {
                            inv = await tx.billing_invoices.create({
                                data: {
                                    patient_id: patient.id,
                                    appointment_id: appointment.id,
                                    status: 'Draft',
                                    notes: `Onsite consultation • ${String(appointment.reason || consultServiceName).trim() || consultServiceName}`.trim(),
                                    created_by: getRequesterEmail(req) || null,
                                    total_amount: amountMoney
                                }
                            });
                            linkedInvoiceId = inv.id;
                            await tx.billing_invoice_items.create({
                                data: {
                                    invoice_id: inv.id,
                                    description,
                                    quantity: 1,
                                    unit_price: amountMoney,
                                    line_total: amountMoney
                                }
                            }).catch(() => null);

                            // Sync HMO data if applicable
                            await syncHmoDataFromAppointmentToInvoice(tx, appointment.id, inv.id, {
                                forceStatus: desiredHmoStatus || null,
                                isHmo: isHmoActive,
                                notes: paymentModeNoteTag || undefined
                            });
                        }
                    } catch (_) {}
                }
                createdRecord = {
                    kind: 'appointment',
                    id: appointment.id.toString(),
                    status: appointment.status || 'Checked-in',
                    ticket: appointment.walkin_ticket || null,
                    target: routeMeta.type === 'onsite_consult'
                        ? (selectedSpecialization ? `${selectedSpecialization} doctor secretary queue` : 'Doctor secretary queue')
                        : (doctorSelection?.doctorName || null),
                    scheduledDate: routeMeta.type === 'onsite_consult'
                        ? `${preferredDateRaw}${preferredTimeRaw ? ` ${preferredTimeRaw}` : ''}`
                        : null,
                    patientEmail: patient.email || null,
                    specialization: selectedSpecialization || null
                };

                const supportTaskTitle =
                    routeMeta.type === 'er_consult'
                        ? `Prepare ${patientName} for ER doctor assessment`
                        : routeMeta.type === 'admission_eval'
                            ? `Support admission evaluation for ${patientName}`
                            : `Guide ${patientName} into doctor consultation flow`;

                await tx.$executeRawUnsafe(
                    `
                        INSERT INTO public.nurse_tasks
                            (department, shift_label, title, priority, due_time, patient_id, patient_name, status, completed, created_by_name, created_by_email)
                        VALUES
                            ($1, $2, $3, $4, $5, $6::uuid, $7, 'open', false, $8, $9)
                    `,
                    routeMeta.type === 'er_consult' ? 'ER' : 'MEDICINE',
                    null,
                    supportTaskTitle,
                    routeMeta.type === 'er_consult' ? 'urgent' : 'routine',
                    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    patient.id,
                    patientName,
                    requesterName,
                    getRequesterEmail(req)
                ).catch(() => null);
            } else if (routeMeta.creates === 'clinical_order') {
                const routeServices = routeMeta.type === 'lab'
                    ? (Array.isArray(payload.selectedLabServices) ? payload.selectedLabServices : [])
                    : (Array.isArray(payload.selectedImagingServices) ? payload.selectedImagingServices : []);
                const service = String(routeServices[0] || payload.mainConcern || '').trim() || routeMeta.label;
                const isEcg = /\becg\b/i.test(service);
                const kind = routeMeta.type === 'lab' ? 'Laboratory' : isEcg ? 'ECG' : 'Radiology';
                const assignedRole = routeMeta.type === 'lab' ? 'medtech' : isEcg ? 'ecg_operator' : 'radiographer';
                const pricing = resolveClinicalServicePricing({ kind, service });
                const hmoActive = Boolean(payload.hasHmo) || Boolean(payload.hasPhilhealth);
                const coverage = payload.hmoCoveredServices && typeof payload.hmoCoveredServices === 'object' ? payload.hmoCoveredServices : {};
                const serviceType = routeMeta.type === 'lab' ? 'lab' : 'imaging';
                const configuredUnitPrice = Number(pricing?.unitPrice || 0);
                const pillMarkedCovered = hmoActive && Boolean(coverage[serviceType]);
                const gross = configuredUnitPrice;
                const phDedRaw = hmoActive && payload.hasPhilhealth ? Math.max(0, Number(payload.philhealthDeduction || 0)) : 0;
                const loaRaw = hmoActive && payload.hasHmo ? Math.max(0, Number(payload.hmoLoaApprovedAmount || 0)) : 0;
                const realPh = gross > 0 && phDedRaw > 0 ? Math.min(gross, phDedRaw) : 0;
                const afterPh = Math.max(0, gross - realPh);
                let realLoa = 0;
                if (loaRaw > 0) {
                    realLoa = Math.min(afterPh, loaRaw);
                } else if (pillMarkedCovered && hmoActive) {
                    realLoa = afterPh;
                }
                const patientPayable = Math.max(0, gross - realPh - realLoa);
                const coveredByHmo = hmoActive && (realPh + realLoa > 0.0099);
                const patientNeedsPay = patientPayable > 0.0099;
                const baseStatus = pricing?.configured && configuredUnitPrice > 0 ? 'For Payment' : 'Pending';
                const status = !coveredByHmo
                    ? baseStatus
                    : patientNeedsPay
                        ? 'For Payment'
                        : 'Paid';
                if (coveredByHmo) mainClinicalOrderHmoCoveredCents = (realPh + realLoa);
                const priority = triage.level <= 2 ? 'urgent' : 'routine';

                const detailLines = [
                    `${routeMeta.reasonPrefix} ${routeMeta.label}`,
                    `Service: ${service}`,
                    String(payload.existingConditions || '').trim() ? `Existing Conditions: ${String(payload.existingConditions || '').trim()}` : null,
                    String(payload.routeNote || '').trim() ? `Route Note: ${String(payload.routeNote || '').trim()}` : null,
                    `Vitals: Temp ${intakeEntry.vitals.temperature ?? '—'}, BP ${intakeEntry.vitals.bloodPressure || '—'}, HR ${intakeEntry.vitals.heartRate ?? '—'}, SpO2 ${intakeEntry.vitals.spo2 ?? '—'}`,
                    `Pain Level: ${Number.isFinite(Number(payload.painLevel)) ? Number(payload.painLevel) : '—'}`
                ].filter(Boolean);

                try {
                    const { ticket: orderTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], routeMeta.type === 'lab' ? 'LAB' : isEcg ? 'ECG' : 'IMG');

                    const order = await tx.clinical_orders.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            kind,
                            service,
                            priority,
                            status,
                            notes: `Ticket: ${orderTicket}\n${detailLines.join('\n')}`,
                            ordered_by_name: requesterName,
                            ordered_by_role: 'Nurse',
                            assigned_role: assignedRole,
                            assigned_to: null,
                            scheduled_at: null,
                            updated_at: new Date()
                        }
                    });

                    // PROMPT L13 FIX: Always create a REAL billing_invoice PER LAB/IMAGING service so:
                    //   (a) counted sa Billing list, (b) linked sa HMO claim monitoring, (c) Lab Payments modal jump possible
                    if (pricing?.configured && configuredUnitPrice > 0) {
                        try {
                            await ensureBillingTablesExist(tx).catch(() => null);
                            const unitPriceMoney = toMoney(configuredUnitPrice);
                            const invoiceMarker = `Walk-in Lab Order #${String(order.id)}`;
                            const hmoCoveredNow = coveredByHmo;
                            const invStatusNow = hmoCoveredNow ? (patientNeedsPay ? 'Ready' : 'Paid') : (status === 'Pending' ? 'Draft' : status);
                            const inv = await tx.billing_invoices.create({
                                data: {
                                    patient_id: patient.id,
                                    status: invStatusNow,
                                    notes: `${invoiceMarker} • ${kind} - ${service} • Nurse Walk-in Intake`,
                                    created_by: getRequesterEmail(req) || requesterName || null,
                                    total_amount: unitPriceMoney
                                }
                            });
                            await tx.billing_invoice_items.create({
                                data: {
                                    invoice_id: inv.id,
                                    description: `${kind} - ${service}${hmoCoveredNow ? ' • HMO Covered' : ''}`,
                                    quantity: 1,
                                    unit_price: unitPriceMoney,
                                    line_total: unitPriceMoney
                                }
                            }).catch(() => null);
                            if (!linkedInvoiceId) linkedInvoiceId = inv.id;
                            // Auto-create HMO claim linkage if HMO active:
                            if (hmoActive) {
                                try {
                                    const userLoa = Number(payload.hmoLoaApprovedAmount || 0);
                                    const fallbackLoa = coveredByHmo ? configuredUnitPrice : null;
                                    const baseNote = coveredByHmo
                                        ? `Walk-in ${kind} #${order.id}: HMO pre-covered at intake`
                                        : `Walk-in ${kind} #${order.id}`;
                                    const finalNote = paymentModeNoteTag
                                        ? [baseNote, paymentModeNoteTag].filter(Boolean).join(' · ')
                                        : baseNote;
                                    await syncHmoDataFromAppointmentToInvoice(tx, null, inv.id, {
                                        patientId: patient.id,
                                        patientName,
                                        hmoProvider: hmoSave ? (String(payload.hmoProvider || '').trim() || null) : null,
                                        hmoLoaNumber: hmoSave ? (String(payload.hmoLoaNumber || '').trim() || null) : null,
                                        hmoCardNumber: hmoSave ? (String(payload.hmoCardNumber || '').trim() || null) : null,
                                        philhealthDeduction: hmoSave ? Number(payload.philhealthDeduction || 0) : null,
                                        loaApprovedAmount: Number.isFinite(userLoa) && userLoa > 0 ? userLoa : fallbackLoa,
                                        requester: getRequesterEmail(req) || requesterName || null,
                                        notes: finalNote,
                                        forceStatus: desiredHmoStatus || null,
                                        isHmo: true
                                    }).catch(() => null);
                                } catch (_e1) {}
                            }
                        } catch (_invCreateErr) {
                            console.warn('[Walk-in] Lab order invoice create failed (non-fatal):', _invCreateErr);
                        }
                    }

                    createdRecord = {
                        kind: 'clinical_order',
                        id: order.id.toString(),
                        status: order.status || status,
                        ticket: orderTicket,
                        target: routeMeta.requestTarget || routeMeta.label
                    };
                } catch (_) {
                    const request = await tx.requests.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            requested_by: requesterName,
                            message: detailLines.join('\n'),
                            status: 'Pending'
                        }
                    });
                    createdRecord = {
                        kind: 'request',
                        id: request.id.toString(),
                        status: request.status || 'Pending',
                        target: routeMeta.requestTarget || routeMeta.label
                    };
                }
            } else {
                const detailLines = [
                    `${routeMeta.reasonPrefix} ${routeMeta.label}`,
                    `Main Concern: ${String(payload.mainConcern || '').trim() || 'Walk-in service request'}`,
                    String(payload.existingConditions || '').trim() ? `Existing Conditions: ${String(payload.existingConditions || '').trim()}` : null,
                    String(payload.routeNote || '').trim() ? `Route Note: ${String(payload.routeNote || '').trim()}` : null,
                    `Vitals: Temp ${intakeEntry.vitals.temperature ?? '—'}, BP ${intakeEntry.vitals.bloodPressure || '—'}, HR ${intakeEntry.vitals.heartRate ?? '—'}, SpO2 ${intakeEntry.vitals.spo2 ?? '—'}`,
                    `Pain Level: ${Number.isFinite(Number(payload.painLevel)) ? Number(payload.painLevel) : '—'}`
                ].filter(Boolean);

                const generatedTickets = [];
                if (routeMeta.type === 'pharmacy') {
                    const { ticket: pharmTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], 'PHARM');
                    generatedTickets.push(pharmTicket);
                }

                const request = await tx.requests.create({
                    data: {
                        patient_id: patient.id,
                        patient_name: patientName,
                        requested_by: requesterName,
                        message: detailLines.join('\n'),
                        status: 'Pending'
                    }
                });
                createdRecord = {
                    kind: 'request',
                    id: request.id.toString(),
                    status: request.status || 'Pending',
                    ticket: generatedTickets.length > 0 ? generatedTickets.join(', ') : null,
                    target: routeMeta.requestTarget || routeMeta.label,
                    services: [
                        ...(payload.selectedLabServices || []),
                        ...(payload.selectedImagingServices || [])
                    ].join(', ')
                };
            }

            // --- COMMON LOGIC FOR SELECTED LAB/IMAGING SERVICES ---
            // This now runs for ALL walk-in intakes if checkboxes were checked
            const generatedExtraTickets = [];
            const commonDetailLines = [
                `Vitals: Temp ${intakeEntry.vitals.temperature ?? '—'}, BP ${intakeEntry.vitals.bloodPressure || '—'}, HR ${intakeEntry.vitals.heartRate ?? '—'}, SpO2 ${intakeEntry.vitals.spo2 ?? '—'}`,
                `Main Concern: ${String(payload.mainConcern || '').trim() || 'Walk-in'}`
            ];
            const hmoSave = Boolean(payload.hasHmo) || Boolean(payload.hasPhilhealth);
            const hmoActiveExtra = Boolean(payload.hasHmo) || Boolean(payload.hasPhilhealth);
            const coverageExtra = payload.hmoCoveredServices && typeof payload.hmoCoveredServices === 'object' ? payload.hmoCoveredServices : {};

            const extraLabServices = Array.isArray(payload.selectedLabServices)
                ? (routeMeta.type === 'lab' ? payload.selectedLabServices.slice(1) : payload.selectedLabServices)
                : [];
            if (extraLabServices.length > 0) {
                for (const service of extraLabServices) {
                    const pricing = resolveClinicalServicePricing({ kind: 'Laboratory', service });
                    const configuredUnitPrice = Number(pricing?.unitPrice || 0);
                    const pillMarkedCovered = hmoActiveExtra && Boolean(coverageExtra.lab);
                    const gross = configuredUnitPrice;
                    const phDedRaw = hmoActiveExtra && payload.hasPhilhealth ? Math.max(0, Number(payload.philhealthDeduction || 0)) : 0;
                    const loaRaw = hmoActiveExtra && payload.hasHmo ? Math.max(0, Number(payload.hmoLoaApprovedAmount || 0)) : 0;
                    const realPh = gross > 0 && phDedRaw > 0 ? Math.min(gross, phDedRaw) : 0;
                    const afterPh = Math.max(0, gross - realPh);
                    let realLoa = 0;
                    if (loaRaw > 0) realLoa = Math.min(afterPh, loaRaw);
                    else if (pillMarkedCovered) realLoa = afterPh;
                    const patientPayable = Math.max(0, gross - realPh - realLoa);
                    const covered = hmoActiveExtra && (realPh + realLoa > 0.0099);
                    const patientPayNow = patientPayable > 0.0099;
                    const baseStatus = pricing?.configured && configuredUnitPrice > 0 ? 'For Payment' : 'Pending';
                    const status = !covered
                        ? baseStatus
                        : patientPayNow
                            ? 'For Payment'
                            : 'Paid';
                    if (covered) extraHmoTotalCents += (realPh + realLoa);
                    const { ticket: labTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], 'LAB');
                    generatedExtraTickets.push(labTicket);
                    const order = await tx.clinical_orders.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            kind: 'Laboratory',
                            service: service,
                            priority: 'Routine',
                            status,
                            notes: `Auto-created from Nurse Walk-In Intake\nTicket: ${labTicket}\n${commonDetailLines.join('\n')}`,
                            ordered_by_name: requesterName,
                            ordered_by_role: 'Nurse',
                            assigned_role: 'medtech',
                            assigned_to: null,
                            scheduled_at: null,
                            updated_at: new Date()
                        }
                    });

                    // PROMPT L13: per-lab invoice create so counted properly
                    if (pricing?.configured && configuredUnitPrice > 0) {
                        try {
                            await ensureBillingTablesExist(tx).catch(() => null);
                            const unitPriceMoney = toMoney(configuredUnitPrice);
                            const invoiceMarker = `Walk-in Lab Order #${String(order.id)}`;
                            const invStatusNow = covered ? 'Paid' : (status === 'Pending' ? 'Draft' : status);
                            const inv = await tx.billing_invoices.create({
                                data: {
                                    patient_id: patient.id,
                                    status: invStatusNow,
                                    notes: `${invoiceMarker} • Laboratory - ${service} • Nurse Walk-in Intake Extra`,
                                    created_by: getRequesterEmail(req) || requesterName || null,
                                    total_amount: unitPriceMoney
                                }
                            });
                            await tx.billing_invoice_items.create({
                                data: {
                                    invoice_id: inv.id,
                                    description: `Laboratory - ${service}${covered ? ' • HMO Covered' : ''}`,
                                    quantity: 1,
                                    unit_price: unitPriceMoney,
                                    line_total: unitPriceMoney
                                }
                            }).catch(() => null);
                            if (!linkedInvoiceId) linkedInvoiceId = inv.id;
                            if (hmoActiveExtra) {
                                const baseNote = covered ? `Walk-in Lab #${order.id}: HMO pre-covered at intake` : `Walk-in Lab #${order.id}`;
                                const finalNote = paymentModeNoteTag
                                    ? [baseNote, paymentModeNoteTag].filter(Boolean).join(' · ')
                                    : baseNote;
                                await syncHmoDataFromAppointmentToInvoice(tx, null, inv.id, {
                                    patientId: patient.id,
                                    patientName,
                                    hmoProvider: hmoSave ? (String(payload.hmoProvider || '').trim() || null) : null,
                                    hmoLoaNumber: hmoSave ? (String(payload.hmoLoaNumber || '').trim() || null) : null,
                                    hmoCardNumber: hmoSave ? (String(payload.hmoCardNumber || '').trim() || null) : null,
                                    philhealthDeduction: hmoSave ? Number(payload.philhealthDeduction || 0) : null,
                                    loaApprovedAmount: (() => {
                                        const u = Number(payload.hmoLoaApprovedAmount || 0);
                                        return Number.isFinite(u) && u > 0 ? u : (covered ? configuredUnitPrice : null);
                                    })(),
                                    requester: getRequesterEmail(req) || requesterName || null,
                                    notes: finalNote,
                                    forceStatus: desiredHmoStatus || null,
                                    isHmo: true
                                }).catch(() => null);
                            }
                        } catch (_einvoice) {
                            console.warn('[Walk-in] Extra Lab invoice create warn:', _einvoice);
                        }
                    }
                }
            }

            const extraImagingServices = Array.isArray(payload.selectedImagingServices)
                ? (routeMeta.type === 'imaging' ? payload.selectedImagingServices.slice(1) : payload.selectedImagingServices)
                : [];
            if (extraImagingServices.length > 0) {
                for (const service of extraImagingServices) {
                    const isECG = /\becg\b/i.test(service) || String(service).toLowerCase().includes('ecg');
                    const kind = isECG ? 'ECG' : 'Radiology';
                    const assignedRole = isECG ? 'ecg_operator' : 'radiographer';
                    const pricing = resolveClinicalServicePricing({ kind, service });
                    const configuredUnitPrice = Number(pricing?.unitPrice || 0);
                    const pillMarkedCovered = hmoActiveExtra && Boolean(coverageExtra.imaging);
                    const gross = configuredUnitPrice;
                    const phDedRaw = hmoActiveExtra && payload.hasPhilhealth ? Math.max(0, Number(payload.philhealthDeduction || 0)) : 0;
                    const loaRaw = hmoActiveExtra && payload.hasHmo ? Math.max(0, Number(payload.hmoLoaApprovedAmount || 0)) : 0;
                    const realPh = gross > 0 && phDedRaw > 0 ? Math.min(gross, phDedRaw) : 0;
                    const afterPh = Math.max(0, gross - realPh);
                    let realLoa = 0;
                    if (loaRaw > 0) realLoa = Math.min(afterPh, loaRaw);
                    else if (pillMarkedCovered) realLoa = afterPh;
                    const patientPayable = Math.max(0, gross - realPh - realLoa);
                    const covered = hmoActiveExtra && (realPh + realLoa > 0.0099);
                    const patientPayNow = patientPayable > 0.0099;
                    const baseStatus = pricing?.configured && configuredUnitPrice > 0 ? 'For Payment' : 'Pending';
                    const status = !covered
                        ? baseStatus
                        : patientPayNow
                            ? 'For Payment'
                            : 'Paid';
                    if (covered) extraHmoTotalCents += (realPh + realLoa);
                    const { ticket: imgTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], isECG ? 'ECG' : 'IMG');
                    generatedExtraTickets.push(imgTicket);
                    const order = await tx.clinical_orders.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            kind,
                            service: service,
                            priority: 'Routine',
                            status,
                            notes: `Auto-created from Nurse Walk-In Intake\nTicket: ${imgTicket}\n${commonDetailLines.join('\n')}`,
                            ordered_by_name: requesterName,
                            ordered_by_role: 'Nurse',
                            assigned_role: assignedRole,
                            assigned_to: null,
                            scheduled_at: null,
                            updated_at: new Date()
                        }
                    });

                    // PROMPT L13: per-imaging invoice create
                    if (pricing?.configured && configuredUnitPrice > 0) {
                        try {
                            await ensureBillingTablesExist(tx).catch(() => null);
                            const unitPriceMoney = toMoney(configuredUnitPrice);
                            const invoiceMarker = `Walk-in Lab Order #${String(order.id)}`;
                            const invStatusNow = covered ? 'Paid' : (status === 'Pending' ? 'Draft' : status);
                            const inv = await tx.billing_invoices.create({
                                data: {
                                    patient_id: patient.id,
                                    status: invStatusNow,
                                    notes: `${invoiceMarker} • ${kind} - ${service} • Nurse Walk-in Intake Extra`,
                                    created_by: getRequesterEmail(req) || requesterName || null,
                                    total_amount: unitPriceMoney
                                }
                            });
                            await tx.billing_invoice_items.create({
                                data: {
                                    invoice_id: inv.id,
                                    description: `${kind} - ${service}${covered ? ' • HMO Covered' : ''}`,
                                    quantity: 1,
                                    unit_price: unitPriceMoney,
                                    line_total: unitPriceMoney
                                }
                            }).catch(() => null);
                            if (!linkedInvoiceId) linkedInvoiceId = inv.id;
                            if (hmoActiveExtra) {
                                const baseNote = covered ? `Walk-in ${kind} #${order.id}: HMO pre-covered at intake` : `Walk-in ${kind} #${order.id}`;
                                const finalNote = paymentModeNoteTag
                                    ? [baseNote, paymentModeNoteTag].filter(Boolean).join(' · ')
                                    : baseNote;
                                await syncHmoDataFromAppointmentToInvoice(tx, null, inv.id, {
                                    patientId: patient.id,
                                    patientName,
                                    hmoProvider: hmoSave ? (String(payload.hmoProvider || '').trim() || null) : null,
                                    hmoLoaNumber: hmoSave ? (String(payload.hmoLoaNumber || '').trim() || null) : null,
                                    hmoCardNumber: hmoSave ? (String(payload.hmoCardNumber || '').trim() || null) : null,
                                    philhealthDeduction: hmoSave ? Number(payload.philhealthDeduction || 0) : null,
                                    loaApprovedAmount: (() => {
                                        const u = Number(payload.hmoLoaApprovedAmount || 0);
                                        return Number.isFinite(u) && u > 0 ? u : (covered ? configuredUnitPrice : null);
                                    })(),
                                    requester: getRequesterEmail(req) || requesterName || null,
                                    notes: finalNote,
                                    forceStatus: desiredHmoStatus || null,
                                    isHmo: true
                                }).catch(() => null);
                            }
                        } catch (_einvoice) {
                            console.warn('[Walk-in] Extra Imaging invoice create warn:', _einvoice);
                        }
                    }
                }
            }

            // If extra tickets were generated, append them to the main ticket display
            if (generatedExtraTickets.length > 0) {
                const extraTicketStr = generatedExtraTickets.join(', ');
                if (createdRecord.ticket) {
                    createdRecord.ticket = `${createdRecord.ticket}, ${extraTicketStr}`;
                } else {
                    createdRecord.ticket = extraTicketStr;
                }
            }

            // Fixed 100 pesos billing for selected services (flat: regardless of count = ₱100 total)
            const hasServices = (payload.selectedLabServices?.length > 0) || (payload.selectedImagingServices?.length > 0);
            if (hasServices) {
                await ensureBillingTablesExist(tx).catch(() => null);
                const totalServices = Number(payload.selectedLabServices?.length || 0) + Number(payload.selectedImagingServices?.length || 0);
                const amountMoney = toMoney(100);
                const description = totalServices > 1
                    ? `Walk-In Service Fee (${totalServices} services, Flat Rate)`
                    : `Walk-In Service Fee (${payload.selectedLabServices?.length ? payload.selectedLabServices[0] : payload.selectedImagingServices[0]})`;
                const inv = await tx.billing_invoices.create({
                    data: {
                        patient_id: patient.id,
                        status: 'For Payment',
                        notes: 'Nurse Walk-In Service Fee (Flat ₱100 Fixed Rate) — Registration & Onsite Service Intake',
                        created_by: getRequesterEmail(req) || requesterName || null,
                        total_amount: amountMoney
                    }
                });
                linkedInvoiceId = inv.id;
                await tx.billing_invoice_items.create({
                    data: {
                        invoice_id: inv.id,
                        description,
                        quantity: Math.max(1, totalServices),
                        unit_price: amountMoney,
                        line_total: amountMoney
                    }
                }).catch(() => null);
            }

            await tx.activity_logs.create({
                data: {
                    actor_name: requesterName,
                    role: getRequesterRole(req) || 'nurse',
                    action: 'Walk-In Intake Created',
                    target: patientName,
                    details: `${routeMeta.label} • ${createdRecord?.kind || 'record'} #${createdRecord?.id || 'n/a'}`
                }
            }).catch(() => null);

            if (Boolean(payload.hasHmo) && desiredHmoStatus) {
                // Ensure patient registry row has HMO flags so fallback 3rd UNION ALL hmo-queue leg picks it up
                try {
                    const hmoProv = String(payload.hmoProvider || '').trim() || null;
                    const hmoCard = String(payload.hmoCardNumber || '').trim() || null;
                    const phAmt = Number(payload.philhealthDeduction) || 0;
                    await tx.$executeRawUnsafe(`
                        UPDATE public.patients
                        SET is_hmo = TRUE,
                            hmo_provider = $1::text,
                            hmo_card_number = $2::text,
                            philhealth_amount = $3::numeric
                        WHERE id::text = $4::text
                    `, hmoProv, hmoCard, phAmt, String(patient.id));
                } catch (_hpat) {
                    console.warn('[HMO Intake] Patient HMO flag update failed (non-fatal):', _hpat);
                }

                const hmoProv = String(payload.hmoProvider || '').trim() || null;
                const loaNum = String(payload.hmoLoaNumber || '').trim() || null;
                const hmoCard = String(payload.hmoCardNumber || '').trim() || null;
                const hmoNts = String(payload.hmoNotes || '').trim() || null;
                const phAmt = Number(payload.philhealthDeduction) || 0;

                // Ensure we have an invoice to link to
                if (!linkedInvoiceId) {
                    await ensureBillingTablesExist(tx).catch(() => null);
                    const onSiteAmtInt = hasServices ? 100 : 0;
                    const impliedTotal = onSiteAmtInt + mainClinicalOrderHmoCoveredCents + extraHmoTotalCents;
                    const inv = await tx.billing_invoices.create({
                        data: {
                            patient_id: patient.id,
                            status: 'Draft',
                            notes: `HMO Monitoring Record • ${routeMeta.label} Intake`,
                            created_by: getRequesterEmail(req) || requesterName || null,
                            total_amount: toMoney(Math.max(100, impliedTotal))
                        }
                    });
                    linkedInvoiceId = inv.id;
                }

                await tx.$executeRawUnsafe(`
                    UPDATE public.billing_invoices
                    SET is_hmo = TRUE, hmo_provider = $1::text, hmo_status = $2::text, updated_at = now()
                    WHERE id = $3::bigint
                `, hmoProv, desiredHmoStatus, BigInt(linkedInvoiceId)).catch(() => null);

                // Upsert using an invoice-scoped lock so legacy databases do
                // not need a unique constraint for safe, duplicate-free writes.
                const autoApproveAmount = desiredHmoStatus === 'Approved'
                    ? Math.max(0, Number(payload.hmoLoaApprovedAmount || 0))
                    : 0;
                const apptIdForClaim = createdRecord && createdRecord.id ? String(createdRecord.id) : null;
                const coverageJson = (coverageExtra && Object.keys(coverageExtra).length > 0) ? JSON.stringify(coverageExtra) : null;
                await upsertWalkInHmoClaim(tx, {
                    invoiceId: linkedInvoiceId,
                    appointmentId: apptIdForClaim,
                    patientId: String(patient.id),
                    patientName,
                    provider: hmoProv,
                    loaNumber: loaNum,
                    cardNumber: hmoCard,
                    philhealthDeduction: phAmt,
                    approvedAmount: autoApproveAmount,
                    status: desiredHmoStatus,
                    coverageJson,
                    notes: hmoNts,
                    requester: getRequesterEmail(req) || requesterName || null
                });

                // AUTO-UPDATE invoice status once HMO claim is Approved:
                // If HMO + Philhealth fully cover invoice → status = 'Paid'; else → status = 'Ready' (cashier collects balance)
                if (linkedInvoiceId && desiredHmoStatus === 'Approved') {
                    try {
                        await ensureBillingTablesExist(tx).catch(() => null);
                        const invIdP1 = BigInt(linkedInvoiceId);
                        const invRows = await tx.$queryRawUnsafe(`
                            SELECT id, total_amount, status FROM public.billing_invoices WHERE id = $1::bigint
                        `, invIdP1).catch(() => []);
                        const inv = Array.isArray(invRows) && invRows.length ? invRows[0] : null;
                        if (inv) {
                            const totalAmt = Math.max(0, Number(inv.total_amount || 0));
                            const maxPh = Math.min(totalAmt, Math.max(0, Number(phAmt || 0)));
                            const afterPh = Math.max(0, totalAmt - maxPh);
                            const appliedHmo = Math.min(afterPh, Math.max(0, Number(autoApproveAmount || 0)));
                            const patientPay = Math.max(0, totalAmt - maxPh - appliedHmo);
                            const newStatus = patientPay <= 0.0001 ? 'Paid' : 'Ready';
                            const invIdP2 = BigInt(linkedInvoiceId);
                            await tx.$executeRawUnsafe(`
                                UPDATE public.billing_invoices
                                SET status = $1::text, updated_at = now()
                                WHERE id = $2::bigint AND status IN ('Draft', 'For Payment', 'Pending')
                            `, newStatus, invIdP2).catch(() => {});
                        }
                    } catch (invoiceUpdateErr) {
                        console.error('[HMO Intake] Failed to sync invoice status:', invoiceUpdateErr);
                    }
                }
            }

            // Build HMO summary for patient slip / handoff / response
            let hmoSummary = null;
            if (hmoSave) {
                try {
                    const hmoProv = String(payload.hmoProvider || '').trim() || null;
                    const loaNum = String(payload.hmoLoaNumber || '').trim() || null;
                    const hmoCard = String(payload.hmoCardNumber || '').trim() || null;
                    const phAmt = Number(payload.philhealthDeduction) || 0;
                    const onSiteAmt = hasServices ? 100 : 0;
                    const coverageAmount = onSiteAmt + mainClinicalOrderHmoCoveredCents + extraHmoTotalCents;
                    let totalAmt = 0;
                    let invStatus = null;
                    if (linkedInvoiceId) {
                        const invIdParam = BigInt(linkedInvoiceId);
                        const qRows = await tx.$queryRawUnsafe(
                            `SELECT total_amount, status FROM public.billing_invoices WHERE id = $1::bigint`,
                            invIdParam
                        ).catch(() => []);
                        if (Array.isArray(qRows) && qRows.length) {
                            totalAmt = Math.max(0, Number(qRows[0].total_amount || 0));
                            invStatus = String(qRows[0].status || null);
                        }
                    }
                    if (!totalAmt || totalAmt <= 0.0001) {
                        totalAmt = Math.max(100, onSiteAmt + mainClinicalOrderHmoCoveredCents + extraHmoTotalCents);
                    }
                    const maxPh = Math.min(totalAmt, Math.max(0, Number(phAmt || 0)));
                    const afterPh = Math.max(0, totalAmt - maxPh);
                    const appliedHmo = Math.min(afterPh, Math.max(0, Number(coverageAmount || 0)));
                    const patientPay = Math.max(0, totalAmt - maxPh - appliedHmo);
                    hmoSummary = {
                        status: 'Approved',
                        provider: hmoProv,
                        loa_number: loaNum,
                        card_number: hmoCard,
                        philhealth_deduction: toMoney(maxPh),
                        hmo_coverage: toMoney(appliedHmo),
                        total_coverage: toMoney(maxPh + appliedHmo),
                        patient_balance: toMoney(patientPay),
                        invoice_total: toMoney(totalAmt),
                        invoice_id: linkedInvoiceId ? String(linkedInvoiceId) : null,
                        invoice_status: invStatus,
                        coverage: (coverageExtra && Object.keys(coverageExtra).length ? coverageExtra : null)
                    };
                } catch (_hsum) {
                    console.error('[HMO Intake] HMO summary compute failed:', _hsum);
                }
            }

            return { patient, createdRecord, hmoSummary };
        }, { timeout: 45000 });

        // ============== LAYER 2 FALLBACK SAFETY NET ==============
        // GUARANTEES: HMO claim row exists if patient had HMO + status approved/awaiting
        // Even if layer1 syncHmo failed silently (old bugs/crashes/.catch(()=>null)), this runs directly with fresh prisma
        // after commit, using an invoice-scoped advisory lock so duplicates never happen.
        try {
            const hasAnyHmoFlag = Boolean(payload.hasHmo) || Boolean(payload.hasPhilhealth);
            const shouldCreateClaim = hasAnyHmoFlag && desiredHmoStatus && !hmoRejectedFlag;
            if (shouldCreateClaim && result?.patient?.id) {
                const patientIdRaw = String(result.patient.id || '').trim();
                const patientFullName = (() => {
                    const f = String(result.patient.first_name || result.createdRecord?.patientFirstName || result.patient.firstName || '').trim();
                    const m = String(result.patient.middle_name || result.patient.middleName || '').trim();
                    const l = String(result.patient.last_name || result.createdRecord?.patientLastName || result.patient.lastName || '').trim();
                    return [f, m, l].filter(Boolean).join(' ') || null;
                })();
                const hmoProv = String(payload.hmoProvider || '').trim() || null;
                const loaNum = String(payload.hmoLoaNumber || '').trim() || null;
                const hmoCard = String(payload.hmoCardNumber || '').trim() || null;
                const phAmt = Number(payload.philhealthDeduction) || 0;
                const loaAmt = Number(payload.hmoLoaApprovedAmount) || 0;
                const apptId = result?.createdRecord?.appointmentId || result?.createdRecord?.id ? String(result.createdRecord.appointmentId || result.createdRecord.id) : null;
                const notes = [String(payload.hmoNotes || '').trim(), paymentModeNoteTag].filter(Boolean).join(' · ') || null;
                const requester = getRequesterEmail(req) || requesterName || null;

                // Find all recent invoices for this patient created in last 5 minutes (covers all per-service walkin invoices)
                // Use ::text match to avoid UUID cast crash if patient_id column is varchar not UUID
                const candidateInvoices = await prisma.$queryRawUnsafe(`
                    SELECT DISTINCT bi.id FROM public.billing_invoices bi
                    WHERE bi.patient_id::text = $1::text
                      AND bi.created_at >= (now() - interval '15 minutes')
                    ORDER BY bi.id DESC
                `, patientIdRaw).catch(() => []);
                if (Array.isArray(candidateInvoices) && candidateInvoices.length) {
                    for (const row of candidateInvoices) {
                        const invId = row?.id ? (typeof row.id === 'bigint' ? row.id : BigInt(String(row.id))) : null;
                        if (!invId) continue;
                        try {
                            const apptIdSafe = apptId ? BigInt(String(apptId)) : null;
                            await prisma.$transaction((claimTx) => upsertWalkInHmoClaim(claimTx, {
                                invoiceId: invId,
                                appointmentId: apptIdSafe,
                                patientId: patientIdRaw,
                                patientName: patientFullName,
                                provider: hmoProv,
                                loaNumber: loaNum,
                                cardNumber: hmoCard,
                                philhealthDeduction: phAmt,
                                approvedAmount: loaAmt,
                                status: desiredHmoStatus,
                                coverageJson: null,
                                notes,
                                requester
                            }));
                        } catch (_ins) {
                            // Layer 1 already committed the primary claim path.
                        }
                    }
                }
            }
        } catch (_layer2) {
            // Safety net failing should never break user response
            console.error('[HMO Layer2] Safety net insert failed:', _layer2);
        }

        let emailSent = false;
        let emailQueued = false;
        if (routeMeta.type === 'onsite_consult') {
            const to = normalizeEmail(result?.createdRecord?.patientEmail || result?.patient?.email || '');
            const scheduled = String(result?.createdRecord?.scheduledDate || '').trim();
            const specialization = String(result?.createdRecord?.specialization || '').trim();
            if (to && scheduled) {
                const subject = `Appointment Request Received • ${scheduled}`;
                const serviceLabel = specialization ? `${specialization} Consultation` : 'Clinic Consultation';
                const templateParams = {
                    subject: 'Appointment Request Received',
                    message_body: 'Your request for an onsite consultation has been received and is currently pending approval from the Doctor Secretary.',
                    service_label: serviceLabel,
                    scheduled_time: scheduled,
                    status_label: 'Pending Approval',
                    footer_note: 'You will receive another email once your appointment has been approved and assigned to a doctor. Thank you for choosing Pascual General Hospital.'
                };
                
                // The intake is already committed. Delivery happens after the
                // response path so a slow email provider cannot make a saved
                // registration appear to have failed.
                emailQueued = true;
                void sendAppointmentSummaryEmail({ to, subject, templateParams })
                    .then((sent) => {
                        if (!sent?.ok) console.warn('[Walk-in intake] Appointment email was not delivered.');
                    })
                    .catch((error) => console.error('[Walk-in intake] Appointment email failed:', error?.message || error));
            }
        }

        res.status(201).json({
            patient: result.patient,
            routeType: routeMeta.type,
            routeLabel: routeMeta.label,
            routing: { ...result.createdRecord, emailSent, emailQueued },
            hmo: result.hmoSummary || null
        });
    } catch (err) {
        sendError(res, err, 'Unable to process walk-in intake.');
    }
});

// POST create new patient
router.post('/', requireRole(['admin']), async (req, res) => {
    try {
        const {
            firstName, lastName, middleName, dateOfBirth, gender, civilStatus,
            nationality, bloodType, allergies, philHealthNumber,
            phone, email, password,
            street, streetAddress, city, province, postalCode, country,
            emergencyName1, emergencyRel1, emergencyContact1,
            emergencyName2, emergencyRel2, emergencyContact2,
            emergencyName3, emergencyRel3, emergencyContact3
        } = req.body;

        // Check if email already exists
        const normalizedEmail = email ? normalizeEmail(email) : '';
        const existingPatient = normalizedEmail
            ? await prisma.patients.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } })
            : null;
        if (existingPatient) {
            return res.status(400).json({ message: "Email already exists" });
        }

        // Hash password
        // const salt = await bcrypt.genSalt(10);
        // const hashedPassword = await bcrypt.hash(password, salt);
        // NOTE: Supabase Auth should ideally handle passwords, but if you are storing them here, 
        // there is NO password field in the introspected 'patients' table. 
        // We will skip inserting password for now as the schema does not support it.

        // Structure Emergency Contacts
        const emergencyContacts = [];
        if (emergencyName1) emergencyContacts.push({ name: emergencyName1, relationship: emergencyRel1, contactNumber: emergencyContact1 });
        if (emergencyName2) emergencyContacts.push({ name: emergencyName2, relationship: emergencyRel2, contactNumber: emergencyContact2 });
        if (emergencyName3) emergencyContacts.push({ name: emergencyName3, relationship: emergencyRel3, contactNumber: emergencyContact3 });

        const newPatient = await prisma.patients.create({
            data: {
                first_name: firstName,
                last_name: lastName,
                middle_name: middleName,
                date_of_birth: dateOfBirth ? new Date(dateOfBirth) : null,
                gender: gender,
                // civilStatus does not exist on patients table based on schema
                // nationality does not exist on patients table
                blood_type: bloodType,
                allergies: allergies,
                philhealth_number: philHealthNumber,
                contact_number: phone,
                email: normalizedEmail || null,
                street: street || streetAddress,
                city: city,
                province: province,
                postal_code: postalCode,
                country: country,
                emergency_contacts: emergencyContacts.length > 0 ? emergencyContacts : null,
            }
        });
        
        res.status(201).json(newPatient);
    } catch (err) {
        res.status(500).json({ message: "Error creating patient" });
    }
});

// PUT update patient
router.put('/:id', async (req, res) => {
    try {
        const patientId = String(req.params.id || '').trim();
        if (!patientId) return res.status(400).json({ message: 'Patient id is required.' });
        const exists = await prisma.patients.findUnique({ where: { id: patientId }, select: { id: true, admission_status: true, ward_number: true, email: true, contact_number: true } });
        if (!exists) return res.status(404).json({ message: 'Patient not found' });

        const requesterRole = getRequesterRole(req);
        if (!(await enforceClinicalPatientAccess(req, res, patientId))) return;
        const access = patientUpdateAccess({
            role: requesterRole,
            actorId: req.auth?.id,
            actorEmail: getRequesterEmail(req),
            patientId,
            patientEmail: exists.email
        });
        if (!access.allowed && access.reason === 'role') {
            return res.status(403).json({ message: 'You are not allowed to update patient records.' });
        }
        if (!access.allowed) return res.status(403).json({ message: 'You can only update your own patient profile.' });

        const { password, address, emergencyContacts, ...rawUpdateData } = req.body || {};
        const updateData = sanitizePatientUpdateForRole(requesterRole, rawUpdateData);

        const submittedValues = Object.entries(updateData)
            .filter(([key]) => !['_id', 'id', 'createdAt', 'updatedAt'].includes(key))
            .map(([, value]) => value)
            .concat(address && typeof address === 'object' ? Object.values(address) : [])
            .concat(Array.isArray(emergencyContacts) ? emergencyContacts.flatMap((contact) => Object.values(contact || {})) : []);
        if (!submittedValues.some((value) => String(value == null ? '' : value).trim())) {
            return res.status(400).json({ message: 'Patient information cannot be empty. Enter the required patient details before saving.' });
        }

        const cleanStr = (v, maxLen) => {
            const s = String(v == null ? '' : v).trim();
            return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
        };
        const firstName = cleanStr(updateData.firstName, 64);
        const lastName = cleanStr(updateData.lastName, 64);
        const middleName = updateData.middleName != null ? cleanStr(updateData.middleName, 64) : null;
        const gender = updateData.gender != null ? cleanStr(updateData.gender, 32) : null;
        const emailRaw = cleanStr(updateData.email, 254);
        const contactRaw = cleanStr(updateData.phone || updateData.contactNumber, 32);
        const bloodType = updateData.bloodType != null ? cleanStr(updateData.bloodType, 8) : null;
        const allergies = updateData.allergies != null ? cleanStr(updateData.allergies, 1000) : null;
        const philHealthRaw = cleanStr(updateData.philHealthNumber, 24);
        const admissionStatusRaw = cleanStr(updateData.admissionStatus, 32);
        const wardNumber = updateData.wardNumber != null ? cleanStr(updateData.wardNumber, 32) : null;
        const diagnosis = updateData.diagnosis != null ? cleanStr(updateData.diagnosis, 1000) : null;
        const attendingDoctor = updateData.attendingDoctor != null ? cleanStr(updateData.attendingDoctor, 120) : null;

        const errors = [];
        if (!firstName) errors.push('First name is required.');
        else if (firstName.length < 2) errors.push('First name is too short (min 2 characters).');
        if (!lastName) errors.push('Last name is required.');
        else if (lastName.length < 2) errors.push('Last name is too short (min 2 characters).');
        if (emailRaw) {
            const ok = /^[A-Za-z][A-Za-z0-9._-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(emailRaw);
            if (!ok) errors.push('Enter a valid email address (starts with a letter).');
        }
        if (contactRaw) {
            const digits = contactRaw.replace(/\D/g, '');
            if (!/^\d{7,15}$/.test(digits)) errors.push('Contact number is not a valid phone format.');
        }
        if (philHealthRaw) {
            if (!/^\d{12}$/.test(philHealthRaw.replace(/\D/g, ''))) errors.push('PhilHealth Number must be exactly 12 digits.');
        }
        if (admissionStatusRaw) {
            const allowedAdmission = new Set(['Outpatient','Inpatient','Discharged','ER Observation','Walk-in','Walk In','Pending Admission']);
            if (!allowedAdmission.has(admissionStatusRaw)) {
                return res.status(400).json({ message: `Invalid admission status '${admissionStatusRaw}'.` });
            }
        }

        // Map mongoose fields to prisma fields
        const prismaData = {
            first_name: firstName || undefined,
            last_name: lastName || undefined,
            middle_name: middleName,
            gender: gender || undefined,
            contact_number: contactRaw || undefined,
            email: emailRaw.toLowerCase() || undefined,
            blood_type: bloodType,
            allergies: allergies,
            philhealth_number: philHealthRaw || undefined,
            admission_status: admissionStatusRaw || undefined,
            ward_number: wardNumber,
            diagnosis,
            attending_doctor: attendingDoctor
        };

        if (updateData.dateOfBirth) {
            const d = new Date(updateData.dateOfBirth);
            if (Number.isNaN(d.getTime())) {
                errors.push('Invalid date of birth.');
            } else {
                prismaData.date_of_birth = d;
            }
        }
        if (updateData.admissionDate) {
            const d = new Date(updateData.admissionDate);
            if (!Number.isNaN(d.getTime())) prismaData.admission_date = d;
        }

        if (errors.length) return res.status(400).json({ message: errors.join('  ') });

        // Handle address fields
        if (address) {
            if (address.street != null) prismaData.street = String(address.street).slice(0, 255);
            if (address.city != null) prismaData.city = String(address.city).slice(0, 120);
            if (address.province != null) prismaData.province = String(address.province).slice(0, 120);
            if (address.postalCode != null) prismaData.postal_code = String(address.postalCode).slice(0, 16);
            if (address.country != null) prismaData.country = String(address.country).slice(0, 80);
        }

        // Handle emergency contacts
        if (Array.isArray(emergencyContacts)) {
            const safe = [];
            for (const ec of emergencyContacts) {
                if (!ec || !ec.name) continue;
                safe.push({
                    name: String(ec.name).slice(0, 120),
                    relationship: ec.relationship != null ? String(ec.relationship).slice(0, 64) : null,
                    phone: ec.phone != null ? String(ec.phone).slice(0, 32) : null
                });
            }
            prismaData.emergency_contacts = safe;
        }

        // Keep clinical_records JSON blob as-is if provided
        if (updateData.clinicalRecords !== undefined) {
            prismaData.clinical_records = updateData.clinicalRecords;
        }

        // Remove undefined fields
        Object.keys(prismaData).forEach(key => prismaData[key] === undefined && delete prismaData[key]);

        const updatedPatient = await prisma.patients.update({
            where: { id: patientId },
            data: prismaData
        });

        await prisma.activity_logs.create({
            data: {
                actor_name: getRequesterEmail(req) || 'authenticated-user',
                role: requesterRole,
                action: requesterRole === 'patient' ? 'Patient Profile Updated' : 'Patient Record Updated',
                target: `Patient:${patientId.slice(0, 8)}`,
                details: `Updated approved ${requesterRole} fields.`
            }
        }).catch(() => {});

        res.json(updatedPatient);
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ message: "Patient not found" });
        }
        sendError(res, err, 'Unable to update patient.');
    }
});

// POST patient clinical records (nurse vitals / progress notes)
router.post('/:id/clinical-records', requireRole(['admin','nurse','doctor']), async (req, res) => {
    try {
        const patientId = String(req.params.id || '').trim();
        if (!patientId) return res.status(400).json({ message: 'Patient id is required.' });
        if (!(await enforceClinicalPatientAccess(req, res, patientId))) return;
        const patient = await prisma.patients.findUnique({ where: { id: patientId }, select: { id: true, first_name: true, last_name: true, date_of_birth: true, clinical_records: true } });
        if (!patient) return res.status(404).json({ message: 'Patient not found.' });

        const cleanStr = (v, maxLen) => {
            const s = String(v == null ? '' : v).trim();
            return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
        };
        const allowedType = new Set(['Vitals','Assessment','Medication','Progress','Note','Lab','Imaging','I/O','Pain','Other']);
        const typeRaw = cleanStr(req.body?.type || 'Vitals', 32);
        const type = allowedType.has(typeRaw) ? typeRaw : 'Other';
        if (getRequesterRole(req) === 'nurse' && req.nurseDepartment === 'PEDIA' && type === 'Vitals') {
            const dob = patient.date_of_birth instanceof Date ? patient.date_of_birth : new Date(patient.date_of_birth || '');
            const now = new Date();
            const infantCutoff = new Date(now);
            infantCutoff.setUTCFullYear(infantCutoff.getUTCFullYear() - 1);
            if (Number.isNaN(dob.getTime()) || dob > now || dob <= infantCutoff) {
                return res.status(403).json({ message: 'Pedia Vitals is limited to infants under 12 months with a valid date of birth.' });
            }
        }
        const bloodPressure = req.body?.bloodPressure != null ? cleanStr(req.body.bloodPressure, 32) : null;
        const heartRateRaw = req.body?.heartRate;
        const temperatureRaw = req.body?.temperature;
        const respiratoryRateRaw = req.body?.respiratoryRate;
        const oxygenSaturation = req.body?.oxygenSaturation != null ? cleanStr(req.body.oxygenSaturation, 32) : null;
        const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 4000) : null;
        const nurseName = req.body?.nurseName != null ? cleanStr(req.body.nurseName, 120) : null;
        const errors = [];

        let heartRate = null;
        if (heartRateRaw !== undefined && heartRateRaw !== null && String(heartRateRaw).trim() !== '') {
            const n = Number(String(heartRateRaw).replace(/\D/g, ''));
            if (!Number.isFinite(n) || n < 10 || n > 300) errors.push('Heart rate must be a reasonable whole number (10–300 bpm).');
            else heartRate = n;
        }
        let temperature = null;
        if (temperatureRaw !== undefined && temperatureRaw !== null && String(temperatureRaw).trim() !== '') {
            const n = Number(String(temperatureRaw).replace(/[^0-9.]/g, ''));
            if (!Number.isFinite(n) || n < 30 || n > 45) errors.push('Temperature must be a reasonable value (30–45 °C).');
            else temperature = n;
        }
        let respiratoryRate = null;
        if (respiratoryRateRaw !== undefined && respiratoryRateRaw !== null && String(respiratoryRateRaw).trim() !== '') {
            const n = Number(String(respiratoryRateRaw).replace(/\D/g, ''));
            if (!Number.isFinite(n) || n < 2 || n > 80) errors.push('Respiratory rate must be a reasonable whole number (2–80).');
            else respiratoryRate = n;
        }
        const anyFilled = bloodPressure || heartRate != null || temperature != null || respiratoryRate != null || oxygenSaturation || (notes && String(notes).trim());
        if (!anyFilled) errors.push('At least one vital sign or a note is required.');

        if (errors.length) return res.status(400).json({ message: errors.join('  ') });

        const newRecord = {
            id: `rec_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            type,
            bloodPressure,
            heartRate,
            temperature,
            respiratoryRate,
            oxygenSaturation,
            notes: notes && String(notes).trim() ? String(notes).trim() : null,
            nurseName,
            recordedAt: new Date().toISOString()
        };

        const prev = patient.clinical_records && typeof patient.clinical_records === 'object' && Array.isArray(patient.clinical_records)
            ? patient.clinical_records
            : [];
        const nextRecords = [...prev, newRecord];
        const updated = await prisma.patients.update({
            where: { id: patientId },
            data: { clinical_records: nextRecords }
        });

        // Activity log (best-effort)
        try {
            const actor = String(inferRequesterName(req) || nurseName || 'Nurse').slice(0, 120);
            await prisma.activity_logs.create({
                data: {
                    actor_name: actor,
                    role: String(getRequesterRole(req) || 'nurse').slice(0, 32),
                    action: 'Clinical Record Added',
                    target: `Patient:${patientId.slice(0, 8)}`,
                    details: `${type} recorded for ${String(updated.first_name || '')} ${String(updated.last_name || '')}`.trim()
                }
            });
        } catch (_) {}

        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: 'Error saving clinical record.' });
    }
});

router.post('/audit-access/report', requireRole(['admin', 'nurse']), async (req, res) => {
    try {
        const actionMap = {
            print: 'Patient Records Printed',
            download: 'Patient Records Downloaded'
        };
        const accessType = String(req.body?.accessType || '').trim().toLowerCase();
        const action = actionMap[accessType];
        if (!action) return res.status(400).json({ message: 'Invalid patient record access type.' });
        const patientIds = [...new Set((Array.isArray(req.body?.patientIds) ? req.body.patientIds : [])
            .map((value) => String(value || '').trim()).filter(Boolean))];
        if (!patientIds.length || patientIds.length > 2000) {
            return res.status(400).json({ message: 'Select between 1 and 2,000 patient records.' });
        }
        const scope = clinicalPatientOrderScope(req);
        const allowedRows = await prisma.patients.findMany({
            where: { id: { in: patientIds }, ...(scope || {}) },
            select: { id: true }
        });
        const allowedIds = new Set(allowedRows.map((row) => row.id));
        if (getRequesterRole(req) === 'nurse' && req.nurseDepartment === 'ER' && allowedIds.size < patientIds.length) {
            const receptionRows = await prisma.patients.findMany({
                where: { id: { in: patientIds } },
                select: { id: true, clinical_records: true }
            });
            receptionRows.forEach((row) => {
                if (getReceptionRouteFromClinicalRecords(row.clinical_records)) allowedIds.add(row.id);
            });
        }
        if (allowedIds.size !== patientIds.length) {
            return res.status(403).json({ message: 'One or more patient records are outside your assigned department.' });
        }
        await logNursePatientAccess(req, action, req.nurseDepartment || 'Nursing', `${patientIds.length} scoped patient record(s).`);
        res.json({ ok: true, audited: patientIds.length });
    } catch (err) {
        res.status(500).json({ message: 'Unable to authorize patient report access.' });
    }
});

module.exports = router;

