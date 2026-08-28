const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { normalizeEmail, normalizeRole } = require('../utils/normalize');

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

let supabaseAdmin = null;
let storageReady = false;

function getSupabaseAdmin() {
    if (supabaseAdmin) return supabaseAdmin;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
    return supabaseAdmin;
}

async function ensurePresenceSchema() {
    const tables = ['staff', 'nurses', 'doctors', 'accounts'];
    for (const t of tables) {
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS status text;`);
        } catch (_) {}
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS last_active timestamptz;`);
        } catch (_) {}
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS avatar_url text;`);
        } catch (_) {}
        // Some environments don't have these timestamps; keep it backward compatible.
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`);
        } catch (_) {}
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`);
        } catch (_) {}
        try {
            await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ${t}_presence_idx ON ${t}(status, last_active);`);
        } catch (_) {}
        if (String(process.env.ENABLE_REALTIME_PUBLICATION || '').trim().toLowerCase() === 'true') {
            try {
                await prisma.$executeRawUnsafe(`ALTER PUBLICATION supabase_realtime ADD TABLE ${t};`);
            } catch (_) {}
        }
    }
}

let inventoryTimestampSchemaPromise = null;
function ensureInventoryTimestampSchemaOnce() {
    if (!inventoryTimestampSchemaPromise) {
        inventoryTimestampSchemaPromise = (async () => {
            await prisma.$executeRawUnsafe(`ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.supplies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`).catch(() => {});
            await prisma.$executeRawUnsafe(`ALTER TABLE public.supplies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`).catch(() => {});
        })().catch((err) => {
            inventoryTimestampSchemaPromise = null;
            throw err;
        });
    }
    return inventoryTimestampSchemaPromise;
}

let presenceSchemaPromise = null;
function ensurePresenceSchemaOnce() {
    if (!presenceSchemaPromise) presenceSchemaPromise = ensurePresenceSchema();
    return presenceSchemaPromise;
}

ensurePresenceSchemaOnce().catch(() => {});

async function ensureAccountsDoctorLinkSchema() {
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS linked_doctor_id uuid;`);
    } catch (_) {}
    try {
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS accounts_linked_doctor_idx ON accounts(linked_doctor_id);`);
    } catch (_) {}
}

ensureAccountsDoctorLinkSchema().catch(() => {});

async function ensureUserSettingsSchema() {
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS user_settings (
                id BIGSERIAL PRIMARY KEY,
                user_email TEXT NOT NULL,
                user_role TEXT NOT NULL,
                prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (user_email, user_role)
            );
        `);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS user_settings_user_idx ON user_settings(user_email, user_role);`);
    } catch (_) {}
}

ensureUserSettingsSchema().catch(() => {});

async function ensureStorage() {
    if (storageReady) return;
    const sb = getSupabaseAdmin();
    if (!sb) return;

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'avatars';
    const existing = await sb.storage.listBuckets().catch(() => null);
    const hasBucket = Array.isArray(existing?.data) && existing.data.some((b) => b.name === bucket);
    if (!hasBucket) {
        await sb.storage.createBucket(bucket, { public: true }).catch(() => {});
    }
    storageReady = true;
}

ensureStorage().catch(() => {});

const STAFF_ACCOUNT_TYPES = [
    'admin',
    'staff',
    'patient',
    'nurse',
    'doctor',
    'pharmacist',
    'cashier',
    'doctor_secretary',
    'medtech',
    'radiographer',
    'ecg_operator',
    'physical_therapist'
];

let staffAccountTypeConstraintEnsured = false;
let staffAccountTypeConstraintPromise = null;

async function ensureStaffAccountTypeConstraint() {
    if (staffAccountTypeConstraintEnsured) return;
    if (staffAccountTypeConstraintPromise) return staffAccountTypeConstraintPromise;

    staffAccountTypeConstraintPromise = (async () => {
        try {
            const allowed = STAFF_ACCOUNT_TYPES.map((v) => `'${v}'`).join(', ');
            await prisma.$executeRawUnsafe(`ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_account_type_check;`);
            await prisma.$executeRawUnsafe(`ALTER TABLE public.staff ADD CONSTRAINT staff_account_type_check CHECK (account_type IS NULL OR account_type IN (${allowed}));`);
        } catch (_) {
        } finally {
            staffAccountTypeConstraintEnsured = true;
        }
    })();

    return staffAccountTypeConstraintPromise;
}

async function setPresenceOnline(modelType, id) {
    const t = modelType === 'nurses' ? 'nurses' : modelType === 'doctors' ? 'doctors' : modelType === 'accounts' ? 'accounts' : 'staff';
    try {
        if (t === 'accounts') {
            await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Online', last_active = now() WHERE id = $1`, Number(id));
        } else {
            await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Online', last_active = now() WHERE id = $1::uuid`, id);
        }
    } catch (_) {
        // Backward compatibility: some tables may not have last_active yet.
        if (t === 'accounts') {
            await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Online' WHERE id = $1`, Number(id)).catch(() => {});
        } else {
            await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Online' WHERE id = $1::uuid`, id).catch(() => {});
        }
    }
}

async function setPresenceOffline(modelType, id) {
    const t = modelType === 'nurses' ? 'nurses' : modelType === 'doctors' ? 'doctors' : modelType === 'accounts' ? 'accounts' : 'staff';
    if (t === 'accounts') {
        await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Offline' WHERE id = $1`, Number(id)).catch(() => {});
    } else {
        await prisma.$executeRawUnsafe(`UPDATE ${t} SET status = 'Offline' WHERE id = $1::uuid`, id).catch(() => {});
    }
}

async function getAvatarUrl(modelType, id) {
    const t = modelType === 'nurses' ? 'nurses' : modelType === 'doctors' ? 'doctors' : modelType === 'accounts' ? 'accounts' : 'staff';
    let rows;
    if (t === 'accounts') {
        rows = await prisma.$queryRawUnsafe(`SELECT avatar_url FROM ${t} WHERE id = $1 LIMIT 1`, Number(id)).catch(() => null);
    } else {
        rows = await prisma.$queryRawUnsafe(`SELECT avatar_url FROM ${t} WHERE id = $1::uuid LIMIT 1`, id).catch(() => null);
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.avatar_url || null;
}

// Helper to find document across collections
async function findUserById(id) {
    try {
        let user = await prisma.staff.findUnique({ where: { id } }).catch(() => null);
        if (user) return { user, model: 'staff' };
        
        user = await prisma.nurses.findUnique({ where: { id } }).catch(() => null);
        if (user) return { user, model: 'nurses' };
        
        user = await prisma.doctors.findUnique({ where: { id } }).catch(() => null);
        if (user) return { user, model: 'doctors' };
        
        if (!isNaN(Number(id))) {
            user = await prisma.accounts.findUnique({ where: { id: Number(id) } }).catch(() => null);
            if (user) return { user, model: 'accounts' };
        }
        
        return null;
    } catch (e) {
        return null;
    }
}

async function findUserByEmail(email) {
    if (!email) return null;
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    let user = await prisma.staff.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } }).catch(() => null);
    if (user) return { user, model: 'staff' };

    user = await prisma.nurses.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } }).catch(() => null);
    if (user) return { user, model: 'nurses' };

    user = await prisma.doctors.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } }).catch(() => null);
    if (user) return { user, model: 'doctors' };

    user = await prisma.accounts.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } }).catch(() => null);
    if (user) return { user, model: 'accounts' };

    return null;
}

function inferRequester(req) {
    const role = normalizeRole(req.headers['x-user-role'] || '');
    const email = normalizeEmail(req.headers['x-user-email'] || '');
    const explicitName = String(req.headers['x-user-name'] || '').trim();
    const patientId = String(req.headers['x-patient-id'] || '').trim();
    return { role, email, explicitName, patientId };
}

function inferDisplayNameFromUser(found, emailFallback) {
    const u = found?.user || {};
    const model = found?.model || '';

    if (model === 'accounts') {
        const n = String(u.name || '').trim();
        if (n) return n;
    }

    const first = String(u.first_name || u.firstName || '').trim();
    const last = String(u.last_name || u.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    if (full) return full;

    const email = String(u.email || emailFallback || '').trim();
    if (email) return email.split('@')[0];
    return 'User';
}

// LOGIN Route
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        
        // Trim inputs
        if (email) email = normalizeEmail(email);
        if (password) password = password.trim();

        // Note: Supabase handles auth natively. If you use Supabase Auth, you don't need this.
        // But assuming we stick to the custom implementation for now using the new tables.
        
        // Find user in any collection sequentially
        let user = await prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        let modelType = 'staff';
        
        if (!user) {
            user = await prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'nurses';
        }
        if (!user) {
            user = await prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'doctors';
        }
        if (!user) {
            user = await prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'accounts';
        }
        
        if (!user) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        let isMatch = false;
        const storedPassword = user.password;
        const looksBcrypt = typeof storedPassword === 'string' && storedPassword.startsWith('$2');

        if (modelType === 'accounts') {
            if (looksBcrypt) {
                isMatch = await bcrypt.compare(password, storedPassword);
            } else {
                isMatch = password === storedPassword;
                if (isMatch) {
                    const salt = await bcrypt.genSalt(10);
                    const hashedPassword = await bcrypt.hash(password, salt);
                    prisma.accounts.update({
                        where: { id: user.id },
                        data: { password: hashedPassword }
                    }).catch(() => {});
                }
            }
        } else {
            isMatch = await bcrypt.compare(password, storedPassword);
        }

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }
        
        // Update status to Online
        if (modelType && modelType !== 'accounts') {
            try {
                await setPresenceOnline(modelType, user.id);
            } catch (err) {
                console.warn("Skipping status update, field might not exist yet:", err.message);
            }
        }

        // Log Activity
        try {
            await prisma.activity_logs.create({
                data: {
                    actor_name: user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : (user.name || String(email || '').split('@')[0]),
                    role: (user.account_type || user.roles) ? String(user.account_type || user.roles).charAt(0).toUpperCase() + String(user.account_type || user.roles).slice(1) : 'Unknown',
                    action: 'Login',
                    details: 'User logged in',
                    target: 'System',
                }
            });
        } catch (logErr) {
            console.error("Login logging failed:", logErr);
        }
        
        // Return user info, excluding password
        const { password: _, ...userData } = user;
        const avatarUrl = await getAvatarUrl(modelType, user.id).catch(() => null);
        
        if (modelType === 'accounts') {
            const firstName = user.name || '';
            const linkRows = await prisma.$queryRawUnsafe(
                `SELECT linked_doctor_id FROM accounts WHERE id = $1 LIMIT 1`,
                user.id
            ).catch(() => null);
            const linkRow = Array.isArray(linkRows) ? linkRows[0] : null;
            const linkedDoctorId = linkRow?.linked_doctor_id ? String(linkRow.linked_doctor_id) : null;
            res.json({
                id: user.id ? user.id.toString() : undefined,
                email: user.email,
                name: user.name,
                firstName,
                first_name: firstName,
                last_name: '',
                roles: user.roles,
                account_type: user.roles || 'staff',
                linkedDoctorId,
                linked_doctor_id: linkedDoctorId,
                avatarUrl
            });
        } else {
            res.json({ ...userData, avatarUrl });
        }
        
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

