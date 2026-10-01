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
    configuredUnitPrice: 100,
    patientPayable: 0,
    hmoCoverageApplied: 100,
    hmoIndicators: { hasHmo: true, isHmoPrePaid: true, provider: 'Example HMO', loaNumber: 'LOA-1', status: 'Approved' }
  })).toMatchObject({ paid: true, paidByHmo: true, statusLabel: 'PAID (HMO)' });
});

test('cash-paid orders retain their original patient responsibility', () => {
  expect(getClinicalPaymentStatus({
    status: 'Paid', configuredUnitPrice: 100, patientPayable: 100,
    hmoIndicators: { hasHmo: false, status: '' }
  })).toMatchObject({ statusLabel: 'PAID', patientPayable: 100, paidByHmo: false });
});

test('fully covered unpaid orders are ready for HMO settlement, not cash collection', () => {
  expect(getClinicalPaymentStatus({
    status: 'For Payment', configuredUnitPrice: 100, patientPayable: 0, hmoCoverageApplied: 100,
    hmoIndicators: { hasHmo: true, provider: 'Value Care', loaNumber: 'LOA-1', status: 'Approved' }
  })).toMatchObject({ statusLabel: 'READY (HMO)', requiresHmoSettlement: true, patientPayable: 0 });
});

test('claim status alone cannot turn an ordinary paid order into HMO', () => {
  expect(getClinicalPaymentStatus({
    status: 'Paid', configuredUnitPrice: 100, patientPayable: 100,
    hmoIndicators: { hasHmo: false, status: 'Approved' }
  })).toMatchObject({ statusLabel: 'PAID', hasLinkedCoverage: false, paidByHmo: false });
});
