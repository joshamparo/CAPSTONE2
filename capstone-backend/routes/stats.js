const express = require('express');
const router = express.Router();
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

let adminOverviewCache = { fetchedAt: 0, payload: null, promise: null };
const ADMIN_OVERVIEW_CACHE_MS = 1000;

function safeCount(task, fallback = 0) {
    return Promise.resolve()
        .then(task)
        .catch(() => fallback);
}

function safeRaw(task, fallback) {
    return Promise.resolve()
        .then(task)
        .catch(() => fallback);
}

let symptomInsightSchemaReady = false;
let symptomInsightSchemaPromise = null;

async function ensureSymptomInsightsSchema() {
    if (symptomInsightSchemaReady) return;
    if (symptomInsightSchemaPromise) return symptomInsightSchemaPromise;
    symptomInsightSchemaPromise = (async () => {
        try {
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS admin_symptom_insights (
                    month_key TEXT PRIMARY KEY,
                    payload JSONB NOT NULL,
                    algorithm_version TEXT NOT NULL DEFAULT 'v1',
                    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            `);
        } catch (_) {
        } finally {
            symptomInsightSchemaReady = true;
        }
    })();
    return symptomInsightSchemaPromise;
}

ensureSymptomInsightsSchema().catch(() => {});

async function ensureBillingTablesExist() {
    const reg = await prisma.$queryRaw`
        SELECT to_regclass('public.billing_invoices')::text AS billing_invoices,
               to_regclass('public.billing_invoice_items')::text AS billing_invoice_items,
               to_regclass('public.billing_payments')::text AS billing_payments
    `;
    const info = Array.isArray(reg) ? reg[0] : null;
    const ok = Boolean(info && info.billing_invoices && info.billing_invoice_items && info.billing_payments);
    if (!ok) return false;
    return true;
}

function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0.00';
    return (Math.round(v * 100) / 100).toFixed(2);
}

function makeManilaDateRange(dateKey) {
    const raw = String(dateKey || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const baseUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    const manilaOffsetMs = 8 * 60 * 60 * 1000;
    const start = new Date(baseUtcMidnight - manilaOffsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end, key: `${m[1]}-${m[2]}-${m[3]}` };
}

function todayManilaKey() {
    const now = new Date();
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return `${manilaNow.getUTCFullYear()}-${String(manilaNow.getUTCMonth() + 1).padStart(2, '0')}-${String(manilaNow.getUTCDate()).padStart(2, '0')}`;
}

async function fetchBillingSourceBreakdown({ start, end, hasBilling }) {
    if (!hasBilling) {
        return {
            onsite: '0.00',
            video: '0.00',
            lab: '0.00',
            radiology: '0.00',
            pharmacy: '0.00',
            manual: '0.00',
            counts: { onsite: 0, video: 0, lab: 0, radiology: 0, pharmacy: 0, manual: 0 }
        };
    }
    const rows = await prisma.$queryRaw`
        SELECT
            CASE
                WHEN lower(coalesce(i.notes, '')) LIKE '%pharmacy pos%' THEN 'Pharmacy POS'
                WHEN lower(coalesce(i.notes, '')) LIKE '%video consultation%' THEN 'Video Consultation'
                WHEN i.appointment_id IS NOT NULL OR lower(coalesce(i.notes, '')) LIKE '%onsite%' OR lower(coalesce(i.notes, '')) LIKE '%approvalrequest%' THEN 'Onsite Consultation'
                WHEN lower(coalesce(i.notes, '')) LIKE '%lab%' THEN 'Lab'
                WHEN lower(coalesce(i.notes, '')) LIKE '%radiology%' THEN 'Radiology'
                ELSE 'Manual Invoice'
            END AS source,
            COALESCE(SUM(p.amount), 0) AS total_amount,
            COUNT(*)::int AS tx_count
        FROM public.billing_payments p
        JOIN public.billing_invoices i ON i.id = p.invoice_id
        WHERE p.created_at >= ${start} AND p.created_at <= ${end}
        GROUP BY 1
    `.catch(() => []);

    const totals = { onsite: 0, video: 0, lab: 0, radiology: 0, pharmacy: 0, manual: 0 };
    const counts = { onsite: 0, video: 0, lab: 0, radiology: 0, pharmacy: 0, manual: 0 };
    for (const row of (Array.isArray(rows) ? rows : [])) {
        const source = String(row?.source || '');
        const total = Number(row?.total_amount || 0);
        const count = Number(row?.tx_count || 0);
        if (source === 'Onsite Consultation') {
            totals.onsite += total; counts.onsite += count;
        } else if (source === 'Video Consultation') {
            totals.video += total; counts.video += count;
        } else if (source === 'Lab') {
            totals.lab += total; counts.lab += count;
        } else if (source === 'Radiology') {
            totals.radiology += total; counts.radiology += count;
        } else if (source === 'Pharmacy POS') {
            totals.pharmacy += total; counts.pharmacy += count;
        } else {
            totals.manual += total; counts.manual += count;
        }
    }
    return {
        onsite: money(totals.onsite),
        video: money(totals.video),
        lab: money(totals.lab),
        radiology: money(totals.radiology),
        pharmacy: money(totals.pharmacy),
        manual: money(totals.manual),
        counts
    };
}

function parseMonthKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    return { year, month, key: `${m[1]}-${m[2]}` };
}

function monthBounds({ year, month }) {
    const start = new Date(year, month - 1, 1);
    start.setHours(0, 0, 0, 0);
    const next = new Date(year, month, 1);
    next.setHours(0, 0, 0, 0);
    return { start, next };
}

function normalizeSymptomToken(v) {
    return String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function mapSymptom(token) {
    const t = normalizeSymptomToken(token);
    if (!t) return null;
    const pairs = [
        { keys: ['cough', 'coughing', 'ubo'], label: 'Cough' },
        { keys: ['colds', 'cold', 'runny nose', 'sipon', 'nasal congestion', 'congestion'], label: 'Colds' },
        { keys: ['fever', 'lagnat', 'high temperature'], label: 'Fever' },
        { keys: ['sore throat', 'masakit lalamunan', 'throat pain'], label: 'Sore throat' },
        { keys: ['headache', 'sakit ng ulo', 'migraine'], label: 'Headache' },
        { keys: ['body ache', 'body aches', 'myalgia', 'sakit ng katawan'], label: 'Body ache' },
        { keys: ['diarrhea', 'loose stool', 'loose stools', 'tae', 'pagtatae'], label: 'Diarrhea' },
        { keys: ['vomiting', 'nausea', 'suka', 'pagduduwal'], label: 'Nausea/Vomiting' },
        { keys: ['abdominal pain', 'stomach ache', 'sakit ng tiyan', 'stomach pain'], label: 'Abdominal pain' },
        { keys: ['shortness of breath', 'hirap huminga', 'difficulty breathing'], label: 'Shortness of breath' },
        { keys: ['chest pain', 'pananakit ng dibdib'], label: 'Chest pain' },
        { keys: ['dizziness', 'nahihilo', 'vertigo'], label: 'Dizziness' },
        { keys: ['rash', 'skin rash', 'pantal'], label: 'Rash' }
    ];
    for (const p of pairs) {
        if (p.keys.some((k) => t === k || t.includes(k))) {
            return { key: p.label.toLowerCase(), label: p.label, canonical: true };
        }
    }
    const capped = t.length > 60 ? t.slice(0, 60) : t;
    const label = capped.replace(/\b\w/g, (m) => m.toUpperCase());
    return { key: label.toLowerCase(), label, canonical: false };
}

function recommendationSections(symptomLabel) {
    const k = String(symptomLabel || '').trim().toLowerCase();
    if (k === 'cough' || k === 'colds' || k === 'sore throat') {
        return [
            { title: 'Prevention', tips: ['Wash hands regularly and avoid touching your face.', 'Wear a mask in crowded indoor areas and improve ventilation.'] },
            { title: 'Self-care', tips: ['Stay hydrated and rest; avoid smoking and second-hand smoke.'] },
            { title: 'When to seek care', tips: ['Consult a doctor if symptoms worsen, last longer than a week, or you have difficulty breathing.'] }
        ];
    }
    if (k === 'fever') {
        return [
            { title: 'Self-care', tips: ['Rest and drink plenty of fluids.', 'Monitor temperature and avoid self-medicating with antibiotics.'] },
            { title: 'When to seek care', tips: ['Seek care if fever is high, persistent, or with alarming symptoms.'] }
        ];
    }
    if (k === 'diarrhea' || k === 'nausea/vomiting' || k === 'abdominal pain') {
        return [
            { title: 'Self-care', tips: ['Stay hydrated; use oral rehydration solutions if needed.'] },
            { title: 'Prevention', tips: ['Practice food safety and hand hygiene.', 'Avoid risky foods and ensure clean drinking water.'] },
            { title: 'When to seek care', tips: ['Seek care for dehydration, blood in stool, or severe/persistent pain.'] }
        ];
    }
    if (k === 'shortness of breath' || k === 'chest pain') {
        return [
            { title: 'Urgent', tips: ['Seek urgent medical care if symptoms are severe or sudden.'] },
            { title: 'Self-care', tips: ['Avoid triggers (smoke, dust) and rest in a comfortable position.', 'Follow prescribed inhalers/medications if you have a known condition.'] }
        ];
    }
    if (k === 'headache' || k === 'dizziness' || k === 'body ache') {
        return [
            { title: 'Self-care', tips: ['Rest, hydrate, and maintain regular sleep.', 'Reduce screen strain and manage stress.'] },
            { title: 'When to seek care', tips: ['Seek care if severe, sudden, or with neurological symptoms.'] }
        ];
    }
    if (k === 'rash') {
        return [
            { title: 'Self-care', tips: ['Avoid new potential irritants and keep the skin clean and dry.', 'Do not scratch; use gentle moisturizers if needed.'] },
            { title: 'When to seek care', tips: ['Seek care if rash spreads quickly, with fever, or swelling.'] }
        ];
    }
    return [
        { title: 'General', tips: ['Practice good hygiene and maintain healthy sleep and hydration.', 'Avoid close contact with sick individuals when possible.'] },
        { title: 'When to seek care', tips: ['Consult a doctor if symptoms are persistent or worsening.'] }
    ];
}

function buildAiText({ monthKey, topSymptoms, completenessPct, totalAppointments }) {
    const monthLabel = monthKey;
    const names = topSymptoms.slice(0, 3).map((s) => s.symptom);
    const list = names.length ? names.join(', ') : 'no dominant symptom';
    const parts = [
        `For ${monthLabel}, there were ${Number(totalAppointments || 0)} appointments.`,
        `The most commonly reported symptoms were ${list}.`,
        `Data completeness is ${completenessPct}%.`
    ];
    const recommendations = topSymptoms.slice(0, 5).map((s) => {
        const sections = recommendationSections(s.symptom);
        const flatTips = sections.flatMap((sec) => Array.isArray(sec?.tips) ? sec.tips : []);
        return { symptom: s.symptom, sections, tips: flatTips };
    });
    return { summary: parts.join(' '), recommendations };
}

// Get Dashboard Overview Stats
router.get('/overview', requireRole(['admin', 'nurse', 'doctor', 'pharmacist', 'staff', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']), async (_req, res) => {
    try {
        const totalPatients = await prisma.patients.count();
        const inpatients = await prisma.patients.count({ where: { admission_status: 'Inpatient' } });
        const nurseAccounts = await prisma.nurses.count();

        console.log('Stats Overview:', { totalPatients, inpatients, nurseAccounts });

        res.json({
            patients: totalPatients,
            inpatients: inpatients,
            accounts: nurseAccounts
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

router.get('/admin-overview', requireRole(['admin']), async (_req, res) => {
    try {
        const now = Date.now();
        if (adminOverviewCache.payload && now - adminOverviewCache.fetchedAt < ADMIN_OVERVIEW_CACHE_MS) {
            return res.json(adminOverviewCache.payload);
        }
        if (adminOverviewCache.promise) {
            const payload = await adminOverviewCache.promise;
            return res.json(payload);
        }

        adminOverviewCache.promise = (async () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const [
            employeesRegistered,
            doctorsRegistered,
            nursesRegistered,
            pharmacistsRegistered,
            employeesOnline,
            doctorsOnline,
            nursesOnline,
            pharmacistsOnline,
            totalPatients,
            inpatients,
            pendingRequests,
            newPatientsToday,
            waitingAppointmentsToday,
            totalAppointmentsToday
        ] = await Promise.all([
            safeCount(() => prisma.staff.count({ where: { account_type: { in: ['staff', 'admin'] } } })),
            safeCount(() => prisma.doctors.count()),
            safeCount(() => prisma.nurses.count()),
            safeCount(() => prisma.staff.count({ where: { account_type: 'pharmacist' } })),
            safeCount(() => prisma.staff.count({ where: { account_type: { in: ['staff', 'admin'] }, status: 'Online' } })),
            safeCount(() => prisma.doctors.count({ where: { status: 'Online' } })),
            safeCount(() => prisma.nurses.count({ where: { status: 'Online' } })),
            safeCount(() => prisma.staff.count({ where: { account_type: 'pharmacist', status: 'Online' } })),
            safeCount(() => prisma.patients.count()),
            safeCount(() => prisma.patients.count({ where: { admission_status: 'Inpatient' } })),
            safeCount(() => prisma.requests.count({ where: { status: 'Pending' } })),
            safeCount(() => prisma.patients.count({ where: { created_at: { gte: start, lte: end } } })),
            safeCount(() => prisma.appointments.count({ where: { appointment_date: { gte: start, lte: end }, status: 'Waiting' } })),
            safeCount(() => prisma.appointments.count({ where: { appointment_date: { gte: start, lte: end } } }))
        ]);

        const [lowStockMedsRow, lowStockSuppliesRow] = await Promise.all([
            safeRaw(() => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM medicines WHERE COALESCE(stock, 0) <= COALESCE(min_level, 0)`, [{ count: 0 }]),
            safeRaw(() => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM supplies WHERE COALESCE(stock, 0) <= COALESCE(min_level, 0)`, [{ count: 0 }])
        ]);

        const lowStockMeds = Array.isArray(lowStockMedsRow) ? Number(lowStockMedsRow[0]?.count || 0) : Number(lowStockMedsRow?.count || 0);
        const lowStockSupplies = Array.isArray(lowStockSuppliesRow) ? Number(lowStockSuppliesRow[0]?.count || 0) : Number(lowStockSuppliesRow?.count || 0);

        const payload = {
            registered: {
                employees: employeesRegistered,
                doctors: doctorsRegistered,
                nurses: nursesRegistered,
                pharmacists: pharmacistsRegistered
            },
            online: {
                employees: employeesOnline,
                doctors: doctorsOnline,
                nurses: nursesOnline,
                pharmacists: pharmacistsOnline
            },
            patients: {
                total: totalPatients,
                inpatients: inpatients,
                newToday: newPatientsToday
            },
            requests: {
                pending: pendingRequests
            },
            appointments: {
                waitingToday: waitingAppointmentsToday,
                totalToday: totalAppointmentsToday
            },
            inventory: {
                lowStockMeds,
                lowStockSupplies
            }
        };
        adminOverviewCache.fetchedAt = Date.now();
        adminOverviewCache.payload = payload;
        return payload;
        })().finally(() => {
            adminOverviewCache.promise = null;
        });

        const payload = await adminOverviewCache.promise;
        return res.json(payload);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

router.get('/admin-sales-monitoring', requireRole(['admin']), async (req, res) => {
    try {
        const dateRaw = String(req.query.date || '').trim();
        const range = makeManilaDateRange(dateRaw || todayManilaKey());
        if (!range) return res.status(400).json({ message: 'Invalid date' });
        const { start, end, key } = range;

        const hasBilling = await ensureBillingTablesExist();
        const adjReg = hasBilling
            ? await prisma.$queryRaw`SELECT to_regclass('public.billing_adjustments')::text AS billing_adjustments`.catch(() => [])
            : [];
        const adjInfo = Array.isArray(adjReg) ? adjReg[0] : null;
        const hasAdjustments = Boolean(adjInfo && adjInfo.billing_adjustments);
        const [
            billingPaidRow,
            billingRefundRow,
            invoiceStatusRows,
            billingBySource,
            pharmacyNetRow,
            pharmacyTxRow,
            submittedReportsRow
        ] = await Promise.all([
            hasBilling
                ? prisma.$queryRaw`
                    SELECT COALESCE(SUM(amount), 0) AS total_paid, COUNT(*)::int AS payments_count
                    FROM public.billing_payments
                    WHERE created_at >= ${start} AND created_at <= ${end}
                  `
                : Promise.resolve([{ total_paid: 0, payments_count: 0 }]),
            hasBilling && hasAdjustments
                ? prisma.$queryRaw`
                    SELECT COALESCE(SUM(amount), 0) AS total_refunded
                    FROM public.billing_adjustments
                    WHERE lower(type) = 'refund'
                      AND created_at >= ${start} AND created_at <= ${end}
                  `
                : Promise.resolve([{ total_refunded: 0 }]),
            hasBilling
                ? prisma.$queryRaw`
                    SELECT COALESCE(status, 'Draft') AS status, COUNT(*)::int AS count
                    FROM public.billing_invoices
                    WHERE created_at >= ${start} AND created_at <= ${end}
                    GROUP BY COALESCE(status, 'Draft')
                  `
                : Promise.resolve([]),
            fetchBillingSourceBreakdown({ start, end, hasBilling }),
            prisma.$queryRaw`
                SELECT COALESCE(SUM(total_amount), 0) AS net_sales
                FROM public.sales
                WHERE created_at >= ${start} AND created_at <= ${end}
            `.catch(() => [{ net_sales: 0 }]),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS tx_count
                FROM public.sales
                WHERE created_at >= ${start} AND created_at <= ${end}
            `.catch(() => [{ tx_count: 0 }]),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS count
                FROM public.activity_logs
                WHERE target = 'SalesReport'
                  AND timestamp >= ${start} AND timestamp <= ${end}
            `.catch(() => [{ count: 0 }])
        ]);

        const paid = Array.isArray(billingPaidRow) ? billingPaidRow[0] : billingPaidRow;
        const totalPaid = Number(paid?.total_paid || 0);
        const paymentsCount = Number(paid?.payments_count || 0);
        const refundedRow = Array.isArray(billingRefundRow) ? billingRefundRow[0] : billingRefundRow;
        const totalRefunded = Number(refundedRow?.total_refunded || 0);
        const invoicesByStatus = (Array.isArray(invoiceStatusRows) ? invoiceStatusRows : []).reduce((acc, r) => {
            const k = String(r.status || 'Draft');
            acc[k] = Number(r.count || 0);
            return acc;
        }, {});

        const pharmacyNet = Array.isArray(pharmacyNetRow) ? pharmacyNetRow[0] : pharmacyNetRow;
        const pharmacyTx = Array.isArray(pharmacyTxRow) ? pharmacyTxRow[0] : pharmacyTxRow;
        const reports = Array.isArray(submittedReportsRow) ? submittedReportsRow[0] : submittedReportsRow;

        res.json({
            date: key,
            billing: hasBilling
                ? {
                    total_collected: money(totalPaid - totalRefunded),
                    payments_count: paymentsCount,
                    invoices_by_status: invoicesByStatus,
                    total_refunded: money(totalRefunded),
                    by_source: billingBySource
                }
                : {
                    total_collected: '0.00',
                    payments_count: 0,
                    invoices_by_status: {},
                    by_source: billingBySource,
                    warning: 'Billing tables not installed'
                },
            pharmacy_pos: {
                net_sales: money(Number(pharmacyNet?.net_sales || 0)),
                transactions: Number(pharmacyTx?.tx_count || 0)
            },
            sales_reports_submitted: Number(reports?.count || 0)
        });
    } catch (err) {
        console.error('stats GET /admin-sales-monitoring failed:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/cashier-closeout', requireRole(['admin', 'cashier', 'doctor_secretary', 'staff']), async (req, res) => {
    try {
        const dateRaw = String(req.query.date || '').trim();
        const fallbackKey = todayManilaKey();
        const range = makeManilaDateRange(dateRaw || fallbackKey);
        if (!range) return res.status(400).json({ message: 'Invalid date' });
        const { start, end } = range;

        const hasBilling = await ensureBillingTablesExist();
        const adjReg = hasBilling
            ? await prisma.$queryRaw`SELECT to_regclass('public.billing_adjustments')::text AS billing_adjustments`.catch(() => [])
            : [];
        const adjInfo = Array.isArray(adjReg) ? adjReg[0] : null;
        const hasAdjustments = Boolean(adjInfo && adjInfo.billing_adjustments);
        const [
            billingPaidRow,
            billingRefundRow,
            invoiceStatusRows,
            billingBySource,
            pharmacyNetRow,
            pharmacyTxRow,
            submittedReportsRow
        ] = await Promise.all([
            hasBilling
                ? prisma.$queryRaw`
                    SELECT COALESCE(SUM(amount), 0) AS total_paid, COUNT(*)::int AS payments_count
                    FROM public.billing_payments
                    WHERE created_at >= ${start} AND created_at <= ${end}
                  `
                : Promise.resolve([{ total_paid: 0, payments_count: 0 }]),
            hasBilling && hasAdjustments
                ? prisma.$queryRaw`
                    SELECT COALESCE(SUM(amount), 0) AS total_refunded
                    FROM public.billing_adjustments
                    WHERE lower(type) = 'refund'
                      AND created_at >= ${start} AND created_at <= ${end}
                  `
                : Promise.resolve([{ total_refunded: 0 }]),
            hasBilling
                ? prisma.$queryRaw`
                    SELECT COALESCE(status, 'Draft') AS status, COUNT(*)::int AS count
                    FROM public.billing_invoices
                    WHERE created_at >= ${start} AND created_at <= ${end}
                    GROUP BY COALESCE(status, 'Draft')
                  `
                : Promise.resolve([]),
            fetchBillingSourceBreakdown({ start, end, hasBilling }),
            prisma.$queryRaw`
                SELECT COALESCE(SUM(total_amount), 0) AS net_sales
                FROM public.sales
                WHERE created_at >= ${start} AND created_at <= ${end}
            `.catch(() => [{ net_sales: 0 }]),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS tx_count
                FROM public.sales
                WHERE created_at >= ${start} AND created_at <= ${end}
            `.catch(() => [{ tx_count: 0 }]),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS count
                FROM public.activity_logs
                WHERE target = 'SalesReport'
                  AND timestamp >= ${start} AND timestamp <= ${end}
            `.catch(() => [{ count: 0 }])
        ]);

        const paid = Array.isArray(billingPaidRow) ? billingPaidRow[0] : billingPaidRow;
        const totalPaid = Number(paid?.total_paid || 0);
        const paymentsCount = Number(paid?.payments_count || 0);
        const refundedRow = Array.isArray(billingRefundRow) ? billingRefundRow[0] : billingRefundRow;
        const totalRefunded = Number(refundedRow?.total_refunded || 0);
        const invoicesByStatus = (Array.isArray(invoiceStatusRows) ? invoiceStatusRows : []).reduce((acc, r) => {
            const k = String(r.status || 'Draft');
            acc[k] = Number(r.count || 0);
            return acc;
        }, {});

        const pharmacyNet = Array.isArray(pharmacyNetRow) ? pharmacyNetRow[0] : pharmacyNetRow;
        const pharmacyTx = Array.isArray(pharmacyTxRow) ? pharmacyTxRow[0] : pharmacyTxRow;
        const reports = Array.isArray(submittedReportsRow) ? submittedReportsRow[0] : submittedReportsRow;

        res.json({
            date: dateRaw || fallbackKey,
            billing: hasBilling
                ? {
                    total_collected: money(totalPaid - totalRefunded),
                    payments_count: paymentsCount,
                    invoices_by_status: invoicesByStatus,
                    total_refunded: money(totalRefunded),
                    by_source: billingBySource
                }
                : {
                    total_collected: '0.00',
                    payments_count: 0,
                    invoices_by_status: {},
                    by_source: billingBySource,
                    warning: 'Billing tables not installed'
                },
            pharmacy_pos: {
                net_sales: money(Number(pharmacyNet?.net_sales || 0)),
                transactions: Number(pharmacyTx?.tx_count || 0)
            },
            sales_reports_submitted: Number(reports?.count || 0)
        });
    } catch (err) {
        console.error('stats GET /cashier-closeout failed:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/symptom-insights', requireRole(['admin']), async (req, res) => {
    try {
        await ensureSymptomInsightsSchema();
        const now = new Date();
        const monthKeyInput = parseMonthKey(req.query.month) || { year: now.getFullYear(), month: now.getMonth() + 1, key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` };
        const refresh = String(req.query.refresh || '').trim().toLowerCase() === 'true';
        const { start, next } = monthBounds(monthKeyInput);
        const startKey = start.toISOString().slice(0, 10);
        const nextKey = next.toISOString().slice(0, 10);

        if (!refresh) {
            const cached = await prisma.$queryRaw(
                Prisma.sql`SELECT payload, generated_at FROM admin_symptom_insights WHERE month_key = ${monthKeyInput.key}::text LIMIT 1`
            ).catch(() => []);
            const row = Array.isArray(cached) ? cached[0] : null;
            if (row?.payload) {
                return res.json({ ...row.payload, generatedAt: row.generated_at });
            }
        }

        const totalsRows = await prisma.$queryRaw(
            Prisma.sql`
                SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE symptoms IS NOT NULL AND array_length(symptoms, 1) > 0)::int AS with_symptoms
                FROM public.appointments
                WHERE appointment_date >= ${startKey}::date
                  AND appointment_date < ${nextKey}::date
            `
        ).catch(() => []);
        const totals = Array.isArray(totalsRows) ? totalsRows[0] : null;
        const totalAppointments = Number(totals?.total || 0) || 0;
        const appointmentsWithSymptoms = Number(totals?.with_symptoms || 0) || 0;
        const completenessPct = totalAppointments > 0 ? Math.round((appointmentsWithSymptoms / totalAppointments) * 100) : 0;

        const rows = await prisma.$queryRaw(
            Prisma.sql`
                WITH base AS (
                    SELECT id, symptoms
                    FROM public.appointments
                    WHERE appointment_date >= ${startKey}::date
                      AND appointment_date < ${nextKey}::date
                ),
                expanded AS (
                    SELECT DISTINCT b.id, lower(trim(s)) AS symptom
                    FROM base b
                    CROSS JOIN LATERAL unnest(coalesce(b.symptoms, ARRAY[]::text[])) AS s
                    WHERE trim(coalesce(s, '')) <> ''
                )
                SELECT symptom, COUNT(*)::int AS count
                FROM expanded
                GROUP BY symptom
                ORDER BY COUNT(*) DESC, symptom ASC
                LIMIT 60
            `
        ).catch(() => []);

        const prev = (() => {
            const y = monthKeyInput.month === 1 ? monthKeyInput.year - 1 : monthKeyInput.year;
            const m = monthKeyInput.month === 1 ? 12 : monthKeyInput.month - 1;
            return { year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` };
        })();
        const prevBounds = monthBounds(prev);
        const prevStartKey = prevBounds.start.toISOString().slice(0, 10);
        const prevNextKey = prevBounds.next.toISOString().slice(0, 10);

        const prevRows = await prisma.$queryRaw(
            Prisma.sql`
                WITH base AS (
                    SELECT id, symptoms
                    FROM public.appointments
                    WHERE appointment_date >= ${prevStartKey}::date
                      AND appointment_date < ${prevNextKey}::date
                ),
                expanded AS (
                    SELECT DISTINCT b.id, lower(trim(s)) AS symptom
                    FROM base b
                    CROSS JOIN LATERAL unnest(coalesce(b.symptoms, ARRAY[]::text[])) AS s
                    WHERE trim(coalesce(s, '')) <> ''
                )
                SELECT symptom, COUNT(*)::int AS count
                FROM expanded
                GROUP BY symptom
            `
        ).catch(() => []);

        const prevRawMap = new Map();
        (Array.isArray(prevRows) ? prevRows : []).forEach((r) => {
            const k = normalizeSymptomToken(r?.symptom);
            if (!k) return;
            prevRawMap.set(k, Number(r?.count || 0) || 0);
        });

        const prevMap = new Map();
        prevRawMap.forEach((count, rawKey) => {
            const mapped = mapSymptom(rawKey);
            if (!mapped) return;
            prevMap.set(mapped.key, (prevMap.get(mapped.key) || 0) + count);
        });

        const map = new Map();
        (Array.isArray(rows) ? rows : []).forEach((r) => {
            const mapped = mapSymptom(r?.symptom);
            if (!mapped) return;
            const count = Number(r?.count || 0) || 0;
            if (!map.has(mapped.key)) map.set(mapped.key, { symptom: mapped.label, count: 0 });
            map.get(mapped.key).count += count;
        });

        const fallbackUsed = totalAppointments > 0 && appointmentsWithSymptoms / totalAppointments < 0.7;
        if (fallbackUsed) {
            const missing = await prisma.$queryRaw(
                Prisma.sql`
                    SELECT id, reason, main_concern, description
                    FROM public.appointments
                    WHERE appointment_date >= ${startKey}::date
                      AND appointment_date < ${nextKey}::date
                      AND (symptoms IS NULL OR array_length(symptoms, 1) = 0)
                `
            ).catch(() => []);

            const keywordMap = [
                { keys: ['shortness of breath', 'difficulty breathing', 'hirap huminga'], label: 'Shortness of breath' },
                { keys: ['chest pain', 'pananakit ng dibdib', 'dibdib'], label: 'Chest pain' },
                { keys: ['cough', 'ubo'], label: 'Cough' },
                { keys: ['cold', 'colds', 'sipon', 'runny'], label: 'Colds' },
                { keys: ['fever', 'lagnat'], label: 'Fever' },
                { keys: ['headache', 'sakit ng ulo'], label: 'Headache' },
                { keys: ['body ache', 'body aches', 'sakit ng katawan'], label: 'Body ache' },
                { keys: ['dizzy', 'dizziness', 'nahihilo'], label: 'Dizziness' },
                { keys: ['diarrhea', 'pagtatae'], label: 'Diarrhea' },
                { keys: ['vomit', 'nausea', 'suka'], label: 'Nausea/Vomiting' },
                { keys: ['abdominal', 'stomach', 'tiyan'], label: 'Abdominal pain' },
                { keys: ['rash', 'pantal'], label: 'Rash' }
            ];

            const hit = (text) => {
                const t = normalizeSymptomToken(text);
                if (!t) return [];
                const out = [];
                for (const entry of keywordMap) {
                    if (entry.keys.some((k) => t.includes(k))) out.push(entry.label);
                }
                return [...new Set(out)];
            };

            (Array.isArray(missing) ? missing : []).forEach((m) => {
                const tokens = [...new Set([...hit(m.reason), ...hit(m.main_concern), ...hit(m.description)])];
                tokens.forEach((label) => {
                    const k = label.toLowerCase();
                    if (!map.has(k)) map.set(k, { symptom: label, count: 0 });
                    map.get(k).count += 1;
                });
            });
        }

        const topSymptoms = Array.from(map.values())
            .sort((a, b) => b.count - a.count || a.symptom.localeCompare(b.symptom))
            .slice(0, 5)
            .map((s) => {
                const key = String(s.symptom || '').trim().toLowerCase();
                const prevCount = prevMap.get(key) || 0;
                const delta = s.count - prevCount;
                const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
                return { symptom: s.symptom, count: s.count, delta, trend };
            });

        const ai = buildAiText({ monthKey: monthKeyInput.key, topSymptoms, completenessPct, totalAppointments });
        const highlights = topSymptoms
            .slice(0, 3)
            .map((s) => {
                const delta = Number(s.delta || 0) || 0;
                const t = String(s.trend || 'flat').toLowerCase();
                const arrow = t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
                const diff = t === 'up' ? `+${delta}` : `${delta}`;
                return `${s.symptom} ${arrow} ${diff} vs last month`;
            });
        const payload = {
            month: monthKeyInput.key,
            analysisWindow: { start: startKey, endExclusive: nextKey },
            totalAppointments,
            appointmentsWithSymptoms,
            completenessPct,
            topSymptoms,
            aiSummary: ai.summary,
            recommendations: ai.recommendations,
            fallbackUsed,
            highlights,
            dataQualityNote: fallbackUsed
                ? 'Some symptoms were inferred from main concern/description because the symptoms field was incomplete.'
                : 'Insights are based on recorded symptoms.'
        };

        const jsonb = JSON.stringify(payload);
        await prisma.$queryRaw(
            Prisma.sql`
                INSERT INTO admin_symptom_insights (month_key, payload, algorithm_version, generated_at)
                VALUES (${monthKeyInput.key}::text, ${jsonb}::jsonb, 'v2.1', now())
                ON CONFLICT (month_key) DO UPDATE
                SET payload = EXCLUDED.payload,
                    algorithm_version = EXCLUDED.algorithm_version,
                    generated_at = now()
            `
        ).catch(() => {});

        res.json({ ...payload, generatedAt: new Date().toISOString() });
    } catch (err) {
        console.error('[stats /symptom-insights] error:', err);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
});

module.exports = router;

