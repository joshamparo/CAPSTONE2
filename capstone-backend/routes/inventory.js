const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const requireRole = require('../middleware/requireRole');

// Helper to determine status
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

function normalizeBarcode(value) {
    return String(value || '').trim();
}

function sanitizeMedicine(m) {
    if (!m) return null;
    return {
        id: m.id != null ? m.id.toString() : '',
        name: m.name || null,
        category: m.category || null,
        stock: m.stock != null ? Number(m.stock) : 0,
        min_level: m.min_level != null ? Number(m.min_level) : 0,
        unit: m.unit || null,
        expiry_date: m.expiry_date || null,
        price: m.price != null ? Number(m.price) : 0,
        status: m.status || getStatus(Number(m.stock || 0), Number(m.min_level || 0)),
        barcode: m.barcode || null,
        category_id: m.category_id != null ? m.category_id.toString() : null,
        image_url: m.image_url || null
    };
}

const uploadDir = path.join(__dirname, '..', 'uploads', 'pharmacy-products');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const id = String(req.params.id || 'product').replace(/[^a-zA-Z0-9_-]/g, '');
        const safeName = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `medicine_${id}_${Date.now()}_${safeName}`);
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

router.use(requireRole(['admin', 'pharmacist', 'nurse']));

async function ensureStockMovementsTableExist(prisma) {
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

// GET All Medicines (Sorted by Critical Status first)
router.get('/', async (req, res) => {
    try {
        let meds = [];
        try {
            meds = await prisma.medicines.findMany({ include: { product_categories: true } });
        } catch (e) {
            if (!isSchemaMismatchError(e)) throw e;
            meds = await prisma.medicines.findMany({
                select: { id: true, name: true, category: true, stock: true, min_level: true, unit: true, expiry_date: true, price: true, status: true, category_id: true, image_url: true },
                orderBy: { name: 'asc' }
            });
        }
        
        // Auto-seed if empty (For demo purposes)
        if (meds.length === 0) {
            const defaultMeds = [
                { name: 'Paracetamol 500mg', category: 'Painkiller', stock: 150, minLevel: 20, unit: 'box', price: 5 },
                { name: 'Amoxicillin 500mg', category: 'Antibiotic', stock: 12, minLevel: 15, unit: 'box', price: 15 }, // Low Stock
                { name: 'Ibuprofen 200mg', category: 'Painkiller', stock: 45, minLevel: 10, unit: 'bottle', price: 12 },
                { name: 'Vitamin C', category: 'Supplement', stock: 0, minLevel: 10, unit: 'box', price: 8 }, // Out of Stock
                { name: 'Metformin 500mg', category: 'Diabetes', stock: 80, minLevel: 20, unit: 'box', price: 10 }
            ];
            await prisma.medicines
                .createMany({
                    data: defaultMeds.map(m => ({
                        name: m.name,
                        category: m.category,
                        stock: m.stock,
                        min_level: m.minLevel,
                        unit: m.unit,
                        price: m.price,
                        status: getStatus(m.stock, m.minLevel)
                    }))
                })
                .catch(() => {});

            try {
                meds = await prisma.medicines.findMany({ include: { product_categories: true } });
            } catch (_) {
                meds = await prisma.medicines.findMany({
                    select: { id: true, name: true, category: true, stock: true, min_level: true, unit: true, price: true, status: true },
                    orderBy: { name: 'asc' }
                });
            }
        }

        // Add computed status and ID for frontend sorting
        const mappedMeds = meds.map(m => ({
            id: m.id != null ? m.id.toString() : '',
            name: m.name || null,
            barcode: m.barcode || null,
            category: m.category || null,
            stock: m.stock != null ? Number(m.stock) : 0,
            min_level: m.min_level != null ? Number(m.min_level) : 0,
            unit: m.unit || null,
            price: m.price != null ? Number(m.price) : 0,
            categoryId: m.category_id ? m.category_id.toString() : (m.category ? String(m.category) : null),
            categoryName: m.product_categories?.name || m.category || null,
            categoryImageUrl: m.product_categories?.image_url || null,
            image_url: m.image_url || null,
            status: getStatus(Number(m.stock || 0), Number(m.min_level || 0))
        }));

        // Sort: Out of Stock -> Low Stock -> In Stock
        const statusPriority = { 'Out of Stock': 0, 'Expired': 1, 'Low Stock': 2, 'In Stock': 3 };
        mappedMeds.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);

        res.json(mappedMeds);
    } catch (err) {
        console.error('inventory GET / failed:', err);
        res.json([]);
    }
});

