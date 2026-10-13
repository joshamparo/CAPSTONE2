function normalizePhilhealthStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['approved', 'verified and approved', 'verified_and_approved'].includes(status)) return 'Approved';
  if (['rejected', 'denied', 'declined'].includes(status)) return 'Rejected';
  return 'Pending Verification';
}

function summarizePhilhealthClaim(row = {}, totalAmount = 0) {
  const total = Math.max(0, Number(totalAmount || 0));
  const status = normalizePhilhealthStatus(row.philhealth_status);
  const approvedAmount = Math.min(total, Math.max(0, Number(row.philhealth_deduction || 0)));
  const referenceNumber = String(row.philhealth_reference || '').trim();
  const isApproved = status === 'Approved' && Boolean(referenceNumber) && approvedAmount > 0;

  return {
    status,
    reference_number: referenceNumber,
    approved_amount: approvedAmount,
    applied_amount: isApproved ? approvedAmount : 0,
    verified_by: row.philhealth_verified_by || null,
    verified_at: row.philhealth_verified_at || null,
    is_approved: isApproved
  };
}

module.exports = { normalizePhilhealthStatus, summarizePhilhealthClaim };
