const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNurseCalendarMonth, validateNurseCalendarEvent } = require('../utils/nurseCalendar');

test('nurse calendar validates and normalizes a safe event', () => {
  const result = validateNurseCalendarEvent({ title: '  Ward round  ', date: '2026-09-08', time: '07:30', type: 'SHIFT' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { title: 'Ward round', date: '2026-09-08', time: '07:30', type: 'shift' });
});

test('nurse calendar rejects invalid dates, times, and event types', () => {
  const result = validateNurseCalendarEvent({ title: '', date: '08/09/2026', time: '25:00', type: 'admin' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
  assert.equal(normalizeNurseCalendarMonth('2026-13'), null);
  assert.equal(normalizeNurseCalendarMonth('2026-09'), '2026-09');
  assert.equal(validateNurseCalendarEvent({ title: 'Invalid date', date: '2026-02-31', type: 'event' }).ok, false);
});
