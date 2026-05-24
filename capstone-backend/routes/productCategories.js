const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const requireRole = require('../middleware/requireRole');

const uploadDir = path.join(__dirname, '..', 'uploads', 'product-categories');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `category_${Date.now()}_${safeName}`);
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

const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

router.get('/', async (_req, res) => {
  try {
    const categories = await prisma.product_categories.findMany({
      orderBy: { name: 'asc' }
    });

    const [medCounts, supCounts] = await Promise.all([
      prisma.medicines.groupBy({
        by: ['category_id'],
        where: { stock: { gt: 0 }, category_id: { not: null } },
        _count: { _all: true }
      }),
      prisma.supplies.groupBy({
        by: ['category_id'],
        where: { stock: { gt: 0 }, category_id: { not: null } },
        _count: { _all: true }
      })
    ]);

    const countMap = new Map();
    for (const r of medCounts) {
      if (!r.category_id) continue;
      countMap.set(r.category_id.toString(), (countMap.get(r.category_id.toString()) || 0) + Number(r._count?._all || 0));
    }
    for (const r of supCounts) {
      if (!r.category_id) continue;
      countMap.set(r.category_id.toString(), (countMap.get(r.category_id.toString()) || 0) + Number(r._count?._all || 0));
    }

    const payload = categories.map((c) => ({
      id: c.id.toString(),
      name: c.name,
      image_url: c.image_url || null,
      available_count: countMap.get(c.id.toString()) || 0
    }));

    res.json(payload);
  } catch (err) {
    console.error('product-categories GET / failed:', err);
    if (String(err?.code || '') === 'P2021' || String(err?.message || '').toLowerCase().includes('product_categories')) {
      try {
        const [medCats, supCount] = await Promise.all([
          prisma.medicines
            .groupBy({
              by: ['category'],
              where: { stock: { gt: 0 }, category: { not: null } },
              _count: { _all: true }
            })
            .catch(() => []),
          prisma.supplies.count({ where: { stock: { gt: 0 } } }).catch(() => 0)
        ]);

        const mapped = (Array.isArray(medCats) ? medCats : [])
          .map((r) => ({
            id: String(r.category || '').trim(),
            name: String(r.category || '').trim(),
            image_url: null,
            available_count: Number(r._count?._all || 0)
          }))
          .filter((c) => c.id);

        if (supCount > 0) {
          mapped.push({ id: 'Medical Supplies', name: 'Medical Supplies', image_url: null, available_count: Number(supCount) });
        }

        mapped.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return res.json(mapped);
      } catch (_) {
        return res.json([]);
      }
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', requireRole(['admin', 'pharmacist']), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name is required' });
    const imageUrl = req.body?.imageUrl != null ? String(req.body.imageUrl).trim() : null;
    const created = await prisma.product_categories.create({
      data: { name, image_url: imageUrl || null }
    });
    res.status(201).json(serialize({ ...created, id: created.id.toString() }));
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.toLowerCase().includes('unique')) return res.status(400).json({ message: 'Category already exists' });
    res.status(400).json({ message: 'Invalid request' });
  }
});

router.put('/:id', requireRole(['admin', 'pharmacist']), async (req, res) => {
  try {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(raw);
    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const imageUrl = req.body?.imageUrl != null ? String(req.body.imageUrl).trim() : undefined;

    const data = {};
    if (name !== undefined) data.name = name;
    if (imageUrl !== undefined) data.image_url = imageUrl || null;
    data.updated_at = new Date();

    const updated = await prisma.product_categories.update({ where: { id }, data });
    res.json(serialize({ ...updated, id: updated.id.toString() }));
  } catch (err) {
    res.status(400).json({ message: 'Invalid request' });
  }
});

router.delete('/:id', requireRole(['admin']), async (req, res) => {
  try {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) return res.status(400).json({ message: 'Invalid id' });
    const id = BigInt(raw);

    await prisma.$transaction(async (tx) => {
      await tx.medicines.updateMany({ where: { category_id: id }, data: { category_id: null } });
      await tx.supplies.updateMany({ where: { category_id: id }, data: { category_id: null } });
      await tx.product_categories.delete({ where: { id } });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: 'Unable to delete category' });
  }
});

router.post('/upload', requireRole(['admin', 'pharmacist']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/uploads/product-categories/${encodeURIComponent(req.file.filename)}`;
    res.json({ url, filename: req.file.filename, originalName: req.file.originalname });
  } catch (err) {
    res.status(400).json({ message: 'Upload failed' });
  }
});

module.exports = router;


