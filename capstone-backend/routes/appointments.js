const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { createClient } = require('@supabase/supabase-js');
const { ensureBillingTablesExist, toMoney } = require('../utils/billingLedger');

let supabaseAdmin = null;
function getSupabaseAdmin() {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    if (!supabaseAdmin) {
        supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
    }
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

function normalizeServiceKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function inferConsultServiceFromAppointment(apt) {
    const desc = String(apt?.description || '');
    const m1 = desc.match(/service\s*key:\s*([a-z0-9_]+)/i);
    if (m1 && m1[1]) {
        const k = normalizeServiceKey(m1[1]);
        return {
            serviceKey: k,
            serviceName: k ? String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Consultation'
        };
    }

    const reason = String(apt?.reason || '').trim();
    const m2 = reason.match(/\]\s*([A-Za-z0-9\- ]+?)\s+consultation\b/i);
    const spec = m2 && m2[1] ? String(m2[1]).trim() : '';
    if (spec) {
        return { serviceKey: normalizeServiceKey(`${spec}_consultation`), serviceName: `${spec} Consultation` };
    }
    return { serviceKey: 'general_consultation', serviceName: 'General Consultation' };
}

async function sendAppointmentSummaryEmail({ to, subject, templateParams }) {
    if (typeof fetch !== 'function') {
        console.error('Fetch is not available');
        return { ok: false, skipped: true };
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort?.(), 10000);
    try {
        const payload = {
            service_id: 'service_krta25e',
            template_id: 'template_65mdd0e',
            user_id: '45tRyW8WG36pIFeBo',
            accessToken: 'kU0CO4gDDa24CzBI8XuZB',
            template_params: {
                to_email: to,
                subject: subject,
                message_html: '', // For backward compatibility
                ...templateParams
            }
        };

        console.log('Sending EmailJS (Appt) request to:', to);

        const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller?.signal
        });
        
        const data = await resp.text().catch(() => '');
        console.log('EmailJS Response (Appt):', { ok: resp.ok, status: resp.status, data });
        return { ok: resp.ok, provider: 'emailjs', data };
    } catch (e) {
        console.error('EmailJS Error (Appt):', e);
        return { ok: false, error: String(e?.message || e) };
    } finally {
        clearTimeout(timeout);
    }
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

