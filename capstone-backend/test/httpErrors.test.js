'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatus, publicErrorMessage, sendError } = require('../utils/httpErrors');

test('server failures never expose database details', () => {
  const error = new Error('Invalid prisma.$queryRaw invocation: column updated_at does not exist');
  assert.equal(normalizeStatus(error), 500);
  assert.equal(publicErrorMessage(error, 'Unable to save record.'), 'Unable to save record.');
});

test('explicit client errors retain useful validation messages', () => {
  const error = Object.assign(new Error('Appointment is already completed.'), { statusCode: 409 });
  assert.equal(normalizeStatus(error), 409);
  assert.equal(publicErrorMessage(error, 'Unable to update appointment.'), 'Appointment is already completed.');
});

test('an unclassified database failure is hidden even with a 400 fallback', () => {
  const error = new Error('Raw query failed: relation patient_records does not exist');
  assert.equal(publicErrorMessage(error, 'Unable to save record.', 400), 'Unable to save record.');
});

test('sendError preserves response metadata without leaking a 500 error', () => {
  const result = {};
  const res = {
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return value; }
  };
  sendError(res, new Error('password=secret'), 'Unable to load data.', 500, { ok: false });
  assert.deepEqual(result, { status: 500, body: { ok: false, message: 'Unable to load data.' } });
});
