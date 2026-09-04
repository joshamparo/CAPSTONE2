const prisma = require('./prisma');

const ALLOWED_SETTING_KEYS = new Set(['maintenanceMode', 'departments', 'opsSettings', 'roles']);
const ALLOWED_ROLE_NAMES = new Set(['Admin', 'Doctor', 'Nurse', 'Staff']);
const ALLOWED_PERMISSIONS = new Set([
  'all', 'manage_staff', 'view_patients', 'manage_patients', 'write_notes', 'manage_inventory'
]);
const MAX_DEPARTMENTS = 50;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateSystemSettingsPatch(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw validationError('System settings must be a JSON object.');
  }
  const keys = Object.keys(partial);
  if (!keys.length) throw validationError('Provide at least one system setting to update.');
  const unknown = keys.filter((key) => !ALLOWED_SETTING_KEYS.has(key));
  if (unknown.length) throw validationError(`Unsupported system setting: ${unknown.join(', ')}.`);

  const clean = {};
  if (Object.prototype.hasOwnProperty.call(partial, 'maintenanceMode')) {
    if (typeof partial.maintenanceMode !== 'boolean') throw validationError('maintenanceMode must be a boolean.');
    clean.maintenanceMode = partial.maintenanceMode;
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'departments')) {
    if (!Array.isArray(partial.departments) || partial.departments.length > MAX_DEPARTMENTS) {
      throw validationError(`departments must contain no more than ${MAX_DEPARTMENTS} entries.`);
    }
    const departments = partial.departments.map((value) => String(value || '').trim());
    if (departments.some((value) => value.length < 2 || value.length > 80 || /[<>\u0000-\u001f]/.test(value))) {
      throw validationError('Each department must be 2-80 plain-text characters.');
    }
    clean.departments = [...new Set(departments.map((value) => value.replace(/\s+/g, ' ')))];
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'opsSettings')) {
    const ops = partial.opsSettings;
    if (!ops || typeof ops !== 'object' || Array.isArray(ops)) throw validationError('opsSettings must be an object.');
    const unknownOps = Object.keys(ops).filter((key) => !['incidentOverdueHours', 'lowStockThreshold'].includes(key));
    if (unknownOps.length) throw validationError(`Unsupported operational setting: ${unknownOps.join(', ')}.`);
    const incidentOverdueHours = Number(ops.incidentOverdueHours);
    const lowStockThreshold = Number(ops.lowStockThreshold);
    if (!Number.isInteger(incidentOverdueHours) || incidentOverdueHours < 1 || incidentOverdueHours > 720) {
      throw validationError('incidentOverdueHours must be an integer from 1 to 720.');
    }
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 1000000) {
      throw validationError('lowStockThreshold must be an integer from 0 to 1000000.');
    }
    clean.opsSettings = { incidentOverdueHours, lowStockThreshold };
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'roles')) {
    if (!Array.isArray(partial.roles) || partial.roles.length !== ALLOWED_ROLE_NAMES.size) {
      throw validationError('roles must contain exactly Admin, Doctor, Nurse, and Staff.');
    }
    const seen = new Set();
    clean.roles = partial.roles.map((role) => {
      const name = String(role?.name || '').trim();
      if (!ALLOWED_ROLE_NAMES.has(name) || seen.has(name)) throw validationError('Role names must be unique supported roles.');
      seen.add(name);
      if (!Array.isArray(role?.permissions)) throw validationError(`Permissions for ${name} must be an array.`);
      const permissions = [...new Set(role.permissions.map((value) => String(value || '').trim()))];
      if (permissions.some((permission) => !ALLOWED_PERMISSIONS.has(permission))) {
        throw validationError(`Unsupported permission configured for ${name}.`);
      }
      if (name === 'Admin' && (permissions.length !== 1 || permissions[0] !== 'all')) {
        throw validationError('The Admin role must retain full access.');
      }
      if (name !== 'Admin' && permissions.includes('all')) throw validationError('Only Admin may have full access.');
      return { name, permissions };
    });
  }
  return clean;
}

