const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { sendError } = require('../utils/httpErrors');

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.restock_requests (
      id BIGSERIAL PRIMARY KEY,
      item_type TEXT NOT NULL,
      item_id BIGINT NOT NULL,
      item_name TEXT,
      requested_qty INT NOT NULL DEFAULT 0,
      fulfilled_qty INT NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'Normal',
      status TEXT NOT NULL DEFAULT 'Pending',
      note TEXT,
      requested_by TEXT,
      fulfilled_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS restock_requests_status_created_at_idx ON public.restock_requests(status, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS restock_requests_item_idx ON public.restock_requests(item_type, item_id);`);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS restock_requests_open_item_unique_idx
    ON public.restock_requests(item_type, item_id)
    WHERE status IN ('Pending', 'In Progress');
  `).catch(() => {});
}

ensureTable().catch(() => {});

router.use(requireRole(['admin', 'pharmacist', 'nurse']));

function normalizeItemType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'medicine' || t === 'medicines') return 'medicine';
  if (t === 'supply' || t === 'supplies') return 'supply';
  return '';
}

function normalizeRequesterKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRestockStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'approved' || raw === 'in progress' || raw === 'in_progress') return 'In Progress';
  if (raw === 'rejected') return 'Rejected';
  if (raw === 'completed' || raw === 'fulfilled') return 'Completed';
  if (raw === 'pending') return 'Pending';
  return '';
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
}

function serializeRow(r) {
  const id = r.id?.toString?.() ? r.id.toString() : String(r.id);
  const itemId = r.item_id?.toString?.() ? r.item_id.toString() : String(r.item_id);
  const itemType = r.item_type;
  const itemName = r.item_name || null;
  const requestedQty = Number(r.requested_qty || 0);
  const fulfilledQty = Number(r.fulfilled_qty || 0);
  const requestedBy = r.requested_by || null;
  const fulfilledBy = r.fulfilled_by || null;

  return {
    id,
    item_type: itemType,
    itemType,
    item_id: itemId,
    itemId,
    item_name: itemName,
    itemName,
    requested_qty: requestedQty,
    requestedQty,
    fulfilled_qty: fulfilledQty,
    fulfilledQty,
    priority: r.priority || 'Normal',
    status: r.status || 'Pending',
    note: r.note || null,
    requested_by: requestedBy,
    requestedBy,
    fulfilled_by: fulfilledBy,
    fulfilledBy,
    created_at: r.created_at,
    createdAt: r.created_at,
    updated_at: r.updated_at,
    updatedAt: r.updated_at
  };
}

