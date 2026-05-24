const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { parseLimit, parseOffset } = require('../utils/normalize');

const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

router.get('/products', requireRole(['pharmacist', 'admin', 'nurse']), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const categoryIdRaw = String(req.query.categoryId || '').trim();
    const includeOut = String(req.query.includeOutOfStock || '').trim() === '1';
    const limit = parseLimit(req.query.take, { min: 1, max: 1000, fallback: 500 });
    const offset = parseOffset(req.query.skip, { min: 0, max: 5000, fallback: 0 });

    const categoryId = categoryIdRaw && /^\d+$/.test(categoryIdRaw) ? BigInt(categoryIdRaw) : null;

    const medWhere = {};
    const supWhere = {};
    if (!includeOut) {
      medWhere.stock = { gt: 0 };
      supWhere.stock = { gt: 0 };
    }
    if (categoryId) {
      medWhere.category_id = categoryId;
      supWhere.category_id = categoryId;
    }
    if (q) {
      medWhere.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { product_categories: { is: { name: { contains: q, mode: 'insensitive' } } } }
      ];
      supWhere.OR = [
        { item_name: { contains: q, mode: 'insensitive' } },
        { product_categories: { is: { name: { contains: q, mode: 'insensitive' } } } }
      ];
    }

    let meds;
    let sups;
    try {
      const [medCount, supCount] = await Promise.all([
        prisma.medicines.count({ where: Object.keys(medWhere).length ? medWhere : undefined }),
        prisma.supplies.count({ where: Object.keys(supWhere).length ? supWhere : undefined })
      ]);

      const medSkip = Math.min(offset, medCount);
      const medTake = Math.max(0, Math.min(limit, medCount - medSkip));
      const remaining = Math.max(0, limit - medTake);
      const supSkip = Math.max(0, offset - medCount);
      const supTake = remaining;

      [meds, sups] = await Promise.all([
        medTake > 0
          ? prisma.medicines.findMany({
              where: Object.keys(medWhere).length ? medWhere : undefined,
              include: { product_categories: true },
              orderBy: { name: 'asc' },
              skip: medSkip,
              take: medTake
            })
          : Promise.resolve([]),
        supTake > 0
          ? prisma.supplies.findMany({
              where: Object.keys(supWhere).length ? supWhere : undefined,
              include: { product_categories: true },
              orderBy: { item_name: 'asc' },
              skip: supSkip,
              take: supTake
            })
          : Promise.resolve([])
      ]);
    } catch (e) {
      const code = String(e?.code || '');
      const msg = String(e?.message || '').toLowerCase();
      const isSchemaMismatch =
        code === 'P2021' ||
        msg.includes('does not exist') ||
        msg.includes('category_id') ||
        msg.includes('image_url') ||
        msg.includes('product_categories');
      if (!isSchemaMismatch) throw e;

      const medFallbackWhere = {};
      const supFallbackWhere = {};
      if (!includeOut) {
        medFallbackWhere.stock = { gt: 0 };
        supFallbackWhere.stock = { gt: 0 };
      }
      if (q) {
        medFallbackWhere.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } }
        ];
        supFallbackWhere.OR = [{ item_name: { contains: q, mode: 'insensitive' } }];
      }

      try {
        const [medCount, supCount] = await Promise.all([
          prisma.medicines.count({ where: Object.keys(medFallbackWhere).length ? medFallbackWhere : undefined }),
          prisma.supplies.count({ where: Object.keys(supFallbackWhere).length ? supFallbackWhere : undefined })
        ]);

        const medSkip = Math.min(offset, medCount);
        const medTake = Math.max(0, Math.min(limit, medCount - medSkip));
        const remaining = Math.max(0, limit - medTake);
        const supSkip = Math.max(0, offset - medCount);
        const supTake = remaining;

        [meds, sups] = await Promise.all([
          medTake > 0
            ? prisma.medicines.findMany({
                where: Object.keys(medFallbackWhere).length ? medFallbackWhere : undefined,
                select: { id: true, name: true, category: true, stock: true, min_level: true, expiry_date: true, unit: true, price: true },
                orderBy: { name: 'asc' },
                skip: medSkip,
                take: medTake
              })
            : Promise.resolve([]),
          supTake > 0
            ? prisma.supplies.findMany({
                where: Object.keys(supFallbackWhere).length ? supFallbackWhere : undefined,
                select: { id: true, item_name: true, stock: true, min_level: true, unit: true, price: true },
                orderBy: { item_name: 'asc' },
                skip: supSkip,
                take: supTake
              })
            : Promise.resolve([])
        ]);
      } catch (_) {
        meds = [];
        sups = [];
      }
    }

    const categoryNames = Array.from(
      new Set(
        [...(Array.isArray(meds) ? meds : []).map((m) => String(m.category || '').trim()).filter(Boolean), 'Medical Supplies'].filter(Boolean)
      )
    );
    const categoryRows = categoryNames.length
      ? await prisma.product_categories
          .findMany({ where: { name: { in: categoryNames } } })
          .catch(() => [])
      : [];

    const nameToCategory = new Map((Array.isArray(categoryRows) ? categoryRows : []).map((c) => [c.name, c]));

    const mapped = [
      ...meds.map((m) => ({
        type: 'medicine',
        id: m.id.toString(),
        name: m.name || '',
        categoryId:
          m.category_id != null
            ? m.category_id.toString()
            : m.category
              ? (nameToCategory.get(String(m.category).trim())?.id?.toString() || String(m.category).trim() || 'Uncategorized')
              : 'Uncategorized',
        categoryName: m.product_categories?.name || m.category || 'Uncategorized',
        categoryImageUrl:
          m.product_categories?.image_url ||
          (m.category ? nameToCategory.get(String(m.category).trim())?.image_url || null : null),
        imageUrl: m.image_url || null,
        stock: Number(m.stock || 0),
        minLevel: Number(m.min_level || 0),
        expiryDate: m.expiry_date || null,
        unit: m.unit || null,
        price: m.price != null ? Number(m.price) : 0
      })),
      ...sups.map((s) => ({
        type: 'supply',
        id: s.id.toString(),
        name: s.item_name || '',
        categoryId:
          s.category_id != null ? s.category_id.toString() : (nameToCategory.get('Medical Supplies')?.id?.toString() || 'Medical Supplies'),
        categoryName: s.product_categories?.name || 'Medical Supplies',
        categoryImageUrl: s.product_categories?.image_url || nameToCategory.get('Medical Supplies')?.image_url || null,
        imageUrl: s.image_url || null,
        stock: Number(s.stock || 0),
        minLevel: Number(s.min_level || 10),
        unit: s.unit || null,
        price: s.price != null ? Number(s.price) : 0
      }))
    ];

    res.json(serialize(mapped));
  } catch (err) {
    const code = String(err?.code || '').trim();
    console.error('pharmacyPos GET /products failed:', err);
    res.status(500).json({
      message: 'Unable to load inventory products. Please restart the backend and check server logs.',
      ...(code ? { code } : {})
    });
  }
});

module.exports = router;


