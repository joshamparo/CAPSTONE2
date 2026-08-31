const express = require('express');
const cors = require('cors');
const path = require('path');
const prisma = require('./utils/prisma');
const { isMaintenanceModeEnabled } = require('./utils/systemSettingsStore');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

function describeDbHost(dbUrl) {
  const raw = String(dbUrl || '').trim();
  if (!raw) return '(missing)';
  try {
    return new URL(raw).host || '(missing)';
  } catch (_) {
    return '(invalid DATABASE_URL)';
  }
}

function extractSupabaseProjectRefFromUrl(url) {
  const raw = String(url || '').trim();
  const m = raw.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  return m ? m[1] : null;
}

function extractSupabaseProjectRefFromDbUrl(dbUrl) {
  const raw = String(dbUrl || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = String(u.hostname || '');
    const m = host.match(/^postgres\.([a-z0-9-]+)\b/i);
    return m ? m[1] : null;
  } catch (_) {
    const m = raw.match(/postgres\.([a-z0-9-]+)\b/i);
    return m ? m[1] : null;
  }
}

const supabaseUrlRef = extractSupabaseProjectRefFromUrl(process.env.SUPABASE_URL);
const databaseUrlRef = extractSupabaseProjectRefFromDbUrl(process.env.DATABASE_URL);
if (supabaseUrlRef || databaseUrlRef) {
  console.log('Supabase refs:', JSON.stringify({ supabaseUrlRef, databaseUrlRef }));
}
if (!process.env.SUPABASE_URL) {
  console.warn('SUPABASE_URL is missing in backend .env');
}
console.log('Database host:', describeDbHost(process.env.DATABASE_URL));

let dbConnected = false;
let dbError = null;

const initDbConnection = async () => {
  try {
    await prisma.$connect();
    dbConnected = true;
    dbError = null;
    console.log('Supabase PostgreSQL Connected via Prisma');
  } catch (err) {
    dbConnected = false;
    dbError = String(err?.message || err || 'Database connection failed');
    console.error('Database connection failed:', dbError);
    if (/Authentication failed/i.test(dbError)) {
      console.error('Database credentials were rejected. Update DATABASE_URL and DIRECT_URL in backend/.env.');
    }
    setTimeout(initDbConnection, 5000);
  }
};

initDbConnection().catch((e) => {
  dbConnected = false;
  dbError = String(e?.message || 'Unable to initialize Prisma');
  console.error('Prisma initialization failed:', dbError);
});

function normalizeOriginValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (_) {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

const defaultAllowedOrigins = [
  'https://pascualinga.com',
  'https://www.pascualinga.com',
  'http://localhost:5173',
  'http://localhost:3000'
];

const allowedSuffixes = [
  '.vercel.app'
];

// Middleware
const allowedOrigins = new Set(
  [...defaultAllowedOrigins, ...String(process.env.CORS_ORIGINS || '').split(',')]
    .map(normalizeOriginValue)
    .filter(Boolean)
);

function isOriginAllowed(origin) {
  const normalized = normalizeOriginValue(origin);
  if (!normalized) return true;
  if (allowedOrigins.has(normalized)) return true;
  try {
    const parsed = new URL(normalized);
    return allowedSuffixes.some((suf) => parsed.host.toLowerCase().endsWith(suf));
  } catch (_) {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Content-Length', 'Content-Type']
};

app.use(cors(corsOptions));
// Robust preflight handler: echo requested headers to avoid "header not allowed" failures.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method !== 'OPTIONS') return next();

  const requestedHeaders = String(req.headers['access-control-request-headers'] || '').trim();
  if (requestedHeaders) {
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(','));
  return res.sendStatus(204);
});

// Ensure CORS headers are present even when upstream middleware throws.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (!res.headersSent) {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    const requestedHeaders = String(req.headers['access-control-request-headers'] || '').trim();
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(','));
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders || 'Content-Type, Authorization');
  }
  // Preflight requests should not hard-fail due to CORS origin mismatches.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return res.status(403).json({ message: String(err?.message || 'CORS error') });
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const normalizeRoleHeader = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'administrator' || raw === 'administrator_account') return 'admin';
  if (raw.includes('doctor') && raw.includes('secretary')) return 'doctor_secretary';
  if (raw.includes('office') && raw.includes('staff')) return 'staff';
  if (raw.includes('clinical') && raw.includes('staff')) return 'staff';
  if (raw.includes('physical') && raw.includes('therap')) return 'physical_therapist';
  if (raw.includes('radiograph') || raw.includes('x-ray') || raw.includes('xray')) return 'radiographer';
  if (raw.includes('medtech')) return 'medtech';
  if (raw.includes('ecg')) return 'ecg_operator';
  if (raw.includes('cashier')) return 'cashier';
  if (raw.includes('pharmacist')) return 'pharmacist';
  if (raw.includes('nurse')) return 'nurse';
  if (raw.includes('pediatric') || raw.includes('pedia')) return 'doctor';
  if (raw.includes('doctor')) return 'doctor';
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('patient')) return 'patient';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
};