router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const actorRole = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const actorName = String(req.headers['x-user-name'] || '').trim();
    const actorEmail = String(req.headers['x-user-email'] || '').trim();
    const requesterKey = normalizeRequesterKey(actorName || actorEmail || '');
    const isNurse = actorRole.includes('nurse');
    if (isNurse && !requesterKey) return res.status(401).json({ message: 'Missing x-user-name header' });

    const status = String(req.query.status || '').trim();
    const itemType = normalizeItemType(req.query.itemType);
    const take = Math.min(Math.max(Number(req.query.take || 200) || 200, 1), 500);

    let rows;
    if (status && itemType) {
      rows = isNurse
        ? await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE status = ${status} AND item_type = ${itemType} AND lower(coalesce(requested_by, '')) = ${requesterKey}
          ORDER BY created_at DESC
          LIMIT ${take}
        `
        : await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE status = ${status} AND item_type = ${itemType}
          ORDER BY created_at DESC
          LIMIT ${take}
        `;
    } else if (status) {
      rows = isNurse
        ? await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE status = ${status} AND lower(coalesce(requested_by, '')) = ${requesterKey}
          ORDER BY created_at DESC
          LIMIT ${take}
        `
        : await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE status = ${status}
          ORDER BY created_at DESC
          LIMIT ${take}
        `;
    } else if (itemType) {
      rows = isNurse
        ? await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE item_type = ${itemType} AND lower(coalesce(requested_by, '')) = ${requesterKey}
          ORDER BY created_at DESC
          LIMIT ${take}
        `
        : await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE item_type = ${itemType}
          ORDER BY created_at DESC
          LIMIT ${take}
        `;
    } else {
      rows = isNurse
        ? await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          WHERE lower(coalesce(requested_by, '')) = ${requesterKey}
          ORDER BY created_at DESC
          LIMIT ${take}
        `
        : await prisma.$queryRaw`
          SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
          FROM restock_requests
          ORDER BY created_at DESC
          LIMIT ${take}
        `;
    }

    const serialized = (Array.isArray(rows) ? rows : []).map(serializeRow);
    res.json(serialized);
  } catch (err) {
    sendError(res, err, 'Unable to process restock request.');
  }
});

router.post('/', async (req, res) => {
  try {
    await ensureTable();
    const actorRole = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const actorName = String(req.headers['x-user-name'] || '').trim();
    const actorEmail = String(req.headers['x-user-email'] || '').trim();
    const requesterKey = normalizeRequesterKey(actorName || actorEmail || '');

    const itemType = normalizeItemType(req.body.itemType);
    const itemIdRaw = req.body.itemId;
    const requestedQty = Number(req.body.requestedQty || 0);
    const priority = String(req.body.priority || 'Normal').trim() || 'Normal';
    const note = String(req.body.note || '').trim() || null;
    const requestedBy = normalizeRequesterKey(req.body.requestedBy || '') || requesterKey || null;

    if (!itemType) return res.status(400).json({ message: 'itemType is required' });
    if (itemIdRaw === undefined || itemIdRaw === null || itemIdRaw === '') return res.status(400).json({ message: 'itemId is required' });
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) return res.status(400).json({ message: 'requestedQty must be greater than 0' });
    if (actorRole.includes('nurse') && !requestedBy) return res.status(400).json({ message: 'requestedBy is required' });

    const itemId = BigInt(itemIdRaw);

    const created = await prisma.$transaction(async (tx) => {
      let itemName = null;
      if (itemType === 'medicine') {
        const med = await tx.medicines.findUnique({ where: { id: itemId } });
        if (!med) throw new Error('Medicine not found');
        itemName = med.name || null;
      } else {
        const sup = await tx.supplies.findUnique({ where: { id: itemId } });
        if (!sup) throw new Error('Supply not found');
        itemName = sup.item_name || null;
      }

      const rows = await tx.$queryRaw`
        INSERT INTO restock_requests (item_type, item_id, item_name, requested_qty, priority, status, note, requested_by, updated_at)
        VALUES (${itemType}, ${itemId}, ${itemName}, ${requestedQty}, ${priority}, 'Pending', ${note}, ${requestedBy}, now())
        RETURNING id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
      `;
      return Array.isArray(rows) ? rows[0] : rows;
    });

    if (requestedBy) {
      prisma.activity_logs.create({
        data: {
          actor_name: requestedBy,
          role: actorRole || 'Staff',
          action: 'Create',
          target: `Restock:${itemType}:${itemId.toString()}`,
          details: `Requested restock for ${created?.item_name || 'item'} (qty ${requestedQty})`
        }
      }).catch(() => {});
    }

    res.status(201).json(serializeRow(created));
  } catch (err) {
    const errorText = [err?.message, err?.meta?.message, err?.meta?.cause].filter(Boolean).join(' ');
    const isOpenRequestConflict = String(err?.code || '') === '23505'
      || String(err?.meta?.code || '') === '23505'
      || /23505|restock_requests_open_item_unique_idx|already exists|duplicate key value/i.test(errorText);
    if (isOpenRequestConflict) {
      return res.status(409).json({ message: 'A restock request is already pending or in progress for this item.' });
    }
    res.status(400).json({ message: String(err?.message || 'Unable to create restock request.') });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureTable();
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    if (role.includes('nurse')) return res.status(401).json({ message: 'Unauthorized' });

    const id = BigInt(req.params.id);
    const status = normalizeRestockStatus(req.body.status);
    const fulfilledQty = Number(req.body.fulfilledQty || 0);
    const fulfilledBy = String(req.body.fulfilledBy || '').trim() || String(req.headers['x-user-name'] || '').trim() || null;

    const existingRows = await prisma.$queryRaw`
      SELECT id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
      FROM restock_requests
      WHERE id = ${id}
      LIMIT 1
    `;
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (!existing) return res.status(404).json({ message: 'Restock request not found' });

    const currentStatus = String(existing.status || '');
    if (currentStatus === 'Completed' || currentStatus === 'Rejected') {
      return res.status(409).json({ message: 'Request is already closed.' });
    }

    const actorRole = String(req.headers['x-user-role'] || '').trim() || null;

    if (status === 'In Progress') {
      if (currentStatus !== 'Pending') {
        return res.status(409).json({ message: 'Only pending requests can be approved.' });
      }
      const rows = await prisma.$queryRaw`
        UPDATE restock_requests
        SET status = 'In Progress',
            fulfilled_by = ${fulfilledBy},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
      `;
      const updated = Array.isArray(rows) ? rows[0] : rows;
      if (fulfilledBy) {
        prisma.activity_logs.create({
          data: {
            actor_name: fulfilledBy,
            role: actorRole || 'Admin',
            action: 'Update',
            target: `Restock:${existing.item_type}:${existing.item_id.toString()}`,
            details: `Approved restock request for ${existing.item_name || 'item'}`
          }
        }).catch(() => {});
      }
      return res.json(serializeRow(updated));
    }

    if (status === 'Rejected') {
      if (currentStatus !== 'Pending' && currentStatus !== 'In Progress') {
        return res.status(409).json({ message: 'Request is already closed.' });
      }
      const rows = await prisma.$queryRaw`
        UPDATE restock_requests
        SET status = 'Rejected', fulfilled_by = ${fulfilledBy}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
      `;
      const updated = Array.isArray(rows) ? rows[0] : rows;
      if (fulfilledBy) {
        prisma.activity_logs.create({
          data: {
            actor_name: fulfilledBy,
            role: actorRole || 'Pharmacist',
            action: 'Update',
            target: `Restock:${existing.item_type}:${existing.item_id.toString()}`,
            details: `Rejected restock request for ${existing.item_name || 'item'}`
          }
        }).catch(() => {});
      }
      return res.json(serializeRow(updated));
    }

    if (status !== 'Completed') {
      return res.status(400).json({ message: 'Unsupported status update' });
    }
    if (!Number.isFinite(fulfilledQty) || fulfilledQty <= 0) {
      return res.status(400).json({ message: 'fulfilledQty must be greater than 0' });
    }

    if (currentStatus !== 'In Progress' && currentStatus !== 'Pending') {
      return res.status(409).json({ message: 'Request is already closed.' });
    }

    const itemType = normalizeItemType(existing.item_type);
    const itemId = BigInt(existing.item_id);
    await ensureStockMovementsTableExist();

    const updated = await prisma.$transaction(async (tx) => {
      if (itemType === 'medicine') {
        const med = await tx.medicines.findUnique({ where: { id: itemId } });
        if (!med) throw new Error('Medicine not found');
        const newStock = Number(med.stock || 0) + fulfilledQty;
        const min = Number(med.min_level || 5);
        const newStatus = newStock === 0 ? 'Out of Stock' : newStock <= min ? 'Low Stock' : 'In Stock';
        await tx.medicines.update({
          where: { id: itemId },
          data: { stock: newStock, status: newStatus, updated_at: new Date() }
        });
        await tx.$executeRawUnsafe(
          `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          'medicine',
          itemId,
          Math.max(0, Math.trunc(fulfilledQty)),
          'restock_fulfill',
          fulfilledBy || null,
          actorRole || null,
          `Restock request ${id.toString()}`
        );
      } else if (itemType === 'supply') {
        const sup = await tx.supplies.findUnique({ where: { id: itemId } });
        if (!sup) throw new Error('Supply not found');
        const newStock = Number(sup.stock || 0) + fulfilledQty;
        const min = Number(sup.min_level || 10);
        const newStatus = newStock === 0 ? 'Out of Stock' : newStock <= min ? 'Low Stock' : 'In Stock';
        await tx.supplies.update({
          where: { id: itemId },
          data: { stock: newStock, status: newStatus }
        });
        await tx.$executeRawUnsafe(
          `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          'supply',
          itemId,
          Math.max(0, Math.trunc(fulfilledQty)),
          'restock_fulfill',
          fulfilledBy || null,
          actorRole || null,
          `Restock request ${id.toString()}`
        );
      } else {
        throw new Error('Invalid item type');
      }

      const rows = await tx.$queryRaw`
        UPDATE restock_requests
        SET status = 'Completed',
            fulfilled_qty = ${fulfilledQty},
            fulfilled_by = ${fulfilledBy},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id, item_type, item_id, item_name, requested_qty, fulfilled_qty, priority, status, note, requested_by, fulfilled_by, created_at, updated_at
      `;
      return Array.isArray(rows) ? rows[0] : rows;
    });

    if (fulfilledBy) {
      prisma.activity_logs.create({
        data: {
          actor_name: fulfilledBy,
          role: actorRole || 'Pharmacist',
          action: 'Update',
          target: `Restock:${existing.item_type}:${existing.item_id.toString()}`,
          details: `Fulfilled restock for ${existing.item_name || 'item'} (qty ${fulfilledQty})`
        }
      }).catch(() => {});
    }

    res.json(serializeRow(updated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