async function ensureAppointmentVideoColumns() {
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS gender text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_name text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_relation text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS emergency_phone text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_id uuid;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS doctor_uuid uuid;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS consultation_mode text DEFAULT 'onsite';`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_room_id text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_created_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_started_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_ended_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_expires_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_level integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_status text DEFAULT 'Unassessed';`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_reasons jsonb;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triaged_by text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triaged_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_overridden_by text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_overridden_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS blood_pressure text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS heart_rate integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS respiratory_rate integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS spo2 integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS temperature decimal(5,2);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_override_reason text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_decided_by text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS triage_final_level integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_waiting_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_waiting_name text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket_seq integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS walkin_ticket_date date;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assignment_status text DEFAULT 'PENDING_ASSIGNMENT';`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_by text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_payment_id text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paymongo_event_id text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_status text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS paid_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completed_by text;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS amount integer;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS currency text;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_patient_idx ON public.appointments(patient_id, appointment_date DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_doctor_uuid_idx ON public.appointments(doctor_uuid, appointment_date DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_email_idx ON public.appointments(lower(coalesce(email, '')), appointment_date DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_meeting_idx ON public.appointments(meeting_started_at DESC, meeting_room_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_triage_idx ON public.appointments(triage_level, appointment_date DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_walkin_ticket_lookup ON public.appointments(walkin_ticket_date, doctor_id, walkin_ticket_seq);`);
    await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS appointments_walkin_ticket_unique
        ON public.appointments (walkin_ticket_date, walkin_ticket_seq)
        WHERE walkin_ticket_seq IS NOT NULL;
    `).catch(() => {});
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_completed_idx ON public.appointments(completed_at DESC);`).catch(() => {});
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS appointments_assignment_status_idx ON public.appointments(assignment_status, consultation_mode, appointment_date);`);
}

let ensurePromise = null;
function ensureAppointmentsSchema() {
    if (!ensurePromise) {
        ensurePromise = ensureAppointmentVideoColumns().catch((err) => {
            console.error('Failed to ensure appointments video columns:', err);
            throw err;
        });
    }
    return ensurePromise;
}

ensureAppointmentsSchema().catch(() => {});

function parseTimeValue(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    const s = String(v).trim();
    const parts = s.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1] || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

function formatHHmm(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : parseTimeValue(v);
    if (!d || Number.isNaN(d.getTime())) return null;
    // Use local time components to avoid UTC shift issues
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function splitName(full) {
    const s = String(full || '').trim();
    if (!s) return { firstName: 'Patient', lastName: 'Unknown' };
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0], lastName: 'Unknown' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeAppointmentStatus(v) {
    const raw = String(v || '').trim();
    if (!raw) return 'Pending';
    const low = raw.toLowerCase();
    if (low === 'waiting' || low === 'queue' || low === 'queued') return 'Waiting';
    if (low === 'checkedin' || low === 'checked-in') return 'Checked-in';
    if (low === 'confirmed' || low === 'approved') return 'Confirmed';
    if (low === 'completed' || low === 'done') return 'Completed';
    if (low === 'for payment' || low === 'for_payment') return 'For Payment';
    if (low === 'paid') return 'Paid';
    if (low === 'cancelled' || low === 'canceled') return 'Cancelled';
    const capped = raw.length > 40 ? raw.slice(0, 40) : raw;
    return capped.replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseAgeFromDob(dob) {
    if (!dob) return null;
    const d = dob instanceof Date ? dob : new Date(dob);
    if (!d || Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
    if (!Number.isFinite(age)) return null;
    return Math.max(0, Math.min(120, age));
}

function normalizeTokens(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean);
}

function suggestedActionsFor({ level, redFlags, age }) {
    const rf = Array.isArray(redFlags) ? redFlags : [];
    const actions = [];
    if (level === 1) {
        actions.push('Immediate assessment and continuous monitoring');
        actions.push('Check airway, breathing, circulation and vital signs now');
        actions.push('Escalate to ER/doctor on duty immediately');
        if (rf.includes('chest pain') || rf.includes('shortness of breath') || rf.includes('difficulty breathing')) {
            actions.push('Prepare oxygen and ECG monitoring if available');
        }
        if (rf.includes('severe bleeding')) {
            actions.push('Apply bleeding control and prepare IV access if protocol allows');
        }
    } else if (level === 2) {
        actions.push('Prioritize earlier assessment and obtain vitals');
        actions.push('Screen for worsening symptoms and dehydration');
        if (typeof age === 'number' && age < 5) actions.push('Pediatric caution: prioritize monitoring and hydration assessment');
        if (typeof age === 'number' && age >= 65) actions.push('Older adult caution: assess comorbid risk and vitals promptly');
    } else if (level === 3) {
        actions.push('Standard triage: check vitals and document symptoms');
        actions.push('Provide waiting instructions and return precautions');
    } else {
        actions.push('Low priority: provide self-care guidance and return precautions');
        actions.push('Advise follow-up if symptoms persist or worsen');
    }
    return Array.from(new Set(actions)).slice(0, 6);
}

function protocolBasedTriage({ severity, mainConcern, description, symptoms, emergencySymptoms, age, gender, vitals }) {
    const rf = Array.isArray(emergencySymptoms) ? emergencySymptoms : [];
    const syms = Array.isArray(symptoms) ? symptoms : [];
    const text = `${String(mainConcern || '')} ${String(description || '')}`.toLowerCase();
    
    // 1. Inconsistent Data Check (Professor's suggestion)
    const respRate = vitals?.respiratory_rate;
    const heartRate = vitals?.heart_rate;
    const isNotBreathing = rf.includes('not breathing') || text.includes('not breathing');
    
    if (isNotBreathing && heartRate > 0 && heartRate < 150) {
        // Technically possible in very early arrest, but usually a data error for triage
        return {
            level: 0, // Special code for inconsistent
            note: 'Inconsistent Data: Patient reported as not breathing but has a pulse. Please verify airway and vitals immediately.',
            reasons: ['Inconsistent Vitals/Symptoms Mismatch'],
            inconsistent: true
        };
    }

    // 2. Level 1: Resuscitation (Immediate)
    const isCritical = [
        'unconscious',
        'no pulse',
        'severe respiratory distress',
        'cardiac arrest',
        'active seizure'
    ].some(k => text.includes(k) || rf.includes(k) || syms.includes(k)) || isNotBreathing;

    if (isCritical || (vitals?.spo2 < 85)) {
        return {
            level: 1,
            note: 'Immediate resuscitation required. Airway/Breathing/Circulation compromised.',
            reasons: ['Critical physiological instability'],
            suggestedActions: suggestedActionsFor({ level: 1, redFlags: rf, age })
        };
    }

    // 3. Level 2: Emergent (High Risk)
    const isEmergent = [
        'chest pain',
        'stroke symptoms',
        'slurred speech',
        'severe bleeding',
        'altered mental status',
        'nabagok' // Head injury from professor's example
    ].some(k => text.includes(k) || rf.includes(k) || syms.includes(k)) || (vitals?.heart_rate > 120) || (vitals?.heart_rate < 50) || (vitals?.temperature > 39.5);

    if (isEmergent || String(severity).toLowerCase() === 'severe') {
        return {
            level: 2,
            note: 'Emergent condition. High risk of deterioration. Prioritize for immediate doctor review.',
            reasons: ['High-risk clinical symptoms or vital signs'],
            suggestedActions: suggestedActionsFor({ level: 2, redFlags: rf, age })
        };
    }

    // 4. Level 3: Urgent
    const isUrgent = String(severity).toLowerCase() === 'moderate' || [
        'fever',
        'moderate pain',
        'vomiting',
        'dehydration'
    ].some(k => text.includes(k) || rf.includes(k) || syms.includes(k));

    if (isUrgent) {
        return {
            level: 3,
            note: 'Urgent condition. Stable vitals but requires multiple resources.',
            reasons: ['Moderate clinical symptoms'],
            suggestedActions: suggestedActionsFor({ level: 3, redFlags: rf, age })
        };
    }

    // 5. Level 4-5: Less Urgent
    return {
        level: 4,
        note: 'Non-urgent. Stable condition. Routine assessment.',
        reasons: ['Mild/Stable symptoms'],
        suggestedActions: suggestedActionsFor({ level: 4, redFlags: rf, age })
    };
}

async function applyAiTriageToAppointment(appointmentId) {
    const apt = await prisma.appointments.findUnique({ where: { id: BigInt(appointmentId) } }).catch(() => null);
    if (!apt) return null;

    const mode = String(apt.consultation_mode || '').trim().toLowerCase() || 'onsite';
    if (mode === 'video') return null;

    const symptoms = Array.isArray(apt.symptoms) ? apt.symptoms : [];
    const emergencySymptoms = Array.isArray(apt.emergency_symptoms) ? apt.emergency_symptoms : [];
    const mainConcern = String(apt.main_concern || '').trim();
    const description = String(apt.description || '').trim();
    const severity = String(apt.severity || '').trim();
    const gender = String(apt.gender || '').trim() || null;
    const age = parseAgeFromDob(apt.date_of_birth);
    const vitals = {
        blood_pressure: apt.blood_pressure,
        heart_rate: apt.heart_rate,
        respiratory_rate: apt.respiratory_rate,
        spo2: apt.spo2,
        temperature: apt.temperature
    };

    const hasInput = Boolean(mainConcern || description || symptoms.length || emergencySymptoms.length || severity || vitals.heart_rate);
    if (!hasInput) return null;

    const triage = protocolBasedTriage({ severity, mainConcern, description, symptoms, emergencySymptoms, age, gender, vitals });

    const triageReasons = {
        note: triage.note,
        reasons: triage.reasons,
        redFlags: triage.redFlags || [],
        suggestedActions: triage.suggestedActions || [],
        inconsistent: triage.inconsistent || false,
        source: 'protocol_engine_v1',
        version: 'esi-v5-adapted'
    };

    const updated = await prisma.appointments
        .update({
            where: { id: BigInt(appointmentId) },
            data: {
                triage_level: triage.level,
                triage_status: triage.inconsistent ? 'Warning' : 'Assessed',
                triage_reasons: triageReasons,
                triaged_by: 'System (ESI Protocol)',
                triaged_at: new Date()
            }
        })
        .catch(() => null);
    
    if (updated) {
        logSystemAppointmentActivity(appointmentId, 'System Triage Assessed', `Level ${triage.level}: ${triage.note}`).catch(() => {});
    }
    return updated;
}

async function finalizeApprovedVideoRequestsForDate(dateStr) {
    if (!dateStr) return;
    const dateOnly = new Date(dateStr);
    if (Number.isNaN(dateOnly.getTime())) return;
    dateOnly.setHours(0, 0, 0, 0);

    try {
        const reqRows = await prisma.$queryRawUnsafe(
            `
            SELECT
              id,
              patient_id,
              patient_name,
              doctor_name,
              doctor_id,
              requested_date,
              requested_time,
              service_type,
              reason,
              email
            FROM public.appointment_approval_requests
            WHERE status = 'Approved'
              AND appointment_id IS NULL
              AND requested_date = $1::date
              AND (
                lower(coalesce(service_type, '')) LIKE '%video%'
                OR lower(coalesce(reason, '')) LIKE '%video%'
              )
            ORDER BY created_at DESC
            LIMIT 50
            `,
            dateOnly
        );

        const rows = Array.isArray(reqRows) ? reqRows : [];
        for (const r of rows) {
            const patientId = r?.patient_id ? String(r.patient_id) : '';
            const doctorUuid = r?.doctor_id ? String(r.doctor_id) : '';
            const doctorName = String(r?.doctor_name || '').trim() || null;
            const requestedDate = r?.requested_date ? new Date(r.requested_date) : null;
            const requestedTime = parseTimeValue(r?.requested_time);
            const reason = String(r?.service_type || r?.reason || 'Video Consultation').trim();
            const email = r?.email ? String(r.email).trim() : null;

            if (!patientId || !requestedDate || !requestedTime) continue;

            const { firstName, lastName } = splitName(r?.patient_name);

            const existing = await prisma.appointments
                .findFirst({
                    where: {
                        patient_id: patientId,
                        appointment_date: requestedDate,
                        appointment_time: requestedTime,
                        consultation_mode: 'video'
                    },
                    select: { id: true }
                })
                .catch(() => null);

            const appt =
                existing ||
                (await prisma.appointments.create({
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        email,
                        reason,
                        appointment_date: requestedDate,
                        appointment_time: requestedTime,
                        doctor_id: doctorName,
                        doctor_uuid: doctorUuid || null,
                        patient_id: patientId,
                        consultation_mode: 'video',
                        status: 'Confirmed'
                    },
                    select: { id: true }
                }));

            await prisma.$executeRawUnsafe(
                `
                UPDATE public.appointment_approval_requests
                SET appointment_id = $1::bigint,
                    updated_at = now()
                WHERE id = $2::bigint
                `,
                BigInt(appt.id),
                BigInt(r.id)
            );
        }
    } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('appointment_approval_requests') && msg.includes('does not exist')) return;
        console.error('finalizeApprovedVideoRequestsForDate failed:', err);
    }
}

async function finalizeApprovedVideoRequestsForRange(startStr, endStr) {
    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return;
    if (!endDate || Number.isNaN(endDate.getTime())) return;
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    try {
        const reqRows = await prisma.$queryRawUnsafe(
            `
            SELECT
              id,
              patient_id,
              patient_name,
              doctor_name,
              doctor_id,
              requested_date,
              requested_time,
              service_type,
              reason,
              email
            FROM public.appointment_approval_requests
            WHERE status = 'Approved'
              AND appointment_id IS NULL
              AND requested_date >= $1::date
              AND requested_date <= $2::date
              AND (
                lower(coalesce(service_type, '')) LIKE '%video%'
                OR lower(coalesce(reason, '')) LIKE '%video%'
              )
            ORDER BY created_at DESC
            LIMIT 200
            `,
            startDate,
            endDate
        );

        const rows = Array.isArray(reqRows) ? reqRows : [];
        for (const r of rows) {
            const patientId = r?.patient_id ? String(r.patient_id) : '';
            const doctorUuid = r?.doctor_id ? String(r.doctor_id) : '';
            const doctorName = String(r?.doctor_name || '').trim() || null;
            const requestedDate = r?.requested_date ? new Date(r.requested_date) : null;
            const requestedTime = parseTimeValue(r?.requested_time);
            const reason = String(r?.service_type || r?.reason || 'Video Consultation').trim();
            const email = r?.email ? String(r.email).trim() : null;

            if (!patientId || !requestedDate || !requestedTime) continue;

            const { firstName, lastName } = splitName(r?.patient_name);

            const existing = await prisma.appointments
                .findFirst({
                    where: {
                        patient_id: patientId,
                        appointment_date: requestedDate,
                        appointment_time: requestedTime,
                        consultation_mode: 'video'
                    },
                    select: { id: true }
                })
                .catch(() => null);

            const appt =
                existing ||
                (await prisma.appointments.create({
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        email,
                        reason,
                        appointment_date: requestedDate,
                        appointment_time: requestedTime,
                        doctor_id: doctorName,
                        doctor_uuid: doctorUuid || null,
                        patient_id: patientId,
                        consultation_mode: 'video',
                        status: 'Confirmed'
                    },
                    select: { id: true }
                }));

            await prisma.$executeRawUnsafe(
                `
                UPDATE public.appointment_approval_requests
                SET appointment_id = $1::bigint,
                    updated_at = now()
                WHERE id = $2::bigint
                `,
                BigInt(appt.id),
                BigInt(r.id)
            );
        }
    } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('appointment_approval_requests') && msg.includes('does not exist')) return;
        console.error('finalizeApprovedVideoRequestsForRange failed:', err);
    }
}

function normalizeAssignee(v) {
    return String(v || '')
        .toLowerCase()
        .replace(/^dr\.?\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function inferRole(req) {
    return String(req.headers['x-user-role'] || '').trim().toLowerCase();
}

function inferEmail(req) {
    return String(req.headers['x-user-email'] || '').trim().toLowerCase();
}

function inferName(req) {
    return String(req.headers['x-user-name'] || '').trim();
}

function inferActorLabel(req) {
    const name = inferName(req);
    if (name) return name;
    const email = inferEmail(req);
    return email || 'User';
}

async function logAppointmentActivity(req, appointmentId, action, details) {
    const idRaw = String(appointmentId || '').trim();
    const target = `appointment:${idRaw}`;
    const actorName = inferActorLabel(req);
    const role = inferRole(req) || null;
    const safeAction = String(action || '').trim();
    const safeDetails = String(details || '').trim();
    if (!safeAction) return;
    await prisma.activity_logs
        .create({
            data: {
                actor_name: actorName,
                role,
                action: safeAction,
                target,
                details: safeDetails
            }
        })
        .catch(() => null);
}

async function logSystemAppointmentActivity(appointmentId, action, details) {
    const idRaw = String(appointmentId || '').trim();
    if (!idRaw) return;
    const safeAction = String(action || '').trim();
    const safeDetails = String(details || '').trim();
    if (!safeAction) return;
    await prisma.activity_logs
        .create({
            data: {
                actor_name: 'AI (Rule-based)',
                role: 'AI',
                action: safeAction,
                target: `appointment:${idRaw}`,
                details: safeDetails
            }
        })
        .catch(() => null);
}

function isVideoAppointment(apt) {
    const mode = String(apt?.consultation_mode || '').trim().toLowerCase();
    if (mode === 'video') return true;
    const reason = String(apt?.reason || '').trim().toLowerCase();
    return reason.includes('video consultation') || reason.startsWith('video:') || reason.includes('(online)');
}

function inferSpecializationFromVideoReason(reason) {
    const raw = String(reason || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (!lower.includes('video consultation')) return '';

    let tail = raw;
    const idx = lower.indexOf('video consultation');
    if (idx >= 0) tail = raw.slice(idx + 'video consultation'.length);
    tail = tail.replace(/^\s*[-:]\s*/g, '');

    const stopIdx = (() => {
        const i1 = tail.indexOf(':');
        const i2 = tail.indexOf('|');
        const arr = [i1, i2].filter((n) => n >= 0);
        return arr.length ? Math.min(...arr) : -1;
    })();
    const head = (stopIdx >= 0 ? tail.slice(0, stopIdx) : tail).trim();
    const cleaned = head.replace(/\(online\)/gi, '').trim();
    const low = cleaned.toLowerCase();
    if (low.includes('pedia') || low.includes('pedi')) return 'Pediatrics';
    if (low.includes('physical therapy') || low === 'pt' || low.includes('physiotherapy')) return 'Physical Therapy';
    if (low.includes('ob-gyn') || low.includes('obgyn') || low === 'ob') return 'OB-GYN';
    if (low.includes('cardio')) return 'Cardiology';
    if (low.includes('derma')) return 'Dermatology';
    if (low.includes('surg')) return 'Surgery';
    if (low.includes('internal medicine') || low.includes('medicine')) return 'Medicine';
    return cleaned;
}

function buildDoctorSpecializationWhere(spec) {
    const raw = String(spec || '').trim();
    if (!raw) return {};
    const low = raw.toLowerCase();
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
    return { specialization: { contains: raw, mode: 'insensitive' } };
}

async function autoAssignUnassignedVideoAppointmentsForDate(dateStr) {
    if (!dateStr) return;
    const startDate = new Date(dateStr);
    if (Number.isNaN(startDate.getTime())) return;
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateStr);
    endDate.setHours(23, 59, 59, 999);

    const candidates = await prisma.appointments.findMany({
        where: {
            appointment_date: { gte: startDate, lte: endDate },
            doctor_uuid: null,
            doctor_id: null,
            OR: [{ reason: { contains: 'Video Consultation', mode: 'insensitive' } }, { reason: { contains: '(Online)', mode: 'insensitive' } }]
        },
        orderBy: [{ created_at: 'asc' }],
        take: 100
    });

    for (const apt of candidates) {
        const spec = inferSpecializationFromVideoReason(apt.reason);
        if (!spec) continue;

        const doctors = await prisma.doctors
            .findMany({
                where: buildDoctorSpecializationWhere(spec),
                select: { id: true, first_name: true, last_name: true, specialization: true, status: true, created_at: true }
            })
            .catch(() => []);

        if (!doctors.length) continue;

        const score = (s) => (String(s || '').trim().toLowerCase() === 'online' ? 1 : 0);
        doctors.sort((a, b) => {
            const sa = score(a.status);
            const sb = score(b.status);
            if (sa !== sb) return sb - sa;
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
        });

        let chosen = null;
        for (const doc of doctors) {
            const conflict = await prisma.appointments
                .findFirst({
                    where: {
                        doctor_uuid: doc.id,
                        appointment_date: apt.appointment_date,
                        appointment_time: apt.appointment_time,
                        status: { in: ['Pending', 'Confirmed', 'Approved', 'Scheduled'] }
                    },
                    select: { id: true }
                })
                .catch(() => null);
            if (!conflict) {
                chosen = doc;
                break;
            }
        }
        if (!chosen) chosen = doctors[0];

        const label = `Dr. ${String(chosen.first_name || '').trim()} ${String(chosen.last_name || '').trim()}`.trim();
        await prisma.appointments
            .update({
                where: { id: apt.id },
                data: {
                    doctor_uuid: chosen.id,
                    doctor_id: label,
                    consultation_mode: 'video'
                }
            })
            .catch(() => null);
    }
}

function makeRoomId(appointmentId) {
    const raw = String(appointmentId || '').trim();
    return `pascualinga-${raw}`;
}

function getJitsiBaseUrl() {
    const base = String(process.env.JITSI_BASE_URL || '').trim();
    return base || 'https://meet.jit.si';
}

function buildJitsiUrl(roomId, displayName) {
    const rawRoom = String(roomId || '').trim();
    const name = String(displayName || '').trim();
    const hash = [
        'config.prejoinPageEnabled=false',
        'config.disableInviteFunctions=true',
        'config.startWithAudioMuted=false',
        'config.startWithVideoMuted=false',
        'interfaceConfig.SHOW_JITSI_WATERMARK=false',
        'interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false',
        'interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME=Participant',
        'interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true',
        name ? `userInfo.displayName=${encodeURIComponent(name)}` : ''
    ].filter(Boolean).join('&');

    if (rawRoom.startsWith('http://') || rawRoom.startsWith('https://')) {
        return `${rawRoom}#${hash}`;
    }

    const base = getJitsiBaseUrl().replace(/\/+$/, '');
    const safeRoom = encodeURIComponent(rawRoom);
    return `${base}/${safeRoom}#${hash}`;
}

