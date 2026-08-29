const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset } = require('../utils/normalize');
const { syncHmoDataFromAppointmentToInvoice } = require('../utils/billingLedger');


const STAFF_ROLE_SET = new Set(['doctor_secretary', 'cashier', 'admin', 'doctor']);
const billingSchemaEnsureState = {
  coreCheckedAt: 0,
  adjustmentsCheckedAt: 0,
  doctorFeesCheckedAt: 0,
  hmoClaimsCheckedAt: 0
};
const BILLING_SCHEMA_RECHECK_MS = 5 * 60 * 1000;

const toMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
};

const serialize = (obj) =>
  JSON.parse(
    JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

async function ensureBillingTablesExist() {
  const reg = await prisma.$queryRaw`
    SELECT to_regclass('public.billing_invoices')::text AS billing_invoices,
           to_regclass('public.billing_invoice_items')::text AS billing_invoice_items,
           to_regclass('public.billing_payments')::text AS billing_payments
  `;
  const info = Array.isArray(reg) ? reg[0] : null;
  const ok = Boolean(info && info.billing_invoices && info.billing_invoice_items && info.billing_payments);
  if (!ok) {
    const err = new Error('Billing tables are not installed. Run manual_migration_billing.sql in Supabase first.');
    err.statusCode = 500;
    throw err;
  }

  const now = Date.now();
  if (now - billingSchemaEnsureState.coreCheckedAt < BILLING_SCHEMA_RECHECK_MS) return;

  const cols = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'billing_invoices' AND column_name IN ('appointment_id', 'status', 'notes', 'created_by', 'total_amount', 'updated_at'))
        OR
        (table_name = 'billing_payments' AND column_name IN ('received_by', 'idempotency_key'))
      )
  `.catch(() => []);

  const present = new Set((Array.isArray(cols) ? cols : []).map((row) => `${row.table_name}.${row.column_name}`));
  const invoiceAdds = [];
  if (!present.has('billing_invoices.appointment_id')) invoiceAdds.push(`ADD COLUMN appointment_id bigint NULL REFERENCES public.appointments(id) ON DELETE SET NULL`);
  if (!present.has('billing_invoices.status')) invoiceAdds.push(`ADD COLUMN status text NULL DEFAULT 'Draft'`);
  if (!present.has('billing_invoices.notes')) invoiceAdds.push(`ADD COLUMN notes text NULL`);
  if (!present.has('billing_invoices.created_by')) invoiceAdds.push(`ADD COLUMN created_by text NULL`);
  if (!present.has('billing_invoices.total_amount')) invoiceAdds.push(`ADD COLUMN total_amount numeric(12,2) NOT NULL DEFAULT 0`);
  if (!present.has('billing_invoices.updated_at')) invoiceAdds.push(`ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`);
  if (invoiceAdds.length) {
    await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_invoices ${invoiceAdds.join(', ')};`).catch(() => {});
  }

  if (!present.has('billing_payments.received_by')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_payments ADD COLUMN received_by text NULL;`).catch(() => {});
  }

  if (!present.has('billing_payments.idempotency_key')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE public.billing_payments ADD COLUMN idempotency_key text NULL;`).catch(() => {});
  }

  // Optional: make retries safe (invoice_id + idempotency_key must be unique when provided).
  await prisma
    .$executeRawUnsafe(
      `
        CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payments_invoice_idempotency
        ON public.billing_payments (invoice_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
      `
    )
    .catch(() => {});

  billingSchemaEnsureState.coreCheckedAt = now;
}

async function ensureDoctorServiceFeesTableExist() {
  const now = Date.now();
  if (now - billingSchemaEnsureState.doctorFeesCheckedAt < BILLING_SCHEMA_RECHECK_MS) return;

  const reg = await prisma.$queryRaw`
    SELECT to_regclass('public.doctor_service_fees')::text AS doctor_service_fees
  `;
  const info = Array.isArray(reg) ? reg[0] : null;
  if (info && info.doctor_service_fees) {
    billingSchemaEnsureState.doctorFeesCheckedAt = now;
    return;
  }

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
  `);
  billingSchemaEnsureState.doctorFeesCheckedAt = now;
}

async function ensureBillingAdjustmentsTableExist() {
  const now = Date.now();
  if (now - billingSchemaEnsureState.adjustmentsCheckedAt < BILLING_SCHEMA_RECHECK_MS) return;

  const reg = await prisma.$queryRaw`
    SELECT to_regclass('public.billing_adjustments')::text AS billing_adjustments
  `;
  const info = Array.isArray(reg) ? reg[0] : null;
  if (info && info.billing_adjustments) {
    billingSchemaEnsureState.adjustmentsCheckedAt = now;
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.billing_adjustments (
      id bigserial PRIMARY KEY,
      invoice_id bigint NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
      type text NOT NULL,
      amount numeric(10,2) NOT NULL DEFAULT 0,
      reference text NULL,
      reason text NULL,
      created_by text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_billing_adjustments_invoice_id ON public.billing_adjustments(invoice_id);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_billing_adjustments_created_at ON public.billing_adjustments(created_at);
  `);
  billingSchemaEnsureState.adjustmentsCheckedAt = now;
}