// GET Medicine By Barcode
router.get('/barcode/:barcode', async (req, res) => {
    try {
        const barcode = normalizeBarcode(req.params.barcode);
        if (!barcode) return res.status(400).json({ message: 'Barcode is required' });
        const med = await prisma.medicines.findFirst({
            where: { barcode },
            include: { product_categories: true }
        });
        if (!med) return res.status(404).json({ message: 'Medicine not found' });
        res.json(sanitizeMedicine(med));
    } catch (err) {
        if (isSchemaMismatchError(err)) {
            return res.status(400).json({ message: 'Barcode support is not installed. Run the barcode migration first.' });
        }
        console.error('inventory GET /barcode failed:', err);
        res.status(500).json({ message: 'Unable to look up medicine by barcode' });
    }
});

// POST Add New Medicine
router.post('/', async (req, res) => {
    try {
        const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
        if (role !== 'admin' && role !== 'pharmacist') return res.status(403).json({ message: 'Forbidden' });
        const { name, category, categoryId, stock, minLevel, unit, price, imageUrl } = req.body;
        const barcode = normalizeBarcode(req.body.barcode);
        if (barcode) {
            const existingByBarcode = await prisma.medicines.findFirst({ where: { barcode } });
            if (existingByBarcode) {
                return res.status(409).json({ message: 'Barcode already exists', medicine: sanitizeMedicine(existingByBarcode) });
            }
        }
        const newMed = await prisma.medicines.create({
            data: {
                name,
                barcode: barcode || undefined,
                category,
                category_id: categoryId && /^\d+$/.test(String(categoryId)) ? BigInt(String(categoryId)) : undefined,
                image_url: imageUrl ? String(imageUrl) : undefined,
                stock,
                min_level: minLevel,
                unit,
                price,
                status: getStatus(stock, minLevel)
            }
        });
        res.status(201).json(sanitizeMedicine(newMed));
    } catch (err) {
        if (isSchemaMismatchError(err) && req.body?.barcode) {
            return res.status(400).json({ message: 'Barcode support is not installed. Run the barcode migration first.' });
        }
        res.status(400).json({ message: err.message });
    }
});

