export function normalizeHmoDisplayStatus(hmo) {
  const raw = String(hmo?.status || '').trim().toLowerCase().replace(/_/g, ' ');
  if (raw === 'approved') return 'Approved';
  if (raw === 'awaiting loa') return 'Awaiting LOA';
  if (raw === 'rejected') return 'Rejected';
  if (raw === 'philhealth only') return 'PhilHealth Only';
  return raw ? String(hmo.status).trim() : 'Pending';
}

export function hasActiveHmoCoverage(hmo) {
  if (!hmo || typeof hmo !== 'object') return false;
  const status = normalizeHmoDisplayStatus(hmo);
  if (status === 'Rejected' || status === 'PhilHealth Only') return false;
  return Boolean(
    String(hmo.provider || hmo.hmo_provider || '').trim() ||
    String(hmo.card_number || hmo.hmo_card_number || '').trim() ||
    String(hmo.loa_number || hmo.hmo_loa_number || hmo.loaNumber || '').trim()
  );
}
