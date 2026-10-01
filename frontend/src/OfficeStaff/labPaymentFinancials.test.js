import { getLabPaymentFinancials } from './labPaymentFinancials';

test('an already-paid order can never be collected again', () => {
  expect(getLabPaymentFinancials({ status: 'Paid', configuredUnitPrice: 100, patientPayable: 100 }))
    .toMatchObject({ paid: true, gross: 100, due: 0 });
});

test('full approved HMO coverage leaves no patient balance', () => {
  expect(getLabPaymentFinancials({ status: 'For Payment', configuredUnitPrice: 100, patientPayable: 0, hmoCoverageApplied: 100 }))
    .toMatchObject({ paid: false, gross: 100, due: 0 });
});

test('partial HMO coverage collects only the patient copay without a second deduction', () => {
  expect(getLabPaymentFinancials({ status: 'For Payment', configuredUnitPrice: 100, patientPayable: 40, hmoCoverageApplied: 60 }))
    .toMatchObject({ paid: false, gross: 100, due: 40 });
});
