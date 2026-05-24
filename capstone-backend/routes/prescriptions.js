const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

async function ensurePharmacyColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE public.prescriptions
    ADD COLUMN IF NOT EXISTS pharmacy_source text DEFAULT 'not_sent',
    ADD COLUMN IF NOT EXISTS pharmacy_status text DEFAULT 'Not Sent',
    ADD COLUMN IF NOT EXISTS external_purchase_allowed boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS dispensed_by text NULL,
    ADD COLUMN IF NOT EXISTS dispensed_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS pharmacy_notes text NULL;
  `).catch(() => {});
}

function defaultPharmacyFields(row) {
  const sourceRaw = String(row?.pharmacy_source || row?.pharmacySource || '').trim().toLowerCase();
  const source = sourceRaw || ((row?.is_sent_to_pharmacy || row?.isSentToPharmacy) ? 'hospital' : 'not_sent');
  const statusRaw = String(row?.pharmacy_status || row?.pharmacyStatus || '').trim();
  const status = statusRaw || (source === 'hospital' ? 'Pending' : source === 'external' ? 'Bought Outside' : 'Not Sent');
  return {
    pharmacySource: source,
    pharmacyStatus: status,
    externalPurchaseAllowed: Boolean(row?.external_purchase_allowed ?? row?.externalPurchaseAllowed ?? source === 'external'),
    dispensedBy: row?.dispensed_by || row?.dispensedBy || null,
    dispensedAt: row?.dispensed_at || row?.dispensedAt || null,
    pharmacyNotes: row?.pharmacy_notes || row?.pharmacyNotes || null
  };
}

async function loadPharmacyMeta(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const safeIds = ids.map((id) => String(id)).filter((id) => /^\d+$/.test(id));
  if (safeIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, pharmacy_source, pharmacy_status, external_purchase_allowed, dispensed_by, dispensed_at, pharmacy_notes
    FROM public.prescriptions
    WHERE id IN (${safeIds.join(',')})
  `).catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
}

function serializePrescription(row, pharmacyMeta) {
  const meta = { ...defaultPharmacyFields({ ...row, ...pharmacyMeta }) };
  return {
    ...row,
    id: row.id.toString(),
    patientId: row.patient_id,
    doctorName: row.doctor_name,
    patientName: row.patients ? `${row.patients.first_name || ''} ${row.patients.last_name || ''}`.trim() : '',
    ...meta
  };
}

function derivePrescriptionRouting(body = {}) {
  const sourceRaw = String(body.pharmacySource || '').trim().toLowerCase();
  if (sourceRaw === 'hospital') {
    return {
      pharmacySource: 'hospital',
      pharmacyStatus: String(body.pharmacyStatus || '').trim() || 'Pending',
      externalPurchaseAllowed: false,
      isSentToPharmacy: true
    };
  }
  if (sourceRaw === 'external') {
    return {
      pharmacySource: 'external',
      pharmacyStatus: String(body.pharmacyStatus || '').trim() || 'Bought Outside',
      externalPurchaseAllowed: true,
      isSentToPharmacy: false
    };
  }
  return {
    pharmacySource: 'not_sent',
    pharmacyStatus: String(body.pharmacyStatus || '').trim() || 'Not Sent',
    externalPurchaseAllowed: false,
    isSentToPharmacy: false
  };
}