async function ensurePatientFromAppointment(apt) {
    const firstName = String(apt?.first_name || apt?.firstName || '').trim();
    const lastName = String(apt?.last_name || apt?.lastName || '').trim();
    const email = String(apt?.email || '').trim();
    const phone = String(apt?.phone || '').trim();
    const dobRaw = apt?.date_of_birth || apt?.dateOfBirth || null;
    const dateOfBirth = dobRaw ? new Date(dobRaw) : null;

    if (!firstName || !lastName) return null;

    if (email) {
        const existing = await prisma.patients.findUnique({ where: { email } }).catch(() => null);
        if (existing) return existing;
    }

    const where = {
        first_name: firstName,
        last_name: lastName,
        ...(phone ? { contact_number: phone } : {}),
        ...(dateOfBirth && !Number.isNaN(dateOfBirth.getTime()) ? { date_of_birth: dateOfBirth } : {})
    };
    const found = await prisma.patients.findFirst({ where }).catch(() => null);
    if (found) return found;

    return prisma.patients.create({
        data: {
            first_name: firstName,
            last_name: lastName,
            ...(email ? { email } : {}),
            ...(phone ? { contact_number: phone } : {}),
            ...(dateOfBirth && !Number.isNaN(dateOfBirth.getTime()) ? { date_of_birth: dateOfBirth } : {})
        }
    });
}

// GET all appointments (with optional date filter)
async function autoAssignUnassignedVideoAppointmentsForRange(startStr, endStr) {
    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return;
    if (!endDate || Number.isNaN(endDate.getTime())) return;
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const candidates = await prisma.appointments.findMany({
        where: {
            appointment_date: { gte: startDate, lte: endDate },
            doctor_uuid: null,
            doctor_id: null,
            OR: [{ reason: { contains: 'Video Consultation', mode: 'insensitive' } }, { reason: { contains: '(Online)', mode: 'insensitive' } }]
        },
        orderBy: [{ created_at: 'asc' }],
        take: 500
    });

    for (const apt of candidates) {
        const spec = inferSpecializationFromVideoReason(apt.reason);
        if (!spec) continue;

        const doctors = await prisma.doctors
            .findMany({
                where: buildDoctorSpecializationWhere(spec),
                select: { id: true, first_name: true, last_name: true, specialization: true, status: true, created_at: true }
            })
            .catch(() => []);

        if (!doctors.length) continue;

        const score = (s) => (String(s || '').trim().toLowerCase() === 'online' ? 1 : 0);
        doctors.sort((a, b) => {
            const sa = score(a.status);
            const sb = score(b.status);
            if (sa !== sb) return sb - sa;
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
        });

        let chosen = null;
        for (const doc of doctors) {
            const conflict = await prisma.appointments
                .findFirst({
                    where: {
                        doctor_uuid: doc.id,
                        appointment_date: apt.appointment_date,
                        appointment_time: apt.appointment_time,
                        status: { in: ['Pending', 'Confirmed', 'Approved', 'Scheduled'] }
                    },
                    select: { id: true }
                })
                .catch(() => null);
            if (!conflict) {
                chosen = doc;
                break;
            }
        }
        if (!chosen) chosen = doctors[0];

        const label = `Dr. ${String(chosen.first_name || '').trim()} ${String(chosen.last_name || '').trim()}`.trim();
        await prisma.appointments
            .update({
                where: { id: apt.id },
                data: {
                    doctor_uuid: chosen.id,
                    doctor_id: label,
                    consultation_mode: 'video'
                }
            })
            .catch(() => null);
    }
}

async function reassignOfflineVideoAppointmentsForRange(startStr, endStr) {
    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return;
    if (!endDate || Number.isNaN(endDate.getTime())) return;
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appts = await prisma.appointments.findMany({
        where: {
            appointment_date: { gte: startDate, lte: endDate },
            doctor_uuid: { not: null },
            meeting_started_at: null,
            status: { in: ['Pending', 'Confirmed', 'Approved', 'Scheduled'] },
            OR: [{ consultation_mode: 'video' }, { reason: { contains: 'Video Consultation', mode: 'insensitive' } }]
        },
        orderBy: [{ appointment_date: 'asc' }, { appointment_time: 'asc' }],
        take: 500
    });

    const doctorCache = new Map();
    const getDoctorsForSpec = async (spec) => {
        const key = String(spec || '').trim().toLowerCase();
        if (!key) return [];
        if (doctorCache.has(key)) return doctorCache.get(key);
        const rows = await prisma.doctors
            .findMany({
                where: buildDoctorSpecializationWhere(spec),
                select: { id: true, first_name: true, last_name: true, status: true, created_at: true }
            })
            .catch(() => []);
        const score = (s) => (String(s || '').trim().toLowerCase() === 'online' ? 1 : 0);
        rows.sort((a, b) => {
            const sa = score(a.status);
            const sb = score(b.status);
            if (sa !== sb) return sb - sa;
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
        });
        doctorCache.set(key, rows);
        return rows;
    };

    const statusCache = new Map();
    const getDoctorStatus = async (id) => {
        const key = String(id || '').trim();
        if (!key) return '';
        if (statusCache.has(key)) return statusCache.get(key);
        const row = await prisma.doctors.findUnique({ where: { id: key }, select: { status: true } }).catch(() => null);
        const st = String(row?.status || '').trim().toLowerCase();
        statusCache.set(key, st);
        return st;
    };

    for (const apt of appts) {
        const apptDate = apt?.appointment_date ? new Date(apt.appointment_date) : null;
        if (!apptDate || Number.isNaN(apptDate.getTime())) continue;
        if (apptDate < today) continue;

        const assignedUuid = String(apt.doctor_uuid || '').trim();
        if (!assignedUuid) continue;

        const assignedStatus = await getDoctorStatus(assignedUuid);
        if (assignedStatus === 'online') continue;

        const spec = inferSpecializationFromVideoReason(apt.reason);
        if (!spec) continue;

        const doctors = await getDoctorsForSpec(spec);
        const online = doctors.filter((d) => String(d.status || '').trim().toLowerCase() === 'online');
        if (online.length !== 1) continue;
        const candidate = online[0];
        if (!candidate?.id || String(candidate.id) === assignedUuid) continue;

        const conflict = await prisma.appointments
            .findFirst({
                where: {
                    doctor_uuid: candidate.id,
                    appointment_date: apt.appointment_date,
                    appointment_time: apt.appointment_time,
                    status: { in: ['Pending', 'Confirmed', 'Approved', 'Scheduled'] }
                },
                select: { id: true }
            })
            .catch(() => null);
        if (conflict) continue;

        const label = `Dr. ${String(candidate.first_name || '').trim()} ${String(candidate.last_name || '').trim()}`.trim();
        await prisma.appointments
            .update({
                where: { id: apt.id },
                data: { doctor_uuid: candidate.id, doctor_id: label, consultation_mode: 'video' }
            })
            .catch(() => null);
    }
}

