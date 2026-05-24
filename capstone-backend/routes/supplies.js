const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const requireRole = require('../middleware/requireRole');

router.use(requireRole(['admin', 'pharmacist', 'nurse']));

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

function getStatus(stock, minLevel) {
  if (stock === 0) return 'Out of Stock';
  if (stock <= minLevel) return 'Low Stock';
  return 'In Stock';
}

function isSchemaMismatchError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'P2021' ||
    msg.includes('does not exist') ||
    msg.includes('barcode') ||
    msg.includes('category_id') ||
    msg.includes('image_url') ||
    msg.includes('product_categories')
  );
}

function sanitizeSupply(s) {
  if (!s) return null;
  return {
    id: s.id != null ? s.id.toString() : '',
    item_name: s.item_name || null,
    barcode: s.barcode || null,
    stock: s.stock != null ? Number(s.stock) : 0,
    min_level: s.min_level != null ? Number(s.min_level) : 10,
    unit: s.unit || null,
    price: s.price != null ? Number(s.price) : 0,
    status: s.status || getStatus(Number(s.stock || 0), Number(s.min_level || 10)),
    category_id: s.category_id != null ? s.category_id.toString() : null,
    image_url: s.image_url || null
  };
}

function normalizeBarcode(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '');
  if (!cleaned) return null;
  if (cleaned.length > 64) return cleaned.slice(0, 64);
  return cleaned;
}

