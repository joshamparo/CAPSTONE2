const test = require('node:test');
const assert = require('node:assert/strict');
const { appendNurseClinicalRecord } = require('../utils/nurseClinicalRecords');
test('recording vitals preserves ER routing, intake, and earlier observations', () => {
  const previous = { walkInIntakes: [{ type: 'lab' }], erRegistration: { triage: { level: 2 } }, vitals_logs: [{ id: 'old' }], extra: { important: true } };
  const record = { id: 'new', type: 'Vitals', heartRate: 80 };
  const next = appendNurseClinicalRecord(previous, record);
  assert.deepEqual(next.walkInIntakes, previous.walkInIntakes);
  assert.deepEqual(next.erRegistration, previous.erRegistration);
  assert.deepEqual(next.extra, previous.extra);
  assert.deepEqual(next.vitals_logs, [record, { id: 'old' }]);
  assert.equal(previous.vitals_logs.length, 1);
});
test('legacy clinical arrays are retained when adding a new nursing note', () => {
  const legacy = [{ id: 'v1', type: 'Vitals' }, { id: 'n1', type: 'Note' }];
  const next = appendNurseClinicalRecord(legacy, { id: 'n2', type: 'Note' });
  assert.deepEqual(next.legacyRecords, legacy);
  assert.deepEqual(next.vitals_logs, [legacy[0]]);
  assert.deepEqual(next.nursing_notes, [{ id: 'n2', type: 'Note' }]);
});
