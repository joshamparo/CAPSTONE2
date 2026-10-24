'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveClinicalServiceRouting } = require('../utils/clinicalServiceCatalog');

test('supported clinical services route to their receiving departments', () => {
  assert.equal(resolveClinicalServiceRouting({ kind: 'Laboratory', service: 'Complete Blood Count (CBC)' }), 'medtech');
  assert.equal(resolveClinicalServiceRouting({ kind: 'Laboratory', service: 'Urinalysis' }), 'medtech');
  assert.equal(resolveClinicalServiceRouting({ kind: 'Imaging', service: 'Chest X-Ray' }), 'radiographer');
  assert.equal(resolveClinicalServiceRouting({ kind: 'ECG', service: 'Standard 12-Lead ECG' }), 'ecg_operator');
  assert.equal(resolveClinicalServiceRouting({ kind: 'Procedure', service: 'Wound care' }), 'nurse');
  assert.equal(resolveClinicalServiceRouting({ kind: 'Physical Therapy', service: 'Mobility assessment' }), 'physical_therapist');
});

test('catalog service controls routing even when the supplied kind is stale', () => {
  assert.equal(resolveClinicalServiceRouting({ kind: 'Laboratory', service: 'Chest X-Ray' }), 'radiographer');
  assert.equal(resolveClinicalServiceRouting({ kind: 'Imaging', service: 'CBC' }), 'medtech');
});
