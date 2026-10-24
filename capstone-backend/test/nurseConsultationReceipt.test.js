'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'Nurse', 'NurseDashboard.js'),
  'utf8'
);

test('consultation receipt preserves the requested clinic schedule', () => {
  assert.match(source, /scheduledDate: String\(response\?\.routing\?\.scheduledDate/);
  assert.match(source, /scheduledTime: String\(response\?\.routing\?\.scheduledDate/);
  assert.match(source, /formatClinicAppointmentSchedule\(walkInNextSteps\?\.scheduledDate, walkInNextSteps\?\.scheduledTime\)/);
  assert.match(source, /Requested Appointment/);
});

test('consultation receipt waits for secretary approval before cashier guidance', () => {
  assert.match(source, /Pending Doctor Secretary Approval/);
  assert.match(source, /WAIT FOR APPOINTMENT CONFIRMATION/);
  assert.match(source, /before any payment or clinic visit/);
  assert.match(source, /!isConsultation && walkInNextSteps\?\.invoiceId/);
});

test('receipt distinguishes registration time from appointment time', () => {
  assert.match(source, /Registered At:/);
  assert.doesNotMatch(source, /<b>Date \/ Time:<\/b>/);
});