router.get('/debug/video-apts', async (req, res) => {
    try {
        const apts = await prisma.appointments.findMany({
            where: { consultation_mode: 'video' },
            select: { id: true, first_name: true, status: true, doctor_id: true, doctor_uuid: true }
        });
        const holds = await prisma.$queryRaw`SELECT id, doctor_name, status, appointment_id FROM video_booking_holds`;
        res.json({
            apts: apts.map(a => ({...a, id: a.id.toString()})),
            holds: holds.map(h => ({...h, id: h.id?.toString(), appointment_id: h.appointment_id?.toString()}))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', requireRole(['admin', 'nurse', 'doctor', 'doctor_secretary', 'cashier', 'staff']), async (req, res) => {
    try {
        await ensureAppointmentsSchema();
        const { date, start, end, take, skip, q, status, consultationMode, doctorUuid } = req.query;
        let where = {};

        const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
        const linkedDoctorId = String(req.headers['x-linked-doctor-id'] || '').trim();

        const limitRaw = take !== undefined ? Number(take) : 0;
        const offsetRaw = skip !== undefined ? Number(skip) : 0;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.min(Math.floor(offsetRaw), 5000) : 0;

        const statusTrim = String(status || '').trim();
        if (statusTrim && statusTrim !== 'All') where.status = statusTrim;

        const modeTrim = String(consultationMode || '').trim().toLowerCase();
        if (modeTrim === 'video' || modeTrim === 'onsite') where.consultation_mode = modeTrim;

        const doctorUuidTrim = String(doctorUuid || '').trim();
        if (doctorUuidTrim) where.doctor_uuid = doctorUuidTrim;

        if (role === 'doctor_secretary') {
            if (!linkedDoctorId) return res.status(400).json({ message: 'Missing x-linked-doctor-id header' });
            where.doctor_uuid = linkedDoctorId;
            if (!where.consultation_mode) where.consultation_mode = 'onsite';
        }

        const query = String(q || '').trim();
        if (query) {
            where.OR = [
                { first_name: { contains: query, mode: 'insensitive' } },
                { last_name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query, mode: 'insensitive' } }
            ];
        }

        const makeManilaRange = (dateKey) => {
            const raw = String(dateKey || '').trim();
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!m) return null;
            const year = Number(m[1]);
            const month = Number(m[2]);
            const day = Number(m[3]);
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            const baseUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
            const manilaOffsetMs = 8 * 60 * 60 * 1000;
            const startUtc = new Date(baseUtcMidnight - manilaOffsetMs);
            const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
            return { start: startUtc, end: endUtc };
        };

        if (date) {
            await finalizeApprovedVideoRequestsForDate(date);
            await autoAssignUnassignedVideoAppointmentsForDate(date);
            await reassignOfflineVideoAppointmentsForRange(date, date);
            const range = makeManilaRange(date);
            if (!range) return res.status(400).json({ message: 'Invalid date' });
            const { start: startDate, end: endDate } = range;

            where.appointment_date = {
                gte: startDate,
                lte: endDate
            };
        } else if (start || end) {
            const startRange = start ? makeManilaRange(start) : null;
            const endRange = end ? makeManilaRange(end) : null;
            if (start && !startRange) {
                return res.status(400).json({ message: 'Invalid start date' });
            }
            if (end && !endRange) {
                return res.status(400).json({ message: 'Invalid end date' });
            }
            const startDate = startRange ? startRange.start : null;
            const endDate = endRange ? endRange.end : null;

            if (start && end) {
                await finalizeApprovedVideoRequestsForRange(start, end);
                await autoAssignUnassignedVideoAppointmentsForRange(start, end);
                await reassignOfflineVideoAppointmentsForRange(start, end);
            }

            where.appointment_date = {};
            if (startDate) where.appointment_date.gte = startDate;
            if (endDate) where.appointment_date.lte = endDate;
        }

        const appointments = await prisma.appointments.findMany({
            where,
            orderBy: [
                { appointment_date: 'asc' },
                { created_at: 'desc' }
            ],
            take: limit,
            skip: offset
        });
        
        const formatted = appointments.map(apt => ({
            ...apt,
            id: apt.id.toString(),
            firstName: apt.first_name,
            lastName: apt.last_name,
            middleName: apt.middle_name,
            dateOfBirth: apt.date_of_birth,
            appointmentDate: apt.appointment_date,
            appointmentTime: formatHHmm(apt.appointment_time) || null,
            mainConcern: apt.main_concern,
            symptomsStart: apt.symptoms_start,
            emergencyName: apt.emergency_name,
            emergencyRelation: apt.emergency_relation,
            emergencyPhone: apt.emergency_phone,
            doctor: apt.doctor_id,
            doctorUuid: apt.doctor_uuid || null,
            patientId: apt.patient_id || null,
            consultationMode: apt.consultation_mode || 'onsite',
            meetingActive: !!apt.meeting_started_at && !!apt.meeting_room_id,
            walkinTicket: apt.walkin_ticket || null,
            walkinTicketSeq: apt.walkin_ticket_seq ?? null,
            walkinTicketDate: apt.walkin_ticket_date ?? null,
            patientWaitingAt: apt.patient_waiting_at ?? null,
            patientWaitingName: apt.patient_waiting_name || null,
            triageLevel: apt.triage_level ?? null,
            triageStatus: apt.triage_status || 'Unassessed',
            triageReasons: apt.triage_reasons ?? null,
            triagedBy: apt.triaged_by || null,
            triagedAt: apt.triaged_at ?? null,
            triageOverriddenBy: apt.triage_overridden_by || null,
            triageOverriddenAt: apt.triage_overridden_at ?? null
        }));
        
        res.json(formatted);
    } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('meeting_room_id') && msg.includes('does not exist')) {
            return res.status(500).json({
                message:
                    'Database schema missing video columns (meeting_room_id). Restart backend or run migration for appointments table.',
                error: msg
            });
        }
        res.status(500).json({ message: err.message });
    }
});

