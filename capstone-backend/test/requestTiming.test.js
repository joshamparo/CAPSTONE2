const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createRequestTiming, normalizeThreshold } = require('../middleware/requestTiming');

test('request timing logs slow routes without query strings or request data', () => {
  const entries = [];
  let tick = 0n;
  const middleware = createRequestTiming({
    thresholdMs: 500,
    logger: { info: (...args) => entries.push(args) },
    now: () => (tick += 600000000n)
  });
  const res = new EventEmitter();
  res.statusCode = 200;
  res.getHeader = () => '128';

  middleware({ method: 'get', path: '/api/patients?email=private@example.com' }, res, () => {});
  res.emit('finish');

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0][1], {
    method: 'GET',
    path: '/api/patients',
    status: 200,
    durationMs: 600,
    responseBytes: 128
  });
});

test('fast routes are quiet and timing thresholds are bounded', () => {
  const entries = [];
  let tick = 0n;
  const middleware = createRequestTiming({
    thresholdMs: 1000,
    logger: { info: (...args) => entries.push(args) },
    now: () => (tick += 200000000n)
  });
  const res = new EventEmitter();
  res.statusCode = 204;
  res.getHeader = () => null;
  middleware({ method: 'OPTIONS', path: '/api/health' }, res, () => {});
  res.emit('finish');

  assert.equal(entries.length, 0);
  assert.equal(normalizeThreshold(1), 100);
  assert.equal(normalizeThreshold(999999), 60000);
});
