const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset } = require('../utils/normalize');
const { resolveClinicalServicePricing } = require('../utils/clinicalServiceCatalog');
const { ensureBillingTablesExist, toMoney } = require('../utils/billingLedger');

router.use(requireRole(['admin', 'nurse', 'doctor', 'pharmacist', 'staff', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']));

function getRequesterRole(req) {
    return String(req.headers['x-user-role'] || '').trim().toLowerCase();
}

function getRequesterEmail(req) {
    const raw = String(req.headers['x-user-email'] || '');
    return normalizeEmail(raw);
}

function inferRequesterName(req) {
    const raw = String(req.headers['x-user-name'] || '').trim();
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

        console.log('Sending EmailJS request to:', to);

        const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller?.signal
        });
        
        const data = await resp.text().catch(() => '');
        console.log('EmailJS Response:', { ok: resp.ok, status: resp.status, data });
        return { ok: resp.ok, provider: 'emailjs', data };
    } catch (e) {
        console.error('EmailJS Error:', e);
        return { ok: false, error: String(e?.message || e) };
    } finally {
        clearTimeout(timeout);
    }
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
        needsDoctor: true,
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

function toPatientResponse(row) {
    if (!row || typeof row !== 'object') return row;
    return {
        ...row,
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

        const patients = await prisma.patients.findMany({
            where: Object.keys(where).length ? where : undefined,
            orderBy: { created_at: 'desc' },
            ...(limit ? { take: limit } : {}),
            ...(offset ? { skip: offset } : {})
        });
        res.json(patients.map(toPatientResponse));
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

        res.json(serializePayload(payload));
    } catch (err) {
        res.status(500).json({ message: 'Error fetching full patient record', error: err.message });
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

        const patient = await prisma.patients.findUnique({
            where: { id: req.params.id }
        });
        if (!patient) return res.status(404).json({ message: "Patient not found" });
        res.json(toPatientResponse(patient));
    } catch (err) {
        res.status(500).json({ message: "Error fetching patient", error: err.message });
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
        });

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
        res.status(500).json({ message: err.message || 'Error registering ER patient' });
    }
});

