const FIELD_LABELS = {
  name: 'name',
  first_name: 'first name',
  last_name: 'last name',
  email: 'email address',
  phone: 'phone number',
  contact_number: 'contact number',
  department: 'department',
  specialization: 'specialization',
  status: 'account status'
};

const ACTION_LABELS = {
  'Update Staff': 'Update Staff Account',
  'Create Staff': 'Create Staff Account',
  'Delete Staff': 'Delete Staff Account',
  'Deactivate Staff': 'Deactivate Staff Account',
  'Reactivate Staff': 'Reactivate Staff Account'
};

function parseStructuredDetails(value) {
  const raw = String(value || '').trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function friendlyList(values) {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function displayName(record, fallback) {
  const fullName = [record?.first_name, record?.last_name].filter(Boolean).join(' ').trim();
  return fullName || String(record?.name || '').trim() || String(fallback || '').trim();
}

function staffUpdateDescription(structured, target) {
  const before = structured?.before && typeof structured.before === 'object' ? structured.before : {};
  const after = structured?.after && typeof structured.after === 'object' ? structured.after : {};
  const changed = Object.keys({ ...before, ...after })
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => FIELD_LABELS[key] || key.replace(/_/g, ' '));
  const person = displayName(after, displayName(before, target));
  const subject = person && !person.includes('@') ? ` for ${person}` : '';
  return changed.length
    ? `Updated ${friendlyList(changed)}${subject}.`
    : `Reviewed the staff account${subject}.`;
}

export function formatActivityLog(log = {}) {
  const rawAction = String(log.action || '').trim();
  const rawDetails = String(log.details || '').trim();
  const structured = parseStructuredDetails(rawDetails);
  let details = rawDetails || 'No additional details.';

  if (rawAction === 'Update Staff' && structured) {
    details = staffUpdateDescription(structured, log.target);
  } else if (structured) {
    details = 'Structured activity details were recorded securely.';
  }

  return {
    ...log,
    rawAction,
    rawDetails,
    action: ACTION_LABELS[rawAction] || rawAction || 'System activity',
    details
  };
}

export default formatActivityLog;
