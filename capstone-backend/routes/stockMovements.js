const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

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

router.get('/recent', requireRole(['admin', 'pharmacist']), async (req, res) => {
  try {
    await ensureStockMovementsTableExist();
    const itemType = String(req.query.itemType || '').trim();
    const itemIdRaw = String(req.query.itemId || '').trim();
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(req.query.limit || 10))));

    const where = [];
    const params = [];
    if (itemType) {
      where.push(`item_type = $${params.length + 1}`);
      params.push(itemType);
    }
    if (itemIdRaw && /^\d+$/.test(itemIdRaw)) {
      where.push(`item_id = $${params.length + 1}`);
      params.push(BigInt(itemIdRaw));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, item_type, item_id, delta, reason, actor_name, actor_role, note, created_at
       FROM public.stock_movements
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      ...params
    );
    res.json(serialize(Array.isArray(rows) ? rows : []));
  } catch (err) {
    console.error('stockMovements GET /recent failed:', err);
    res.status(500).json({ message: 'Unable to load stock movements.' });
  }
});

router.post('/:id/undo', requireRole(['admin', 'pharmacist']), async (req, res) => {
  try {
    await ensureStockMovementsTableExist();
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const actorName = String(req.headers['x-user-name'] || '').trim() || null;
    if (role !== 'admin' && role !== 'pharmacist') return res.status(403).json({ message: 'Forbidden' });

    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const movementId = BigInt(idRaw);

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT id, item_type, item_id, delta, reason, note, created_at
         FROM public.stock_movements
         WHERE id = $1
         LIMIT 1`,
        movementId
      );
      const mv = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!mv) throw Object.assign(new Error('Movement not found'), { status: 404 });

      const itemType = String(mv.item_type || '').trim();
      const itemId = BigInt(mv.item_id);
      const delta = Math.trunc(Number(mv.delta || 0));
      if (!delta) throw Object.assign(new Error('Nothing to undo'), { status: 400 });

      const inverse = -delta;
      if (itemType === 'medicine') {
        await tx.medicines.update({ where: { id: itemId }, data: { stock: { increment: inverse } } });
      } else if (itemType === 'supply') {
        await tx.supplies.update({ where: { id: itemId }, data: { stock: { increment: inverse } } });
      } else {
        throw Object.assign(new Error('Unsupported item type'), { status: 400 });
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        itemType,
        itemId,
        inverse,
        'undo',
        actorName,
        role,
        `Undo movement ${mv.id}`
      );

      return { ok: true, itemType, itemId: itemId.toString(), undoneMovementId: mv.id.toString() };
    });

    res.json(serialize(result));
  } catch (err) {
    const status = Number(err?.status || 0);
    if (status) return res.status(status).json({ message: String(err.message || 'Request failed') });
    console.error('stockMovements POST /:id/undo failed:', err);
    res.status(500).json({ message: 'Unable to undo stock movement.' });
  }
});

router.post('/batch-apply', requireRole(['admin', 'pharmacist']), async (req, res) => {
  try {
    await ensureStockMovementsTableExist();
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const actorName = String(req.headers['x-user-name'] || '').trim() || null;
    if (role !== 'admin' && role !== 'pharmacist') return res.status(403).json({ message: 'Forbidden' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'items is required' });

    const normalized = items.map((it) => {
      const itemType = String(it?.itemType || '').trim();
      const itemIdRaw = String(it?.itemId || '').trim();
      const itemId = /^\d+$/.test(itemIdRaw) ? BigInt(itemIdRaw) : null;
      const delta = Math.trunc(Number(it?.delta || 0));
      const reason = String(it?.reason || 'manual_adjust').trim() || 'manual_adjust';
      const note = it?.note != null ? String(it.note).slice(0, 300) : null;
      return { itemType, itemId, delta, reason, note };
    });

    for (const it of normalized) {
      if (!it.itemId) return res.status(400).json({ message: 'Invalid itemId' });
      if (it.itemType !== 'medicine' && it.itemType !== 'supply') return res.status(400).json({ message: 'Invalid itemType' });
      if (!it.delta) return res.status(400).json({ message: 'Invalid delta' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const applied = [];
      for (const it of normalized) {
        if (it.itemType === 'medicine') {
          await tx.medicines.update({ where: { id: it.itemId }, data: { stock: { increment: it.delta } } });
        } else {
          await tx.supplies.update({ where: { id: it.itemId }, data: { stock: { increment: it.delta } } });
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          it.itemType,
          it.itemId,
          it.delta,
          it.reason,
          actorName,
          role,
          it.note
        );
        applied.push({ itemType: it.itemType, itemId: it.itemId.toString(), delta: it.delta, reason: it.reason });
      }
      return applied;
    });

    res.json(serialize({ ok: true, applied: result }));
  } catch (err) {
    console.error('stockMovements POST /batch-apply failed:', err);
    res.status(500).json({ message: 'Unable to apply batch stock movements.' });
  }
});

module.exports = router;

