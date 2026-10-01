export function getLabPaymentFinancials(order = {}, hmoClaim = null) {
  const paid = String(order?.status || '').trim().toLowerCase() === 'paid';
  const gross = Number(order?.configuredUnitPrice ?? order?.originalTotal ?? order?.unitPrice ?? order?.amountDue ?? 0);
  const backendPayable = Number(order?.patientPayable);
  const hmo = Number(hmoClaim?.applied_hmo_amount || hmoClaim?.loa_approved_amount || order?.hmoCoverageApplied || 0);
  const philhealth = Number(hmoClaim?.philhealth_deduction || order?.philhealthApplied || 0);
  const calculatedDue = Number.isFinite(backendPayable)
    ? Math.max(0, backendPayable)
    : Math.max(0, gross - hmo - philhealth);

  return {
    paid,
    gross: Number.isFinite(gross) ? gross : 0,
    due: paid ? 0 : (Number.isFinite(calculatedDue) ? calculatedDue : 0)
  };
}
