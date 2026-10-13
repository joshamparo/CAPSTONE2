const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizePhilhealthClaim } = require('../utils/philhealthClaim');

test('pending PhilHealth amount is not deducted', () => {
  const claim = summarizePhilhealthClaim({
    philhealth_status: 'Pending Verification',
    philhealth_reference: 'PH-001',
    philhealth_deduction: 500
  }, 1000);
  assert.equal(claim.applied_amount, 0);
});

test('approved PhilHealth requires a reference before deduction applies', () => {
  assert.equal(summarizePhilhealthClaim({ philhealth_status: 'Approved', philhealth_deduction: 500 }, 1000).applied_amount, 0);
  assert.equal(summarizePhilhealthClaim({
    philhealth_status: 'Approved', philhealth_reference: 'PH-001', philhealth_deduction: 500
  }, 1000).applied_amount, 500);
});

test('approved PhilHealth amount cannot exceed the invoice total', () => {
  const claim = summarizePhilhealthClaim({
    philhealth_status: 'Approved', philhealth_reference: 'PH-002', philhealth_deduction: 1500
  }, 1000);
  assert.equal(claim.applied_amount, 1000);
});
