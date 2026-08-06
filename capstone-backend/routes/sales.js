const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const requireRole = require('../middleware/requireRole');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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

async function ensureSalesLinkColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS patient_id uuid NULL,
    ADD COLUMN IF NOT EXISTS invoice_id bigint NULL;
  `).catch(() => {});
}

async function loadSalesLinkMeta(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const safeIds = ids.map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  if (safeIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, patient_id, invoice_id
    FROM public.sales
    WHERE id IN (${safeIds.join(',')})
  `).catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
}

function parseNumericId(raw) {
  const s = String(raw || '').trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch (_) {
    return null;
  }
}

function formatTxn(date, seq) {
  const d = new Date(date);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const n = String(Math.max(0, Number(seq) || 0)).padStart(6, '0');
  return `TXN-${yyyy}${mm}${dd}-${n}`;
}

function parseTxnNo(raw) {
  const s = String(raw || '').trim();
  const m = /^TXN-(\d{4})(\d{2})(\d{2})-(\d{6})$/i.exec(s);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const seq = Number(m[4]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(seq)) return null;
  const start = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
  const end = new Date(Date.UTC(yyyy, mm - 1, dd + 1, 0, 0, 0));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end, seq };
}

function parseDateRange(fromRaw, toRaw) {
  const fromS = String(fromRaw || '').trim();
  const toS = String(toRaw || '').trim();
  const now = new Date();

  const from = fromS ? new Date(fromS) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const to = toS ? new Date(toS) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

  const fromOk = !Number.isNaN(from.getTime());
  const toOk = !Number.isNaN(to.getTime());
  if (!fromOk || !toOk) return null;
  return { from, to };
}

function parseTakeSkip(takeRaw, skipRaw) {
  const take = Math.max(1, Math.min(200, Number(takeRaw) || 50));
  const skip = Math.max(0, Math.min(5000, Number(skipRaw) || 0));
  return { take, skip };
}

function buildDiscountWhere(discountTypeRaw) {
  const t = String(discountTypeRaw || '').trim().toLowerCase();
  if (!t || t === 'all') return null;
  if (t === 'none') return { items: { none: { item_type: 'discount' } } };
  if (t === 'pwd') {
    return { items: { some: { item_type: 'discount', item_name: { contains: 'PWD', mode: 'insensitive' } } } };
  }
  if (t === 'senior') {
    return { items: { some: { item_type: 'discount', item_name: { contains: 'SENIOR', mode: 'insensitive' } } } };
  }
  if (t === 'custom') {
    return { items: { some: { item_type: 'discount', item_name: { contains: 'CUSTOM', mode: 'insensitive' } } } };
  }
  return null;
}

function utcDayStart(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 0, 0, 0));
}

function utcNextDayStart(d) {
  const x = utcDayStart(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + 1, 0, 0, 0));
}

function extractDiscountMeta(items) {
  const list = Array.isArray(items) ? items : [];
  const discItems = list.filter((it) => String(it?.item_type || '') === 'discount');
  const discount_amount = round2(
    discItems.reduce((sum, it) => sum + Math.max(0, -Number(it?.price_at_sale || 0)), 0)
  );
  const first = discItems[0];
  const name = String(first?.item_name || '');
  let discount_type = 'none';
  let discount_ref = null;
  const labelMatch = /Discount\s*\(([^)]+)\)/i.exec(name);
  if (labelMatch) {
    const lbl = String(labelMatch[1] || '').trim().toUpperCase();
    if (lbl.includes('PWD')) discount_type = 'pwd';
    else if (lbl.includes('SENIOR')) discount_type = 'senior';
    else if (lbl.startsWith('CUSTOM')) discount_type = 'custom';
    else discount_type = 'custom';
  } else if (discItems.length > 0) {
    discount_type = 'custom';
  }
  const refMatch = /\bRef:\s*(.+)$/i.exec(name);
  if (refMatch) discount_ref = String(refMatch[1] || '').trim().slice(0, 200) || null;
  return { discount_amount, discount_type, discount_ref };
}

function computeSubtotal(items) {
  const list = Array.isArray(items) ? items : [];
  return round2(
    list
      .filter((it) => String(it?.item_type || '') !== 'discount')
      .reduce((sum, it) => sum + Number(it?.price_at_sale || 0) * Number(it?.quantity || 0), 0)
  );
}