const DEFAULT_SYSTEM_SETTINGS = {
  maintenanceMode: false,
  departments: ['General Administration', 'Cardiology', 'Pediatrics', 'Emergency', 'Surgery'],
  opsSettings: {
    incidentOverdueHours: 24,
    lowStockThreshold: 5
  },
  roles: [
    { name: 'Admin', permissions: ['all'] },
    { name: 'Doctor', permissions: ['view_patients', 'write_notes'] },
    { name: 'Nurse', permissions: ['view_patients'] },
    { name: 'Staff', permissions: [] }
  ]
};

let cache = null;
let cacheExpiresAt = 0;

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SETTINGS));
}

async function ensureSystemSettingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.system_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readRows() {
  await ensureSystemSettingsTable();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT key, value, updated_at
    FROM public.system_settings
  `);
  return Array.isArray(rows) ? rows : [];
}

function mergeRowsIntoSettings(rows) {
  const settings = cloneDefaults();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row?.key || '').trim();
    const value = row?.value;
    if (!key) return;
    if (key === 'maintenanceMode') {
      settings.maintenanceMode = Boolean(value);
      return;
    }
    if (key === 'departments' && Array.isArray(value)) {
      settings.departments = value.map((item) => String(item || '').trim()).filter(Boolean);
      return;
    }
    if (key === 'opsSettings' && value && typeof value === 'object') {
      const incidentOverdueHours = Number(value.incidentOverdueHours);
      const lowStockThreshold = Number(value.lowStockThreshold);
      settings.opsSettings = {
        incidentOverdueHours: Number.isFinite(incidentOverdueHours) && incidentOverdueHours > 0 ? incidentOverdueHours : settings.opsSettings.incidentOverdueHours,
        lowStockThreshold: Number.isFinite(lowStockThreshold) && lowStockThreshold >= 0 ? lowStockThreshold : settings.opsSettings.lowStockThreshold
      };
      return;
    }
    if (key === 'roles' && Array.isArray(value)) {
      settings.roles = value
        .map((role) => ({
          name: String(role?.name || '').trim(),
          permissions: Array.isArray(role?.permissions)
            ? role.permissions.map((perm) => String(perm || '').trim()).filter(Boolean)
            : []
        }))
        .filter((role) => role.name);
    }
  });
  return settings;
}

async function seedMissingSettings() {
  const rows = await readRows();
  const existingKeys = new Set(rows.map((row) => String(row?.key || '').trim()).filter(Boolean));
  const defaults = cloneDefaults();

  for (const [key, value] of Object.entries(defaults)) {
    if (existingKeys.has(key)) continue;
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO public.system_settings (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
      `,
      key,
      JSON.stringify(value)
    );
  }
}

async function getSystemSettings(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && cache && cacheExpiresAt > now) {
    return clone(cache);
  }

  await seedMissingSettings();
  const rows = await readRows();
  const settings = mergeRowsIntoSettings(rows);
  cache = settings;
  cacheExpiresAt = now + 10000;
  return clone(settings);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveSystemSettings(partial = {}) {
  const validated = validateSystemSettingsPatch(partial);
  await ensureSystemSettingsTable();
  const current = await getSystemSettings({ force: true });
  const next = {
    maintenanceMode: Object.prototype.hasOwnProperty.call(validated, 'maintenanceMode')
      ? validated.maintenanceMode
      : current.maintenanceMode,
    departments: Array.isArray(validated.departments)
      ? validated.departments
      : current.departments,
    opsSettings: validated.opsSettings
      ? validated.opsSettings
      : current.opsSettings,
    roles: Array.isArray(validated.roles)
      ? validated.roles
      : current.roles
  };

  for (const [key, value] of Object.entries(next)) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO public.system_settings (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      key,
      JSON.stringify(value)
    );
  }

  cache = next;
  cacheExpiresAt = Date.now() + 10000;
  return clone(next);
}

async function isMaintenanceModeEnabled() {
  const settings = await getSystemSettings();
  return Boolean(settings.maintenanceMode);
}

module.exports = {
  DEFAULT_SYSTEM_SETTINGS,
  getSystemSettings,
  saveSystemSettings,
  isMaintenanceModeEnabled,
  validateSystemSettingsPatch
};