// LOGOUT Route
router.post('/logout', requireRole(STAFF_ACCOUNT_TYPES), async (req, res) => {
    try {
        const { id, accountType } = req.body;
        
        let modelType;
        const normalized = String(accountType).toLowerCase();
        if (normalized === 'nurse') modelType = 'nurses';
        else if (normalized === 'doctor') modelType = 'doctors';
        else if (normalized === 'admin' || normalized === 'cashier' || normalized === 'doctor_secretary') modelType = 'accounts';
        else modelType = 'staff';

        let user;
        if (modelType === 'accounts') {
            user = await prisma.accounts.findUnique({ where: { id: Number(id) } });
            await prisma.accounts.update({
                where: { id: Number(id) },
                data: {} // status is updated below in raw sql
            }).catch(() => {});
        } else {
            user = await prisma[modelType].update({
                where: { id },
                data: { status: 'Offline' }
            }).catch(() => {});
        }
        try {
            await setPresenceOffline(modelType, id);
        } catch (_) {}

        if (user) {
            // Log Activity
            try {
                const actorName = modelType === 'accounts' ? user.name : `${user.first_name || ''} ${user.last_name || ''}`.trim();
                const userRole = modelType === 'accounts' ? user.roles : user.account_type;
                await prisma.activity_logs.create({
                    data: {
                        actor_name: actorName || 'Unknown',
                        role: userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : 'Unknown',
                        action: 'Logout',
                        details: 'User logged out',
                        target: 'System',
                    }
                });
            } catch (logErr) {
                console.error("Logout logging failed:", logErr);
            }
        }
        
        res.json({ message: "Logged out successfully" });
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

// HEARTBEAT Route
router.post('/heartbeat', requireRole(STAFF_ACCOUNT_TYPES), async (req, res) => {
    try {
        const { id, email, accountType } = req.body;
        if (!id && !email) return res.status(400).json({ message: "Missing parameters" });

        let modelType = null;
        const normalized = String(accountType || '').toLowerCase();
        if (normalized === 'nurse') modelType = 'nurses';
        else if (normalized === 'doctor') modelType = 'doctors';
        else if (normalized === 'admin') modelType = 'accounts';
        else if (normalized) modelType = 'staff';

        let targetId = id;
        if (!targetId && email) {
            const e = normalizeEmail(email);
            let found = null;
            if (modelType === 'accounts') {
                const u = await prisma.accounts.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }).catch(() => null);
                if (u) found = { user: u, model: 'accounts' };
            } else if (modelType) {
                const u = await prisma[modelType].findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }).catch(() => null);
                if (u) found = { user: u, model: modelType };
            }
            if (!found) found = await findUserByEmail(e);
            if (found?.user?.id) {
                targetId = found.user.id;
                modelType = found.model;
            }
        }

        if (targetId && !modelType) {
            const found = await findUserById(targetId);
            if (found?.user?.id) {
                targetId = found.user.id;
                modelType = found.model;
            }
        }
        if (!targetId || !modelType) return res.status(404).json({ message: "User not found" });

        await setPresenceOnline(modelType, targetId);
        res.json({ message: "Heartbeat received" });
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message });
    }
});

router.get('/by-email', requireRole(STAFF_ACCOUNT_TYPES), async (req, res) => {
    try {
        const email = normalizeEmail(req.query.email || '');
        if (!email) return res.status(400).json({ message: 'email is required' });

        let user = await prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        let modelType = 'staff';
        if (!user) {
            user = await prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'nurses';
        }
        if (!user) {
            user = await prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'doctors';
        }
        if (!user) {
            user = await prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'accounts';
        }
        if (!user) return res.status(404).json({ message: 'User not found' });

        const { password: _, ...userData } = user;
        const avatarUrl = await getAvatarUrl(modelType, user.id).catch(() => null);
        res.json({ ...userData, id: user.id ? user.id.toString() : undefined, avatarUrl, account_type: user.account_type || user.roles || modelType });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

router.post('/avatar', requireRole(STAFF_ACCOUNT_TYPES), upload.single('avatar'), async (req, res) => {
    try {
        const file = req.file;
        const id = String(req.body.id || '').trim();
        const email = normalizeEmail(req.body.email || '');
        const role = normalizeRole(req.body.accountType || req.body.role || '');

        if (!file) return res.status(400).json({ message: 'avatar file is required' });
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return res.status(400).json({ message: 'avatar must be an image' });
        }

        await ensurePresenceSchema().catch(() => {});
        await ensureStorage().catch(() => {});

        const sb = getSupabaseAdmin();
        if (!sb) {
            return res.status(500).json({ message: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend .env' });
        }

        let target = null;
        let modelType = null;

        if (id) {
            const found = await findUserById(id);
            if (found) {
                target = found.user;
                modelType = found.model;
            }
        }

        if (!target && email) {
            const hinted = role === 'doctor' ? 'doctors' : role === 'nurse' ? 'nurses' : role ? 'staff' : null;
            if (hinted) {
                target = await prisma[hinted].findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }).catch(() => null);
                if (target) modelType = hinted;
            }
            if (!target) {
                target = await prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
                modelType = target ? 'staff' : modelType;
            }
            if (!target) {
                target = await prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
                modelType = target ? 'nurses' : modelType;
            }
            if (!target) {
                target = await prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
                modelType = target ? 'doctors' : modelType;
            }
            if (!target) {
                target = await prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
                modelType = target ? 'accounts' : modelType;
            }
        }

        if (!target || !modelType) return res.status(404).json({ message: 'User not found' });

        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'avatars';
        const mime = String(file.mimetype || '').toLowerCase();
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        const path = `${modelType}/${target.id}.${ext}`;

        const uploadRes = await sb.storage.from(bucket).upload(path, file.buffer, {
            contentType: file.mimetype,
            upsert: true,
            cacheControl: '3600'
        });

        if (uploadRes?.error) {
            return res.status(500).json({ message: uploadRes.error.message || 'Upload failed' });
        }

        const publicUrl = sb.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || null;
        if (!publicUrl) return res.status(500).json({ message: 'Unable to generate avatar URL' });

        const updateWhere = modelType === 'accounts' ? { id: Number(target.id) } : { id: String(target.id) };
        await prisma[modelType].update({
            where: updateWhere,
            data: { avatar_url: publicUrl }
        });

        res.json({ avatarUrl: publicUrl });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

// CREATE Staff/Nurse/Doctor
router.post('/', requireRole(['admin']), async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            middleName,
            dateOfBirth,
            gender,
            civilStatus,
            nationality,
            employeeId,
            medicalLicenseNumber,
            specialization,
            department,
            dateHired,
            email,
            phone,
            streetAddress,
            city,
            province,
            postalCode,
            country,
            accountType,
            password,
            linkedDoctorId
        } = req.body;

        const normalizedAccountType = String(accountType || 'staff').trim().toLowerCase();

        // ---- Backend required + format validations (belt-and-suspenders against direct API calls) ----
        const errors = [];
        const cleanStr = (v) => String(v || "").trim();
        const isValidPHPhone = (v) => /^(\+?63\s?|0)9\d{9}$/.test(String(cleanStr(v)).replace(/[\s\-()]/g, ''));
        const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanStr(v));
        const isValidName = (v) => { const s = cleanStr(v); return !!s && /^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(s); };

        const firstNameClean = cleanStr(firstName);
        const lastNameClean = cleanStr(lastName);
        const middleNameClean = cleanStr(middleName);
        const emailClean = email ? normalizeEmail(email) : '';
        const phoneClean = cleanStr(phone);
        const roleClean = normalizedAccountType;

        if (!firstNameClean || firstNameClean.length < 2) errors.push("First Name is required (at least 2 characters).");
        else if (!isValidName(firstNameClean)) errors.push("First Name contains invalid characters.");
        if (!lastNameClean || lastNameClean.length < 2) errors.push("Last Name is required (at least 2 characters).");
        else if (!isValidName(lastNameClean)) errors.push("Last Name contains invalid characters.");
        if (middleNameClean && !isValidName(middleNameClean)) errors.push("Middle Name contains invalid characters.");
        if (!roleClean) errors.push("Role / accountType is required.");

        const rawPassword = String(password || "").trim();
        if (!rawPassword) errors.push("Password is required.");
        else {
            const pwErrors = [];
            if (rawPassword.length < 11) pwErrors.push("11 characters");
            if (!/[^A-Za-z0-9]/.test(rawPassword)) pwErrors.push("special character");
            if (!/[0-9]/.test(rawPassword)) pwErrors.push("number");
            if (pwErrors.length > 0) errors.push(`Password must contain at least: ${pwErrors.join(", ")}.`);
        }
        if (!emailClean) {
            errors.push("Email is required.");
        } else if (!isValidEmail(emailClean)) {
            errors.push("Invalid email address format.");
        }
        if (!phoneClean) {
            errors.push("Phone number is required.");
        } else if (!isValidPHPhone(phoneClean)) {
            errors.push("Invalid PH phone number. Use format: 09XX XXX XXXX or +63 9XX XXX XXXX.");
        }
        if (cleanStr(streetAddress).length > 0 && cleanStr(streetAddress).length < 5) errors.push("Street Address, if provided, must be at least 5 characters.");
        if (cleanStr(city) && /\d/.test(cleanStr(city))) errors.push("City / Municipality must not contain digits.");

        const medicalRoles = ['doctor', 'nurse', 'pharmacist'];
        if (medicalRoles.includes(normalizedAccountType)) {
            const lic = cleanStr(medicalLicenseNumber);
            if (!/^\d{7}$/.test(lic)) errors.push("Medical License Number must be exactly 7 digits for Doctor/Nurse/Pharmacist.");
            if (!cleanStr(specialization)) errors.push("Specialization is required for this role.");
        }

        if (normalizedAccountType === 'nurse' && !cleanStr(specialization)) errors.push("Nurse department / specialization is required.");

        const isMedDoctor = normalizedAccountType === 'doctor' && cleanStr(specialization).toLowerCase() === 'medicine';
        if (isMedDoctor && !cleanStr(department)) errors.push("Department is required for Medicine doctors (ER or OPD/Medicine).");

        const isDocSec = normalizedAccountType === 'doctor_secretary';
        if (isDocSec && !cleanStr(linkedDoctorId)) errors.push("Linked Doctor is required for Doctor Secretary.");

        if (errors.length > 0) {
            return res.status(400).json({ message: errors.join(" | "), field: errors[0].includes("Email") ? "email" : errors[0].includes("Phone") ? "phone" : undefined });
        }
        
        // 1. Check for Duplicate Email across ALL collections
        if (emailClean) {
            const e = emailClean;
            const [existingStaff, existingNurse, existingDoctor, existingAccount, existingPatient] = await Promise.all([
                prisma.staff.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.nurses.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.doctors.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.accounts.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.patients.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } })
            ]);
            
            if (existingStaff || existingNurse || existingDoctor || existingAccount || existingPatient) {
                return res.status(400).json({ 
                    field: "email",
                    message: `Email "${e}" is already registered.` 
                });
            }
        }
        
        // Backend Date Validation
        if (dateOfBirth) {
            const dob = new Date(dateOfBirth);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const m = today.getMonth() - dob.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
                age--;
            }
            
            if (age < 18) {
                return res.status(400).json({ field: "dateOfBirth", message: "Must be at least 18 years old." });
            }
            
            if (dob.getFullYear() >= today.getFullYear()) {
                 return res.status(400).json({ field: "dateOfBirth", message: "Date of Birth cannot be in the current or future year." });
            }
        }
        
        // Select Model based on accountType
        let modelType;
        if (normalizedAccountType === 'nurse') modelType = 'nurses';
        else if (normalizedAccountType === 'doctor') modelType = 'doctors';
        else if (normalizedAccountType === 'admin' || normalizedAccountType === 'cashier' || normalizedAccountType === 'doctor_secretary') modelType = 'accounts';
        else modelType = 'staff';

        // Hash password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const accountName = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim()
            || (email ? String(email).split('@')[0] : normalizedAccountType)
            || `${normalizedAccountType}_${Date.now().toString(36)}`;

        if (modelType === 'accounts') {
            const name = accountName
                || (normalizedAccountType === 'doctor_secretary' ? 'Doctor Secretary' : 'Cashier');

            const linkedDoctorIdRaw = String(linkedDoctorId || '').trim();
            if (normalizedAccountType === 'doctor_secretary') {
                if (!linkedDoctorIdRaw) {
                    return res.status(400).json({ field: "linkedDoctorId", message: "Linked Doctor is required for Doctor Secretary." });
                }
                const doctorExists = await prisma.doctors.findUnique({ where: { id: linkedDoctorIdRaw }, select: { id: true } }).catch(() => null);
                if (!doctorExists) {
                    return res.status(400).json({ field: "linkedDoctorId", message: "Selected doctor does not exist." });
                }
            }

            const savedAcc = await prisma.accounts.create({
                data: {
                    name,
                    email: emailClean || null,
                    password: hashedPassword,
                    roles: normalizedAccountType
                }
            });

            if (normalizedAccountType === 'doctor_secretary' && linkedDoctorIdRaw) {
                await prisma.$executeRawUnsafe(
                    `UPDATE accounts SET linked_doctor_id = $1::uuid WHERE id = $2`,
                    linkedDoctorIdRaw,
                    savedAcc.id
                ).catch(() => {});
            }

            const responseData = JSON.parse(JSON.stringify(savedAcc, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            ));
            if (normalizedAccountType === 'doctor_secretary') {
                responseData.linkedDoctorId = linkedDoctorIdRaw || null;
                responseData.linked_doctor_id = linkedDoctorIdRaw || null;
            }
            return res.status(201).json(responseData);
        }

        const baseData = {
            first_name: firstName,
            last_name: lastName,
            email: emailClean || null,
            account_type: normalizedAccountType,
            password: hashedPassword
        };

        if (modelType === 'staff') {
            await ensureStaffAccountTypeConstraint();
            const data = {
                ...baseData,
                employee_id: employeeId || undefined,
                status: 'Offline'
            };
            try {
                const savedDoc = await prisma.staff.create({ data });
                return res.status(201).json(savedDoc);
            } catch (e) {
                const msg = String(e?.message || '');
                if (msg.includes('staff_account_type_check') || msg.includes('23514')) {
                    staffAccountTypeConstraintEnsured = false;
                    staffAccountTypeConstraintPromise = null;
                    await ensureStaffAccountTypeConstraint();
                    const savedDoc = await prisma.staff.create({ data });
                    return res.status(201).json(savedDoc);
                }
                throw e;
            }
        }

        const data = {
            ...baseData,
            middle_name: middleName || undefined,
            gender: gender || undefined,
            civil_status: civilStatus || undefined,
            nationality: nationality || undefined,
            employee_id: employeeId || undefined,
            medical_license_number: medicalLicenseNumber || undefined,
            specialization: specialization || undefined,
            department: department || undefined,
            phone: phone || undefined,
            street_address: streetAddress || undefined,
            city: city || undefined,
            province: province || undefined,
            postal_code: postalCode || undefined,
            country: country || undefined,
            status: 'Offline'
        };

        if (modelType === 'nurses') {
            data.department = department || specialization || undefined;
        }

        if (modelType === 'doctors') {
            data.id = crypto.randomUUID();
        }

        if (dateOfBirth) data.date_of_birth = new Date(dateOfBirth);
        if (dateHired) data.date_hired = new Date(dateHired);

        const savedDoc = await prisma[modelType].create({ data });
        
        try {
            await prisma.accounts.create({
                data: {
                    name: accountName || `${normalizedAccountType}`.trim(),
                    email: emailClean || null,
                    password: hashedPassword,
                    roles: normalizedAccountType
                }
            }).catch(() => {});
        } catch (_) {}

        return res.status(201).json(savedDoc);
    } catch (err) {
        if (err.code === 'P2002') {
            const target = Array.isArray(err?.meta?.target) ? err.meta.target.join(', ') : (String(err.meta?.target || '') || '');
            const msg = target ? `Duplicate ${target} — record already exists.` : 'Duplicate entry — email/employee ID/medical license may already be registered.';
            return res.status(400).json({ message: msg, prismaCode: err.code, field: target ? target.split(',')[0] : undefined });
        }
        if (err.code === 'P2008' || err.code === 'P2007' || /23514|check constraint|staff_account_type_check/i.test(String(err?.message || ''))) {
            return res.status(400).json({ message: `Account type is not allowed for the staff table — try selecting a different role or specialization. (${err.code || '23514'})` });
        }
        if (String(err?.message || '').includes('invalid input syntax') || String(err?.message || '').includes('uuid')) {
            return res.status(400).json({ message: `Database UUID mismatch — ${String(err.message).slice(0,180)}` });
        }
        console.error("STAFF CREATE ERROR:", err?.code || 'NO_CODE', err?.message || 'NO_MESSAGE', err?.meta || 'NO_META');
        const safeMsg = String(err?.message || '').slice(0, 300) || 'Database rejected the staff creation request.';
        res.status(500).json({ message: safeMsg, code: err?.code, prismaMeta: err?.meta ? String(JSON.stringify(err.meta)).slice(0,200) : undefined });
    }
});

