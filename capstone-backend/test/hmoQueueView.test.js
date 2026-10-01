const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPatientName, buildHmoQueueRows } = require('../utils/hmoQueueView');

test('invoice and clinical-order notes are never displayed as patient names', () => {
  assert.equal(cleanPatientName('Clinical Order #124 • Auto-created from cashier clinical-service payment'), 'Patient name unavailable');
  assert.equal(cleanPatientName('Lab Order #126', 'Kurt Ramos'), 'Kurt Ramos');
});

test('approved HMO coverage calculates only the patient balance', () => {
  const [row] = buildHmoQueueRows([{
    id: 1, invoice_id: 159, patient_id: 'patient-1', registry_patient_name: 'Kurt Ramos',
    total_amount: 100, loa_approved_amount: 100, claim_status: 'Approved', hmo_provider: 'IMS'
  }]);
  assert.equal(row.patient_name, 'Kurt Ramos');
  assert.equal(row.hmo_covered_amount, '100.00');
  assert.equal(row.patient_pays, '0.00');
});

test('pending HMO amounts are not treated as approved coverage', () => {
  const [row] = buildHmoQueueRows([{
    id: 2, invoice_id: 160, registry_patient_name: 'Maria Santos',
    total_amount: 100, loa_approved_amount: 100, claim_status: 'Awaiting LOA'
  }]);
  assert.equal(row.hmo_covered_amount, '0.00');
  assert.equal(row.patient_pays, '100.00');
});