router.get('/', async (req, res) => {
  try {
    await ensurePharmacyColumns();
    const { patientId, all, sentToPharmacy, pharmacyStatus, pharmacySource } = req.query;
    console.log("Fetching prescriptions with query:", req.query);
    let where = {};
    
    if (patientId) {
      where.patient_id = patientId;
    }
    
    if (sentToPharmacy === 'true') {
      where.is_sent_to_pharmacy = true;
    }

    // If no specific filter and not 'all', return empty
    if (!patientId && all !== 'true' && sentToPharmacy !== 'true') {
        console.log("No filters provided, returning empty array");
        return res.json([]);
    }

    let prescriptions = await prisma.prescriptions.findMany({
      where,
      include: {
        patients: {
          select: {
            first_name: true,
            last_name: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 100
    });

    const pharmacyMeta = await loadPharmacyMeta(prescriptions.map((p) => p.id.toString()));
    prescriptions = prescriptions
      .map((p) => serializePrescription(p, pharmacyMeta.get(p.id.toString())))
      .filter((p) => {
        if (pharmacyStatus && String(p.pharmacyStatus || '').toLowerCase() !== String(pharmacyStatus).toLowerCase()) return false;
        if (pharmacySource && String(p.pharmacySource || '').toLowerCase() !== String(pharmacySource).toLowerCase()) return false;
        return true;
      });
    
    console.log(`Found ${prescriptions.length} prescriptions in database.`);
    if (prescriptions.length > 0) {
        console.log("First item sample:", {
            id: prescriptions[0].id.toString(),
            sent: prescriptions[0].is_sent_to_pharmacy
        });
    }
    
    // Serialize ID
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await ensurePharmacyColumns();
    const p = await prisma.prescriptions.findUnique({
      where: { id: BigInt(req.params.id) }
    });
    if (!p) return res.status(404).json({ message: 'Not found' });
    const pharmacyMeta = await loadPharmacyMeta([p.id.toString()]);
    res.json({
      ...p,
      id: p.id.toString(),
      patientId: p.patient_id,
      doctorName: p.doctor_name,
      ...defaultPharmacyFields(pharmacyMeta.get(p.id.toString()) || p)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', requireRole(['doctor', 'admin']), async (req, res) => {
  try {
    await ensurePharmacyColumns();
    const { patientId, doctorName, diagnosis, instructions, items, isSentToPharmacy } = req.body;
    if (!patientId || !doctorName) {
      return res.status(400).json({ message: 'patientId and doctorName are required' });
    }
    const cleanItems = Array.isArray(items) ? items.filter((it) => it && it.medication) : [];
    if (cleanItems.length === 0) {
      return res.status(400).json({ message: 'At least one medication item is required' });
    }

    const routing = derivePrescriptionRouting(req.body);
    const created = await prisma.prescriptions.create({
      data: {
        patient_id: patientId,
        doctor_name: doctorName,
        diagnosis,
        instructions,
        items: cleanItems,
        is_sent_to_pharmacy: routing.isSentToPharmacy || !!isSentToPharmacy
      }
    });

    await prisma.$executeRawUnsafe(
      `UPDATE public.prescriptions
       SET pharmacy_source = $1,
           pharmacy_status = $2,
           external_purchase_allowed = $3,
           pharmacy_notes = $4
       WHERE id = $5`,
      routing.pharmacySource,
      routing.pharmacyStatus,
      routing.externalPurchaseAllowed,
      String(req.body.pharmacyNotes || '').trim() || null,
      BigInt(created.id)
    ).catch(() => {});

    prisma.activity_logs.create({
      data: {
        actor_name: doctorName,
        role: 'Doctor',
        action: 'Create',
        target: `Patient:${patientId}`,
        details: 'Created prescription'
      }
    }).catch(() => {});

    res.status(201).json({
        ...created,
        id: created.id.toString(),
        ...routing,
        pharmacyNotes: String(req.body.pharmacyNotes || '').trim() || null
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.patch('/:id/pharmacy', requireRole(['doctor', 'admin', 'pharmacist']), async (req, res) => {
  try {
    await ensurePharmacyColumns();
    const id = BigInt(String(req.params.id || '').trim());
    const existing = await prisma.prescriptions.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const updates = [];
    const values = [];
    let idx = 1;
    const setField = (column, value) => {
      updates.push(`${column} = $${idx}`);
      values.push(value);
      idx += 1;
    };

    if (req.body.pharmacySource !== undefined) setField('pharmacy_source', String(req.body.pharmacySource || 'not_sent').trim().toLowerCase());
    if (req.body.pharmacyStatus !== undefined) setField('pharmacy_status', String(req.body.pharmacyStatus || 'Not Sent').trim());
    if (req.body.externalPurchaseAllowed !== undefined) setField('external_purchase_allowed', Boolean(req.body.externalPurchaseAllowed));
    if (req.body.dispensedBy !== undefined) setField('dispensed_by', String(req.body.dispensedBy || '').trim() || null);
    if (req.body.dispensedAt !== undefined) setField('dispensed_at', req.body.dispensedAt ? new Date(req.body.dispensedAt) : null);
    if (req.body.pharmacyNotes !== undefined) setField('pharmacy_notes', String(req.body.pharmacyNotes || '').trim() || null);
    if (req.body.isSentToPharmacy !== undefined) setField('is_sent_to_pharmacy', Boolean(req.body.isSentToPharmacy));

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No pharmacy updates provided.' });
    }

    values.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE public.prescriptions SET ${updates.join(', ')} WHERE id = $${idx}`,
      ...values
    );

    const fresh = await prisma.prescriptions.findUnique({
      where: { id },
      include: { patients: { select: { first_name: true, last_name: true } } }
    });
    const pharmacyMeta = await loadPharmacyMeta([String(id)]);
    res.json(serializePrescription(fresh, pharmacyMeta.get(String(id))));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

