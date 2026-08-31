const ALLOWED_NURSE_EVENT_TYPES = new Set(['event', 'shift', 'off']);

function normalizeNurseCalendarMonth(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [year, month] = raw.split('-').map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return raw;
}

function validateNurseCalendarEvent(input = {}) {
  const title = String(input.title || '').trim();
  const date = String(input.date || '').trim();
  const time = String(input.time || '').trim();
  const type = String(input.type || 'event').trim().toLowerCase();
  const errors = [];
  if (!title) errors.push('title is required');
  else if (title.length > 160) errors.push('title is too long (max 160 characters)');
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsedDate = dateMatch ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))) : null;
  const dateIsExact = Boolean(parsedDate) && parsedDate.getUTCFullYear() === Number(dateMatch[1]) && parsedDate.getUTCMonth() + 1 === Number(dateMatch[2]) && parsedDate.getUTCDate() === Number(dateMatch[3]);
  if (!dateIsExact) errors.push('date must be a valid YYYY-MM-DD date');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push('time must use HH:MM format');
  if (!ALLOWED_NURSE_EVENT_TYPES.has(type)) errors.push('type must be event, shift, or off');
  return { ok: errors.length === 0, errors, value: { title, date, time: time || null, type } };
}

module.exports = { ALLOWED_NURSE_EVENT_TYPES, normalizeNurseCalendarMonth, validateNurseCalendarEvent };
