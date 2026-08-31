const express = require('express');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeNurseCalendarMonth, validateNurseCalendarEvent } = require('../utils/nurseCalendar');

const router = express.Router();

const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const normalizeDeptId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const up = raw.toUpperCase().replace(/\s+/g, '');
  if (up === 'EMERGENCYROOM' || up === 'EMERGENCY' || up === 'ER') return 'ER';
  if (up === 'OUTPATIENTDEPT' || up === 'OUTPATIENT' || up === 'OPD') return 'OPD';
  if (up === 'PEDIATRICS' || up === 'PEDIA') return 'PEDIA';
  if (up === 'MEDICINE' || up === 'INTERNALMEDICINE') return 'MEDICINE';
  return raw.toUpperCase();
};

const parseRequestMessage = (msg) => {
  const t = String(msg || '');
  const lines = t.split('\n').map((line) => line.trim()).filter(Boolean);
  const map = {};
  lines.forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '');
      map[key] = line.slice(idx + 1).trim();
    }
  });

  let items = [];
  const itemsRaw = map.itemsjson || map.items || '';
  if (itemsRaw) {
    try {
      const parsed = JSON.parse(itemsRaw);
      items = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      items = [];
    }
  }

  return {
    type: String(map.type || '').trim().toLowerCase(),
    item: map.item || '',
    quantity: Math.max(1, Number(map.quantity || items[0]?.qty || items[0]?.quantity || 1) || 1),
    patient: map.patient || '',
    priority: map.priority || '',
    notes: map.notes || '',
    items
  };
};