router.post('/walk-in-intake', requireRole(['admin', 'nurse']), async (req, res) => {
    try {
        await Promise.all([
            ensureNurseTasksTable(),
            ensureWalkInCounterSchemaOnce()
        ]);
        const payload = req.body || {};
        const routeTypeRaw = String(payload.routeType || '').trim();
        const routeMeta = getWalkInRouteMeta(routeTypeRaw);
        const patientMode = String(payload.patientMode || 'new').trim().toLowerCase() === 'existing' ? 'existing' : 'new';
        const now = new Date();
        const manilaDateKey = manilaDateKeyFromNow(now);
        const requesterName = inferRequesterName(req);
        const normalizedEmail = payload.email ? normalizeEmail(payload.email) : '';

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
                        clinical_records: mergeWalkInClinicalRecords(null, intakeEntry)
                    }
                });
            }

            const patientName = `${String(patient.first_name || '').trim()} ${String(patient.last_name || '').trim()}`.trim() || 'Walk-in Patient';
            let createdRecord = null;

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

                if (routeMeta.type === 'onsite_consult') {
                    try {
                        await ensureBillingTablesExist(tx);
                        await tx.$executeRawUnsafe(`
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
                            await tx.billing_invoice_items.create({
                                data: {
                                    invoice_id: inv.id,
                                    description,
                                    quantity: 1,
                                    unit_price: amountMoney,
                                    line_total: amountMoney
                                }
                            }).catch(() => null);
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
                const service = String(payload.mainConcern || '').trim() || routeMeta.label;
                const isEcg = /\becg\b/i.test(service);
                const kind = routeMeta.type === 'lab' ? 'Laboratory' : isEcg ? 'ECG' : 'Radiology';
                const assignedRole = routeMeta.type === 'lab' ? 'medtech' : isEcg ? 'ecg_operator' : 'radiographer';
                const pricing = resolveClinicalServicePricing({ kind, service });
                const status = pricing?.configured && Number(pricing?.unitPrice || 0) > 0 ? 'For Payment' : 'Pending';
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
                    target: routeMeta.requestTarget || routeMeta.label
                };
            }

            // --- COMMON LOGIC FOR SELECTED LAB/IMAGING SERVICES ---
            // This now runs for ALL walk-in intakes if checkboxes were checked
            const generatedExtraTickets = [];
            const commonDetailLines = [
                `Vitals: Temp ${intakeEntry.vitals.temperature ?? '—'}, BP ${intakeEntry.vitals.bloodPressure || '—'}, HR ${intakeEntry.vitals.heartRate ?? '—'}`,
                `Main Concern: ${String(payload.mainConcern || '').trim() || 'Walk-in'}`
            ];

            if (Array.isArray(payload.selectedLabServices) && payload.selectedLabServices.length > 0) {
                for (const service of payload.selectedLabServices) {
                    const { ticket: labTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], 'LAB');
                    generatedExtraTickets.push(labTicket);
                    await tx.clinical_orders.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            kind: 'Laboratory',
                            service: service,
                            priority: 'Routine',
                            status: 'Pending',
                            notes: `Auto-created from Nurse Walk-In Intake\nTicket: ${labTicket}\n${commonDetailLines.join('\n')}`,
                            ordered_by_name: requesterName,
                            ordered_by_role: 'Nurse',
                            assigned_role: 'Medtech',
                            updated_at: new Date()
                        }
                    });
                }
            }

            if (Array.isArray(payload.selectedImagingServices) && payload.selectedImagingServices.length > 0) {
                for (const service of payload.selectedImagingServices) {
                    const isECG = service.toLowerCase().includes('ecg');
                    const { ticket: imgTicket } = await nextWalkInTicket(tx, now.toISOString().split('T')[0], isECG ? 'ECG' : 'IMG');
                    generatedExtraTickets.push(imgTicket);
                    await tx.clinical_orders.create({
                        data: {
                            patient_id: patient.id,
                            patient_name: patientName,
                            kind: 'Imaging',
                            service: service,
                            priority: 'Routine',
                            status: 'Pending',
                            notes: `Auto-created from Nurse Walk-In Intake\nTicket: ${imgTicket}\n${commonDetailLines.join('\n')}`,
                            ordered_by_name: requesterName,
                            ordered_by_role: 'Nurse',
                            assigned_role: isECG ? 'ECG Operator' : 'Radiographer',
                            updated_at: new Date()
                        }
                    });
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

            // Fixed 100 pesos billing for selected services
            const hasServices = (payload.selectedLabServices?.length > 0) || (payload.selectedImagingServices?.length > 0);
            if (hasServices) {
                await tx.billing_invoices.create({
                    data: {
                        patients: { connect: { id: patient.id } },
                        total_amount: 100,
                        status: 'Pending',
                        created_by: requesterName,
                        notes: 'Nurse Walk-In Service Fee (Fixed Rate) - Registration & Service Intake Fee (Onsite)'
                    }
                });
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

            return { patient, createdRecord };
        }, { timeout: 20000 });

        let emailSent = false;
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
                
                const sent = await sendAppointmentSummaryEmail({ to, subject, templateParams }).catch(() => ({ ok: false }));
                emailSent = Boolean(sent?.ok);
            }
        }

        res.status(201).json({
            patient: result.patient,
            routeType: routeMeta.type,
            routeLabel: routeMeta.label,
            routing: { ...result.createdRecord, emailSent }
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Error processing walk-in intake' });
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
        const { password, address, emergencyContacts, ...updateData } = req.body;
        
        // If password is being updated, hash it
        // if (password) {
        //     const salt = await bcrypt.genSalt(10);
        //     updateData.password = await bcrypt.hash(password, salt);
        // }

        // Map mongoose fields to prisma fields
        const prismaData = {
            first_name: updateData.firstName,
            last_name: updateData.lastName,
            middle_name: updateData.middleName,
            date_of_birth: updateData.dateOfBirth ? new Date(updateData.dateOfBirth) : undefined,
            gender: updateData.gender,
            contact_number: updateData.phone || updateData.contactNumber,
            email: updateData.email,
            blood_type: updateData.bloodType,
            allergies: updateData.allergies,
            philhealth_number: updateData.philHealthNumber,
            admission_status: updateData.admissionStatus,
            ward_number: updateData.wardNumber,
            diagnosis: updateData.diagnosis,
            attending_doctor: updateData.attendingDoctor,
            admission_date: updateData.admissionDate ? new Date(updateData.admissionDate) : undefined,
            clinical_records: updateData.clinicalRecords
        };

        // Handle address fields
        if (address) {
            if (address.street) prismaData.street = address.street;
            if (address.city) prismaData.city = address.city;
            if (address.province) prismaData.province = address.province;
            if (address.postalCode) prismaData.postal_code = address.postalCode;
            if (address.country) prismaData.country = address.country;
        }

        // Handle emergency contacts
        if (emergencyContacts) {
            prismaData.emergency_contacts = emergencyContacts;
        }

        // Remove undefined fields
        Object.keys(prismaData).forEach(key => prismaData[key] === undefined && delete prismaData[key]);
        
        const updatedPatient = await prisma.patients.update({
            where: { id: req.params.id },
            data: prismaData
        });

        res.json(updatedPatient);
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ message: "Patient not found" });
        }
        res.status(500).json({ message: "Error updating patient", error: err.message });
    }
});

module.exports = router;

