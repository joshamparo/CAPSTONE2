const test = require('node:test');
const assert = require('node:assert/strict');
const { staffInvitationEmail } = require('../utils/emailTemplates');

test('staff invitation contains the one-time setup link and no temporary password', () => {
  const html = staffInvitationEmail({
    name: 'Test Staff',
    email: 'staff@example.com',
    setupLink: 'https://pascualinga.com/reset-password?token=secret-token'
  });
  assert.match(html, /Set up account/);
  assert.match(html, /secret-token/);
  assert.doesNotMatch(html, /Temporary password/i);
});

test('staff invitation escapes user-controlled content', () => {
  const html = staffInvitationEmail({
    name: '<script>alert(1)</script>',
    email: 'staff@example.com',
    setupLink: 'https://example.com/?x=1&y=2'
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /x=1&amp;y=2/);
});
