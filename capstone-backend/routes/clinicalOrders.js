const express = require('express');
const router = express.Router();
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, normalizeRole, parseLimit, parseOffset, parseDate } = require('../utils/normalize');
const { resolveClinicalServicePricing } = require('../utils/clinicalServiceCatalog');
const { recordLabOrderPayment, ensureBillingTablesExist, toMoney } = require('../utils/billingLedger');


const SCHEDULABLE_ROLE_SET = new Set(['medtech', 'radiographer', 'ecg_operator', 'physical_therapist']);
const ASSIGNABLE_ROLE_SET = new Set(['medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'pharmacist', 'cashier', 'admin']);
const AUTH_ROLE_SET = new Set(['medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'cashier', 'nurse', 'doctor', 'pharmacist', 'admin']);
const STATUS_SET = new Set(['Pending', 'For Payment', 'Paid', 'Exam', 'Result', 'Scheduled', 'In Progress', 'Completed', 'Cancelled', 'Rejected']);

const normalizeStatus = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'hmo_lab_queue') return s; // Preserve cashier queue alias literal
  if (lower === 'inprogress') return 'In Progress';
  if (lower === 'in progress') return 'In Progress';
  if (lower === 'forpayment') return 'For Payment';
  if (lower === 'for payment') return 'For Payment';
  if (lower === 'exam') return 'Exam';
  if (lower === 'result') return 'Result';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const upsertScheduleForOrder = async ({ orderId, role, staffEmail, startAt, title, notes, createdBy }) => {
  if (!orderId || !startAt || !role) return;
  const roleNorm = normalizeRole(role);
  if (!SCHEDULABLE_ROLE_SET.has(roleNorm)) return;
  const stAt = parseDate(startAt);
  if (!stAt) return;

  try {
    const existing = await prisma.$queryRaw`
      SELECT id::text AS id
      FROM public.clinical_schedule_events
      WHERE order_id = ${BigInt(orderId)}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = Array.isArray(existing) ? existing[0] : null;

    if (row && row.id) {
      await prisma.$executeRaw`
        UPDATE public.clinical_schedule_events
        SET role = ${roleNorm},
            staff_email = ${staffEmail ? normalizeEmail(staffEmail) : null},
            title = ${title || null},
            start_at = ${stAt},
            notes = ${notes || null},
            updated_at = now()
        WHERE id = ${BigInt(row.id)}
      `;
      return;
    }

    await prisma.$executeRaw`
      INSERT INTO public.clinical_schedule_events
        (role, staff_email, order_id, title, start_at, notes, created_by)
      VALUES
        (${roleNorm}, ${staffEmail ? normalizeEmail(staffEmail) : null}, ${BigInt(orderId)}, ${title || null}, ${stAt}, ${notes || null}, ${createdBy || null})
    `;
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_schedule_events') && msg.includes('does not exist')) return;
    throw err;
  }
};

router.use(requireRole(Array.from(AUTH_ROLE_SET)));

function inferActor(req) {
  const actorRole = normalizeRole(req.headers['x-user-role'] || '') || null;
  const actorName = String(req.headers['x-user-name'] || '').trim() || null;
  const actorEmail = normalizeEmail(req.headers['x-user-email'] || '') || null;
  return { actorName, actorRole, actorEmail };
}

function orderedByRoleFromActorRole(role) {
  const r = normalizeRole(role || '');
  if (!r) return null;
  if (r === 'nurse') return 'Nurse';
  if (r === 'doctor') return 'Doctor';
  return r;
}

function canAccessOrderRow(order, actor) {
  const role = normalizeRole(actor?.actorRole || '');
  if (!role) return false;
  if (role === 'admin') return true;
  if (role === 'cashier') return true;

  const orderedByRole = String(order?.orderedByRole || '').trim();
  const orderedByName = String(order?.orderedByName || '').trim();
  const assignedRole = normalizeRole(order?.assignedRole || '');
  const assignedTo = normalizeEmail(order?.assignedTo || '') || '';

  if (role === 'nurse' || role === 'doctor') {
    const expectedRole = orderedByRoleFromActorRole(role);
    const actorName = String(actor?.actorName || '').trim();
    const own = actorName && orderedByRole === expectedRole && orderedByName === actorName;
    if (own) return true;
    if (assignedRole && assignedRole === role) return true;
    if (assignedTo && actor?.actorEmail && assignedTo === actor.actorEmail) return true;
    return false;
  }

  if (assignedRole && assignedRole === role) return true;
  if (assignedTo && actor?.actorEmail && assignedTo === actor.actorEmail) return true;
  return false;
}

function canTransitionStatus({ fromStatus, toStatus, actorRole, assignedRole }) {
  const from = String(fromStatus || '').trim();
  const to = String(toStatus || '').trim();
  const role = normalizeRole(actorRole || '');
  const assigned = normalizeRole(assignedRole || '');

  if (!to || to === from) return true;
  if (role === 'admin') return true;

  if (to === 'Paid') {
    if (from !== 'For Payment') return false;
    return role === 'cashier';
  }

  if (to === 'Exam') {
    if (from !== 'Paid') return false;
    return Boolean(assigned && role === assigned);
  }

  if (to === 'Result') {
    if (from !== 'Exam') return false;
    return Boolean(assigned && role === assigned);
  }

  if (to === 'Completed') {
    if (from !== 'Result') return false;
    return Boolean(assigned && role === assigned);
  }

  return true;
}

function enrichClinicalOrder(order) {
  const row = order && typeof order === 'object' ? { ...order } : {};
  const pricing = resolveClinicalServicePricing({ kind: row.kind, service: row.service });
  const statusNorm = String(row.status || '').toLowerCase();
  const statusIsForPayment = statusNorm === 'for payment';
  const statusIsPaid = statusNorm === 'paid';
  const linkedInvoiceTotal = Number(row.linkedInvoiceTotal || 0);
  const realTotal = pricing.unitPrice > 0 ? pricing.unitPrice : (linkedInvoiceTotal > 0 ? linkedInvoiceTotal : 0);
  const h = row.linkedHmoClaim && typeof row.linkedHmoClaim === 'object' ? row.linkedHmoClaim : null;
  const hmoProvider = h && String(h.hmo_provider || '').trim();
  const hmoLoa = h && String(h.hmo_loa_number || '').trim();
  const hmoCard = h && String(h.hmo_card_number || '').trim();
  const phDed = h ? Math.max(0, Number(h.philhealth_deduction || 0)) : 0;
  const hmoLoaAmt = h ? Math.max(0, Number(h.loa_approved_amount || 0)) : 0;
  const hmoClaimStatus = h ? String(h.status || '') : '';
  const hmoApplied = !!(hmoProvider || hmoLoa || hmoCard || (phDed + hmoLoaAmt > 0));
  const hmoStatusApplied = ['Approved', 'Partially Approved', 'Pending', 'Ready', 'Paid', 'approved', 'partially approved'].includes(String(hmoClaimStatus || '').trim());
  const maxAfterPh = Math.max(0, realTotal - phDed);
  const realHmoCovered = hmoStatusApplied && hmoApplied ? Math.min(maxAfterPh, hmoLoaAmt) : (statusIsPaid && hmoApplied ? realTotal - phDed : 0);
  const patientPayable = Math.max(0, realTotal - phDed - realHmoCovered);
  const isHmoPrePaid = !!(statusIsPaid && hmoApplied);
  return {
    ...row,
    pricing,
    priceConfigured: pricing.configured,
    priceSource: pricing.source,
    priceLabel: pricing.serviceLabel,
    currency: pricing.currency,
    unitPrice: pricing.unitPrice,
    amountDue: statusIsPaid
      ? Math.max(0, patientPayable)
      : (statusIsForPayment && hmoApplied ? Math.max(0, patientPayable) : realTotal),
    configuredUnitPrice: realTotal,
    patientPayable: Math.max(0, patientPayable),
    originalTotal: realTotal,
    philhealthApplied: phDed,
    hmoCoverageApplied: realHmoCovered,
    hmoIndicators: {
      isHmoPrePaid,
      hasHmo: hmoApplied,
      provider: hmoProvider || '',
      loaNumber: hmoLoa || '',
      cardNumber: hmoCard || '',
      status: hmoClaimStatus || (statusIsPaid ? 'Approved' : '')
    }
  };
}

router.get('/', async (req, res) => {
  try {
    const actor = inferActor(req);
    if (!actor.actorRole) return res.status(401).json({ message: 'Unauthorized' });
    const { role, status, kind, patientId, dateFrom, dateTo, orderedByRole, orderedByName, assignedRole, take, skip } = req.query;
    const limit = parseLimit(take, { min: 1, max: 500, fallback: 200 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });
    const df = dateFrom ? parseDate(dateFrom) : null;
    const dt = dateTo ? parseDate(dateTo) : null;
    if (dateFrom && !df) return res.status(400).json({ message: 'Invalid dateFrom' });
    if (dateTo && !dt) return res.status(400).json({ message: 'Invalid dateTo' });

    const where = {};

    const requestedStatus = status && String(status).trim() !== 'All' ? normalizeStatus(status) : '';
    if (requestedStatus) where.status = requestedStatus;
    if (kind && String(kind).trim() !== 'All') where.kind = String(kind).trim();

    const orderedByRoleTrim = String(orderedByRole || '').trim();
    const orderedByNameTrim = String(orderedByName || '').trim();
    if (orderedByRoleTrim) where.ordered_by_role = orderedByRoleTrim;
    if (orderedByNameTrim) where.ordered_by_name = orderedByNameTrim;

    const roleNorm = role ? normalizeRole(role) : '';
    const assignedRoleNorm = assignedRole ? normalizeRole(assignedRole) : '';
    if (roleNorm) where.assigned_role = roleNorm;
    if (assignedRoleNorm) where.assigned_role = assignedRoleNorm;

    if (patientId) {
      const pid = String(patientId).trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) {
        return res.status(400).json({ message: 'Invalid patientId' });
      }
      where.patient_id = pid;
    }

    if (df || dt) {
      where.scheduled_at = {};
      if (df) where.scheduled_at.gte = df;
      if (dt) where.scheduled_at.lte = dt;
    }

    if (actor.actorRole !== 'admin') {
      if (actor.actorRole === 'nurse' || actor.actorRole === 'doctor') {
        const expectedRole = orderedByRoleFromActorRole(actor.actorRole);
        const or = [];
        if (actor.actorName) {
          or.push({ ordered_by_role: expectedRole, ordered_by_name: actor.actorName });
        }
        or.push({ assigned_role: actor.actorRole });
        if (actor.actorEmail) or.push({ assigned_to: actor.actorEmail });
        where.OR = or;
      } else {
        if (actor.actorRole === 'cashier') {
          if (requestedStatus === 'For Payment') {
            const base = { ...where };
            delete base.status;
            delete base.OR;
            where.AND = [
              base,
              { OR: [{ status: 'For Payment' }, { status: 'Paid' }, { status: 'Pending', assigned_role: { in: Array.from(SCHEDULABLE_ROLE_SET) } }] }
            ];
            delete where.status;
            delete where.OR;
          } else if (requestedStatus === 'hmo_lab_queue') {
            const base = { ...where };
            delete base.status;
            delete base.OR;
            where.AND = [
              base,
              {
                OR: [
                  { status: 'For Payment' },
                  { status: 'Paid' },
                  { status: 'Pending', assigned_role: { in: Array.from(SCHEDULABLE_ROLE_SET) } }
                ]
              },
              { assigned_role: { in: ['medtech', 'radiographer', 'ecg_operator', 'lab_technician', 'laboratory_technician', 'imaging_technician'] } }
            ];
            delete where.status;
            delete where.OR;
          } else if (!where.status) {
            where.status = { in: ['For Payment', 'Paid'] };
          }
        } else {
        if (roleNorm && roleNorm !== actor.actorRole) return res.status(403).json({ message: 'Forbidden' });
        if (assignedRoleNorm && assignedRoleNorm !== actor.actorRole) return res.status(403).json({ message: 'Forbidden' });
        if (actor.actorEmail) {
          where.OR = [{ assigned_role: actor.actorRole }, { assigned_to: actor.actorEmail }];
          delete where.assigned_role;
        } else {
          where.assigned_role = actor.actorRole;
        }
        }
      }
    }

    const rows = await prisma.clinical_orders.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        patient_id: true,
        patient_name: true,
        kind: true,
        service: true,
        priority: true,
        status: true,
        notes: true,
        ordered_by_name: true,
        ordered_by_role: true,
        assigned_role: true,
        assigned_to: true,
        scheduled_at: true,
        completed_at: true,
        acknowledged_at: true,
        acknowledged_by: true,
        created_at: true,
        updated_at: true
      }
    });

    const orderIdsForLookup = (Array.isArray(rows) ? rows : [])
      .map((r) => String(r.id || ''))
      .filter((x) => x);

    const linkedInvoicesMap = new Map();
    const claimPerInvoice = new Map();
    if (orderIdsForLookup.length > 0) {
      try {
        const placeholders = orderIdsForLookup.map((_, i) => `$${i + 1}`).join(',');
        const params = orderIdsForLookup.map((id) => BigInt(id));
        const invRows = await prisma.$queryRawUnsafe(
          `SELECT id::text AS invoice_id, notes, total_amount, status, patient_id::text AS patient_id
           FROM public.billing_invoices
           WHERE EXISTS (
             SELECT 1 FROM (VALUES ${placeholders
               .split(',')
               .map((p, i) => `(${p})`)
               .join(',')}
             ) AS v(id)
             WHERE notes ILIKE '%Lab Order #' || v.id::text || '%'
           )
           LIMIT 500`,
          ...params
        ).catch(() => []);
        (Array.isArray(invRows) ? invRows : []).forEach((inv) => {
          const m = String(inv.notes || '').match(/Lab Order #(\d+)/);
          if (m && m[1]) linkedInvoicesMap.set(m[1], inv);
        });

        const invoiceIds = Array.from(new Set((Array.isArray(invRows) ? invRows : []).map((inv) => String(inv.invoice_id || '')).filter(Boolean)));
        if (invoiceIds.length > 0) {
          const claimPlaceholders = invoiceIds.map((_, i) => `$${i + 1}`).join(',');
          const claimParams = invoiceIds.map((id) => BigInt(id));
          const claimRows = await prisma.$queryRawUnsafe(
            `SELECT invoice_id::text AS invoice_id, hmo_provider, hmo_loa_number, hmo_card_number, philhealth_deduction, loa_approved_amount, status
             FROM public.billing_hmo_claims
             WHERE invoice_id IN (${claimPlaceholders})`,
            ...claimParams
          ).catch(() => []);
          (Array.isArray(claimRows) ? claimRows : []).forEach((c) => {
            if (c && c.invoice_id) claimPerInvoice.set(String(c.invoice_id), c);
          });
        }
      } catch (_lookup) {
        console.warn('[clinicalOrders] invoice lookup warn:', _lookup?.message || _lookup);
      }
    }

    const mapped = (Array.isArray(rows) ? rows : []).map((r) => {
      const idStr = r.id != null ? String(r.id) : '';
      const inv = linkedInvoicesMap.get(idStr) || null;
      const invId = inv && inv.invoice_id ? String(inv.invoice_id) : '';
      const hmoClaimSummary = invId ? claimPerInvoice.get(invId) || null : null;
      return enrichClinicalOrder({
        id: idStr,
        patientId: r.patient_id || null,
        patientName: r.patient_name || null,
        kind: r.kind || null,
        service: r.service || null,
        priority: r.priority || null,
        status: r.status || null,
        notes: r.notes || null,
        orderedByName: r.ordered_by_name || null,
        orderedByRole: r.ordered_by_role || null,
        assignedRole: r.assigned_role || null,
        assignedTo: r.assigned_to || null,
        scheduledAt: r.scheduled_at || null,
        completedAt: r.completed_at || null,
        acknowledgedAt: r.acknowledged_at || null,
        acknowledgedBy: r.acknowledged_by || null,
        createdAt: r.created_at || null,
        updatedAt: r.updated_at || null,
        linkedInvoiceId: inv?.invoice_id ? String(inv.invoice_id) : null,
        linkedInvoiceStatus: inv?.status || null,
        linkedInvoiceTotal: inv?.total_amount != null ? Number(inv.total_amount || 0) : null,
        linkedHmoClaim: hmoClaimSummary || null
      });
    });

    res.json(mapped);
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_orders') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_orders table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ message: 'Invalid id' });
    const actor = inferActor(req);
    if (!actor.actorRole) return res.status(401).json({ message: 'Unauthorized' });

    const rows = await prisma.$queryRaw`
      SELECT
        id::text AS id,
        patient_id AS "patientId",
        patient_name AS "patientName",
        kind,
        service,
        priority,
        status,
        notes,
        ordered_by_name AS "orderedByName",
        ordered_by_role AS "orderedByRole",
        assigned_role AS "assignedRole",
        assigned_to AS "assignedTo",
        scheduled_at AS "scheduledAt",
        completed_at AS "completedAt",
        acknowledged_at AS "acknowledgedAt",
        acknowledged_by AS "acknowledgedBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.clinical_orders
      WHERE id = ${BigInt(orderId)}
      LIMIT 1
    `;

    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (!canAccessOrderRow(order, actor)) return res.status(403).json({ message: 'Forbidden' });

    const events = await prisma.$queryRaw`
      SELECT
        id::text AS id,
        order_id::text AS "orderId",
        actor_name AS "actorName",
        actor_role AS "actorRole",
        action,
        from_status AS "fromStatus",
        to_status AS "toStatus",
        note,
        created_at AS "createdAt"
      FROM public.clinical_order_events
      WHERE order_id = ${BigInt(orderId)}
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const results = await prisma.$queryRaw`
      SELECT
        id::text AS id,
        patient_id AS "patientId",
        order_id::text AS "orderId",
        type,
        title,
        url,
        result_date AS "resultDate",
        uploaded_by AS "uploadedBy",
        created_at AS "createdAt",
        verification_status AS "verificationStatus",
        verification_score AS "verificationScore",
        verification_flags AS "verificationFlags",
        verified_at AS "verifiedAt"
      FROM public.lab_results
      WHERE order_id = ${BigInt(orderId)}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    res.json({
      order: enrichClinicalOrder(order),
      events: Array.isArray(events) ? events : [],
      results: Array.isArray(results) ? results : []
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_orders') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_orders table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(500).json({ message: msg || 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const actorFromHeaders = inferActor(req);
    if (!actorFromHeaders.actorRole) return res.status(401).json({ message: 'Unauthorized' });
    const {
      patientId,
      patientName,
      kind,
      service,
      priority,
      notes,
      orderedByName,
      orderedByRole,
      assignedRole,
      assignedTo,
      scheduledAt,
      actorName,
      actorRole
    } = req.body || {};

    if (actorFromHeaders.actorRole !== 'admin' && (actorFromHeaders.actorRole === 'nurse' || actorFromHeaders.actorRole === 'doctor') && !actorFromHeaders.actorName) {
      return res.status(400).json({ message: 'Missing x-user-name header' });
    }

    const roleNorm = normalizeRole(assignedRole);
    if (assignedRole && roleNorm && !ASSIGNABLE_ROLE_SET.has(roleNorm)) {
      return res.status(400).json({ message: 'Invalid assignedRole' });
    }

    const pr = String(priority || 'Routine').trim() || 'Routine';
    const pricing = resolveClinicalServicePricing({ kind, service });
    const payBeforeExam = Boolean(roleNorm && SCHEDULABLE_ROLE_SET.has(roleNorm) && pricing?.configured && Number(pricing?.unitPrice || 0) > 0);
    const st = normalizeStatus(payBeforeExam ? 'For Payment' : 'Pending') || (payBeforeExam ? 'For Payment' : 'Pending');

    const patientUuid = patientId ? String(patientId) : null;
    const orderedByRoleFinal = actorFromHeaders.actorRole === 'admin'
      ? (String(orderedByRole || '').trim() || null)
      : (orderedByRoleFromActorRole(actorFromHeaders.actorRole) || null);
    const orderedByNameFinal = actorFromHeaders.actorRole === 'admin'
      ? (orderedByName || actorFromHeaders.actorName || null)
      : (actorFromHeaders.actorName || null);
    const actorNameFinal = actorFromHeaders.actorRole === 'admin'
      ? (actorName || orderedByNameFinal || null)
      : (actorFromHeaders.actorName || null);
    const actorRoleFinal = actorFromHeaders.actorRole === 'admin'
      ? (actorRole || orderedByRoleFinal || actorFromHeaders.actorRole || null)
      : (actorFromHeaders.actorRole || null);

    const inserted = await prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO public.clinical_orders
          (patient_id, patient_name, kind, service, priority, status, notes, ordered_by_name, ordered_by_role, assigned_role, assigned_to, scheduled_at, updated_at)
        VALUES
          (${patientUuid}::uuid,
           ${patientName || null},
           ${kind || null},
           ${service || null},
           ${pr},
           ${st},
           ${notes || null},
           ${orderedByNameFinal},
           ${orderedByRoleFinal},
           ${assignedRole ? roleNorm : null},
           ${assignedTo || null},
           ${scheduledAt ? new Date(scheduledAt) : null},
           now())
        RETURNING id::text AS id
      `
    );

    const createdId = Array.isArray(inserted) ? inserted[0]?.id : null;
    if (!createdId) return res.status(500).json({ message: 'Create failed' });

    // Auto-add priced clinical orders to the patient's Draft invoice (cashier can see it immediately).
    try {
      const pricingForBill = resolveClinicalServicePricing({ kind, service });
      const unitPrice = Number(pricingForBill?.unitPrice || 0);
      if (pricingForBill?.configured && Number.isFinite(unitPrice) && unitPrice > 0 && patientUuid) {
        await ensureBillingTablesExist(prisma);
        const marker = `Clinical Order #${String(createdId)}`;
        const descriptionBase = `Clinical Order - ${String(kind || 'Service').trim()}${service ? `: ${String(service).trim()}` : ''}`.trim();
        const priceMoney = toMoney(unitPrice);

        await prisma.$transaction(async (tx) => {
          const open = await tx.billing_invoices.findFirst({
            where: { patient_id: patientUuid, status: { in: ['Draft', 'Ready'] } },
            orderBy: { created_at: 'desc' }
          }).catch(() => null);

          const inv =
            open ||
            (await tx.billing_invoices.create({
              data: {
                patient_id: patientUuid,
                appointment_id: null,
                status: 'Draft',
                notes: 'Walk-in charges',
                created_by: actorFromHeaders.actorEmail || null,
                total_amount: '0.00'
              }
            }));

          const existingItem = await tx.billing_invoice_items.findFirst({
            where: { invoice_id: inv.id, description: { contains: marker } },
            orderBy: { created_at: 'desc' }
          }).catch(() => null);

          if (!existingItem) {
            await tx.billing_invoice_items.create({
              data: {
                invoice_id: inv.id,
                description: `${descriptionBase} â€¢ ${marker}`,
                quantity: 1,
                unit_price: priceMoney,
                line_total: priceMoney
              }
            });

            const prevTotal = Number(inv.total_amount || 0);
            const nextTotal = toMoney(prevTotal + unitPrice);
            await tx.billing_invoices.update({
              where: { id: inv.id },
              data: { total_amount: nextTotal, updated_at: new Date() }
            });
          }
        });
      }
    } catch (_) {
      // Leave the order created even if billing tables are missing or invoice update fails.
    }

    await prisma.$executeRaw`
      INSERT INTO public.clinical_order_events
        (order_id, actor_name, actor_role, action, from_status, to_status, note)
      VALUES
        (${BigInt(createdId)}, ${actorNameFinal}, ${actorRoleFinal}, 'Create', NULL, ${st}, ${notes || null})
    `;

    if (scheduledAt && assignedRole) {
      await upsertScheduleForOrder({
        orderId: createdId,
        role: roleNorm,
        staffEmail: assignedTo ? normalizeEmail(assignedTo) : null,
        startAt: scheduledAt,
        title: `${String(kind || 'Procedure')}${service ? `: ${service}` : ''}`.trim(),
        notes: notes || null,
        createdBy: actorNameFinal
      });
    }

    prisma.activity_logs.create({
      data: {
        actor_name: actorNameFinal,
        role: String(actorRoleFinal || '').trim() || 'Staff',
        action: 'Create',
        target: `ClinicalOrder:${createdId}`,
        details: `${String(kind || 'Order')}${service ? `: ${service}` : ''} • ${String(priority || pr || 'Routine')}`.trim()
      }
    }).catch(() => {});

    const rows = await prisma.$queryRaw`
      SELECT
        id::text AS id,
        patient_id AS "patientId",
        patient_name AS "patientName",
        kind,
        service,
        priority,
        status,
        notes,
        ordered_by_name AS "orderedByName",
        ordered_by_role AS "orderedByRole",
        assigned_role AS "assignedRole",
        assigned_to AS "assignedTo",
        scheduled_at AS "scheduledAt",
        completed_at AS "completedAt",
        acknowledged_at AS "acknowledgedAt",
        acknowledged_by AS "acknowledgedBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.clinical_orders
      WHERE id = ${BigInt(createdId)}
      LIMIT 1
    `;

    res.status(201).json(enrichClinicalOrder(Array.isArray(rows) ? rows[0] : null));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_orders') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_orders table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(400).json({ message: msg || 'Bad request' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ message: 'Invalid id' });

    const actorFromHeaders = inferActor(req);
    if (!actorFromHeaders.actorRole) return res.status(401).json({ message: 'Unauthorized' });
    const {
      status,
      assignedRole,
      assignedTo,
      scheduledAt,
      acknowledged,
      notes,
      actorName,
      actorRole,
      eventNote,
      paymentReference,
      paymentMethod
    } = req.body || {};

    const currentRows = await prisma.$queryRaw`
      SELECT
        status,
        kind,
        service,
        patient_id AS "patientId",
        patient_name AS "patientName",
        ordered_by_name AS "orderedByName",
        ordered_by_role AS "orderedByRole",
        assigned_role AS "assignedRole",
        assigned_to AS "assignedTo"
      FROM public.clinical_orders
      WHERE id = ${BigInt(orderId)}
      LIMIT 1
    `;
    const current = Array.isArray(currentRows) ? currentRows[0] : null;
    if (!current) return res.status(404).json({ message: 'Not found' });
    if (!canAccessOrderRow(current, actorFromHeaders)) return res.status(403).json({ message: 'Forbidden' });

    const data = {};
    const newStatus = status !== undefined ? normalizeStatus(status) : null;
    if (newStatus) {
      if (!STATUS_SET.has(newStatus)) return res.status(400).json({ message: 'Invalid status' });
      const pricing = newStatus === 'Paid' ? resolveClinicalServicePricing({ kind: current.kind, service: current.service }) : null;
      const assignedRoleNorm = normalizeRole(current.assignedRole || '');
      const payBeforeExam = Boolean(assignedRoleNorm && SCHEDULABLE_ROLE_SET.has(assignedRoleNorm) && pricing?.configured && Number(pricing?.unitPrice || 0) > 0);
      const effectiveFromStatus =
        newStatus === 'Paid' &&
        String(current.status || '').trim() === 'Pending' &&
        normalizeRole(actorFromHeaders.actorRole || '') === 'cashier' &&
        payBeforeExam
          ? 'For Payment'
          : current.status;

      if (!canTransitionStatus({ fromStatus: effectiveFromStatus, toStatus: newStatus, actorRole: actorFromHeaders.actorRole, assignedRole: current.assignedRole })) {
        return res.status(403).json({ message: 'Forbidden status transition' });
      }
      if (newStatus === 'Paid') {
        if (!pricing.configured || !(Number(pricing.unitPrice) > 0)) {
          return res.status(400).json({ message: 'No cashier price is configured for this service yet.' });
        }
        const orderIdBigInt = String(orderId);
        let hmoPh = 0;
        let hmoLoaAmt = 0;
        let hmoApplied = false;
        try {
          const marker = `%Lab Order #${orderIdBigInt}%`;
          const invLookup = await prisma.$queryRawUnsafe(
            `SELECT i.id::text AS inv_id, c.philhealth_deduction, c.loa_approved_amount, c.hmo_provider, c.hmo_loa_number, c.status AS claim_status
             FROM public.billing_invoices i
             LEFT JOIN public.billing_hmo_claims c ON c.invoice_id = i.id
             WHERE i.notes ILIKE $1 LIMIT 1`,
            marker
          ).catch(() => []);
          const f = Array.isArray(invLookup) && invLookup.length ? invLookup[0] : null;
          if (f) {
            hmoPh = Math.max(0, Number(f.philhealth_deduction || 0));
            hmoLoaAmt = Math.max(0, Number(f.loa_approved_amount || 0));
            const status = String(f.claim_status || '').toLowerCase();
            const hasAny = !!(f.hmo_provider || f.hmo_loa_number || hmoPh + hmoLoaAmt > 0);
            if (hasAny && ['approved', 'partially approved', 'pending', 'ready', 'paid'].includes(status)) {
              hmoApplied = true;
            } else if (hasAny && status === '' && hmoPh + hmoLoaAmt > 0) {
              hmoApplied = true;
            }
          }
        } catch (_h) {}
        const gross = Number(pricing.unitPrice || 0);
        const afterPh = Math.max(0, gross - hmoPh);
        const realHmoCovered = hmoApplied ? Math.min(afterPh, hmoLoaAmt) : 0;
        const patientPayable = Math.max(0, gross - hmoPh - realHmoCovered);

        const ref = String(paymentReference || '').trim() || String(eventNote || '').trim();
        if (!ref) return res.status(400).json({ message: 'Receipt/reference is required to mark as Paid' });
        const paymentAmount = Number(req.body?.paymentAmount ?? req.body?.amountReceived ?? 0);
        if (patientPayable <= 0) {
          if (!ref) return res.status(400).json({ message: 'Receipt/reference is required for HMO-covered order.' });
        } else {
          if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({ message: 'Amount received is required.' });
          }
          if (paymentAmount + 0.0001 < patientPayable) {
            return res.status(400).json({ message: `Amount received is below amount due of PHP ${patientPayable.toFixed(2)} (gross ${gross.toFixed(2)}${hmoPh > 0 ? ` - PH ${hmoPh.toFixed(2)}` : ''}${realHmoCovered > 0 ? ` - HMO ${realHmoCovered.toFixed(2)}` : ''}).` });
          }
        }
      }
      data.status = newStatus;
      data.completed_at = newStatus === 'Completed' ? new Date() : null;
    }

    if (notes !== undefined) data.notes = notes || null;

    const roleNorm = assignedRole !== undefined ? normalizeRole(assignedRole) : null;
    if (assignedRole !== undefined) {
      if (roleNorm && !ASSIGNABLE_ROLE_SET.has(roleNorm)) return res.status(400).json({ message: 'Invalid assignedRole' });
      data.assigned_role = roleNorm || null;
    }

    if (assignedTo !== undefined) data.assigned_to = assignedTo ? normalizeEmail(assignedTo) : null;

    const sched = scheduledAt !== undefined && scheduledAt !== null && String(scheduledAt).trim()
      ? new Date(scheduledAt)
      : (scheduledAt === null ? null : undefined);
    if (sched !== undefined) data.scheduled_at = sched;

    if (acknowledged === true) {
      data.acknowledged_at = new Date();
      data.acknowledged_by = actorName || actorFromHeaders.actorName || actorFromHeaders.actorEmail || null;
    }

    data.updated_at = new Date();

    if (newStatus === 'Paid') {
      await recordLabOrderPayment(prisma, {
        orderId,
        patientId: current.patientId || null,
        patientName: current.patientName || null,
        service: current.service || null,
        kind: current.kind || null,
        amount: Number(resolveClinicalServicePricing({ kind: current.kind, service: current.service }).unitPrice || 0),
        method: paymentMethod || null,
        reference: String(paymentReference || '').trim() || null,
        receivedBy: actorFromHeaders.actorEmail || null
      });
    }

    await prisma.clinical_orders.update({
      where: { id: BigInt(orderId) },
      data
    });

    const action =
      acknowledged === true ? 'Acknowledge' :
      newStatus && newStatus !== current.status ? 'Status' :
      assignedRole !== undefined || assignedTo !== undefined ? 'Assign' :
      scheduledAt !== undefined ? 'Schedule' :
      notes !== undefined ? 'Note' : 'Update';

    const paymentPricing = resolveClinicalServicePricing({ kind: current.kind, service: current.service });
    const paymentAmountReceived = Number(req.body?.paymentAmount ?? req.body?.amountReceived ?? 0);
    const paymentAmountDue = Number(paymentPricing.unitPrice || 0);
    const paymentChange = Number.isFinite(paymentAmountReceived) ? Math.max(0, paymentAmountReceived - paymentAmountDue) : 0;
    const paymentAmountNote = newStatus === 'Paid' && paymentAmountDue > 0 && Number.isFinite(paymentAmountReceived)
      ? `Amount due PHP ${paymentAmountDue.toFixed(2)} â€¢ Received PHP ${paymentAmountReceived.toFixed(2)}${paymentChange > 0 ? ` â€¢ Change PHP ${paymentChange.toFixed(2)}` : ''}`
      : '';

    const inferredPaymentNote = (() => {
      if (!newStatus || newStatus !== 'Paid') return '';
      const ref = String(paymentReference || '').trim();
      const method = String(paymentMethod || '').trim();
      if (ref && method) return `Payment recorded • ${method} • ${ref}`;
      if (ref) return `Payment recorded • ${ref}`;
      return '';
    })();

    await prisma.clinical_order_events.create({
      data: {
        order_id: BigInt(orderId),
        actor_name: actorFromHeaders.actorRole === 'admin' ? (actorName || actorFromHeaders.actorName || null) : (actorFromHeaders.actorName || null),
        actor_role: actorFromHeaders.actorRole === 'admin' ? (actorRole || actorFromHeaders.actorRole || null) : (actorFromHeaders.actorRole || null),
        action,
        from_status: newStatus && newStatus !== current.status ? current.status : null,
        to_status: newStatus && newStatus !== current.status ? newStatus : null,
        note: inferredPaymentNote
          ? `${inferredPaymentNote}${paymentAmountNote ? ` â€¢ ${paymentAmountNote}` : ''}`
          : (eventNote || (notes !== undefined ? notes : null))
      }
    });

    const finalRole = assignedRole !== undefined ? roleNorm : normalizeRole(current.assignedRole);
    if (scheduledAt !== undefined && scheduledAt !== null) {
      await upsertScheduleForOrder({
        orderId,
        role: finalRole,
        staffEmail: assignedTo ? normalizeEmail(assignedTo) : null,
        startAt: scheduledAt,
        title: null,
        notes: notes || null,
        createdBy: actorName || actorFromHeaders.actorName || null
      });
    }

    prisma.activity_logs.create({
      data: {
        actor_name: actorFromHeaders.actorRole === 'admin' ? (actorName || actorFromHeaders.actorName || null) : (actorFromHeaders.actorName || null),
        role: String(actorFromHeaders.actorRole === 'admin' ? (actorRole || actorFromHeaders.actorRole || '') : (actorFromHeaders.actorRole || '')).trim() || 'Staff',
        action: 'Update',
        target: `ClinicalOrder:${orderId}`,
        details: action === 'Status' && newStatus
          ? `Status: ${current.status} → ${newStatus}${newStatus === 'Paid' && eventNote ? ` (${String(eventNote).slice(0, 120)})` : ''}`
          : action
      }
    }).catch(() => {});

    const rows = await prisma.$queryRaw`
      SELECT
        id::text AS id,
        patient_id AS "patientId",
        patient_name AS "patientName",
        kind,
        service,
        priority,
        status,
        notes,
        ordered_by_name AS "orderedByName",
        ordered_by_role AS "orderedByRole",
        assigned_role AS "assignedRole",
        assigned_to AS "assignedTo",
        scheduled_at AS "scheduledAt",
        completed_at AS "completedAt",
        acknowledged_at AS "acknowledgedAt",
        acknowledged_by AS "acknowledgedBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.clinical_orders
      WHERE id = ${BigInt(orderId)}
      LIMIT 1
    `;

    res.json(enrichClinicalOrder(Array.isArray(rows) ? rows[0] : null));
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('clinical_orders') && msg.includes('does not exist')) {
      return res.status(500).json({ message: 'clinical_orders table is missing. Run prisma/manual_migration_clinical_orders.sql on Supabase.' });
    }
    res.status(400).json({ message: msg || 'Bad request' });
  }
});

module.exports = router;


