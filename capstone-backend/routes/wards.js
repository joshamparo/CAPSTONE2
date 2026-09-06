const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const requireNurseDepartment = require('../middleware/requireNurseDepartment');

const authorizeNurseDepartment = (req, res, next) => {
  if (req.auth?.role !== 'nurse') return next();
  // The unassigned Nurse workspace is the hospital's central ER/reception
  // workspace. Keep this fallback local to bed management; all other nurse
  // services retain their own department-scoped authorization.
  req.nurseDepartmentFallback = 'ER';
  return requireNurseDepartment(req, res, next);
};

const NURSE_WARD_BY_DEPARTMENT = Object.freeze({
  ER: 'Emergency',
  PEDIA: 'Pediatrics',
  MEDICINE: 'General Ward'
});


const DEFAULT_WARD_PLAN = [
  { name: 'ICU', total_capacity: 5, color: '#ef4444', shortCode: 'ICU' },
  { name: 'General Ward', total_capacity: 12, color: '#3b82f6', shortCode: 'GW' },
  { name: 'Pediatrics', total_capacity: 5, color: '#10b981', shortCode: 'PD' },
  { name: 'Emergency', total_capacity: 3, color: '#f59e0b', shortCode: 'ER' }
];

const MANUAL_ROOM_STATUSES = new Set(['available', 'reserved', 'cleaning', 'maintenance', 'inactive']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function titleCaseStatus(value) {
  const normalized = normalizeText(value);
  if (!normalized) return 'Available';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function defaultColorForWard(name) {
  const normalized = normalizeText(name);
  const matched = DEFAULT_WARD_PLAN.find((ward) => normalized === normalizeText(ward.name));
  if (matched) return matched.color;
  return '#64748b';
}

function defaultCodeForWard(name) {
  const normalized = normalizeText(name);
  const matched = DEFAULT_WARD_PLAN.find((ward) => normalized === normalizeText(ward.name));
  if (matched) return matched.shortCode;
  const compact = String(name || 'RM')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('');
  return compact || 'RM';
}

function classifyPatientWard(patient) {
  const wardNumber = normalizeText(patient?.ward_number);
  const admissionStatus = normalizeText(patient?.admission_status);

  if (wardNumber.includes('icu')) return 'ICU';
  if (wardNumber.includes('pedia') || wardNumber.includes('pediatric')) return 'Pediatrics';
  if (wardNumber.includes('er') || wardNumber.includes('emergency') || admissionStatus === 'emergency') return 'Emergency';
  if (admissionStatus === 'admitted' || admissionStatus === 'inpatient' || wardNumber) return 'General Ward';
  return 'General Ward';
}

function canAutoAssignRoom(status) {
  const normalized = normalizeText(status);
  return normalized === 'available';
}

function nurseWardName(req) {
  if (req.auth?.role !== 'nurse') return '';
  return NURSE_WARD_BY_DEPARTMENT[String(req.nurseDepartment || '').trim().toUpperCase()] || '';
}

function scopeRegistryForRequest(registry, req) {
  const wardName = nurseWardName(req);
  if (req.auth?.role !== 'nurse') return registry;
  if (!wardName) return { wards: [], rooms: [], totals: { totalRooms: 0, occupied: 0, available: 0, reserved: 0, cleaning: 0, maintenance: 0, inactive: 0, overflow: 0 } };
  // ER is the hospital-wide head-nurse workspace. Other inpatient nurses see
  // only the ward and room totals that belong to their department.
  if (String(req.nurseDepartment || '').trim().toUpperCase() === 'ER') return registry;
  const wards = (registry.wards || []).filter((ward) => normalizeText(ward.name) === normalizeText(wardName));
  const rooms = (registry.rooms || []).filter((room) => normalizeText(room.wardName) === normalizeText(wardName));
  const totals = wards.reduce((acc, ward) => {
    acc.totalRooms += Number(ward.totalCapacity || 0);
    for (const key of ['occupied', 'available', 'reserved', 'cleaning', 'maintenance', 'inactive', 'overflow']) {
      acc[key] += Number(ward[key] || 0);
    }
    return acc;
  }, { totalRooms: 0, occupied: 0, available: 0, reserved: 0, cleaning: 0, maintenance: 0, inactive: 0, overflow: 0 });
  return { wards, rooms, totals };
}

function roomMutationFailure(err, fallbackMessage) {
  const detail = String(err?.message || '');
  const databaseCode = String(err?.meta?.code || err?.code || '');
  if (err?.status) return { status: Number(err.status), message: detail || fallbackMessage };
  if (databaseCode === '23505' || databaseCode === 'P2002' || /duplicate key/i.test(detail)) {
    return { status: 409, message: 'Room code already exists.' };
  }
  console.error('[Ward room mutation] Failed:', databaseCode || 'database_error', detail);
  return { status: 500, message: fallbackMessage };
}

async function ensureWardRoomsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.ward_rooms (
      id BIGSERIAL PRIMARY KEY,
      room_code TEXT NOT NULL UNIQUE,
      ward_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Available',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ward_rooms_ward_name
    ON public.ward_rooms (ward_name)
  `);
}

async function ensureWardsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.wards (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      total_capacity INTEGER,
      color TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureWardSeed() {
  await ensureWardsTable();
  let wards = await prisma.wards.findMany({ orderBy: { id: 'asc' } });
  if (wards.length > 0) return wards;

  await prisma.wards.createMany({
    data: DEFAULT_WARD_PLAN.map((ward) => ({
      name: ward.name,
      total_capacity: ward.total_capacity,
      color: ward.color
    }))
  });

  wards = await prisma.wards.findMany({ orderBy: { id: 'asc' } });
  return wards;
}

async function ensureRoomSeed() {
  await ensureWardRoomsTable();
  const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM public.ward_rooms`);
  const existingCount = Number(Array.isArray(countRows) ? countRows[0]?.count : 0) || 0;
  if (existingCount > 0) return;

  const rooms = [];
  DEFAULT_WARD_PLAN.forEach((ward) => {
    for (let index = 1; index <= ward.total_capacity; index += 1) {
      rooms.push({
        room_code: `${ward.shortCode}-${String(index).padStart(2, '0')}`,
        ward_name: ward.name,
        status: 'Available',
        note: ''
      });
    }
  });

  for (const room of rooms) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO public.ward_rooms (room_code, ward_name, status, note)
        VALUES ('${room.room_code.replace(/'/g, "''")}', '${room.ward_name.replace(/'/g, "''")}', '${room.status.replace(/'/g, "''")}', '${(room.note || '').replace(/'/g, "''")}')
      `
    );
  }
}

let ensureWardInfrastructurePromise;

async function ensureWardInfrastructure() {
  if (!ensureWardInfrastructurePromise) {
    ensureWardInfrastructurePromise = (async () => {
      await ensureWardsTable();
      await ensureWardRoomsTable();
      await ensureWardSeed();
      await ensureRoomSeed();
    })();
  }
  return ensureWardInfrastructurePromise;
}

async function ensureWardExists(wardName) {
  await ensureWardInfrastructure();
  const trimmed = String(wardName || '').trim();
  if (!trimmed) return;
  const existing = await prisma.wards.findFirst({ where: { name: trimmed } });
  if (existing) return;
  await prisma.wards.create({
    data: {
      name: trimmed,
      total_capacity: 0,
      color: defaultColorForWard(trimmed)
    }
  });
}

async function getRoomRows() {
  await ensureWardInfrastructure();
  const rooms = await prisma.$queryRawUnsafe(`
    SELECT id, room_code, ward_name, status, note, created_at, updated_at
    FROM public.ward_rooms
    ORDER BY ward_name ASC, room_code ASC
  `);
  return rooms;
}

async function syncWardCapacitiesFromRooms(roomRows) {
  const counts = new Map();
  (Array.isArray(roomRows) ? roomRows : []).forEach((room) => {
    const wardName = String(room.room_code != null ? room.ward_name : room.wardName || '').trim();
    if (!wardName) return;
    const status = titleCaseStatus(room.status != null ? room.status : room.manualStatus);
    const current = counts.get(wardName) || 0;
    counts.set(wardName, current + (normalizeText(status) === 'inactive' ? 0 : 1));
  });

  for (const [wardName, totalCapacity] of counts.entries()) {
    await prisma.wards.updateMany({
      where: { name: wardName },
      data: { total_capacity: totalCapacity }
    });
  }
}

async function getAdmittedPatients() {
  const admitted = await prisma.$queryRawUnsafe(`
    SELECT id, ward_number, first_name, last_name 
    FROM public.patients 
    WHERE admission_status IN ('Admitted', 'Inpatient') AND ward_number IS NOT NULL AND ward_number != ''
  `);
  return Array.isArray(admitted) ? admitted : [];
}

buildWardRegistry._cache = { fetchedAt: 0, payload: null, promise: null };

async function buildWardRegistry() {
  await ensureWardInfrastructure();
  
  // Ensure cache object exists
  if (!buildWardRegistry._cache) {
    buildWardRegistry._cache = { fetchedAt: 0, payload: null, promise: null };
  }

  const now = Date.now();
  if (buildWardRegistry._cache.payload && now - buildWardRegistry._cache.fetchedAt < 5000) {
    return buildWardRegistry._cache.payload;
  }
  if (buildWardRegistry._cache.promise) {
    return buildWardRegistry._cache.promise;
  }

  buildWardRegistry._cache.promise = (async () => {
    try {
      const [wardRows, roomRows, patients] = await Promise.all([
        prisma.wards.findMany({ orderBy: { id: 'asc' } }),
        getRoomRows(),
        getAdmittedPatients()
      ]);

  await syncWardCapacitiesFromRooms(roomRows);

  const wardMetaByName = new Map(
    (Array.isArray(wardRows) ? wardRows : []).map((ward) => [
      String(ward.name || '').trim(),
      {
        color: ward.color || defaultColorForWard(ward.name),
        wardId: String(ward.id)
      }
    ])
  );

  const baseRooms = (Array.isArray(roomRows) ? roomRows : []).map((room) => ({
    id: String(room.id),
    roomCode: String(room.room_code || '').trim(),
    wardName: String(room.ward_name || '').trim(),
    manualStatus: titleCaseStatus(room.status),
    note: String(room.note || '').trim(),
    createdAt: room.created_at,
    updatedAt: room.updated_at
  }));

  const roomByCode = new Map(baseRooms.map((room) => [normalizeText(room.roomCode), room]));
  const occupiedRoomIds = new Set();
  const roomPatientMap = new Map();

  patients.forEach((patient) => {
    const wardNumber = normalizeText(patient.ward_number);
    const exactRoom = wardNumber ? roomByCode.get(wardNumber) : null;
    const patientLabel = `${String(patient.first_name || '').trim()} ${String(patient.last_name || '').trim()}`.trim() || `Patient ${patient.id}`;

    if (exactRoom) {
      occupiedRoomIds.add(exactRoom.id);
      roomPatientMap.set(exactRoom.id, {
        id: String(patient.id),
        name: patientLabel
      });
    }
  });

  const effectiveRooms = baseRooms.map((room) => {
    const occupied = occupiedRoomIds.has(room.id);
    const effectiveStatus = occupied ? 'Occupied' : room.manualStatus;
    return {
      ...room,
      status: effectiveStatus,
      occupied,
      patient: roomPatientMap.get(room.id) || null,
      color: wardMetaByName.get(room.wardName)?.color || defaultColorForWard(room.wardName)
    };
  });

  const knownWardNames = Array.from(new Set([
    ...Array.from(wardMetaByName.keys()),
    ...baseRooms.map(r => r.wardName)
  ])).filter(Boolean);

  const wards = knownWardNames.map((wardName) => {
      const rooms = effectiveRooms.filter((room) => room.wardName === wardName);
      const occupied = rooms.filter((room) => room.status === 'Occupied').length;
      const available = rooms.filter((room) => room.status === 'Available').length;
      const reserved = rooms.filter((room) => room.status === 'Reserved').length;
      const cleaning = rooms.filter((room) => room.status === 'Cleaning').length;
      const maintenance = rooms.filter((room) => room.status === 'Maintenance').length;
      const inactive = rooms.filter((room) => room.status === 'Inactive').length;
      const operationalTotal = rooms.filter((room) => room.status !== 'Inactive').length;
      return {
        id: wardMetaByName.get(wardName)?.wardId || normalizeText(wardName) || wardName,
        name: wardName,
        color: wardMetaByName.get(wardName)?.color || defaultColorForWard(wardName),
        totalCapacity: operationalTotal,
        occupied,
        available,
        reserved,
        cleaning,
        maintenance,
        inactive,
        overflow: 0
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = wards.reduce(
    (acc, ward) => {
      acc.totalRooms += Number(ward.totalCapacity || 0);
      acc.occupied += Number(ward.occupied || 0);
      acc.available += Number(ward.available || 0);
      acc.reserved += Number(ward.reserved || 0);
      acc.cleaning += Number(ward.cleaning || 0);
      acc.maintenance += Number(ward.maintenance || 0);
      acc.inactive += Number(ward.inactive || 0);
      acc.overflow += Number(ward.overflow || 0);
      return acc;
    },
    { totalRooms: 0, occupied: 0, available: 0, reserved: 0, cleaning: 0, maintenance: 0, inactive: 0, overflow: 0 }
  );

  const payload = { wards, rooms: effectiveRooms, totals };
  buildWardRegistry._cache.fetchedAt = Date.now();
  buildWardRegistry._cache.payload = payload;
  return payload;
    } catch (err) {
      console.error('Error building ward registry:', err);
      throw err;
    }
  })().finally(() => {
    if (buildWardRegistry._cache) {
      buildWardRegistry._cache.promise = null;
    }
  });

  return buildWardRegistry._cache.promise;
}

function validateRoomPayload(body) {
  const roomCode = String(body?.roomCode || body?.room_code || '').trim();
  const wardName = String(body?.wardName || body?.ward_name || '').trim();
  const wardIdRaw = body?.wardId ?? body?.ward_id;
  const wardId = wardIdRaw != null && String(wardIdRaw).trim() !== '' ? String(wardIdRaw).trim() : null;
  const status = titleCaseStatus(body?.status);
  const note = String(body?.note || '').trim();
  const roomTypeRaw = body?.roomType ?? body?.room_type;
  const roomType = roomTypeRaw != null && String(roomTypeRaw).trim() !== '' ? String(roomTypeRaw).trim() : null;
  const bedCountRaw = body?.bedCount ?? body?.bed_count;
  const capacityRaw = body?.capacity;
  let bedCount = null;
  let capacity = null;

  if (!roomCode) {
    const err = new Error('Room code is required.');
    err.status = 400;
    throw err;
  }
  if (roomCode.length > 32) {
    const err = new Error('Room code must be 32 characters or less.');
    err.status = 400;
    throw err;
  }

  if (!wardName) {
    const err = new Error('Ward name is required.');
    err.status = 400;
    throw err;
  }
  if (wardName.length > 64) {
    const err = new Error('Ward name must be 64 characters or less.');
    err.status = 400;
    throw err;
  }

  if (wardId && !/^\d+$/.test(wardId)) {
    const err = new Error('Ward selection is invalid.');
    err.status = 400;
    throw err;
  }

  if (!MANUAL_ROOM_STATUSES.has(normalizeText(status))) {
    const err = new Error('Invalid room status.');
    err.status = 400;
    throw err;
  }

  if (note.length > 500) {
    const err = new Error('Room note must be 500 characters or less.');
    err.status = 400;
    throw err;
  }

  if (roomType && roomType.length > 32) {
    const err = new Error('Room type must be 32 characters or less.');
    err.status = 400;
    throw err;
  }

  if (bedCountRaw !== undefined && bedCountRaw !== null && String(bedCountRaw).trim() !== '') {
    const n = Number(bedCountRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      const err = new Error('Bed count must be zero or a positive whole number.');
      err.status = 400;
      throw err;
    }
    if (n > 999) {
      const err = new Error('Bed count cannot exceed 999.');
      err.status = 400;
      throw err;
    }
    bedCount = n;
  }

  if (capacityRaw !== undefined && capacityRaw !== null && String(capacityRaw).trim() !== '') {
    const n = Number(capacityRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      const err = new Error('Capacity must be zero or a positive whole number.');
      err.status = 400;
      throw err;
    }
    if (n > 999) {
      const err = new Error('Capacity cannot exceed 999.');
      err.status = 400;
      throw err;
    }
    capacity = n;
  }

  return { roomCode, wardName, wardId, status, note, roomType, bedCount, capacity };
}

router.get('/', requireRole(['admin', 'nurse', 'doctor']), authorizeNurseDepartment, async (req, res) => {
  try {
    const registry = scopeRegistryForRequest(await buildWardRegistry(), req);
    res.json(
      registry.wards.map((ward) => ({
        id: ward.id,
        name: ward.name,
        totalCapacity: ward.totalCapacity,
        color: ward.color,
        occupied: ward.occupied,
        available: ward.available,
        reserved: ward.reserved,
        cleaning: ward.cleaning,
        maintenance: ward.maintenance,
        overflow: ward.overflow
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load ward status.' });
  }
});

router.get('/rooms', requireRole(['admin', 'nurse', 'doctor']), authorizeNurseDepartment, async (req, res) => {
  try {
    const registry = await buildWardRegistry();
    res.json(scopeRegistryForRequest(registry, req));
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load room registry.' });
  }
});

router.post('/rooms', requireRole(['admin']), async (req, res) => {
  try {
    await ensureWardRoomsTable();
    const payload = validateRoomPayload(req.body || {});
    await ensureWardExists(payload.wardName);

    const columns = ['room_code', 'ward_name', 'status', 'note', 'updated_at'];
    const parameters = [payload.roomCode, payload.wardName, payload.status, payload.note || ''];
    const values = ['$1', '$2', '$3', '$4', 'NOW()'];
    const addParameter = (column, value) => {
      columns.push(column);
      parameters.push(value);
      values.push(`$${parameters.length}`);
    };

    if (payload.wardId) addParameter('ward_id', BigInt(payload.wardId));
    if (payload.roomType) addParameter('room_type', payload.roomType);
    if (payload.bedCount !== null && payload.bedCount !== undefined) addParameter('bed_count', Number(payload.bedCount));
    if (payload.capacity !== null && payload.capacity !== undefined) addParameter('capacity', Number(payload.capacity));

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO public.ward_rooms (${columns.join(', ')})
        VALUES (${values.join(', ')})
      `,
      ...parameters
    );

    buildWardRegistry._cache.payload = null;
    const registry = await buildWardRegistry();
    const created = registry.rooms.find((room) => normalizeText(room.roomCode) === normalizeText(payload.roomCode));
    res.status(201).json(created || registry);
  } catch (err) {
    const failure = roomMutationFailure(err, 'Unable to create the room right now. Please try again.');
    res.status(failure.status).json({ message: failure.message });
  }
});