const uploadDir = path.join(__dirname, '..', 'uploads', 'pharmacy-products');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const id = String(req.params.id || 'product').replace(/[^a-zA-Z0-9_-]/g, '');
    const safeName = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `supply_${id}_${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(String(file.mimetype || '').toLowerCase());
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

router.get('/', async (req, res) => {
  try {
    let items = [];
    try {
      items = await prisma.supplies.findMany({ include: { product_categories: true }, orderBy: { created_at: 'desc' } });
    } catch (e) {
      if (!isSchemaMismatchError(e)) throw e;
      items = await prisma.supplies.findMany({
        select: { id: true, item_name: true, barcode: true, stock: true, min_level: true, unit: true, price: true, status: true },
        orderBy: { item_name: 'asc' }
      });
    }
    const mapped = items.map((s) => ({
      id: s.id != null ? s.id.toString() : '',
      item_name: s.item_name || null,
      stock: s.stock != null ? Number(s.stock) : 0,
      min_level: s.min_level != null ? Number(s.min_level) : 10,
      unit: s.unit || null,
      price: s.price != null ? Number(s.price) : 0,
      categoryId: s.category_id ? s.category_id.toString() : null,
      categoryName: s.product_categories?.name || null,
      categoryImageUrl: s.product_categories?.image_url || null,
      image_url: s.image_url || null,
      status: getStatus(Number(s.stock || 0), Number(s.min_level || 10))
    }));
    const statusPriority = { 'Out of Stock': 0, 'Expired': 1, 'Low Stock': 2, 'In Stock': 3 };
    mapped.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);
    res.json(mapped);
  } catch (err) {
    console.error('supplies GET / failed:', err);
    res.json([]);
  }
});

router.get('/barcode/:barcode', async (req, res) => {
  try {
    const barcode = normalizeBarcode(req.params.barcode);
    if (!barcode) return res.status(400).json({ message: 'Barcode is required' });
    let found = null;
    try {
      found = await prisma.supplies.findFirst({ where: { barcode }, include: { product_categories: true } });
    } catch (e) {
      if (isSchemaMismatchError(e)) {
        return res.status(400).json({ message: 'Barcode support is not installed for supplies. Run the supplies barcode migration first.' });
      }
      throw e;
    }
    if (!found) return res.status(404).json({ message: 'Supply not found' });
    res.json(sanitizeSupply(found));
  } catch (err) {
    console.error('supplies GET /barcode failed:', err);
    res.status(500).json({ message: 'Unable to look up supply by barcode' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { itemName, stock, minLevel, unit, price, categoryId, imageUrl } = req.body;
    const barcode = normalizeBarcode(req.body.barcode);
    if (barcode) {
      const existingByBarcode = await prisma.supplies.findFirst({ where: { barcode } }).catch(() => null);
      if (existingByBarcode) {
        return res.status(409).json({ message: 'Barcode already exists', supply: sanitizeSupply(existingByBarcode) });
      }
    }
    const created = await prisma.supplies.create({
      data: {
        item_name: itemName,
        barcode: barcode || undefined,
        category_id: categoryId && /^\d+$/.test(String(categoryId)) ? BigInt(String(categoryId)) : undefined,
        image_url: imageUrl ? String(imageUrl) : undefined,
        stock,
        min_level: minLevel,
        unit,
        price,
        status: getStatus(stock, minLevel)
      }
    });
    res.status(201).json(sanitizeSupply(created));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const actorName = String(req.headers['x-user-name'] || '').trim() || null;
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(idRaw);
    let existing;
    try {
      existing = await prisma.supplies.findUnique({ where: { id } });
    } catch (e) {
      if (!isSchemaMismatchError(e)) throw e;
      existing = await prisma.supplies.findUnique({ where: { id }, select: { id: true, stock: true, min_level: true, price: true } });
    }
    if (!existing) return res.status(404).json({ message: 'Supply not found' });

    const prevStock = Number(existing.stock || 0);
    const newStock = req.body.stock !== undefined ? req.body.stock : existing.stock;
    const newPrice = req.body.price !== undefined ? req.body.price : existing.price;
    const newMin = req.body.minLevel !== undefined ? req.body.minLevel : existing.min_level;
    const newCategoryId = req.body.categoryId !== undefined ? req.body.categoryId : undefined;
    const newImageUrl = req.body.imageUrl !== undefined ? req.body.imageUrl : undefined;
    const newBarcode = req.body.barcode !== undefined ? normalizeBarcode(req.body.barcode) : undefined;
    const newUnit = req.body.unit !== undefined ? String(req.body.unit || '').trim() : undefined;

    if (newBarcode !== undefined) {
      if (newBarcode) {
        const existingByBarcode = await prisma.supplies.findFirst({ where: { barcode: newBarcode } }).catch(() => null);
        if (existingByBarcode && existingByBarcode.id?.toString() !== id.toString()) {
          return res.status(409).json({ message: 'Barcode already exists', supply: sanitizeSupply(existingByBarcode) });
        }
      }
    }

    let updated;
    try {
      updated = await prisma.supplies.update({
        where: { id },
        data: {
          stock: newStock,
          price: newPrice,
          min_level: newMin,
          ...(newBarcode !== undefined ? { barcode: newBarcode ? newBarcode : null } : {}),
          ...(newUnit !== undefined ? { unit: newUnit ? newUnit : null } : {}),
          ...(newCategoryId !== undefined ? { category_id: newCategoryId ? BigInt(String(newCategoryId)) : null } : {}),
          ...(newImageUrl !== undefined ? { image_url: newImageUrl ? String(newImageUrl) : null } : {}),
          status: getStatus(Number(newStock || 0), Number(newMin || 10))
        }
      });
    } catch (e) {
      if (!isSchemaMismatchError(e)) throw e;
      if (newCategoryId !== undefined || newImageUrl !== undefined) {
        return res.status(400).json({ message: 'Run product categories migration to enable categories/images.' });
      }
      if (newBarcode !== undefined) {
        const rows = await prisma.$queryRaw`
          UPDATE public.supplies
          SET barcode = ${newBarcode ? String(newBarcode) : null}
          WHERE id = ${id}
          RETURNING id, item_name, barcode, stock, min_level, unit, price, status
        `;
        updated = Array.isArray(rows) && rows.length ? rows[0] : { id, barcode: newBarcode, stock: newStock, min_level: newMin, price: newPrice, status: getStatus(Number(newStock || 0), Number(newMin || 10)) };
      } else {
      const status = getStatus(Number(newStock || 0), Number(newMin || 10));
      const rows = await prisma.$queryRaw`
        UPDATE public.supplies
        SET stock = ${Number(newStock)}, price = ${newPrice == null ? null : Number(newPrice)}, min_level = ${Number(newMin || 10)}, status = ${status}
        WHERE id = ${id}
        RETURNING id, item_name, stock, min_level, unit, price, status
      `;
      updated = Array.isArray(rows) && rows.length ? rows[0] : { id, stock: newStock, price: newPrice, min_level: newMin, status };
      }
    }

    const nextStock = Number(updated?.stock ?? newStock ?? 0);
    const delta = Math.trunc(nextStock - prevStock);
    if (delta !== 0 && (role === 'admin' || role === 'pharmacist')) {
      await ensureStockMovementsTableExist();
      const reason = String(req.body?.movementReason || 'manual_adjust').trim() || 'manual_adjust';
      const note = req.body?.movementNote != null ? String(req.body.movementNote).slice(0, 300) : 'Supplies update';
      await prisma.$executeRawUnsafe(
        `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        'supply',
        id,
        delta,
        reason,
        actorName,
        role,
        note
      ).catch(() => {});
    }

    res.json(sanitizeSupply(updated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/upload-image', requireRole(['admin', 'pharmacist']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/uploads/pharmacy-products/${encodeURIComponent(req.file.filename)}`;
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(idRaw);
    let updated;
    try {
      updated = await prisma.supplies.update({
        where: { id },
        data: { image_url: url }
      });
    } catch (e) {
      if (!isSchemaMismatchError(e)) throw e;
      return res.status(400).json({ message: 'Run product categories migration to enable images.' });
    }
    res.json({ url, id: updated.id.toString() });
  } catch (err) {
    res.status(400).json({ message: 'Upload failed' });
  }
});

module.exports = router;

