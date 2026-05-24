const prisma = require('./prisma');

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
  await ensureSystemSettingsTable();
  const current = await getSystemSettings({ force: true });
  const next = {
    maintenanceMode: Object.prototype.hasOwnProperty.call(partial, 'maintenanceMode')
      ? Boolean(partial.maintenanceMode)
      : current.maintenanceMode,
    departments: Array.isArray(partial.departments)
      ? partial.departments.map((item) => String(item || '').trim()).filter(Boolean)
      : current.departments,
    opsSettings: partial.opsSettings && typeof partial.opsSettings === 'object'
      ? {
          incidentOverdueHours: Math.max(1, Number(partial.opsSettings.incidentOverdueHours) || current.opsSettings.incidentOverdueHours),
          lowStockThreshold: Math.max(0, Number(partial.opsSettings.lowStockThreshold) || current.opsSettings.lowStockThreshold)
        }
      : current.opsSettings,
    roles: Array.isArray(partial.roles)
      ? partial.roles
          .map((role) => ({
            name: String(role?.name || '').trim(),
            permissions: Array.isArray(role?.permissions)
              ? role.permissions.map((perm) => String(perm || '').trim()).filter(Boolean)
              : []
          }))
          .filter((role) => role.name)
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
  isMaintenanceModeEnabled
};
