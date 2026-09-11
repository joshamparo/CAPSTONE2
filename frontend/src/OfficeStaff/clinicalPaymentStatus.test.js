import { getClinicalPaymentStatus } from './clinicalPaymentStatus';

test('cash-paid mobile clinical order is not labeled as HMO', () => {
  expect(getClinicalPaymentStatus({
    status: 'Paid',
    hmoIndicators: { hasHmo: false, isHmoPrePaid: false }
  })).toMatchObject({ paid: true, paidByHmo: false, statusLabel: 'PAID', amountLabel: null });
});

test('only an explicitly linked HMO claim receives the HMO label', () => {
  expect(getClinicalPaymentStatus({
    status: 'Paid',
    hmoCoverageApplied: 100,
    hmoIndicators: { hasHmo: true, isHmoPrePaid: true, provider: 'Example HMO', loaNumber: 'LOA-1' }
  })).toMatchObject({ paid: true, paidByHmo: true, statusLabel: 'PAID (HMO)' });
});
