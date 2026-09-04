const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSystemSettingsPatch } = require('../utils/systemSettingsStore');

test('system settings accept bounded supported values', () => {
  assert.deepEqual(validateSystemSettingsPatch({
    maintenanceMode: true,
    opsSettings: { incidentOverdueHours: 24, lowStockThreshold: 5 }
  }), {
    maintenanceMode: true,
    opsSettings: { incidentOverdueHours: 24, lowStockThreshold: 5 }
  });
});

test('system settings reject unknown keys and invalid numeric limits', () => {
  assert.throws(() => validateSystemSettingsPatch({ secret: true }), /Unsupported system setting/);
  assert.throws(() => validateSystemSettingsPatch({
    opsSettings: { incidentOverdueHours: 0, lowStockThreshold: 5 }
  }), /incidentOverdueHours/);
});

test('system settings preserve the protected Admin policy', () => {
  const roles = [
    { name: 'Admin', permissions: [] },
    { name: 'Doctor', permissions: ['view_patients'] },
    { name: 'Nurse', permissions: ['view_patients'] },
    { name: 'Staff', permissions: [] }
  ];
  assert.throws(() => validateSystemSettingsPatch({ roles }), /Admin role must retain full access/);
  roles[0].permissions = ['all'];
  roles[3].permissions = ['all'];
  assert.throws(() => validateSystemSettingsPatch({ roles }), /Only Admin/);
});

test('department settings are normalized and reject markup/control characters', () => {
  assert.deepEqual(validateSystemSettingsPatch({ departments: [' Emergency ', 'Emergency'] }), {
    departments: ['Emergency']
  });
  assert.throws(() => validateSystemSettingsPatch({ departments: ['<script>'] }), /plain-text/);
});