async function computeTxnNoForSale(sale) {
  const createdAt = new Date(sale.created_at);
  const start = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate(), 0, 0, 0));
  const end = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate() + 1, 0, 0, 0));
  const seq = await prisma.sales.count({
    where: {
      created_at: { gte: start, lt: end },
      OR: [{ created_at: { lt: createdAt } }, { created_at: createdAt, id: { lte: sale.id } }]
    }
  });
  return formatTxn(createdAt, seq);
}

function computeDiscount(subtotal, discountType, discountValueRaw) {
  const base = Math.max(0, Number(subtotal) || 0);
  const type = String(discountType || 'none').toLowerCase();
  const value = Number(discountValueRaw);

  if (!Number.isFinite(base)) return { discountAmount: 0, discountLabel: null };

  if (type === 'pwd' || type === 'senior') {
    const pct = 20;
    const amt = round2((base * pct) / 100);
    return { discountAmount: Math.min(base, Math.max(0, amt)), discountLabel: type.toUpperCase() };
  }

  if (type === 'custom_percent') {
    const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    const amt = round2((base * pct) / 100);
    return { discountAmount: Math.min(base, Math.max(0, amt)), discountLabel: `CUSTOM ${pct}%` };
  }

  if (type === 'custom_amount') {
    const amt = Number.isFinite(value) ? round2(value) : 0;
    return { discountAmount: Math.min(base, Math.max(0, amt)), discountLabel: `CUSTOM ₱${round2(amt)}` };
  }

  return { discountAmount: 0, discountLabel: null };
}

