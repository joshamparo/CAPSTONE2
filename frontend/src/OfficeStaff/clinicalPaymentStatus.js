export const getClinicalPaymentStatus = (order = {}) => {
  const paid = String(order?.status || '').trim().toLowerCase() === 'paid';
  const indicators = order?.hmoIndicators && typeof order.hmoIndicators === 'object'
    ? order.hmoIndicators
    : {};
  const philhealth = Math.max(0, Number(order?.philhealthApplied || 0));
  const hmoCoverage = Math.max(0, Number(order?.hmoCoverageApplied || 0));
  const hasLinkedCoverage = Boolean(
    indicators.hasHmo && (
      indicators.provider || indicators.loaNumber || indicators.cardNumber ||
      philhealth > 0 || hmoCoverage > 0
    )
  );
  const claimStatus = String(indicators.status || '').trim().toLowerCase();
  const coverageApproved = ['approved', 'partially approved', 'paid'].includes(claimStatus);
  const gross = Math.max(0, Number(order?.configuredUnitPrice ?? order?.originalTotal ?? order?.unitPrice ?? order?.amountDue ?? 0));
  const patientPayableRaw = Number(order?.patientPayable);
  const patientPayable = Number.isFinite(patientPayableRaw)
    ? Math.max(0, patientPayableRaw)
    : Math.max(0, gross - philhealth - hmoCoverage);
  const hasAppliedCoverage = hasLinkedCoverage && coverageApproved && (philhealth > 0 || hmoCoverage > 0);
  const fullyCovered = hasAppliedCoverage && patientPayable <= 0.0099;
  const paidByHmo = paid && hasAppliedCoverage && Boolean(indicators.isHmoPrePaid);
  const paidWithCopay = paidByHmo && patientPayable > 0.0099;
  const requiresHmoSettlement = !paid && fullyCovered;

  return {
    paid,
    paidByHmo,
    paidWithCopay,
    hasLinkedCoverage,
    coverageApproved,
    fullyCovered,
    requiresHmoSettlement,
    patientPayable,
    statusLabel: paidWithCopay
      ? 'PAID (HMO + PATIENT)'
      : paidByHmo
        ? 'PAID (HMO)'
        : requiresHmoSettlement
          ? 'READY (HMO)'
          : (paid ? 'PAID' : String(order?.status || 'For Payment')),
    amountLabel: fullyCovered ? '₱ 0.00 (covered by HMO)' : null
  };
};
