import { hasActiveHmoCoverage, normalizeHmoDisplayStatus } from './hmoWorkflow';

test('shows the real HMO status on handoff documents', () => {
  expect(normalizeHmoDisplayStatus({ status: 'awaiting_loa' })).toBe('Awaiting LOA');
  expect(normalizeHmoDisplayStatus({ status: 'rejected' })).toBe('Rejected');
  expect(normalizeHmoDisplayStatus({ status: 'approved' })).toBe('Approved');
});

test('rejected HMO does not hide the normal queue ticket', () => {
  expect(hasActiveHmoCoverage({ status: 'Rejected', provider: 'Sample HMO', card_number: '123' })).toBe(false);
  expect(hasActiveHmoCoverage({ status: 'Approved', provider: 'Sample HMO', card_number: '123' })).toBe(true);
});
