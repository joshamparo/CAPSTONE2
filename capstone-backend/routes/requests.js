const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const normalizeRole = (v) => String(v || '').trim().toLowerCase();
const headerRole = (req) => normalizeRole(req.headers['x-user-role']);
const headerName = (req) => String(req.headers['x-user-name'] || '').trim();
const headerEmail = (req) => String(req.headers['x-user-email'] || '').trim();

let requestsSchemaPromise = null;

function ensureRequestsSchema() {
  if (!requestsSchemaPromise) {
    requestsSchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.requests (
          id BIGSERIAL PRIMARY KEY,
          patient_id UUID NULL,
          patient_name TEXT NULL,
          requested_by TEXT NULL,
          message TEXT NULL,
          status TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS patient_name TEXT NULL;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS requested_by TEXT NULL;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS message TEXT NULL;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS status TEXT NULL;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS requests_status_created_idx ON public.requests(status, created_at DESC);`);
    })().catch((err) => {
      requestsSchemaPromise = null;
      throw err;
    });
  }
  return requestsSchemaPromise;
}

const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

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
}

async function ensureStockMovementsTableExist() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.stock_movements (
      id bigserial PRIMARY KEY,
      item_type text NOT NULL,
      item_id bigint NOT NULL,
      delta int NOT NULL,
      reason text NOT NULL,
      patient_id uuid NULL,
      request_id bigint NULL,
      actor_name text NULL,
      actor_role text NULL,
      note text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON public.stock_movements(item_type, item_id);`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS stock_movements_patient_idx ON public.stock_movements(patient_id);`).catch(() => {});
}

const toMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
};

function parseStructuredItemsFromMessage(msg) {
  const t = String(msg || '');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const map = {};
  lines.forEach((l) => {
    const idx = l.indexOf(':');
    if (idx > 0) {
      const k = l.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '');
      const v = l.slice(idx + 1).trim();
      map[k] = v;
    }
  });
  const itemsJsonRaw = map.itemsjson || map.items || '';
  if (!itemsJsonRaw) return [];
  try {
    const parsed = JSON.parse(itemsJsonRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

router.use(requireRole(['nurse', 'pharmacist', 'admin']));

// POST: Create a new correction request
router.post('/', async (req, res) => {
    try {
        await ensureRequestsSchema();
        const role = headerRole(req);
        if (role !== 'nurse' && role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

        const hdrName = headerName(req);
        const { patientId, patientName, requesterName, requestType, details } = req.body;

        const requestedBy = role === 'admin' ? String(requesterName || '').trim() : hdrName;
        if (!requestedBy || !requestType || !details) {
            return res.status(400).json({ message: "Requester Name, Request Type, and Details are required" });
        }

        const requestTypeClean = String(requestType || '').trim();
        if (!requestTypeClean) return res.status(400).json({ message: 'Request Type cannot be empty.' });
        const detailsTrim = String(details || '').trim();
        if (!detailsTrim) return res.status(400).json({ message: 'Details cannot be empty.' });

        if (requestTypeClean === 'Medication' || requestTypeClean === 'Supply') {
          const items = parseStructuredItemsFromMessage(detailsTrim);
          if (!items.length) return res.status(400).json({ message: `${requestTypeClean} request must include at least one item.` });
          for (const it of items) {
            const type = String(it?.type || it?.itemType || '').trim().toLowerCase();
            const itemId = String(it?.itemId || it?.id || '').trim();
            const qtyRaw = Number(it?.qty || it?.quantity || 0);
            const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.trunc(qtyRaw) : 0;
            if (!itemId || !/^\d+$/.test(itemId)) {
              return res.status(400).json({ message: `Invalid item id in ${requestTypeClean.toLowerCase()} request.` });
            }
            if (type !== 'medicine' && type !== 'supply') {
              return res.status(400).json({ message: `Item type must be medicine or supply (got ${type || 'empty'}).` });
            }
            if (qty < 1) return res.status(400).json({ message: `Quantity must be at least 1 for item ${it?.name || it?.item || itemId}.` });
            if (type === 'medicine') {
              const row = await prisma.medicines.findUnique({ where: { id: BigInt(itemId) } }).catch(() => null);
              if (!row) return res.status(400).json({ message: `Medicine not found (id ${itemId}).` });
              const stock = Number(row.stock || 0);
              if (stock <= 0) return res.status(400).json({ message: `Cannot order: no stock left for ${row.name || 'medicine'}.` });
              if (stock < qty) return res.status(400).json({ message: `Cannot order ${row.name || 'medicine'}: requested ${qty} but only ${stock} in stock.` });
            } else if (type === 'supply') {
              const row = await prisma.inventory?.findUnique?.({ where: { id: BigInt(itemId) } })
                || await prisma.supplies?.findUnique?.({ where: { id: BigInt(itemId) } })
                || null;
              if (row) {
                const stock = Number(row.stock_available ?? row.stockAvailable ?? row.stock ?? row.qty ?? row.quantity ?? 0);
                if (Number.isFinite(stock)) {
                  if (stock <= 0) return res.status(400).json({ message: `Cannot order: no stock left for ${row.name || row.item_name || 'supply'}.` });
                  if (stock < qty) return res.status(400).json({ message: `Cannot order ${row.name || row.item_name || 'supply'}: requested ${qty} but only ${stock} in stock.` });
                }
              }
            }
          }
        }

        const safePatientName = patientName != null ? String(patientName).trim() : '';

        const newRequest = await prisma.requests.create({
            data: {
                patient_id: patientId,
                patient_name: safePatientName || null,
                requested_by: requestedBy,
                // requestType isn't in the schema, using message for details
                message: detailsTrim,
                status: 'Pending'
            }
        });

        res.status(201).json({ ...serialize(newRequest), id: newRequest.id.toString() });
    } catch (err) {
        console.error("Error creating request:", err);
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

// GET: Fetch all requests (for Admin view)
router.get('/', async (req, res) => {
    try {
        await ensureRequestsSchema();
        const role = headerRole(req);
        const hdrName = headerName(req);
        const requesterName = String(req.query.requesterName || '').trim();
        const status = String(req.query.status || '').trim();
        const takeRaw = Number(req.query.take);
        const skipRaw = Number(req.query.skip);
        const take = Number.isFinite(takeRaw) ? Math.min(500, Math.max(1, takeRaw)) : 200;
        const skip = Number.isFinite(skipRaw) ? Math.min(5000, Math.max(0, skipRaw)) : 0;

        const where = {};
        if (status) where.status = status;

        if (role === 'nurse') {
            if (!hdrName) return res.status(401).json({ message: 'Unauthorized' });
            // Nurses can only see their own requests; ignore mismatched requesterName filters.
            where.requested_by = hdrName;
        } else if (requesterName) {
            where.requested_by = requesterName;
        }

        const requests = await prisma.requests.findMany({
            where,
            include: {
                patients: {
                    select: {
                        id: true,
                        first_name: true,
                        last_name: true
                    }
                }
            },
            orderBy: { created_at: 'desc' },
            take,
            skip
        });
        
        const formattedRequests = requests.map(r => ({
            ...serialize(r),
            id: r.id.toString(),
            patient_id: r.patient_id != null ? String(r.patient_id) : null,
            patient_name:
              String(r.patient_name || '').trim() ||
              (r.patients ? `${String(r.patients.first_name || '').trim()} ${String(r.patients.last_name || '').trim()}`.trim() : null),
            patient: r.patients
              ? {
                  id: String(r.patients.id),
                  first_name: r.patients.first_name,
                  last_name: r.patients.last_name
                }
              : null
        }));
        
        res.status(200).json(formattedRequests);
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

router.post('/:id/fulfill', async (req, res) => {
    try {
        const role = headerRole(req);
        const hdrName = headerName(req);
        const hdrEmail = headerEmail(req);
        if (role !== 'pharmacist' && role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

        await ensureBillingTablesExist();
        await ensureStockMovementsTableExist();

        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid request id' });
        const requestId = BigInt(idRaw);

        const current = await prisma.requests.findUnique({
            where: { id: requestId }
        });
        if (!current) return res.status(404).json({ message: 'Request not found' });

        const statusNow = String(current.status || '').trim().toLowerCase();
        if (statusNow === 'completed') return res.status(400).json({ message: 'Request is already completed' });

        const patientId = current.patient_id != null ? String(current.patient_id) : '';
        if (!patientId) return res.status(400).json({ message: 'Request has no patientId' });

        const items = parseStructuredItemsFromMessage(current.message);
        if (!items.length) return res.status(400).json({ message: 'Request has no billable items' });

        const normalizedItems = items
          .map((it) => {
            const type = String(it?.type || it?.itemType || '').trim().toLowerCase();
            const itemId = String(it?.itemId || it?.id || '').trim();
            const name = String(it?.name || it?.item || it?.item_name || '').trim();
            const qty = Math.max(1, Math.trunc(Number(it?.qty || it?.quantity || 1)));
            const unitPriceRaw = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0);
            const unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw >= 0 ? unitPriceRaw : 0;
            if (!itemId || !/^\d+$/.test(itemId)) return null;
            if (type !== 'medicine' && type !== 'supply') return null;
            const lineTotal = (Math.round(unitPrice * 100) / 100) * qty;
            const label = type === 'medicine' ? 'Medicine' : 'Supply';
            const description = `${label}: ${name || 'Item'}${qty ? ` x${qty}` : ''}`;
            return { type, itemId, name, qty, unitPrice, lineTotal, description };
          })
          .filter(Boolean);

        if (!normalizedItems.length) return res.status(400).json({ message: 'Invalid items' });

        const result = await prisma.$transaction(async (tx) => {
          for (const it of normalizedItems) {
            if (it.type === 'medicine') {
              const id = BigInt(it.itemId);
              const med = await tx.medicines.findUnique({ where: { id } }).catch(() => null);
              if (!med) throw new Error(`Medicine not found: ${it.name || it.itemId}`);
              const prev = Number(med.stock || 0);
              const next = Math.max(0, prev - it.qty);
              await tx.medicines.update({ where: { id }, data: { stock: next } });
              await tx.$executeRawUnsafe(
                `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, patient_id, request_id, actor_name, actor_role, note)
                 VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9)`,
                'medicine',
                id,
                -Math.max(0, Math.trunc(it.qty)),
                'fulfill_request',
                patientId || null,
                requestId,
                hdrName || null,
                role || null,
                it.description || null
              ).catch(() => {});
            } else if (it.type === 'supply') {
              const id = BigInt(it.itemId);
              const sup = await tx.supplies.findUnique({ where: { id } }).catch(() => null);
              if (!sup) throw new Error(`Supply not found: ${it.name || it.itemId}`);
              const prev = Number(sup.stock || 0);
              const next = Math.max(0, prev - it.qty);
              await tx.supplies.update({ where: { id }, data: { stock: next } });
              await tx.$executeRawUnsafe(
                `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, patient_id, request_id, actor_name, actor_role, note)
                 VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9)`,
                'supply',
                id,
                -Math.max(0, Math.trunc(it.qty)),
                'fulfill_request',
                patientId || null,
                requestId,
                hdrName || null,
                role || null,
                it.description || null
              ).catch(() => {});
            }
          }

          const open = await tx.billing_invoices.findFirst({
            where: {
              patient_id: patientId,
              status: { in: ['Draft', 'Ready'] }
            },
            orderBy: { created_at: 'desc' }
          }).catch(() => null);

          const invoice =
            open ||
            (await tx.billing_invoices.create({
              data: {
                patient_id: patientId,
                appointment_id: null,
                status: 'Draft',
                notes: 'Pharmacy charges',
                created_by: hdrEmail || null,
                total_amount: '0.00'
              }
            }));

          await tx.billing_invoice_items.createMany({
            data: normalizedItems.map((it) => ({
              invoice_id: invoice.id,
              description: it.description,
              quantity: it.qty,
              unit_price: toMoney(it.unitPrice),
              line_total: toMoney(it.lineTotal)
            }))
          });

          const addTotal = normalizedItems.reduce((sum, it) => sum + Number(it.lineTotal || 0), 0);
          const prevTotal = Number(invoice.total_amount || 0);
          const nextTotal = toMoney(prevTotal + addTotal);

          await tx.billing_invoices.update({
            where: { id: invoice.id },
            data: { total_amount: nextTotal, updated_at: new Date() }
          });

          const updatedRequest = await tx.requests.update({
            where: { id: requestId },
            data: { status: 'Completed' }
          });

          return { invoiceId: invoice.id, request: updatedRequest, addedAmount: toMoney(addTotal) };
        });

        prisma.activity_logs.create({
          data: {
            actor_name: hdrName || 'Pharmacist',
            role: role === 'admin' ? 'Admin' : 'Pharmacist',
            action: 'Update',
            target: `Request:${requestId.toString()}`,
            details: `Fulfilled request and added to billing • invoice ${result.invoiceId.toString()} • amount ${result.addedAmount}`
          }
        }).catch(() => {});

        res.json({
          invoiceId: result.invoiceId.toString(),
          request: { ...serialize(result.request), id: result.request.id.toString() },
          addedAmount: result.addedAmount
        });
    } catch (err) {
        const msg = String(err?.message || 'Server Error');
        const code = Number(err?.statusCode) || 500;
        res.status(code).json({ message: msg });
    }
});

// PUT: Update request status
router.put('/:id', async (req, res) => {
    try {
        const role = headerRole(req);
        const hdrName = headerName(req);
        const { status } = req.body;

        const current = await prisma.requests.findUnique({
            where: { id: BigInt(req.params.id) }
        });
        if (!current) return res.status(404).json({ message: 'Request not found' });
        if (role === 'nurse') {
            if (!hdrName) return res.status(401).json({ message: 'Unauthorized' });
            if (String(current.requested_by || '').trim() !== hdrName) return res.status(403).json({ message: 'Forbidden' });
        } else if (role !== 'pharmacist' && role !== 'admin') {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const updatedRequest = await prisma.requests.update({
            where: { id: BigInt(req.params.id) },
            data: { status }
        });
        res.json({ ...updatedRequest, id: updatedRequest.id.toString() });
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

module.exports = router;