router.patch('/rooms/:id', requireRole(['admin']), async (req, res) => {
  try {
    await ensureWardRoomsTable();
    const roomId = String(req.params.id || '').trim();
    if (!/^\d+$/.test(roomId)) return res.status(400).json({ message: 'A valid room id is required.' });

    const registryBefore = await buildWardRegistry();
    const existingRoom = registryBefore.rooms.find((room) => room.id === roomId);
    if (!existingRoom) return res.status(404).json({ message: 'Room not found.' });

    const payload = validateRoomPayload({
      roomCode: req.body?.roomCode ?? existingRoom.roomCode,
      wardName: req.body?.wardName ?? existingRoom.wardName,
      wardId: req.body?.wardId ?? existingRoom.wardId ?? existingRoom.ward_id,
      status: req.body?.status ?? existingRoom.manualStatus,
      note: req.body?.note ?? existingRoom.note,
      roomType: req.body?.roomType ?? req.body?.room_type ?? existingRoom.roomType ?? existingRoom.room_type,
      bedCount: req.body?.bedCount ?? req.body?.bed_count ?? existingRoom.bedCount ?? existingRoom.bed_count,
      capacity: req.body?.capacity ?? existingRoom.capacity
    });

    if (existingRoom.occupied && normalizeText(payload.status) !== normalizeText(existingRoom.manualStatus)) {
      return res.status(400).json({ message: 'Occupied rooms are controlled by patient assignment. Update the patient room first before changing room status.' });
    }

    await ensureWardExists(payload.wardName);

    const parameters = [];
    const assignments = [];
    const addAssignment = (column, value) => {
      parameters.push(value);
      assignments.push(`${column} = $${parameters.length}`);
    };
    addAssignment('room_code', payload.roomCode);
    addAssignment('ward_name', payload.wardName);
    addAssignment('status', payload.status);
    addAssignment('note', payload.note || '');
    if (payload.wardId) addAssignment('ward_id', BigInt(payload.wardId));
    if (payload.roomType) addAssignment('room_type', payload.roomType);
    if (payload.bedCount !== null && payload.bedCount !== undefined) addAssignment('bed_count', Number(payload.bedCount));
    if (payload.capacity !== null && payload.capacity !== undefined) addAssignment('capacity', Number(payload.capacity));
    assignments.push(`updated_at = NOW()`);
    parameters.push(BigInt(roomId));

    await prisma.$executeRawUnsafe(
      `
        UPDATE public.ward_rooms
        SET ${assignments.join(', ')}
        WHERE id = $${parameters.length}::bigint
      `,
      ...parameters
    );

    buildWardRegistry._cache.payload = null;
    const registry = await buildWardRegistry();
    const updated = registry.rooms.find((room) => room.id === roomId || normalizeText(room.roomCode) === normalizeText(payload.roomCode));
    res.json(updated || registry);
  } catch (err) {
    const failure = roomMutationFailure(err, 'Unable to update the room right now. Please try again.');
    res.status(failure.status).json({ message: failure.message });
  }
});

