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
  'Login': 'Sign In',
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

function parseTrailingStructuredDetails(value) {
  const raw = String(value || '').trim();
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) return null;
  return parseStructuredDetails(raw.slice(Math.min(...starts)));
}

function formatReportDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pharmacySalesDescription(structured) {
  const from = formatReportDate(structured?.from);
  const to = formatReportDate(structured?.to);
  const summary = structured?.summary && typeof structured.summary === 'object' ? structured.summary : {};
  const transactionCount = Number(summary.transaction_count);
  const revenue = Number(summary.revenue);
  const range = from && to ? (from === to ? from : `${from} to ${to}`) : from || to;
  const metrics = [];
  if (Number.isFinite(transactionCount)) {
    metrics.push(`${transactionCount} ${transactionCount === 1 ? 'transaction' : 'transactions'}`);
  }
  if (Number.isFinite(revenue)) {
    metrics.push(`${revenue.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })} revenue`);
  }
  if (range && metrics.length) return `Sales report for ${range}: ${friendlyList(metrics)}.`;
  if (range) return `Sales report for ${range}.`;
  if (metrics.length) return `Sales report submitted with ${friendlyList(metrics)}.`;
  return 'Pharmacy sales report submitted to the administrator.';
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
  const trailingStructured = structured || parseTrailingStructuredDetails(rawDetails);
  const target = String(log.target || '').trim().toLowerCase();
  let details = rawDetails || 'No additional details.';
  let action = ACTION_LABELS[rawAction] || rawAction || 'System activity';

  if (rawAction === 'Update Staff' && structured) {
    details = staffUpdateDescription(structured, log.target);
  } else if (target === 'salesreport' && trailingStructured) {
    action = 'Submit Pharmacy Sales Report';
    details = pharmacySalesDescription(trailingStructured);
  } else if (structured) {
    details = 'Structured activity details were recorded securely.';
  } else if (rawAction === 'Login' && /logged in with otp/i.test(rawDetails)) {
    details = 'Signed in using a one-time password.';
  }

  return {
    ...log,
    rawAction,
    rawDetails,
    action,
    details
  };
}

export default formatActivityLog;
