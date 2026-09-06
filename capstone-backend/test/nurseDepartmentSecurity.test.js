const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNurseDepartment, resolveNurseDepartmentScope } = require('../middleware/requireNurseDepartment');

test('nurse department aliases normalize to stable scopes', () => {
  assert.equal(normalizeNurseDepartment('Emergency Room'), 'ER');
  assert.equal(normalizeNurseDepartment('Emergency Nursing'), 'ER');
  assert.equal(normalizeNurseDepartment('ER Nursing'), 'ER');
  assert.equal(normalizeNurseDepartment('Pediatrics'), 'PEDIA');
  assert.equal(normalizeNurseDepartment('Outpatient Dept'), 'OPD');
  assert.equal(normalizeNurseDepartment('Video Consultation'), 'VIDEO CONSULTATION');
  assert.equal(normalizeNurseDepartment('Physical Therapy'), 'PHYSICAL THERAPY');
  assert.equal(normalizeNurseDepartment('Otolaryngology (ENT)'), 'OTOLARYNGOLOGY (ENT)');
});

test('empty nurse department does not silently become a default scope', () => {
  assert.equal(normalizeNurseDepartment(''), '');
  assert.equal(normalizeNurseDepartment(null), '');
});

test('an explicit reception fallback is used only when the stored department is empty', () => {
  assert.equal(resolveNurseDepartmentScope('', 'ER'), 'ER');
  assert.equal(resolveNurseDepartmentScope('Pediatrics', 'ER'), 'PEDIA');
  assert.equal(resolveNurseDepartmentScope('', ''), '');
});