router.post('/', requireRole(['admin']), async (req, res) => {
  try {
    const errors = [];
    const cleanStr = (v) => String(v || "").trim();
    const name = cleanStr(req.body?.name);
    const totalCapRaw = req.body?.totalCapacity ?? req.body?.total_capacity;
    const color = cleanStr(req.body?.color) || null;
    if (!name) errors.push('Ward name is required.');
    else if (name.length > 64) errors.push('Ward name must be 64 characters or less.');
    let totalCapacity = null;
    if (totalCapRaw !== undefined && totalCapRaw !== null && String(totalCapRaw).trim() !== '') {
      const n = Number(totalCapRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) errors.push('Ward total capacity must be zero or a positive whole number.');
      else if (n > 9999) errors.push('Ward total capacity cannot exceed 9999.');
      else totalCapacity = n;
    }
    if (errors.length > 0) return res.status(400).json({ message: errors.join(' | ') });
    const data = { name };
    if (totalCapacity !== null) data.total_capacity = totalCapacity;
    if (color) data.color = color;
    else data.color = defaultColorForWard(name);

    const newWard = await prisma.wards.create({ data });
    res.status(201).json({ ...newWard, id: String(newWard.id) });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Failed to create ward.' });
  }
});

router.delete('/:id', requireRole(['admin']), async (req, res) => {
  try {
    const wardId = String(req.params.id || '').trim();
    if (!wardId) return res.status(400).json({ message: 'Ward id is required.' });

    const ward = await prisma.wards.findFirst({ where: { id: BigInt(wardId) } }).catch(() => null);
    if (!ward) return res.status(404).json({ message: 'Ward not found.' });

    await ensureWardRoomsTable();
    const roomRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM public.ward_rooms WHERE ward_name = $1`,
      String(ward.name || '')
    );
    const roomCount = Number(Array.isArray(roomRows) ? roomRows[0]?.count : 0) || 0;
    if (roomCount > 0) {
      return res.status(400).json({ message: 'Cannot delete a ward that still has rooms assigned.' });
    }

    await prisma.wards.delete({ where: { id: BigInt(wardId) } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to delete ward.' });
  }
});

router.post('/assign-patient', requireRole(['admin', 'nurse']), authorizeNurseDepartment, async (req, res) => {
  try {
    const { patientId, roomCode } = req.body;
    console.log('[AssignPatient] Payload:', { patientId, roomCode });

    if (!patientId || !roomCode) {
      return res.status(400).json({ message: 'Patient ID and Room Code are required.' });
    }

    const patient = await prisma.patients.findUnique({ where: { id: patientId } });
    if (!patient) {
        console.error('[AssignPatient] Patient not found:', patientId);
        return res.status(404).json({ message: 'Patient not found.' });
    }

    // Check if room is available
    const registry = await buildWardRegistry();
    const targetRoom = registry.rooms.find(r => normalizeText(r.roomCode) === normalizeText(roomCode));
    
    if (!targetRoom) {
        console.error('[AssignPatient] Room not found:', roomCode);
        return res.status(404).json({ message: 'Room not found.' });
    }
    
    if (targetRoom.occupied && String(targetRoom.patient?.id || '') !== String(patientId)) {
        console.error('[AssignPatient] Room already occupied:', roomCode, 'by', targetRoom.patient?.name);
        return res.status(409).json({ message: `Room ${roomCode} is already occupied.` });
    }
    const isErHeadNurse = req.auth?.role === 'nurse' && String(req.nurseDepartment || '').trim().toUpperCase() === 'ER';
    if (req.auth?.role === 'nurse' && !isErHeadNurse) {
      return res.status(403).json({ message: 'Only the ER head nurse can assign patients to wards and rooms.' });
    }

    await prisma.$transaction(async (tx) => {
      // Lock both the patient and room in a stable order. This prevents two
      // rapid clicks (or two nurses) from assigning the same patient/bed twice.
      const lockKeys = [`patient:${patientId}`, `room:${String(roomCode).trim().toLowerCase()}`].sort();
      for (const lockKey of lockKeys) {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey);
      }
      const currentPatient = await tx.patients.findUnique({
        where: { id: patientId },
        select: { ward_number: true, admission_status: true }
      });
      const currentRoom = String(currentPatient?.ward_number || '').trim();
      if (currentRoom && normalizeText(currentRoom) !== normalizeText(roomCode)) {
        const pendingTransfer = await tx.$queryRaw`
          SELECT id FROM public.clinical_orders
          WHERE patient_id = ${patientId}::uuid
            AND lower(kind) = 'transfer request'
            AND lower(status) NOT IN ('completed', 'cancelled', 'rejected')
          LIMIT 1
        `;
        if (!Array.isArray(pendingTransfer) || pendingTransfer.length === 0) {
          const conflict = new Error(`This patient is already assigned to ${currentRoom}. Use the transfer workflow to change rooms.`);
          conflict.statusCode = 409;
          throw conflict;
        }
      }
      const occupiedBy = await tx.patients.findFirst({
        where: {
          ward_number: { equals: String(roomCode).trim(), mode: 'insensitive' },
          admission_status: { not: 'Discharged' },
          id: { not: patientId }
        },
        select: { id: true, first_name: true, last_name: true }
      });
      if (occupiedBy) {
        const conflict = new Error(`Room ${roomCode} was just assigned to another patient.`);
        conflict.statusCode = 409;
        throw conflict;
      }
      await tx.patients.update({
        where: { id: patientId },
        data: {
          ward_number: String(roomCode).trim(),
          admission_status: 'Inpatient'
        }
      });
      await tx.$executeRaw`
        UPDATE public.clinical_orders
        SET status = 'Completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE patient_id = ${patientId}::uuid
          AND lower(kind) IN ('admission request', 'transfer request')
          AND lower(status) NOT IN ('completed', 'cancelled', 'rejected')
      `;
    });

    console.log('[AssignPatient] Success:', { patientId, roomCode });
    // Clear cache
    buildWardRegistry._cache.payload = null;
    
    res.json({ message: 'Patient assigned successfully.' });
  } catch (err) {
    console.error('[AssignPatient] Error:', err);
    res.status(Number(err?.statusCode) || 500).json({ message: err.message || 'Failed to assign patient.' });
  }
});

router.post('/discharge-patient', requireRole(['admin', 'nurse']), authorizeNurseDepartment, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ message: 'Patient ID is required.' });
    const pid = String(patientId).trim();
    if (!pid) return res.status(400).json({ message: 'Patient ID is required.' });

    const existing = await prisma.patients.findUnique({
      where: { id: pid },
      select: { id: true, ward_number: true, bed_number: true }
    });
    if (!existing) return res.status(404).json({ message: 'Patient not found.' });
    const affectedWard = existing.ward_number;
    if (req.auth?.role === 'nurse') {
      const allowedWard = nurseWardName(req);
      const registry = await buildWardRegistry();
      const patientRoom = (registry.rooms || []).find((room) => normalizeText(room.roomCode) === normalizeText(affectedWard));
      if (!allowedWard || !patientRoom || normalizeText(patientRoom.wardName) !== normalizeText(allowedWard)) {
        return res.status(403).json({ message: 'You can only discharge patients from your department ward.' });
      }
    }

    await prisma.patients.update({
      where: { id: pid },
      data: {
        ward_number: null,
        bed_number: null,
        admission_status: 'Discharged'
      }
    });

    if (affectedWard) {
      const cleanWard = String(affectedWard).trim();
      if (cleanWard) {
        const rooms = await prisma.bed_rooms.findMany({
          where: { ward: cleanWard },
          select: { room_code: true, bed_number: true, patient_id: true }
        }).catch(() => []);
        for (const r of rooms) {
          if (r.patient_id && String(r.patient_id) === pid) {
            await prisma.bed_rooms.updateMany({
              where: { ward: cleanWard, room_code: r.room_code, bed_number: r.bed_number },
              data: { patient_id: null, patient_name: null, is_occupied: false }
            }).catch(() => {});
          }
        }
      }
    }

    // Clear cache
    buildWardRegistry._cache.payload = null;

    res.json({ message: 'Patient discharged successfully.' });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Patient not found.' });
    res.status(500).json({ message: err.message || 'Failed to discharge patient.' });
  }
});

module.exports = router;