router.get('/summary', requireRole(['pharmacist', 'admin']), async (req, res) => {
  try {
    const range = parseDateRange(req.query.from, req.query.to);
    if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const pharmacist = String(req.query.pharmacist || '').trim();

    const whereSales = {
      created_at: { gte: range.from, lt: range.to },
      ...(pharmacist ? { pharmacist_name: { contains: pharmacist, mode: 'insensitive' } } : {})
    };

    const [netAgg, countTx, discAgg] = await Promise.all([
      prisma.sales.aggregate({ where: whereSales, _sum: { total_amount: true } }),
      prisma.sales.count({ where: whereSales }),
      prisma.sales_items.aggregate({
        where: { item_type: 'discount', sales: whereSales },
        _sum: { price_at_sale: true }
      })
    ]);

    const net_sales = round2(Number(netAgg?._sum?.total_amount || 0));
    const discounts_total = round2(Math.max(0, -Number(discAgg?._sum?.price_at_sale || 0)));
    const gross_sales = round2(net_sales + discounts_total);

    const topItems = pharmacist
      ? await prisma.$queryRaw`
          SELECT si.item_name, si.item_type, SUM(si.quantity)::int AS quantity, SUM(si.price_at_sale * si.quantity) AS revenue
          FROM public.sales_items si
          JOIN public.sales s ON s.id = si.sale_id
          WHERE s.created_at >= ${range.from} AND s.created_at < ${range.to}
            AND s.pharmacist_name ILIKE ${'%' + pharmacist + '%'}
            AND si.item_type <> 'discount'
          GROUP BY si.item_name, si.item_type
          ORDER BY revenue DESC
          LIMIT 5
        `
      : await prisma.$queryRaw`
          SELECT si.item_name, si.item_type, SUM(si.quantity)::int AS quantity, SUM(si.price_at_sale * si.quantity) AS revenue
          FROM public.sales_items si
          JOIN public.sales s ON s.id = si.sale_id
          WHERE s.created_at >= ${range.from} AND s.created_at < ${range.to}
            AND si.item_type <> 'discount'
          GROUP BY si.item_name, si.item_type
          ORDER BY revenue DESC
          LIMIT 5
        `;

    const top = (Array.isArray(topItems) ? topItems : []).map((r) => ({
      item_name: String(r.item_name || ''),
      item_type: String(r.item_type || ''),
      quantity: Number(r.quantity || 0),
      revenue: round2(Number(r.revenue || 0))
    }));

    res.json(
      serialize({
        from: range.from,
        to: range.to,
        gross_sales,
        discounts_total,
        net_sales,
        transactions_count: countTx,
        top_items: top
      })
    );
  } catch (err) {
    console.error('sales GET /summary failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/items', requireRole(['pharmacist', 'admin']), async (req, res) => {
  try {
    const range = parseDateRange(req.query.from, req.query.to);
    if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const pharmacist = String(req.query.pharmacist || '').trim();

    const baseWhere = {
      created_at: { gte: range.from, lt: range.to },
      ...(pharmacist ? { pharmacist_name: { contains: pharmacist, mode: 'insensitive' } } : {})
    };

    const [discountAgg, rows] = await Promise.all([
      prisma.sales_items.aggregate({
        where: { item_type: 'discount', sales: baseWhere },
        _sum: { price_at_sale: true }
      }),
      pharmacist
        ? prisma.$queryRaw`
            SELECT si.item_name, si.item_type, SUM(si.quantity)::int AS quantity, SUM(si.price_at_sale * si.quantity) AS revenue
            FROM public.sales_items si
            JOIN public.sales s ON s.id = si.sale_id
            WHERE s.created_at >= ${range.from} AND s.created_at < ${range.to}
              AND s.pharmacist_name ILIKE ${'%' + pharmacist + '%'}
              AND si.item_type <> 'discount'
            GROUP BY si.item_name, si.item_type
            ORDER BY revenue DESC
          `
        : prisma.$queryRaw`
            SELECT si.item_name, si.item_type, SUM(si.quantity)::int AS quantity, SUM(si.price_at_sale * si.quantity) AS revenue
            FROM public.sales_items si
            JOIN public.sales s ON s.id = si.sale_id
            WHERE s.created_at >= ${range.from} AND s.created_at < ${range.to}
              AND si.item_type <> 'discount'
            GROUP BY si.item_name, si.item_type
            ORDER BY revenue DESC
          `
    ]);

    const totalDiscount = round2(Math.max(0, -Number(discountAgg?._sum?.price_at_sale || 0)));
    const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
      item_name: String(r.item_name || ''),
      item_type: String(r.item_type || ''),
      quantity: Number(r.quantity || 0),
      revenue: round2(Number(r.revenue || 0))
    }));
    const totalRevenue = mapped.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
    const withImpact = mapped.map((r) => {
      const share = totalRevenue > 0 ? Number(r.revenue || 0) / totalRevenue : 0;
      const discount_impact = round2(totalDiscount * share);
      const estimated_net = round2(Math.max(0, Number(r.revenue || 0) - discount_impact));
      return { ...r, discount_impact, estimated_net };
    });

    res.json(
      serialize({
        from: range.from,
        to: range.to,
        discounts_total: totalDiscount,
        items: withImpact
      })
    );
  } catch (err) {
    console.error('sales GET /items failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', requireRole(['pharmacist', 'admin']), async (req, res) => {
  try {
    await ensureSalesLinkColumns();
    const id = parseNumericId(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });
    const sale = await prisma.sales.findUnique({
      where: { id },
      include: { items: true }
    });
    if (!sale) return res.status(404).json({ message: 'Not found' });

    const transaction_no = await computeTxnNoForSale(sale);
    const subtotal = computeSubtotal(sale.items);
    const disc = extractDiscountMeta(sale.items);
    const total_due = round2(Number(sale.total_amount || 0));
    const payment = round2(Number(sale.payment_received || 0));
    const change = round2(Number(sale.change_amount || 0));
    const linkMeta = await loadSalesLinkMeta([sale.id.toString()]);
    const meta = linkMeta.get(sale.id.toString()) || {};

    res.json(
      serialize({
        ...sale,
        patient_id: meta.patient_id || null,
        invoice_id: meta.invoice_id != null ? String(meta.invoice_id) : null,
        transaction_no,
        subtotal,
        discount_amount: disc.discount_amount,
        discount_type: disc.discount_type,
        discount_ref: disc.discount_ref,
        total_due,
        payment_received: payment,
        change_amount: change
      })
    );
  } catch (err) {
    console.error('sales GET /:id failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', requireRole(['pharmacist', 'admin']), async (req, res) => {
  try {
    await ensureSalesLinkColumns();
    const q = String(req.query.q || '').trim();
    const pharmacist = String(req.query.pharmacist || '').trim();
    const discountType = String(req.query.discountType || '').trim().toLowerCase();
    const includeItems = String(req.query.includeItems || '').trim() === '1' || String(req.query.includeItems || '').trim().toLowerCase() === 'true';
    const paymentMin = req.query.paymentMin != null && String(req.query.paymentMin).trim() !== '' ? Number(req.query.paymentMin) : null;
    const paymentMax = req.query.paymentMax != null && String(req.query.paymentMax).trim() !== '' ? Number(req.query.paymentMax) : null;
    const { take, skip } = parseTakeSkip(req.query.take, req.query.skip);

    const txn = q ? parseTxnNo(q) : null;
    if (txn) {
      const sale = await prisma.sales.findMany({
        where: { created_at: { gte: txn.start, lt: txn.end } },
        include: { items: true },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        skip: Math.max(0, txn.seq - 1),
        take: 1
      });
      const found = Array.isArray(sale) && sale.length ? sale[0] : null;
      if (!found) return res.json({ total: 0, items: [] });
      const subtotal = computeSubtotal(found.items);
      const disc = extractDiscountMeta(found.items);
      const transaction_no = await computeTxnNoForSale(found);
      const linkMeta = await loadSalesLinkMeta([found.id.toString()]);
      const meta = linkMeta.get(found.id.toString()) || {};
      return res.json(
        serialize({
          total: 1,
          items: [
            {
              id: found.id,
              patient_id: meta.patient_id || null,
              invoice_id: meta.invoice_id != null ? String(meta.invoice_id) : null,
              transaction_no,
              created_at: found.created_at,
              pharmacist_name: found.pharmacist_name,
              subtotal,
              discount_amount: disc.discount_amount,
              discount_type: disc.discount_type,
              discount_ref: disc.discount_ref,
              total_due: round2(Number(found.total_amount || 0)),
              payment_received: round2(Number(found.payment_received || 0)),
              change_amount: round2(Number(found.change_amount || 0))
            }
          ]
        })
      );
    }

    const range = parseDateRange(req.query.from, req.query.to);
    if (!range) return res.status(400).json({ message: 'Invalid date range' });

    const discountWhere = buildDiscountWhere(discountType);
    const paymentWhere = {};
    if (paymentMin != null && Number.isFinite(paymentMin)) paymentWhere.gte = paymentMin;
    if (paymentMax != null && Number.isFinite(paymentMax)) paymentWhere.lte = paymentMax;

    const whereSales = {
      created_at: { gte: range.from, lt: range.to },
      ...(pharmacist ? { pharmacist_name: { contains: pharmacist, mode: 'insensitive' } } : {}),
      ...(Object.keys(paymentWhere).length ? { payment_received: paymentWhere } : {}),
      ...(discountWhere ? discountWhere : {})
    };

    const searchOr = [];
    if (q) {
      searchOr.push({ pharmacist_name: { contains: q, mode: 'insensitive' } });
      searchOr.push({ items: { some: { item_name: { contains: q, mode: 'insensitive' } } } });
    }
    if (searchOr.length) whereSales.OR = searchOr;

    const [total, sales] = await Promise.all([
      prisma.sales.count({ where: whereSales }),
      prisma.sales.findMany({
        where: whereSales,
        include: { items: true },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take
      })
    ]);

    const salesList = Array.isArray(sales) ? sales : [];
    const saleIds = salesList.map((s) => s.id);
    const linkMeta = await loadSalesLinkMeta(saleIds.map((id) => String(id)));
    const txnSeqById = new Map();
    if (salesList.length > 0) {
      const minCreated = salesList.reduce((min, s) => (new Date(s.created_at) < min ? new Date(s.created_at) : min), new Date(salesList[0].created_at));
      const maxCreated = salesList.reduce((max, s) => (new Date(s.created_at) > max ? new Date(s.created_at) : max), new Date(salesList[0].created_at));
      const dayFrom = utcDayStart(minCreated);
      const dayTo = utcNextDayStart(maxCreated);

      const numbered = await prisma.$queryRaw`
        WITH numbered AS (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY date_trunc('day', created_at AT TIME ZONE 'UTC')
              ORDER BY created_at ASC, id ASC
            )::int AS seq
          FROM public.sales
          WHERE created_at >= ${dayFrom} AND created_at < ${dayTo}
        )
        SELECT id, seq
        FROM numbered
        WHERE id = ANY(${saleIds})
      `;
      for (const r of Array.isArray(numbered) ? numbered : []) {
        txnSeqById.set(r.id, Number(r.seq || 0));
      }
    }

    const rows = [];
    for (const s of salesList) {
      const subtotal = computeSubtotal(s.items);
      const disc = extractDiscountMeta(s.items);
      const seq = txnSeqById.get(s.id) || 0;
      const transaction_no = seq ? formatTxn(s.created_at, seq) : await computeTxnNoForSale(s);
      rows.push({
        id: s.id,
        patient_id: (linkMeta.get(String(s.id)) || {}).patient_id || null,
        invoice_id: (linkMeta.get(String(s.id)) || {}).invoice_id != null ? String((linkMeta.get(String(s.id)) || {}).invoice_id) : null,
        transaction_no,
        created_at: s.created_at,
        pharmacist_name: s.pharmacist_name,
        subtotal,
        discount_amount: disc.discount_amount,
        discount_type: disc.discount_type,
        discount_ref: disc.discount_ref,
        total_due: round2(Number(s.total_amount || 0)),
        payment_received: round2(Number(s.payment_received || 0)),
        change_amount: round2(Number(s.change_amount || 0)),
        ...(includeItems ? { items: s.items } : {})
      });
    }

    res.json(serialize({ total, items: rows }));
  } catch (err) {
    console.error('sales GET / failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST Log Sale
router.post('/', requireRole(['pharmacist', 'admin']), async (req, res) => {
    try {
        await ensureSalesLinkColumns();
        const { items, total, payment, change, pharmacist, discountType, discountValue, discountRef, patientId, createInvoice, paymentMethod, paymentReference, bulkOrder, bulkMeta } = req.body;
        const safeItems = Array.isArray(items) ? items : [];
        if (safeItems.length === 0) return res.status(400).json({ message: 'items is required' });
        const patientIdValue = String(patientId || '').trim() || null;
        const shouldCreateInvoice = Boolean(createInvoice) && !!patientIdValue;

        const normalizedItems = safeItems.map((item) => {
            const id = parseNumericId(item?.id);
            const qty = Math.max(1, Math.floor(Number(item?.quantity || 1)));
            const price = Number(item?.price || 0);
            return {
                id,
                name: String(item?.name || item?.item_name || '').slice(0, 300),
                type: String(item?.type || '').slice(0, 40),
                quantity: Number.isFinite(qty) ? qty : 1,
                price: Number.isFinite(price) ? price : 0
            };
        });

        if (normalizedItems.some((it) => it.id == null)) return res.status(400).json({ message: 'Invalid item id' });
        if (normalizedItems.some((it) => it.quantity < 1)) return res.status(400).json({ message: 'Invalid quantity' });
        if (normalizedItems.some((it) => it.price < 0)) return res.status(400).json({ message: 'Invalid price' });

        const subtotal = round2(normalizedItems.reduce((sum, it) => sum + it.price * it.quantity, 0));
        const { discountAmount, discountLabel } = computeDiscount(subtotal, discountType, discountValue);
        const totalDue = round2(Math.max(0, subtotal - discountAmount));

        const paymentNum = Number(payment);
        if (!Number.isFinite(paymentNum) || paymentNum < 0) return res.status(400).json({ message: 'Invalid payment' });
        if (paymentNum + 1e-9 < totalDue) return res.status(400).json({ message: 'Insufficient payment' });

        const changeNum = round2(paymentNum - totalDue);

        const totalNum = Number(total);
        const changeRaw = Number(change);
        if (Number.isFinite(totalNum) && Math.abs(totalNum - totalDue) > 0.01) {
            return res.status(400).json({ message: 'Total mismatch' });
        }
        if (Number.isFinite(changeRaw) && Math.abs(changeRaw - changeNum) > 0.01) {
            return res.status(400).json({ message: 'Change mismatch' });
        }

        // Using Prisma to handle the transaction logging
        // If your database is connected to Supabase, this will sync automatically
        const lineItems = normalizedItems.map((item) => ({
            item_id: item.id,
            item_name: item.name,
            item_type: item.type,
            quantity: item.quantity,
            price_at_sale: item.price
        }));
        if (bulkOrder) {
          try {
            const meta = typeof bulkMeta === 'object' && bulkMeta ? JSON.stringify(bulkMeta).slice(0, 300) : String(bulkMeta || '').slice(0,300);
            lineItems.push({
              item_id: BigInt(0),
              item_name: `BulkMeta: ${meta}`.slice(0, 300),
              item_type: 'bulk_meta',
              quantity: 1,
              price_at_sale: 0
            });
          } catch (e) {
            // ignore
          }
        }
        if (discountAmount > 0) {
            const ref = String(discountRef || '').trim();
            const label = discountLabel ? `Discount (${discountLabel}${ref ? `) Ref: ${ref}` : ')'}` : 'Discount';
            lineItems.push({
                item_id: BigInt(0),
                item_name: String(label).slice(0, 300),
                item_type: 'discount',
                quantity: 1,
                price_at_sale: -discountAmount
            });
        }

        const pharmacistName = pharmacist ? String(pharmacist).slice(0, 200) : null;
        const actorRole = String(req.headers['x-user-role'] || '').trim().toLowerCase() || 'pharmacist';

        const result = await prisma.$transaction(async (tx) => {
            // Deduct stock accurately in the same transaction
            const stockDeltas = [];
            for (const item of normalizedItems) {
                const isMedicine = item.type === 'medicine';
                const table = isMedicine ? tx.medicines : tx.supplies;
                const tableName = isMedicine ? 'medicines' : 'supplies';

                // Get current stock with read lock for safety
                const currentItem = await tx.$queryRawUnsafe(`
                  SELECT stock FROM public.${tableName}
                  WHERE id = $1 FOR UPDATE
                `, BigInt(item.id));

                const stockRow = Array.isArray(currentItem) ? currentItem[0] : null;
                const currentStock = stockRow ? Number(stockRow.stock) : 0;
                const newStock = Math.max(0, currentStock - item.quantity);
                const delta = newStock - currentStock;

                await table.update({
                    where: { id: BigInt(item.id) },
                    data: { stock: newStock }
                });

                if (delta !== 0) {
                    stockDeltas.push({ itemType: isMedicine ? 'medicine' : 'supply', itemId: BigInt(item.id), delta });
                }
            }

            const sale = await tx.sales.create({
                data: {
                    total_amount: totalDue,
                    payment_received: paymentNum,
                    change_amount: changeNum,
                    pharmacist_name: pharmacistName,
                    items: {
                        create: lineItems
                    }
                },
                include: {
                    items: true
                }
            });

            let invoiceId = null;
            if (shouldCreateInvoice) {
                try {
                    ensureBillingTablesExist();
                } catch (_) {}
                try {
                    const createdByStr = pharmacistName || actorRole;
                    const notesArr = [];
                    notesArr.push('Pharmacy POS sale');
                    if (paymentMethod) notesArr.push(`Payment: ${String(paymentMethod)}`);
                    if (paymentReference) notesArr.push(`Ref: ${String(paymentReference).slice(0,120)}`);
                    notesArr.push(`Sale ID: ${sale.id.toString()}`);
                    const inv = await tx.$queryRawUnsafe(`
                        INSERT INTO public.billing_invoices (patient_id, status, notes, created_by, total_amount, created_at, updated_at)
                        VALUES ($1::uuid, 'Paid', $2, $3, $4::numeric, now(), now())
                        RETURNING id
                    `, patientIdValue, notesArr.join(' | ').slice(0, 500), createdByStr, Number(totalDue));
                    const invRow = Array.isArray(inv) && inv.length ? inv[0] : null;
                    if (invRow?.id) {
                        invoiceId = BigInt(invRow.id);
                        let lineIdx = 0;
                        for (const item of normalizedItems) {
                            lineIdx += 1;
                            const lineTotal = round2(Number(item.price || 0) * Math.max(1, Number(item.quantity || 1)));
                            await tx.$executeRawUnsafe(`
                                INSERT INTO public.billing_invoice_items (invoice_id, line_no, description, quantity, unit_price, line_total, created_at)
                                VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, now())
                            `, invoiceId, lineIdx, String(item.name || '').slice(0, 300), Math.max(1, Number(item.quantity || 1)), Number(item.price || 0), Number(lineTotal));
                        }
                        if (discountAmount > 0) {
                            lineIdx += 1;
                            const ref = String(discountRef || '').trim();
                            const lbl = discountLabel ? `Discount (${discountLabel}${ref ? `) Ref: ${ref}` : ')'}` : 'Discount';
                            await tx.$executeRawUnsafe(`
                                INSERT INTO public.billing_invoice_items (invoice_id, line_no, description, quantity, unit_price, line_total, created_at)
                                VALUES ($1, $2, $3, 1, $4::numeric, $5::numeric, now())
                            `, invoiceId, lineIdx, String(lbl).slice(0, 300), Number(0), -Math.abs(Number(discountAmount)));
                        }
                        await tx.$executeRawUnsafe(`
                            INSERT INTO public.billing_payments (invoice_id, amount, method, reference, received_by, payment_date, idempotency_key, created_at)
                            VALUES ($1, $2::numeric, $3, $4, $5, now(), $6, now())
                        `, invoiceId, Number(paymentNum), String(paymentMethod || 'Cash').slice(0, 50), paymentReference ? String(paymentReference).slice(0, 200) : null, pharmacistName, `pharmacy-pos-sale-${sale.id.toString()}`);
                    }
                } catch (invErr) {
                    console.error('[sales] failed to create billing invoice for pharmacy POS sale', invErr);
                }
            }

            try {
              await tx.$executeRawUnsafe(
                `UPDATE public.sales
                 SET patient_id = $1,
                     invoice_id = $2
                 WHERE id = $3`,
                patientIdValue,
                invoiceId,
                BigInt(sale.id)
              );
            } catch (linkErr) {
              console.error('[sales] failed to link sale to patient/invoice:', linkErr);
            }

            // Stock movements (same txn)
            try {
                await tx.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS public.stock_movements (
                        id bigserial PRIMARY KEY,
                        item_type text NOT NULL,
                        item_id bigint NOT NULL,
                        delta integer NOT NULL,
                        reason text NOT NULL DEFAULT 'manual_adjust',
                        actor_name text NULL,
                        actor_role text NULL,
                        note text NULL,
                        created_at timestamptz NOT NULL DEFAULT now()
                    )
                `);
            } catch (_) {}
            for (const sm of stockDeltas) {
                try {
                    await tx.$executeRawUnsafe(`
                        INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, sm.itemType, sm.itemId, sm.delta, 'dispense', pharmacistName, actorRole, 'POS sale');
                } catch (_) {}
            }

            return { sale, invoice: invoiceId };
        });

        // Add Activity Log for POS Checkout
        try {
            await prisma.activity_logs.create({
                data: {
                    actor_name: pharmacist ? String(pharmacist).slice(0, 200) : 'Pharmacist',
                    role: 'Pharmacist',
                    action: 'Create',
                    target: 'Sales',
                    details: `POS Checkout completed. Total: ₱${totalDue}. Items: ${normalizedItems.length}.`
                }
            });
        } catch (e) {}

        const verifiedSale = await prisma.sales.findUnique({
          where: { id: BigInt(result.sale.id) }
        }).catch(() => null);
        if (!verifiedSale) {
          console.error('[sales] sale verification failed after create:', { saleId: String(result.sale.id) });
          return res.status(500).json({ message: 'Sale could not be verified after checkout. Please try again.' });
        }

        console.info('[sales] checkout persisted', {
          saleId: String(result.sale.id),
          patientId: patientIdValue,
          totalDue
        });

        const transaction_no = await computeTxnNoForSale(result.sale);

        res.status(201).json(
            serialize({
                ...result.sale,
                patient_id: patientIdValue,
                invoice_id: null,
                transaction_no,
                subtotal,
                discount_amount: discountAmount,
                total_due: totalDue
            })
        );
    } catch (err) {
        const msg = String(err?.message || '');
        if (msg.toLowerCase().includes('cannot convert') || msg.toLowerCase().includes('bigint')) {
            return res.status(400).json({ message: 'Invalid item id' });
        }
        console.error("Sale logging error:", err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/submit-to-admin', requireRole(['pharmacist', 'admin']), async (req, res) => {
  try {
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const pharmacistName = String(req.headers['x-user-name'] || '').trim() || 'Pharmacist';
    const from = String(req.body?.from || '').trim();
    const to = String(req.body?.to || '').trim();
    const summary = req.body?.summary || null;

    const payload = {
      from: from || null,
      to: to || null,
      summary
    };

    await prisma.activity_logs.create({
      data: {
        actor_name: pharmacistName,
        role: role === 'admin' ? 'Admin' : 'Pharmacist',
        action: 'Create',
        target: 'SalesReport',
        details: `Submitted pharmacy sales report • ${JSON.stringify(payload).slice(0, 800)}`
      }
    }).catch(() => {});

    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
