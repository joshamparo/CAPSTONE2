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
  const paidByHmo = paid && hasLinkedCoverage && Boolean(indicators.isHmoPrePaid);

  return {
    paid,
    paidByHmo,
    statusLabel: paidByHmo ? 'PAID (HMO)' : (paid ? 'PAID' : String(order?.status || 'For Payment')),
    amountLabel: paidByHmo ? '₱ 0.00 (covered by HMO)' : null
  };
};