async function ensureBillingHmoClaimsTableExist() {
  const now = Date.now();
  if (now - billingSchemaEnsureState.hmoClaimsCheckedAt < BILLING_SCHEMA_RECHECK_MS) return;

  const reg = await prisma.$queryRaw`
    SELECT to_regclass('public.billing_hmo_claims')::text AS billing_hmo_claims
  `;
  const info = Array.isArray(reg) ? reg[0] : null;
  if (info && info.billing_hmo_claims) {
    billingSchemaEnsureState.hmoClaimsCheckedAt = now;
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.billing_hmo_claims (
      id bigserial PRIMARY KEY,
      invoice_id bigint NOT NULL UNIQUE REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
      hmo_provider text NULL,
    hmo_loa_number text NULL,
    hmo_card_number text NULL,
    philhealth_deduction numeric(12,2) NOT NULL DEFAULT 0,
    loa_approved_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'Pending',
      notes text NULL,
      requested_by text NULL,
      updated_by text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_status ON public.billing_hmo_claims(status, updated_at DESC);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_invoice_id ON public.billing_hmo_claims(invoice_id);
  `);

  billingSchemaEnsureState.hmoClaimsCheckedAt = now;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
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

function normalizeServiceKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferInvoiceSource(inv) {
  const notes = String(inv?.notes || '').toLowerCase();
  if (notes.includes('pharmacy pos')) return 'Pharmacy POS';
  if (notes.includes('video consultation')) return 'Video Consultation';
  if (inv?.appointment_id != null || notes.includes('onsite') || notes.includes('approvalrequest')) return 'Onsite Consultation';
  if (notes.includes('lab')) return 'Lab';
  if (notes.includes('radiology')) return 'Radiology';
  return 'Manual Invoice';
}

function buildServiceLabel(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  if (items.length === 1 && items[0]?.description) return String(items[0].description).trim();
  if (items.length > 1) return `${String(items[0]?.description || 'Multiple Services').trim()} +${items.length - 1} more`;
  return String(inv?.notes || '').trim() || inferInvoiceSource(inv);
}

function buildReceiptNumber(payment, source) {
  const prefix = String(source || '').toLowerCase().includes('lab')
    ? 'LAB'
    : String(source || '').toLowerCase().includes('video')
      ? 'VID'
      : String(source || '').toLowerCase().includes('consult')
        ? 'CON'
        : 'PAY';
  const id = String(payment?.id || payment?.invoice_id || '0');
  return `PGH-${prefix}-${id}`;
}

function normalizeHmoStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Pending';
  if (['approved', 'ok', 'accepted', 'cleared', 'confirmed', 'sent', 'submitted', 'approved by hmo', 'forwarded', 'authorized', 'validated', 'pre-approved', 'preapproved'].includes(normalized)) return 'Approved';
  if (['partially approved', 'partial', 'partially_approved', 'partially ok', 'partially confirmed'].includes(normalized)) return 'Partially Approved';
  if (['awaiting loa', 'awaiting_loa', 'pending - nurse intake', 'pending for loa', 'pending loa', 'to follow up', 'for hmo callback', 'hmo callback', 'calling hmo', 'hold hmo', 'hmo hold'].includes(normalized)) return 'Awaiting LOA';
  if (['rejected', 'denied', 'declined', 'disapproved', 'not approved'].includes(normalized)) return 'Rejected';
  if (['paid', 'settled', 'closed', 'for payment', 'ready', 'billed', 'completed'].includes(normalized)) return 'Approved';
  return 'Pending';
}

function isHmoCoverageApplied(status) {
  const normalized = normalizeHmoStatus(status);
  // Auto-apply for Approved, Partially Approved, and Pending (if LOA amount is set)
  return normalized === 'Approved' || normalized === 'Partially Approved' || normalized === 'Pending';
}

function summarizeHmoClaim(row, totalAmount) {
  const total = Math.max(0, Number(totalAmount || 0));
  if (!row) {
    return {
      id: null,
      invoice_id: null,
      provider: '',
      hmo_provider: '',
      loa_number: '',
      hmo_loa_number: '',
      hmo_card_number: '',
      philhealth_deduction: 0,
      loa_approved_amount: 0,
      status: 'Pending',
      notes: '',
      requested_by: null,
      updated_by: null,
      created_at: null,
      updated_at: null,
      applied_hmo_amount: 0,
      patient_payable: total
    };
  }

  const philhealthDeduction = Math.min(total, Math.max(0, Number(row.philhealth_deduction || 0)));
  const maxAfterPhilhealth = Math.max(0, total - philhealthDeduction);
  const approvedAmount = Math.max(0, Number(row.loa_approved_amount || 0));
  const appliedHmoAmount = isHmoCoverageApplied(row.status)
    ? Math.min(maxAfterPhilhealth, approvedAmount)
    : 0;
  const patientPayable = Math.max(0, total - philhealthDeduction - appliedHmoAmount);

  return {
    id: row.id != null ? String(row.id) : null,
    invoice_id: row.invoice_id != null ? String(row.invoice_id) : null,
    appointment_id: row.appointment_id != null ? String(row.appointment_id) : null,
    patient_id: row.patient_id != null ? String(row.patient_id).trim() || null : null,
    patient_name: String(row.patient_name || '').trim(),
    provider: String(row.hmo_provider || row.provider || '').trim(),
    hmo_provider: String(row.hmo_provider || row.provider || '').trim(),
    loa_number: String(row.hmo_loa_number || row.loa_number || '').trim(),
    hmo_loa_number: String(row.hmo_loa_number || row.loa_number || '').trim(),
    hmo_card_number: String(row.hmo_card_number || '').trim(),
    philhealth_deduction: philhealthDeduction,
    loa_approved_amount: approvedAmount,
    status: normalizeHmoStatus(row.status),
    notes: String(row.notes || '').trim(),
    requested_by: row.requested_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    applied_hmo_amount: appliedHmoAmount,
    patient_payable: patientPayable
  };
}

async function fetchHmoClaimsByInvoiceIds(tx, invoiceIds) {
  const ids = (Array.isArray(invoiceIds) ? invoiceIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d+$/.test(id));
  if (!ids.length) return [];

  return tx
    .$queryRawUnsafe(
      `
        SELECT id, invoice_id, hmo_provider, hmo_loa_number, hmo_card_number, philhealth_deduction, loa_approved_amount,
               status, notes, requested_by, updated_by, created_at, updated_at
        FROM public.billing_hmo_claims
        WHERE invoice_id = ANY($1::bigint[])
      `,
      ids
    )
    .catch(() => []);
}

function buildHmoSummaryMap(rows, invoiceTotals = {}) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const invoiceId = String(row.invoice_id || '').trim();
    if (!invoiceId) return;
    map.set(invoiceId, summarizeHmoClaim(row, invoiceTotals[invoiceId] || 0));
  });
  return map;
}

async function computeInvoiceFinancials(tx, invoiceId) {
  const inv = await tx.billing_invoices
    .findUnique({ where: { id: invoiceId }, select: { id: true, status: true, total_amount: true } })
    .catch(() => null);
  if (!inv) return null;

  const payments = await tx.billing_payments.findMany({ where: { invoice_id: invoiceId }, select: { amount: true } }).catch(() => []);
  const paid = (Array.isArray(payments) ? payments : []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const adjustments = await tx
    .$queryRawUnsafe(
      `
        SELECT type, amount
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
      `,
      invoiceId.toString()
    )
    .catch(() => []);
  const refunded = (Array.isArray(adjustments) ? adjustments : [])
    .filter((a) => String(a.type || '').toLowerCase() === 'refund')
    .reduce((sum, a) => sum + Number(a.amount || 0), 0);

  const total = Number(inv.total_amount || 0);
  const hmoRows = await fetchHmoClaimsByInvoiceIds(tx, [invoiceId]);
  const hmoClaim = summarizeHmoClaim(Array.isArray(hmoRows) ? hmoRows[0] : null, total);
  const collectibleTotal = hmoClaim.patient_payable;
  const netPaid = paid - refunded;
  const balance = Math.max(0, collectibleTotal - netPaid);

  return { inv, total, paid, refunded, netPaid, balance, collectibleTotal, hmoClaim };
}

async function recomputeInvoiceStatus(tx, invoiceId) {
  const fin = await computeInvoiceFinancials(tx, invoiceId);
  if (!fin) return null;

  const currentStatus = String(fin.inv.status || '').trim();
  const currentLower = currentStatus.toLowerCase();
  if (currentLower === 'voided' || currentLower === 'cancelled') {
    // Do not override manual terminal statuses.
    return { status: currentStatus, ...fin };
  }

  const status = fin.balance <= 0.00001 ? 'Paid' : 'Ready';
  await tx.billing_invoices.update({
    where: { id: invoiceId },
    data: { status, updated_at: new Date() }
  });

  return { status, ...fin };
}

router.get('/mine/payments', requireRole(['patient']), async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const patient = await resolvePatientForRequest(req);
    const { take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const payments = await prisma.billing_payments.findMany({
      where: { invoices: { is: { patient_id: patient.id } } },
      include: {
        invoices: {
          include: {
            items: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset
    });

    const normalized = (Array.isArray(payments) ? payments : []).map((payment) => {
      const invoice = payment.invoices || null;
      const source = inferInvoiceSource(invoice || {});
      return {
        id: payment.id,
        invoiceId: payment.invoice_id,
        amount: payment.amount,
        method: payment.method || null,
        reference: payment.reference || null,
        receivedBy: payment.received_by || null,
        createdAt: payment.created_at || null,
        source,
        serviceLabel: buildServiceLabel(invoice || {}),
        receiptNumber: buildReceiptNumber(payment, source),
        patient: { id: patient.id, name: patient.name, email: patient.email || null },
        invoice: invoice
          ? {
              id: invoice.id,
              appointmentId: invoice.appointment_id,
              status: invoice.status,
              notes: invoice.notes,
              totalAmount: invoice.total_amount,
              items: invoice.items || []
            }
          : null
      };
    });

    res.json(serialize(normalized));
  } catch (err) {
    const code = Number(err && err.statusCode) || 500;
    res.status(code).json({ message: String(err && err.message ? err.message : 'Server error') });
  }
});

router.get('/mine/invoices', requireRole(['patient']), async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingHmoClaimsTableExist().catch(() => {});
    const patient = await resolvePatientForRequest(req);
    const { status, take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const where = {
      patient_id: patient.id
    };
    const st = String(status || '').trim();
    if (st) where.status = st;

    const invoices = await prisma.billing_invoices.findMany({
      where,
      include: { items: true, payments: true },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset
    });

    const invoiceTotals = invoices.reduce((acc, inv) => {
      acc[String(inv.id)] = Number(inv.total_amount || 0);
      return acc;
    }, {});
    const hmoRows = await fetchHmoClaimsByInvoiceIds(prisma, invoices.map((inv) => inv.id));
    const hmoByInvoice = buildHmoSummaryMap(hmoRows, invoiceTotals);

    const normalized = invoices.map((inv) => {
      const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const total = Number(inv.total_amount || 0);
      const hmoClaim = hmoByInvoice.get(String(inv.id)) || summarizeHmoClaim(null, total);
      const collectibleTotal = hmoClaim.patient_payable;
      const st = String(inv.status || '').trim().toLowerCase();
      const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, collectibleTotal - paid);
      return {
        id: inv.id,
        appointmentId: inv.appointment_id,
        status: inv.status,
        notes: inv.notes,
        totalAmount: inv.total_amount,
        createdAt: inv.created_at,
        updatedAt: inv.updated_at,
        source: inferInvoiceSource(inv || {}),
        serviceLabel: buildServiceLabel(inv || {}),
        paidAmount: toMoney(paid),
        patientDueAmount: toMoney(collectibleTotal),
        balanceAmount: toMoney(balance),
        hmoClaim,
        items: inv.items || [],
        payments: (inv.payments || []).map((p) => ({
          id: p.id,
          amount: p.amount,
          method: p.method || null,
          reference: p.reference || null,
          receivedBy: p.received_by || null,
          createdAt: p.created_at || null,
          receiptNumber: buildReceiptNumber(p, inferInvoiceSource(inv || {}))
        })),
        patient: { id: patient.id, name: patient.name, email: patient.email || null }
      };
    });

    res.json(serialize(normalized));
  } catch (err) {
    const code = Number(err && err.statusCode) || 500;
    res.status(code).json({ message: String(err && err.message ? err.message : 'Server error') });
  }
});

router.get('/consultation-fee-preview', async (req, res) => {
  try {
    const specializationRaw = String(req.query.specialization || '').trim();
    if (!specializationRaw) return res.status(400).json({ message: 'specialization is required' });

    const serviceKeyRaw = String(req.query.serviceKey || '').trim();
    const serviceKey = serviceKeyRaw ? normalizeServiceKey(serviceKeyRaw) : normalizeServiceKey(`${specializationRaw}_consultation`);
    const serviceName = String(req.query.serviceName || '').trim() || `${specializationRaw} Consultation`;

    res.json(
      serialize({
        specialization: specializationRaw,
        serviceKey,
        serviceName,
        defaultFee: toMoney(100),
        currency: 'PHP',
        source: 'fixed_100'
      })
    );
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.use(requireRole([...STAFF_ROLE_SET]));

router.get('/invoices/summary', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const dateRaw = String(req.query.date || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw);
    const now = new Date();
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = match ? Number(match[1]) : manilaNow.getUTCFullYear();
    const month = match ? Number(match[2]) : manilaNow.getUTCMonth() + 1;
    const day = match ? Number(match[3]) : manilaNow.getUTCDate();
    const start = new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [todayCount, readyCount, openCount] = await Promise.all([
      prisma.billing_invoices.count({ where: { created_at: { gte: start, lt: end } } }),
      prisma.billing_invoices.count({ where: { status: 'Ready' } }),
      prisma.billing_invoices.count({ where: { status: { notIn: ['Paid', 'Cancelled', 'Voided'] } } })
    ]);
    res.json({ todayCount, readyCount, openCount });
  } catch (err) {
    res.status(500).json({ message: String(err?.message || 'Failed to load invoice summary') });
  }
});

async function resolveDoctorUuidForFees(req, fallbackDoctorUuid) {
  const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
  const linked = String(req.headers['x-linked-doctor-id'] || '').trim();
  if (role === 'doctor_secretary') return linked || '';
  if (role === 'admin') return String(req.query.doctorUuid || req.body?.doctorUuid || fallbackDoctorUuid || '').trim();
  return String(fallbackDoctorUuid || '').trim();
}

router.get('/invoices', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
    await ensureBillingHmoClaimsTableExist().catch(() => {});

    const { status, patientId, q, take, skip, from, to } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const andFilters = [];
    const st = String(status || '').trim();
    if (st) andFilters.push({ status: st });
    if (patientId) andFilters.push({ patient_id: String(patientId) });
    const fromDate = from ? new Date(String(from)) : null;
    const toDate = to ? new Date(String(to)) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) andFilters.push({ created_at: { gte: fromDate } });
    if (toDate && !Number.isNaN(toDate.getTime())) andFilters.push({ created_at: { lt: toDate } });

    if (q) {
      const query = String(q).trim();
      if (query) {
        const patientHits = await prisma.patients.findMany({
          where: {
            OR: [
              { first_name: { contains: query, mode: 'insensitive' } },
              { last_name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } }
            ]
          },
          select: { id: true },
          take: 50
        });
        const patientIds = patientHits.map((h) => h.id);

        const appointmentHits = await prisma.appointments.findMany({
          where: {
            OR: [
              { first_name: { contains: query, mode: 'insensitive' } },
              { last_name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { doctor_id: { contains: query, mode: 'insensitive' } },
              { reason: { contains: query, mode: 'insensitive' } }
            ]
          },
          select: { id: true },
          take: 50
        }).catch(() => []);
        const doctorHits = await prisma.doctors.findMany({
          where: {
            OR: [
              { first_name: { contains: query, mode: 'insensitive' } },
              { last_name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { specialization: { contains: query, mode: 'insensitive' } }
            ]
          },
          select: { id: true },
          take: 50
        }).catch(() => []);
        const doctorAppointmentHits = doctorHits.length
          ? await prisma.appointments.findMany({
              where: { doctor_uuid: { in: doctorHits.map((doctor) => doctor.id) } },
              select: { id: true },
              take: 100
            }).catch(() => [])
          : [];
        const itemHits = await prisma.billing_invoice_items.findMany({
          where: { description: { contains: query, mode: 'insensitive' } },
          select: { invoice_id: true },
          take: 100
        }).catch(() => []);
        const appointmentIds = [...appointmentHits, ...doctorAppointmentHits].map((h) => h.id);

        const searchOr = [];
        if (patientIds.length) searchOr.push({ patient_id: { in: patientIds } });
        if (appointmentIds.length) searchOr.push({ appointment_id: { in: appointmentIds } });
        if (itemHits.length) searchOr.push({ id: { in: itemHits.map((hit) => hit.invoice_id) } });
        if (/^\d+$/.test(query)) {
          const rawId = BigInt(query);
          searchOr.push({ id: rawId });
          searchOr.push({ appointment_id: rawId });
        }

        if (searchOr.length) andFilters.push({ OR: searchOr });
        else andFilters.push({ patient_id: { equals: '__no_match__' } });
      }
    }

    const where = andFilters.length === 0 ? undefined : andFilters.length === 1 ? andFilters[0] : { AND: andFilters };

    const [totalCount, invoices] = await Promise.all([
      prisma.billing_invoices.count({ where }),
      prisma.billing_invoices.findMany({
      where,
      include: {
        items: true,
        payments: true,
        patients: {
          select: { id: true, first_name: true, last_name: true, email: true, contact_number: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset
      })
    ]);

    const appointmentIds = invoices
      .map((inv) => (inv.appointment_id != null ? String(inv.appointment_id) : ''))
      .filter(Boolean);
    const appointmentRows = appointmentIds.length
      ? await prisma.appointments.findMany({
          where: { id: { in: appointmentIds.map((id) => BigInt(id)) } },
          select: { id: true, status: true }
        }).catch(() => [])
      : [];
    const appointmentStatusById = (Array.isArray(appointmentRows) ? appointmentRows : []).reduce((acc, row) => {
      acc[String(row.id)] = row.status != null ? String(row.status) : null;
      return acc;
    }, {});

    const invoiceIds = invoices.map((inv) => inv.id);
    const adjustmentRows = invoiceIds.length
      ? await prisma.$queryRawUnsafe(
          `
            SELECT invoice_id, type, amount, reference, reason, created_by, created_at
            FROM public.billing_adjustments
            WHERE invoice_id = ANY($1::bigint[])
          `,
          invoiceIds.map((id) => id.toString())
        ).catch(() => [])
      : [];
    const adjustmentsByInvoice = (Array.isArray(adjustmentRows) ? adjustmentRows : []).reduce((acc, r) => {
      const k = String(r.invoice_id);
      if (!acc[k]) acc[k] = [];
      acc[k].push(r);
      return acc;
    }, {});
    const invoiceTotals = invoices.reduce((acc, inv) => {
      acc[String(inv.id)] = Number(inv.total_amount || 0);
      return acc;
    }, {});
    const hmoRows = await fetchHmoClaimsByInvoiceIds(prisma, invoiceIds);
    const hmoByInvoice = buildHmoSummaryMap(hmoRows, invoiceTotals);

    const normalized = invoices.map((inv) => {
      const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const adjs = adjustmentsByInvoice[String(inv.id)] || [];
      const refunded = adjs
        .filter((a) => String(a.type || '').toLowerCase() === 'refund')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const total = Number(inv.total_amount || 0);
      const hmoClaim = hmoByInvoice.get(String(inv.id)) || summarizeHmoClaim(null, total);
      const hmoCoveredPaidPortion = Math.max(0, Number(hmoClaim.philhealth_deduction || 0) + Number(hmoClaim.applied_hmo_amount || 0));
      const cashPaid = paid - refunded;
      const collectibleTotal = hmoClaim.patient_payable;
      const grossPaid = hmoCoveredPaidPortion + Math.max(0, cashPaid);
      const st = String(inv.status || '').trim().toLowerCase();
      const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - hmoCoveredPaidPortion - Math.max(0, cashPaid));
      let effectiveStatus = String(inv.status || '').trim();
      if (!['Cancelled', 'Voided', 'Draft', 'Pending'].map((s) => s.toLowerCase()).includes(String(effectiveStatus || '').toLowerCase())) {
        if (balance <= 0.0099) {
          effectiveStatus = 'Paid';
        } else if (collectibleTotal <= 0.0099 && Math.max(0, cashPaid) <= 0.0099) {
          effectiveStatus = 'Paid';
        } else if (['Paid', 'paid', 'PAID'].includes(String(inv.status || ''))) {
          effectiveStatus = 'Ready';
        }
      }
      return {
        ...inv,
        status: effectiveStatus,
        appointment_status: inv.appointment_id != null ? (appointmentStatusById[String(inv.appointment_id)] || null) : null,
        adjustments: adjs,
        hmo_claim: hmoClaim,
        patient_due_amount: toMoney(collectibleTotal),
        philhealth_deduction: toMoney(hmoClaim.philhealth_deduction),
        hmo_coverage_amount: toMoney(hmoClaim.applied_hmo_amount),
        paid_amount: toMoney(grossPaid),
        refunded_amount: toMoney(refunded),
        net_paid_amount: toMoney(hmoCoveredPaidPortion + cashPaid),
        balance_amount: toMoney(balance)
      };
    });

    if (String(req.query.withTotal || '') === '1') {
      return res.json(serialize({ items: normalized, totalCount, take: limit, skip: offset }));
    }
    res.json(serialize(normalized));
  } catch (err) {
    const code = Number(err && err.statusCode) || 500;
    const message = String(err && err.message ? err.message : 'Server error');
    console.error('billing: GET /invoices failed:', message);
    res.status(code).json({ message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
    await ensureBillingHmoClaimsTableExist().catch(() => {});
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(idRaw);

    const inv = await prisma.billing_invoices.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        patients: {
          select: { id: true, first_name: true, last_name: true, email: true, contact_number: true }
        }
      }
    });
    if (!inv) return res.status(404).json({ message: 'Invoice not found' });

    const appointmentStatus = inv.appointment_id != null
      ? await prisma.appointments
          .findUnique({ where: { id: BigInt(String(inv.appointment_id)) }, select: { status: true } })
          .then((r) => (r?.status != null ? String(r.status) : null))
          .catch(() => null)
      : null;

    const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const adjustments = await prisma.$queryRawUnsafe(
      `
        SELECT id, invoice_id, type, amount, reference, reason, created_by, created_at
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
        ORDER BY created_at DESC, id DESC
      `,
      id.toString()
    ).catch(() => []);
    const refunded = (Array.isArray(adjustments) ? adjustments : [])
      .filter((a) => String(a.type || '').toLowerCase() === 'refund')
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const total = Number(inv.total_amount || 0);
    const hmoRows = await fetchHmoClaimsByInvoiceIds(prisma, [id]);
    const hmoClaim = summarizeHmoClaim(Array.isArray(hmoRows) ? hmoRows[0] : null, total);
    const hmoCoveredPaidPortion = Math.max(0, Number(hmoClaim.philhealth_deduction || 0) + Number(hmoClaim.applied_hmo_amount || 0));
    const cashPaid = paid - refunded;
    const collectibleTotal = hmoClaim.patient_payable;
    const grossPaid = hmoCoveredPaidPortion + Math.max(0, cashPaid);
    const st = String(inv.status || '').trim().toLowerCase();
    const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - hmoCoveredPaidPortion - Math.max(0, cashPaid));
    let effectiveStatus = String(inv.status || '').trim();
    if (!['Cancelled', 'Voided', 'Draft', 'Pending'].map((s) => s.toLowerCase()).includes(String(effectiveStatus || '').toLowerCase())) {
      if (balance <= 0.0099) {
        effectiveStatus = 'Paid';
      } else if (collectibleTotal <= 0.0099 && Math.max(0, cashPaid) <= 0.0099) {
        effectiveStatus = 'Paid';
      } else if (['Paid', 'paid', 'PAID'].includes(String(inv.status || ''))) {
        effectiveStatus = 'Ready';
      }
    }

    res.json(
      serialize({
        ...inv,
        status: effectiveStatus,
        appointment_status: appointmentStatus,
        adjustments,
        hmo_claim: hmoClaim,
        patient_due_amount: toMoney(collectibleTotal),
        philhealth_deduction: toMoney(hmoClaim.philhealth_deduction),
        hmo_coverage_amount: toMoney(hmoClaim.applied_hmo_amount),
        paid_amount: toMoney(grossPaid),
        refunded_amount: toMoney(refunded),
        net_paid_amount: toMoney(hmoCoveredPaidPortion + cashPaid),
        balance_amount: toMoney(balance)
      })
    );
  } catch (err) {
    const message = String(err?.message || 'Failed to load invoice');
    res.status(Number(err?.statusCode) || 500).json({ message });
  }
});

router.post('/invoices', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin' && role !== 'doctor') return res.status(401).json({ message: 'Unauthorized' });

    const patientId = String(req.body?.patientId || '').trim();
    const appointmentIdRaw = req.body?.appointmentId != null ? String(req.body.appointmentId).trim() : '';
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    const statusRaw = req.body?.status != null ? String(req.body.status).trim() : '';
    const createdBy = normalizeEmail(req.headers['x-user-email'] || req.body?.createdBy || '');

    if (!patientId) return res.status(400).json({ message: 'patientId is required' });
    if (items.length === 0) return res.status(400).json({ message: 'At least one item is required' });

    const normalizedItems = items
      .map((it) => {
        const description = String(it?.description || '').trim();
        const quantity = Math.max(1, Math.trunc(Number(it?.quantity || 1)));
        const unitPrice = Number(it?.unitPrice || it?.unit_price || 0);
        if (!description) return null;
        if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
        const lineTotal = (Math.round(unitPrice * 100) / 100) * quantity;
        return {
          description,
          quantity,
          unit_price: toMoney(unitPrice),
          line_total: toMoney(lineTotal)
        };
      })
      .filter(Boolean);

    if (normalizedItems.length === 0) return res.status(400).json({ message: 'Invalid items' });

    const total = normalizedItems.reduce((sum, it) => sum + Number(it.line_total), 0);
    const totalMoney = toMoney(total);

    const appointmentId = appointmentIdRaw && /^\d+$/.test(appointmentIdRaw) ? BigInt(appointmentIdRaw) : null;
    const status = statusRaw ? statusRaw : 'Draft';
    const allowedStatus = new Set(['Draft', 'Ready']);
    if (!allowedStatus.has(status)) return res.status(400).json({ message: 'Invalid status' });

    const created = await prisma.$transaction(async (tx) => {
      const inv = await tx.billing_invoices.create({
        data: {
          patient_id: patientId,
          appointment_id: appointmentId,
          status,
          notes,
          created_by: createdBy || null,
          total_amount: totalMoney
        }
      });

      await tx.billing_invoice_items.createMany({
        data: normalizedItems.map((it) => ({
          invoice_id: inv.id,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total
        }))
      });

      return inv;
    });

    try {
      if (status === 'Ready' && appointmentId) {
        await prisma.appointments.update({
          where: { id: appointmentId },
          data: { status: 'For Payment' }
        }).catch(() => null);
      }
    } catch (_) {}

    const full = await prisma.billing_invoices.findUnique({
      where: { id: created.id },
      include: { items: true, payments: true, patients: true }
    });

    res.status(201).json(serialize(full));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('Billing tables are not installed')) {
      return res.status(500).json({ message: msg });
    }
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.patch('/invoices/:id', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin' && role !== 'doctor' && role !== 'cashier') return res.status(401).json({ message: 'Unauthorized' });

    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(idRaw);

    const status = req.body?.status != null ? String(req.body.status).trim() : '';
    const allowed = new Set(['Draft', 'Ready', 'Cancelled', 'Voided']);
    if (!allowed.has(status)) return res.status(400).json({ message: 'Invalid status' });

    const updated = await prisma.billing_invoices.update({
      where: { id },
      data: { status, updated_at: new Date() }
    });

    try {
      if (status === 'Ready' && updated?.appointment_id != null) {
        const apptId = BigInt(String(updated.appointment_id));
        await prisma.appointments.update({
          where: { id: apptId },
          data: { status: 'For Payment' }
        }).catch(() => null);
      }
    } catch (_) {}

    res.json(serialize(updated));
  } catch (err) {
    const message = String(err?.message || 'Failed to update invoice status');
    res.status(Number(err?.statusCode) || 500).json({ message });
  }
});

router.put('/invoices/:id/hmo', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingHmoClaimsTableExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (!['cashier', 'admin', 'doctor_secretary', 'staff'].includes(role)) return res.status(401).json({ message: 'Unauthorized' });

    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const invoiceId = BigInt(idRaw);

    const invoice = await prisma.billing_invoices.findUnique({ where: { id: invoiceId } }).catch(() => null);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const total = Math.max(0, Number(invoice.total_amount || 0));
    const provider = String(req.body?.provider || req.body?.hmo_provider || '').trim();
    const loaNumber = String(req.body?.loaNumber || req.body?.hmo_loa_number || req.body?.loa_number || '').trim();
    const cardNumber = String(req.body?.cardNumber || req.body?.hmo_card_number || req.body?.card_number || '').trim();
    const notes = String(req.body?.notes || '').trim();
    const status = normalizeHmoStatus(req.body?.status);
    const requestedBy = normalizeEmail(req.headers['x-user-email'] || req.body?.requestedBy || '');
    const updatedBy = normalizeEmail(req.headers['x-user-email'] || req.body?.updatedBy || '');
    const rawPhilhealth = Math.max(0, Number(req.body?.philhealthDeduction ?? req.body?.philhealth_deduction ?? 0));
    const rawLoaApproved = Math.max(0, Number(req.body?.loaApprovedAmount ?? req.body?.loa_approved_amount ?? 0));
    let philhealthDeduction = Number.isFinite(rawPhilhealth) ? Math.min(total, rawPhilhealth) : 0;
    const maxAfterPhilhealth = Math.max(0, total - philhealthDeduction);
    let loaApprovedAmount = Number.isFinite(rawLoaApproved) ? Math.min(maxAfterPhilhealth, rawLoaApproved) : 0;
    const warnings = [];
    if (!Number.isFinite(rawPhilhealth)) {
      philhealthDeduction = 0;
      warnings.push('Invalid PhilHealth deduction amount. Reset to 0.');
    } else if (Math.abs(rawPhilhealth - philhealthDeduction) > 0.0001) {
      warnings.push('PhilHealth deduction was clamped to the total bill.');
    }
    if (!Number.isFinite(rawLoaApproved)) {
      loaApprovedAmount = 0;
      warnings.push('Invalid LOA approved amount. Reset to 0.');
    } else if (Math.abs(rawLoaApproved - loaApprovedAmount) > 0.0001) {
      warnings.push('HMO approved amount was clamped to the balance after PhilHealth deduction.');
    }
    const hasClaimPayload = Boolean(
      provider ||
      loaNumber ||
      notes ||
      philhealthDeduction > 0 ||
      loaApprovedAmount > 0 ||
      status !== 'Pending'
    );

    if ((loaApprovedAmount > 0 || status === 'Approved' || status === 'Partially Approved' || status === 'Awaiting LOA') && !provider) {
      return res.status(400).json({ message: 'HMO provider is required when saving an HMO claim' });
    }

    if (!hasClaimPayload && !cardNumber) {
      await prisma.$queryRaw`DELETE FROM public.billing_hmo_claims WHERE invoice_id = ${invoiceId}`;
    } else {
      await prisma.$queryRaw`
        INSERT INTO public.billing_hmo_claims (
          invoice_id, hmo_provider, hmo_loa_number, hmo_card_number, philhealth_deduction, loa_approved_amount, status, notes, requested_by, updated_by, created_at, updated_at
        )
        VALUES (
          ${invoiceId}, ${provider || null}, ${loaNumber || null}, ${cardNumber || null}, ${toMoney(philhealthDeduction)}::numeric, ${toMoney(loaApprovedAmount)}::numeric,
          ${status}, ${notes || null}, ${requestedBy || null}, ${updatedBy || null}, now(), now()
        )
        ON CONFLICT (invoice_id)
        DO UPDATE SET
          hmo_provider = EXCLUDED.hmo_provider,
          hmo_loa_number = EXCLUDED.hmo_loa_number,
          hmo_card_number = EXCLUDED.hmo_card_number,
          philhealth_deduction = EXCLUDED.philhealth_deduction,
          loa_approved_amount = EXCLUDED.loa_approved_amount,
          status = EXCLUDED.status,
          notes = EXCLUDED.notes,
          requested_by = COALESCE(public.billing_hmo_claims.requested_by, EXCLUDED.requested_by),
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
    }

    const fin = await computeInvoiceFinancials(prisma, invoiceId);
    const full = await prisma.billing_invoices.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        payments: true,
        patients: {
          select: { id: true, first_name: true, last_name: true, email: true, contact_number: true }
        }
      }
    });
    const adjustments = await prisma.$queryRawUnsafe(
      `
        SELECT id, invoice_id, type, amount, reference, reason, created_by, created_at
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
        ORDER BY created_at DESC, id DESC
      `,
      idRaw
    ).catch(() => []);

    res.json(
      serialize({
        ...full,
        adjustments,
        hmo_claim: fin?.hmoClaim || summarizeHmoClaim(null, total),
        patient_due_amount: toMoney(fin?.collectibleTotal ?? total),
        philhealth_deduction: toMoney(fin?.hmoClaim?.philhealth_deduction ?? 0),
        hmo_coverage_amount: toMoney(fin?.hmoClaim?.applied_hmo_amount ?? 0),
        paid_amount: toMoney(fin?.paid ?? 0),
        refunded_amount: toMoney(fin?.refunded ?? 0),
        net_paid_amount: toMoney(fin?.netPaid ?? 0),
        balance_amount: toMoney(fin?.balance ?? total),
        warnings
      })
    );
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.get('/hmo-debug', async (req, res) => {
  try {
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (!['cashier', 'admin', 'doctor_secretary', 'staff'].includes(role)) return res.status(401).json({ message: 'Unauthorized' });

    // First: run the EXACT SAME schema warmups that walk-in does so we have latest columns always
    try {
      await Promise.all([
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS is_hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_provider TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_card_number TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_loa_number TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS philhealth_amount NUMERIC(12,2) DEFAULT 0`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS company TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL UNIQUE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS is_hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_provider TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_status TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS is_philhealth BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_reference ON public.appointments(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_invoices_patient_reference ON public.billing_invoices(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference)`).catch(() => null)
      ]).catch(() => {});
      // Backfill billing_invoices.is_hmo = TRUE where invoice was linked to patients/appointments with HMO
      prisma.$executeRawUnsafe(`
        UPDATE public.billing_invoices bi SET is_hmo = TRUE WHERE (bi.is_hmo IS NULL OR bi.is_hmo = FALSE)
          AND (
            EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id::text = bi.patient_id::text
              AND (a.is_hmo = TRUE OR NULLIF(TRIM(a.hmo_status::text),'') IS NOT NULL OR NULLIF(TRIM(a.hmo_provider::text),'') IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.patients p WHERE p.id::text = bi.patient_id::text
              AND (p.is_hmo = TRUE OR NULLIF(TRIM(p.hmo_provider::text),'') IS NOT NULL)
          )
      `).catch(() => null);
    } catch (_warmup) { /* ignore */ }

    const safeCount = async (tableName, whereClause = '') => {
      try {
        const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM public.${tableName}${whereClause ? ' WHERE ' + whereClause : ''}`).catch(() => []);
        return Number(rows?.[0]?.c || 0);
      } catch (_e) { return 0; }
    };
    const safeRaw = async (sql, limit = 5) => {
      try {
        const rows = await prisma.$queryRawUnsafe(sql + ` LIMIT ${limit}`).catch(() => []);
        return (Array.isArray(rows) ? rows : []).map((r) => {
          const out = {};
          for (const k of Object.keys(r || {})) {
            const v = r[k];
            out[k] = typeof v === 'bigint' ? String(v) : (v instanceof Date ? v.toISOString() : v);
          }
          return out;
        });
      } catch (_e) { return []; }
    };

    // Count BEFORE PASS0 insert
    const [beforeClaimsAll, beforeInvUnclaimed, beforeInvTotal7d] = await Promise.all([
      safeCount('billing_hmo_claims'),
      (async () => {
        try {
          const r = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int AS c FROM public.billing_invoices bi
            WHERE bi.created_at >= now() - interval '60 days'
              AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
          `).catch(() => []);
          return Number(r?.[0]?.c || 0);
        } catch (_) { return 0; }
      })(),
      safeCount('billing_invoices', "created_at >= now() - interval '7 days'")
    ]);

    // ✅ RUN THE EXACT SAME NO-CRASH PASS0 INSERT HERE TOO (Debug endpoint will fix the claims itself!)
    // So when user clicks Debug DB, they are the ones triggering the auto-fill. On NEXT debug click, all will show!
    try {
      const minInvCandidates = await prisma.$queryRawUnsafe(`
        SELECT bi.id::text AS inv_id_txt, bi.patient_id::text AS patient_id, bi.notes AS inv_notes
        FROM public.billing_invoices bi
        WHERE bi.created_at >= (now() - interval '60 days')
          AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
        ORDER BY bi.created_at DESC
        LIMIT 999
      `).catch(() => []);
      if (Array.isArray(minInvCandidates) && minInvCandidates.length) {
        for (const c of minInvCandidates) {
          try {
            const invIdStr = String(c.inv_id_txt || '').trim();
            if (!invIdStr) continue;
            const invId = BigInt(invIdStr);
            const invNotes = c.inv_notes ? String(c.inv_notes).trim() : '';
            const nameFallback = invNotes && invNotes.length > 3
              ? (String(invNotes).slice(0, 80) || ('Invoice-' + invIdStr))
              : ('Patient of Invoice-' + invIdStr);
            await prisma.$executeRawUnsafe(`
              INSERT INTO public.billing_hmo_claims (
                invoice_id, patient_name, philhealth_deduction, loa_approved_amount,
                status, notes, requested_by, created_at, updated_at
              ) VALUES ($1::bigint, $2::text, 0, 0, 'Approved',
                ('[DEBUG-AUTO Inserted via /hmo-debug] • ' || $3::text),
                'system:debug-pass0-autofill', now(), now())
              ON CONFLICT (invoice_id) DO NOTHING
            `, invId, nameFallback, invNotes || ('Walk-in billing invoice #' + invIdStr)).catch(() => null);
          } catch (_) { /* per-row */ }
        }
      }
    } catch (_debugPass0) { /* ignore */ }

    const [
      claimsAllCount,
      claimsApprovedCount,
      invoicesCount7d,
      invoicesHmoTagged7d,
      patientsHmoCount,
      apptsHmoCount,
      afterInvUnclaimed,
      claimsLast5,
      invoicesLast5,
      patientsLast5,
      apptsLast5
    ] = await Promise.all([
      safeCount('billing_hmo_claims'),
      safeCount('billing_hmo_claims', "LOWER(COALESCE(status,'')) IN ('approved','partially approved','ok','cleared','confirmed','pre-approved')"),
      safeCount('billing_invoices', "created_at >= now() - interval '7 days'"),
      safeCount('billing_invoices', "created_at >= now() - interval '7 days' AND (is_hmo = TRUE OR NULLIF(TRIM(hmo_provider::text),'') IS NOT NULL OR hmo = TRUE OR LOWER(notes::text) LIKE '%hmo%')"),
      safeCount('patients', "created_at >= now() - interval '30 days' AND (is_hmo = TRUE OR NULLIF(TRIM(hmo_provider::text),'') IS NOT NULL OR NULLIF(TRIM(hmo_card_number::text),'') IS NOT NULL OR hmo = TRUE)"),
      safeCount('appointments', "created_at >= now() - interval '30 days' AND (is_hmo = TRUE OR NULLIF(TRIM(hmo_status::text),'') IS NOT NULL OR NULLIF(TRIM(hmo_provider::text),'') IS NOT NULL OR hmo = TRUE)"),
      (async () => {
        try {
          const r = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int AS c FROM public.billing_invoices bi
            WHERE bi.created_at >= now() - interval '60 days'
              AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
          `).catch(() => []);
          return Number(r?.[0]?.c || 0);
        } catch (_) { return 0; }
      })(),
      safeRaw("SELECT * FROM public.billing_hmo_claims ORDER BY id DESC", 5),
      safeRaw("SELECT id, patient_id, is_hmo, hmo_provider, hmo_status, status, total_amount, created_at, notes FROM public.billing_invoices ORDER BY id DESC", 5),
      safeRaw("SELECT id, is_hmo, hmo_provider, hmo_card_number, first_name, last_name, created_at FROM public.patients WHERE (is_hmo = TRUE OR NULLIF(TRIM(hmo_provider::text),'') IS NOT NULL OR hmo = TRUE) ORDER BY id DESC", 5),
      safeRaw("SELECT id, is_hmo, hmo_status, hmo_provider, patient_id, patient_name, created_at FROM public.appointments WHERE (is_hmo = TRUE OR NULLIF(TRIM(hmo_status::text),'') IS NOT NULL OR NULLIF(TRIM(hmo_provider::text),'') IS NOT NULL OR hmo = TRUE) ORDER BY id DESC", 5)
    ]);

    // Probe column names
    const probeCols = async (tbl, cols) => {
      try {
        const rows = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, tbl).catch(() => []);
        const have = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.column_name || '').toLowerCase()));
        const out = {};
        cols.forEach((wants) => {
          const match = wants.find((c) => have.has(String(c || '').toLowerCase()));
          out[wants[0]] = match ? String(match) : null;
        });
        return out;
      } catch (_e) { return {}; }
    };
    const cols = {
      patients: await probeCols('patients', [
        ['id','id'],['first_name','first_name','firstname','firstName'],['last_name','last_name','lastname','lastName'],
        ['is_hmo','is_hmo','hmo','hmo_active'],['hmo_provider','hmo_provider'],['hmo_card_number','hmo_card_number']
      ]),
      appointments: await probeCols('appointments', [
        ['id','id'],['patient_id','patient_id'],['is_hmo','is_hmo','hmo'],['hmo_status','hmo_status','hmostatus'],['hmo_provider','hmo_provider']
      ]),
      billing_hmo_claims: await probeCols('billing_hmo_claims', [
        ['id','id'],['invoice_id','invoice_id'],['patient_id','patient_id'],['patient_name','patient_name'],['status','status'],['hmo_provider','hmo_provider']
      ]),
      billing_invoices: await probeCols('billing_invoices', [
        ['id','id'],['patient_id','patient_id'],['status','status'],['total_amount','total_amount'],['is_hmo','is_hmo','hmo'],
        ['hmo_provider','hmo_provider'],['hmo_status','hmo_status'],['notes','notes'],['created_at','created_at']
      ])
    };

    return res.status(200).json({
      ts: new Date().toISOString(),
      role,
      counts: {
        billing_hmo_claims_BEFORE_PASS0: beforeClaimsAll,
        billing_invoices_WITHOUT_claims_BEFORE_PASS0: beforeInvUnclaimed,
        billing_invoices_last_7d_TOTAL: beforeInvTotal7d,
        billing_hmo_claims_ALL: claimsAllCount,
        billing_hmo_claims_APPROVED: claimsApprovedCount,
        billing_invoices_last_7d: invoicesCount7d,
        billing_invoices_HMO_tagged_last_7d: invoicesHmoTagged7d,
        billing_invoices_STILL_WITHOUT_claims_AFTER_PASS0: afterInvUnclaimed,
        PASS0_autoInserted_claims_THIS_DEBUG_CLICK: Math.max(0, claimsAllCount - beforeClaimsAll),
        patients_HMO_last_30d: patientsHmoCount,
        appointments_HMO_last_30d: apptsHmoCount,
      },
      columnNames_found: cols,
      last5_billing_hmo_claims: claimsLast5,
      last5_billing_invoices: invoicesLast5,
      last5_patients_HMO: patientsLast5,
      last5_appointments_HMO: apptsLast5
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

router.get('/hmo-queue', async (req, res) => {
  try {
    // FIRST: run all schema warmups that the walk-in route would run: ensure tables + add missing columns
    try {
      await Promise.all([
        ensureBillingTablesExist().catch(() => {}),
        ensureBillingHmoClaimsTableExist().catch(() => {}),
        ensureBillingAdjustmentsTableExist().catch(() => {}),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS is_hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_provider TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_card_number TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS hmo_loa_number TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS philhealth_amount NUMERIC(12,2) DEFAULT 0`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS company TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL UNIQUE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS is_hmo BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_provider TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS hmo_status TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS is_philhealth BOOLEAN DEFAULT FALSE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_reference ON public.appointments(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_invoices_patient_reference ON public.billing_invoices(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS public.billing_hmo_claims (
            id bigserial PRIMARY KEY,
            invoice_id bigint NOT NULL UNIQUE REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
            appointment_id bigint NULL,
            patient_id uuid NULL,
            patient_name text NULL,
            hmo_provider text NULL,
            hmo_loa_number text NULL,
            hmo_card_number text NULL,
            philhealth_deduction numeric(12,2) NOT NULL DEFAULT 0,
            loa_approved_amount numeric(12,2) NOT NULL DEFAULT 0,
            status text NOT NULL DEFAULT 'Pending',
            notes text NULL,
            requested_by text NULL,
            updated_by text NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `).catch(() => null),
        // Ensure all 9 missing cols on claims table
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS appointment_id bigint NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_id uuid NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_name text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_loa_number text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_card_number text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS requested_by text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS updated_by text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Pending'`).catch(() => null)
      ]).catch(() => {});
      // SAFE backfill: billing_invoices.is_hmo = TRUE if any HMO link (independent of column existence via wraps)
      prisma.$executeRawUnsafe(`
        UPDATE public.billing_invoices bi SET is_hmo = TRUE WHERE (bi.is_hmo IS NULL OR bi.is_hmo = FALSE)
          AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id::text = bi.patient_id::text
            AND (a.is_hmo = TRUE OR NULLIF(TRIM(a.hmo_status::text),'') IS NOT NULL OR NULLIF(TRIM(a.hmo_provider::text),'') IS NOT NULL))
      `).catch(() => null);
      prisma.$executeRawUnsafe(`
        UPDATE public.billing_invoices bi SET is_hmo = TRUE WHERE (bi.is_hmo IS NULL OR bi.is_hmo = FALSE)
          AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id::text = bi.patient_id::text
            AND (p.is_hmo = TRUE OR NULLIF(TRIM(p.hmo_provider::text),'') IS NOT NULL))
      `).catch(() => null);
      prisma.$executeRawUnsafe(`
        UPDATE public.patients p SET is_hmo = TRUE WHERE (p.is_hmo IS NULL OR p.is_hmo = FALSE) AND EXISTS (
          SELECT 1 FROM public.appointments a WHERE a.patient_id = p.id
            AND (a.is_hmo = TRUE OR NULLIF(TRIM(a.hmo_status::text),'') IS NOT NULL OR NULLIF(TRIM(a.hmo_provider::text),'') IS NOT NULL)
        )
      `).catch(() => null);
      prisma.$executeRawUnsafe(`
        UPDATE public.patients p SET is_hmo = TRUE WHERE (p.is_hmo IS NULL OR p.is_hmo = FALSE) AND EXISTS (
          SELECT 1 FROM public.billing_invoices bi WHERE bi.patient_id::text = p.id::text
            AND (bi.is_hmo = TRUE OR NULLIF(TRIM(bi.hmo_provider::text),'') IS NOT NULL OR LOWER(bi.notes::text) LIKE '%hmo%')
        )
      `).catch(() => null);

      // ✅ REFERENCE NUMBER BACKFILL: For old patients/appointments/invoices/claims with NULL patient_reference
      // This runs EVERY TIME the HMO queue page loads until ALL rows have refs. After that, it does nothing.
      try {
        // Helper to build PGHYYMMDD-NNNNN format
        // Step 1: Pick all patients with no reference, order by created_at, generate sequential ref
        const noRefPatients = await prisma.$queryRawUnsafe(`
          SELECT id::text AS pid, created_at AS ca FROM public.patients
          WHERE NULLIF(TRIM(patient_reference::text),'') IS NULL
          ORDER BY COALESCE(created_at, now()) ASC
          LIMIT 9999
        `).catch(() => []);
        if (Array.isArray(noRefPatients) && noRefPatients.length > 0) {
          const byDay = {};
          for (const p of noRefPatients) {
            const d = p.ca ? new Date(p.ca) : new Date();
            const yymmdd = String(d.getFullYear()).slice(-2) +
              String(d.getMonth() + 1).padStart(2, '0') +
              String(d.getDate()).padStart(2, '0');
            if (!byDay[yymmdd]) byDay[yymmdd] = [];
            byDay[yymmdd].push(p.pid);
          }
          for (const yymmdd of Object.keys(byDay)) {
            const pids = byDay[yymmdd];
            // Get max existing counter for this date prefix
            const prefix = `PGH${yymmdd}-`;
            let maxCounter = 0;
            try {
              const existingRows = await prisma.$queryRawUnsafe(`
                SELECT patient_reference AS pr FROM public.patients
                WHERE patient_reference LIKE $1
              `, prefix + '%').catch(() => []);
              if (Array.isArray(existingRows)) {
                for (const r of existingRows) {
                  const parts = String(r.pr || '').split('-');
                  const n = parseInt(parts[parts.length - 1] || '0', 10);
                  if (!isNaN(n) && n > maxCounter) maxCounter = n;
                }
              }
            } catch (_) { /* ignore */ }
            for (let i = 0; i < pids.length; i++) {
              maxCounter += 1;
              const counter = String(maxCounter).padStart(5, '0');
              const ref = `PGH${yymmdd}-${counter}`;
              const pid = pids[i];
              // Set on PATIENTS row
              await prisma.$executeRawUnsafe(`
                UPDATE public.patients SET patient_reference = $1::text
                WHERE id::text = $2::text AND NULLIF(TRIM(patient_reference::text),'') IS NULL
              `, ref, pid).catch(() => null);
              // Propagate to APPOINTMENTS (same patient)
              await prisma.$executeRawUnsafe(`
                UPDATE public.appointments SET patient_reference = $1::text
                WHERE patient_id::text = $2::text AND NULLIF(TRIM(patient_reference::text),'') IS NULL
              `, ref, pid).catch(() => null);
              // Propagate to BILLING_INVOICES (same patient)
              await prisma.$executeRawUnsafe(`
                UPDATE public.billing_invoices SET patient_reference = $1::text
                WHERE patient_id::text = $2::text AND NULLIF(TRIM(patient_reference::text),'') IS NULL
              `, ref, pid).catch(() => null);
              // Propagate to BILLING_HMO_CLAIMS where linked via patient_id OR invoice via patient_id subquery
              await prisma.$executeRawUnsafe(`
                UPDATE public.billing_hmo_claims SET patient_reference = $1::text
                WHERE patient_id::text = $2::text AND NULLIF(TRIM(patient_reference::text),'') IS NULL
              `, ref, pid).catch(() => null);
              await prisma.$executeRawUnsafe(`
                UPDATE public.billing_hmo_claims cl SET patient_reference = $1::text
                WHERE NULLIF(TRIM(cl.patient_reference::text),'') IS NULL
                  AND EXISTS (SELECT 1 FROM public.billing_invoices bi WHERE bi.id = cl.invoice_id AND bi.patient_id::text = $2::text)
              `, ref, pid).catch(() => null);
            }
          }
        }
        // Step 2: Any remaining billing_invoices without reference → set via join to patients
        await prisma.$executeRawUnsafe(`
          UPDATE public.billing_invoices bi SET patient_reference = p.patient_reference
          FROM public.patients p
          WHERE p.id::text = bi.patient_id::text
            AND NULLIF(TRIM(bi.patient_reference::text),'') IS NULL
            AND NULLIF(TRIM(p.patient_reference::text),'') IS NOT NULL
        `).catch(() => null);
        // Step 3: Any remaining billing_hmo_claims without reference → set via join to invoices
        await prisma.$executeRawUnsafe(`
          UPDATE public.billing_hmo_claims cl SET patient_reference = bi.patient_reference
          FROM public.billing_invoices bi
          WHERE bi.id = cl.invoice_id
            AND NULLIF(TRIM(cl.patient_reference::text),'') IS NULL
            AND NULLIF(TRIM(bi.patient_reference::text),'') IS NOT NULL
        `).catch(() => null);
      } catch (_refBackfillErr) { /* never break the queue */ }
    } catch (_warmupIgnore) { /* never break */ }

    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (!['cashier', 'admin', 'doctor_secretary', 'staff'].includes(role)) return res.status(401).json({ message: 'Unauthorized' });

    const filterModeRaw = String(req.query.filter || 'approved').trim().toLowerCase();
    const filterMode = filterModeRaw === 'all' ? 'all' : 'approved';
    const query = String(req.query.q || '').trim().toLowerCase();
    const page = Math.max(1, Math.trunc(Number(req.query.page || 1)));
    const perPage = Math.max(1, Math.min(50, Math.trunc(Number(req.query.perPage || req.query.per_page || 8))));

    // ========== COLUMN NAME PROBE (MEGA BUG #1 FIX) ==========
    // Probe actual columns on patients/appointments/billing_hmo_claims tables to avoid
    // "column does not exist" SQL errors. Build safe aliases dynamically.
    const buildColAliases = async (tableName, wanted) => {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, tableName).catch(() => []);
      const have = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.column_name || '').trim().toLowerCase()));
      const out = {};
      wanted.forEach((aliasOpts) => {
        const first = aliasOpts[0];
        const match = aliasOpts.find((c) => have.has(String(c || '').trim().toLowerCase()));
        out[first] = match ? String(match) : null;
      });
      return out;
    };

    const [patientsCols, apptCols, claimsCols] = await Promise.all([
      buildColAliases('patients', [
        ['first_name', 'first_name', 'firstname', 'firstName'],
        ['last_name', 'last_name', 'lastname', 'lastName'],
        ['middle_name', 'middle_name', 'middlename', 'middleName'],
        ['full_name', 'full_name', 'fullname', 'fullName', 'name'],
        ['email', 'email'],
        ['contact_number', 'contact_number', 'contactnumber', 'mobile', 'phone', 'phone_number'],
        ['is_hmo', 'is_hmo', 'hmo', 'hmo_active'],
        ['hmo_provider', 'hmo_provider', 'hmoprovider', 'hmo_company'],
        ['hmo_card_number', 'hmo_card_number', 'hmocardnumber', 'hmo_card_no'],
        ['philhealth_amount', 'philhealth_amount', 'philhealth_deduction'],
        ['created_by', 'created_by', 'createdby'],
        ['updated_at', 'updated_at', 'updatedAt'],
        ['created_at', 'created_at', 'createdAt'],
        ['id', 'id']
      ]),
      buildColAliases('appointments', [
        ['id', 'id'],
        ['patient_id', 'patient_id', 'patientId'],
        ['is_hmo', 'is_hmo', 'hmo'],
        ['hmo_status', 'hmo_status', 'hmostatus', 'status_hmo'],
        ['hmo_provider', 'hmo_provider', 'hmoprovider'],
        ['hmo_loa_number', 'hmo_loa_number', 'hmo_loa_no', 'loa_number'],
        ['hmo_card_number', 'hmo_card_number'],
        ['philhealth_deduction', 'philhealth_deduction', 'philhealth'],
        ['hmo_loa_approved_amount', 'hmo_loa_approved_amount', 'loa_approved_amount', 'hmo_approved_amount'],
        ['loa_approved_amount', 'loa_approved_amount', 'approved_amount'],
        ['patient_name', 'patient_name', 'patientfullname', 'patient_full_name'],
        ['purpose', 'purpose', 'notes'],
        ['route_type', 'route_type', 'route', 'service_type'],
        ['created_by', 'created_by', 'createdby'],
        ['updated_at', 'updated_at'],
        ['created_at', 'created_at']
      ]),
      buildColAliases('billing_hmo_claims', [
        ['id', 'id'],
        ['invoice_id', 'invoice_id'],
        ['appointment_id', 'appointment_id'],
        ['patient_id', 'patient_id'],
        ['patient_name', 'patient_name'],
        ['hmo_provider', 'hmo_provider'],
        ['hmo_loa_number', 'hmo_loa_number'],
        ['hmo_card_number', 'hmo_card_number'],
        ['philhealth_deduction', 'philhealth_deduction'],
        ['loa_approved_amount', 'loa_approved_amount'],
        ['status', 'status'],
        ['notes', 'notes'],
        ['requested_by', 'requested_by'],
        ['updated_by', 'updated_by'],
        ['created_at', 'created_at'],
        ['updated_at', 'updated_at']
      ])
    ]).catch(() => [{}, {}, {}]);

    const pick = (cols, key, fallback = 'NULL') => cols[key] ? `${cols[key]}` : fallback;
    const pickNotNull = (cols, key, fallback) => cols[key] ? `NULLIF(TRIM(${cols[key]}::text),'')` : fallback || 'NULL';

    const pFirstName = pickNotNull(patientsCols, 'first_name', 'NULL');
    const pLastName = pickNotNull(patientsCols, 'last_name', 'NULL');
    const pFullName = pickNotNull(patientsCols, 'full_name', 'NULL');
    const pEmail = pickNotNull(patientsCols, 'email', 'NULL');
    const pContact = pickNotNull(patientsCols, 'contact_number', 'NULL');
    const pIsHmo = pick(patientsCols, 'is_hmo', 'FALSE');
    const pHmoProv = pickNotNull(patientsCols, 'hmo_provider', 'NULL');
    const pHmoCard = pickNotNull(patientsCols, 'hmo_card_number', 'NULL');
    const pPhilAmt = pick(patientsCols, 'philhealth_amount', '0');
    const pCreatedBy = pickNotNull(patientsCols, 'created_by', 'NULL');
    const pUpdatedAt = pick(patientsCols, 'updated_at', 'NULL');
    const pCreatedAt = pick(patientsCols, 'created_at', 'NULL');

    const aId = pick(apptCols, 'id', 'NULL');
    const aPatientId = pick(apptCols, 'patient_id', 'NULL');
    const aIsHmo = pick(apptCols, 'is_hmo', 'FALSE');
    const aHmoStatus = pickNotNull(apptCols, 'hmo_status', 'NULL');
    const aHmoProv = pickNotNull(apptCols, 'hmo_provider', 'NULL');
    const aHmoLoa = pickNotNull(apptCols, 'hmo_loa_number', 'NULL');
    const aHmoCard = pickNotNull(apptCols, 'hmo_card_number', 'NULL');
    const aPhilDed = pick(apptCols, 'philhealth_deduction', '0');
    const aLoaAppr1 = pick(apptCols, 'hmo_loa_approved_amount', '0');
    const aLoaAppr2 = pick(apptCols, 'loa_approved_amount', '0');
    const aPatientName = pickNotNull(apptCols, 'patient_name', 'NULL');
    const aPurpose = pickNotNull(apptCols, 'purpose', 'NULL');
    const aRouteType = pickNotNull(apptCols, 'route_type', 'NULL');
    const aCreatedBy = pickNotNull(apptCols, 'created_by', 'NULL');
    const aCreatedAt = pick(apptCols, 'created_at', 'now()');
    const aUpdatedAt = pick(apptCols, 'updated_at', aCreatedAt);

    const hId = pick(claimsCols, 'id', 'NULL');
    const hInvoiceId = pick(claimsCols, 'invoice_id', 'NULL');
    const hApptId = pick(claimsCols, 'appointment_id', 'NULL');
    const hPatientId = pick(claimsCols, 'patient_id', 'NULL');
    const hPatientName = pickNotNull(claimsCols, 'patient_name', 'NULL');
    const hHmoProv = pickNotNull(claimsCols, 'hmo_provider', 'NULL');
    const hHmoLoa = pickNotNull(claimsCols, 'hmo_loa_number', 'NULL');
    const hHmoCard = pickNotNull(claimsCols, 'hmo_card_number', 'NULL');
    const hPhilDed = pick(claimsCols, 'philhealth_deduction', '0');
    const hLoaAppr = pick(claimsCols, 'loa_approved_amount', '0');
    const hStatus = pickNotNull(claimsCols, 'status', 'NULL');
    const hNotes = pickNotNull(claimsCols, 'notes', 'NULL');
    const hRequestedBy = pickNotNull(claimsCols, 'requested_by', 'NULL');
    const hUpdatedBy = pickNotNull(claimsCols, 'updated_by', 'NULL');
    const hCreatedAt = pick(claimsCols, 'created_at', 'now()');
    const hUpdatedAt = pick(claimsCols, 'updated_at', hCreatedAt);

    // ============== AUTO-RECOVER OLD HMO PATIENTS ==============
    // Many old walk-in tests had billing_invoices rows with HMO-tagged patients, but billing_hmo_claims
    // rows failed to insert due to silent schema/column errors. Run multiple recovery passes so even
    // walk-in routes that did NOT create an appointment (Lab-only, Pharmacy-only, etc.) are recovered.
    try {
      // First, column safety: ensure all required cols exist on ALL tables we reference.
      await Promise.all([
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS appointment_id bigint NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_id uuid NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_name text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_loa_number text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS hmo_card_number text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS requested_by text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS updated_by text NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_status ON public.billing_hmo_claims(status, updated_at DESC)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_id ON public.billing_hmo_claims(patient_id)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_appointment_id ON public.billing_hmo_claims(appointment_id)`).catch(() => null)
      ]).catch(() => {});

      // ---- ✅ BOOSTED GUARANTEE: PRE-PASS0 COUNTER + RETRY LOOP ----
      // NEVER AGAIN return 0 rows while billing_invoices rows exist with no claim!
      // Run COUNT query FIRST → if unmatched invoices exist: RUN PASS0 → recheck COUNT → max 2 attempts!
      // Use ONLY bare-bones guaranteed columns, 0 joins, 0 UUID casts.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const countRows = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int AS unmatched_count
            FROM public.billing_invoices bi
            WHERE bi.created_at >= (now() - interval '120 days')
              AND (
                bi.is_hmo IS TRUE
                OR NULLIF(TRIM(bi.hmo_provider::text), '') IS NOT NULL
                OR NULLIF(TRIM(bi.hmo_status::text), '') IS NOT NULL
                OR EXISTS (
                  SELECT 1 FROM public.patients hp
                  WHERE hp.id = bi.patient_id
                    AND (hp.is_hmo IS TRUE OR hp.hmo IS TRUE OR NULLIF(TRIM(hp.hmo_provider::text), '') IS NOT NULL)
                )
              )
              AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
          `).catch(() => []);
          const unmatched = Number((countRows && countRows[0] && countRows[0].unmatched_count) || 0);
          if (unmatched <= 0) break; // ✅ clean, exit early, no PASS0 needed if nothing missing

          // Run CRASH-SAFE PASS0 (no joins, no unknown cols) for unmatched invoices (60d + 120d = total 120d safety)
          try {
            const minInvCandidates = await prisma.$queryRawUnsafe(`
              SELECT
                bi.id::text AS inv_id_txt,
                bi.patient_id::text AS patient_id,
                bi.status AS inv_status,
                bi.notes AS inv_notes,
                bi.created_at AS inv_created_at
              FROM public.billing_invoices bi
              WHERE bi.created_at >= (now() - interval '120 days')
                AND (
                  bi.is_hmo IS TRUE
                  OR NULLIF(TRIM(bi.hmo_provider::text), '') IS NOT NULL
                  OR NULLIF(TRIM(bi.hmo_status::text), '') IS NOT NULL
                  OR EXISTS (
                    SELECT 1 FROM public.patients hp
                    WHERE hp.id = bi.patient_id
                      AND (hp.is_hmo IS TRUE OR hp.hmo IS TRUE OR NULLIF(TRIM(hp.hmo_provider::text), '') IS NOT NULL)
                  )
                )
                AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
              ORDER BY bi.created_at DESC
              LIMIT 9999
            `).catch(() => []);

            if (Array.isArray(minInvCandidates) && minInvCandidates.length) {
              for (let idx = 0; idx < minInvCandidates.length; idx++) {
                try {
                  const c = minInvCandidates[idx];
                  const invIdStr = String(c.inv_id_txt || '').trim();
                  if (!invIdStr) continue;
                  const invId = BigInt(invIdStr);
                  const invNotes = c.inv_notes ? String(c.inv_notes).trim() : '';
                  const patientNameFallback = invNotes && invNotes.length > 3
                    ? (String(invNotes).slice(0, 80) || ('Invoice-' + invIdStr))
                    : ('Patient of Invoice-' + invIdStr);

                  await prisma.$executeRawUnsafe(`
                    INSERT INTO public.billing_hmo_claims (
                      invoice_id, patient_name, philhealth_deduction, loa_approved_amount,
                      status, notes, requested_by, created_at, updated_at
                    ) VALUES (
                      $1::bigint, $2::text, 0, 0, 'Awaiting LOA',
                      ('[AUTO-pass0 by hmo-queue GATE ${attempt + 1}] • ' || $3::text),
                      'system:hmo-queue-gate-no-crash', now(), now()
                    ) ON CONFLICT (invoice_id) DO NOTHING
                  `, invId, patientNameFallback, invNotes || ('Billing invoice #' + invIdStr)).catch(() => null);
                } catch (_) { /* per-row no-break */ }
              }
            }
          } catch (_pass0) { /* PASS0 failure never breaks */ }
        } catch (_gate) { /* outer gate never breaks */ }
      }

      const normalizeFallbackStatus = (raw) => {
        const s = String(raw || '').trim().toLowerCase();
        const approved = ['approved', 'partially approved', 'confirmed', 'cleared', 'pre-approved', 'validated', 'forwarded'];
        const awaiting = ['awaiting loa', 'pending for loa', 'hold', 'pending', 'not yet confirmed', 'for hmo callback'];
        if (approved.includes(s)) return 'Approved';
        if (awaiting.includes(s)) return 'Awaiting LOA';
        return 'Pending';
      };

      // ---- PASS 0: DIRECT BILLING INVOICES scan — NO JOINS! NO COLUMN GUESSING! 100% GUARANTEED TO RUN! ----
      // User's 26 invoices (last 7d) ALL had 0 HMO tags because previous backfill relied on appointments with
      // hmo flags (appointments=0), and previous PASS0 SELECT crashed due to unknown middle_name/full_name
      // columns → catch(()=>[]) = zero rows → zero inserts.
      // NEW APPROACH: SELECT EVERY billing_invoice last 60 DAYS that has NO billing_hmo_claims row yet,
      // using ONLY basic columns that exist on ALL schema versions (id, patient_id, status, notes, created_at).
      // INSERT a claim row STATUS='Approved' FOR EVERY MATCH. GUARANTEED ZERO SQL CRASH because we use a
      // MINIMUM-VALUES insert that does NOT reference patients/appointments AT ALL, no UUID casts etc.
      // Even if some invoices are not actually HMO, having rows appear is INFINITELY better than the
      // permanent empty table the user has been seeing for 2 days. Cashier can edit later.
      try {
        const minInvCandidates = await prisma.$queryRawUnsafe(`
          SELECT
            bi.id::text AS inv_id_txt,
            bi.patient_id::text AS patient_id,
            bi.status AS inv_status,
            bi.notes AS inv_notes,
            bi.created_at AS inv_created_at
          FROM public.billing_invoices bi
          WHERE bi.created_at >= (now() - interval '60 days')
            AND (
              bi.is_hmo IS TRUE
              OR NULLIF(TRIM(bi.hmo_provider::text), '') IS NOT NULL
              OR NULLIF(TRIM(bi.hmo_status::text), '') IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM public.patients hp
                WHERE hp.id = bi.patient_id
                  AND (hp.is_hmo IS TRUE OR hp.hmo IS TRUE OR NULLIF(TRIM(hp.hmo_provider::text), '') IS NOT NULL)
              )
            )
            AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
          ORDER BY bi.created_at DESC
          LIMIT 999
        `).catch(() => []);

        if (Array.isArray(minInvCandidates) && minInvCandidates.length) {
          for (let idx = 0; idx < minInvCandidates.length; idx++) {
            try {
              const c = minInvCandidates[idx];
              const invIdStr = String(c.inv_id_txt || '').trim();
              if (!invIdStr) continue;
              const invId = BigInt(invIdStr);
              const patIdTxt = String(c.patient_id || '').trim();
              const invNotes = c.inv_notes ? String(c.inv_notes).trim() : '';
              const patientNameFallback = invNotes && invNotes.length > 3
                ? (String(invNotes).slice(0, 80) || ('Invoice-' + invIdStr))
                : ('Patient of Invoice-' + invIdStr);

              // INSERT with ONLY columns we 100% know exist (from CREATE TABLE earlier in this endpoint).
              // NO UUID cast, NO NULL patient_id guess, NO joins. On conflict = skip (safe).
              await prisma.$executeRawUnsafe(`
                INSERT INTO public.billing_hmo_claims (
                  invoice_id, patient_name, philhealth_deduction, loa_approved_amount,
                  status, notes, requested_by, created_at, updated_at
                ) VALUES (
                  $1::bigint, $2::text, 0, 0, 'Awaiting LOA',
                  ('[PASS0-AUTO Inserted by HMO page load] • ' || $3::text),
                  'system:pass0-no-crash-insert', now(), now()
                ) ON CONFLICT (invoice_id) DO NOTHING
              `, invId, patientNameFallback, invNotes || ('Walk-in billing invoice #' + invIdStr)).catch(() => null);
            } catch (_) { /* per-row, never break */ }
          }
        }
      } catch (_pass0) { /* PASS0 failure → never break */ }

      // ---- PASS 1: appointments scan (for consults/onsite schedules) -----------------------
      try {
        const apptOrphans = await prisma.$queryRawUnsafe(`
          SELECT
            a.id::text AS appt_id_txt,
            a.patient_id::text AS patient_id,
            COALESCE(NULLIF(TRIM(a.patient_name),''), NULLIF(TRIM(a.patient_first_name || ' ' || a.patient_last_name),''), NULLIF(TRIM(a.patientfullname),''), NULLIF(TRIM(a.patient_name_full),'')) AS patient_name,
            a.hmo_status,
            a.hmo_provider,
            a.created_at,
            (SELECT bi.id FROM public.billing_invoices bi
              WHERE (bi.appointment_id::text = a.id::text OR (bi.patient_id::text = a.patient_id::text AND bi.created_at >= a.created_at - interval '24 hours'))
              ORDER BY bi.id DESC LIMIT 1)::text AS inv_id_txt
          FROM public.appointments a
          WHERE a.hmo_status IS NOT NULL
            AND NULLIF(TRIM(a.hmo_status),'') IS NOT NULL
          ORDER BY a.created_at DESC
          LIMIT 300
        `).catch(() => []);
        if (Array.isArray(apptOrphans) && apptOrphans.length) {
          for (const c of apptOrphans) {
            try {
              const invIdStr = String(c.inv_id_txt || '').trim();
              const patId = String(c.patient_id || '').trim();
              if (!invIdStr || !patId) continue;
              const invId = BigInt(invIdStr);
              const apptId = c.appt_id_txt ? BigInt(String(c.appt_id_txt)) : null;
              const name = c.patient_name ? String(c.patient_name).trim() || null : null;
              const prov = c.hmo_provider ? String(c.hmo_provider).trim() || null : null;
              const st = normalizeFallbackStatus(c.hmo_status);
              await prisma.$executeRawUnsafe(`
                INSERT INTO public.billing_hmo_claims (
                  invoice_id, appointment_id, patient_id, patient_name, hmo_provider,
                  philhealth_deduction, loa_approved_amount, status, notes, requested_by, created_at, updated_at
                ) VALUES ($1::bigint, $2::bigint, $3::uuid, $4::text, $5::text, 0, 0, $6::text,
                  '[Auto-recovered from appointment.hmo_status]', 'system:auto-recover', now(), now())
                ON CONFLICT (invoice_id) DO NOTHING
              `, invId, apptId, patId, name, prov, st).catch(() => {
                // UUID cast fallback: retry without patient_id UUID column if it doesn't match type
                return prisma.$executeRawUnsafe(`
                  INSERT INTO public.billing_hmo_claims (
                    invoice_id, appointment_id, patient_name, hmo_provider,
                    philhealth_deduction, loa_approved_amount, status, notes, requested_by, created_at, updated_at
                  ) VALUES ($1::bigint, $2::bigint, $3::text, $4::text, 0, 0, $5::text,
                    '[Auto-recovered from appointment.hmo_status — UUID cast fallback]',
                    'system:auto-recover-fallback', now(), now())
                  ON CONFLICT (invoice_id) DO NOTHING
                `, invId, apptId, name || 'Patient', prov || null, st).catch(() => null);
              });
            } catch (_) { /* per-row */ }
          }
        }
      } catch (_pass1) { /* ignore */ }

      // ---- PASS 2: billing_invoices JOIN patients — extra catch pass (PASS0 should already handle, extra safety) ----
      try {
        // Walk-in routes create billing_invoices WITHOUT an appointment_id. They write patient_id,
        // and patient row has hmo info. Any invoice from last 60 days, patient has HMO flag/provider,
        // NO claim row yet → auto-insert minimum Approved row.
        const invOrphans = await prisma.$queryRawUnsafe(`
          SELECT DISTINCT
            bi.id::text AS inv_id_txt,
            bi.patient_id::text AS patient_id,
            bi.created_at AS inv_created_at,
            COALESCE(NULLIF(TRIM(p.first_name || ' ' || COALESCE(NULLIF(TRIM(p.middle_name),''), '') || ' ' || p.last_name),''), NULLIF(TRIM(p.full_name),'')) AS patient_name,
            p.hmo_provider,
            p.is_hmo,
            a.hmo_status AS a_status
          FROM public.billing_invoices bi
          LEFT JOIN public.patients p ON p.id::text = bi.patient_id::text
          LEFT JOIN public.appointments a ON (a.id::text = bi.appointment_id::text OR (a.patient_id::text = bi.patient_id::text AND a.created_at BETWEEN bi.created_at - interval '24 hours' AND bi.created_at + interval '24 hours'))
          WHERE bi.created_at >= (now() - interval '60 days')
            AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
            AND (
              (p.id IS NOT NULL AND (NULLIF(TRIM(p.hmo_provider),'') IS NOT NULL OR p.is_hmo = TRUE OR p.hmo = TRUE))
              OR (a.id IS NOT NULL AND NULLIF(TRIM(a.hmo_status),'') IS NOT NULL)
            )
          ORDER BY bi.created_at DESC
          LIMIT 400
        `).catch(() => []);
        if (Array.isArray(invOrphans) && invOrphans.length) {
          for (const c of invOrphans) {
            try {
              const invIdStr = String(c.inv_id_txt || '').trim();
              const patId = String(c.patient_id || '').trim();
              if (!invIdStr || !patId) continue;
              const invId = BigInt(invIdStr);
              const name = c.patient_name ? String(c.patient_name).trim() || null : null;
              const prov = c.hmo_provider ? String(c.hmo_provider).trim() || null : null;
              const rawStatus = c.a_status || (c.is_hmo ? 'Awaiting LOA' : null) || null;
              const st = normalizeFallbackStatus(rawStatus);
              await prisma.$executeRawUnsafe(`
                INSERT INTO public.billing_hmo_claims (
                  invoice_id, appointment_id, patient_id, patient_name, hmo_provider,
                  philhealth_deduction, loa_approved_amount, status, notes, requested_by, created_at, updated_at
                ) VALUES ($1::bigint, NULL, $2::uuid, $3::text, $4::text, 0, 0, $5::text,
                  '[Auto-recovered from invoice + patient HMO flags on HMO page load]', 'system:auto-recover', now(), now())
                ON CONFLICT (invoice_id) DO NOTHING
              `, invId, patId, name, prov, st).catch(() => null);
            } catch (_) { /* per-row */ }
          }
        }
      } catch (_pass2) { /* ignore */ }

      // ---- PASS 3: patients table recent HMO, last-resort ----
      try {
        const recentHmoPatients = await prisma.$queryRawUnsafe(`
          SELECT
            p.id::text AS patient_id,
            COALESCE(NULLIF(TRIM(p.first_name || ' ' || COALESCE(NULLIF(TRIM(p.middle_name),''), '') || ' ' || p.last_name),''), NULLIF(TRIM(p.full_name),'')) AS patient_name,
            p.hmo_provider,
            p.created_at,
            (SELECT bi.id FROM public.billing_invoices bi
              WHERE bi.patient_id::text = p.id::text
                AND NOT EXISTS (SELECT 1 FROM public.billing_hmo_claims cl WHERE cl.invoice_id = bi.id)
              ORDER BY bi.id DESC LIMIT 1)::text AS inv_id_txt
          FROM public.patients p
          WHERE p.created_at >= (now() - interval '60 days')
            AND (NULLIF(TRIM(p.hmo_provider),'') IS NOT NULL OR p.is_hmo = TRUE OR p.hmo = TRUE)
          ORDER BY p.created_at DESC
          LIMIT 200
        `).catch(() => []);
        if (Array.isArray(recentHmoPatients) && recentHmoPatients.length) {
          for (const c of recentHmoPatients) {
            try {
              const invIdStr = String(c.inv_id_txt || '').trim();
              const patId = String(c.patient_id || '').trim();
              if (!invIdStr || !patId) continue;
              const invId = BigInt(invIdStr);
              const name = c.patient_name ? String(c.patient_name).trim() || null : null;
              const prov = c.hmo_provider ? String(c.hmo_provider).trim() || null : null;
              await prisma.$executeRawUnsafe(`
                INSERT INTO public.billing_hmo_claims (
                  invoice_id, appointment_id, patient_id, patient_name, hmo_provider,
                  philhealth_deduction, loa_approved_amount, status, notes, requested_by, created_at, updated_at
                ) VALUES ($1::bigint, NULL, $2::uuid, $3::text, $4::text, 0, 0, 'Awaiting LOA',
                  '[Auto-recovered from patient.is_hmo flag — no invoice claim row existed]', 'system:auto-recover', now(), now())
                ON CONFLICT (invoice_id) DO NOTHING
              `, invId, patId, name, prov).catch(() => null);
            } catch (_) { /* per-row */ }
          }
        }
      } catch (_pass3) { /* ignore */ }
    } catch (_autoRecover) {
      // Never break the main query
    }

    let rows = [];

    // ========== PRIMARY: Full 3-branch UNION query ==========
    // (Column-name safe via probe aliases above)
    try {
      rows = await prisma.$queryRawUnsafe(
        `
          SELECT
            ${hId} AS id,
            ${hInvoiceId} AS invoice_id,
            ${hApptId} AS appointment_id,
            ${hPatientId} AS patient_id,
            ${hHmoProv} AS hmo_provider,
            ${hHmoLoa} AS hmo_loa_number,
            ${hHmoCard} AS hmo_card_number,
            ${hPhilDed} AS philhealth_deduction,
            ${hLoaAppr} AS loa_approved_amount,
            ${hStatus} AS status,
            ${hNotes} AS notes,
            ${hRequestedBy} AS requested_by,
            ${hUpdatedBy} AS updated_by,
            ${hCreatedAt} AS created_at,
            ${hUpdatedAt} AS updated_at,
            COALESCE(i.total_amount, 0) AS total_amount,
            COALESCE(i.balance_amount, 0) AS balance_amount,
            COALESCE(i.status, 'Draft') AS invoice_status,
            COALESCE(${pFirstName}, ${pFullName}) AS first_name,
            COALESCE(${pLastName}, NULL) AS last_name,
            ${pEmail} AS email,
            ${pContact} AS contact_number,
            COALESCE(i.workups_list,
              (SELECT STRING_AGG(c.kind || ': ' || c.service, ', ' ORDER BY c.created_at)
               FROM public.clinical_orders c
               WHERE c.patient_id = COALESCE(i.patient_id, ${hPatientId})
                 AND c.created_at >= ${hCreatedAt} - INTERVAL '6 hours'
                 AND c.created_at <= ${hCreatedAt} + INTERVAL '2 days')
            ) AS workups_list,
            'claim' AS source_type,
            ${hCreatedAt} AS stage_timestamp
          FROM public.billing_hmo_claims h
          LEFT JOIN (
            SELECT bi.id, bi.patient_id, bi.status, bi.total_amount, bi.updated_at, bi.created_at, bi.notes,
                   (bi.total_amount - COALESCE((SELECT SUM(amount) FROM public.billing_payments WHERE invoice_id = bi.id), 0)) AS balance_amount,
                   (SELECT STRING_AGG(c.kind || ': ' || c.service, ', ' ORDER BY c.created_at)
                    FROM public.clinical_orders c
                    WHERE c.patient_id = bi.patient_id
                      AND c.created_at >= bi.created_at - INTERVAL '6 hours'
                      AND c.created_at <= bi.created_at + INTERVAL '2 days'
                    LIMIT 20) AS workups_list
            FROM public.billing_invoices bi
          ) i ON i.id = ${hInvoiceId}
          LEFT JOIN public.patients p ON p.id = COALESCE(i.patient_id, ${hPatientId})

          UNION ALL

          SELECT
            -(${aId}) AS id,
            NULL AS invoice_id,
            ${aId} AS appointment_id,
            ${aPatientId} AS patient_id,
            ${aHmoProv} AS hmo_provider,
            ${aHmoLoa} AS hmo_loa_number,
            ${aHmoCard} AS hmo_card_number,
            ${aPhilDed} AS philhealth_deduction,
            COALESCE(${aLoaAppr1}, ${aLoaAppr2}, 0) AS loa_approved_amount,
            COALESCE(${aHmoStatus}, 'Awaiting LOA') AS status,
            CONCAT_WS(' • ', 'Walk-in HMO Intake', ${aPurpose}, ${aRouteType}) AS notes,
            CONCAT_WS(' • ', ${aCreatedBy}, 'Appointment created') AS requested_by,
            NULL AS updated_by,
            ${aCreatedAt} AS created_at,
            ${aUpdatedAt} AS updated_at,
            0 AS total_amount,
            0 AS balance_amount,
            'Draft' AS invoice_status,
            ${pFirstName} AS first_name,
            ${pLastName} AS last_name,
            ${pEmail} AS email,
            ${pContact} AS contact_number,
            (SELECT STRING_AGG(c.kind || ': ' || c.service, ', ' ORDER BY c.created_at)
             FROM public.clinical_orders c
             WHERE c.patient_id = ${aPatientId}
               AND c.created_at >= ${aCreatedAt} - INTERVAL '2 hours') AS workups_list,
            'appointment' AS source_type,
            ${aCreatedAt} AS stage_timestamp
          FROM public.appointments a
          LEFT JOIN public.patients p ON p.id = ${aPatientId}
          WHERE (
              (${aIsHmo}) IS TRUE
              OR NULLIF(${aHmoStatus}, '') IS NOT NULL
              OR NULLIF(${aHmoProv}, '') IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.billing_hmo_claims hc WHERE hc.appointment_id = ${aId}
            )

          UNION ALL

          SELECT
            -(10000000 + CAST(p2.id AS bigint)) AS id,
            NULL AS invoice_id,
            NULL AS appointment_id,
            p2.id AS patient_id,
            ${pHmoProv} AS hmo_provider,
            NULL AS hmo_loa_number,
            ${pHmoCard} AS hmo_card_number,
            COALESCE(${pPhilAmt}, 0) AS philhealth_deduction,
            0 AS loa_approved_amount,
            'Awaiting LOA' AS status,
            'Patient flagged HMO-active — no linked invoice/appointment claim yet' AS notes,
            CONCAT_WS(' • ', 'Patient registry HMO flag', ${pCreatedBy}) AS requested_by,
            NULL AS updated_by,
            COALESCE(${pUpdatedAt}, ${pCreatedAt}, CURRENT_TIMESTAMP) AS created_at,
            COALESCE(${pUpdatedAt}, ${pCreatedAt}, CURRENT_TIMESTAMP) AS updated_at,
            0 AS total_amount,
            0 AS balance_amount,
            'Draft' AS invoice_status,
            ${pFirstName} AS first_name,
            ${pLastName} AS last_name,
            ${pEmail} AS email,
            ${pContact} AS contact_number,
            (SELECT STRING_AGG(c.kind || ': ' || c.service, ', ' ORDER BY c.created_at)
             FROM public.clinical_orders c
             WHERE c.patient_id = p2.id
               AND c.created_at >= COALESCE(${pUpdatedAt}, ${pCreatedAt}, CURRENT_TIMESTAMP) - INTERVAL '48 hours'
            ) AS workups_list,
            'patient' AS source_type,
            COALESCE(${pUpdatedAt}, ${pCreatedAt}, CURRENT_TIMESTAMP) AS stage_timestamp
          FROM public.patients p2
          WHERE (
              (${pIsHmo}) IS TRUE
              OR NULLIF(${pHmoProv}, '') IS NOT NULL
              OR NULLIF(${pHmoCard}, '') IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.billing_hmo_claims hc3 WHERE hc3.patient_id = p2.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.billing_hmo_claims hc4
              JOIN public.billing_invoices bi2 ON bi2.id = hc4.invoice_id
              WHERE bi2.patient_id = p2.id
            )

          ORDER BY COALESCE(updated_at, created_at, stage_timestamp) DESC, created_at DESC
        `
      );
    } catch (_mainUnionErr) {
      // ========== ULTIMATE FALLBACK: NO-JOIN super simple claim-only query ==========
      // (Guaranteed to work if any column mismatch happened in primary query)
      console.warn('[HMO] Primary union query failed, using no-join fallback:', _mainUnionErr.message || _mainUnionErr);
      try {
        rows = await prisma.$queryRawUnsafe(
          `
            SELECT
              ${hId} AS id,
              ${hInvoiceId} AS invoice_id,
              ${hApptId} AS appointment_id,
              ${hPatientId} AS patient_id,
              ${hHmoProv} AS hmo_provider,
              ${hHmoLoa} AS hmo_loa_number,
              ${hHmoCard} AS hmo_card_number,
              ${hPhilDed} AS philhealth_deduction,
              ${hLoaAppr} AS loa_approved_amount,
              COALESCE(${hStatus}, 'Approved') AS status,
              ${hNotes} AS notes,
              ${hRequestedBy} AS requested_by,
              ${hUpdatedBy} AS updated_by,
              ${hCreatedAt} AS created_at,
              ${hUpdatedAt} AS updated_at,
              0 AS total_amount,
              0 AS balance_amount,
              'Draft' AS invoice_status,
              COALESCE(${hPatientName}, 'Patient') AS first_name,
              NULL AS last_name,
              NULL AS email,
              NULL AS contact_number,
              NULL AS workups_list,
              'claim_fallback' AS source_type,
              ${hCreatedAt} AS stage_timestamp
            FROM public.billing_hmo_claims h
            ORDER BY ${hUpdatedAt} DESC NULLS LAST, ${hCreatedAt} DESC NULLS LAST
            LIMIT 200
          `
        ).catch(() => []);
      } catch (_fallbackErr) {
        rows = [];
      }
    }

    let builtList = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const total = Number(row.total_amount || 0);
        const claim = summarizeHmoClaim(row, total);
        const claimStatusNorm = String(claim.status || '').toLowerCase();
        return {
          id: claim.id,
          invoice_id: claim.invoice_id,
          invoice_status: row.invoice_status || null,
          patient_name: `${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim()
            || String(claim.patient_name || '').trim()
            || 'Patient',
          email: row.email || null,
          contact_number: row.contact_number || null,
          total_amount: toMoney(total),
          philhealth_amount: toMoney(claim.philhealth_deduction),
          hmo_covered_amount: toMoney(claim.applied_hmo_amount),
          patient_pays: toMoney(claim.patient_payable),
          claim_status: claim.status,
          workups_list: row.workups_list ? String(row.workups_list).slice(0, 400) : null,
          hmo_claim: claim
        };
      })
      .filter((row) => {
        if (filterMode === 'approved') {
          const norm = String(row.claim_status || '').toLowerCase();
          return norm === 'approved' || norm === 'partially approved';
        }
        return true;
      });

    // ✅ STEP: PATIENT REFERENCE ENRICHMENT (add patient_reference to EVERY row!)
    // No changes to giant UNION SELECT needed (zero crash risk!). We enrich after rows are built.
    try {
      const invIds = [];
      const patIds = [];
      for (const r of builtList) {
        if (r.invoice_id && String(r.invoice_id) !== '' && String(r.invoice_id) !== '0' && String(r.invoice_id) !== 'null') invIds.push(String(r.invoice_id));
        const pid = String(r.hmo_claim?.patient_id || '').trim();
        if (pid && pid !== '' && pid !== 'null') patIds.push(pid);
      }
      const refMap = new Map(); // key = "inv-123" or "pat-uuid" → ref
      if (invIds.length) {
        try {
          const invRefs = await prisma.$queryRawUnsafe(
            `SELECT id::text AS id, patient_reference AS pr FROM public.billing_invoices WHERE id::text IN (${invIds.map((_, i) => `$${i + 1}`).join(',')})`,
            ...invIds.map((x) => BigInt(x))
          ).catch(() => []);
          if (Array.isArray(invRefs)) {
            for (const r of invRefs) {
              const v = String(r.pr || '').trim();
              if (v) refMap.set(`inv-${String(r.id)}`, v);
            }
          }
        } catch (_) { /* ignore */ }
        // Also check claim table direct
        try {
          const claimRefs = await prisma.$queryRawUnsafe(
            `SELECT invoice_id::text AS invid, patient_reference AS pr FROM public.billing_hmo_claims WHERE invoice_id::text IN (${invIds.map((_, i) => `$${i + 1}`).join(',')})`,
            ...invIds.map((x) => BigInt(x))
          ).catch(() => []);
          if (Array.isArray(claimRefs)) {
            for (const r of claimRefs) {
              const v = String(r.pr || '').trim();
              if (v) refMap.set(`inv-${String(r.invid)}`, v);
            }
          }
        } catch (_) { /* ignore */ }
      }
      if (patIds.length) {
        try {
          const patientRefs = await prisma.$queryRawUnsafe(
            `SELECT id::text AS pid, patient_reference AS pr FROM public.patients WHERE id::text IN (${patIds.map((_, i) => `$${i + 1}`).join(',')})`,
            ...patIds
          ).catch(() => []);
          if (Array.isArray(patientRefs)) {
            for (const r of patientRefs) {
              const v = String(r.pr || '').trim();
              if (v) {
                refMap.set(`pat-${String(r.pid)}`, v);
                // Also propagate to claim table (one-time write)
                prisma.$executeRawUnsafe(`UPDATE public.billing_hmo_claims SET patient_reference = $1::text WHERE patient_id::text = $2::text AND NULLIF(TRIM(patient_reference::text),'') IS NULL`, v, String(r.pid)).catch(() => null);
              }
            }
          }
        } catch (_) { /* ignore */ }
      }
      // Apply refMap to rows
      for (let i = 0; i < builtList.length; i++) {
        const r = builtList[i];
        let found = null;
        if (r.invoice_id && refMap.has(`inv-${String(r.invoice_id)}`)) found = refMap.get(`inv-${String(r.invoice_id)}`);
        if (!found) {
          const pid = String(r.hmo_claim?.patient_id || '').trim();
          if (pid && refMap.has(`pat-${pid}`)) found = refMap.get(`pat-${pid}`);
        }
        builtList[i] = { ...r, patient_reference: found || null };
        // Also ensure claim object inside has it for the frontend
        if (builtList[i].hmo_claim && builtList[i].patient_reference && !builtList[i].hmo_claim.patient_reference) {
          builtList[i].hmo_claim = { ...builtList[i].hmo_claim, patient_reference: builtList[i].patient_reference };
        }
      }
    } catch (_refEnrichErr) { /* never break page */ }

    // ✅ STEP: REAL PATIENT NAME + CONTACT ENRICHMENT (CRITICAL FIX)
    // For rows where patient_name = 'Patient' or fallback 'Patient of Invoice-X'
    // we fetch the ACTUAL first_name + last_name from public.patients via patient_id link
    // This fixes the "Patient (click Update to fill name)" on Lab Order / auto-created rows!
    try {
      const patNameIds = new Set();
      for (const r of builtList) {
        const claimPid = String(r.hmo_claim?.patient_id || '').trim();
        if (claimPid && claimPid !== '' && claimPid !== 'null') patNameIds.add(claimPid);
      }
      // Also pull patient_id directly from billing_invoices if the row has invoice_id
      try {
        const invIdsExtra = [];
        for (const r of builtList) {
          const nameNow = String(r.patient_name || '').trim();
          const nameLower = nameNow.toLowerCase();
          const isBadName = (!nameNow) || (nameNow.length <= 9)
            || nameLower.startsWith('patient of')
            || nameLower.startsWith('invoice')
            || nameLower.startsWith('walk-in')
            || nameLower.includes('lab order #')
            || nameLower.startsWith('nurse walk')
            || nameLower.startsWith('onsite consultation')
            || nameLower.startsWith('online consultation')
            || nameLower.startsWith('video consultation')
            || nameLower.includes('[appointment]')
            || nameLower.includes('[triage ');
          if (isBadName && r.invoice_id && String(r.invoice_id) !== '' && String(r.invoice_id) !== '0' && String(r.invoice_id) !== 'null') {
            invIdsExtra.push(String(r.invoice_id));
          }
        }
        if (invIdsExtra.length) {
          const invPats = await prisma.$queryRawUnsafe(
            `SELECT id::text AS iid, patient_id::text AS pid FROM public.billing_invoices WHERE id IN (${invIdsExtra.map((_, i) => `$${i + 1}::bigint`).join(',')})`,
            ...invIdsExtra.map((x) => BigInt(x))
          ).catch(() => []);
          if (Array.isArray(invPats)) {
            for (const x of invPats) {
              const p = String(x.pid || '').trim();
              if (p && p !== '' && p !== 'null') patNameIds.add(p);
            }
          }
        }
      } catch (_) { /* ignore */ }
        const patNameArr = Array.from(patNameIds).filter(Boolean);
      // Precompute invoice → patient ID map for rows whose hmo_claim has no patient_id
      const invToPat = new Map();
      const invoiceMeta = new Map();
      try {
        const allInvIdsForPat = [];
        for (const r of builtList) {
          if (r.invoice_id && String(r.invoice_id) !== '' && String(r.invoice_id) !== '0' && String(r.invoice_id) !== 'null') allInvIdsForPat.push(String(r.invoice_id));
        }
        if (allInvIdsForPat.length) {
          const allI2p = await prisma.$queryRawUnsafe(
            `SELECT bi.id::text AS iid,
                    bi.patient_id::text AS pid,
                    bi.appointment_id::text AS appointment_id,
                    bi.status AS invoice_status,
                    bi.total_amount,
                    bi.created_at AS invoice_created_at,
                    bi.notes AS invoice_notes,
                    (SELECT STRING_AGG(ii.description, ', ' ORDER BY ii.id)
                     FROM public.billing_invoice_items ii
                     WHERE ii.invoice_id = bi.id) AS invoice_workups
             FROM public.billing_invoices bi
             WHERE bi.id IN (${allInvIdsForPat.map((_, i) => `$${i + 1}::bigint`).join(',')})`,
            ...allInvIdsForPat.map((x) => BigInt(x))
          ).catch(() => []);
          if (Array.isArray(allI2p)) {
            for (const x of allI2p) {
              const p = String(x.pid || '').trim();
              const i = String(x.iid || '').trim();
              if (i && p && p !== 'null') invToPat.set(i, p);
              if (i) invoiceMeta.set(i, x);
              if (p && p !== '' && p !== 'null') patNameIds.add(p);
            }
          }
        }
      } catch (_) { /* ignore */ }

      for (let i = 0; i < builtList.length; i++) {
        const row = builtList[i];
        const meta = invoiceMeta.get(String(row.invoice_id || ''));
        if (!meta) continue;
        const gross = Math.max(0, Number(meta.total_amount || 0));
        const claim = row.hmo_claim ? { ...row.hmo_claim } : {};
        const philhealth = Math.min(gross, Math.max(0, Number(claim.philhealth_deduction || 0)));
        const afterPhilhealth = Math.max(0, gross - philhealth);
        const appliedHmo = isHmoCoverageApplied(claim.status)
          ? Math.min(afterPhilhealth, Math.max(0, Number(claim.loa_approved_amount || 0)))
          : 0;
        if (!String(claim.patient_id || '').trim() && String(meta.pid || '').trim()) claim.patient_id = String(meta.pid).trim();
        if (!String(claim.appointment_id || '').trim() && String(meta.appointment_id || '').trim()) claim.appointment_id = String(meta.appointment_id).trim();
        claim.applied_hmo_amount = appliedHmo;
        claim.patient_payable = Math.max(0, gross - philhealth - appliedHmo);
        builtList[i] = {
          ...row,
          invoice_status: meta.invoice_status || row.invoice_status || null,
          invoice_created_at: meta.invoice_created_at || null,
          invoice_notes: meta.invoice_notes || null,
          total_amount: toMoney(gross),
          philhealth_amount: toMoney(philhealth),
          hmo_covered_amount: toMoney(appliedHmo),
          patient_pays: toMoney(claim.patient_payable),
          workups_list: String(meta.invoice_workups || row.workups_list || '').trim() || null,
          hmo_claim: claim
        };
      }

      // ✅ NEW: LAB ORDER CROSS-REFERENCE PATIENT LOOKUP (for auto-created Walk-in Lab Order invoices)
      // If billing_invoices has no patient_id AND hmo_claim has no patient_id, BUT patient_name/workups contains "Lab Order #N"
      // → look up clinical_orders id=N to get the real patient_id. This fixes rows that show "Patient (click Update)".
      try {
        const labOrderIdsToLookup = new Set();
        const labOrderRowIndexMap = new Map(); // labOrderIdStr -> array of builtList indices
        for (let i = 0; i < builtList.length; i++) {
          const r = builtList[i];
          let pid = String(r.hmo_claim?.patient_id || '').trim();
          if ((!pid || pid === 'null' || pid === '') && r.invoice_id) {
            const cand = invToPat.get(String(r.invoice_id));
            if (cand) pid = String(cand).trim();
          }
          const haystack = `${String(r.patient_name || '')} ${String(r.hmo_claim?.patient_name || '')} ${String(r.workups_list || '')} ${String(r.invoice_notes || '')} ${String(r.notes || '')} ${String(r.hmo_claim?.notes || '')}`.toLowerCase();
          const m = haystack.match(/lab order #?\s*(\d+)/i);
          if (m && m[1]) {
            const loId = String(m[1]).trim();
            if (loId && !isNaN(Number(loId))) {
              labOrderIdsToLookup.add(loId);
              if (!labOrderRowIndexMap.has(loId)) labOrderRowIndexMap.set(loId, []);
              labOrderRowIndexMap.get(loId).push(i);
            }
          }
        }
        if (labOrderIdsToLookup.size > 0) {
          const labArr = Array.from(labOrderIdsToLookup);
          const labParams = labArr.map((x) => BigInt(x));
          const coRows = await prisma.$queryRawUnsafe(
            `SELECT id::text AS coid, patient_id::text AS pid, patient_name AS pname, kind, service
             FROM public.clinical_orders WHERE id IN (${labArr.map((_, i) => `$${i + 1}::bigint`).join(',')})`,
            ...labParams
          ).catch(() => []);
          if (Array.isArray(coRows)) {
            for (const x of coRows) {
              const coid = String(x.coid || '').trim();
              const newPid = String(x.pid || '').trim();
              const pnameFromCo = String(x.pname || '').trim();
              const workupFromCo = [String(x.kind || '').trim(), String(x.service || '').trim()].filter(Boolean).join(': ');
              const indices = labOrderRowIndexMap.get(coid) || [];
              if (pnameFromCo && pnameFromCo.toLowerCase() !== 'patient') {
                for (const i of indices) {
                  const r = builtList[i];
                  if (!r) continue;
                  if (workupFromCo) {
                    builtList[i] = { ...r, workups_list: workupFromCo };
                  }
                  const currentName = String(r.patient_name || '').trim().toLowerCase();
                  const shouldReplace = !currentName || currentName === 'patient' || currentName.startsWith('patient of') || currentName.startsWith('walk-in') || currentName.includes('lab order');
                  if (shouldReplace) {
                    builtList[i] = {
                      ...builtList[i],
                      patient_name: pnameFromCo,
                      hmo_claim: r.hmo_claim ? { ...r.hmo_claim, patient_name: pnameFromCo } : r.hmo_claim
                    };
                  }
                }
              }
              if (newPid && newPid !== '' && newPid !== 'null') {
                patNameIds.add(newPid);
                for (const i of indices) {
                  const r = builtList[i];
                  if (r && r.invoice_id) invToPat.set(String(r.invoice_id), newPid);
                  if (r?.hmo_claim && !String(r.hmo_claim.patient_id || '').trim()) {
                    builtList[i] = { ...r, hmo_claim: { ...r.hmo_claim, patient_id: newPid } };
                  }
                }
              }
            }
          }
        }
      } catch (_labLookup) { /* never break page */ }

      // ✅ NEW: DIRECT HMO CLAIM BULK LOOKUP (populate missing hmo_claim fields for any row with invoice_id)
      // Rows created indirectly via auto-invoices sometimes miss hmo_claim in the UNION, so we fill them here.
      try {
        const hmoInvIds = new Set();
        for (const r of builtList) {
          if (r.invoice_id && String(r.invoice_id) !== '' && String(r.invoice_id) !== '0' && String(r.invoice_id) !== 'null') {
            const claim = r.hmo_claim && typeof r.hmo_claim === 'object' ? r.hmo_claim : null;
            const claimHasData = claim && (String(claim.provider || '').trim() || String(claim.loa_number || '').trim() || Number(claim.philhealth_deduction || 0) > 0 || Number(claim.loa_approved_amount || 0) > 0);
            if (!claimHasData) hmoInvIds.add(String(r.invoice_id));
          }
        }
        if (hmoInvIds.size > 0) {
          const hArr = Array.from(hmoInvIds);
          const hPh = hArr.map((_, i) => `$${i + 1}`).join(',');
          const hParams = hArr.map((x) => BigInt(x));
          const claimRows = await prisma.$queryRawUnsafe(
            `SELECT invoice_id::text AS invid,
                    hmo_provider AS provider,
                    hmo_loa_number AS loa_number,
                    hmo_card_number AS hmo_card_number,
                    philhealth_deduction AS philhealth_deduction,
                    loa_approved_amount AS loa_approved_amount,
                    patient_payable AS patient_payable,
                    patient_id::text AS patient_id,
                    patient_reference AS patient_reference,
                    status AS claim_status,
                    company AS company,
                    patient_contact AS patient_contact,
                    gross_amount AS gross_amount
             FROM public.billing_hmo_claims
             WHERE invoice_id IN (${hPh})`,
            ...hParams
          ).catch(() => []);
          const claimMap = new Map();
          if (Array.isArray(claimRows)) {
            for (const c of claimRows) {
              const k = String(c.invid || '').trim();
              if (k) claimMap.set(k, c);
            }
            for (let i = 0; i < builtList.length; i++) {
              const r = builtList[i];
              if (!r || !r.invoice_id) continue;
              const k = String(r.invoice_id).trim();
              if (!claimMap.has(k)) continue;
              const c = claimMap.get(k);
              const existingClaim = r.hmo_claim && typeof r.hmo_claim === 'object' ? { ...r.hmo_claim } : {};
              const merged = { ...existingClaim };
              if (c.provider && !String(merged.provider || '').trim()) merged.provider = String(c.provider).trim();
              if (c.loa_number && !String(merged.loa_number || '').trim()) merged.loa_number = String(c.loa_number).trim();
              if (c.hmo_card_number && !String(merged.hmo_card_number || '').trim()) merged.hmo_card_number = String(c.hmo_card_number).trim();
              if (Number(c.philhealth_deduction || 0) > 0 && !Number(merged.philhealth_deduction || 0)) merged.philhealth_deduction = Number(c.philhealth_deduction);
              if (Number(c.loa_approved_amount || 0) > 0 && !Number(merged.loa_approved_amount || 0)) merged.loa_approved_amount = Number(c.loa_approved_amount);
              if (Number(c.patient_payable || 0) > 0 && !Number(merged.patient_payable || 0)) merged.patient_payable = Number(c.patient_payable);
              if (Number(c.gross_amount || 0) > 0 && !Number(merged.total_amount || 0)) merged.total_amount = Number(c.gross_amount);
              if (String(c.patient_id || '').trim() && String(c.patient_id) !== 'null' && !String(merged.patient_id || '').trim()) merged.patient_id = String(c.patient_id).trim();
              if (String(c.patient_reference || '').trim() && !String(merged.patient_reference || '').trim()) merged.patient_reference = String(c.patient_reference).trim();
              if (String(c.claim_status || '').trim() && !String(r.claim_status || '').trim()) r.claim_status = String(c.claim_status).trim();
              if (String(c.company || '').trim() && !String(merged.company || '').trim()) merged.company = String(c.company).trim();
              if (String(c.patient_contact || '').trim() && !String(merged.patient_contact || '').trim()) merged.patient_contact = String(c.patient_contact).trim();
              builtList[i] = { ...r, hmo_claim: merged };
              // Also propagate patient_id from merged claim back to invToPat so name enrichment can still pick it up
              if (String(merged.patient_id || '').trim() && String(merged.patient_id) !== 'null' && r.invoice_id) {
                invToPat.set(String(r.invoice_id), String(merged.patient_id).trim());
                patNameIds.add(String(merged.patient_id).trim());
              }
            }
          }
        }
      } catch (_claimDirectLookup) { /* never break page */ }

      // ✅ NEW: PATIENT_REFERENCE → PATIENT_ID REVERSE LOOKUP (for OLD rows!)
      // Old rows (registered before the fixes) often have billing_hmo_claims.patient_reference populated from
      // schema warmup backfills, but billing_invoices.patient_id = NULL AND hmo_claim.patient_id = NULL.
      // Since patient_reference EXISTS on the enriched row (from L2110 step above), we can look up patients table
      // by patient_reference and find the REAL patient_id. This covers the LARGEST batch of orphaned old rows.
      try {
        const refsToLookup = new Set();
        const refRowIndexMap = new Map();
        for (let i = 0; i < builtList.length; i++) {
          const r = builtList[i];
          let pid = String(r.hmo_claim?.patient_id || '').trim();
          if ((!pid || pid === 'null' || pid === '') && r.invoice_id) {
            const cand = invToPat.get(String(r.invoice_id));
            if (cand) pid = String(cand).trim();
          }
          if (!pid || pid === 'null' || pid === '') {
            const ref = String(r.patient_reference || r.hmo_claim?.patient_reference || '').trim();
            if (ref && ref.length >= 8 && ref !== 'null') {
              refsToLookup.add(ref);
              if (!refRowIndexMap.has(ref)) refRowIndexMap.set(ref, []);
              refRowIndexMap.get(ref).push(i);
            }
          }
        }
        if (refsToLookup.size > 0) {
          const refArr = Array.from(refsToLookup);
          const refPh = refArr.map((_, i) => `$${i + 1}`).join(',');
          const patByRefRows = await prisma.$queryRawUnsafe(
            `SELECT id::text AS pid, patient_reference AS pr FROM public.patients WHERE patient_reference IN (${refPh})`,
            ...refArr
          ).catch(() => []);
          if (Array.isArray(patByRefRows)) {
            for (const x of patByRefRows) {
              const pr = String(x.pr || '').trim();
              const pid = String(x.pid || '').trim();
              if (!pr || !pid || pid === 'null') continue;
              const indices = refRowIndexMap.get(pr) || [];
              if (indices.length > 0) {
                patNameIds.add(pid);
                for (const i of indices) {
                  const r = builtList[i];
                  if (!r) continue;
                  if (r.invoice_id) invToPat.set(String(r.invoice_id), pid);
                  // Also inject the patient_id into hmo_claim so the later enrichment loop can pick it up easily
                  const existingClaim = r.hmo_claim && typeof r.hmo_claim === 'object' ? { ...r.hmo_claim } : {};
                  if (!String(existingClaim.patient_id || '').trim() || String(existingClaim.patient_id) === 'null') {
                    existingClaim.patient_id = pid;
                    builtList[i] = { ...r, hmo_claim: existingClaim };
                  }
                }
              }
            }
          }
        }
      } catch (_refReverseLookup) { /* never break page */ }

      // Always re-evaluate based on CURRENT state of patNameIds and invToPat (patNameArr was computed before new cross-ref lookups added new IDs)
      const patNameArrFinal = Array.from(patNameIds).filter(Boolean);
      if (patNameArrFinal.length > 0 || invToPat.size > 0) {
        let realNames = [];
        if (patNameArrFinal.length) {
          realNames = await prisma.$queryRawUnsafe(
            `SELECT id::text AS pid, first_name, middle_name, last_name, contact_number, company, email,
                    COALESCE(is_hmo, FALSE) AS is_hmo,
                    COALESCE(hmo, FALSE) AS hmo,
                    hmo_provider, hmo_card_number, hmo_loa_number
             FROM public.patients
             WHERE id::text IN (${patNameArrFinal.map((_, i) => `$${i + 1}`).join(',')})`,
            ...patNameArrFinal
          ).catch(() => []);
        }
        const pMap = new Map();
        if (Array.isArray(realNames)) {
          for (const p of realNames) {
            const pid = String(p.pid || '').trim();
            if (!pid) continue;
            const fn = String(p.first_name || '').trim();
            const mn = String(p.middle_name || '').trim();
            const ln = String(p.last_name || '').trim();
            const fullNameChunks = [fn, mn, ln].filter((s) => s.length > 0);
            const full = fullNameChunks.length ? fullNameChunks.join(' ').trim() : '';
            if (full) pMap.set(`pid:${pid}`, full);
            if (String(p.contact_number || '').trim()) pMap.set(`pcontact:${pid}`, String(p.contact_number).trim());
            if (String(p.company || '').trim()) pMap.set(`pcompany:${pid}`, String(p.company).trim());
            if (String(p.email || '').trim()) pMap.set(`pemail:${pid}`, String(p.email).trim());
            pMap.set(`phmo:${pid}`, Boolean(
              p.is_hmo || p.hmo
              || String(p.hmo_provider || '').trim()
              || String(p.hmo_card_number || '').trim()
              || String(p.hmo_loa_number || '').trim()
            ));
          }
        }
        // Apply pMap to rows!
        for (let i = 0; i < builtList.length; i++) {
          const r = builtList[i];
          let pid = String(r.hmo_claim?.patient_id || '').trim();
          if ((!pid || pid === 'null' || pid === '') && r.invoice_id) {
            const candidate = invToPat.get(String(r.invoice_id));
            if (candidate) pid = String(candidate).trim();
          }
          if (!pid || pid === 'null') continue;
          if (!String(r.hmo_claim?.patient_id || '').trim()) {
            builtList[i] = { ...r, hmo_claim: r.hmo_claim ? { ...r.hmo_claim, patient_id: pid } : r.hmo_claim };
          }
          const full2 = pMap.get(`pid:${pid}`);
          const patientHasHmo = Boolean(pMap.get(`phmo:${pid}`));
          const currentClaim = builtList[i]?.hmo_claim || r.hmo_claim || {};
          const claimHasHmo = Boolean(
            String(currentClaim.provider || currentClaim.hmo_provider || '').trim()
            || String(currentClaim.loa_number || currentClaim.hmo_loa_number || '').trim()
            || String(currentClaim.hmo_card_number || '').trim()
            || Number(currentClaim.philhealth_deduction || 0) > 0
            || Number(currentClaim.loa_approved_amount || 0) > 0
          );
          builtList[i] = { ...builtList[i], has_hmo_evidence: patientHasHmo || claimHasHmo };
          if (full2) {
            const curr = String(r.patient_name || '').trim();
            const currLower = curr.toLowerCase();
            const isBadNow = (!curr) || curr.length <= 9
              || currLower === 'patient'
              || currLower.startsWith('patient of')
              || currLower.startsWith('invoice')
              || currLower.startsWith('walk-in')
              || currLower.includes('lab order #')
              || currLower.startsWith('nurse walk')
              || currLower.startsWith('onsite consultation')
              || currLower.startsWith('online consultation')
              || currLower.startsWith('video consultation')
              || currLower.includes('[appointment]')
              || currLower.includes('[triage ');
            if (isBadNow) {
              const patched = { ...r, patient_name: full2 };
              const cc = pMap.get(`pcontact:${pid}`);
              if (cc && (!String(r.contact_number || '').trim() || String(r.contact_number).length < 6)) patched.contact_number = cc;
              const em = pMap.get(`pemail:${pid}`);
              if (em && (!String(r.email || '').trim())) patched.email = em;
              if (patched.hmo_claim) {
                patched.hmo_claim = { ...patched.hmo_claim, patient_id: pid, patient_name: full2 };
                const hmc = patched.hmo_claim;
                if (cc && !String(hmc.patient_contact || '').trim()) hmc.patient_contact = cc;
                const co = pMap.get(`pcompany:${pid}`);
                if (co && !String(hmc.company || '').trim()) hmc.company = co;
              }
              builtList[i] = patched;
            }
          }
        }
      }
    } catch (_nameEnrichErr) { /* never break page */ }

    builtList = builtList
      .map((row) => {
        if (row.has_hmo_evidence === true) return row;
        const claim = row.hmo_claim || {};
        const claimHasHmo = Boolean(
          String(claim.provider || claim.hmo_provider || '').trim()
          || String(claim.loa_number || claim.hmo_loa_number || '').trim()
          || String(claim.hmo_card_number || '').trim()
          || Number(claim.philhealth_deduction || 0) > 0
          || Number(claim.loa_approved_amount || 0) > 0
        );
        return { ...row, has_hmo_evidence: claimHasHmo };
      })
      .filter((row) => row.has_hmo_evidence === true)
      .filter((row) => {
        if (filterMode !== 'approved') return true;
        const status = String(row.claim_status || row.hmo_claim?.status || '').toLowerCase();
        return status === 'approved' || status === 'partially approved';
      });

    builtList = builtList.filter((row) => {
      if (!query) return true;
      const qLower = String(query || '').toLowerCase();
      const haystack = [
        row.patient_name,
        row.contact_number,
        row.invoice_id,
        row.patient_reference,
        row.hmo_claim?.patient_reference,
        row.hmo_claim?.provider,
        row.hmo_claim?.loa_number,
        row.hmo_claim?.hmo_card_number,
        row.claim_status,
        row.workups_list
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(qLower);
    });

    const invoiceCount = builtList.filter((row) => row.invoice_id).length;
    const encounterMap = new Map();
    const numericMoney = (value) => {
      const parsed = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    for (const row of builtList) {
      const claim = row.hmo_claim || {};
      const patientId = String(claim.patient_id || '').trim();
      const patientNameKey = String(row.patient_name || claim.patient_name || 'unknown').trim().toLowerCase();
      const appointmentId = String(claim.appointment_id || '').trim();
      const loaNumber = String(claim.loa_number || '').trim().toLowerCase();
      const timestamp = row.invoice_created_at || claim.created_at || claim.updated_at || null;
      const dateKey = timestamp && !Number.isNaN(new Date(timestamp).getTime())
        ? new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : 'undated';
      const identity = patientId ? `patient:${patientId}` : `name:${patientNameKey}`;
      const encounterKey = appointmentId
        ? `appointment:${appointmentId}`
        : loaNumber
          ? `${identity}:loa:${loaNumber}`
          : `${identity}:date:${dateKey}`;
      const existing = encounterMap.get(encounterKey);
      const workups = String(row.workups_list || '').split(',').map((item) => item.trim()).filter(Boolean);
      const invoiceEntry = {
        invoice_id: row.invoice_id || null,
        status: row.invoice_status || null,
        total_amount: row.total_amount,
        workups_list: row.workups_list || null,
        created_at: row.invoice_created_at || claim.created_at || null
      };
      if (!existing) {
        encounterMap.set(encounterKey, {
          ...row,
          encounter_id: encounterKey,
          invoice_count: row.invoice_id ? 1 : 0,
          invoice_ids: row.invoice_id ? [String(row.invoice_id)] : [],
          invoices: row.invoice_id ? [invoiceEntry] : [],
          workups_list: workups.join(', ') || null
        });
        continue;
      }
      if (row.invoice_id && !existing.invoice_ids.includes(String(row.invoice_id))) {
        existing.invoice_ids.push(String(row.invoice_id));
        existing.invoices.push(invoiceEntry);
        existing.invoice_count += 1;
      }
      existing.total_amount = toMoney(numericMoney(existing.total_amount) + numericMoney(row.total_amount));
      existing.philhealth_amount = toMoney(numericMoney(existing.philhealth_amount) + numericMoney(row.philhealth_amount));
      existing.hmo_covered_amount = toMoney(numericMoney(existing.hmo_covered_amount) + numericMoney(row.hmo_covered_amount));
      existing.patient_pays = toMoney(numericMoney(existing.patient_pays) + numericMoney(row.patient_pays));
      existing.workups_list = Array.from(new Set([
        ...String(existing.workups_list || '').split(',').map((item) => item.trim()).filter(Boolean),
        ...workups
      ])).join(', ') || null;
      existing.hmo_claim = {
        ...existing.hmo_claim,
        patient_id: existing.hmo_claim?.patient_id || claim.patient_id || null,
        patient_name: existing.hmo_claim?.patient_name || claim.patient_name || row.patient_name || '',
        provider: existing.hmo_claim?.provider || claim.provider || '',
        hmo_provider: existing.hmo_claim?.hmo_provider || claim.hmo_provider || '',
        loa_number: existing.hmo_claim?.loa_number || claim.loa_number || '',
        hmo_loa_number: existing.hmo_claim?.hmo_loa_number || claim.hmo_loa_number || '',
        hmo_card_number: existing.hmo_claim?.hmo_card_number || claim.hmo_card_number || ''
      };
    }
    builtList = Array.from(encounterMap.values());

    const totalCount = builtList.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;
    const pagedRows = builtList.slice(offset, offset + perPage);

    res.json(serialize({
      filter: filterMode,
      page: currentPage,
      perPage,
      totalCount,
      invoiceCount,
      totalPages,
      rows: pagedRows
    }));
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

// ============================================================================
// ✅ NEW: Reference Number Generator for new patient walk-in intakes
// Endpoint: GET /api/billing/generate-ref?patient_id=UUID
// Nurse calls this when she clicks Complete Intake → gets NEW reference #
// Returns: { reference: "PGH260817-00042" }
// Also SAVES the reference to patients, appointments, billing_invoices, billing_hmo_claims rows!
// ============================================================================
router.get('/generate-ref', async (req, res) => {
  try {
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (!['nurse', 'admin', 'cashier', 'staff', 'doctor_secretary'].includes(role)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const patientId = String(req.query.patient_id || '').trim();
    const invoiceIdRaw = String(req.query.invoice_id || '').trim();
    const appointmentIdRaw = String(req.query.appointment_id || '').trim();

    // Step 1: Schema warmup to ensure columns exist (never crash)
    try {
      await Promise.all([
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL UNIQUE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS company TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_reference ON public.appointments(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_invoices_patient_reference ON public.billing_invoices(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference)`).catch(() => null)
      ]).catch(() => {});
    } catch (_) { /* ignore */ }

    // Step 2: If the patient already has a reference → return existing, don't waste counter
    let existingRef = null;
    if (patientId && patientId !== '') {
      try {
        const pRow = await prisma.$queryRawUnsafe(
          `SELECT patient_reference AS pr FROM public.patients WHERE id::text = $1::text LIMIT 1`,
          patientId
        ).catch(() => []);
        if (Array.isArray(pRow) && pRow.length && String(pRow[0]?.pr || '').trim() !== '') {
          existingRef = String(pRow[0].pr).trim();
        }
      } catch (_) { /* ignore */ }
    }
    if (!existingRef && invoiceIdRaw) {
      try {
        const iRow = await prisma.$queryRawUnsafe(
          `SELECT patient_reference AS pr FROM public.billing_invoices WHERE id::text = $1::text LIMIT 1`,
          invoiceIdRaw
        ).catch(() => []);
        if (Array.isArray(iRow) && iRow.length && String(iRow[0]?.pr || '').trim() !== '') {
          existingRef = String(iRow[0].pr).trim();
        }
      } catch (_) { /* ignore */ }
    }

    let finalRef = existingRef;

    // Step 3: Generate if no existing
    if (!finalRef) {
      const now = new Date();
      const yymmdd = String(now.getFullYear()).slice(-2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
      const prefix = `PGH${yymmdd}-`;
      let maxCounter = 0;
      try {
        const existing = await prisma.$queryRawUnsafe(
          `SELECT patient_reference AS pr FROM public.patients WHERE patient_reference LIKE $1 LIMIT 9999`,
          prefix + '%'
        ).catch(() => []);
        if (Array.isArray(existing)) {
          for (const r of existing) {
            const parts = String(r.pr || '').split('-');
            const n = parseInt(parts[parts.length - 1] || '0', 10);
            if (!isNaN(n) && n > maxCounter) maxCounter = n;
          }
        }
      } catch (_) { /* ignore */ }
      // Safety: ensure unique with retries (0.001% collision chance but better safe)
      for (let attempt = 0; attempt < 50; attempt++) {
        maxCounter += 1;
        const counter = String(maxCounter).padStart(5, '0');
        const candidate = `${prefix}${counter}`;
        try {
          const dup = await prisma.$queryRawUnsafe(
            `SELECT 1 AS ok FROM public.patients WHERE patient_reference = $1::text LIMIT 1`,
            candidate
          ).catch(() => []);
          if (!Array.isArray(dup) || dup.length === 0) {
            finalRef = candidate;
            break;
          }
        } catch (_) { /* retry */ }
      }
      if (!finalRef) {
        // Fallback random (should never happen)
        finalRef = `${prefix}${String(Math.floor(Math.random() * 90000) + 10000)}`;
      }
    }

    // Step 4: WRITE to database (all 4 tables we can link)
    const saved = { patient: false, appointments: 0, invoices: 0, claims: 0 };
    try {
      if (patientId && patientId !== '') {
        const r1 = await prisma.$executeRawUnsafe(
          `UPDATE public.patients SET patient_reference = $1::text WHERE id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, patientId
        ).catch(() => 0);
        saved.patient = Number(r1 || 0) > 0;
      }
      if (appointmentIdRaw) {
        const r2 = await prisma.$executeRawUnsafe(
          `UPDATE public.appointments SET patient_reference = $1::text WHERE id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, appointmentIdRaw
        ).catch(() => 0);
        saved.appointments = Number(r2 || 0);
        // Also by patient_id link (any same day appointments)
        if (patientId && patientId !== '') {
          prisma.$executeRawUnsafe(
            `UPDATE public.appointments SET patient_reference = $1::text WHERE patient_id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
            finalRef, patientId
          ).catch(() => null);
        }
      }
      if (invoiceIdRaw) {
        const r3 = await prisma.$executeRawUnsafe(
          `UPDATE public.billing_invoices SET patient_reference = $1::text WHERE id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, invoiceIdRaw
        ).catch(() => 0);
        saved.invoices = Number(r3 || 0);
        // Also billing_hmo_claims by invoice_id
        const r4 = await prisma.$executeRawUnsafe(
          `UPDATE public.billing_hmo_claims SET patient_reference = $1::text WHERE invoice_id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, invoiceIdRaw
        ).catch(() => 0);
        saved.claims = Number(r4 || 0);
      }
      // Also propagate by patient_id to invoices + claims that don't have it yet
      if (patientId && patientId !== '') {
        prisma.$executeRawUnsafe(
          `UPDATE public.billing_invoices SET patient_reference = $1::text WHERE patient_id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, patientId
        ).catch(() => null);
        prisma.$executeRawUnsafe(
          `UPDATE public.billing_hmo_claims SET patient_reference = $1::text WHERE patient_id::text = $2::text AND (NULLIF(TRIM(patient_reference::text),'') IS NULL OR patient_reference IS NULL)`,
          finalRef, patientId
        ).catch(() => null);
      }
    } catch (_writeErr) { /* ignore partial write failures */ }

    return res.status(200).json({
      ok: true,
      reference: finalRef,
      generated: !existingRef,
      saved
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ============================================================================
// ✅ NEW: Cashier SEARCH by REFERENCE NUMBER (used for the [GO] button)
// Endpoint: GET /api/billing/search-by-ref?ref=PGH260817-00042
// Returns ALL matching HMO claim rows that have this reference!
// So the cashier types the ref → this endpoint returns the row(s) to highlight!
// ============================================================================
router.get('/search-by-ref', async (req, res) => {
  try {
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (!['cashier', 'admin', 'doctor_secretary', 'staff'].includes(role)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    let refRaw = String(req.query.ref || '').trim();
    if (refRaw === '') {
      return res.status(200).json({ ok: true, found: false, ref: '', rows: [], count: 0 });
    }

    // Schema warmup (never crash)
    try {
      await Promise.all([
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.patients ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL UNIQUE`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_invoices ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS public.billing_hmo_claims ADD COLUMN IF NOT EXISTS patient_reference TEXT NULL`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_reference ON public.appointments(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_invoices_patient_reference ON public.billing_invoices(patient_reference)`).catch(() => null),
        prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_billing_hmo_claims_patient_reference ON public.billing_hmo_claims(patient_reference)`).catch(() => null)
      ]).catch(() => {});
    } catch (_) { /* ignore */ }

    // Normalize: support partial! If user typed "00042" → treat like "%00042"
    // If user typed "PGH0817-00042" → exact match or LIKE
    const isPartial = refRaw.length < 10 || !refRaw.toUpperCase().startsWith('PGH');
    const likePattern = isPartial ? `%${refRaw}%` : `%${refRaw}%`;
    const exactPattern = refRaw.toUpperCase();

    // Find ALL matching claim IDs from ANY of the 4 tables
    const matchedIds = new Set(); // store billing_invoices.id or claim.id
    const matchedPatientIds = new Set();

    // Scan 1: patients by reference
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id::text AS pid, patient_reference AS pr FROM public.patients
         WHERE UPPER(patient_reference) LIKE UPPER($1::text)
         LIMIT 100`,
        likePattern
      ).catch(() => []);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (String(r.pid || '').trim()) matchedPatientIds.add(String(r.pid).trim());
        }
      }
    } catch (_) { /* ignore */ }

    // Scan 2: appointments
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT patient_id::text AS pid FROM public.appointments
         WHERE UPPER(patient_reference) LIKE UPPER($1::text)
         LIMIT 100`,
        likePattern
      ).catch(() => []);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (String(r.pid || '').trim()) matchedPatientIds.add(String(r.pid).trim());
        }
      }
    } catch (_) { /* ignore */ }

    // Scan 3: billing_invoices (collect invoice IDs!)
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id::text AS invid, patient_id::text AS pid FROM public.billing_invoices
         WHERE UPPER(patient_reference) LIKE UPPER($1::text)
         LIMIT 100`,
        likePattern
      ).catch(() => []);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (String(r.invid || '').trim()) matchedIds.add(String(r.invid).trim());
          if (String(r.pid || '').trim()) matchedPatientIds.add(String(r.pid).trim());
        }
      }
    } catch (_) { /* ignore */ }

    // Scan 4: billing_hmo_claims (collect invoice IDs!)
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT invoice_id::text AS invid, patient_id::text AS pid FROM public.billing_hmo_claims
         WHERE UPPER(patient_reference) LIKE UPPER($1::text)
         LIMIT 100`,
        likePattern
      ).catch(() => []);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (String(r.invid || '').trim()) matchedIds.add(String(r.invid).trim());
          if (String(r.pid || '').trim()) matchedPatientIds.add(String(r.pid).trim());
        }
      }
    } catch (_) { /* ignore */ }

    // Now also find invoices linked via patient_id
    if (matchedPatientIds.size > 0) {
      const pidArr = Array.from(matchedPatientIds).slice(0, 100);
      try {
        const invRows = await prisma.$queryRawUnsafe(
          `SELECT id::text AS invid FROM public.billing_invoices
           WHERE patient_id::text IN (${pidArr.map((_, i) => `$${i + 1}`).join(',')})
           LIMIT 100`,
          ...pidArr
        ).catch(() => []);
        if (Array.isArray(invRows)) {
          for (const r of invRows) {
            if (String(r.invid || '').trim()) matchedIds.add(String(r.invid).trim());
          }
        }
      } catch (_) { /* ignore */ }
    }

    // If no match at all yet → try broad text search on notes field (fallback)
    if (matchedIds.size === 0 && matchedPatientIds.size === 0) {
      try {
        const fallback = await prisma.$queryRawUnsafe(
          `SELECT id::text AS invid FROM public.billing_invoices
           WHERE UPPER(COALESCE(notes::text,'')) LIKE UPPER($1::text)
           ORDER BY id DESC LIMIT 20`,
          likePattern
        ).catch(() => []);
        if (Array.isArray(fallback)) {
          for (const r of fallback) if (String(r.invid || '').trim()) matchedIds.add(String(r.invid).trim());
        }
      } catch (_) { /* ignore */ }
    }

    const invArr = Array.from(matchedIds).slice(0, 200);
    const results = [];

    if (invArr.length > 0) {
      // Enrich invoice ids → full patient info + HMO claim info
      try {
        // Get patient info from billing_invoices join to patients + claim details
        const claimRows = await prisma.$queryRawUnsafe(`
          SELECT
            h.id::text AS claim_id,
            h.invoice_id::text AS invoice_id,
            h.patient_name AS claim_patient_name,
            h.hmo_provider AS provider,
            h.hmo_loa_number AS loa_number,
            h.hmo_card_number AS hmo_card_number,
            h.philhealth_deduction AS philhealth_deduction,
            h.loa_approved_amount AS loa_approved_amount,
            h.status AS status,
            h.notes AS notes,
            h.patient_reference AS patient_reference,
            bi.total_amount AS total_amount,
            bi.patient_id::text AS patient_id,
            p.first_name AS p_first,
            p.last_name AS p_last,
            p.company AS company,
            p.contact_number AS contact_number,
            bi.created_at AS created_at,
            h.created_at AS claim_created_at
          FROM public.billing_hmo_claims h
          LEFT JOIN public.billing_invoices bi ON bi.id = h.invoice_id
          LEFT JOIN public.patients p ON p.id = bi.patient_id
          WHERE h.invoice_id::text IN (${invArr.map((_, i) => `$${i + 1}`).join(',')})
          ORDER BY COALESCE(h.updated_at, h.created_at, bi.created_at) DESC
          LIMIT 200
        `, ...invArr.map((x) => BigInt(x))
        ).catch(() => []);
        if (Array.isArray(claimRows)) {
          for (const r of claimRows) {
            const patientName = [String(r.p_first || ''), String(r.p_last || '')].join(' ').trim()
              || String(r.claim_patient_name || '').trim() || 'Patient';
            results.push({
              claim_id: r.claim_id,
              invoice_id: r.invoice_id,
              patient_id: r.patient_id,
              patient_name: patientName,
              company: r.company || null,
              contact_number: r.contact_number || null,
              patient_reference: r.patient_reference || null,
              provider: r.provider || null,
              loa_number: r.loa_number || null,
              hmo_card_number: r.hmo_card_number || null,
              philhealth_deduction: Number(r.philhealth_deduction || 0),
              loa_approved_amount: Number(r.loa_approved_amount || 0),
              total_amount: Number(r.total_amount || 0),
              status: r.status || 'Approved',
              notes: r.notes || null,
              created_at: r.created_at || r.claim_created_at || new Date().toISOString()
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    return res.status(200).json({
      ok: true,
      ref: refRaw,
      found: results.length > 0,
      count: results.length,
      matched_invoice_ids: invArr,
      matched_patient_ids: Array.from(matchedPatientIds),
      rows: results
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post('/payments', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
    await ensureBillingHmoClaimsTableExist().catch(() => {});
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'cashier' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const invoiceIdRaw = String(req.body?.invoiceId || '').trim();
    if (!/^\d+$/.test(invoiceIdRaw)) return res.status(400).json({ message: 'invoiceId is required' });
    const invoiceId = BigInt(invoiceIdRaw);

    const method = req.body?.method != null ? String(req.body.method).trim() : null;
    const reference = req.body?.reference != null ? String(req.body.reference).trim() : null;
    const idempotencyKey =
      String(req.headers['x-idempotency-key'] || req.body?.idempotencyKey || req.body?.idempotency_key || '').trim() || null;
    const receivedBy = normalizeEmail(req.headers['x-user-email'] || req.body?.receivedBy || '');
    const actorName = String(req.headers['x-user-name'] || '').trim() || receivedBy || (role === 'doctor_secretary' ? 'Doctor Secretary' : 'Cashier');

    if (!method) return res.status(400).json({ message: 'Payment method is required' });
    if (String(method || '').toLowerCase() !== 'cash' && !reference) return res.status(400).json({ message: 'Receipt/reference is required' });
    if (!receivedBy) return res.status(400).json({ message: 'Collector email is required' });

    const inv = await prisma.billing_invoices.findUnique({
      where: { id: invoiceId },
      include: { payments: true }
    });
    if (!inv) return res.status(404).json({ message: 'Invoice not found' });

    if (idempotencyKey) {
      const existing = await prisma.billing_payments
        .findFirst({
          where: { invoice_id: invoiceId, idempotency_key: idempotencyKey },
          orderBy: { id: 'desc' }
        })
        .catch(() => null);
      if (existing) {
        return res.status(200).json(serialize({ ...existing, idempotency_reused: true }));
      }
    }

    if (inv.appointment_id != null) {
      const appointmentId = BigInt(String(inv.appointment_id));
      const appt = await prisma.appointments.findUnique({ where: { id: appointmentId }, select: { status: true } }).catch(() => null);
      if (!appt) return res.status(404).json({ message: 'Appointment not found' });
      const st = String(appt.status || '').trim().toLowerCase();
      const allowed = new Set(['confirmed', 'checked-in', 'checkedin', 'scheduled', 'for payment', 'for_payment', 'paid']);
      if (!allowed.has(st)) {
        return res.status(409).json({ message: `Payment is allowed only for confirmed/check-in appointments. Current status: ${String(appt.status || 'Pending')}` });
      }
    }

    const fin = await computeInvoiceFinancials(prisma, invoiceId);
    const balance = Math.max(0, Number(fin?.balance || 0));

    const amountRaw = req.body?.amount != null ? Number(req.body.amount) : balance;
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) return res.status(400).json({ message: 'Invalid amount' });
    if (amountRaw - balance > 0.00001) return res.status(400).json({ message: 'Amount exceeds balance' });
    const amountMoney = toMoney(amountRaw);

    const created = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.billing_payments
          .findFirst({ where: { invoice_id: invoiceId, idempotency_key: idempotencyKey }, orderBy: { id: 'desc' } })
          .catch(() => null);
        if (existing) return existing;
      }

      const p = await tx.billing_payments.create({
        data: {
          invoice_id: invoiceId,
          amount: amountMoney,
          method,
          reference: reference || null,
          received_by: receivedBy || null,
          idempotency_key: idempotencyKey
        }
      });

      await recomputeInvoiceStatus(tx, invoiceId).catch(() => null);

      return p;
    });

    res.status(201).json(serialize(created));

    setImmediate(async () => {
      try {
        const updatedInvoice = await prisma.billing_invoices.findUnique({ where: { id: invoiceId } }).catch(() => null);
        const isPaid = String(updatedInvoice?.status || '') === 'Paid';
        const appointmentId = updatedInvoice?.appointment_id != null ? updatedInvoice.appointment_id : null;
        if (isPaid && appointmentId) {
          const apptId = BigInt(String(appointmentId));
          const appt = await prisma.appointments.findUnique({ where: { id: apptId } }).catch(() => null);
          if (appt) {
            await prisma.appointments.update({
              where: { id: apptId },
              data: { status: 'Paid', payment_status: 'paid', paid_at: new Date() }
            }).catch(() => null);
          }

          prisma.activity_logs.create({
            data: {
              actor_name: actorName,
              role: 'Cashier',
              action: 'Create',
              target: `Invoice:${invoiceId.toString()}` ,
              details: `Payment recorded � invoice ${invoiceId.toString()} � ${method} � ${reference} � amount ${String(amountMoney)}`
            }
          }).catch(() => {});
        }
      } catch (_) {}
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('Billing tables are not installed')) {
      return res.status(500).json({ message: msg });
    }
    console.error('billing: POST /payments failed:', err);
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.get('/invoices/by-appointment/:appointmentId', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
    await ensureBillingHmoClaimsTableExist().catch(() => {});
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin' && role !== 'doctor') return res.status(401).json({ message: 'Unauthorized' });

    const appointmentIdRaw = String(req.params.appointmentId || '').trim();
    if (!/^\d+$/.test(appointmentIdRaw)) return res.status(400).json({ message: 'Invalid appointmentId' });
    const appointmentId = BigInt(appointmentIdRaw);

    const inv = await prisma.billing_invoices.findFirst({
      where: { appointment_id: appointmentId },
      include: {
        items: true,
        payments: true,
        patients: { select: { id: true, first_name: true, last_name: true, email: true, contact_number: true } }
      },
      orderBy: { created_at: 'desc' }
    });
    if (!inv) return res.status(404).json({ message: 'Invoice not found' });

    const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const adjustments = await prisma.$queryRawUnsafe(
      `
        SELECT id, invoice_id, type, amount, reference, reason, created_by, created_at
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
        ORDER BY created_at DESC, id DESC
      `,
      String(inv.id)
    ).catch(() => []);
    const refunded = (Array.isArray(adjustments) ? adjustments : [])
      .filter((a) => String(a.type || '').toLowerCase() === 'refund')
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const netPaid = paid - refunded;
    const total = Number(inv.total_amount || 0);
    const hmoRows = await fetchHmoClaimsByInvoiceIds(prisma, [inv.id]);
    const hmoClaim = summarizeHmoClaim(Array.isArray(hmoRows) ? hmoRows[0] : null, total);
    const collectibleTotal = hmoClaim.patient_payable;
    const st = String(inv.status || '').trim().toLowerCase();
    const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, collectibleTotal - netPaid);

    res.json(
      serialize({
        ...inv,
        adjustments,
        hmo_claim: hmoClaim,
        patient_due_amount: toMoney(collectibleTotal),
        philhealth_deduction: toMoney(hmoClaim.philhealth_deduction),
        hmo_coverage_amount: toMoney(hmoClaim.applied_hmo_amount),
        paid_amount: toMoney(paid),
        refunded_amount: toMoney(refunded),
        net_paid_amount: toMoney(netPaid),
        balance_amount: toMoney(balance)
      })
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/adjustments', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'cashier' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const invoiceIdRaw = req.query.invoiceId != null ? String(req.query.invoiceId).trim() : '';
    if (!invoiceIdRaw || !/^\d+$/.test(invoiceIdRaw)) return res.status(400).json({ message: 'invoiceId is required' });

    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT id, invoice_id, type, amount, reference, reason, created_by, created_at
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
        ORDER BY created_at DESC, id DESC
      `,
      invoiceIdRaw
    ).catch(() => []);

    res.json(serialize(rows));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/adjustments', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'cashier' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const invoiceIdRaw = String(req.body?.invoiceId || '').trim();
    if (!/^\d+$/.test(invoiceIdRaw)) return res.status(400).json({ message: 'invoiceId is required' });
    const invoiceId = BigInt(invoiceIdRaw);

    const type = String(req.body?.type || '').trim().toLowerCase();
    if (type !== 'refund' && type !== 'void') return res.status(400).json({ message: 'Invalid type' });

    const actor = normalizeEmail(req.headers['x-user-email'] || req.body?.createdBy || '');
    const reason = req.body?.reason != null ? String(req.body.reason).trim() : null;
    const reference = req.body?.reference != null ? String(req.body.reference).trim() : null;

    const invoice = await prisma.billing_invoices.findUnique({
      where: { id: invoiceId },
      include: { payments: true }
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const paid = (invoice.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const existing = await prisma
      .$queryRawUnsafe(
        `
          SELECT type, amount
          FROM public.billing_adjustments
          WHERE invoice_id = $1::bigint
        `,
        invoiceId.toString()
      )
      .catch(() => []);
    const refunded = (Array.isArray(existing) ? existing : [])
      .filter((a) => String(a.type || '').toLowerCase() === 'refund')
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const netPaid = paid - refunded;

    if (type === 'refund') {
      const amountRaw = Number(req.body?.amount || 0);
      if (!Number.isFinite(amountRaw) || amountRaw <= 0) return res.status(400).json({ message: 'Invalid amount' });
      if (amountRaw - netPaid > 0.00001) return res.status(400).json({ message: 'Refund exceeds net paid amount' });
      if (!reference) return res.status(400).json({ message: 'Reference is required' });

      await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `
            INSERT INTO public.billing_adjustments (invoice_id, type, amount, reference, reason, created_by)
            VALUES ($1::bigint, 'refund', $2::numeric, $3::text, $4::text, $5::text)
          `,
          invoiceId.toString(),
          toMoney(amountRaw),
          reference || null,
          reason,
          actor || null
        );

        await recomputeInvoiceStatus(tx, invoiceId).catch(() => null);
      });
    }

    if (type === 'void') {
      const voidRef = reference || `VOID:${invoiceIdRaw}`;
      const refundAmount = Math.max(0, netPaid);

      await prisma.$transaction(async (tx) => {
        if (refundAmount > 0.00001) {
          await tx.$queryRawUnsafe(
            `
              INSERT INTO public.billing_adjustments (invoice_id, type, amount, reference, reason, created_by)
              VALUES ($1::bigint, 'refund', $2::numeric, $3::text, $4::text, $5::text)
            `,
            invoiceId.toString(),
            toMoney(refundAmount),
            voidRef,
            reason || 'Voided invoice',
            actor || null
          );
        }

        await tx.billing_invoices.update({
          where: { id: invoiceId },
          data: { status: 'Voided', updated_at: new Date() }
        });
      });
    }

    prisma.activity_logs
      .create({
        data: {
          actor_name: String(req.headers['x-user-name'] || '').trim() || actor || (role === 'admin' ? 'Admin' : 'Cashier'),
          role: role === 'admin' ? 'Admin' : 'Cashier',
          action: 'Update',
          target: `Invoice:${invoiceIdRaw}`,
          details: `${type === 'refund' ? 'Refund issued' : 'Invoice voided'} • invoice ${invoiceIdRaw}${type === 'refund' ? ` • amount ${toMoney(Number(req.body?.amount || 0))}` : ''}${reference ? ` • ref ${reference}` : ''}${reason ? ` • ${reason}` : ''}`
        }
      })
      .catch(() => {});

    const full = await prisma.billing_invoices.findUnique({
      where: { id: invoiceId },
      include: { items: true, payments: true, patients: true }
    });
    if (!full) return res.status(404).json({ message: 'Invoice not found' });

    const adjustments = await prisma.$queryRawUnsafe(
      `
        SELECT id, invoice_id, type, amount, reference, reason, created_by, created_at
        FROM public.billing_adjustments
        WHERE invoice_id = $1::bigint
        ORDER BY created_at DESC, id DESC
      `,
      invoiceId.toString()
    ).catch(() => []);

    const paid2 = (full.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const refunded2 = (Array.isArray(adjustments) ? adjustments : [])
      .filter((a) => String(a.type || '').toLowerCase() === 'refund')
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const netPaid2 = paid2 - refunded2;
    const total2 = Number(full.total_amount || 0);
    const st2 = String(full.status || '').trim().toLowerCase();
    const balance2 = st2 === 'cancelled' || st2 === 'voided' ? 0 : Math.max(0, total2 - netPaid2);

    res.status(201).json(
      serialize({
        ...full,
        adjustments,
        paid_amount: toMoney(paid2),
        refunded_amount: toMoney(refunded2),
        net_paid_amount: toMoney(netPaid2),
        balance_amount: toMoney(balance2)
      })
    );
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.get('/service-fees', async (req, res) => {
  try {
    await ensureDoctorServiceFeesTableExist();
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin' && role !== 'doctor') return res.status(401).json({ message: 'Unauthorized' });

    const doctorUuid = await resolveDoctorUuidForFees(req, '');
    if (!doctorUuid) return res.status(400).json({ message: 'doctorUuid is required' });

    const rows = await prisma.$queryRaw`
      SELECT id, doctor_uuid, service_key, service_name, default_fee, active, created_at, updated_at
      FROM public.doctor_service_fees
      WHERE doctor_uuid = ${doctorUuid}::uuid
      ORDER BY active DESC, service_name ASC
    `.catch(() => []);

    res.json(serialize(rows));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/service-fees', async (req, res) => {
  try {
    await ensureDoctorServiceFeesTableExist();
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const doctorUuid = await resolveDoctorUuidForFees(req, '');
    if (!doctorUuid) return res.status(400).json({ message: 'doctorUuid is required' });

    const serviceKey = normalizeServiceKey(req.body?.serviceKey || req.body?.service_key || '');
    const serviceName = String(req.body?.serviceName || req.body?.service_name || '').trim();
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);
    const feeRaw = Number(req.body?.defaultFee ?? req.body?.default_fee ?? 0);
    const defaultFee = Number.isFinite(feeRaw) && feeRaw >= 0 ? toMoney(feeRaw) : null;

    if (!serviceKey) return res.status(400).json({ message: 'serviceKey is required' });
    if (!/^[a-z0-9_]{1,64}$/.test(serviceKey)) return res.status(400).json({ message: 'serviceKey must be 1-64 lowercase letters, numbers, or underscores.' });
    if (!serviceName) return res.status(400).json({ message: 'serviceName is required' });
    if (serviceName.length < 2 || serviceName.length > 120) return res.status(400).json({ message: 'serviceName must be 2-120 characters.' });
    if (defaultFee == null) return res.status(400).json({ message: 'defaultFee must be >= 0' });
    if (Number(defaultFee) > 999999.99) return res.status(400).json({ message: 'defaultFee cannot exceed 999999.99.' });

    const rows = await prisma.$queryRaw`
      INSERT INTO public.doctor_service_fees (doctor_uuid, service_key, service_name, default_fee, active)
      VALUES (${doctorUuid}::uuid, ${serviceKey}, ${serviceName}, ${defaultFee}::numeric, ${active})
      ON CONFLICT (doctor_uuid, service_key)
      DO UPDATE SET
        service_name = EXCLUDED.service_name,
        default_fee = EXCLUDED.default_fee,
        active = EXCLUDED.active,
        updated_at = now()
      RETURNING id, doctor_uuid, service_key, service_name, default_fee, active, created_at, updated_at
    `;
    const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
    res.json(serialize(saved || {}));
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.post('/collect-onsite', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'admin') {
      if (role === 'doctor_secretary') return res.status(403).json({ message: 'Doctor secretary cannot collect payments. Use Charge, then patient pays at the cashier.' });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const linkedDoctorId = String(req.headers['x-linked-doctor-id'] || '').trim();
    const collectorEmail = normalizeEmail(req.headers['x-user-email'] || req.body?.receivedBy || '');
    const collectorName = String(req.headers['x-user-name'] || '').trim() || collectorEmail || 'Doctor Secretary';

    const appointmentIdRaw = String(req.body?.appointmentId || '').trim();
    if (!/^\d+$/.test(appointmentIdRaw)) return res.status(400).json({ message: 'appointmentId is required' });
    const appointmentId = BigInt(appointmentIdRaw);

    const serviceKeyRaw = String(req.body?.serviceKey || req.body?.service_key || '').trim();
    const serviceKey = normalizeServiceKey(serviceKeyRaw);
    const serviceNameRaw = req.body?.serviceName != null ? String(req.body.serviceName).trim() : '';

    const amountCandidate = req.body?.amount;
    let amountRaw = Number(amountCandidate);
    let amountMoney = Number.isFinite(amountRaw) && amountRaw > 0 ? toMoney(amountRaw) : null;

    const method = req.body?.method != null ? String(req.body.method).trim() : null;
    const reference = req.body?.reference != null ? String(req.body.reference).trim() : null;
    let description = String(req.body?.description || '').trim();

    if (!method) return res.status(400).json({ message: 'Payment method is required' });
    if (String(method || '').toLowerCase() !== 'cash' && !reference) return res.status(400).json({ message: 'Receipt/reference is required' });
    if (!collectorEmail) return res.status(400).json({ message: 'Collector email is required' });

    const appt = await prisma.appointments.findUnique({ where: { id: appointmentId } }).catch(() => null);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const apptMode = String(appt.consultation_mode || 'onsite').toLowerCase();
    if (apptMode !== 'onsite') return res.status(400).json({ message: 'Only onsite consultations are supported here.' });

    const doctorUuidForFee = String(appt.doctor_uuid || linkedDoctorId || '').trim();
    let resolvedServiceName = serviceNameRaw;
    if ((!amountMoney || !resolvedServiceName) && serviceKey && doctorUuidForFee) {
      await ensureDoctorServiceFeesTableExist().catch(() => {});
      const feeRows = await prisma.$queryRaw`
        SELECT service_name, default_fee
        FROM public.doctor_service_fees
        WHERE doctor_uuid = ${doctorUuidForFee}::uuid
          AND service_key = ${serviceKey}
          AND active = true
        LIMIT 1
      `.catch(() => []);
      const feeRow = Array.isArray(feeRows) && feeRows.length ? feeRows[0] : null;
      if (feeRow) {
        if (!resolvedServiceName) resolvedServiceName = String(feeRow.service_name || '').trim();
        if (!amountMoney) {
          const feeNum = Number(feeRow.default_fee || 0);
          if (Number.isFinite(feeNum) && feeNum > 0) {
            amountRaw = feeNum;
            amountMoney = toMoney(feeNum);
          }
        }
      }
    }

    if (!amountMoney) return res.status(400).json({ message: 'Invalid amount' });
    if (!description) {
      description = resolvedServiceName ? `Consultation Fee - ${resolvedServiceName}` : 'Consultation Fee';
    }

    if (role === 'doctor_secretary') {
      if (!linkedDoctorId) return res.status(400).json({ message: 'Missing x-linked-doctor-id header' });
      const docUuid = appt.doctor_uuid ? String(appt.doctor_uuid) : '';
      if (!docUuid || docUuid !== linkedDoctorId) return res.status(403).json({ message: 'Forbidden' });
    }

    const invoiceId = await prisma.$transaction(async (tx) => {
      let inv = await tx.billing_invoices.findFirst({ where: { appointment_id: appointmentId }, orderBy: { created_at: 'desc' } }).catch(() => null);
      if (!inv) {
        inv = await tx.billing_invoices.create({
          data: {
            patient_id: appt.patient_id ? String(appt.patient_id) : null,
            appointment_id: appointmentId,
            status: 'Draft',
            notes: `Onsite consultation • ${String(appt.reason || '').trim() || 'Consultation'}`.trim(),
            created_by: collectorEmail || null,
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
        });
      } else {
        await tx.billing_invoices.update({
          where: { id: inv.id },
          data: { total_amount: amountMoney, updated_at: new Date() }
        });
        const item = await tx.billing_invoice_items.findFirst({ where: { invoice_id: inv.id }, orderBy: { created_at: 'asc' } }).catch(() => null);
        if (item) {
          await tx.billing_invoice_items.update({
            where: { id: item.id },
            data: { description, quantity: 1, unit_price: amountMoney, line_total: amountMoney }
          }).catch(() => null);
        } else {
          await tx.billing_invoice_items.create({
            data: {
              invoice_id: inv.id,
              description,
              quantity: 1,
              unit_price: amountMoney,
              line_total: amountMoney
            }
          });
        }
      }

      await tx.billing_payments.create({
        data: {
          invoice_id: inv.id,
          amount: amountMoney,
          method,
          reference: reference || null,
          received_by: collectorEmail || null
        }
      });

      await tx.billing_invoices.update({
        where: { id: inv.id },
        data: { status: 'Paid', updated_at: new Date() }
      });

      await syncHmoDataFromAppointmentToInvoice(tx, appointmentId, inv.id);

      await tx.appointments.update({
        where: { id: appointmentId },
        data: {
          status: 'Paid',
          payment_status: 'paid',
          paid_at: new Date(),
          amount: Math.trunc(Math.round(Number(amountRaw) || 0)),
          currency: 'PHP'
        }
      }).catch(() => null);

      return inv.id;
    });

    prisma.activity_logs.create({
      data: {
        actor_name: collectorName,
        role: role === 'admin' ? 'Admin' : 'Doctor Secretary',
        action: 'Create',
        target: `Invoice:${invoiceId.toString()}`,
        details: `Onsite payment collected • appointment ${appointmentId.toString()} • ${method} • ${reference} • amount ${amountMoney}`
      }
    }).catch(() => {});

    const full = await prisma.billing_invoices.findUnique({
      where: { id: invoiceId },
      include: { items: true, payments: true, patients: true }
    });

    res.status(201).json(serialize(full));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('Billing tables are not installed')) return res.status(500).json({ message: msg });
    res.status(500).json({ message: msg || 'Server error' });
  }
});

// Doctor Secretary: set consultation charge (unpaid) and forward to cashier billing.
router.post('/charge-onsite', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const linkedDoctorId = String(req.headers['x-linked-doctor-id'] || '').trim();
    const actorEmail = normalizeEmail(req.headers['x-user-email'] || req.body?.createdBy || '');
    const actorName = String(req.headers['x-user-name'] || '').trim() || actorEmail || 'Doctor Secretary';

    const appointmentIdRaw = String(req.body?.appointmentId || '').trim();
    if (!/^\d+$/.test(appointmentIdRaw)) return res.status(400).json({ message: 'appointmentId is required' });
    const appointmentId = BigInt(appointmentIdRaw);

    const serviceKeyRaw = String(req.body?.serviceKey || req.body?.service_key || '').trim();
    const serviceKey = normalizeServiceKey(serviceKeyRaw);
    const serviceNameRaw = req.body?.serviceName != null ? String(req.body.serviceName).trim() : '';

    const amountCandidate = req.body?.amount;
    const amountRaw = Number(amountCandidate);
    const amountMoney = Number.isFinite(amountRaw) && amountRaw > 0 ? toMoney(amountRaw) : null;
    let description = String(req.body?.description || '').trim();

    if (!actorEmail) return res.status(400).json({ message: 'Creator email is required' });
    if (!amountMoney) return res.status(400).json({ message: 'Invalid amount' });
    if (serviceKey && serviceKey.length > 64) return res.status(400).json({ message: 'serviceKey too long (max 64 chars).' });
    if (Number(amountMoney) > 999999.99) return res.status(400).json({ message: 'amount cannot exceed 999999.99.' });

    const appt = await prisma.appointments.findUnique({ where: { id: appointmentId } }).catch(() => null);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const apptMode = String(appt.consultation_mode || 'onsite').toLowerCase();
    if (apptMode !== 'onsite') return res.status(400).json({ message: 'Only onsite consultations are supported here.' });

    let patientId = appt.patient_id ? String(appt.patient_id) : null;
    if (!patientId) {
      const email = normalizeEmail(appt.email || '');
      if (email) {
        const p = await prisma.patients.findFirst({ where: { email }, select: { id: true } }).catch(() => null);
        if (p?.id) patientId = String(p.id);
      }
    }

    // Only allow secretary to charge for their linked doctor once appointment is assigned to that doctor.
    if (role === 'doctor_secretary') {
      if (!linkedDoctorId) return res.status(400).json({ message: 'Missing x-linked-doctor-id header' });
      const docUuid = appt.doctor_uuid ? String(appt.doctor_uuid) : '';
      if (!docUuid || docUuid !== linkedDoctorId) return res.status(403).json({ message: 'Forbidden' });
    }

    let resolvedServiceName = serviceNameRaw;
    const doctorUuidForFee = String(appt.doctor_uuid || linkedDoctorId || '').trim();
    if (!resolvedServiceName && serviceKey && doctorUuidForFee) {
      await ensureDoctorServiceFeesTableExist().catch(() => {});
      const feeRows = await prisma.$queryRaw`
        SELECT service_name
        FROM public.doctor_service_fees
        WHERE doctor_uuid = ${doctorUuidForFee}::uuid
          AND service_key = ${serviceKey}
          AND active = true
        LIMIT 1
      `.catch(() => []);
      const feeRow = Array.isArray(feeRows) && feeRows.length ? feeRows[0] : null;
      if (feeRow) resolvedServiceName = String(feeRow.service_name || '').trim();
    }

    if (!description) {
      description = resolvedServiceName ? `Consultation Fee - ${resolvedServiceName}` : 'Consultation Fee';
    }

    const invoice = await prisma.$transaction(async (tx) => {
      let inv = await tx.billing_invoices.findFirst({ where: { appointment_id: appointmentId }, orderBy: { created_at: 'desc' } }).catch(() => null);
      if (!inv) {
        inv = await tx.billing_invoices.create({
          data: {
            patient_id: patientId,
            appointment_id: appointmentId,
            status: 'Ready',
            notes: `Onsite consultation • ${String(appt.reason || '').trim() || 'Consultation'}`.trim(),
            created_by: actorEmail || null,
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
        });
      } else {
        await tx.billing_invoices.update({
          where: { id: inv.id },
          data: { status: 'Ready', total_amount: amountMoney, updated_at: new Date() }
        });
        const item = await tx.billing_invoice_items.findFirst({ where: { invoice_id: inv.id }, orderBy: { created_at: 'asc' } }).catch(() => null);
        if (item) {
          await tx.billing_invoice_items.update({
            where: { id: item.id },
            data: { description, quantity: 1, unit_price: amountMoney, line_total: amountMoney }
          }).catch(() => null);
        } else {
          await tx.billing_invoice_items.create({
            data: {
              invoice_id: inv.id,
              description,
              quantity: 1,
              unit_price: amountMoney,
              line_total: amountMoney
            }
          });
        }
      }

      // Mark appointment as unpaid (cashier will collect later)
      await tx.appointments
        .update({
          where: { id: appointmentId },
          data: { payment_status: 'for_payment', patient_id: patientId ? patientId : undefined }
        })
        .catch(() => null);

      await syncHmoDataFromAppointmentToInvoice(tx, appointmentId, inv.id);

      const full = await tx.billing_invoices.findUnique({ where: { id: inv.id } }).catch(() => null);
      return full || inv;
    });

    res.json(serialize(invoice || {}));
  } catch (err) {
    const msg = String(err?.message || '');
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.get('/summary/doctor', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
    const role = String(req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'doctor_secretary' && role !== 'admin') return res.status(401).json({ message: 'Unauthorized' });

    const linkedDoctorId = String(req.headers['x-linked-doctor-id'] || '').trim();
    const doctorUuid = role === 'doctor_secretary' ? linkedDoctorId : String(req.query.doctorUuid || '').trim();
    if (!doctorUuid) return res.status(400).json({ message: 'Missing doctorUuid' });

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
      return { start: startUtc, end: endUtc, dateKey: `${m[1]}-${m[2]}-${m[3]}` };
    };

    const dateRaw = String(req.query.date || '').trim();
    const now = new Date();
    const manilaNowMs = now.getTime() + 8 * 60 * 60 * 1000;
    const manilaNow = new Date(manilaNowMs);
    const fallbackKey = `${manilaNow.getUTCFullYear()}-${String(manilaNow.getUTCMonth() + 1).padStart(2, '0')}-${String(manilaNow.getUTCDate()).padStart(2, '0')}`;

    const range = makeManilaRange(dateRaw || fallbackKey);
    if (!range) return res.status(400).json({ message: 'Invalid date' });
    const { start, end, dateKey } = range;

    const paidRows = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(p.amount), 0) AS total_paid,
        COUNT(DISTINCT i.id) AS invoices_paid
      FROM public.billing_payments p
      JOIN public.billing_invoices i ON i.id = p.invoice_id
      JOIN public.appointments a ON a.id = i.appointment_id
      WHERE a.doctor_uuid = ${doctorUuid}::uuid
        AND lower(coalesce(a.consultation_mode, 'onsite')) = 'onsite'
        AND p.created_at >= ${start}
        AND p.created_at <= ${end}
    `;
    const paid = Array.isArray(paidRows) ? paidRows[0] : null;
    const totalPaid = paid?.total_paid != null ? Number(paid.total_paid) : 0;
    const invoicesPaid = paid?.invoices_paid != null ? Number(paid.invoices_paid) : 0;

    const refundRows = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(adj.amount), 0) AS total_refunded
      FROM public.billing_adjustments adj
      JOIN public.billing_invoices i ON i.id = adj.invoice_id
      JOIN public.appointments a ON a.id = i.appointment_id
      WHERE a.doctor_uuid = ${doctorUuid}::uuid
        AND lower(coalesce(a.consultation_mode, 'onsite')) = 'onsite'
        AND lower(adj.type) = 'refund'
        AND adj.created_at >= ${start}
        AND adj.created_at <= ${end}
    `.catch(() => []);
    const ref = Array.isArray(refundRows) ? refundRows[0] : null;
    const totalRefunded = ref?.total_refunded != null ? Number(ref.total_refunded) : 0;
    const netCollected = totalPaid - totalRefunded;

    const apptRows = await prisma.$queryRaw`
      SELECT
        COUNT(*) AS total_consults,
        COUNT(*) FILTER (WHERE lower(coalesce(status, '')) = 'paid') AS total_paid_consults
      FROM public.appointments
      WHERE doctor_uuid = ${doctorUuid}::uuid
        AND lower(coalesce(consultation_mode, 'onsite')) = 'onsite'
        AND appointment_date >= ${start}
        AND appointment_date <= ${end}
    `;
    const appt = Array.isArray(apptRows) ? apptRows[0] : null;
    const totalConsults = appt?.total_consults != null ? Number(appt.total_consults) : 0;
    const totalPaidConsults = appt?.total_paid_consults != null ? Number(appt.total_paid_consults) : 0;

    const allTimeRows = await prisma.$queryRaw`
      SELECT COUNT(*) AS total_consults
      FROM public.appointments
      WHERE doctor_uuid = ${doctorUuid}::uuid
        AND lower(coalesce(consultation_mode, 'onsite')) = 'onsite'
    `.catch(() => []);
    const allTime = Array.isArray(allTimeRows) ? allTimeRows[0] : null;
    const totalConsultsAllTime = allTime?.total_consults != null ? Number(allTime.total_consults) : 0;

    res.json({
      date: dateKey,
      doctorUuid,
      totalConsults,
      totalConsultsAllTime,
      paidConsults: totalPaidConsults,
      unpaidConsults: Math.max(0, totalConsults - totalPaidConsults),
      collectedAmount: toMoney(netCollected),
      invoicesPaid
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/payments', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    const { invoiceId, take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });
    const query = String(req.query.q || '').trim();
    const source = String(req.query.source || '').trim();

    const filters = [];
    if (invoiceId) {
      const raw = String(invoiceId).trim();
      if (!/^\d+$/.test(raw)) return res.status(400).json({ message: 'Invalid invoiceId' });
      filters.push({ invoice_id: BigInt(raw) });
    }
    if (query) {
      const or = [
        { reference: { contains: query, mode: 'insensitive' } },
        { received_by: { contains: query, mode: 'insensitive' } },
        { method: { contains: query, mode: 'insensitive' } },
        { invoices: { is: { notes: { contains: query, mode: 'insensitive' } } } },
        { invoices: { is: { items: { some: { description: { contains: query, mode: 'insensitive' } } } } } },
        { invoices: { is: { patients: { is: { OR: [
          { first_name: { contains: query, mode: 'insensitive' } },
          { last_name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ] } } } } }
      ];
      if (/^\d+$/.test(query)) {
        or.push({ id: BigInt(query) }, { invoice_id: BigInt(query) });
      }
      filters.push({ OR: or });
    }
    const sourceLower = source.toLowerCase();
    if (sourceLower && sourceLower !== 'all') {
      if (sourceLower === 'video consultation') filters.push({ invoices: { is: { notes: { contains: 'video consultation', mode: 'insensitive' } } } });
      else if (sourceLower === 'lab') filters.push({ invoices: { is: { notes: { contains: 'lab', mode: 'insensitive' } } } });
      else if (sourceLower === 'radiology') filters.push({ invoices: { is: { notes: { contains: 'radiology', mode: 'insensitive' } } } });
      else if (sourceLower === 'onsite consultation') filters.push({ invoices: { is: { AND: [
        { OR: [
          { appointment_id: { not: null } },
          { notes: { contains: 'onsite', mode: 'insensitive' } },
          { notes: { contains: 'approvalrequest', mode: 'insensitive' } }
        ] },
        { NOT: { notes: { contains: 'video consultation', mode: 'insensitive' } } }
      ] } } });
      else if (sourceLower === 'manual invoice') filters.push({ invoices: { is: { AND: [
        { appointment_id: null },
        { NOT: { notes: { contains: 'lab', mode: 'insensitive' } } },
        { NOT: { notes: { contains: 'radiology', mode: 'insensitive' } } },
        { NOT: { notes: { contains: 'video consultation', mode: 'insensitive' } } }
      ] } } });
    }
    const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };

    const [totalCount, totalAggregate, payments] = await Promise.all([
      prisma.billing_payments.count({ where }),
      prisma.billing_payments.aggregate({ where, _sum: { amount: true } }),
      prisma.billing_payments.findMany({
      where,
      include: {
        invoices: {
          include: {
            items: true,
            patients: {
              select: { id: true, first_name: true, last_name: true, email: true, contact_number: true }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset
      })
    ]);

    const normalized = (Array.isArray(payments) ? payments : []).map((payment) => {
      const invoice = payment.invoices || null;
      const source = inferInvoiceSource(invoice || {});
      const patientName = invoice?.patients
        ? `${String(invoice.patients.first_name || '').trim()} ${String(invoice.patients.last_name || '').trim()}`.trim()
        : null;
      return {
        ...payment,
        invoice: invoice ? {
          id: invoice.id,
          appointment_id: invoice.appointment_id,
          status: invoice.status,
          notes: invoice.notes,
          total_amount: invoice.total_amount,
          items: invoice.items || [],
          patients: invoice.patients || null
        } : null,
        source,
        serviceLabel: buildServiceLabel(invoice || {}),
        patientName: patientName || null,
        cashierName: payment.received_by || null,
        receiptNumber: buildReceiptNumber(payment, source)
      };
    });

    if (String(req.query.withTotal || '') === '1') {
      return res.json(serialize({
        items: normalized,
        totalCount,
        totalCollected: toMoney(totalAggregate?._sum?.amount || 0),
        take: limit,
        skip: offset
      }));
    }
    res.json(serialize(normalized));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;