// READ All (Combine Staff, Nurses, Doctors, Accounts)
router.get('/', requireRole(['admin']), async (req, res) => {
    try {
        await ensurePresenceSchemaOnce().catch(() => {});
        await ensureAccountsDoctorLinkSchema().catch(() => {});
        const take = Math.min(Math.max(parseInt(req.query.take, 10) || 100, 1), 200);
        const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

        // Small cache to avoid hammering the DB on dashboard polling.
        if (!router._staffListCache) router._staffListCache = { key: '', fetchedAt: 0, payload: null, promise: null };
        const cacheKey = JSON.stringify({ take, skip });
        const now = Date.now();
        if (router._staffListCache.payload && router._staffListCache.key === cacheKey && now - router._staffListCache.fetchedAt < 15000) {
            return res.json(router._staffListCache.payload);
        }
        if (router._staffListCache.promise && router._staffListCache.key === cacheKey) {
            const payload = await router._staffListCache.promise;
            return res.json(payload);
        }
        router._staffListCache.key = cacheKey;

        // Not all Prisma models expose created_at/updated_at. Order by id for stability.
        router._staffListCache.promise = (async () => {
            const [staff, nurses, doctors, accounts] = await Promise.all([
                prisma.staff.findMany({ take, skip, orderBy: { id: 'desc' } }).catch(() => []),
                prisma.nurses.findMany({ take, skip, orderBy: { id: 'desc' } }).catch(() => []),
                prisma.doctors.findMany({ take, skip, orderBy: { id: 'desc' } }).catch(() => []),
                prisma.accounts.findMany({
                    where: { roles: { in: ['admin', 'cashier', 'doctor_secretary'] } },
                    take,
                    skip,
                    orderBy: { id: 'desc' }
                }).catch(() => [])
            ]);

            const linkedIds = Array.from(new Set((accounts || []).map((a) => String(a.linked_doctor_id || '')).filter(Boolean)));
            const linkedDocs = linkedIds.length
                ? await prisma.doctors.findMany({
                    where: { id: { in: linkedIds } },
                    select: { id: true, first_name: true, last_name: true, specialization: true }
                }).catch(() => [])
                : [];
            const linkedDocMap = new Map((Array.isArray(linkedDocs) ? linkedDocs : []).map((d) => {
                const name = `Dr. ${String(d.first_name || '').trim()} ${String(d.last_name || '').trim()}`.trim();
                return [String(d.id), { id: String(d.id), name, specialization: d.specialization || null }];
            }));

            const formattedAccounts = (Array.isArray(accounts) ? accounts : []).map((acc) => ({
                ...acc,
                id: acc.id != null ? acc.id.toString() : acc.id,
                first_name: acc.name,
                last_name: '',
                account_type: String(acc.roles || 'admin').trim().toLowerCase(),
                contact_number: acc.contact_number ? acc.contact_number.toString() : null,
                linked_doctor_id: acc.linked_doctor_id ? String(acc.linked_doctor_id) : null,
                linkedDoctorId: acc.linked_doctor_id ? String(acc.linked_doctor_id) : null,
                linkedDoctor: acc.linked_doctor_id ? (linkedDocMap.get(String(acc.linked_doctor_id)) || null) : null
            }));

            const isNotPatient = (u) =>
                String(u && (u.account_type || u.roles) ? (u.account_type || u.roles) : '')
                    .trim()
                    .toLowerCase() !== 'patient';

            const allUsers = [...staff, ...nurses, ...doctors, ...formattedAccounts]
                .filter(isNotPatient)
                .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

            router._staffListCache.fetchedAt = Date.now();
            router._staffListCache.payload = allUsers;
            return allUsers;
        })().finally(() => {
            router._staffListCache.promise = null;
        });

        const payload = await router._staffListCache.promise;
        return res.json(payload);
    } catch (err) {
        res.status(500).json(err);
    }
});

router.get('/doctor-secretaries', requireRole(['admin', 'nurse', 'doctor_secretary']), async (req, res) => {
    try {
        await ensureAccountsDoctorLinkSchema().catch(() => {});
        const specRaw = String(req.query.specialization || req.query.spec || '').trim();
        if (!specRaw) return res.json([]);

        const canonicalSpecialization = (value) => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (!normalized) return '';
            if (/^(obgyn|obstetricsgynecology|obstetricsandgynecology|gynecology)$/.test(normalized)) return 'obgyn';
            if (/^(ent|otolaryngology|otorhinolaryngology)$/.test(normalized)) return 'ent';
            if (/^(pediatric|pediatrics|pedia)$/.test(normalized)) return 'pediatrics';
            if (/^(orthopedic|orthopedics|orthopedrics|ortho)$/.test(normalized)) return 'orthopedics';
            if (/^(dental|dentalmedicine|dentistry)$/.test(normalized)) return 'dental';
            return normalized;
        };
        const requestedSpec = canonicalSpecialization(specRaw);

        const doctorRows = await prisma.doctors
            .findMany({
                select: { id: true, first_name: true, last_name: true, specialization: true },
                take: 500
            });
        const matchingDoctors = (Array.isArray(doctorRows) ? doctorRows : [])
            .filter((doctor) => canonicalSpecialization(doctor?.specialization) === requestedSpec);
        const doctorIds = matchingDoctors.map((d) => String(d?.id || '').trim()).filter(Boolean);
        if (!doctorIds.length) return res.json([]);

        const accounts = await prisma.accounts
            .findMany({
                where: {
                    roles: { equals: 'doctor_secretary', mode: 'insensitive' },
                    linked_doctor_id: { in: doctorIds }
                },
                select: { id: true, name: true, email: true, linked_doctor_id: true, status: true }
            });

        const docMap = new Map(matchingDoctors.map((d) => {
            const id = String(d.id);
            const name = `Dr. ${String(d.first_name || '').trim()} ${String(d.last_name || '').trim()}`.trim();
            return [id, { id, name, specialization: d.specialization || null }];
        }));

        res.json(
            (Array.isArray(accounts) ? accounts : [])
                .filter((acc) => !['inactive', 'disabled', 'suspended'].includes(String(acc.status || '').trim().toLowerCase()))
                .map((acc) => ({
                    id: acc.id != null ? acc.id.toString() : String(acc.id),
                    name: String(acc.name || '').trim() || 'Doctor Secretary',
                    email: acc.email || null,
                    linkedDoctorId: acc.linked_doctor_id ? String(acc.linked_doctor_id) : null,
                    linkedDoctor: acc.linked_doctor_id ? docMap.get(String(acc.linked_doctor_id)) || null : null
                }))
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        );
    } catch (err) {
        res.status(500).json({ message: String(err?.message || 'Server error') });
    }
});

