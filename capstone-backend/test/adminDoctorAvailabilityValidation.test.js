'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dashboard = fs.readFileSync(path.join(root, 'frontend', 'src', 'Admin', 'AdminDashboard.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'capstone-backend', 'routes', 'doctorAvailability.js'), 'utf8');
const addRule = dashboard.slice(
  dashboard.indexOf('const addDoctorAvailabilityRule'),
  dashboard.indexOf('const removeDoctorAvailabilityRule')
);

test('admin weekly clinic hours rejects missing and reversed times', () => {
  assert.match(addRule, /if \(!s \|\| !e\)/);
  assert.match(addRule, /Start and end times are required\./);
  assert.match(addRule, /eMin <= sMin/);
  assert.match(addRule, /End time must be after start time\./);
  assert.doesNotMatch(addRule, /\|\| '09:00'|\|\| '17:00'/);
});

test('weekly-rule validation is displayed beside the fields', () => {
  assert.match(dashboard, /doctorAvailRuleError \? \([\s\S]*<div role="alert"[\s\S]*{doctorAvailRuleError}/);
  assert.match(addRule, /setDoctorAvailRuleError\('End time must be after start time\.'\)/);
});

test('admin weekly clinic hours rejects invalid slot and capacity values without clamping', () => {
  assert.match(addRule, /!Number\.isInteger\(slotMinutes\)[\s\S]*slotMinutes < 5[\s\S]*slotMinutes > 180/);
  assert.match(addRule, /!Number\.isInteger\(maxPerSlot\)[\s\S]*maxPerSlot < 1[\s\S]*maxPerSlot > 20/);
  assert.match(addRule, /Slot Minutes must be a whole number from 5 to 180\./);
  assert.match(addRule, /Max Patients \/ Slot must be a whole number from 1 to 20\./);
  assert.doesNotMatch(addRule, /doctorAvailAddRule\.slotMinutes \|\||doctorAvailAddRule\.maxPerSlot \|\|/);
  assert.doesNotMatch(addRule, /Math\.min\(180|Math\.min\(20/);
});

test('availability API enforces the same required 5-180 and 1-20 limits', () => {
  const route = backend.slice(
    backend.indexOf("router.put('/doctors/:doctorId/availability/rules'"),
    backend.indexOf("router.get('/doctors/:doctorId/availability/exceptions'")
  );
  assert.match(route, /const slotMinutesRaw = Number\(r\?\.slotMinutes\)/);
  assert.match(route, /const maxPerSlotRaw = Number\(r\?\.maxPerSlot\)/);
  assert.match(route, /slotMinutesRaw > 180/);
  assert.match(route, /maxPerSlotRaw > 20/);
  assert.doesNotMatch(route, /maxPerSlotRaw > 50|must be 1-50/);
});