const calculateAge = (dob) => {
  const value = dob ? new Date(dob) : null;
  if (!value || Number.isNaN(value.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - value.getFullYear();
  const monthDelta = now.getMonth() - value.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < value.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

const inferPatientDepartment = (patient) => {
  if (!patient || typeof patient !== 'object') return '';
  const admission = String(patient.admission_status || patient.admissionStatus || '').trim().toUpperCase();
  const ward = String(patient.ward_number || patient.wardNumber || '').trim().toUpperCase();
  const diagnosis = String(patient.diagnosis || '').trim().toUpperCase();
  const age = calculateAge(patient.date_of_birth || patient.dateOfBirth);

  if (admission === 'EMERGENCY' || ward.startsWith('E')) return 'ER';
  if (admission === 'OUTPATIENT') return 'OPD';
  if (ward.startsWith('P') || (age != null && age < 18) || diagnosis.includes('PEDI')) return 'PEDIA';
  if (admission === 'INPATIENT' || ward.startsWith('M')) return 'MEDICINE';
  return '';
};

const serializeRow = (row) =>
  JSON.parse(JSON.stringify(row, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));

const safeJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
};

const appointmentIsActive = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return !['completed', 'cancelled', 'no-show', 'no show'].includes(normalized);
};

const appointmentIsErWalkIn = (row) => {
  const reason = String(row?.reason || '').toLowerCase();
  const route = String(row?.triageRoute || '').toLowerCase();
  return reason.includes('[triage][walk-in]') || route.includes('er consultation');
};

const latestWalkInSnapshot = (patient) => {
  const records = safeJson(patient?.clinical_records, {}) || {};
  const walkIns = Array.isArray(records.walkInIntakes) ? records.walkInIntakes : [];
  return walkIns[0] || records.erRegistration || null;
};

const shouldWatchSnapshot = (snapshot, appointment) => {
  const triageLevel = Number(appointment?.triageLevel || snapshot?.triage?.level || 0) || 0;
  const pain = Number(snapshot?.painLevel || 0) || 0;
  const sys = Number(String(snapshot?.vitals?.bloodPressure || '').split('/')[0] || 0) || 0;
  const hr = Number(snapshot?.vitals?.heartRate || 0) || 0;
  const spo2 = Number(snapshot?.vitals?.spo2 || 0) || 0;
  const temp = Number(snapshot?.vitals?.temperature || 0) || 0;

  return (
    (triageLevel > 0 && triageLevel <= 2) ||
    pain >= 7 ||
    (spo2 > 0 && spo2 < 94) ||
    (sys > 180 || (sys > 0 && sys < 90)) ||
    (hr > 120 || (hr > 0 && hr < 50)) ||
    (temp > 39 || (temp > 0 && temp < 35))
  );
};

const formatTimeAgo = (rawDate) => {
  const value = rawDate ? new Date(rawDate) : null;
  if (!value || Number.isNaN(value.getTime())) return '';
  const diffMs = Math.max(0, Date.now() - value.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const actorFromReq = (req) => ({
  role: normalizeRole(req.headers['x-user-role']),
  name: String(req.headers['x-user-name'] || '').trim() || 'Nurse',
  email: String(req.headers['x-user-email'] || '').trim() || null
});

async function ensureWorkflowTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.nurse_handover_notes (
      id bigserial PRIMARY KEY,
      department text NOT NULL,
      shift_label text NULL,
      note_text text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      patient_id uuid NULL,
      patient_name text NULL,
      created_by_name text NULL,
      created_by_email text NULL,
      acknowledged_by_name text NULL,
      acknowledged_by_email text NULL,
      acknowledged_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.nurse_tasks (
      id bigserial PRIMARY KEY,
      department text NOT NULL,
      shift_label text NULL,
      title text NOT NULL,
      priority text NOT NULL DEFAULT 'routine',
      due_time text NULL,
      patient_id uuid NULL,
      patient_name text NULL,
      status text NOT NULL DEFAULT 'open',
      completed boolean NOT NULL DEFAULT false,
      created_by_name text NULL,
      created_by_email text NULL,
      completed_by_name text NULL,
      completed_by_email text NULL,
      completed_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.nurse_med_admin_logs (
      id bigserial PRIMARY KEY,
      department text NOT NULL,
      patient_id uuid NULL,
      patient_name text NULL,
      medication_request_id bigint NULL,
      medication_name text NOT NULL,
      dosage text NULL,
      quantity int NOT NULL DEFAULT 1,
      status text NOT NULL,
      note text NULL,
      administered_by_name text NULL,
      administered_by_email text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.nurse_calendar_events (
      id bigserial PRIMARY KEY,
      owner_email text NOT NULL,
      title text NOT NULL,
      event_date date NOT NULL,
      event_time text NULL,
      event_type text NOT NULL DEFAULT 'event',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS nurse_handover_notes_department_idx ON public.nurse_handover_notes(department, created_at DESC);`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS nurse_tasks_department_idx ON public.nurse_tasks(department, completed, priority);`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS nurse_med_admin_logs_department_idx ON public.nurse_med_admin_logs(department, created_at DESC);`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS nurse_calendar_events_owner_date_idx ON public.nurse_calendar_events(lower(owner_email), event_date);`).catch(() => {});
}

async function loadEmergencyLiveBoard() {
  const appointmentRows = await prisma.$queryRawUnsafe(
    `
      SELECT id,
             patient_id::text AS patient_id,
             first_name,
             last_name,
             doctor_id,
             status,
             reason,
             main_concern,
             description,
             triage_level,
             triage_reasons,
             triaged_at,
             created_at
      FROM public.appointments
      WHERE consultation_mode = 'onsite'
      ORDER BY COALESCE(triaged_at, created_at) DESC
      LIMIT 120
    `
  );

  const activeAppointments = (Array.isArray(appointmentRows) ? appointmentRows : [])
    .map((row) => {
      const triageReasons = safeJson(row.triage_reasons, {}) || {};
      return {
        id: String(row.id),
        patientId: String(row.patient_id || '').trim(),
        patientName: `${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim() || 'Walk-in Patient',
        doctorName: String(row.doctor_id || '').trim() || 'Doctor Queue',
        status: String(row.status || '').trim(),
        reason: String(row.reason || '').trim(),
        mainConcern: String(row.main_concern || '').trim() || null,
        description: String(row.description || '').trim() || null,
        triageLevel: Number(row.triage_level || 0) || null,
        triageRoute: String(triageReasons.route || '').trim(),
        triageReasons,
        createdAt: row.created_at || null,
        triagedAt: row.triaged_at || null
      };
    })
    .filter((row) => appointmentIsActive(row.status) && appointmentIsErWalkIn(row));

  const patientIds = Array.from(new Set(activeAppointments.map((row) => row.patientId).filter(Boolean)));
  const patients = patientIds.length
    ? await prisma.patients.findMany({
        where: { id: { in: patientIds } },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          attending_doctor: true,
          diagnosis: true,
          admission_date: true,
          clinical_records: true,
          ward_number: true
        }
      })
    : [];

  const patientMap = new Map((Array.isArray(patients) ? patients : []).map((patient) => [String(patient.id), patient]));

  const rankedAppointments = activeAppointments
    .map((appointment) => {
      const patient = appointment.patientId ? patientMap.get(appointment.patientId) : null;
      const snapshot = latestWalkInSnapshot(patient) || {};
      return {
        ...appointment,
        snapshot,
        sortLevel: appointment.triageLevel || 99,
        sortTime: appointment.triagedAt ? new Date(appointment.triagedAt).getTime() : (appointment.createdAt ? new Date(appointment.createdAt).getTime() : 0),
        patient
      };
    })
    .sort((a, b) => {
      if (a.sortLevel !== b.sortLevel) return a.sortLevel - b.sortLevel;
      return a.sortTime - b.sortTime;
    });

  const spaces = Array.from({ length: 10 }, (_item, index) => {
    const slotNumber = index + 1;
    const appointment = rankedAppointments[index] || null;
    if (!appointment) {
      return {
        id: `ER-${slotNumber}`,
        label: `E${101 + index}`,
        status: 'free',
        patientName: null,
        patientId: null,
        triageLevel: null,
        doctorName: null,
        mainConcern: null,
        occupantData: null
      };
    }

    const patient = appointment.patient;
    const vitals = appointment.snapshot?.vitals || {};
    return {
      id: `ER-${slotNumber}`,
      label: `E${101 + index}`,
      status: 'occupied',
      patientName: appointment.patientName,
      patientId: appointment.patientId || null,
      triageLevel: appointment.triageLevel,
      doctorName: appointment.doctorName,
      mainConcern: appointment.mainConcern || appointment.snapshot?.mainConcern || null,
      occupantData: {
        firstName: String(patient?.first_name || appointment.patientName.split(' ')[0] || '').trim(),
        lastName: String(patient?.last_name || appointment.patientName.split(' ').slice(1).join(' ') || '').trim(),
        admissionDate: appointment.createdAt || null,
        attendingDoctor: String(patient?.attending_doctor || appointment.doctorName || '').trim() || 'Doctor Queue',
        diagnosis: String(patient?.diagnosis || appointment.mainConcern || appointment.snapshot?.mainConcern || '').trim() || 'ER Observation',
        triageLevel: appointment.triageLevel || null,
        vitals: {
          bloodPressure: vitals?.bloodPressure || null,
          heartRate: vitals?.heartRate || null,
          spo2: vitals?.spo2 || null,
          temperature: vitals?.temperature || null
        }
      }
    };
  });

  const observationWatch = rankedAppointments
    .filter((appointment) => shouldWatchSnapshot(appointment.snapshot, appointment))
    .slice(0, 8)
    .map((appointment) => {
      const vitals = appointment.snapshot?.vitals || {};
      const reasons = Array.isArray(appointment.snapshot?.triage?.reasons)
        ? appointment.snapshot.triage.reasons
        : (Array.isArray(appointment.triageReasons?.reasons) ? appointment.triageReasons.reasons : []);
      const status = (appointment.triageLevel && appointment.triageLevel <= 1) ? 'critical' : 'watch';
      return {
        id: appointment.patientId || appointment.id,
        name: appointment.patientName,
        room: spaces.find((space) => space.patientId === appointment.patientId)?.label || 'ER Queue',
        bp: vitals?.bloodPressure || '—',
        hr: vitals?.heartRate ? String(vitals.heartRate) : '—',
        spo2: vitals?.spo2 ? String(vitals.spo2) : '—',
        status,
        trend: status === 'critical' ? 'up' : 'stable',
        triageLevel: appointment.triageLevel,
        reason: reasons.filter(Boolean).join(', ') || appointment.mainConcern || 'Requires review',
        doctorName: appointment.doctorName
      };
    });

  return {
    spaces,
    observationWatch,
    activeCount: rankedAppointments.length,
    occupiedCount: spaces.filter((space) => space.status === 'occupied').length,
    freeCount: spaces.filter((space) => space.status === 'free').length,
    overflowCount: Math.max(0, rankedAppointments.length - spaces.length)
  };
}

async function loadRecentNurseActivities(department) {
  const logs = await prisma.activity_logs.findMany({
    orderBy: { timestamp: 'desc' },
    take: 100
  }).catch(() => []);

  const relevant = (Array.isArray(logs) ? logs : [])
    .filter((log) => {
      const action = String(log.action || '').toLowerCase();
      const details = String(log.details || '').toLowerCase();
      const role = String(log.role || '').toLowerCase();
      if (department === 'ER') {
        return (
          action.includes('walk-in') ||
          action.includes('medication') ||
          action.includes('patient admitted') ||
          action.includes('handover') ||
          details.includes('er') ||
          role === 'nurse'
        );
      }
      return ['nurse', 'doctor', 'admin'].includes(role);
    })
    .slice(0, 50)
    .map((log) => {
      const action = String(log.action || '').trim() || 'Workflow Update';
      const details = String(log.details || '').trim();
      let type = 'info';
      if (/fail|reject|critical|alert|admitted/i.test(action) || /critical|alert/i.test(details)) type = 'alert';
      if (/saved|completed|approved|recorded|updated/i.test(action)) type = 'success';
      return {
        id: String(log.id),
        title: action,
        message: details || String(log.target || '').trim() || action,
        time: formatTimeAgo(log.timestamp),
        type
      };
    });

  return relevant;
}

async function loadPendingMedicationRequests(department) {
  const rows = await prisma.requests.findMany({
    where: {
      status: {
        in: ['Pending', 'Approved', 'On Hold']
      }
    },
    include: {
      patients: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          date_of_birth: true,
          admission_status: true,
          ward_number: true,
          diagnosis: true
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 200
  });

  return rows
    .map((row) => {
      const parsed = parseRequestMessage(row.message);
      if (parsed.type !== 'medication') return null;
      const patientName =
        String(row.patient_name || '').trim() ||
        `${String(row.patients?.first_name || '').trim()} ${String(row.patients?.last_name || '').trim()}`.trim();
      const patientDepartment = inferPatientDepartment(row.patients || {});
      if (department && patientDepartment && patientDepartment !== department) return null;
      return {
        requestId: row.id.toString(),
        patientId: row.patient_id ? String(row.patient_id) : '',
        patientName,
        department: patientDepartment || department || '',
        medicationName: parsed.item || parsed.items[0]?.name || 'Medication',
        dosage: parsed.notes || '',
        quantity: parsed.quantity || 1,
        priority: parsed.priority || 'Routine',
        status: String(row.status || 'Pending'),
        requestedBy: String(row.requested_by || '').trim(),
        createdAt: row.created_at || null
      };
    })
    .filter(Boolean);
}

router.use(requireRole(['nurse', 'admin']));

router.get('/calendar', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    if (!actor.email) return res.status(401).json({ message: 'Authenticated email is required' });
    const month = normalizeNurseCalendarMonth(req.query.month);
    if (!month) return res.status(400).json({ message: 'month must use YYYY-MM format' });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, title, event_date, event_time, event_type, created_at, updated_at
       FROM public.nurse_calendar_events
       WHERE lower(owner_email) = lower($1)
         AND event_date >= $2::date
         AND event_date < ($2::date + interval '1 month')
       ORDER BY event_date ASC, event_time ASC NULLS LAST, id ASC`,
      actor.email,
      `${month}-01`
    );
    res.json((Array.isArray(rows) ? rows : []).map(serializeRow));
  } catch (error) {
    console.error('Error loading nurse calendar:', error);
    res.status(500).json({ message: 'Unable to load nurse calendar' });
  }
});

router.post('/calendar', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    if (!actor.email) return res.status(401).json({ message: 'Authenticated email is required' });
    const validation = validateNurseCalendarEvent(req.body);
    if (!validation.ok) return res.status(400).json({ message: validation.errors.join(' | ') });
    const event = validation.value;
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO public.nurse_calendar_events (owner_email, title, event_date, event_time, event_type)
       VALUES ($1, $2, $3::date, $4, $5)
       RETURNING id, title, event_date, event_time, event_type, created_at, updated_at`,
      actor.email,
      event.title,
      event.date,
      event.time,
      event.type
    );
    res.status(201).json(serializeRow(Array.isArray(rows) ? rows[0] : null));
  } catch (error) {
    console.error('Error creating nurse calendar event:', error);
    res.status(500).json({ message: 'Unable to create nurse calendar event' });
  }
});

router.delete('/calendar/:id', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    if (!actor.email) return res.status(401).json({ message: 'Authenticated email is required' });
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid calendar event id' });
    const deleted = await prisma.$queryRawUnsafe(
      `DELETE FROM public.nurse_calendar_events
       WHERE id = $1::bigint AND lower(owner_email) = lower($2)
       RETURNING id`,
      id,
      actor.email
    );
    if (!Array.isArray(deleted) || !deleted.length) return res.status(404).json({ message: 'Calendar event not found' });
    res.json({ ok: true, id });
  } catch (error) {
    console.error('Error deleting nurse calendar event:', error);
    res.status(500).json({ message: 'Unable to delete nurse calendar event' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const department = normalizeDeptId(req.query.department);
    const shiftLabel = String(req.query.shift || '').trim();

    const [latestHandoverRows, taskRows, medLogsRows, medQueue, liveBoard, recentActivities] = await Promise.all([
      prisma.$queryRawUnsafe(
        `
          SELECT id, department, shift_label, note_text, status, patient_id::text AS patient_id, patient_name,
                 created_by_name, created_by_email, acknowledged_by_name, acknowledged_by_email,
                 acknowledged_at, created_at, updated_at
          FROM public.nurse_handover_notes
          WHERE ($1::text = '' OR department = $1)
            AND ($2::text = '' OR shift_label = $2)
          ORDER BY created_at DESC
          LIMIT 5
        `,
        department,
        shiftLabel
      ),
      prisma.$queryRawUnsafe(
        `
          SELECT id, department, shift_label, title, priority, due_time,
                 patient_id::text AS patient_id, patient_name, status, completed,
                 created_by_name, created_by_email, completed_by_name, completed_by_email,
                 completed_at, created_at, updated_at
          FROM public.nurse_tasks
          WHERE ($1::text = '' OR department = $1)
            AND ($2::text = '' OR shift_label = $2)
          ORDER BY completed ASC, created_at DESC
          LIMIT 200
        `,
        department,
        shiftLabel
      ),
      prisma.$queryRawUnsafe(
        `
          SELECT id, department, patient_id::text AS patient_id, patient_name, medication_request_id,
                 medication_name, dosage, quantity, status, note,
                 administered_by_name, administered_by_email, created_at
          FROM public.nurse_med_admin_logs
          WHERE ($1::text = '' OR department = $1)
          ORDER BY created_at DESC
          LIMIT 50
        `,
        department
      ),
      loadPendingMedicationRequests(department),
      department === 'ER' ? loadEmergencyLiveBoard() : Promise.resolve(null),
      loadRecentNurseActivities(department)
    ]);

    const latestHandover = Array.isArray(latestHandoverRows) && latestHandoverRows.length ? serializeRow(latestHandoverRows[0]) : null;
    const tasks = Array.isArray(taskRows) ? taskRows.map(serializeRow) : [];
    const medAdminLogs = Array.isArray(medLogsRows) ? medLogsRows.map(serializeRow) : [];

    const taskCounts = {
      urgent: tasks.filter((task) => String(task.priority || '').toLowerCase() === 'urgent' && !task.completed).length,
      routine: tasks.filter((task) => String(task.priority || '').toLowerCase() === 'routine' && !task.completed).length,
      handover: tasks.filter((task) => String(task.priority || '').toLowerCase() === 'handover' && !task.completed).length,
      completed: tasks.filter((task) => Boolean(task.completed)).length
    };

    res.json({
      latestHandover,
      handoverHistory: Array.isArray(latestHandoverRows) ? latestHandoverRows.map(serializeRow) : [],
      tasks,
      taskCounts,
      medAdminLogs,
      pendingMedicationRequests: medQueue,
      liveBoard,
      recentActivities
    });
  } catch (error) {
    console.error('Error loading nurse workflow summary:', error);
    res.status(500).json({ message: 'Unable to load nurse workflow summary' });
  }
});

router.post('/handover', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    const department = normalizeDeptId(req.body?.department);
    const shiftLabel = String(req.body?.shiftLabel || '').trim() || null;
    const noteText = String(req.body?.noteText || '').trim();
    if (!department) return res.status(400).json({ message: 'department is required' });
    if (!noteText) return res.status(400).json({ message: 'noteText is required' });
    if (noteText.length < 3) return res.status(400).json({ message: 'noteText is too short (min 3 characters)' });
    if (noteText.length > 8000) return res.status(400).json({ message: 'noteText is too long (max 8000 characters)' });
    if (shiftLabel && shiftLabel.length > 80) return res.status(400).json({ message: 'shiftLabel is too long (max 80 characters)' });

    const rows = await prisma.$queryRawUnsafe(
      `
        INSERT INTO public.nurse_handover_notes
          (department, shift_label, note_text, patient_id, patient_name, created_by_name, created_by_email)
        VALUES
          ($1, $2, $3, $4::uuid, $5, $6, $7)
        RETURNING id, department, shift_label, note_text, status, patient_id::text AS patient_id,
                  patient_name, created_by_name, created_by_email, acknowledged_by_name,
                  acknowledged_by_email, acknowledged_at, created_at, updated_at
      `,
      department,
      shiftLabel,
      noteText,
      req.body?.patientId || null,
      req.body?.patientName || null,
      actor.name,
      actor.email
    );

    await prisma.activity_logs.create({
      data: {
        actor_name: actor.name,
        role: actor.role || 'nurse',
        action: 'Shift Handover Saved',
        target: department,
        details: `${shiftLabel || 'Active shift'} handover updated`
      }
    }).catch(() => null);

    res.status(201).json(serializeRow(Array.isArray(rows) ? rows[0] : null));
  } catch (error) {
    console.error('Error saving handover note:', error);
    res.status(500).json({ message: 'Unable to save handover note' });
  }
});

router.patch('/handover/:id/acknowledge', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid handover id' });

    const rows = await prisma.$queryRawUnsafe(
      `
        UPDATE public.nurse_handover_notes
        SET status = 'acknowledged',
            acknowledged_by_name = $2,
            acknowledged_by_email = $3,
            acknowledged_at = now(),
            updated_at = now()
        WHERE id = $1::bigint
        RETURNING id, department, shift_label, note_text, status, patient_id::text AS patient_id,
                  patient_name, created_by_name, created_by_email, acknowledged_by_name,
                  acknowledged_by_email, acknowledged_at, created_at, updated_at
      `,
      id,
      actor.name,
      actor.email
    );

    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ message: 'Handover note not found' });
    await prisma.activity_logs.create({
      data: {
        actor_name: actor.name,
        role: actor.role || 'nurse',
        action: 'Shift Handover Acknowledged',
        target: serializeRow(rows[0])?.department || 'Nursing',
        details: `${serializeRow(rows[0])?.shift_label || 'Active shift'} handover acknowledged`
      }
    }).catch(() => null);
    res.json(serializeRow(rows[0]));
  } catch (error) {
    console.error('Error acknowledging handover note:', error);
    res.status(500).json({ message: 'Unable to acknowledge handover note' });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    const department = normalizeDeptId(req.body?.department);
    const title = String(req.body?.title || '').trim();
    const priorityRaw = String(req.body?.priority || 'routine').trim().toLowerCase();
    const shiftLabel = String(req.body?.shiftLabel || '').trim() || null;
    const dueTime = String(req.body?.dueTime || '').trim() || null;
    const allowedPriority = new Set(['urgent', 'routine', 'handover']);
    const priority = allowedPriority.has(priorityRaw) ? priorityRaw : 'routine';
    if (!department) return res.status(400).json({ message: 'department is required' });
    if (!title) return res.status(400).json({ message: 'title is required' });
    if (title.length < 3) return res.status(400).json({ message: 'title is too short (min 3 characters)' });
    if (title.length > 240) return res.status(400).json({ message: 'title is too long (max 240 characters)' });

    const rows = await prisma.$queryRawUnsafe(
      `
        INSERT INTO public.nurse_tasks
          (department, shift_label, title, priority, due_time, patient_id, patient_name, created_by_name, created_by_email)
        VALUES
          ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9)
        RETURNING id, department, shift_label, title, priority, due_time, patient_id::text AS patient_id,
                  patient_name, status, completed, created_by_name, created_by_email,
                  completed_by_name, completed_by_email, completed_at, created_at, updated_at
      `,
      department,
      shiftLabel,
      title,
      priority,
      dueTime,
      req.body?.patientId || null,
      req.body?.patientName || null,
      actor.name,
      actor.email
    );

    await prisma.activity_logs.create({
      data: {
        actor_name: actor.name,
        role: actor.role || 'nurse',
        action: 'Nurse Task Created',
        target: department,
        details: `${title} (${priority})`
      }
    }).catch(() => null);

    res.status(201).json(serializeRow(Array.isArray(rows) ? rows[0] : null));
  } catch (error) {
    console.error('Error creating nurse task:', error);
    res.status(500).json({ message: 'Unable to create nurse task' });
  }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid task id' });

    const allowedPriority = new Set(['urgent', 'routine', 'handover']);
    const allowedStatus = new Set(['open', 'in_progress', 'completed', 'blocked', 'cancelled']);
    const updates = [];
    const values = [id];
    let index = 2;
    if (req.body?.priority != null) {
      const p = String(req.body.priority || 'routine').trim().toLowerCase();
      if (!allowedPriority.has(p)) return res.status(400).json({ message: `Invalid priority '${p}'. Allowed: urgent, routine, handover.` });
      updates.push(`priority = $${index++}`);
      values.push(p);
    }
    if (req.body?.title != null) {
      const t = String(req.body.title || '').trim();
      if (!t) return res.status(400).json({ message: 'title cannot be empty' });
      if (t.length < 3) return res.status(400).json({ message: 'title is too short (min 3 characters)' });
      if (t.length > 240) return res.status(400).json({ message: 'title is too long (max 240 characters)' });
      updates.push(`title = $${index++}`);
      values.push(t);
    }
    if (req.body?.status != null) {
      const s = String(req.body.status || 'open').trim().toLowerCase();
      if (!allowedStatus.has(s)) return res.status(400).json({ message: `Invalid status '${s}'.` });
      updates.push(`status = $${index++}`);
      values.push(s);
    }
    if (req.body?.completed != null) {
      const completed = Boolean(req.body.completed);
      updates.push(`completed = $${index++}`);
      values.push(completed);
      updates.push(`completed_by_name = $${index++}`);
      values.push(completed ? actor.name : null);
      updates.push(`completed_by_email = $${index++}`);
      values.push(completed ? actor.email : null);
      updates.push(`completed_at = $${index++}`);
      values.push(completed ? new Date() : null);
      if (completed) {
        updates.push(`status = $${index++}`);
        values.push('completed');
      } else if (req.body?.status == null) {
        updates.push(`status = $${index++}`);
        values.push('open');
      }
    }

    if (!updates.length) return res.status(400).json({ message: 'No changes provided' });
    updates.push(`updated_at = now()`);

    const query = `
      UPDATE public.nurse_tasks
      SET ${updates.join(', ')}
      WHERE id = $1::bigint
      RETURNING id, department, shift_label, title, priority, due_time, patient_id::text AS patient_id,
                patient_name, status, completed, created_by_name, created_by_email,
                completed_by_name, completed_by_email, completed_at, created_at, updated_at
    `;
    const rows = await prisma.$queryRawUnsafe(query, ...values);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ message: 'Task not found' });
    await prisma.activity_logs.create({
      data: {
        actor_name: actor.name,
        role: actor.role || 'nurse',
        action: Boolean(req.body?.completed) ? 'Nurse Task Completed' : 'Nurse Task Updated',
        target: serializeRow(rows[0])?.department || 'Nursing',
        details: serializeRow(rows[0])?.title || 'Task updated'
      }
    }).catch(() => null);
    res.json(serializeRow(rows[0]));
  } catch (error) {
    console.error('Error updating nurse task:', error);
    res.status(500).json({ message: 'Unable to update nurse task' });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid task id' });
    const existingRows = await prisma.$queryRawUnsafe(
      `SELECT title, department FROM public.nurse_tasks WHERE id = $1::bigint LIMIT 1`,
      id
    ).catch(() => []);
    await prisma.$executeRawUnsafe(`DELETE FROM public.nurse_tasks WHERE id = $1::bigint`, id);
    const taskRow = Array.isArray(existingRows) ? existingRows[0] : null;
    await prisma.activity_logs.create({
      data: {
        actor_name: actorFromReq(req).name,
        role: actorFromReq(req).role || 'nurse',
        action: 'Nurse Task Deleted',
        target: String(taskRow?.department || 'Nursing'),
        details: String(taskRow?.title || 'Task deleted')
      }
    }).catch(() => null);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting nurse task:', error);
    res.status(500).json({ message: 'Unable to delete nurse task' });
  }
});

router.get('/med-admin', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const department = normalizeDeptId(req.query.department);
    const [pendingMedicationRequests, medAdminLogs] = await Promise.all([
      loadPendingMedicationRequests(department),
      prisma.$queryRawUnsafe(
        `
          SELECT id, department, patient_id::text AS patient_id, patient_name, medication_request_id,
                 medication_name, dosage, quantity, status, note,
                 administered_by_name, administered_by_email, created_at
          FROM public.nurse_med_admin_logs
          WHERE ($1::text = '' OR department = $1)
          ORDER BY created_at DESC
          LIMIT 100
        `,
        department
      )
    ]);
    res.json({
      pendingMedicationRequests,
      medAdminLogs: Array.isArray(medAdminLogs) ? medAdminLogs.map(serializeRow) : []
    });
  } catch (error) {
    console.error('Error loading medication administration data:', error);
    res.status(500).json({ message: 'Unable to load medication administration data' });
  }
});

router.post('/med-admin', async (req, res) => {
  try {
    await ensureWorkflowTables();
    const actor = actorFromReq(req);
    const department = normalizeDeptId(req.body?.department);
    const medicationName = String(req.body?.medicationName || '').trim();
    const statusRaw = String(req.body?.status || '').trim().toLowerCase();
    const patientName = String(req.body?.patientName || '').trim();
    const noteRaw = String(req.body?.note || '').trim();
    const quantityRaw = req.body?.quantity;
    const allowedStatus = new Set(['administered', 'held', 'missed']);
    const status = allowedStatus.has(statusRaw) ? statusRaw : null;
    if (!department) return res.status(400).json({ message: 'department is required' });
    if (!medicationName) return res.status(400).json({ message: 'medicationName is required' });
    if (medicationName.length > 200) return res.status(400).json({ message: 'medicationName is too long (max 200 characters)' });
    if (!status) return res.status(400).json({ message: `Invalid status '${statusRaw}'. Allowed: administered, held, missed.` });
    if ((status === 'held' || status === 'missed') && noteRaw.length < 3) {
      return res.status(400).json({ message: `A reason of at least 3 characters is required when medication is ${status}.` });
    }
    let quantity = 1;
    if (quantityRaw !== undefined && quantityRaw !== null && String(quantityRaw).trim() !== '') {
      const n = Number(quantityRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 999) {
        return res.status(400).json({ message: 'quantity must be a whole number from 1 to 999' });
      }
      quantity = n;
    }
    const dosage = req.body?.dosage != null ? String(req.body.dosage).slice(0, 200) : null;
    const note = noteRaw ? noteRaw.slice(0, 1000) : null;
    const requestIdRaw = req.body?.requestId;
    let requestId = null;
    if (requestIdRaw !== undefined && requestIdRaw !== null && String(requestIdRaw).trim() !== '') {
      const s = String(requestIdRaw).trim();
      if (!/^\d+$/.test(s)) return res.status(400).json({ message: 'Invalid requestId.' });
      requestId = s;
    }
    const patientId = req.body?.patientId || null;
    if (!requestId) return res.status(400).json({ message: 'requestId is required' });
    if (!patientId && !patientName) return res.status(400).json({ message: 'patient information is required' });

    const result = await prisma.$transaction(async (tx) => {
      const duplicateRows = await tx.$queryRawUnsafe(
        `
          SELECT id
          FROM public.nurse_med_admin_logs
          WHERE medication_request_id = $1::bigint
            AND status = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        requestId,
        status
      );
      if (Array.isArray(duplicateRows) && duplicateRows.length) {
        const duplicateError = new Error(`This medication request is already marked as ${status}.`);
        duplicateError.code = 'DUPLICATE_MED_ADMIN';
        throw duplicateError;
      }
      const rows = await tx.$queryRawUnsafe(
        `
          INSERT INTO public.nurse_med_admin_logs
            (department, patient_id, patient_name, medication_request_id, medication_name, dosage, quantity, status, note, administered_by_name, administered_by_email)
          VALUES
            ($1, $2::uuid, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, department, patient_id::text AS patient_id, patient_name, medication_request_id,
                    medication_name, dosage, quantity, status, note,
                    administered_by_name, administered_by_email, created_at
        `,
        department,
        patientId,
        patientName || null,
        requestId,
        medicationName,
        dosage,
        quantity,
        status,
        note,
        actor.name,
        actor.email
      );

      if (requestId && status === 'administered') {
        await tx.requests.update({
          where: { id: BigInt(String(requestId)) },
          data: { status: 'Completed' }
        }).catch(() => {});
      }

      return Array.isArray(rows) ? rows[0] : null;
    });

    await prisma.activity_logs.create({
      data: {
        actor_name: actor.name,
        role: actor.role || 'nurse',
        action: 'Medication Round Recorded',
        target: patientName || department,
        details: `${medicationName} marked as ${status}`
      }
    }).catch(() => null);

    res.status(201).json(serializeRow(result));
  } catch (error) {
    console.error('Error recording medication administration:', error);
    if (error?.code === 'DUPLICATE_MED_ADMIN') {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: 'Unable to record medication administration' });
  }
});

module.exports = router;