router.get('/settings', async (req, res) => {
    try {
        const { role, email } = inferRequester(req);
        if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

        const rows = await prisma.$queryRawUnsafe(
            `SELECT prefs, updated_at FROM user_settings WHERE lower(user_email) = lower($1) AND lower(user_role) = lower($2) LIMIT 1`,
            email,
            role
        ).catch(() => null);

        const row = Array.isArray(rows) ? rows[0] : null;
        res.json({
            prefs: row?.prefs || {},
            updatedAt: row?.updated_at || null
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.put('/settings', async (req, res) => {
    try {
        const { role, email } = inferRequester(req);
        if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

        const incoming = req.body && typeof req.body === 'object' ? req.body : {};
        const prefs = incoming.prefs && typeof incoming.prefs === 'object' ? incoming.prefs : incoming;
        const payload = JSON.stringify(prefs || {});

        const rows = await prisma.$queryRawUnsafe(
            `
                INSERT INTO user_settings (user_email, user_role, prefs, created_at, updated_at)
                VALUES ($1, $2, $3::jsonb, now(), now())
                ON CONFLICT (user_email, user_role)
                DO UPDATE SET prefs = user_settings.prefs || EXCLUDED.prefs, updated_at = now()
                RETURNING prefs, updated_at
            `,
            email,
            role,
            payload
        ).catch(() => null);

        const row = Array.isArray(rows) ? rows[0] : null;
        res.json({ prefs: row?.prefs || {}, updatedAt: row?.updated_at || null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/notifications', async (req, res) => {
    try {
        const { role, email, explicitName, patientId } = inferRequester(req);
        if (!role) return res.status(401).json({ message: 'Unauthorized' });
        const canIdentifyPatient = role === 'patient' && isUuid(patientId);
        if (!email && !canIdentifyPatient) return res.status(401).json({ message: 'Unauthorized' });

        const found = email ? await findUserByEmail(email) : null;
        const displayName = explicitName || inferDisplayNameFromUser(found, email);

        const prefsRows = email
            ? await prisma.$queryRawUnsafe(
                `SELECT prefs FROM user_settings WHERE user_email = $1 AND user_role = $2 LIMIT 1`,
                email,
                role
              ).catch(() => [])
            : [];
        const prefs = Array.isArray(prefsRows) && prefsRows.length ? (prefsRows[0]?.prefs || {}) : {};
        const lastReadRaw = prefs && typeof prefs === 'object' ? prefs.notificationsLastReadAt : null;
        const lastReadAt = lastReadRaw ? new Date(lastReadRaw) : null;
        const lastReadMs = lastReadAt && Number.isFinite(lastReadAt.getTime()) ? lastReadAt.getTime() : 0;

        const items = [];

        if (role === 'doctor' || role === 'nurse') {
            const filterField = role === 'doctor' ? 'doctor_name' : 'nurse_name';
            const readField = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';
            const otherRole = role === 'doctor' ? 'doctor' : 'nurse';

            const rows = await prisma.$queryRawUnsafe(
                `
                    WITH base AS (
                        SELECT r.*
                        FROM appointment_approval_requests r
                        WHERE regexp_replace(regexp_replace(lower(coalesce(r.${filterField}, '')), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                            = regexp_replace(regexp_replace(lower($1), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                        ORDER BY r.updated_at DESC, r.created_at DESC
                        LIMIT 50
                    ),
                    last_msg AS (
                        SELECT DISTINCT ON (m.request_id) m.request_id, m.body, m.created_at
                        FROM appointment_messages m
                        JOIN base b ON b.id = m.request_id
                        ORDER BY m.request_id, m.created_at DESC
                    ),
                    unread AS (
                        SELECT b.id AS request_id, COUNT(*)::int AS unread_count
                        FROM base b
                        JOIN appointment_messages m ON m.request_id = b.id
                        WHERE m.created_at > COALESCE(b.${readField}, to_timestamp(0))
                            AND m.sender_role <> $2
                        GROUP BY b.id
                    )
                    SELECT
                        b.id,
                        b.patient_name,
                        b.status,
                        b.created_at,
                        b.updated_at,
                        lm.body AS last_body,
                        lm.created_at AS last_at,
                        COALESCE(u.unread_count, 0) AS unread_count
                    FROM base b
                    LEFT JOIN last_msg lm ON lm.request_id = b.id
                    LEFT JOIN unread u ON u.request_id = b.id
                    ORDER BY COALESCE(lm.created_at, b.created_at) DESC
                `,
                displayName,
                otherRole
            ).catch(() => []);

            (Array.isArray(rows) ? rows : []).forEach((r) => {
                const requestId = r.id?.toString?.() ? r.id.toString() : String(r.id);
                const unreadCount = Number(r.unread_count || 0) || 0;
                const createdAt = r.last_at || r.updated_at || r.created_at || null;
                const patientName = String(r.patient_name || 'Patient');
                const status = String(r.status || 'Pending');
                const lastBody = String(r.last_body || '').trim();
                const message = lastBody ? `${patientName} • ${status} • ${lastBody}` : `${patientName} • ${status}`;
                items.push({
                    id: `approval:${requestId}`,
                    type: 'approval',
                    title: 'Appointment Approval',
                    message,
                    createdAt,
                    unreadCount,
                    meta: { requestId }
                });
            });
        }

        if (role === 'doctor_secretary' || role === 'medtech' || role === 'radiographer' || role === 'ecg_operator' || role === 'physical_therapist') {
            const serviceExpr = `
                lower(
                    coalesce(
                        nullif(r.department_key, ''),
                        nullif(r.service_type, ''),
                        nullif(split_part(coalesce(r.reason, ''), ':', 1), '')
                    )
                )
            `.trim();
            const readField = 'nurse_last_read_at';

            const allowed = (() => {
                if (role === 'medtech') return ['laboratory'];
                if (role === 'radiographer') return ['radiology'];
                if (role === 'ecg_operator') return ['ecg'];
                if (role === 'physical_therapist') return ['physical therapy'];
                const nameKey = String(displayName || '').toLowerCase();
                if (nameKey.includes('dental')) return ['dental clinic', 'dental'];
                if (nameKey.includes('surgery')) return ['surgery (minor)', 'surgery'];
                return ['consultation'];
            })();

            const params = [];
            let i = 1;
            const clause = allowed.map((_, idx) => `${serviceExpr} = $${i + idx}`).join(' OR ');
            params.push(...allowed);
            i += allowed.length;
            params.push(role);

            const rows = await prisma.$queryRawUnsafe(
                `
                    WITH base AS (
                        SELECT r.*
                        FROM appointment_approval_requests r
                        WHERE (${clause})
                        ORDER BY r.updated_at DESC, r.created_at DESC
                        LIMIT 50
                    ),
                    last_msg AS (
                        SELECT DISTINCT ON (m.request_id) m.request_id, m.body, m.created_at
                        FROM appointment_messages m
                        JOIN base b ON b.id = m.request_id
                        ORDER BY m.request_id, m.created_at DESC
                    ),
                    unread AS (
                        SELECT b.id AS request_id, COUNT(*)::int AS unread_count
                        FROM base b
                        JOIN appointment_messages m ON m.request_id = b.id
                        WHERE m.created_at > COALESCE(b.${readField}, to_timestamp(0))
                            AND m.sender_role <> $${i}
                        GROUP BY b.id
                    )
                    SELECT
                        b.id,
                        b.patient_name,
                        b.status,
                        b.created_at,
                        b.updated_at,
                        lm.body AS last_body,
                        lm.created_at AS last_at,
                        COALESCE(u.unread_count, 0) AS unread_count
                    FROM base b
                    LEFT JOIN last_msg lm ON lm.request_id = b.id
                    LEFT JOIN unread u ON u.request_id = b.id
                    ORDER BY COALESCE(lm.created_at, b.created_at) DESC
                `,
                ...params
            ).catch(() => []);

            (Array.isArray(rows) ? rows : []).forEach((r) => {
                const requestId = r.id?.toString?.() ? r.id.toString() : String(r.id);
                const unreadCount = Number(r.unread_count || 0) || 0;
                const createdAt = r.last_at || r.updated_at || r.created_at || null;
                const patientName = String(r.patient_name || 'Patient');
                const status = String(r.status || 'Pending');
                const lastBody = String(r.last_body || '').trim();
                const message = lastBody ? `${patientName} • ${status} • ${lastBody}` : `${patientName} • ${status}`;
                items.push({
                    id: `approval:${requestId}`,
                    type: 'approval',
                    title: 'Appointment Approval',
                    message,
                    createdAt,
                    unreadCount,
                    meta: { requestId }
                });
            });
        }

        if (role === 'admin') {
            const now = new Date();
            const todayKey = now.toISOString().slice(0, 10);
            const lastActiveRaw = found?.user?.last_active || found?.user?.lastActive || null;
            const greetAtCandidate = lastActiveRaw ? new Date(lastActiveRaw) : now;
            const greetAt = greetAtCandidate && Number.isFinite(greetAtCandidate.getTime()) ? greetAtCandidate : now;
            const greetMs = greetAt.getTime();
            const greetUnread = greetMs > lastReadMs ? 1 : 0;
            items.unshift({
                id: `greet:${todayKey}`,
                type: 'greeting',
                title: 'Welcome',
                message: `Hi ${displayName}, welcome back.`,
                createdAt: greetAt.toISOString(),
                unreadCount: greetUnread
            });

            if (prefs && typeof prefs === 'object' && prefs.emailSummaries) {
                const apptCountsRows = await prisma.$queryRawUnsafe(
                    `
                        SELECT
                            COUNT(*)::int AS total,
                            SUM(CASE WHEN lower(coalesce(status, '')) = 'pending' THEN 1 ELSE 0 END)::int AS pending,
                            SUM(CASE WHEN lower(coalesce(status, '')) = 'approved' THEN 1 ELSE 0 END)::int AS approved,
                            SUM(CASE WHEN lower(coalesce(status, '')) = 'completed' THEN 1 ELSE 0 END)::int AS completed,
                            SUM(CASE WHEN lower(coalesce(status, '')) IN ('cancelled', 'canceled', 'rejected') THEN 1 ELSE 0 END)::int AS cancelled
                        FROM appointments
                        WHERE appointment_date = CURRENT_DATE
                    `
                ).catch(() => []);
                const apptCounts = Array.isArray(apptCountsRows) && apptCountsRows.length ? apptCountsRows[0] : {};

                const incidentCountRows = await prisma.$queryRawUnsafe(
                    `
                        SELECT COUNT(*)::int AS count
                        FROM incidents
                        WHERE incident_date = CURRENT_DATE
                    `
                ).catch(() => []);
                const incidentCount = Array.isArray(incidentCountRows) && incidentCountRows.length ? Number(incidentCountRows[0]?.count || 0) || 0 : 0;

                const lowMedsRows = await prisma.$queryRawUnsafe(
                    `
                        SELECT COUNT(*)::int AS count
                        FROM medicines
                        WHERE COALESCE(stock, 0) = 0 OR COALESCE(stock, 0) <= COALESCE(min_level, 5)
                    `
                ).catch(() => []);
                const lowMeds = Array.isArray(lowMedsRows) && lowMedsRows.length ? Number(lowMedsRows[0]?.count || 0) || 0 : 0;

                const lowSuppliesRows = await prisma.$queryRawUnsafe(
                    `
                        SELECT COUNT(*)::int AS count
                        FROM supplies
                        WHERE COALESCE(stock, 0) = 0 OR COALESCE(stock, 0) <= COALESCE(min_level, 10)
                    `
                ).catch(() => []);
                const lowSupplies = Array.isArray(lowSuppliesRows) && lowSuppliesRows.length ? Number(lowSuppliesRows[0]?.count || 0) || 0 : 0;

                const restockRows = await prisma.$queryRawUnsafe(
                    `
                        SELECT COUNT(*)::int AS count
                        FROM restock_requests
                        WHERE lower(coalesce(status, 'pending')) = 'pending'
                    `
                ).catch(() => []);
                const restockPending = Array.isArray(restockRows) && restockRows.length ? Number(restockRows[0]?.count || 0) || 0 : 0;

                const dailyAt = greetAt;
                const dailyMs = dailyAt && Number.isFinite(dailyAt.getTime()) ? dailyAt.getTime() : Date.now();
                const dailyUnread = dailyMs > lastReadMs ? 1 : 0;
                const total = Number(apptCounts?.total || 0) || 0;
                const pending = Number(apptCounts?.pending || 0) || 0;
                const approved = Number(apptCounts?.approved || 0) || 0;
                const completed = Number(apptCounts?.completed || 0) || 0;
                const cancelled = Number(apptCounts?.cancelled || 0) || 0;
                const message = `Today: Appointments ${total} (Pending ${pending}, Approved ${approved}, Completed ${completed}${cancelled ? `, Cancelled ${cancelled}` : ''}). Incidents ${incidentCount}. Low stock: Medicines ${lowMeds}, Supplies ${lowSupplies}. Restock pending ${restockPending}.`;

                items.unshift({
                    id: `daily:${todayKey}`,
                    type: 'daily_summary',
                    title: 'Daily Summary',
                    message,
                    createdAt: dailyAt.toISOString(),
                    unreadCount: dailyUnread,
                    meta: {
                        appointments: { total, pending, approved, completed, cancelled },
                        incidents: incidentCount,
                        lowStock: { medicines: lowMeds, supplies: lowSupplies },
                        restockPending
                    }
                });
            }

            await ensureInventoryTimestampSchemaOnce().catch(() => {});

            const medsRows = await prisma.$queryRaw`
                SELECT id, name, stock, min_level, created_at, updated_at
                FROM public.medicines
                WHERE COALESCE(stock, 0) = 0 OR COALESCE(stock, 0) <= COALESCE(min_level, 5)
                ORDER BY COALESCE(stock, 0) ASC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT 8
            `.catch(() => []);
            const suppliesRows = await prisma.$queryRaw`
                SELECT id, item_name, stock, min_level, created_at, updated_at
                FROM public.supplies
                WHERE COALESCE(stock, 0) = 0 OR COALESCE(stock, 0) <= COALESCE(min_level, 10)
                ORDER BY COALESCE(stock, 0) ASC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT 8
            `.catch(() => []);

            const invItems = [];
            (Array.isArray(medsRows) ? medsRows : []).forEach((r) => {
                const id = r.id?.toString?.() ? r.id.toString() : String(r.id);
                const name = String(r.name || 'Medicine');
                const stock = Number(r.stock ?? 0) || 0;
                const minLevel = Number(r.min_level ?? 5) || 5;
                const status = stock === 0 ? 'Out of Stock' : stock <= minLevel ? 'Low Stock' : 'In Stock';
                const when = r.updated_at || r.created_at || null;
                const ms = when ? new Date(when).getTime() : 0;
                const unreadCount = ms > lastReadMs ? 1 : 0;
                invItems.push({
                    id: `inv:med:${id}`,
                    type: 'inventory',
                    title: 'Inventory Alert',
                    message: `${name} is ${status.toLowerCase()}`,
                    createdAt: when,
                    unreadCount,
                    meta: { source: 'medicines', itemId: id }
                });
            });
            (Array.isArray(suppliesRows) ? suppliesRows : []).forEach((r) => {
                const id = r.id?.toString?.() ? r.id.toString() : String(r.id);
                const name = String(r.item_name || 'Supply');
                const stock = Number(r.stock ?? 0) || 0;
                const minLevel = Number(r.min_level ?? 10) || 10;
                const status = stock === 0 ? 'Out of Stock' : stock <= minLevel ? 'Low Stock' : 'In Stock';
                const when = r.updated_at || r.created_at || null;
                const ms = when ? new Date(when).getTime() : 0;
                const unreadCount = ms > lastReadMs ? 1 : 0;
                invItems.push({
                    id: `inv:supply:${id}`,
                    type: 'inventory',
                    title: 'Inventory Alert',
                    message: `${name} is ${status.toLowerCase()}`,
                    createdAt: when,
                    unreadCount,
                    meta: { source: 'supplies', itemId: id }
                });
            });

            invItems.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
            items.push(...invItems.slice(0, 8));
        }

        if (role === 'patient') {
            let patient = null;
            if (isUuid(patientId)) {
                patient = await prisma.patients.findFirst({
                    where: { id: patientId },
                    select: { id: true, email: true }
                }).catch(() => null);
                if (patient?.id && email) {
                    const stored = normalizeEmail(String(patient.email || ''));
                    if (stored && stored !== email) {
                        patient = null;
                    }
                }
            }
            if (!patient?.id && email) {
                patient = await prisma.patients.findFirst({
                    where: { email: { equals: email, mode: 'insensitive' } },
                    select: { id: true }
                }).catch(() => null);
            }
            if (patient?.id) {
                const rows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT r.id::text AS id,
                               r.type,
                               r.title,
                               r.url,
                               r.created_at AS "createdAt",
                               r.verified_at AS "verifiedAt",
                               r.verification_status AS "verificationStatus"
                        FROM lab_results r
                        WHERE r.patient_id = ${String(patient.id)}::uuid
                        ORDER BY COALESCE(r.verified_at, r.created_at) DESC
                        LIMIT 25
                    `
                ).catch(() => []);

                (Array.isArray(rows) ? rows : []).forEach((r) => {
                    const when = r.verifiedAt || r.createdAt || null;
                    const ms = when ? new Date(when).getTime() : 0;
                    const unreadCount = ms > lastReadMs ? 1 : 0;
                    const label = String(r.title || '').trim() || `${String(r.type || 'Test')} Result`;
                    const status = String(r.verificationStatus || 'pending').trim().toLowerCase() || 'pending';

                    let title = 'New Test Result';
                    let message = `${label} is now available.`;
                    let severity = 'success';
                    if (status === 'pending') {
                        title = 'Result Received';
                        message = `${label} was uploaded. Verification is in progress.`;
                        severity = 'info';
                    } else if (status === 'flagged') {
                        title = 'Result Needs Review';
                        message = `${label} needs review before final verification.`;
                        severity = 'info';
                    } else if (status === 'rejected') {
                        title = 'Result Rejected';
                        message = `${label} was rejected as invalid. Please contact the hospital if needed.`;
                        severity = 'alert';
                    }
                    items.push({
                        id: `lab:${String(r.id)}`,
                        type: 'lab_result',
                        title,
                        message,
                        createdAt: when,
                        unreadCount,
                        url: r.url || null,
                        pdfUrl: r.url || null,
                        fileUrl: r.url || null,
                        meta: { labResultId: String(r.id), verificationStatus: status, severity, url: r.url || null, pdfUrl: r.url || null, fileUrl: r.url || null }
                    });
                });

                const approvalRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT
                            r.id::text AS id,
                            r.status,
                            r.requested_date AS "requestedDate",
                            r.requested_time AS "requestedTime",
                            r.service_name AS "serviceName",
                            r.service_type AS "serviceType",
                            r.reason,
                            r.appointment_id AS "appointmentId",
                            r.updated_at AS "updatedAt",
                            r.created_at AS "createdAt"
                        FROM appointment_approval_requests r
                        WHERE r.patient_id = ${String(patient.id)}::uuid
                        ORDER BY r.updated_at DESC, r.created_at DESC
                        LIMIT 25
                    `
                ).catch(() => []);

                (Array.isArray(approvalRows) ? approvalRows : []).forEach((r) => {
                    const when = r.updatedAt || r.createdAt || null;
                    const ms = when ? new Date(when).getTime() : 0;
                    const unreadCount = ms > lastReadMs ? 1 : 0;
                    const status = String(r.status || 'Pending').trim();
                    const serviceLabel = String(r.serviceName || r.serviceType || r.reason || 'Appointment').trim();
                    const title = status === 'Approved'
                        ? 'Appointment Approved'
                        : status === 'Rejected'
                            ? 'Appointment Rejected'
                            : status === 'Suggested'
                                ? 'Schedule Suggested'
                                : 'Appointment Update';
                    const message = status === 'Suggested'
                        ? `New schedule suggested for: ${serviceLabel}`
                        : `${serviceLabel} • ${status}`;
                    items.push({
                        id: `approval_patient:${String(r.id)}`,
                        type: 'approval_update',
                        title,
                        message,
                        createdAt: when,
                        unreadCount,
                        meta: { requestId: String(r.id), appointmentId: r.appointmentId ? String(r.appointmentId) : null, severity: status === 'Rejected' ? 'alert' : status === 'Approved' ? 'success' : 'info' }
                    });
                });

                const invoiceRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT
                            i.id::text AS id,
                            i.status,
                            i.total_amount AS "totalAmount",
                            i.appointment_id AS "appointmentId",
                            i.updated_at AS "updatedAt",
                            i.created_at AS "createdAt",
                            COALESCE((SELECT max(p.created_at) FROM billing_payments p WHERE p.invoice_id = i.id), to_timestamp(0)) AS "lastPaymentAt"
                        FROM billing_invoices i
                        WHERE i.patient_id = ${String(patient.id)}::uuid
                        ORDER BY GREATEST(COALESCE(i.updated_at, to_timestamp(0)), COALESCE((SELECT max(p.created_at) FROM billing_payments p WHERE p.invoice_id = i.id), to_timestamp(0))) DESC
                        LIMIT 25
                    `
                ).catch(() => []);

                (Array.isArray(invoiceRows) ? invoiceRows : []).forEach((r) => {
                    const status = String(r.status || '').trim();
                    if (!status) return;
                    const when = r.lastPaymentAt && new Date(r.lastPaymentAt).getTime() > 0 ? r.lastPaymentAt : (r.updatedAt || r.createdAt || null);
                    const ms = when ? new Date(when).getTime() : 0;
                    const unreadCount = ms > lastReadMs ? 1 : 0;
                    const title = status === 'Paid'
                        ? 'Payment Received'
                        : status === 'Ready'
                            ? 'Payment Needed'
                            : status === 'Cancelled'
                                ? 'Invoice Cancelled'
                                : 'Billing Update';
                    const message = status === 'Paid'
                        ? 'Your payment has been recorded.'
                        : status === 'Ready'
                            ? 'Please proceed to cashier for payment.'
                            : `Invoice status: ${status}`;
                    items.push({
                        id: `invoice:${String(r.id)}`,
                        type: 'billing',
                        title,
                        message,
                        createdAt: when,
                        unreadCount,
                        meta: { invoiceId: String(r.id), appointmentId: r.appointmentId ? String(r.appointmentId) : null, severity: status === 'Paid' ? 'success' : status === 'Ready' ? 'alert' : 'info' }
                    });
                });
            }
        } else {
            const filters = [];
            if (displayName) filters.push(displayName);
            if (email) filters.push(email);
            if (filters.length) {
                const rows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT r.id::text AS id,
                               r.patient_id AS "patientId",
                               r.type,
                               r.title,
                               r.created_at AS "createdAt",
                               r.verified_at AS "verifiedAt",
                               r.verification_status AS "verificationStatus",
                               p.first_name AS "patientFirstName",
                               p.last_name AS "patientLastName"
                        FROM public.lab_results r
                        LEFT JOIN public.patients p ON p.id = r.patient_id
                        WHERE r.uploaded_by IN (${Prisma.join(filters)})
                        ORDER BY COALESCE(r.verified_at, r.created_at) DESC
                        LIMIT 25
                    `
                ).catch(() => []);

                (Array.isArray(rows) ? rows : []).forEach((r) => {
                    const patientName = `${String(r.patientFirstName || '')} ${String(r.patientLastName || '')}`.trim() || 'the patient';
                    const status = String(r.verificationStatus || 'pending').trim().toLowerCase() || 'pending';
                    const when = r.verifiedAt || r.createdAt || null;
                    const ms = when ? new Date(when).getTime() : 0;
                    const unreadCount = ms > lastReadMs ? 1 : 0;

                    let title = 'Result Uploaded';
                    let message = `Test result uploaded for ${patientName}`;
                    let severity = 'info';
                    if (status === 'rejected') {
                        title = 'Verification Failed';
                        message = `The file you sent to ${patientName} is not real or invalid.`;
                        severity = 'alert';
                    } else if (status === 'flagged') {
                        title = 'Verification Needs Review';
                        message = `The file you sent to ${patientName} needs review.`;
                        severity = 'info';
                    } else if (status === 'verified') {
                        title = 'Result Verified';
                        message = `Test result verified for ${patientName}`;
                        severity = 'success';
                    }

                    items.push({
                        id: `lab:${String(r.id)}`,
                        type: 'lab_result',
                        title,
                        message,
                        createdAt: when,
                        unreadCount,
                        meta: { labResultId: String(r.id), patientId: r.patientId ? String(r.patientId) : null, verificationStatus: status, severity }
                    });
                });
            }
        }

        const bucket = role === 'doctor' || role === 'nurse' || role === 'patient' || role === 'admin' ? role : 'staff';
        const annRows = await prisma.$queryRawUnsafe(
            `
                SELECT id, title, content, priority, target, author, pinned, expires_at, created_at
                FROM announcements
                WHERE (expires_at IS NULL OR expires_at > NOW())
                  AND (lower(coalesce(target, 'all')) = 'all' OR lower(coalesce(target, 'all')) = $1)
                ORDER BY pinned DESC, created_at DESC
                LIMIT 20
            `,
            bucket
        ).catch(() => []);

        (Array.isArray(annRows) ? annRows : []).forEach((a) => {
            const id = a.id?.toString?.() ? a.id.toString() : String(a.id);
            const when = a.created_at || null;
            const ms = when ? new Date(when).getTime() : 0;
            const unreadCount = ms > lastReadMs ? 1 : 0;
            const pri = String(a.priority || 'Normal').trim().toLowerCase();
            const severity = pri === 'urgent' ? 'alert' : pri === 'normal' ? 'success' : 'info';
            items.push({
                id: `ann:${id}`,
                type: 'announcement',
                title: String(a.title || 'Announcement'),
                message: String(a.content || ''),
                createdAt: when,
                unreadCount,
                meta: { severity, author: a.author || 'Admin', priority: a.priority || 'Normal', target: a.target || 'All' }
            });
        });

        items.sort((a, b) => {
            const ap = a?.type === 'greeting' ? 1 : 0;
            const bp = b?.type === 'greeting' ? 1 : 0;
            if (ap !== bp) return bp - ap;
            return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        });
        const totalUnread = items.reduce((acc, it) => acc + (Number(it.unreadCount || 0) || 0), 0);
        res.json({ unreadCount: totalUnread, items });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/notifications/stream', async (req, res) => {
    const role = normalizeRole(req.query.role || req.headers['x-user-role'] || '');
    const email = normalizeEmail(req.query.email || req.headers['x-user-email'] || '');
    const explicitName = String(req.query.name || req.headers['x-user-name'] || '').trim();
    if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const safeSend = (event, data) => {
        try {
            if (event) res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (_) {}
    };

    let closed = false;
    let timer = null;
    let keepAlive = null;
    const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (keepAlive) clearInterval(keepAlive);
        try {
            res.end();
        } catch (_) {}
    };

    req.on('close', close);
    req.on('end', close);
    req.on('error', close);

    safeSend('hello', { ok: true });

    const found = await findUserByEmail(email).catch(() => null);
    const displayName = explicitName || inferDisplayNameFromUser(found, email);
    let lastSig = '';

    const computeSig = async () => {
        try {
            const computeLabMsForUploader = async () => {
                const by = [];
                if (displayName) by.push(Prisma.sql`r.uploaded_by = ${displayName}`);
                if (email) by.push(Prisma.sql`r.uploaded_by = ${email}`);
                if (!by.length) return 0;
                const whereClause = Prisma.sql`WHERE (${Prisma.join(by, ' OR ')})`;
                const rows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT max(COALESCE(r.verified_at, r.created_at)) AS max_ts
                        FROM lab_results r
                        ${whereClause}
                    `
                ).catch(() => []);
                const row = Array.isArray(rows) ? rows[0] : null;
                const ms = row?.max_ts ? new Date(row.max_ts).getTime() : 0;
                return Number.isFinite(ms) ? ms : 0;
            };

            const computeLabMsForPatient = async () => {
                const patient = await prisma.patients.findFirst({
                    where: { email: { equals: email, mode: 'insensitive' } },
                    select: { id: true }
                }).catch(() => null);
                if (!patient?.id) return 0;
                const rows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT max(COALESCE(r.verified_at, r.created_at)) AS max_ts
                        FROM lab_results r
                        WHERE r.patient_id = ${String(patient.id)}::uuid
                    `
                ).catch(() => []);
                const row = Array.isArray(rows) ? rows[0] : null;
                const ms = row?.max_ts ? new Date(row.max_ts).getTime() : 0;
                return Number.isFinite(ms) ? ms : 0;
            };

            const computeAnnMs = async (bucket) => {
                const b = String(bucket || '').trim().toLowerCase() || 'all';
                const rows = await prisma.$queryRawUnsafe(
                    `
                        SELECT max(created_at) AS max_ts
                        FROM announcements
                        WHERE (expires_at IS NULL OR expires_at > NOW())
                          AND (lower(coalesce(target, 'all')) = 'all' OR lower(coalesce(target, 'all')) = $1)
                    `,
                    b
                ).catch(() => []);
                const row = Array.isArray(rows) ? rows[0] : null;
                const ms = row?.max_ts ? new Date(row.max_ts).getTime() : 0;
                return Number.isFinite(ms) ? ms : 0;
            };

            if (role === 'admin') {
                const rows = await prisma.$queryRaw`
                    SELECT GREATEST(
                        COALESCE((SELECT max(updated_at) FROM public.medicines), to_timestamp(0)),
                        COALESCE((SELECT max(updated_at) FROM public.supplies), to_timestamp(0)),
                        COALESCE((SELECT max(updated_at) FROM restock_requests), to_timestamp(0))
                    ) AS max_ts
                `.catch(() => []);
                const row = Array.isArray(rows) ? rows[0] : null;
                const ms = row?.max_ts ? new Date(row.max_ts).getTime() : 0;
                return `admin:${ms}`;
            }

            if (role === 'patient') {
                const labMs = await computeLabMsForPatient();
                const annMs = await computeAnnMs('patient');
                const approvalRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT max(r.updated_at) AS max_ts
                        FROM appointment_approval_requests r
                        JOIN patients p ON p.id = r.patient_id
                        WHERE lower(coalesce(p.email,'')) = lower(${email})
                    `
                ).catch(() => []);
                const approvalRow = Array.isArray(approvalRows) ? approvalRows[0] : null;
                const approvalMs = approvalRow?.max_ts ? new Date(approvalRow.max_ts).getTime() : 0;
                const billRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT GREATEST(
                            COALESCE((SELECT max(updated_at) FROM billing_invoices WHERE patient_id = p.id), to_timestamp(0)),
                            COALESCE((SELECT max(created_at) FROM billing_payments WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE patient_id = p.id)), to_timestamp(0))
                        ) AS max_ts
                        FROM patients p
                        WHERE lower(coalesce(p.email,'')) = lower(${email})
                        LIMIT 1
                    `
                ).catch(() => []);
                const billRow = Array.isArray(billRows) ? billRows[0] : null;
                const billMs = billRow?.max_ts ? new Date(billRow.max_ts).getTime() : 0;
                const merged = Math.max(labMs, annMs, Number.isFinite(approvalMs) ? approvalMs : 0, Number.isFinite(billMs) ? billMs : 0);
                return `patient:${merged}`;
            }

            if (role === 'doctor' || role === 'nurse') {
                const filterField = role === 'doctor' ? 'doctor_name' : 'nurse_name';
                const rows = await prisma.$queryRawUnsafe(
                    `
                        WITH base AS (
                            SELECT id, updated_at
                            FROM appointment_approval_requests
                            WHERE regexp_replace(regexp_replace(lower(coalesce(${filterField}, '')), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                                = regexp_replace(regexp_replace(lower($1), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                        ),
                        rmax AS (SELECT max(updated_at) AS rmax FROM base),
                        mmax AS (
                            SELECT max(m.created_at) AS mmax
                            FROM appointment_messages m
                            JOIN base b ON b.id = m.request_id
                        )
                        SELECT GREATEST(COALESCE(rmax, to_timestamp(0)), COALESCE(mmax, to_timestamp(0))) AS max_ts
                        FROM rmax, mmax
                    `,
                    displayName
                ).catch(() => []);
                const row = Array.isArray(rows) ? rows[0] : null;
                const approvalMs = row?.max_ts ? new Date(row.max_ts).getTime() : 0;
                const labMs = await computeLabMsForUploader();
                const annMs = await computeAnnMs(role);
                const merged = Math.max(Number.isFinite(approvalMs) ? approvalMs : 0, Number.isFinite(labMs) ? labMs : 0, annMs);
                return `${role}:${merged}`;
            }

            const labMs = await computeLabMsForUploader();
            const annMs = await computeAnnMs('staff');
            return `${role}:${Math.max(labMs, annMs)}`;
        } catch (_) {
            return '';
        }
    };

    const tick = async () => {
        if (closed) return;
        const sig = await computeSig();
        if (!sig) return;
        if (sig === lastSig) return;
        lastSig = sig;
        safeSend('notif', { sig });
    };

    keepAlive = setInterval(() => {
        if (closed) return;
        try {
            res.write(`:keep-alive ${Date.now()}\n\n`);
        } catch (_) {
            close();
        }
    }, 25000);

    await tick();
    timer = setInterval(tick, 8000);
});

router.post('/notifications/mark-all-read', async (req, res) => {
    try {
        const { role, email, explicitName } = inferRequester(req);
        if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

        const nowIso = new Date().toISOString();

        if (role !== 'doctor' && role !== 'nurse') {
            const payload = JSON.stringify({ notificationsLastReadAt: nowIso });
            await prisma.$queryRawUnsafe(
                `
                    INSERT INTO user_settings (user_email, user_role, prefs, created_at, updated_at)
                    VALUES ($1, $2, $3::jsonb, now(), now())
                    ON CONFLICT (user_email, user_role)
                    DO UPDATE SET prefs = user_settings.prefs || EXCLUDED.prefs, updated_at = now()
                `,
                email,
                role,
                payload
            ).catch(() => null);
            return res.json({ ok: true });
        }

        const found = await findUserByEmail(email);
        const displayName = explicitName || inferDisplayNameFromUser(found, email);

        const filterField = role === 'doctor' ? 'doctor_name' : 'nurse_name';
        const readField = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';

        await prisma.$executeRawUnsafe(
            `
                UPDATE appointment_approval_requests
                SET ${readField} = now(), updated_at = now()
                WHERE regexp_replace(regexp_replace(lower(coalesce(${filterField}, '')), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                    = regexp_replace(regexp_replace(lower($1), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
            `,
            displayName
        );

        const payload = JSON.stringify({ notificationsLastReadAt: nowIso });
        await prisma.$queryRawUnsafe(
            `
                INSERT INTO user_settings (user_email, user_role, prefs, created_at, updated_at)
                VALUES ($1, $2, $3::jsonb, now(), now())
                ON CONFLICT (user_email, user_role)
                DO UPDATE SET prefs = user_settings.prefs || EXCLUDED.prefs, updated_at = now()
            `,
            email,
            role,
            payload
        ).catch(() => null);

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/notifications/mark-read', async (req, res) => {
    try {
        const { role, email, explicitName } = inferRequester(req);
        if (!role || !email) return res.status(401).json({ message: 'Unauthorized' });

        const nowIso = new Date().toISOString();

        if (role !== 'doctor' && role !== 'nurse') {
            const payload = JSON.stringify({ notificationsLastReadAt: nowIso });
            await prisma.$queryRawUnsafe(
                `
                    INSERT INTO user_settings (user_email, user_role, prefs, created_at, updated_at)
                    VALUES ($1, $2, $3::jsonb, now(), now())
                    ON CONFLICT (user_email, user_role)
                    DO UPDATE SET prefs = user_settings.prefs || EXCLUDED.prefs, updated_at = now()
                `,
                email,
                role,
                payload
            ).catch(() => null);
            return res.json({ ok: true });
        }

        const rawId = String(req.body?.id || '').trim();
        const requestId = rawId.startsWith('approval:') ? rawId.slice('approval:'.length) : rawId;
        if (!requestId) return res.status(400).json({ message: 'id is required' });

        const found = await findUserByEmail(email);
        const displayName = explicitName || inferDisplayNameFromUser(found, email);

        const filterField = role === 'doctor' ? 'doctor_name' : 'nurse_name';
        const readField = role === 'doctor' ? 'doctor_last_read_at' : 'nurse_last_read_at';

        await prisma.$executeRawUnsafe(
            `
                UPDATE appointment_approval_requests
                SET ${readField} = now(), updated_at = now()
                WHERE id = $1::bigint
                  AND regexp_replace(regexp_replace(lower(coalesce(${filterField}, '')), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
                    = regexp_replace(regexp_replace(lower($2), '^(dr\\.?\\s*|nurse\\s*)', ''), '\\s+', ' ', 'g')
            `,
            BigInt(requestId),
            displayName
        );

        const payload = JSON.stringify({ notificationsLastReadAt: nowIso });
        await prisma.$queryRawUnsafe(
            `
                INSERT INTO user_settings (user_email, user_role, prefs, created_at, updated_at)
                VALUES ($1, $2, $3::jsonb, now(), now())
                ON CONFLICT (user_email, user_role)
                DO UPDATE SET prefs = user_settings.prefs || EXCLUDED.prefs, updated_at = now()
            `,
            email,
            role,
            payload
        ).catch(() => null);

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// READ One
router.get('/:id', async (req, res) => {
    try {
        const result = await findUserById(req.params.id);
        if (result) {
            const user = { ...result.user, id: result.user.id ? result.user.id.toString() : undefined };
            if (user.contact_number) user.contact_number = user.contact_number.toString();
            res.json(user);
        }
        else res.status(404).json({ message: "User not found" });
    } catch (err) {
        res.status(500).json(err);
    }
});

async function purgeEmailAcrossModels(email, prismaOrTx) {
    const e = normalizeEmail(email);
    if (!e) return;

    const client = prismaOrTx || prisma;
    let hasClinicalOrders = false;
    let hasClinicalOrdersAssignedTo = false;
    let hasClinicalSchedule = false;
    let hasClinicalScheduleStaffEmail = false;

    try {
        const reg = await client.$queryRaw`
          SELECT to_regclass('public.clinical_orders') AS clinical_orders,
                 to_regclass('public.clinical_schedule_events') AS clinical_schedule_events
        `;
        const info = Array.isArray(reg) ? reg[0] : null;
        hasClinicalOrders = Boolean(info && info.clinical_orders);
        hasClinicalSchedule = Boolean(info && info.clinical_schedule_events);
    } catch (_) {
        hasClinicalOrders = false;
        hasClinicalSchedule = false;
    }

    if (hasClinicalOrders || hasClinicalSchedule) {
        try {
            const cols = await client.$queryRaw`
              SELECT table_name, column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND (
                  (table_name = 'clinical_orders' AND column_name = 'assigned_to')
                  OR (table_name = 'clinical_schedule_events' AND column_name = 'staff_email')
                )
            `;
            const rows = Array.isArray(cols) ? cols : [];
            hasClinicalOrdersAssignedTo = rows.some((r) => String(r.table_name || '') === 'clinical_orders' && String(r.column_name || '') === 'assigned_to');
            hasClinicalScheduleStaffEmail = rows.some((r) => String(r.table_name || '') === 'clinical_schedule_events' && String(r.column_name || '') === 'staff_email');
        } catch (_) {
            hasClinicalOrdersAssignedTo = false;
            hasClinicalScheduleStaffEmail = false;
        }
    }

    if (hasClinicalOrders && hasClinicalOrdersAssignedTo) {
        await client.$executeRaw`
          UPDATE public.clinical_orders
          SET assigned_to = NULL
          WHERE lower(assigned_to) = ${e}
        `;
    }

    if (hasClinicalSchedule && hasClinicalScheduleStaffEmail) {
        await client.$executeRaw`
          DELETE FROM public.clinical_schedule_events
          WHERE lower(staff_email) = ${e}
        `;
    }

    if (prismaOrTx) {
        await Promise.all([
            client.staff.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            client.nurses.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            client.doctors.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            client.accounts.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            client.patients.updateMany({ where: { email: { equals: e, mode: 'insensitive' } }, data: { email: null } })
        ]);
        return;
    }

    await prisma.$transaction(async (tx) => {
        await Promise.all([
            tx.staff.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            tx.nurses.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            tx.doctors.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            tx.accounts.deleteMany({ where: { email: { equals: e, mode: 'insensitive' } } }),
            tx.patients.updateMany({ where: { email: { equals: e, mode: 'insensitive' } }, data: { email: null } })
        ]);
    });
}

router.delete('/by-email', requireRole(['admin']), async (req, res) => {
    try {
        let { email } = req.body || {};
        email = normalizeEmail(email);
        if (!email) return res.status(400).json({ message: 'Email is required' });

        await purgeEmailAcrossModels(email);

        prisma.activity_logs.create({
            data: {
                actor_name: String(req.headers['x-user-email'] || req.headers['x-user-role'] || 'admin'),
                role: 'Admin',
                action: 'Purge Email',
                details: `Purged ${email}`,
                target: email
            }
        }).catch(() => {});

        res.json({ success: true, message: 'Account(s) removed for this email.', email });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// UPDATE
router.put('/:id', requireRole(STAFF_ACCOUNT_TYPES), async (req, res) => {
    try {
        const result = await findUserById(req.params.id);
        if (!result) return res.status(404).json({ message: "User not found" });
        
        const { user, model } = result;

        // ---- Backend update validation (required fields + email/phone format) ----
        const bodyErrors = [];
        const cleanStr = (v) => String(v || "").trim();
        const isValidPHPhone = (v) => /^(\+?63\s?|0)9\d{9}$/.test(String(cleanStr(v)).replace(/[\s\-()]/g, ''));
        const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanStr(v));
        const isValidName = (v) => { const s = cleanStr(v); return !!s && /^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(s); };

        const firstNameIn = req.body?.firstName ?? req.body?.first_name ?? (model === 'accounts' ? undefined : user?.first_name);
        const lastNameIn = req.body?.lastName ?? req.body?.last_name ?? (model === 'accounts' ? undefined : user?.last_name);
        const middleNameIn = req.body?.middleName ?? req.body?.middle_name ?? (model === 'accounts' ? undefined : user?.middle_name);
        const phoneIn = req.body?.phone ?? user?.phone ?? user?.contact_number;
        const emailIn = req.body?.email ?? user?.email;

        const firstNameClean = cleanStr(firstNameIn);
        const lastNameClean = cleanStr(lastNameIn);
        const middleNameClean = cleanStr(middleNameIn);
        const phoneClean = cleanStr(phoneIn);
        const emailClean = emailIn ? normalizeEmail(emailIn) : '';

        if (model !== 'accounts') {
            if (!firstNameClean || firstNameClean.length < 2) bodyErrors.push("First Name is required (at least 2 characters).");
            else if (!isValidName(firstNameClean)) bodyErrors.push("First Name contains invalid characters.");
            if (!lastNameClean || lastNameClean.length < 2) bodyErrors.push("Last Name is required (at least 2 characters).");
            else if (!isValidName(lastNameClean)) bodyErrors.push("Last Name contains invalid characters.");
            if (middleNameClean && !isValidName(middleNameClean)) bodyErrors.push("Middle Name contains invalid characters.");
        }
        if (!emailClean) bodyErrors.push("Email is required.");
        else if (!isValidEmail(emailClean)) bodyErrors.push("Invalid email address format.");

        if (model === 'accounts') {
            // accounts model: phone maps to contact_number BigInt string; required to be 11-digit PH 09xxxxxxxxx if provided
            if (phoneClean) {
                if (!isValidPHPhone(phoneClean)) bodyErrors.push("Invalid PH phone number. Use format: 09XX XXX XXXX or +63 9XX XXX XXXX.");
            }
        } else if (model === 'nurses' || model === 'doctors') {
            if (!phoneClean) bodyErrors.push("Phone number is required.");
            else if (!isValidPHPhone(phoneClean)) bodyErrors.push("Invalid PH phone number. Use format: 09XX XXX XXXX or +63 9XX XXX XXXX.");
        }
        if (req.body?.streetAddress !== undefined && cleanStr(req.body.streetAddress).length > 0 && cleanStr(req.body.streetAddress).length < 5) {
            bodyErrors.push("Street Address, if provided, must be at least 5 characters.");
        }
        if (req.body?.city !== undefined && cleanStr(req.body.city) && /\d/.test(cleanStr(req.body.city))) {
            bodyErrors.push("City / Municipality must not contain digits.");
        }
        if (bodyErrors.length > 0) {
            return res.status(400).json({
                message: bodyErrors.join(" | "),
                field: bodyErrors.some((m) => m.includes("Email")) ? "email" : bodyErrors.some((m) => m.includes("Phone")) ? "phone" : bodyErrors.some((m) => m.includes("First")) ? "firstName" : bodyErrors.some((m) => m.includes("Last")) ? "lastName" : undefined
            });
        }
        // If email is being changed, enforce unique across ALL models (admin self-edit + admin → staff edit)
        const currentEmail = user?.email ? normalizeEmail(user.email) : '';
        if (emailClean && emailClean !== currentEmail) {
            const e = emailClean;
            const [existingStaff, existingNurse, existingDoctor, existingAccount, existingPatient] = await Promise.all([
                prisma.staff.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.nurses.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.doctors.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.accounts.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }),
                prisma.patients.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } })
            ]);
            if (existingStaff || existingNurse || existingDoctor || existingAccount || existingPatient) {
                return res.status(400).json({ field: "email", message: `Email "${e}" is already registered.` });
            }
        }

        const updateWhere = model === 'accounts' ? { id: Number(req.params.id) } : { id: req.params.id };

        const hasPasswordUpdate = Boolean(req.body.password);
        const providedCurrentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';

        if (hasPasswordUpdate && !user?.password) {
            return res.status(400).json({ message: "Cannot update password for this account type" });
        }

        // Strict: ANY profile change OR password change OR explicit auth REQUIRES current password
        const hasAnyDataChange = Object.keys(req.body || {}).some(k => !['id', '_id', 'requiresPasswordAuth', 'currentPassword'].includes(k));
        const needsCurrentPassword = Boolean(hasPasswordUpdate || hasAnyDataChange || (typeof req.body.requiresPasswordAuth !== 'undefined' && req.body.requiresPasswordAuth) || providedCurrentPassword);

        if (needsCurrentPassword) {
            if (!providedCurrentPassword) {
                return res.status(400).json({ message: "Current password is required to save profile changes." });
            }
            if (user?.password) {
                let isMatch = false;
                try {
                    if (/^\$2[aby]\$/.test(String(user.password || ''))) {
                        isMatch = await bcrypt.compare(providedCurrentPassword, String(user.password));
                    } else {
                        isMatch = String(providedCurrentPassword) === String(user.password);
                        if (isMatch) {
                            try {
                                const salt = await bcrypt.genSalt(10);
                                await prisma[model].update({ where: updateWhere, data: { password: await bcrypt.hash(String(user.password), salt) } });
                            } catch (_ignore) { /* ignore */ }
                        }
                    }
                } catch (_bcErr) { /* ignore */ }
                if (!isMatch) {
                    return res.status(400).json({ message: "Incorrect current password." });
                }
            }
        }
        if (providedCurrentPassword) {
            delete req.body.currentPassword;
        }

        // If password is being updated (new password), use save() to trigger hashing
        if (req.body.password) {
            // Trim the password to avoid accidental whitespace issues
            const trimmedPassword = req.body.password.trim();
            req.body.password = trimmedPassword;

            const pwErrors = [];
            // Validate password strength (11 chars, special char, number)
            if (trimmedPassword.length < 11) pwErrors.push("11 characters");
            if (!/[^A-Za-z0-9]/.test(trimmedPassword)) pwErrors.push("special character");
            if (!/[0-9]/.test(trimmedPassword)) pwErrors.push("number");
            if (pwErrors.length > 0) {
                 return res.status(400).json({ message: `Password must contain at least: ${pwErrors.join(", ")}.` });
            }
            
            const salt = await bcrypt.genSalt(10);
            req.body.password = await bcrypt.hash(trimmedPassword, salt);
        }

        const { currentPassword, requiresPasswordAuth, _id, id, newPassword, confirmNewPassword, profilePicture, avatarUrl, avatar_url, department, phone, ...restData } = req.body;
        
        let updateData = { ...restData };
        if (emailClean && updateData.email !== undefined) updateData.email = emailClean;
        if (model !== 'accounts') {
            // The API accepts the frontend's camelCase fields, while Prisma uses
            // snake_case columns for staff/nurse/doctor records.
            if (firstNameClean) updateData.first_name = firstNameClean;
            if (lastNameClean) updateData.last_name = lastNameClean;
            delete updateData.firstName;
            delete updateData.lastName;
        } else {
            // Accounts has a single `name` column, not firstName/lastName.
            if (req.body?.firstName !== undefined || req.body?.lastName !== undefined) {
                updateData.name = `${firstNameClean} ${lastNameClean}`.trim() || user.name;
            }
            delete updateData.firstName;
            delete updateData.lastName;
        }
        
        if (model === 'accounts') {
            if (phoneClean) {
                // contact_number is BigInt in prisma schema
                const sanitizedPhone = phoneClean.replace(/\D/g, '');
                updateData.contact_number = sanitizedPhone ? BigInt(sanitizedPhone) : null;
            }
            delete updateData.department;
            delete updateData.phone;
        } else if (model === 'doctors') {
            if (phoneClean) {
                updateData.phone = phoneClean;
            }
            delete updateData.department;
        } else if (model === 'nurses') {
            if (phoneClean) {
                updateData.phone = phoneClean;
            }
            if (department !== undefined) {
                updateData.department = department;
            }
        } else if (model === 'staff') {
            // staff model DOES NOT have phone or department in prisma schema
            delete updateData.phone;
            delete updateData.department;
        }

        const updatedUser = await prisma[model].update({
            where: updateWhere,
            data: updateData
        });
        
        const { password: _password, ...safeUpdatedUser } = updatedUser;
        const resUser = { ...safeUpdatedUser, id: updatedUser.id ? updatedUser.id.toString() : undefined };
        if (resUser.contact_number) resUser.contact_number = resUser.contact_number.toString();
        res.json(resUser);
    } catch (err) {
        console.error("Error in PUT /:id:", err);
        if (err.code === 'P2002') {
            return res.status(400).json({ message: `Duplicate field error: ${err.meta.target.join(', ')}` });
        }
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// DELETE
router.delete('/:id', requireRole(['admin']), async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const result = await findUserById(id);
        if (!result) return res.status(404).json({ message: "User not found" });

        const email = (result.user && result.user.email) ? normalizeEmail(result.user.email) : '';

        if (email) {
            await purgeEmailAcrossModels(email);
        } else {
            const deleteWhere = result.model === 'accounts' ? { id: Number(id) } : { id };
            await prisma[result.model].delete({ where: deleteWhere });
        }

        prisma.activity_logs.create({
            data: {
                actor_name: String(req.headers['x-user-email'] || req.headers['x-user-role'] || 'admin'),
                role: 'Admin',
                action: 'Delete User',
                details: `Deleted ${id}${email ? ` (${email})` : ''}`,
                target: email || id
            }
        }).catch(() => {});

        res.json({ success: true, message: "User has been deleted.", email: email || null });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

router.post('/recovery-email-allowed', async (req, res) => {
    try {
        let { email } = req.body;
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: "Email is required" });
        }

        email = normalizeEmail(email);
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const [staff, nurse, doctor, account] = await Promise.all([
            prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, account_type: true } }),
            prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, account_type: true } }),
            prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, account_type: true } }),
            // `accounts` model does not expose `account_type` in Prisma; use `roles`.
            prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, roles: true } })
        ]);

        const user = staff || nurse || doctor || account;
        if (!user) {
            return res.status(404).json({ allowed: false, message: "Email is not registered" });
        }

        const accountType = normalizeRole(user.account_type || user.roles || 'staff');
        const blockedRoles = new Set(['patient']);
        if (blockedRoles.has(accountType)) {
            return res.status(403).json({ allowed: false, message: "This account type is not authorized for recovery here." });
        }

        return res.json({ allowed: true, accountType: accountType || 'staff' });
    } catch (err) {
        return res.status(500).json({ message: "Server Error" });
    }
});