router.get('/mine', requireRole(['patient']), async (req, res) => {
    try {
        await ensureAppointmentsSchema();
        const email = inferEmail(req);
        if (!email) return res.status(401).json({ message: 'Missing user email.' });

        const take = Number(req.query.take || 50);
        const limit = Number.isFinite(take) ? Math.max(1, Math.min(200, Math.floor(take))) : 50;
        const now = new Date();

        const rows = await prisma.appointments.findMany({
            where: {
                email: { equals: email, mode: 'insensitive' },
                appointment_date: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30) }
            },
            orderBy: [{ appointment_date: 'desc' }, { created_at: 'desc' }],
            take: limit
        });

        const formatted = rows.map((apt) => ({
            ...apt,
            id: apt.id.toString(),
            firstName: apt.first_name,
            lastName: apt.last_name,
            middleName: apt.middle_name,
            dateOfBirth: apt.date_of_birth,
            appointmentDate: apt.appointment_date,
            appointmentTime: formatHHmm(apt.appointment_time) || null,
            mainConcern: apt.main_concern,
            symptomsStart: apt.symptoms_start,
            doctor: apt.doctor_id,
            consultationMode: apt.consultation_mode || 'onsite',
            meetingActive: !!apt.meeting_started_at && !!apt.meeting_room_id,
            triageLevel: apt.triage_level ?? null,
            triageStatus: apt.triage_status || 'Unassessed',
            triageReasons: apt.triage_reasons ?? null,
            triagedBy: apt.triaged_by || null,
            triagedAt: apt.triaged_at ?? null,
            triageOverriddenBy: apt.triage_overridden_by || null,
            triageOverriddenAt: apt.triage_overridden_at ?? null
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST new appointment
router.post('/', async (req, res) => {
    try {
        const { 
            firstName, lastName, middleName, email, phone, dateOfBirth, gender, reason,
            appointmentDate, appointmentTime, mainConcern, symptomsStart, severity,
            description,
            bodyParts,
            symptoms,
            emergencySymptoms,
            emergencyName, emergencyRelation, emergencyPhone, preferredDoctor, status,
            patientId,
            consultationMode,
            mode,
            serviceType,
            doctorId,
            assignmentStatus
        } = req.body;
        
        // Basic conversion for time (Prisma Time field usually expects Date object or ISO string representing time)
        let timeObj = null;
        if (appointmentTime) {
            // If it's just "HH:MM", we need to make it a full date for Prisma
            const dummyDate = new Date();
            const [hours, minutes] = appointmentTime.split(':');
            dummyDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
            timeObj = dummyDate;
        }

        const modeRaw = String(consultationMode || mode || '').trim().toLowerCase();
        const reasonRaw = String(reason || '').trim().toLowerCase();
        const serviceRaw = String(serviceType || '').trim().toLowerCase();
        const resolvedMode =
            modeRaw === 'video' || reasonRaw.includes('video consultation') || serviceRaw.includes('video')
                ? 'video'
                : 'onsite';

        const doctorIdRaw = String(doctorId || '').trim();
        const doctorUuid = doctorIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(doctorIdRaw)
            ? doctorIdRaw
            : null;
        let doctorLabel = preferredDoctor;
        if (doctorUuid && !doctorLabel) {
            const doc = await prisma.doctors.findUnique({ where: { id: doctorUuid }, select: { first_name: true, last_name: true } }).catch(() => null);
            if (doc) doctorLabel = `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
        }

        if (resolvedMode === 'onsite' && doctorUuid && appointmentDate && appointmentTime) {
            const toTimeStr = (value) => {
                const raw = String(value || '').trim();
                if (!raw) return '';
                const m = raw.match(/^(\d{1,2}):(\d{2})/);
                if (!m) return '';
                const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
                const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
                return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            };
            const timeToMinutes = (time) => {
                const t = toTimeStr(time);
                if (!t) return null;
                const [hh, mm] = t.split(':').map((v) => parseInt(v, 10));
                if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
                return hh * 60 + mm;
            };

            const requestedDate = new Date(String(appointmentDate));
            if (Number.isNaN(requestedDate.getTime())) throw new Error('Invalid appointmentDate');
            const requestedTime = toTimeStr(appointmentTime);
            const requestedMin = timeToMinutes(requestedTime);
            if (!requestedTime || requestedMin === null) throw new Error('Invalid appointmentTime');

            const dateKey = requestedDate.toISOString().slice(0, 10);
            let blocks = null;
            try {
                blocks = await loadDoctorAvailabilityBlocksSupabase({ doctorId: doctorUuid, dateKey });
            } catch (_) {
                blocks = null;
            }
            if (blocks?.dayBlocked) return res.status(409).json({ message: 'Doctor is not available on this date.' });
            if (blocks && isMinutesBlockedByAvailability({ minutes: requestedMin, blocks })) {
                return res.status(409).json({ message: 'Selected time is not available.' });
            }

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

            const dayOffRows = await prisma.$queryRaw`
                SELECT day_of_week AS "dayOfWeek"
                FROM public.doctor_availability_day_offs
                WHERE doctor_id = ${doctorUuid}::uuid
                  AND lower(mode) = 'onsite'
                  AND active = true
            `;
            const dayOffs = (Array.isArray(dayOffRows) ? dayOffRows : [])
                .map((r) => Number(r?.dayOfWeek))
                .filter((v) => Number.isFinite(v) && v >= 0 && v <= 6);
            if (dayOffs.includes(requestedDate.getDay())) return res.status(409).json({ message: 'Doctor is not available on this day.' });

            const dateWindows = await prisma.$queryRaw`
                SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                       to_char(end_time, 'HH24:MI') AS "endTime",
                       slot_minutes AS "slotMinutes",
                       max_per_slot AS "maxPerSlot"
                FROM public.doctor_availability_date_windows
                WHERE doctor_id = ${doctorUuid}::uuid
                  AND lower(mode) = 'onsite'
                  AND active = true
                  AND date = ${dateKey}::date
                ORDER BY start_time ASC
            `;
            const dateWindowList = Array.isArray(dateWindows) ? dateWindows : [];

            const exceptions = await prisma.$queryRaw`
                SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                       to_char(end_time, 'HH24:MI') AS "endTime"
                FROM public.doctor_availability_exceptions
                WHERE doctor_id = ${doctorUuid}::uuid
                  AND lower(mode) = 'onsite'
                  AND date = ${dateKey}::date
            `;
            const exc = Array.isArray(exceptions) ? exceptions : [];
            const fullDayBlocked = exc.some((e) => !e?.startTime && !e?.endTime);
            if (fullDayBlocked) return res.status(409).json({ message: 'Doctor is not available on this date.' });

            const blockedByPartial = exc.some((e) => {
                const s = timeToMinutes(e?.startTime);
                const en = timeToMinutes(e?.endTime);
                if (s === null || en === null) return false;
                return requestedMin >= s && requestedMin < en;
            });
            if (blockedByPartial) return res.status(409).json({ message: 'Selected time is not available.' });

            let sourceList = dateWindowList;
            if (!sourceList.length) {
                const dow = requestedDate.getDay();
                const rules = await prisma.$queryRaw`
                    SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                           to_char(end_time, 'HH24:MI') AS "endTime",
                           slot_minutes AS "slotMinutes",
                           max_per_slot AS "maxPerSlot"
                    FROM public.doctor_availability_rules
                    WHERE doctor_id = ${doctorUuid}::uuid
                      AND lower(mode) = 'onsite'
                      AND active = true
                      AND day_of_week = ${dow}
                    ORDER BY start_time ASC
                `;
                sourceList = Array.isArray(rules) ? rules : [];
            }
            if (!sourceList.length) return res.status(409).json({ message: 'Doctor is not available on this day.' });

            let matchingRule = null;
            for (const r of sourceList) {
                const startMin = timeToMinutes(r?.startTime);
                const endMin = timeToMinutes(r?.endTime);
                const step = Math.max(5, Math.min(240, Math.trunc(Number(r?.slotMinutes || 30) || 30)));
                if (startMin === null || endMin === null) continue;
                if (requestedMin < startMin) continue;
                if (requestedMin + step > endMin) continue;
                if ((requestedMin - startMin) % step !== 0) continue;
                matchingRule = { maxPerSlot: Math.max(1, Math.min(20, Math.trunc(Number(r?.maxPerSlot || 1) || 1))) };
                break;
            }
            if (!matchingRule) return res.status(409).json({ message: 'Selected time is not available.' });

            const sameSlot = await prisma.appointments.findMany({
                where: {
                    doctor_uuid: doctorUuid,
                    consultation_mode: 'onsite',
                    appointment_date: requestedDate
                },
                select: { appointment_time: true, status: true }
            }).catch(() => []);
            const count = (Array.isArray(sameSlot) ? sameSlot : []).filter((a) => {
                const st = String(a.status || '').trim().toLowerCase();
                if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) return false;
                const t = a.appointment_time ? new Date(a.appointment_time) : null;
                if (!t) return false;
                const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                return time === requestedTime;
            }).length;
            if (count >= matchingRule.maxPerSlot) return res.status(409).json({ message: 'Selected slot is no longer available.' });
        }

        if (appointmentDate && timeObj) {
            const dateOnly = new Date(String(appointmentDate));
            if (Number.isNaN(dateOnly.getTime())) return res.status(400).json({ message: 'Invalid appointmentDate' });
            dateOnly.setHours(0, 0, 0, 0);

            const emailKey = String(email || '').trim();
            const pid = patientId ? String(patientId).trim() : '';
            const overlapRows = await prisma.appointments
                .findMany({
                    where: {
                        appointment_date: dateOnly,
                        appointment_time: timeObj,
                        OR: [
                            ...(pid ? [{ patient_id: pid }] : []),
                            ...(emailKey ? [{ email: { equals: emailKey, mode: 'insensitive' } }] : [])
                        ]
                    },
                    select: { id: true, status: true }
                })
                .catch(() => []);
            const hasOverlap = (Array.isArray(overlapRows) ? overlapRows : []).some((a) => {
                const st = String(a?.status || '').trim().toLowerCase();
                if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) return false;
                if (st.includes('completed') || st.includes('done')) return false;
                return true;
            });
            if (hasOverlap) return res.status(409).json({ message: 'Patient already has an appointment at the selected date/time.' });
        }

        const newAppointment = await prisma.appointments.create({
            data: {
                first_name: firstName,
                last_name: lastName,
                middle_name: middleName,
                email,
                phone,
                date_of_birth: dateOfBirth ? new Date(dateOfBirth) : null,
                gender,
                reason,
                appointment_date: appointmentDate ? new Date(appointmentDate) : null,
                appointment_time: timeObj,
                main_concern: mainConcern,
                symptoms_start: symptomsStart ? new Date(symptomsStart) : null,
                severity,
                description: description || null,
                body_parts: Array.isArray(bodyParts) ? bodyParts : [],
                symptoms: Array.isArray(symptoms) ? symptoms : [],
                emergency_symptoms: Array.isArray(emergencySymptoms) ? emergencySymptoms : [],
                emergency_name: emergencyName,
                emergency_relation: emergencyRelation,
                emergency_phone: emergencyPhone,
                doctor_id: doctorLabel,
                doctor_uuid: doctorUuid,
                status: normalizeAppointmentStatus(status || 'Pending'),
                patient_id: patientId ? String(patientId) : null,
                consultation_mode: resolvedMode,
                triage_status: resolvedMode === 'onsite' ? 'Unassessed' : 'Unassessed',
                assignment_status: (() => {
                    const raw = String(assignmentStatus || '').trim().toUpperCase();
                    if (raw === 'ASSIGNED' || raw === 'PENDING_ASSIGNMENT') return raw;
                    if (resolvedMode !== 'onsite') return 'ASSIGNED';
                    return doctorUuid ? 'ASSIGNED' : 'PENDING_ASSIGNMENT';
                })(),
                assigned_at: doctorUuid ? new Date() : null,
                assigned_by: null
            }
        });

        setTimeout(() => {
            applyAiTriageToAppointment(newAppointment.id.toString()).catch(() => {});
        }, 0);

        res.status(201).json({ 
            ...newAppointment, 
            id: newAppointment.id.toString(), 
            doctor: newAppointment.doctor_id, 
            doctorUuid: newAppointment.doctor_uuid || null,
            triageLevel: newAppointment.triage_level ?? null,
            triageStatus: newAppointment.triage_status || 'Unassessed',
            triageReasons: newAppointment.triage_reasons ?? null,
            triagedBy: newAppointment.triaged_by || null,
            triagedAt: newAppointment.triaged_at ?? null,
            assignmentStatus: newAppointment.assignment_status || null,
            assignedAt: newAppointment.assigned_at ?? null
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.post('/:id/triage/ai', requireRole(['admin', 'nurse', 'doctor']), async (req, res) => {
    try {
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid appointment id' });
        const updated = await applyAiTriageToAppointment(idRaw);
        if (!updated) return res.status(404).json({ message: 'Appointment not found or triage not applicable' });
        res.json({
            id: updated.id.toString(),
            triageLevel: updated.triage_level ?? null,
            triageStatus: updated.triage_status || 'Unassessed',
            triageReasons: updated.triage_reasons ?? null,
            triagedBy: updated.triaged_by || null,
            triagedAt: updated.triaged_at ?? null
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Server error' });
    }
});

// Secretary inbox: unassigned onsite appointments by specialization/department keyword.
router.get('/unassigned', requireRole(['admin', 'doctor_secretary', 'staff']), async (req, res) => {
    try {
        const specialization = String(req.query.specialization || '').trim();
        const date = String(req.query.date || '').trim(); // optional YYYY-MM-DD
        const take = Math.max(1, Math.min(300, parseInt(String(req.query.take || '120'), 10) || 120));

        const where = {
            consultation_mode: 'onsite',
            doctor_uuid: null,
            assignment_status: 'PENDING_ASSIGNMENT'
        };
        if (date) {
            const d = new Date(date);
            if (!Number.isNaN(d.getTime())) where.appointment_date = d;
        }

        let rows = await prisma.appointments.findMany({
            where,
            take,
            orderBy: [{ appointment_date: 'asc' }, { appointment_time: 'asc' }, { id: 'asc' }]
        }).catch(() => []);

        const matchesSpec = (apt) => {
            if (!specialization) return true;
            const key = specialization.toLowerCase();
            const reason = String(apt?.reason || '').toLowerCase();
            const docId = String(apt?.doctor_id || '').toLowerCase();
            return reason.includes(key) || docId.includes(key);
        };

        rows = (Array.isArray(rows) ? rows : []).filter((r) => {
            const st = String(r?.status || '').toLowerCase();
            if (st.includes('cancel') || st.includes('reject')) return false;
            if (st.includes('completed') || st.includes('done') || st.includes('paid')) return false;
            return matchesSpec(r);
        });

        res.json(rows.map((a) => ({
            ...a,
            id: a.id.toString(),
            doctor: a.doctor_id,
            doctorUuid: a.doctor_uuid || null,
            patientId: a.patient_id || null,
            appointmentDate: a.appointment_date,
            appointmentTime: a.appointment_time,
            consultationMode: a.consultation_mode,
            assignmentStatus: a.assignment_status || null,
            assignedAt: a.assigned_at ?? null
        })));
    } catch (e) {
        res.status(500).json({ message: String(e.message || 'Unable to load unassigned appointments') });
    }
});

// PATCH update status or assign doctor
router.patch('/:id', requireRole(['admin', 'nurse', 'doctor', 'doctor_secretary', 'cashier', 'staff']), async (req, res) => {
    try {
        const roleRaw = String(req.headers['x-user-role'] || '').trim().toLowerCase();
        const role = roleRaw.includes('doctor') && roleRaw.includes('secretary')
            ? 'doctor_secretary'
            : roleRaw.includes('doctor')
                ? 'doctor'
                : roleRaw.includes('admin')
                    ? 'admin'
                    : roleRaw.includes('nurse')
                        ? 'nurse'
                        : roleRaw;

        const {
            status,
            doctor,
            preferredDoctor,
            doctorId,
            appointmentTime,
            time,
            patientWaitingAt,
            patientWaitingName,
            triageLevel,
            triageStatus,
            triageReasons,
            triagedBy,
            triagedAt,
            assignmentStatus,
            assignedBy
        } = req.body;

        if (role === 'doctor') {
            if (
                status !== undefined ||
                patientWaitingAt !== undefined ||
                patientWaitingName !== undefined ||
                doctor !== undefined ||
                preferredDoctor !== undefined ||
                doctorId !== undefined ||
                appointmentTime !== undefined ||
                time !== undefined ||
                assignmentStatus !== undefined ||
                assignedBy !== undefined
            ) {
                return res.status(403).json({ message: 'Queue actions (Call/Start/End) are handled by the Doctor Secretary.' });
            }
        }

        const existing = await prisma.appointments.findUnique({
            where: { id: BigInt(req.params.id) }
        });
        if (!existing) return res.status(404).json({ message: 'Appointment not found' });
        
        const dataToUpdate = {};
        if (status !== undefined) {
            const nextStatus = normalizeAppointmentStatus(status);
            dataToUpdate.status = nextStatus;
            if (String(nextStatus || '').trim().toLowerCase() === 'completed') {
                dataToUpdate.completed_at = new Date();
                dataToUpdate.completed_by = String(req.headers['x-user-name'] || req.headers['x-user-email'] || req.headers['x-user-role'] || '').trim() || null;
            }
        }

        if (patientWaitingAt !== undefined) {
            const d = patientWaitingAt ? new Date(patientWaitingAt) : null;
            if (d && Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid patientWaitingAt' });
            dataToUpdate.patient_waiting_at = d;
        }
        if (patientWaitingName !== undefined) {
            dataToUpdate.patient_waiting_name = String(patientWaitingName || '').trim() || null;
        }
        
        const docToAssign = doctor || preferredDoctor;
        if (docToAssign !== undefined) dataToUpdate.doctor_id = docToAssign;
        const doctorIdRaw = String(doctorId || '').trim();
        if (doctorIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(doctorIdRaw)) {
            const doc = await prisma.doctors.findUnique({
                where: { id: doctorIdRaw },
                select: { first_name: true, last_name: true }
            }).catch(() => null);
            if (doc) {
                const label = `Dr. ${String(doc.first_name || '').trim()} ${String(doc.last_name || '').trim()}`.trim();
                if (label) dataToUpdate.doctor_id = label;
            }
            dataToUpdate.doctor_uuid = doctorIdRaw;
            dataToUpdate.assignment_status = 'ASSIGNED';
            dataToUpdate.assigned_at = new Date();
        }

        if (assignmentStatus !== undefined) {
            const raw = String(assignmentStatus || '').trim().toUpperCase();
            if (raw === 'ASSIGNED' || raw === 'PENDING_ASSIGNMENT') dataToUpdate.assignment_status = raw;
        }
        if (assignedBy !== undefined) {
            dataToUpdate.assigned_by = assignedBy ? String(assignedBy).trim() : null;
        }

        const requestedTimeRaw = String(appointmentTime || time || '').trim();
        if (requestedTimeRaw) {
            const toTimeStr = (value) => {
                const raw = String(value || '').trim();
                if (!raw) return '';
                const m = raw.match(/^(\d{1,2}):(\d{2})/);
                if (!m) return '';
                const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
                const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
                return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            };
            const timeToMinutes = (timeValue) => {
                const t = toTimeStr(timeValue);
                if (!t) return null;
                const [hh, mm] = t.split(':').map((v) => parseInt(v, 10));
                if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
                return hh * 60 + mm;
            };

            const resolvedTime = toTimeStr(requestedTimeRaw);
            const resolvedMin = timeToMinutes(resolvedTime);
            if (!resolvedTime || resolvedMin === null) return res.status(400).json({ message: 'Invalid appointmentTime' });

            const doctorUuid = String(dataToUpdate.doctor_uuid || existing.doctor_uuid || '').trim();
            if (!doctorUuid) return res.status(400).json({ message: 'Missing doctor assignment.' });

            const consultationMode = String(existing.consultation_mode || '').trim().toLowerCase() || 'onsite';
            if (consultationMode === 'onsite') {
                const requestedDate = existing.appointment_date ? new Date(existing.appointment_date) : null;
                if (!requestedDate || Number.isNaN(requestedDate.getTime())) return res.status(400).json({ message: 'Missing appointment date.' });
                const dateKey = requestedDate.toISOString().slice(0, 10);

                // Skip availability check if doctor and time haven't changed for this record
                const existingTime = formatHHmm(existing.appointment_time);
                const doctorChanged = dataToUpdate.doctor_uuid && dataToUpdate.doctor_uuid !== existing.doctor_uuid;
                const timeChanged = resolvedTime !== existingTime;

                if (doctorChanged || timeChanged) {
                    let blocks = null;
                    try {
                        blocks = await loadDoctorAvailabilityBlocksSupabase({ doctorId: doctorUuid, dateKey });
                    } catch (_) {
                        blocks = null;
                    }
                    if (blocks?.dayBlocked) return res.status(409).json({ message: 'Doctor is not available on this date (Full Day Blocked).' });
                    if (blocks && isMinutesBlockedByAvailability({ minutes: resolvedMin, blocks })) {
                        return res.status(409).json({ message: `Selected time (${resolvedTime}) is blocked by doctor availability.` });
                    }

                    const dayOffRows = await prisma.$queryRaw`
                        SELECT day_of_week AS "dayOfWeek"
                        FROM public.doctor_availability_day_offs
                        WHERE doctor_id = ${doctorUuid}::uuid
                          AND lower(mode) = 'onsite'
                          AND active = true
                    `;
                    const dayOffs = (Array.isArray(dayOffRows) ? dayOffRows : [])
                        .map((r) => Number(r?.dayOfWeek))
                        .filter((v) => Number.isFinite(v) && v >= 0 && v <= 6);
                    if (dayOffs.includes(requestedDate.getDay())) return res.status(409).json({ message: 'Doctor is not available on this day of the week (Day Off).' });

                    const exceptions = await prisma.$queryRaw`
                        SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                               to_char(end_time, 'HH24:MI') AS "endTime"
                        FROM public.doctor_availability_exceptions
                        WHERE doctor_id = ${doctorUuid}::uuid
                          AND lower(mode) = 'onsite'
                          AND date = ${dateKey}::date
                    `;
                    const exc = Array.isArray(exceptions) ? exceptions : [];
                    const fullDayBlocked = exc.some((e) => !e?.startTime && !e?.endTime);
                    if (fullDayBlocked) return res.status(409).json({ message: 'Doctor is not available on this date (Exception Block).' });

                    const blockedByPartial = exc.some((e) => {
                        const s = timeToMinutes(e?.startTime);
                        const en = timeToMinutes(e?.endTime);
                        if (s === null || en === null) return false;
                        return resolvedMin >= s && resolvedMin < en;
                    });
                    if (blockedByPartial) return res.status(409).json({ message: `Selected time (${resolvedTime}) is within a blocked time range.` });

                    const dateWindows = await prisma.$queryRaw`
                        SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                               to_char(end_time, 'HH24:MI') AS "endTime",
                               slot_minutes AS "slotMinutes",
                               max_per_slot AS "maxPerSlot"
                        FROM public.doctor_availability_date_windows
                        WHERE doctor_id = ${doctorUuid}::uuid
                          AND lower(mode) = 'onsite'
                          AND active = true
                          AND date = ${dateKey}::date
                        ORDER BY start_time ASC
                    `;
                    const dateWindowList = Array.isArray(dateWindows) ? dateWindows : [];

                    let sourceList = dateWindowList;
                    if (!sourceList.length) {
                        const dow = requestedDate.getDay();
                        const rules = await prisma.$queryRaw`
                            SELECT to_char(start_time, 'HH24:MI') AS "startTime",
                                   to_char(end_time, 'HH24:MI') AS "endTime",
                                   slot_minutes AS "slotMinutes",
                                   max_per_slot AS "maxPerSlot"
                            FROM public.doctor_availability_rules
                            WHERE doctor_id = ${doctorUuid}::uuid
                              AND lower(mode) = 'onsite'
                              AND active = true
                              AND day_of_week = ${dow}
                            ORDER BY start_time ASC
                        `;
                        sourceList = Array.isArray(rules) ? rules : [];
                    }
                    if (!sourceList.length) return res.status(409).json({ message: 'Doctor has no availability rules set for this day.' });

                    let matchingRule = null;
                    for (const r of sourceList) {
                        const startMin = timeToMinutes(r?.startTime);
                        const endMin = timeToMinutes(r?.endTime);
                        const step = Math.max(5, Math.min(240, Math.trunc(Number(r?.slotMinutes || 30) || 30)));
                        if (startMin === null || endMin === null) continue;
                        if (resolvedMin < startMin) continue;
                        if (resolvedMin + step > endMin) continue;
                        if ((resolvedMin - startMin) % step !== 0) continue;
                        matchingRule = { maxPerSlot: Math.max(1, Math.min(20, Math.trunc(Number(r?.maxPerSlot || 1) || 1))) };
                        break;
                    }
                    if (!matchingRule) return res.status(409).json({ message: `Selected time (${resolvedTime}) does not match any available doctor slots.` });

                    const sameSlot = await prisma.appointments.findMany({
                        where: {
                            doctor_uuid: doctorUuid,
                            consultation_mode: 'onsite',
                            appointment_date: requestedDate
                        },
                        select: { id: true, appointment_time: true, status: true }
                    }).catch(() => []);
                    const count = (Array.isArray(sameSlot) ? sameSlot : []).filter((a) => {
                        if (String(a.id) === String(existing.id)) return false;
                        const st = String(a.status || '').trim().toLowerCase();
                        if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) return false;
                        const t = a.appointment_time ? new Date(a.appointment_time) : null;
                        if (!t) return false;
                        const hhmm = formatHHmm(t);
                        return hhmm === resolvedTime;
                    }).length;
                    if (count >= matchingRule.maxPerSlot) return res.status(409).json({ message: 'Selected slot is already full.' });
                }
            }

            if (existing.appointment_date) {
                const pid = existing.patient_id ? String(existing.patient_id).trim() : '';
                const emailKey = String(existing.email || '').trim();
                const dateOnly = new Date(existing.appointment_date);
                dateOnly.setHours(0, 0, 0, 0);
                
                const [hhx, mmx] = resolvedTime.split(':').map((v) => parseInt(v, 10));
                const dummy = new Date(dateOnly);
                dummy.setHours(hhx, mmx, 0, 0);

                const overlapRows = await prisma.appointments
                    .findMany({
                        where: {
                            appointment_date: dateOnly,
                            appointment_time: dummy,
                            id: { not: BigInt(req.params.id) },
                            OR: [
                                ...(pid ? [{ patient_id: pid }] : []),
                                ...(emailKey ? [{ email: { equals: emailKey, mode: 'insensitive' } }] : [])
                            ]
                        },
                        select: { id: true, status: true }
                    })
                    .catch(() => []);
                const hasOverlap = (Array.isArray(overlapRows) ? overlapRows : []).some((a) => {
                    const st = String(a?.status || '').trim().toLowerCase();
                    if (st.includes('cancel') || st.includes('reject') || st.includes('no show') || st.includes('no-show')) return false;
                    if (st.includes('completed') || st.includes('done')) return false;
                    return true;
                });
                if (hasOverlap) return res.status(409).json({ message: 'Patient already has an appointment at the selected date/time.' });
                
                dataToUpdate.appointment_time = dummy;
            }
        }

        if (triageLevel !== undefined) {
            const lvl = Number(triageLevel);
            dataToUpdate.triage_level = Number.isFinite(lvl) ? Math.max(1, Math.min(4, Math.floor(lvl))) : null;
        }
        if (triageStatus !== undefined) dataToUpdate.triage_status = triageStatus;
        if (triageReasons !== undefined) dataToUpdate.triage_reasons = triageReasons;
        if (triagedBy !== undefined) dataToUpdate.triaged_by = triagedBy;
        if (triagedAt !== undefined) dataToUpdate.triaged_at = triagedAt ? new Date(triagedAt) : null;
        const triageTouched = triageLevel !== undefined || triageStatus !== undefined || triageReasons !== undefined || triagedBy !== undefined || triagedAt !== undefined;
        if (triageTouched) {
            const actor = inferActorLabel(req);
            const existingTriagedBy = String(existing.triaged_by || '').toLowerCase();
            const isExistingAi = existingTriagedBy.includes('ai');
            if (triagedBy === undefined) dataToUpdate.triaged_by = actor;
            if (triagedAt === undefined) dataToUpdate.triaged_at = new Date();
            if (isExistingAi) {
                dataToUpdate.triage_overridden_by = actor;
                dataToUpdate.triage_overridden_at = new Date();
            }
        }

        const updatedAppointment = await prisma.appointments.update({
            where: { id: BigInt(req.params.id) },
            data: dataToUpdate
        });

        const prevAssign = String(existing.assignment_status || '').trim().toUpperCase();
        const nextAssign = String(updatedAppointment.assignment_status || '').trim().toUpperCase();
        const becameAssigned = prevAssign !== 'ASSIGNED' && nextAssign === 'ASSIGNED';
        const doctorUuidAssigned = String(updatedAppointment.doctor_uuid || '').trim();
        const doctorUuidChanged = String(existing.doctor_uuid || '').trim() !== doctorUuidAssigned;
        const modeKey = String(updatedAppointment.consultation_mode || existing.consultation_mode || 'onsite').trim().toLowerCase() || 'onsite';

        if (nextAssign === 'ASSIGNED' && modeKey === 'onsite' && doctorUuidAssigned && (becameAssigned || doctorUuidChanged)) {
            const { serviceKey, serviceName } = inferConsultServiceFromAppointment(updatedAppointment);
            const apptId = BigInt(req.params.id);
            const patientId = updatedAppointment.patient_id ? String(updatedAppointment.patient_id) : null;

            let resolvedServiceName = serviceName;
            try {
                await ensureBillingTablesExist(prisma);
                await prisma.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS public.doctor_service_fees (
                      id bigserial PRIMARY KEY,
                      doctor_uuid uuid NOT NULL,
                      service_key text NOT NULL,
                      service_name text NOT NULL,
                      default_fee numeric(10,2) NOT NULL DEFAULT 0,
                      active boolean NOT NULL DEFAULT true,
                      created_at timestamptz NOT NULL DEFAULT now(),
                      updated_at timestamptz NOT NULL DEFAULT now(),
                      UNIQUE (doctor_uuid, service_key)
                    );
                `).catch(() => {});
            } catch (_) {}

            const amountMoney = toMoney(100);
            const itemDescription = `Consultation Fee - ${resolvedServiceName || serviceName || 'Consultation'}`.trim();

            try {
                await ensureBillingTablesExist(prisma);
                await prisma.$transaction(async (tx) => {
                    let inv = await tx.billing_invoices.findFirst({
                        where: { appointment_id: apptId },
                        orderBy: { created_at: 'desc' }
                    }).catch(() => null);

                    if (!inv) {
                        inv = await tx.billing_invoices.create({
                            data: {
                                patient_id: patientId,
                                appointment_id: apptId,
                                status: 'Ready',
                                notes: `Onsite consultation • ${String(updatedAppointment.reason || '').trim() || 'Consultation'}`.trim(),
                                created_by: String(req.headers['x-user-email'] || '').trim() || null,
                                total_amount: amountMoney
                            }
                        });
                        await tx.billing_invoice_items.create({
                            data: {
                                invoice_id: inv.id,
                                description: itemDescription,
                                quantity: 1,
                                unit_price: amountMoney,
                                line_total: amountMoney
                            }
                        }).catch(() => null);
                    } else {
                        await tx.billing_invoices.update({
                            where: { id: inv.id },
                            data: { status: 'Ready', total_amount: amountMoney, updated_at: new Date() }
                        }).catch(() => null);
                        const item = await tx.billing_invoice_items
                            .findFirst({ where: { invoice_id: inv.id }, orderBy: { created_at: 'asc' } })
                            .catch(() => null);
                        if (item) {
                            await tx.billing_invoice_items
                                .update({
                                    where: { id: item.id },
                                    data: { description: itemDescription, quantity: 1, unit_price: amountMoney, line_total: amountMoney }
                                })
                                .catch(() => null);
                        } else {
                            await tx.billing_invoice_items
                                .create({
                                    data: {
                                        invoice_id: inv.id,
                                        description: itemDescription,
                                        quantity: 1,
                                        unit_price: amountMoney,
                                        line_total: amountMoney
                                    }
                                })
                                .catch(() => null);
                        }
                    }
                });
            } catch (_) {}

            const patientEmail = String(updatedAppointment.email || '').trim();
            const statusKey = String(updatedAppointment.status || '').trim();
            const apptDate = updatedAppointment.appointment_date ? new Date(updatedAppointment.appointment_date) : null;
            const apptTime = updatedAppointment.appointment_time ? new Date(updatedAppointment.appointment_time) : null;
            const dateLabel = apptDate && !Number.isNaN(apptDate.getTime()) ? apptDate.toISOString().slice(0, 10) : '';
            const timeLabel = apptTime && !Number.isNaN(apptTime.getTime()) ? normalizeTimeToHHMM(apptTime) : '';
            const doctorLabel = String(updatedAppointment.doctor_id || '').trim();

            if (becameAssigned && patientEmail && dateLabel && timeLabel) {
                const subject = `Appointment Confirmed • ${dateLabel} ${timeLabel}`;
                const serviceLabel = resolvedServiceName || serviceName || 'Consultation';
                const templateParams = {
                    subject: 'Appointment Confirmed',
                    message_body: 'Great news! Your appointment has been confirmed. Please see the details below.',
                    service_label: serviceLabel,
                    scheduled_time: `${dateLabel} at ${timeLabel}`,
                    status_label: statusKey || 'Confirmed',
                    footer_note: `Doctor: ${doctorLabel || 'To be assigned'}. Billing: PHP ${amountMoney}. Important: Please arrive at the hospital at least 15 minutes before your scheduled time for registration.`
                };
                
                sendAppointmentSummaryEmail({
                    to: patientEmail,
                    subject,
                    templateParams
                }).catch(() => {});
            }
        }

        const prevStatus = String(existing.status || '').trim().toLowerCase();
        const nextStatus = String(updatedAppointment.status || '').trim().toLowerCase();
        const movedToConfirmed = (nextStatus === 'confirmed' || nextStatus === 'approved') && prevStatus !== nextStatus;
        if (movedToConfirmed) {
            const patient = await ensurePatientFromAppointment(updatedAppointment).catch(() => null);
            if (patient?.id) {
                await prisma.appointments
                    .update({
                        where: { id: BigInt(req.params.id) },
                        data: { patient_id: String(patient.id) }
                    })
                    .catch(() => null);
            }
        }

        const idStr = String(req.params.id);
        if (status !== undefined && prevStatus !== nextStatus) {
            await logAppointmentActivity(req, idStr, 'Appointment Status Updated', `Status changed from "${existing.status || ''}" to "${updatedAppointment.status || ''}".`);
        }
        if (docToAssign !== undefined && String(existing.doctor_id || '') !== String(updatedAppointment.doctor_id || '')) {
            await logAppointmentActivity(req, idStr, 'Doctor Assigned', `Assigned doctor changed from "${existing.doctor_id || ''}" to "${updatedAppointment.doctor_id || ''}".`);
        }
        if (triageLevel !== undefined || triageStatus !== undefined || triageReasons !== undefined) {
            const lvl = updatedAppointment.triage_level ?? '';
            await logAppointmentActivity(req, idStr, 'Triage Updated', `Triage updated. Level: ${lvl || 'Unassessed'}.`);
        }
        
        const responseData = { 
            ...updatedAppointment, 
            id: updatedAppointment.id.toString(),
            doctor: updatedAppointment.doctor_id,
            triageLevel: updatedAppointment.triage_level ?? null,
            triageStatus: updatedAppointment.triage_status || 'Unassessed',
            triageReasons: updatedAppointment.triage_reasons ?? null,
            triagedBy: updatedAppointment.triaged_by || null,
            triagedAt: updatedAppointment.triaged_at ?? null,
            triageOverriddenBy: updatedAppointment.triage_overridden_by || null,
            triageOverriddenAt: updatedAppointment.triage_overridden_at ?? null,
            assignmentStatus: updatedAppointment.assignment_status || null,
            assignedAt: updatedAppointment.assigned_at ?? null
        };
        
        res.json(responseData);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.get('/:id/audit', requireRole(['admin', 'nurse', 'doctor', 'doctor_secretary', 'cashier', 'staff']), async (req, res) => {
    try {
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid appointment id.' });
        const takeRaw = Number(req.query.take);
        const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 200) : 50;
        const target = `appointment:${idRaw}`;
        const rows = await prisma.activity_logs.findMany({
            where: { target },
            orderBy: { timestamp: 'desc' },
            take
        });
        res.json(
            rows.map((r) => ({
                ...r,
                id: r.id.toString()
            }))
        );
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/:id/video/start', requireRole(['doctor']), async (req, res) => {
    try {
        await ensureAppointmentsSchema();
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid appointment id.' });
        const id = BigInt(idRaw);

        const doctorName = inferName(req);
        if (!doctorName) return res.status(401).json({ message: 'Missing x-user-name.' });

        let apt = await prisma.appointments.findUnique({ where: { id } });
        if (!apt) {
            // Fallback: Check if the provided ID is actually a video_booking_holds ID
            const hold = await prisma.$queryRaw`SELECT appointment_id FROM video_booking_holds WHERE id = ${id}`.catch(()=>[]);
            if (hold && hold.length > 0 && hold[0].appointment_id) {
                apt = await prisma.appointments.findUnique({ where: { id: hold[0].appointment_id } });
            }
        }
        
        if (!apt) {
            console.log(`[Video Start] 404 - Appointment ${idRaw} not found in DB`);
            return res.status(404).json({ message: `DEBUG: Appointment ID ${idRaw} not found in database.` });
        }

        if (!isVideoAppointment(apt)) {
            console.log(`[Video Start] 400 - Appointment ${idRaw} is not a video consult. Mode: ${apt.consultation_mode}, Reason: ${apt.reason}`);
            return res.status(400).json({ message: `DEBUG: Appointment ${idRaw} is not marked as a video consultation.` });
        }

        const reqDoctorUuid = String(req.headers['x-doctor-uuid'] || '').trim();

        let isAssigned = false;

        // 1. Check UUID match (most reliable)
        if (apt.doctor_uuid && reqDoctorUuid && apt.doctor_uuid === reqDoctorUuid) {
            isAssigned = true;
        } else {
            // 2. Fallback to name string matching
            const assigned = normalizeAssignee(apt.doctor_id);
            const actor = normalizeAssignee(doctorName);
            if (assigned && assigned === actor) {
                isAssigned = true;
            }
        }

        if (!isAssigned) {
            const assigned = normalizeAssignee(apt.doctor_id);
            const actor = normalizeAssignee(doctorName);
            console.log(`[Video Start] 403 - Doctor mismatch. Assigned UUID: ${apt.doctor_uuid}, Req UUID: ${reqDoctorUuid}. Assigned Name: ${assigned}, Actor: ${actor}`);
            return res.status(403).json({ message: `DEBUG: Doctor mismatch. Assigned to ${assigned || apt.doctor_uuid}, but you are logged in as ${actor || reqDoctorUuid}.` });
        }

        if (!apt.meeting_room_id) {
            const roomId = makeRoomId(idRaw);
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
            const updated = await prisma.appointments.update({
                where: { id },
                data: {
                    meeting_room_id: roomId,
                    meeting_created_at: now,
                    meeting_started_at: now,
                    meeting_expires_at: expiresAt
                }
            });
            const url = buildJitsiUrl(updated.meeting_room_id, doctorName);
            await logAppointmentActivity(req, idRaw, 'Video Call Started', 'Doctor started the video consultation.');
            return res.json({ roomId: updated.meeting_room_id, url, startedAt: updated.meeting_started_at });
        }

        if (!apt.meeting_started_at) {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
            const updated = await prisma.appointments.update({
                where: { id },
                data: { meeting_started_at: now, meeting_expires_at: expiresAt }
            });
            const url = buildJitsiUrl(updated.meeting_room_id, doctorName);
            await logAppointmentActivity(req, idRaw, 'Video Call Started', 'Doctor started the video consultation.');
            return res.json({ roomId: updated.meeting_room_id, url, startedAt: updated.meeting_started_at });
        }

        const url = buildJitsiUrl(apt.meeting_room_id, doctorName);
        await logAppointmentActivity(req, idRaw, 'Video Call Started', 'Doctor started the video consultation.');
        res.json({ roomId: apt.meeting_room_id, url, startedAt: apt.meeting_started_at });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.get('/:id/video/join', requireRole(['patient', 'doctor']), async (req, res) => {
    try {
        await ensureAppointmentsSchema();
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid appointment id.' });
        const id = BigInt(idRaw);

        const role = inferRole(req);
        const email = inferEmail(req);
        const name = inferName(req);

        let apt = await prisma.appointments.findUnique({ where: { id } });
        if (!apt) {
            const hold = await prisma.$queryRaw`SELECT appointment_id FROM video_booking_holds WHERE id = ${id}`.catch(()=>[]);
            if (hold && hold.length > 0 && hold[0].appointment_id) {
                apt = await prisma.appointments.findUnique({ where: { id: hold[0].appointment_id } });
            }
        }
        
        if (!apt) return res.status(404).json({ message: 'Appointment not found.' });

        if (!isVideoAppointment(apt)) return res.status(400).json({ message: 'Appointment is not a video consultation.' });
        let roomId = apt.meeting_room_id;
        let startedAt = apt.meeting_started_at || null;
        if (!roomId) {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
            const updated = await prisma.appointments.update({
                where: { id },
                data: {
                    meeting_room_id: makeRoomId(idRaw),
                    meeting_created_at: now,
                    meeting_expires_at: expiresAt
                }
            });
            roomId = updated.meeting_room_id;
            startedAt = updated.meeting_started_at || null;
        }

        if (role === 'doctor') {
            const reqDoctorUuid = String(req.headers['x-doctor-uuid'] || '').trim();
            let isAssigned = false;
            
            if (apt.doctor_uuid && reqDoctorUuid && apt.doctor_uuid === reqDoctorUuid) {
                isAssigned = true;
            } else {
                const assigned = normalizeAssignee(apt.doctor_id);
                const actor = normalizeAssignee(name);
                if (assigned && assigned === actor) {
                    isAssigned = true;
                }
            }

            if (!isAssigned) return res.status(403).json({ message: 'Not assigned to this doctor.' });
            
            const url = buildJitsiUrl(roomId, name);
            return res.json({ roomId, url, startedAt });
        }

        if (role === 'patient') {
            if (!email) return res.status(401).json({ message: 'Missing user email.' });
            const matchesEmail = String(apt.email || '').trim().toLowerCase() && String(apt.email || '').trim().toLowerCase() === email;
            let matchesPatientId = false;
            if (!matchesEmail && apt.patient_id) {
                const patient = await prisma.patients.findFirst({
                    where: { email: { equals: email, mode: 'insensitive' } },
                    select: { id: true }
                });
                matchesPatientId = patient?.id && String(patient.id) === String(apt.patient_id);
            }
            if (!matchesEmail && !matchesPatientId) return res.status(403).json({ message: 'Not allowed to join this call.' });
            const url = buildJitsiUrl(roomId, inferName(req) || 'Patient');
            return res.json({ roomId, url, startedAt });
        }

        res.status(403).json({ message: 'Forbidden' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Completion loop: mark appointment as completed
router.post('/:id/complete', requireRole(['admin', 'nurse', 'doctor']), async (req, res) => {
    try {
        await ensureAppointmentsSchema();
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid appointment id.' });
        const id = BigInt(idRaw);

        const apt = await prisma.appointments.findUnique({ where: { id } }).catch(() => null);
        if (!apt) return res.status(404).json({ message: 'Appointment not found.' });

        const currentStatus = String(apt.status || '').trim().toLowerCase();
        if (currentStatus.includes('cancel') || currentStatus.includes('reject')) {
            return res.status(400).json({ message: 'Cancelled appointments cannot be completed.' });
        }

        const actor = String(req.headers['x-user-name'] || req.headers['x-user-email'] || req.headers['x-user-role'] || '').trim() || 'System';
        const updated = await prisma.appointments.update({
            where: { id },
            data: { status: 'Completed', completed_at: new Date(), completed_by: actor }
        });

        await prisma.activity_logs.create({
            data: {
                actor_name: actor,
                role: String(req.headers['x-user-role'] || '').trim() || 'nurse',
                action: 'Appointment Completed',
                target: String(updated.doctor_id || updated.doctor_uuid || 'Appointment'),
                details: `Completed appointment ${updated.id.toString()}`
            }
        }).catch(() => {});

        return res.json({
            ...updated,
            id: updated.id.toString(),
            completedAt: updated.completed_at || null,
            completedBy: updated.completed_by || null
        });
    } catch (err) {
        return res.status(500).json({ message: String(err?.message || 'Unable to complete appointment') });
    }
});

module.exports = router;