const maintenanceAllowList = new Set([
  '/api/health',
  '/api/assistant/chat'
]);

const MAINTENANCE_CACHE_MS = Math.max(1000, Math.min(60000, Number(process.env.MAINTENANCE_CACHE_MS || 10000) || 10000));
const MAINTENANCE_CHECK_TIMEOUT_MS = Math.max(250, Math.min(10000, Number(process.env.MAINTENANCE_CHECK_TIMEOUT_MS || 1500) || 1500));
let maintenanceCache = { checkedAt: 0, value: false, promise: null };

const withTimeout = (promise, ms, fallbackValue) => {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms))
  ]);
};

const getMaintenanceModeFast = async () => {
  const now = Date.now();
  if (maintenanceCache.promise) return maintenanceCache.promise;
  if (maintenanceCache.checkedAt && now - maintenanceCache.checkedAt < MAINTENANCE_CACHE_MS) return maintenanceCache.value;

  maintenanceCache.promise = (async () => {
    const value = await withTimeout(isMaintenanceModeEnabled(), MAINTENANCE_CHECK_TIMEOUT_MS, false).catch(() => false);
    maintenanceCache.checkedAt = Date.now();
    maintenanceCache.value = Boolean(value);
    return maintenanceCache.value;
  })().finally(() => {
    maintenanceCache.promise = null;
  });

  return maintenanceCache.promise;
};

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (String(req.path || '').startsWith('/uploads')) return next();
  if (maintenanceAllowList.has(String(req.path || ''))) return next();

  try {
    const maintenanceMode = await getMaintenanceModeFast();
    if (!maintenanceMode) return next();
    const role = normalizeRoleHeader(req.headers['x-user-role']);
    if (role === 'admin') return next();
    return res.status(503).json({ message: 'System is currently under maintenance. Please try again later.' });
  } catch (_) {
    return next();
  }
});

// Routes
const staffRoutes = require('./routes/staff');
const activityLogRoutes = require('./routes/activityLogs');
const adminLogRoutes = require('./routes/adminLog');
const patientRoutes = require('./routes/patients');
const statsRoutes = require('./routes/stats');
const requestRoutes = require('./routes/requests');
const announcementRoutes = require('./routes/announcements');
const appointmentRoutes = require('./routes/appointments');
const wardRoutes = require('./routes/wards');
const doctorNoteRoutes = require('./routes/doctorNotes');
const inventoryRoutes = require('./routes/inventory');
const suppliesRoutes = require('./routes/supplies');
const prescriptionRoutes = require('./routes/prescriptions');
const incidentRoutes = require('./routes/incidents');
const labResultsRoutes = require('./routes/labResults');
const medicalCertificatesRoutes = require('./routes/medicalCertificates');
const restockRequestsRoutes = require('./routes/restockRequests');
const approvalRequestsRoutes = require('./routes/approvalRequests');
const salesRoutes = require('./routes/sales');
const clinicalOrdersRoutes = require('./routes/clinicalOrders');
const clinicalScheduleRoutes = require('./routes/clinicalSchedule');
const billingRoutes = require('./routes/billing');
const productCategoriesRoutes = require('./routes/productCategories');
const pharmacyPosRoutes = require('./routes/pharmacyPos');
const stockMovementsRoutes = require('./routes/stockMovements');
const doctorPatientsRoutes = require('./routes/doctorPatients');
const doctorRoutes = require('./routes/doctor');
const doctorAvailabilityRoutes = require('./routes/doctorAvailability');
const videoConsultRoutes = require('./routes/videoConsults');
const assistantRoutes = require('./routes/assistant');
const nurseWorkflowRoutes = require('./routes/nurseWorkflow');
const systemSettingsRoutes = require('./routes/systemSettings');
const doctorChatRoutes = require('./routes/doctorChat');