// FORGOT PASSWORD Route
router.post('/forgot-password', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || '');
        if (!email) return res.status(400).json({ message: "Email is required" });
        
        // Find user in any collection
        const [staff, nurse, doctor, account] = await Promise.all([
            prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
            prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
            prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
            prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
        ]);
        
        const user = staff || nurse || doctor || account;
        let modelType = staff ? 'staff' : (nurse ? 'nurses' : (doctor ? 'doctors' : (account ? 'accounts' : null)));
        
        if (!user) {
            return res.status(404).json({ message: "User with this email does not exist" });
        }
        
        // Generate Token
        const token = crypto.randomBytes(20).toString('hex');
        
        // Return token and user name for Frontend to send email
        res.json({ 
            token, 
            email: user.email, 
            firstName: modelType === 'accounts' ? user.name : user.first_name,
            message: "Token generated (Note: Not saved to DB due to missing schema fields)" 
        });
        
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

// RESET PASSWORD Route
router.post('/reset-password', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || '');
        const newPassword = String(req.body?.newPassword || '').trim();
        
        if (!email || !newPassword) {
            return res.status(400).json({ message: "Email and new password are required" });
        }

        let user = await prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        let modelType = 'staff';
        
        if (!user) {
            user = await prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'nurses';
        }
        if (!user) {
            user = await prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'doctors';
        }
        if (!user) {
            user = await prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'accounts';
        }
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        // Update password in DB
        if (modelType === 'accounts') {
            await prisma.accounts.update({
                where: { id: user.id },
                data: { password: hashedPassword }
            });
        } else {
            await prisma[modelType].update({
                where: { id: user.id },
                data: { 
                    password: hashedPassword,
                    reset_password_token: null,
                    reset_password_expires: null
                }
            });
        }
        
        res.json({ message: "Password updated successfully" });
        
    } catch (err) {
        console.error("Reset password error:", err);
        res.status(500).json({ message: "Server Error" });
    }
});

