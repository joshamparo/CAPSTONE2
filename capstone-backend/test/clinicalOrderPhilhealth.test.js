const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../routes/clinicalOrders');

const { enrichClinicalOrder } = router.__test;

test('new PhilHealth patient remains pending without being mislabeled as HMO', () => {
  const order = enrichClinicalOrder({
    id: '132', kind: 'Laboratory', service: 'Urinalysis', status: 'For Payment',
    linkedInvoiceId: '500', linkedInvoiceTotal: 100, hasPhilhealth: true
  });
  assert.equal(order.philhealthIndicators.hasPhilhealth, true);
  assert.equal(order.philhealthIndicators.status, 'Pending Verification');
  assert.equal(order.philhealthApplied, 0);
  assert.equal(order.hmoIndicators.hasHmo, false);
  assert.equal(order.patientPayable, 100);
});

test('verified PhilHealth benefit reduces a clinical order without creating HMO coverage', () => {
  const order = enrichClinicalOrder({
    id: '133', kind: 'Laboratory', service: 'Urinalysis', status: 'For Payment',
    linkedInvoiceId: '501', linkedInvoiceTotal: 100, hasPhilhealth: true,
    linkedHmoClaim: {
      philhealth_status: 'Approved', philhealth_reference: 'PH-501', philhealth_deduction: 60,
      status: 'Pending'
    }
  });
  assert.equal(order.philhealthApplied, 60);
  assert.equal(order.patientPayable, 40);
  assert.equal(order.hmoIndicators.hasHmo, false);
});
