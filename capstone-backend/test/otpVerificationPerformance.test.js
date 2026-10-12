'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');

test('authenticated response reuses user metadata without duplicate database reads', () => {
  const start = source.indexOf('async function authenticatedUserResponse');
  const end = source.indexOf('// LOGIN Route', start);
  assert.ok(start >= 0 && end > start);
  const helper = source.slice(start, end);
  assert.match(helper, /const avatarUrl = user\.avatar_url \|\| null/);
  assert.match(helper, /const linkedDoctorId = user\.linked_doctor_id/);
  assert.doesNotMatch(helper, /getAvatarUrl\(/);
  assert.doesNotMatch(helper, /\$queryRawUnsafe/);
});

test('OTP remains atomically consumed before a signed session is returned', () => {
  const start = source.indexOf("router.post('/login/otp/verify'");
  const end = source.indexOf("router.post('/login/otp/resend'", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /UPDATE public\.login_otp_challenges SET consumed_at = now\(\)[\s\S]*RETURNING user_id, user_model/);
  assert.ok(handler.indexOf('if (!consumed?.[0])') < handler.indexOf('res.json(responseBody)'));
  assert.match(handler, /timingSafeEqual/);
});

test('presence and audit writes do not delay the OTP response', () => {
  const start = source.indexOf("router.post('/login/otp/verify'");
  const end = source.indexOf("router.post('/login/otp/resend'", start);
  const handler = source.slice(start, end);
  assert.ok(handler.indexOf('res.json(responseBody)') < handler.indexOf('Promise.allSettled'));
  assert.match(handler, /setPresenceOnline/);
  assert.match(handler, /activity_logs\.create/);
});