app.use('/api/staff', staffRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/admin-log', adminLogRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/wards', wardRoutes);
app.use('/api/doctor-notes', doctorNoteRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/supplies', suppliesRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/lab-results', labResultsRoutes);
app.use('/api/medical-certificates', medicalCertificatesRoutes);
app.use('/api/restock-requests', restockRequestsRoutes);
app.use('/api/approval-requests', approvalRequestsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/clinical-orders', clinicalOrdersRoutes);
app.use('/api/clinical-schedule', clinicalScheduleRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/product-categories', productCategoriesRoutes);
app.use('/api/pharmacy', pharmacyPosRoutes);
app.use('/api/stock-movements', stockMovementsRoutes);
app.use('/api/doctor/patients', doctorPatientsRoutes);
app.use('/api/doctor', doctorRoutes);
// This router already defines `/doctors/:doctorId/availability/...` paths.
app.use('/api', doctorAvailabilityRoutes);
app.use('/api/video-consults', videoConsultRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/nurse-workflow', nurseWorkflowRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/doctor-chat', doctorChatRoutes);

app.get('/api/health', (_req, res) => {
  const dbConfigured = Boolean(String(process.env.DATABASE_URL || '').trim());
  const directConfigured = Boolean(String(process.env.DIRECT_URL || '').trim());
  const supabaseConfigured = Boolean(String(process.env.SUPABASE_URL || '').trim()) && Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
  res.json({
    ok: true,
    dbConfigured,
    directConfigured,
    dbConnected,
    dbError: dbError ? String(dbError).slice(0, 220) : null,
    supabaseConfigured,
    supabaseUrlRef: supabaseUrlRef || null,
    databaseUrlRef: databaseUrlRef || null
  });
});

// --- EmailJS Backend Routes ---

app.post('/api/email/send-recovery', async (req, res) => {
  const { email, resetLink } = req.body;
  let resetToken = '';
  try {
    resetToken = new URL(String(resetLink || '')).searchParams.get('token') || '';
  } catch (_) {}

  const SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_ur884qv";
  const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
  const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
  const TEMPLATE_ID = process.env.EMAILJS_RECOVERY_TEMPLATE_ID || "template_xyatwcf";

  if (!SERVICE_ID || !PUBLIC_KEY || !PRIVATE_KEY) {
    console.error('[Backend Recovery] Missing credentials. Private Key present:', !!PRIVATE_KEY);
    return res.status(500).json({ 
      success: false, 
      message: 'EmailJS credentials missing from backend environment.' 
    });
  }

  try {
    console.log(`[Backend Recovery] Sending reset link to ${email}...`);
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: TEMPLATE_ID,
        user_id: PUBLIC_KEY,
        accessToken: PRIVATE_KEY,
        template_params: {
          to_email: email,
          reset_link: resetLink,
          resetLink,
          recovery_link: resetLink,
          link: resetLink,
          token: resetToken,
          email,
          subject: "Password Recovery - Pascualinga"
        }
      })
    });

    if (response.ok) {
      console.log('[Backend Recovery] Success!');
      return res.status(200).json({ success: true, message: 'Recovery email sent' });
    }

    const errorText = await response.text();
    console.error('[Backend Recovery] EmailJS REST API failed:', errorText);
    return res.status(500).json({ success: false, message: 'EmailJS failed to send recovery email.', details: errorText });
  } catch (error) {
    console.error('[Backend Recovery] Server error:', error);
    return res.status(500).json({ success: false, message: 'Server error while attempting to send email.' });
  }
});

app.post('/api/email/send-otp', async (req, res) => {
  const { email, otp } = req.body;

  const SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_ur884qv";
  const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
  const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
  const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_x8k19wl";

  if (!PRIVATE_KEY) {
    console.error(
      '[Backend Email] EMAILJS_PRIVATE_KEY is missing from environment variables.\n' +
      '  → Local Dev: Add it to capstone-backend/.env\n' +
      '  → Production: Set it in your Railway/Railway Variables.'
    );
    return res.status(500).json({
      success: false,
      message: 'OTP email not sent. EMAILJS_PRIVATE_KEY environment variable is missing in the backend.',
      hint: 'Set EMAILJS_PRIVATE_KEY in your backend .env (local) or hosting platform (Railway).'
    });
  }

  if (!SERVICE_ID || !PUBLIC_KEY) {
    console.error('[Backend Email] Missing EmailJS SERVICE_ID or PUBLIC_KEY.');
    return res.status(500).json({
      success: false,
      message: 'EmailJS configuration incomplete (SERVICE_ID or PUBLIC_KEY missing).'
    });
  }

  const expirationTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  try {
    console.log(`[Backend Email] Sending OTP to ${email} via EmailJS REST API... (Template: ${TEMPLATE_ID})`);
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: TEMPLATE_ID,
        user_id: PUBLIC_KEY,
        accessToken: PRIVATE_KEY,
        template_params: {
          to_email: email,
          otp_code: otp,
          otp: otp,
          code: otp,
          passcode: otp,
          time: expirationTime,
          expiration_time: expirationTime,
          from_name: "Pascualinga Hospital"
        }
      })
    });

    if (response.ok) {
      console.log('[Backend Email] OTP email sent successfully to', email);
      return res.status(200).json({ success: true, message: 'OTP email sent' });
    }

    const errorText = await response.text();
    console.error('[Backend Email] EmailJS REST API failed:', `HTTP ${response.status}`, errorText || '(no response body)');
    return res.status(500).json({
      success: false,
      message: `EmailJS rejected the request (HTTP ${response.status}).`,
      details: errorText || 'Check your EmailJS account for rate limits, template IDs, or domain whitelisting.'
    });
  } catch (error) {
    console.error('[Backend Email] Server error while sending OTP:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Backend network error while attempting to send OTP email.',
      details: error?.message || String(error)
    });
  }
});

app.get('/', (req, res) => {
    res.send('API is running...');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
