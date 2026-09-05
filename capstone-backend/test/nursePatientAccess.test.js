const test = require('node:test');
const assert = require('node:assert/strict');
const { nursePatientScope } = require('../utils/nursePatientAccess');

test('core nurse departments produce restrictive patient scopes', () => {
  assert.ok(nursePatientScope('ER').OR);
  assert.equal(nursePatientScope('OPD').admission_status.equals, 'Outpatient');
  assert.ok(nursePatientScope('PEDIA', new Date('2026-09-05T00:00:00Z')).OR);
  assert.ok(nursePatientScope('MEDICINE').OR);
});

test('clinical nurse departments scope patients through assigned orders', () => {
  assert.equal(nursePatientScope('LABORATORY').clinical_orders.some.assigned_role, 'medtech');
  assert.equal(nursePatientScope('PHYSICAL THERAPY').clinical_orders.some.assigned_role, 'physical_therapist');
});

test('unknown nurse departments fail closed', () => {
  assert.equal(nursePatientScope('unknown').id, '__no_department_patient_match__');
  assert.equal(nursePatientScope('').id, '__no_department_patient_match__');
});
