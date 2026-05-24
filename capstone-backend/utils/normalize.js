function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function parseLimit(value, { min = 1, max = 500, fallback = 200 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseOffset(value, { min = 0, max = 5000, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

module.exports = {
  normalizeEmail,
  normalizeRole,
  parseLimit,
  parseOffset,
  parseDate
};

