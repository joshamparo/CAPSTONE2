const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIncident } = require('../utils/incidentValidation');

const valid = {
  incident_date: '2026-09-01', incident_time: '14:30', incident_type: 'Fall', severity: 'Moderate',
  location: 'ER Bay 2', description: 'Patient slipped beside the bed.', action_taken: 'Assessed patient and notified the physician.', follow_up_status: 'For Review'
};

test('incident validation accepts and normalizes a complete report', () => {
  const result = validateIncident(valid);
  assert.equal(result.error, undefined);
  assert.equal(result.value.location, 'ER Bay 2');
});

test('incident validation rejects incomplete or invalid reports', () => {
  assert.match(validateIncident({ ...valid, description: 'short' }).error, /description/i);
  assert.match(validateIncident({ ...valid, incident_time: '29:99' }).error, /time/i);
  assert.match(validateIncident({ ...valid, severity: 'Extreme' }).error, /severity/i);
});

test('incident validation accepts every Nurse dashboard incident category', () => {
  for (const incidentType of ['Fall', 'Medication', 'Equipment', 'Harassment', 'Other']) {
    assert.equal(validateIncident({ ...valid, incident_type: incidentType }).error, undefined);
  }
});
