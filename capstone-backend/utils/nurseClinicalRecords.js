function appendNurseClinicalRecord(current, record) {
  const base = Array.isArray(current)
    ? { legacyRecords: current, vitals_logs: current.filter(row => row?.type === 'Vitals').slice().reverse() }
    : current && typeof current === 'object' ? { ...current } : {};
  const key = record.type === 'Vitals' ? 'vitals_logs' : 'nursing_notes';
  base[key] = [record, ...(Array.isArray(base[key]) ? base[key] : [])];
  return base;
}
module.exports = { appendNurseClinicalRecord };