// PUT Update Stock (Restock or Dispense)
router.put('/:id', async (req, res) => {
    try {
        const role = String(req.headers['x-user-role'] || '').trim().toLowerCase();
        if (role !== 'admin' && role !== 'pharmacist') return res.status(403).json({ message: 'Forbidden' });
        const actorName = String(req.headers['x-user-name'] || '').trim() || null;
        const idRaw = String(req.params.id || '').trim();
        if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid id' });
        const id = BigInt(idRaw);
        let existingMed;
        try {
            existingMed = await prisma.medicines.findUnique({ where: { id } });
        } catch (e) {
            if (!isSchemaMismatchError(e)) throw e;
            existingMed = await prisma.medicines.findUnique({
                where: { id },
                select: { id: true, stock: true, min_level: true, price: true }
            });
        }
        
        if (!existingMed) return res.status(404).json({ message: 'Medicine not found' });

        const prevStock = Number(existingMed.stock || 0);
        const newStock = req.body.stock !== undefined ? req.body.stock : existingMed.stock;
        const newPrice = req.body.price !== undefined ? req.body.price : existingMed.price;
        const newCategoryId = req.body.categoryId !== undefined ? req.body.categoryId : undefined;
        const newImageUrl = req.body.imageUrl !== undefined ? req.body.imageUrl : undefined;
        const newBarcode = req.body.barcode !== undefined ? normalizeBarcode(req.body.barcode) : undefined;
        const newUnit = req.body.unit !== undefined ? String(req.body.unit || '').trim() : undefined;

        if (newBarcode !== undefined) {
            if (newBarcode) {
                const existingByBarcode = await prisma.medicines.findFirst({ where: { barcode: newBarcode } }).catch(() => null);
                if (existingByBarcode && existingByBarcode.id?.toString() !== id.toString()) {
                    return res.status(409).json({ message: 'Barcode already exists', medicine: sanitizeMedicine(existingByBarcode) });
                }
            }
        }
        
        let updatedMed;
        try {
            updatedMed = await prisma.medicines.update({
                where: { id },
                data: {
                    stock: newStock,
                    price: newPrice,
                    ...(newBarcode !== undefined ? { barcode: newBarcode ? newBarcode : null } : {}),
                    ...(newUnit !== undefined ? { unit: newUnit ? newUnit : null } : {}),
                    ...(newCategoryId !== undefined ? { category_id: newCategoryId ? BigInt(String(newCategoryId)) : null } : {}),
                    ...(newImageUrl !== undefined ? { image_url: newImageUrl ? String(newImageUrl) : null } : {}),
                    status: getStatus(newStock, existingMed.min_level)
                }
            });
        } catch (e) {
            if (!isSchemaMismatchError(e)) throw e;
            if (newCategoryId !== undefined || newImageUrl !== undefined) {
                return res.status(400).json({ message: 'Run product categories migration to enable categories/images.' });
            }
            if (newBarcode !== undefined) {
                const rows = await prisma.$queryRaw`
                  UPDATE public.medicines
                  SET barcode = ${newBarcode ? String(newBarcode) : null}, updated_at = now()
                  WHERE id = ${id}
                  RETURNING id, name, barcode, category, stock, min_level, unit, price, status
                `;
                updatedMed = Array.isArray(rows) && rows.length ? rows[0] : { id, barcode: newBarcode, stock: newStock, price: newPrice, status: getStatus(Number(newStock || 0), Number(existingMed.min_level || 0)) };
            } else {
            const status = getStatus(Number(newStock || 0), Number(existingMed.min_level || 0));
            const rows = await prisma.$queryRaw`
                UPDATE public.medicines
                SET stock = ${Number(newStock)}, price = ${newPrice == null ? null : Number(newPrice)}, status = ${status}, updated_at = now()
                WHERE id = ${id}
                RETURNING id, name, category, stock, min_level, unit, price, status
            `;
            updatedMed = Array.isArray(rows) && rows.length ? rows[0] : { id, stock: newStock, price: newPrice, status };
            }
        }

        const nextStock = Number(updatedMed?.stock ?? newStock ?? 0);
        const delta = Math.trunc(nextStock - prevStock);
        if (delta !== 0) {
            await ensureStockMovementsTableExist(prisma);
            const reason = String(req.body?.movementReason || 'manual_adjust').trim() || 'manual_adjust';
            const note = req.body?.movementNote != null ? String(req.body.movementNote).slice(0, 300) : 'Inventory update';
            await prisma.$executeRawUnsafe(
                `INSERT INTO public.stock_movements (item_type, item_id, delta, reason, actor_name, actor_role, note)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                'medicine',
                id,
                delta,
                reason,
                actorName,
                role,
                note
            ).catch(() => {});
        }
        
        if (updatedMed) {
            let note = `Updated inventory item ${id}`;
            if (newPrice !== undefined && newPrice !== existingMed.price) {
                note += ` | Price changed: ₱${existingMed.price} -> ₱${newPrice}`;
            }
            if (newStock !== undefined && newStock !== existingMed.stock) {
                note += ` | Stock changed: ${existingMed.stock} -> ${newStock}`;
            }
            if (newPrice !== undefined || newStock !== undefined || newBarcode !== undefined || newUnit !== undefined) {
                await prisma.activity_logs.create({
                    data: {
                        actor_name: actorName || 'System',
                        role: role || 'Admin',
                        action: 'Update',
                        target: 'Inventory',
                        details: note.slice(0, 500)
                    }
                }).catch(() => {});
            }
        }
        
        res.json(sanitizeMedicine(updatedMed));
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
            updated = await prisma.medicines.update({
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