// BACKGROUND JOB: Auto-offline inactive users
setInterval(async () => {
    try {
        // Mark offline if no heartbeat received in the last 2 minutes
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const models = ['staff', 'nurses', 'doctors'];
        
        for (const model of models) {
            try {
                await prisma.$executeRawUnsafe(
                    `UPDATE ${model} SET status = 'Offline' WHERE status = 'Online' AND (last_active IS NULL OR last_active < $1)`,
                    twoMinutesAgo
                );
            } catch (e) {
                // Ignore schema errors if last_active isn't migrated yet
            }
        }
    } catch (err) {
        console.error("Error in auto-offline job:", err);
    }
}, 60000); // Run every 60 seconds

// FIRST LOGIN CHANGE PASSWORD Route
router.post('/first-login-change-password', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || '');
        const tempPassword = String(req.body?.tempPassword || '').trim();
        const newPassword = String(req.body?.newPassword || '').trim();
        
        if (!email || !tempPassword || !newPassword) {
            return res.status(400).json({ message: "Email, temporary password, and new password are required" });
        }

        // Find user in any collection
        let user = await prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        let modelType = 'staff';
        
        if (!user) {
            user = await prisma.nurses.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'nurses';
        }
        if (!user) {
            user = await prisma.doctors.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'doctors';
        }
        if (!user) {
            user = await prisma.accounts.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
            modelType = 'accounts';
        }
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Check if temporary password matches
        const isMatch = await bcrypt.compare(tempPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid temporary password" });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        // Update password in DB and set must_change_password to false
        const updateData = { 
            password: hashedPassword,
            must_change_password: false
        };

        if (modelType === 'accounts') {
            await prisma.accounts.update({
                where: { id: user.id },
                data: updateData
            });
        } else {
            await prisma[modelType].update({
                where: { id: user.id },
                data: updateData
            });
        }
        
        res.json({ success: true, message: "Password updated successfully. You can now login with your new password." });
        
    } catch (err) {
        console.error("First login change password error:", err);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;

