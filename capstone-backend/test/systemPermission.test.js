const test = require('node:test');
const assert = require('node:assert/strict');
const { hasSystemPermission } = require('../utils/systemSettingsStore');

const settings = {
  roles: [
    { name: 'Admin', permissions: ['all'] },
    { name: 'Doctor', permissions: ['view_patients', 'write_notes'] },
    { name: 'Nurse', permissions: [] },
    { name: 'Staff', permissions: ['manage_inventory'] }
  ]
};

test('admin retains every configurable permission', () => {
  assert.equal(hasSystemPermission(settings, 'admin', 'manage_staff'), true);
});

test('saved role permissions allow and deny protected capabilities', () => {
  assert.equal(hasSystemPermission(settings, 'doctor', 'write_notes'), true);
  assert.equal(hasSystemPermission(settings, 'nurse', 'manage_patients'), false);
  assert.equal(hasSystemPermission(settings, 'staff', 'manage_inventory'), true);
});

test('legacy view_patients enables Patient Management', () => {
  assert.equal(hasSystemPermission(settings, 'doctor', 'manage_patients'), true);
});
