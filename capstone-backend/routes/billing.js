const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, parseLimit, parseOffset } = require('../utils/normalize');


const STAFF_ROLE_SET = new Set(['doctor_secretary', 'cashier', 'admin', 'doctor']);
const billingSchemaEnsureState = {
  coreCheckedAt: 0,
  adjustmentsCheckedAt: 0,
  doctorFeesCheckedAt: 0
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
    CREATE INDEX IF NOT EXISTS idx_billing_adjustments_invoice_id ON public.billing_adjustments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_billing_adjustments_created_at ON public.billing_adjustments(created_at);
  `);
  billingSchemaEnsureState.adjustmentsCheckedAt = now;
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
  const netPaid = paid - refunded;
  const balance = Math.max(0, total - netPaid);

  return { inv, total, paid, refunded, netPaid, balance };
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

    const normalized = invoices.map((inv) => {
      const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const total = Number(inv.total_amount || 0);
      const st = String(inv.status || '').trim().toLowerCase();
      const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - paid);
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
        balanceAmount: toMoney(balance),
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

    const { status, patientId, q, take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const andFilters = [];
    const st = String(status || '').trim();
    if (st) andFilters.push({ status: st });
    if (patientId) andFilters.push({ patient_id: String(patientId) });

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
        const appointmentIds = appointmentHits.map((h) => h.id);

        const searchOr = [];
        if (patientIds.length) searchOr.push({ patient_id: { in: patientIds } });
        if (appointmentIds.length) searchOr.push({ appointment_id: { in: appointmentIds } });
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

    const invoices = await prisma.billing_invoices.findMany({
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
    });

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

    const normalized = invoices.map((inv) => {
      const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const adjs = adjustmentsByInvoice[String(inv.id)] || [];
      const refunded = adjs
        .filter((a) => String(a.type || '').toLowerCase() === 'refund')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const netPaid = paid - refunded;
      const total = Number(inv.total_amount || 0);
      const st = String(inv.status || '').trim().toLowerCase();
      const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - netPaid);
      return {
        ...inv,
        appointment_status: inv.appointment_id != null ? (appointmentStatusById[String(inv.appointment_id)] || null) : null,
        adjustments: adjs,
        paid_amount: toMoney(paid),
        refunded_amount: toMoney(refunded),
        net_paid_amount: toMoney(netPaid),
        balance_amount: toMoney(balance)
      };
    });

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
    const netPaid = paid - refunded;
    const total = Number(inv.total_amount || 0);
    const st = String(inv.status || '').trim().toLowerCase();
    const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - netPaid);

    res.json(
      serialize({
        ...inv,
        appointment_status: appointmentStatus,
        adjustments,
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
    if (role !== 'doctor_secretary' && role !== 'admin' && role !== 'doctor') return res.status(401).json({ message: 'Unauthorized' });

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
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/payments', async (req, res) => {
  try {
    await ensureBillingTablesExist();
    await ensureBillingAdjustmentsTableExist().catch(() => {});
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

    const total = Number(inv.total_amount || 0);
    const paid = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const existingAdjustments = await prisma
      .$queryRawUnsafe(
        `
          SELECT type, amount
          FROM public.billing_adjustments
          WHERE invoice_id = $1::bigint
        `,
        invoiceId.toString()
      )
      .catch(() => []);
    const refunded = (Array.isArray(existingAdjustments) ? existingAdjustments : [])
      .filter((a) => String(a.type || '').toLowerCase() === 'refund')
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const netPaid = paid - refunded;
    const balance = Math.max(0, total - netPaid);

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
    const st = String(inv.status || '').trim().toLowerCase();
    const balance = st === 'cancelled' || st === 'voided' ? 0 : Math.max(0, total - netPaid);

    res.json(
      serialize({
        ...inv,
        adjustments,
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
    if (!serviceName) return res.status(400).json({ message: 'serviceName is required' });
    if (defaultFee == null) return res.status(400).json({ message: 'defaultFee must be >= 0' });

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

    const where = {};
    if (invoiceId) {
      const raw = String(invoiceId).trim();
      if (!/^\d+$/.test(raw)) return res.status(400).json({ message: 'Invalid invoiceId' });
      where.invoice_id = BigInt(raw);
    }

    const payments = await prisma.billing_payments.findMany({
      where: Object.keys(where).length ? where : undefined,
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
    });

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

    res.json(serialize(normalized));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;




